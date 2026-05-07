const http = require("http");
const fs = require("fs");
const path = require("path");
const iconv = require("iconv-lite");
const mysql = require("mysql2/promise");

const root = __dirname;
loadEnvFile(path.join(root, ".env"));

const port = Number(process.env.PORT || 8788);
const exportDir = path.join(root, "exports");
const skillsDir = path.join(root, "skills");
const workspaceDir = path.join(root, ".workflow-data");
const workspaceFile = path.join(workspaceDir, "workspace.json");
const requestTimeoutMs = 180000;
const mysqlConfig = {
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE || "ai_novel_pipeline",
  charset: "utf8mb4",
};
const workspaceStoreKey = "default";
let mysqlPool = null;
let mysqlAvailable = false;
let startupRepairDone = false;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function corsHeaders(type = "text/plain; charset=utf-8") {
  return {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, corsHeaders(type));
  res.end(body);
}

function normalizeLineBreaks(value) {
  return String(value || "").replace(/\r\n?/g, "\n");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function countMatches(text, pattern) {
  const matches = String(text || "").match(pattern);
  return matches ? matches.length : 0;
}

function readableChineseScore(value) {
  const text = normalizeLineBreaks(value);
  if (!text.trim()) return 0;
  const chinese = countMatches(text, /[\u3400-\u9fff]/g);
  const latin = countMatches(text, /[A-Za-z]/g);
  const digits = countMatches(text, /\d/g);
  const punctuation = countMatches(text, /[，。！？；：、“”‘’《》【】（）…·\-—\n]/g);
  const mojibakeMarkers = countMatches(text, /[锛鎴鐨鍒绗褰璇鍙浠鎬鍐涓闃]/g);
  const replacement = countMatches(text, /[�]/g);
  return (chinese * 2.2) + punctuation + (digits * 0.3) + (latin * 0.15) - (mojibakeMarkers * 1.4) - (replacement * 4);
}

function tryRepairMojibake(value) {
  const text = String(value || "");
  if (!text.trim()) return text;

  const candidates = [text];
  for (const encoding of ["gb18030", "gbk"]) {
    try {
      candidates.push(iconv.decode(iconv.encode(text, encoding), "utf8"));
    } catch {
      // Ignore invalid conversion attempts.
    }
  }

  let best = text;
  let bestScore = readableChineseScore(text);
  for (const candidate of candidates) {
    const score = readableChineseScore(candidate);
    if (score > bestScore + 6 && /[\u3400-\u9fff]/.test(candidate)) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function deepRepairText(value) {
  if (typeof value === "string") return tryRepairMojibake(value);
  if (Array.isArray(value)) return value.map((item) => deepRepairText(item));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepRepairText(item)]));
  }
  return value;
}

function splitStructuredLines(value) {
  return normalizeLineBreaks(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseStructuredSegments(line) {
  return line
    .replace(/^[\-\*\u2022]+\s*/, "")
    .split(/[|｜]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function uniqueBy(items, getKey) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function extractCharacterCards(projectRow = {}, volumeRows = []) {
  const candidates = [];
  splitStructuredLines(projectRow.character_state_table || "").forEach((line) => {
    const parts = parseStructuredSegments(line);
    if (!parts.length || /^(人物|角色|姓名)/.test(parts[0])) return;
    candidates.push({
      name: parts[0] || "",
      aliases: "",
      identity: parts[1] || "",
      faction: "",
      location: parts[2] || "",
      status: parts[3] || "",
      relations: parts[4] || "",
      notes: parts.slice(5).join("｜") || line,
      rawLine: line,
      sourceType: "character_state_table",
    });
  });

  volumeRows.forEach((row) => {
    splitStructuredLines(row.key_chars || "").forEach((line) => {
      const parts = parseStructuredSegments(line);
      if (!parts.length) return;
      const [name, identity = "", faction = "", location = "", notes = ""] = parts;
      candidates.push({
        name,
        aliases: "",
        identity,
        faction,
        location,
        status: "",
        relations: "",
        notes: notes || line,
        rawLine: line,
        sourceType: "volume_key_chars",
      });
    });
  });

  return uniqueBy(
    candidates.filter((item) => item.name && item.name.length <= 64),
    (item) => item.name,
  );
}

function extractHookItems(projectRow = {}, volumeRows = [], chapterRows = []) {
  const items = [];
  const pushLines = (text, sourceType) => {
    splitStructuredLines(text).forEach((line) => {
      const clean = line.replace(/^[\-\*\u2022]+\s*/, "").trim();
      if (!clean) return;
      const codeMatch = clean.match(/^([A-Z]+-\d{1,4})[:：\-]?\s*/i);
      const code = codeMatch ? codeMatch[1].toUpperCase() : "";
      const rest = codeMatch ? clean.slice(codeMatch[0].length).trim() : clean;
      const parts = parseStructuredSegments(rest);
      items.push({
        code,
        content: parts[0] || rest,
        status: parts[1] || "",
        firstSeen: parts[2] || "",
        recentProgress: parts[3] || "",
        plannedResolution: parts[4] || "",
        relatedEntities: parts.slice(5).join("｜"),
        rawLine: clean,
        sourceType,
      });
    });
  };

  pushLines(projectRow.hooks || "", "project_hooks");
  pushLines(projectRow.foreshadow_ledger || "", "foreshadow_ledger");
  pushLines(projectRow.foreshadow_timeline || "", "foreshadow_timeline");
  volumeRows.forEach((row) => pushLines(row.key_hooks || "", "volume_key_hooks"));
  chapterRows.forEach((row) => pushLines(row.hooks_snapshot || "", "chapter_hooks_snapshot"));

  return uniqueBy(
    items.filter((item) => item.content),
    (item) => item.code || item.content,
  );
}

function normalizeCharacterCardInput(card = {}) {
  return {
    name: String(card.name || "").trim(),
    aliases: String(card.aliases || "").trim(),
    identity: String(card.identity || "").trim(),
    faction: String(card.faction || "").trim(),
    location: String(card.location || "").trim(),
    status: String(card.status || "").trim(),
    relations: String(card.relations || "").trim(),
    notes: String(card.notes || "").trim(),
    rawLine: String(card.rawLine || "").trim(),
    sourceType: String(card.sourceType || "manual").trim() || "manual",
  };
}

function normalizeHookItemInput(item = {}, index = 0) {
  const code = String(item.code || "").trim() || `H-${String(index + 1).padStart(3, "0")}`;
  return {
    code,
    content: String(item.content || "").trim(),
    status: String(item.status || "").trim(),
    firstSeen: String(item.firstSeen || "").trim(),
    recentProgress: String(item.recentProgress || "").trim(),
    plannedResolution: String(item.plannedResolution || "").trim(),
    relatedEntities: String(item.relatedEntities || "").trim(),
    rawLine: String(item.rawLine || "").trim(),
    sourceType: String(item.sourceType || "manual").trim() || "manual",
  };
}

function composeCharacterStateTableFromCards(cards = []) {
  return cards
    .map((card) => {
      const normalized = normalizeCharacterCardInput(card);
      if (!normalized.name) return "";
      return [
        normalized.name,
        [normalized.identity, normalized.faction].filter(Boolean).join("/"),
        normalized.location,
        normalized.status,
        normalized.relations,
        normalized.notes,
      ].filter(Boolean).join(" | ");
    })
    .filter(Boolean)
    .join("\n");
}

function composeHooksTextFromItems(items = []) {
  return items
    .map((item, index) => {
      const normalized = normalizeHookItemInput(item, index);
      return [
        `${normalized.code}: ${normalized.content}`.trim(),
        normalized.status ? `status=${normalized.status}` : "",
        normalized.recentProgress ? `recent=${normalized.recentProgress}` : "",
      ].filter(Boolean).join(" | ");
    })
    .filter(Boolean)
    .join("\n");
}

function composeForeshadowLedgerFromItems(items = []) {
  return items
    .map((item, index) => {
      const normalized = normalizeHookItemInput(item, index);
      return [
        normalized.code,
        normalized.content,
        normalized.status,
        normalized.firstSeen,
        normalized.plannedResolution,
        normalized.relatedEntities,
      ].filter(Boolean).join(" | ");
    })
    .filter(Boolean)
    .join("\n");
}

function safeFilename(title) {
  const base = String(title || "draft")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "draft";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${base}-${stamp}.md`;
}

function readJsonBody(req, limitBytes = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limitBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function quoteMysqlIdentifier(identifier) {
  return `\`${String(identifier || "").replace(/`/g, "``")}\``;
}

async function columnExists(pool, tableName, columnName) {
  const [rows] = await pool.query(
    `
      SELECT COUNT(*) AS total
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
    `,
    [mysqlConfig.database, tableName, columnName],
  );
  return Number(rows?.[0]?.total || 0) > 0;
}

async function ensureColumnExists(pool, tableName, columnName, columnDefinition) {
  if (await columnExists(pool, tableName, columnName)) return;
  await pool.query(
    `ALTER TABLE ${quoteMysqlIdentifier(tableName)} ADD COLUMN ${columnDefinition}`,
  );
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/$/, "");
}

function stripHtml(text) {
  return String(text || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createHttpError(status, message, details = "") {
  const error = new Error(message);
  error.statusCode = status;
  error.details = details;
  return error;
}

function summarizeUpstreamError(status, text) {
  const plain = stripHtml(text).slice(0, 300);
  if (status === 524) {
    return plain
      ? `上游模型服务超时（524）：${plain}`
      : "上游模型服务超时（524）。通常是 API 网关或模型源站太久没返回，不是本地页面错误。";
  }
  if (status === 504) {
    return plain
      ? `上游接口超时（504）：${plain}`
      : "上游接口超时（504），通常是模型服务响应过慢、网关超时或反向代理不稳定。";
  }
  if (status === 502 || status === 503) {
    return plain
      ? `上游接口暂时不可用（${status}）：${plain}`
      : `上游接口暂时不可用（${status}）。`;
  }
  return plain || `上游接口请求失败（${status}）。`;
}

function flattenText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => flattenText(item)).join("");
  if (typeof value.text === "string") return value.text;
  if (typeof value.output_text === "string") return value.output_text;
  if (typeof value.content === "string") return value.content;
  if (Array.isArray(value.content)) return flattenText(value.content);
  return "";
}

function extractOpenAICompatibleContent(data) {
  const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
  const candidates = [
    flattenText(choice?.message?.content),
    flattenText(choice?.text),
    flattenText(data?.output_text),
  ];

  if (Array.isArray(data?.output)) {
    data.output.forEach((item) => {
      candidates.push(flattenText(item?.content));
      candidates.push(flattenText(item?.output_text));
    });
  }

  const content = candidates.find((item) => String(item || "").trim());
  if (content) return String(content).trim();

  const finishReason = choice?.finish_reason;
  const reasoningOnly = Boolean(
    flattenText(choice?.message?.reasoning_content)
    || flattenText(choice?.reasoning_content)
    || flattenText(data?.reasoning)
  );
  const refusal = flattenText(choice?.message?.refusal);
  const hints = [];
  if (finishReason) hints.push(`finish_reason=${finishReason}`);
  if (reasoningOnly) hints.push("模型只返回了思维内容，没有返回正文");
  if (refusal) hints.push(`拒答信息：${refusal.slice(0, 120)}`);
  hints.push("通常是上下文过长、输出被截断，或服务商响应结构与标准 chat.completions 不一致");
  throw new Error(`API returned empty content: ${hints.join("；")}`);
}

function extractGeminiContent(data) {
  const content = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (content) return content;

  const finishReason = data?.candidates?.[0]?.finishReason;
  const hints = [];
  if (finishReason) hints.push(`finishReason=${finishReason}`);
  hints.push("通常是上下文过长、输出被截断，或模型没有返回正文");
  throw new Error(`Gemini returned empty content: ${hints.join("；")}`);
}

async function callOpenAICompatible({ baseUrl, apiKey, model, messages, temperature = 0.7 }) {
  const finalBaseUrl = normalizeBaseUrl(baseUrl);
  if (!finalBaseUrl) throw new Error("Missing Base URL");
  if (!apiKey) throw new Error("Missing API Key");
  if (!model) throw new Error("Missing model");

  const response = await fetchWithTimeout(`${finalBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, temperature }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw createHttpError(response.status, summarizeUpstreamError(response.status, text), text.slice(0, 2000));
  }

  const data = JSON.parse(text);
  return extractOpenAICompatibleContent(data);
}

async function callGeminiNative({ baseUrl, apiKey, model, messages, temperature = 0.7 }) {
  const finalBaseUrl = normalizeBaseUrl(baseUrl);
  if (!finalBaseUrl) throw new Error("Missing Gemini Base URL");
  if (!apiKey) throw new Error("Missing Gemini API Key");
  if (!model) throw new Error("Missing Gemini model");

  const contents = [];
  let systemInstruction = "";
  messages.forEach((message) => {
    if (message.role === "system") {
      systemInstruction = message.content;
      return;
    }
    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    });
  });

  const body = {
    contents,
    generationConfig: { temperature },
  };
  if (systemInstruction) {
    body.system_instruction = { parts: [{ text: systemInstruction }] };
  }

  const response = await fetchWithTimeout(`${finalBaseUrl}/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw createHttpError(response.status, summarizeUpstreamError(response.status, text), text.slice(0, 2000));
  }

  const data = JSON.parse(text);
  return extractGeminiContent(data);
}

async function handleChat(req, res) {
  try {
    const data = await readJsonBody(req);
    const provider = data.provider || "openai-compatible";
    const baseUrl = normalizeBaseUrl(data.baseUrl);
    const isGoogleGemini = provider === "gemini" && baseUrl.includes("googleapis.com");
    const content = isGoogleGemini
      ? await callGeminiNative(data)
      : await callOpenAICompatible(data);

    send(res, 200, JSON.stringify({ content }), "application/json; charset=utf-8");
  } catch (error) {
    const status = error.name === "AbortError"
      ? 504
      : Number(error.statusCode) || 500;
    send(res, status, error.message);
  }
}

async function handleExport(req, res) {
  try {
    const data = await readJsonBody(req);
    const content = String(data.content || "");
    if (!content.trim()) {
      send(res, 400, "Missing export content");
      return;
    }

    fs.mkdirSync(exportDir, { recursive: true });
    const filePath = path.join(exportDir, safeFilename(data.title));
    fs.writeFileSync(filePath, content, "utf8");
    send(res, 200, JSON.stringify({ path: filePath }), "application/json; charset=utf-8");
  } catch (error) {
    send(res, 500, error.message);
  }
}

function readWorkspaceFile() {
  if (!fs.existsSync(workspaceFile)) return null;
  const raw = fs.readFileSync(workspaceFile, "utf8").trim();
  if (!raw) return null;
  return deepRepairText(JSON.parse(raw));
}

function writeWorkspaceFile(workspace) {
  fs.mkdirSync(workspaceDir, { recursive: true });
  const tempFile = `${workspaceFile}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(deepRepairText(workspace), null, 2), "utf8");
  fs.renameSync(tempFile, workspaceFile);
}

function composeVolumeOutlineText(volume) {
  if (!volume) return "";
  return [
    volume.title ? `卷名：${volume.title}` : "",
    volume.status ? `状态：${volume.status}` : "",
    volume.chapterRange ? `章节范围：${volume.chapterRange}` : "",
    volume.summary ? `卷定位 / 卷目标：\n${volume.summary}` : "",
    volume.outline ? `本卷大纲：\n${volume.outline}` : "",
    volume.keyChars ? `关键人物 / 势力：\n${volume.keyChars}` : "",
    volume.keyHooks ? `关键钩子 / 回收：\n${volume.keyHooks}` : "",
    volume.content ? `本卷内容沉淀：\n${volume.content}` : "",
    volume.notes ? `备注：\n${volume.notes}` : "",
  ].filter(Boolean).join("\n\n");
}

async function createMysqlPool() {
  const bootstrapPool = mysql.createPool({
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    user: mysqlConfig.user,
    password: mysqlConfig.password,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
  });

  await bootstrapPool.query(
    `CREATE DATABASE IF NOT EXISTS \`${mysqlConfig.database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await bootstrapPool.end();

  const pool = mysql.createPool({
    ...mysqlConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    namedPlaceholders: true,
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspace_store (
      store_key VARCHAR(64) NOT NULL PRIMARY KEY,
      payload LONGTEXT NOT NULL,
      updated_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspace_meta (
      store_key VARCHAR(64) NOT NULL PRIMARY KEY,
      active_project_id VARCHAR(120) NOT NULL DEFAULT '',
      mock_mode TINYINT(1) NOT NULL DEFAULT 0,
      global_config LONGTEXT NULL,
      workspace_updated_at BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id VARCHAR(120) NOT NULL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      bible LONGTEXT NULL,
      style_guide LONGTEXT NULL,
      style_distillation_report LONGTEXT NULL,
      style_reference_title VARCHAR(255) NOT NULL DEFAULT '',
      style_distilled_at BIGINT NOT NULL DEFAULT 0,
      codex LONGTEXT NULL,
      outline_text LONGTEXT NULL,
      volume_outline LONGTEXT NULL,
      hooks LONGTEXT NULL,
      foreshadow_ledger LONGTEXT NULL,
      volume_summary LONGTEXT NULL,
      phase_summary LONGTEXT NULL,
      character_state_table LONGTEXT NULL,
      foreshadow_timeline LONGTEXT NULL,
      chapter_summaries LONGTEXT NULL,
      chapter_goal LONGTEXT NULL,
      controller_draft LONGTEXT NULL,
      controller_memory LONGTEXT NULL,
      controller_memory_updated_at BIGINT NOT NULL DEFAULT 0,
      workflow_output_html LONGTEXT NULL,
      skill_toggles LONGTEXT NULL,
      active_volume_id VARCHAR(120) NOT NULL DEFAULT '',
      active_chapter_id VARCHAR(120) NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS volumes (
      id VARCHAR(120) NOT NULL PRIMARY KEY,
      project_id VARCHAR(120) NOT NULL,
      title VARCHAR(255) NOT NULL,
      status VARCHAR(80) NOT NULL DEFAULT '',
      chapter_range VARCHAR(120) NOT NULL DEFAULT '',
      summary LONGTEXT NULL,
      outline_text LONGTEXT NULL,
      content LONGTEXT NULL,
      key_chars LONGTEXT NULL,
      key_hooks LONGTEXT NULL,
      notes LONGTEXT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      KEY idx_volumes_project_id (project_id),
      CONSTRAINT fk_volumes_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chapters (
      id VARCHAR(120) NOT NULL PRIMARY KEY,
      project_id VARCHAR(120) NOT NULL,
      volume_id VARCHAR(120) NOT NULL DEFAULT '',
      volume_title VARCHAR(255) NOT NULL DEFAULT '',
      status_text VARCHAR(80) NOT NULL DEFAULT '',
      title VARCHAR(255) NOT NULL,
      content LONGTEXT NULL,
      summary LONGTEXT NULL,
      goal LONGTEXT NULL,
      hooks_snapshot LONGTEXT NULL,
      versions_json LONGTEXT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      KEY idx_chapters_project_id (project_id),
      KEY idx_chapters_volume_id (volume_id),
      CONSTRAINT fk_chapters_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await ensureColumnExists(pool, "chapters", "volume_id", "`volume_id` VARCHAR(120) NOT NULL DEFAULT '' AFTER `project_id`");
  await ensureColumnExists(pool, "chapters", "volume_title", "`volume_title` VARCHAR(255) NOT NULL DEFAULT '' AFTER `volume_id`");
  await ensureColumnExists(pool, "chapters", "status_text", "`status_text` VARCHAR(80) NOT NULL DEFAULT '' AFTER `volume_title`");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS controller_messages (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      project_id VARCHAR(120) NOT NULL,
      message_id VARCHAR(160) NOT NULL,
      role_name VARCHAR(40) NOT NULL,
      content LONGTEXT NULL,
      position_index INT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL DEFAULT 0,
      KEY idx_controller_messages_project_id (project_id),
      CONSTRAINT fk_controller_messages_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS controller_archives (
      id VARCHAR(160) NOT NULL PRIMARY KEY,
      project_id VARCHAR(120) NOT NULL,
      title VARCHAR(255) NOT NULL,
      content LONGTEXT NULL,
      source_count INT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL DEFAULT 0,
      KEY idx_controller_archives_project_id (project_id),
      CONSTRAINT fk_controller_archives_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS character_cards (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      project_id VARCHAR(120) NOT NULL,
      name VARCHAR(160) NOT NULL,
      aliases LONGTEXT NULL,
      identity_text LONGTEXT NULL,
      faction LONGTEXT NULL,
      location_text LONGTEXT NULL,
      status_text LONGTEXT NULL,
      relations_text LONGTEXT NULL,
      notes LONGTEXT NULL,
      raw_line LONGTEXT NULL,
      source_type VARCHAR(80) NOT NULL DEFAULT '',
      updated_at BIGINT NOT NULL DEFAULT 0,
      KEY idx_character_cards_project_id (project_id),
      KEY idx_character_cards_project_name (project_id, name(100)),
      CONSTRAINT fk_character_cards_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hook_items (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      project_id VARCHAR(120) NOT NULL,
      hook_code VARCHAR(80) NOT NULL DEFAULT '',
      content LONGTEXT NULL,
      status_text LONGTEXT NULL,
      first_seen LONGTEXT NULL,
      recent_progress LONGTEXT NULL,
      planned_resolution LONGTEXT NULL,
      related_entities LONGTEXT NULL,
      raw_line LONGTEXT NULL,
      source_type VARCHAR(80) NOT NULL DEFAULT '',
      updated_at BIGINT NOT NULL DEFAULT 0,
      KEY idx_hook_items_project_id (project_id),
      KEY idx_hook_items_project_code (project_id, hook_code),
      CONSTRAINT fk_hook_items_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  return pool;
}

async function ensureMysqlReady() {
  if (mysqlPool) return mysqlPool;
  mysqlPool = await createMysqlPool();
  mysqlAvailable = true;
  return mysqlPool;
}

async function readWorkspaceFromMysql() {
  const pool = await ensureMysqlReady();
  const [rows] = await pool.query(
    "SELECT payload, updated_at FROM workspace_store WHERE store_key = ? LIMIT 1",
    [workspaceStoreKey],
  );
  if (!rows.length) return null;
  return deepRepairText(JSON.parse(rows[0].payload));
}

async function readWorkspaceFromMysqlNormalized() {
  const pool = await ensureMysqlReady();
  const [[meta]] = await pool.query(
    "SELECT * FROM workspace_meta WHERE store_key = ? LIMIT 1",
    [workspaceStoreKey],
  );
  const [projectRows] = await pool.query("SELECT * FROM projects ORDER BY updated_at DESC, created_at DESC");
  if (!meta && !projectRows.length) return null;

  const [volumeRows] = await pool.query("SELECT * FROM volumes ORDER BY updated_at ASC, created_at ASC");
  const [chapterRows] = await pool.query("SELECT * FROM chapters ORDER BY created_at ASC, updated_at ASC");
  const [messageRows] = await pool.query("SELECT * FROM controller_messages ORDER BY project_id ASC, position_index ASC, id ASC");
  const [archiveRows] = await pool.query("SELECT * FROM controller_archives ORDER BY project_id ASC, created_at ASC");

  const volumeMap = new Map();
  volumeRows.forEach((row) => {
    const list = volumeMap.get(row.project_id) || [];
    list.push({
      id: row.id,
      title: row.title || "",
      status: row.status || "",
      chapterRange: row.chapter_range || "",
      summary: row.summary || "",
      outline: row.outline_text || "",
      content: row.content || "",
      keyChars: row.key_chars || "",
      keyHooks: row.key_hooks || "",
      notes: row.notes || "",
      createdAt: Number(row.created_at || 0),
      updatedAt: Number(row.updated_at || 0),
    });
    volumeMap.set(row.project_id, list);
  });

  const chapterMap = new Map();
  chapterRows.forEach((row) => {
    const list = chapterMap.get(row.project_id) || [];
    let versions = [];
    try {
      versions = JSON.parse(row.versions_json || "[]");
    } catch {
      versions = [];
    }
    list.push({
      id: row.id,
      status: row.status_text || "",
      title: row.title || "",
      content: row.content || "",
      summary: row.summary || "",
      goal: row.goal || "",
      hooksSnapshot: row.hooks_snapshot || "",
      volumeId: row.volume_id || "",
      volumeTitle: row.volume_title || "",
      versions,
      createdAt: Number(row.created_at || 0),
      updatedAt: Number(row.updated_at || 0),
    });
    chapterMap.set(row.project_id, list);
  });

  const messageMap = new Map();
  messageRows.forEach((row) => {
    const list = messageMap.get(row.project_id) || [];
    list.push({
      id: row.message_id || `message-${row.id}`,
      role: row.role_name || "system",
      content: row.content || "",
      createdAt: Number(row.created_at || 0),
    });
    messageMap.set(row.project_id, list);
  });

  const archiveMap = new Map();
  archiveRows.forEach((row) => {
    const list = archiveMap.get(row.project_id) || [];
    list.push({
      id: row.id,
      title: row.title || "",
      content: row.content || "",
      createdAt: Number(row.created_at || 0),
      sourceCount: Number(row.source_count || 0),
    });
    archiveMap.set(row.project_id, list);
  });

  const projects = projectRows.map((row) => {
    let skillToggles = {};
    try {
      skillToggles = JSON.parse(row.skill_toggles || "{}");
    } catch {
      skillToggles = {};
    }
    return {
      id: row.id,
      title: row.title || "",
      bible: row.bible || "",
      styleGuide: row.style_guide || "",
      styleDistillationReport: row.style_distillation_report || "",
      styleReferenceTitle: row.style_reference_title || "",
      styleDistilledAt: Number(row.style_distilled_at || 0),
      codex: row.codex || "",
      outline: row.outline_text || "",
      volumeOutline: row.volume_outline || "",
      hooks: row.hooks || "",
      foreshadowLedger: row.foreshadow_ledger || "",
      volumeSummary: row.volume_summary || "",
      phaseSummary: row.phase_summary || "",
      characterStateTable: row.character_state_table || "",
      foreshadowTimeline: row.foreshadow_timeline || "",
      chapterSummaries: row.chapter_summaries || "",
      chapterGoal: row.chapter_goal || "",
      controllerDraft: row.controller_draft || "",
      controllerMessages: messageMap.get(row.id) || [],
      controllerArchive: archiveMap.get(row.id) || [],
      controllerMemory: row.controller_memory || "",
      controllerMemoryUpdatedAt: Number(row.controller_memory_updated_at || 0),
      workflowOutputHtml: row.workflow_output_html || "",
      skillToggles,
      volumes: volumeMap.get(row.id) || [],
      activeVolumeId: row.active_volume_id || "",
      chapters: chapterMap.get(row.id) || [],
      activeChapterId: row.active_chapter_id || "",
      createdAt: Number(row.created_at || 0),
      updatedAt: Number(row.updated_at || 0),
    };
  });

  let globalConfig = {};
  try {
    globalConfig = JSON.parse(meta?.global_config || "{}");
  } catch {
    globalConfig = {};
  }

  return deepRepairText({
    global: globalConfig,
    mockMode: Boolean(meta?.mock_mode),
    activeProjectId: meta?.active_project_id || projects[0]?.id || "",
    projects,
    workspaceUpdatedAt: Number(meta?.workspace_updated_at || 0),
  });
}

async function writeWorkspaceToMysql(workspace) {
  const pool = await ensureMysqlReady();
  const now = Number(workspace?.workspaceUpdatedAt || Date.now());
  const payload = JSON.stringify(workspace);
  await pool.query(
    `
      INSERT INTO workspace_store (store_key, payload, updated_at, created_at)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        payload = VALUES(payload),
        updated_at = VALUES(updated_at)
    `,
    [workspaceStoreKey, payload, now, now],
  );
}

async function syncProjectKnowledgeTables(connection, projectId, options = {}) {
  const projectRow = options.projectRow || null;
  const volumeRows = Array.isArray(options.volumeRows) ? options.volumeRows : [];
  const chapterRows = Array.isArray(options.chapterRows) ? options.chapterRows : [];
  const updatedAt = Number(options.updatedAt || Date.now());

  await connection.query(`DELETE FROM character_cards WHERE project_id = ?`, [projectId]);
  await connection.query(`DELETE FROM hook_items WHERE project_id = ?`, [projectId]);

  const characterCards = extractCharacterCards(projectRow || {}, volumeRows);
  for (const card of characterCards) {
    await connection.query(
      `
        INSERT INTO character_cards (
          project_id, name, aliases, identity_text, faction, location_text, status_text,
          relations_text, notes, raw_line, source_type, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        projectId,
        String(card.name || ""),
        String(card.aliases || ""),
        String(card.identity || ""),
        String(card.faction || ""),
        String(card.location || ""),
        String(card.status || ""),
        String(card.relations || ""),
        String(card.notes || ""),
        String(card.rawLine || ""),
        String(card.sourceType || ""),
        updatedAt,
      ],
    );
  }

  const hookItems = extractHookItems(projectRow || {}, volumeRows, chapterRows);
  for (const item of hookItems) {
    await connection.query(
      `
        INSERT INTO hook_items (
          project_id, hook_code, content, status_text, first_seen, recent_progress,
          planned_resolution, related_entities, raw_line, source_type, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        projectId,
        String(item.code || ""),
        String(item.content || ""),
        String(item.status || ""),
        String(item.firstSeen || ""),
        String(item.recentProgress || ""),
        String(item.plannedResolution || ""),
        String(item.relatedEntities || ""),
        String(item.rawLine || ""),
        String(item.sourceType || ""),
        updatedAt,
      ],
    );
  }
}

async function syncWorkspaceToMysqlNormalized(workspace) {
  const pool = await ensureMysqlReady();
  const connection = await pool.getConnection();
  const now = Number(workspace?.workspaceUpdatedAt || Date.now());
  const projects = Array.isArray(workspace?.projects) ? workspace.projects : [];

  try {
    await connection.beginTransaction();

    await connection.query(
      `
        INSERT INTO workspace_meta (store_key, active_project_id, mock_mode, global_config, workspace_updated_at, updated_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          active_project_id = VALUES(active_project_id),
          mock_mode = VALUES(mock_mode),
          global_config = VALUES(global_config),
          workspace_updated_at = VALUES(workspace_updated_at),
          updated_at = VALUES(updated_at)
      `,
      [
        workspaceStoreKey,
        String(workspace?.activeProjectId || ""),
        workspace?.mockMode ? 1 : 0,
        JSON.stringify(workspace?.global || {}),
        now,
        now,
        now,
      ],
    );

    await connection.query("DELETE FROM controller_messages");
    await connection.query("DELETE FROM controller_archives");
    await connection.query("DELETE FROM character_cards");
    await connection.query("DELETE FROM hook_items");
    await connection.query("DELETE FROM chapters");
    await connection.query("DELETE FROM volumes");
    await connection.query("DELETE FROM projects");

    for (const project of projects) {
      await connection.query(
        `
          INSERT INTO projects (
            id, title, bible, style_guide, style_distillation_report, style_reference_title, style_distilled_at,
            codex, outline_text, volume_outline, hooks, foreshadow_ledger, volume_summary, phase_summary,
            character_state_table, foreshadow_timeline, chapter_summaries, chapter_goal, controller_draft,
            controller_memory, controller_memory_updated_at, workflow_output_html, skill_toggles,
            active_volume_id, active_chapter_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          String(project?.id || ""),
          String(project?.title || ""),
          String(project?.bible || ""),
          String(project?.styleGuide || ""),
          String(project?.styleDistillationReport || ""),
          String(project?.styleReferenceTitle || ""),
          Number(project?.styleDistilledAt || 0),
          String(project?.codex || ""),
          String(project?.outline || ""),
          String(project?.volumeOutline || ""),
          String(project?.hooks || ""),
          String(project?.foreshadowLedger || ""),
          String(project?.volumeSummary || ""),
          String(project?.phaseSummary || ""),
          String(project?.characterStateTable || ""),
          String(project?.foreshadowTimeline || ""),
          String(project?.chapterSummaries || ""),
          String(project?.chapterGoal || ""),
          String(project?.controllerDraft || ""),
          String(project?.controllerMemory || ""),
          Number(project?.controllerMemoryUpdatedAt || 0),
          String(project?.workflowOutputHtml || ""),
          JSON.stringify(project?.skillToggles || {}),
          String(project?.activeVolumeId || ""),
          String(project?.activeChapterId || ""),
          Number(project?.createdAt || now),
          Number(project?.updatedAt || now),
        ],
      );

      const volumes = Array.isArray(project?.volumes) ? project.volumes : [];
      for (const volume of volumes) {
        await connection.query(
          `
            INSERT INTO volumes (
              id, project_id, title, status, chapter_range, summary, outline_text, content,
              key_chars, key_hooks, notes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            String(volume?.id || ""),
            String(project?.id || ""),
            String(volume?.title || ""),
            String(volume?.status || ""),
            String(volume?.chapterRange || ""),
            String(volume?.summary || ""),
            String(volume?.outline || ""),
            String(volume?.content || ""),
            String(volume?.keyChars || ""),
            String(volume?.keyHooks || ""),
            String(volume?.notes || ""),
            Number(volume?.createdAt || now),
            Number(volume?.updatedAt || now),
          ],
        );
      }

      const chapters = Array.isArray(project?.chapters) ? project.chapters : [];
      for (const chapter of chapters) {
        await connection.query(
          `
            INSERT INTO chapters (
              id, project_id, volume_id, volume_title, status_text, title, content, summary, goal,
              hooks_snapshot, versions_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            String(chapter?.id || ""),
            String(project?.id || ""),
            String(chapter?.volumeId || ""),
            String(chapter?.volumeTitle || ""),
            String(chapter?.status || ""),
            String(chapter?.title || ""),
            String(chapter?.content || ""),
            String(chapter?.summary || ""),
            String(chapter?.goal || ""),
            String(chapter?.hooksSnapshot || ""),
            JSON.stringify(chapter?.versions || []),
            Number(chapter?.createdAt || now),
            Number(chapter?.updatedAt || now),
          ],
        );
      }

      const controllerMessages = Array.isArray(project?.controllerMessages) ? project.controllerMessages : [];
      for (let index = 0; index < controllerMessages.length; index += 1) {
        const message = controllerMessages[index] || {};
        await connection.query(
          `
            INSERT INTO controller_messages (
              project_id, message_id, role_name, content, position_index, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            String(project?.id || ""),
            String(message?.id || `message-${project?.id || "project"}-${index}`),
            String(message?.role || "system"),
            String(message?.content || ""),
            index,
            Number(message?.createdAt || project?.updatedAt || now),
          ],
        );
      }

      const controllerArchives = Array.isArray(project?.controllerArchive) ? project.controllerArchive : [];
      for (const archive of controllerArchives) {
        await connection.query(
          `
            INSERT INTO controller_archives (
              id, project_id, title, content, source_count, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            String(archive?.id || ""),
            String(project?.id || ""),
            String(archive?.title || ""),
            String(archive?.content || ""),
            Number(archive?.sourceCount || 0),
            Number(archive?.createdAt || project?.updatedAt || now),
          ],
        );
      }

      await syncProjectKnowledgeTables(connection, String(project?.id || ""), {
        projectRow: {
          character_state_table: String(project?.characterStateTable || ""),
          hooks: String(project?.hooks || ""),
          foreshadow_ledger: String(project?.foreshadowLedger || ""),
          foreshadow_timeline: String(project?.foreshadowTimeline || ""),
        },
        volumeRows: volumes.map((volume) => ({
          key_chars: String(volume?.keyChars || ""),
          key_hooks: String(volume?.keyHooks || ""),
        })),
        chapterRows: chapters.map((chapter) => ({
          hooks_snapshot: String(chapter?.hooksSnapshot || ""),
        })),
        updatedAt: Number(project?.updatedAt || now),
      });
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getNormalizedWorkspaceStats() {
  try {
    const pool = await ensureMysqlReady();
    const [[projectCount]] = await pool.query("SELECT COUNT(*) AS total FROM projects");
    const [[volumeCount]] = await pool.query("SELECT COUNT(*) AS total FROM volumes");
    const [[chapterCount]] = await pool.query("SELECT COUNT(*) AS total FROM chapters");
    const [[messageCount]] = await pool.query("SELECT COUNT(*) AS total FROM controller_messages");
    const [[characterCount]] = await pool.query("SELECT COUNT(*) AS total FROM character_cards");
    const [[hookCount]] = await pool.query("SELECT COUNT(*) AS total FROM hook_items");
    return {
      projectCount: Number(projectCount?.total || 0),
      volumeCount: Number(volumeCount?.total || 0),
      chapterCount: Number(chapterCount?.total || 0),
      controllerMessageCount: Number(messageCount?.total || 0),
      characterCardCount: Number(characterCount?.total || 0),
      hookItemCount: Number(hookCount?.total || 0),
    };
  } catch (error) {
    return {
      projectCount: 0,
      volumeCount: 0,
      chapterCount: 0,
      controllerMessageCount: 0,
      characterCardCount: 0,
      hookItemCount: 0,
      error: error.message,
    };
  }
}

async function syncWorkspaceStoreFromNormalized() {
  const normalizedWorkspace = await readWorkspaceFromMysqlNormalized();
  if (!normalizedWorkspace) return null;
  normalizedWorkspace.workspaceUpdatedAt = Date.now();
  await writeWorkspaceToMysql(normalizedWorkspace);
  return normalizedWorkspace;
}

async function listProjectsNormalized() {
  const pool = await ensureMysqlReady();
  const [rows] = await pool.query(`
    SELECT id, title, outline_text, volume_outline, active_volume_id, active_chapter_id, updated_at
    FROM projects
    ORDER BY updated_at DESC, created_at DESC
  `);
  return rows.map((row) => ({
    id: row.id,
    title: row.title || "",
    outline: row.outline_text || "",
    volumeOutline: row.volume_outline || "",
    activeVolumeId: row.active_volume_id || "",
    activeChapterId: row.active_chapter_id || "",
    updatedAt: Number(row.updated_at || 0),
  }));
}

async function getProjectVolumeStudio(projectId) {
  const pool = await ensureMysqlReady();
  const [[project]] = await pool.query(
    `SELECT id, title, outline_text, active_volume_id, volume_outline, updated_at FROM projects WHERE id = ? LIMIT 1`,
    [projectId],
  );
  if (!project) return null;
  const [volumes] = await pool.query(
    `SELECT id, title, status, chapter_range, summary, outline_text, content, key_chars, key_hooks, notes, created_at, updated_at
     FROM volumes WHERE project_id = ? ORDER BY created_at ASC, updated_at ASC`,
    [projectId],
  );
  return {
    project: {
      id: project.id,
      title: project.title || "",
      outline: project.outline_text || "",
      activeVolumeId: project.active_volume_id || "",
      volumeOutline: project.volume_outline || "",
      updatedAt: Number(project.updated_at || 0),
    },
    volumes: volumes.map((row) => ({
      id: row.id,
      title: row.title || "",
      status: row.status || "",
      chapterRange: row.chapter_range || "",
      summary: row.summary || "",
      outline: row.outline_text || "",
      content: row.content || "",
      keyChars: row.key_chars || "",
      keyHooks: row.key_hooks || "",
      notes: row.notes || "",
      createdAt: Number(row.created_at || 0),
      updatedAt: Number(row.updated_at || 0),
    })),
  };
}

async function saveProjectVolumeStudio(projectId, payload = {}) {
  const pool = await ensureMysqlReady();
  const connection = await pool.getConnection();
  const now = Date.now();
  const title = String(payload.title || "").trim() || "未命名新书";
  const outline = String(payload.outline || "").trim();
  const volumes = Array.isArray(payload.volumes) ? payload.volumes : [];
  const activeVolumeId = String(payload.activeVolumeId || volumes[0]?.id || "").trim();
  const activeVolume = volumes.find((item) => String(item?.id || "") === activeVolumeId) || volumes[0] || null;
  const volumeOutline = composeVolumeOutlineText(activeVolume ? {
    title: String(activeVolume.title || "").trim(),
    status: String(activeVolume.status || "").trim(),
    chapterRange: String(activeVolume.chapterRange || "").trim(),
    summary: String(activeVolume.summary || "").trim(),
    outline: String(activeVolume.outline || "").trim(),
    content: String(activeVolume.content || "").trim(),
    keyChars: String(activeVolume.keyChars || "").trim(),
    keyHooks: String(activeVolume.keyHooks || "").trim(),
    notes: String(activeVolume.notes || "").trim(),
  } : null);

  try {
    await connection.beginTransaction();

    await connection.query(
      `UPDATE projects
       SET title = ?, outline_text = ?, active_volume_id = ?, volume_outline = ?, updated_at = ?
       WHERE id = ?`,
      [title, outline, activeVolumeId, volumeOutline, now, projectId],
    );

    await connection.query(`DELETE FROM volumes WHERE project_id = ?`, [projectId]);

      for (const [index, volume] of volumes.entries()) {
      const createdAt = Number(volume?.createdAt || now + index);
      const updatedAt = Number(volume?.updatedAt || now);
      await connection.query(
        `INSERT INTO volumes (
          id, project_id, title, status, chapter_range, summary, outline_text, content, key_chars, key_hooks, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          String(volume?.id || ""),
          projectId,
          String(volume?.title || "").trim() || `第 ${index + 1} 卷`,
          String(volume?.status || "").trim(),
          String(volume?.chapterRange || "").trim(),
          String(volume?.summary || "").trim(),
          String(volume?.outline || "").trim(),
          String(volume?.content || "").trim(),
          String(volume?.keyChars || "").trim(),
          String(volume?.keyHooks || "").trim(),
          String(volume?.notes || "").trim(),
          createdAt,
          updatedAt,
          ],
        );
      }

      const [[projectRow]] = await connection.query(
        `SELECT character_state_table, hooks, foreshadow_ledger, foreshadow_timeline FROM projects WHERE id = ? LIMIT 1`,
        [projectId],
      );

      const [chapterRows] = await connection.query(
        `SELECT hooks_snapshot FROM chapters WHERE project_id = ? ORDER BY created_at ASC, updated_at ASC`,
        [projectId],
      );

      await syncProjectKnowledgeTables(connection, projectId, {
        projectRow,
        volumeRows: volumes.map((volume) => ({
          key_chars: String(volume?.keyChars || "").trim(),
          key_hooks: String(volume?.keyHooks || "").trim(),
        })),
        chapterRows,
        updatedAt: now,
      });

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  await syncWorkspaceStoreFromNormalized();
  return getProjectVolumeStudio(projectId);
}

async function listProjectChapters(projectId) {
  const pool = await ensureMysqlReady();
  const [[project]] = await pool.query(
    `SELECT id, active_chapter_id, active_volume_id, updated_at FROM projects WHERE id = ? LIMIT 1`,
    [projectId],
  );
  if (!project) return null;
  const [rows] = await pool.query(
    `SELECT id, volume_id, volume_title, status_text, title, content, summary, goal, hooks_snapshot, versions_json, created_at, updated_at
     FROM chapters WHERE project_id = ?
     ORDER BY updated_at DESC, created_at DESC`,
    [projectId],
  );
  return {
    projectId,
    activeChapterId: project.active_chapter_id || "",
    activeVolumeId: project.active_volume_id || "",
    updatedAt: Number(project.updated_at || 0),
    chapters: rows.map((row) => {
      let versions = [];
      try {
        versions = JSON.parse(row.versions_json || "[]");
      } catch {
        versions = [];
      }
      return {
        id: row.id,
        volumeId: row.volume_id || "",
        volumeTitle: row.volume_title || "",
        status: row.status_text || "",
        title: row.title || "",
        content: row.content || "",
        summary: row.summary || "",
        goal: row.goal || "",
        hooksSnapshot: row.hooks_snapshot || "",
        versions,
        createdAt: Number(row.created_at || 0),
        updatedAt: Number(row.updated_at || 0),
      };
    }),
  };
}

async function getProjectControllerState(projectId) {
  const pool = await ensureMysqlReady();
  const [[project]] = await pool.query(
    `SELECT id, controller_memory, controller_memory_updated_at, controller_draft, updated_at FROM projects WHERE id = ? LIMIT 1`,
    [projectId],
  );
  if (!project) return null;

  const [messageRows] = await pool.query(
    `
      SELECT message_id, role_name, content, position_index, created_at
      FROM controller_messages
      WHERE project_id = ?
      ORDER BY position_index ASC, id ASC
    `,
    [projectId],
  );
  const [archiveRows] = await pool.query(
    `
      SELECT id, title, content, source_count, created_at
      FROM controller_archives
      WHERE project_id = ?
      ORDER BY created_at ASC, id ASC
    `,
    [projectId],
  );
  const [characterRows] = await pool.query(
    `
      SELECT name, aliases, identity_text, faction, location_text, status_text, relations_text, notes, raw_line, source_type, updated_at
      FROM character_cards
      WHERE project_id = ?
      ORDER BY name ASC, id ASC
    `,
    [projectId],
  );
  const [hookRows] = await pool.query(
    `
      SELECT hook_code, content, status_text, first_seen, recent_progress, planned_resolution, related_entities, raw_line, source_type, updated_at
      FROM hook_items
      WHERE project_id = ?
      ORDER BY hook_code ASC, id ASC
    `,
    [projectId],
  );

  return {
    projectId,
    messages: messageRows.map((row) => ({
      id: row.message_id || "",
      role: row.role_name || "system",
      content: row.content || "",
      createdAt: Number(row.created_at || 0),
      position: Number(row.position_index || 0),
    })),
    archives: archiveRows.map((row) => ({
      id: row.id || "",
      title: row.title || "",
      content: row.content || "",
      sourceCount: Number(row.source_count || 0),
      createdAt: Number(row.created_at || 0),
    })),
    memory: String(project.controller_memory || ""),
    memoryUpdatedAt: Number(project.controller_memory_updated_at || 0),
    draft: String(project.controller_draft || ""),
    updatedAt: Number(project.updated_at || 0),
    characterCards: characterRows.map((row) => ({
      name: row.name || "",
      aliases: row.aliases || "",
      identity: row.identity_text || "",
      faction: row.faction || "",
      location: row.location_text || "",
      status: row.status_text || "",
      relations: row.relations_text || "",
      notes: row.notes || "",
      rawLine: row.raw_line || "",
      sourceType: row.source_type || "",
      updatedAt: Number(row.updated_at || 0),
    })),
    hookItems: hookRows.map((row) => ({
      code: row.hook_code || "",
      content: row.content || "",
      status: row.status_text || "",
      firstSeen: row.first_seen || "",
      recentProgress: row.recent_progress || "",
      plannedResolution: row.planned_resolution || "",
      relatedEntities: row.related_entities || "",
      rawLine: row.raw_line || "",
      sourceType: row.source_type || "",
      updatedAt: Number(row.updated_at || 0),
    })),
  };
}

async function appendProjectControllerMessage(projectId, message = {}) {
  const pool = await ensureMysqlReady();
  const connection = await pool.getConnection();
  const now = Number(message.createdAt || Date.now());

  try {
    await connection.beginTransaction();
    const [[project]] = await connection.query(`SELECT id FROM projects WHERE id = ? LIMIT 1`, [projectId]);
    if (!project) throw new Error("Project not found");
    const [[positionRow]] = await connection.query(
      `SELECT COALESCE(MAX(position_index), -1) AS max_position FROM controller_messages WHERE project_id = ?`,
      [projectId],
    );
    const position = Number(positionRow?.max_position ?? -1) + 1;
    await connection.query(
      `
        INSERT INTO controller_messages (
          project_id, message_id, role_name, content, position_index, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        projectId,
        String(message.id || `message-${projectId}-${now}-${Math.random().toString(16).slice(2)}`),
        String(message.role || "system"),
        String(message.content || ""),
        position,
        now,
      ],
    );
    await connection.query(`UPDATE projects SET updated_at = ? WHERE id = ?`, [Date.now(), projectId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  await syncWorkspaceStoreFromNormalized();
  return getProjectControllerState(projectId);
}

async function saveProjectControllerState(projectId, payload = {}) {
  const pool = await ensureMysqlReady();
  const connection = await pool.getConnection();
  const now = Date.now();
  const replaceMessages = Array.isArray(payload.messages);
  const replaceArchives = Array.isArray(payload.archives);

  try {
    await connection.beginTransaction();
    const [[project]] = await connection.query(
      `SELECT * FROM projects WHERE id = ? LIMIT 1`,
      [projectId],
    );
    if (!project) throw new Error("Project not found");

    if (replaceMessages) {
      await connection.query(`DELETE FROM controller_messages WHERE project_id = ?`, [projectId]);
      for (let index = 0; index < payload.messages.length; index += 1) {
        const message = payload.messages[index] || {};
        await connection.query(
          `
            INSERT INTO controller_messages (
              project_id, message_id, role_name, content, position_index, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            projectId,
            String(message.id || `message-${projectId}-${index}`),
            String(message.role || "system"),
            String(message.content || ""),
            index,
            Number(message.createdAt || now),
          ],
        );
      }
    }

    if (replaceArchives) {
      await connection.query(`DELETE FROM controller_archives WHERE project_id = ?`, [projectId]);
      for (const archive of payload.archives) {
        await connection.query(
          `
            INSERT INTO controller_archives (
              id, project_id, title, content, source_count, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            String(archive.id || `archive-${projectId}-${Math.random().toString(16).slice(2)}`),
            projectId,
            String(archive.title || ""),
            String(archive.content || ""),
            Number(archive.sourceCount || 0),
            Number(archive.createdAt || now),
          ],
        );
      }
    }

    await connection.query(
      `
        UPDATE projects
        SET controller_memory = ?,
            controller_memory_updated_at = ?,
            controller_draft = COALESCE(?, controller_draft),
            updated_at = ?
        WHERE id = ?
      `,
      [
        payload.memory ?? project.controller_memory ?? "",
        Number(payload.memoryUpdatedAt ?? project.controller_memory_updated_at ?? 0),
        payload.draft ?? null,
        now,
        projectId,
      ],
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  await syncWorkspaceStoreFromNormalized();
  return getProjectControllerState(projectId);
}

async function clearProjectControllerMessages(projectId) {
  const pool = await ensureMysqlReady();
  await pool.query(`DELETE FROM controller_messages WHERE project_id = ?`, [projectId]);
  await pool.query(`UPDATE projects SET updated_at = ? WHERE id = ?`, [Date.now(), projectId]);
  await syncWorkspaceStoreFromNormalized();
  return getProjectControllerState(projectId);
}

async function saveProjectKnowledgeState(projectId, payload = {}) {
  const pool = await ensureMysqlReady();
  const connection = await pool.getConnection();
  const now = Date.now();

  try {
    await connection.beginTransaction();
    const [[project]] = await connection.query(`SELECT * FROM projects WHERE id = ? LIMIT 1`, [projectId]);
    if (!project) throw new Error("Project not found");

    let characterCards = [];
    let hookItems = [];

    if (Array.isArray(payload.characterCards)) {
      characterCards = payload.characterCards.map((item) => normalizeCharacterCardInput(item)).filter((item) => item.name);
    } else if (typeof payload.characterStateTable === "string") {
      characterCards = extractCharacterCards({ character_state_table: String(payload.characterStateTable || "") }, []);
    } else {
      const [rows] = await connection.query(
        `SELECT name, aliases, identity_text, faction, location_text, status_text, relations_text, notes, raw_line, source_type FROM character_cards WHERE project_id = ? ORDER BY id ASC`,
        [projectId],
      );
      characterCards = rows.map((row) => normalizeCharacterCardInput({
        name: row.name,
        aliases: row.aliases,
        identity: row.identity_text,
        faction: row.faction,
        location: row.location_text,
        status: row.status_text,
        relations: row.relations_text,
        notes: row.notes,
        rawLine: row.raw_line,
        sourceType: row.source_type,
      })).filter((item) => item.name);
    }

    if (Array.isArray(payload.hookItems)) {
      hookItems = payload.hookItems.map((item, index) => normalizeHookItemInput(item, index)).filter((item) => item.content);
    } else if (typeof payload.hooks === "string" || typeof payload.foreshadowLedger === "string" || typeof payload.foreshadowTimeline === "string") {
      hookItems = extractHookItems({
        hooks: String(payload.hooks || ""),
        foreshadow_ledger: String(payload.foreshadowLedger || ""),
        foreshadow_timeline: String(payload.foreshadowTimeline || ""),
      }, [], []);
    } else {
      const [rows] = await connection.query(
        `SELECT hook_code, content, status_text, first_seen, recent_progress, planned_resolution, related_entities, raw_line, source_type FROM hook_items WHERE project_id = ? ORDER BY id ASC`,
        [projectId],
      );
      hookItems = rows.map((row, index) => normalizeHookItemInput({
        code: row.hook_code,
        content: row.content,
        status: row.status_text,
        firstSeen: row.first_seen,
        recentProgress: row.recent_progress,
        plannedResolution: row.planned_resolution,
        relatedEntities: row.related_entities,
        rawLine: row.raw_line,
        sourceType: row.source_type,
      }, index)).filter((item) => item.content);
    }

    await connection.query(`DELETE FROM character_cards WHERE project_id = ?`, [projectId]);
    await connection.query(`DELETE FROM hook_items WHERE project_id = ?`, [projectId]);

    for (const card of characterCards) {
      await connection.query(
        `
          INSERT INTO character_cards (
            project_id, name, aliases, identity_text, faction, location_text, status_text,
            relations_text, notes, raw_line, source_type, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          projectId,
          card.name,
          card.aliases,
          card.identity,
          card.faction,
          card.location,
          card.status,
          card.relations,
          card.notes,
          card.rawLine || card.notes,
          card.sourceType,
          now,
        ],
      );
    }

    for (const [index, item] of hookItems.entries()) {
      const hook = normalizeHookItemInput(item, index);
      await connection.query(
        `
          INSERT INTO hook_items (
            project_id, hook_code, content, status_text, first_seen, recent_progress,
            planned_resolution, related_entities, raw_line, source_type, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          projectId,
          hook.code,
          hook.content,
          hook.status,
          hook.firstSeen,
          hook.recentProgress,
          hook.plannedResolution,
          hook.relatedEntities,
          hook.rawLine || hook.content,
          hook.sourceType,
          now,
        ],
      );
    }

    const nextCharacterStateTable = composeCharacterStateTableFromCards(characterCards);
    const nextHooks = composeHooksTextFromItems(hookItems);
    const nextForeshadowLedger = composeForeshadowLedgerFromItems(hookItems);
    const nextForeshadowTimeline = composeForeshadowLedgerFromItems(hookItems);

    await connection.query(
      `
        UPDATE projects
        SET character_state_table = ?,
            hooks = ?,
            foreshadow_ledger = ?,
            foreshadow_timeline = ?,
            updated_at = ?
        WHERE id = ?
      `,
      [
        nextCharacterStateTable,
        nextHooks,
        nextForeshadowLedger,
        nextForeshadowTimeline,
        now,
        projectId,
      ],
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  await syncWorkspaceStoreFromNormalized();
  const controllerState = await getProjectControllerState(projectId);
  return {
    ...controllerState,
    memoryFields: {
      characterStateTable: composeCharacterStateTableFromCards(controllerState.characterCards || []),
      hooks: composeHooksTextFromItems(controllerState.hookItems || []),
      foreshadowLedger: composeForeshadowLedgerFromItems(controllerState.hookItems || []),
      foreshadowTimeline: composeForeshadowLedgerFromItems(controllerState.hookItems || []),
    },
  };
}

async function upsertProjectChapter(projectId, chapter = {}, options = {}) {
  const pool = await ensureMysqlReady();
  const connection = await pool.getConnection();
  const now = Date.now();
  try {
    await connection.beginTransaction();
    await connection.query(
      `
        INSERT INTO chapters (
          id, project_id, volume_id, volume_title, status_text, title, content, summary, goal,
          hooks_snapshot, versions_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          volume_id = VALUES(volume_id),
          volume_title = VALUES(volume_title),
          status_text = VALUES(status_text),
          title = VALUES(title),
          content = VALUES(content),
          summary = VALUES(summary),
          goal = VALUES(goal),
          hooks_snapshot = VALUES(hooks_snapshot),
          versions_json = VALUES(versions_json),
          updated_at = VALUES(updated_at)
      `,
      [
        String(chapter?.id || ""),
        projectId,
        String(chapter?.volumeId || ""),
        String(chapter?.volumeTitle || ""),
        String(chapter?.status || ""),
        String(chapter?.title || ""),
        String(chapter?.content || ""),
        String(chapter?.summary || ""),
        String(chapter?.goal || ""),
        String(chapter?.hooksSnapshot || ""),
        JSON.stringify(Array.isArray(chapter?.versions) ? chapter.versions : []),
        Number(chapter?.createdAt || now),
        Number(chapter?.updatedAt || now),
      ],
    );

    if (options.setActiveChapterId) {
      await connection.query(
        `UPDATE projects SET active_chapter_id = ?, updated_at = ? WHERE id = ?`,
        [options.setActiveChapterId, now, projectId],
      );
    } else {
      await connection.query(
        `UPDATE projects SET updated_at = ? WHERE id = ?`,
        [now, projectId],
      );
    }

    const [[projectRow]] = await connection.query(
      `SELECT character_state_table, hooks, foreshadow_ledger, foreshadow_timeline FROM projects WHERE id = ? LIMIT 1`,
      [projectId],
    );
    const [volumeRows] = await connection.query(
      `SELECT key_chars, key_hooks FROM volumes WHERE project_id = ? ORDER BY created_at ASC, updated_at ASC`,
      [projectId],
    );
    const [chapterRows] = await connection.query(
      `SELECT hooks_snapshot FROM chapters WHERE project_id = ? ORDER BY created_at ASC, updated_at ASC`,
      [projectId],
    );
    await syncProjectKnowledgeTables(connection, projectId, {
      projectRow,
      volumeRows,
      chapterRows,
      updatedAt: now,
    });

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  await syncWorkspaceStoreFromNormalized();
  return listProjectChapters(projectId);
}

async function deleteProjectChapter(projectId, chapterId) {
  const pool = await ensureMysqlReady();
  const connection = await pool.getConnection();
  const now = Date.now();
  try {
    await connection.beginTransaction();
    await connection.query(`DELETE FROM chapters WHERE project_id = ? AND id = ?`, [projectId, chapterId]);
    const [[nextChapter]] = await connection.query(
      `SELECT id FROM chapters WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
      [projectId],
    );
    await connection.query(
      `UPDATE projects SET active_chapter_id = ?, updated_at = ? WHERE id = ?`,
      [nextChapter?.id || "", now, projectId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  await syncWorkspaceStoreFromNormalized();
  return listProjectChapters(projectId);
}

async function setProjectActiveChapter(projectId, chapterId) {
  const pool = await ensureMysqlReady();
  const now = Date.now();
  await pool.query(
    `UPDATE projects SET active_chapter_id = ?, updated_at = ? WHERE id = ?`,
    [String(chapterId || ""), now, projectId],
  );
  await syncWorkspaceStoreFromNormalized();
  return listProjectChapters(projectId);
}

async function applyProjectChapterWriteback(projectId, payload = {}) {
  const pool = await ensureMysqlReady();
  const connection = await pool.getConnection();
  const now = Date.now();
  const memory = payload?.memory || {};
  const volume = payload?.activeVolume || {};
  const chapter = payload?.chapter || {};
  const activeVolumeId = String(payload?.activeVolumeId || volume?.id || "").trim();
  const activeChapterId = String(payload?.activeChapterId || chapter?.id || "").trim();
  const volumeOutline = composeVolumeOutlineText({
    title: String(volume?.title || "").trim(),
    status: String(volume?.status || "").trim(),
    chapterRange: String(volume?.chapterRange || "").trim(),
    summary: String(volume?.summary || "").trim(),
    outline: String(volume?.outline || "").trim(),
    content: String(volume?.content || "").trim(),
    keyChars: String(volume?.keyChars || "").trim(),
    keyHooks: String(volume?.keyHooks || "").trim(),
    notes: String(volume?.notes || "").trim(),
  });

  try {
    await connection.beginTransaction();

    await connection.query(
      `
        UPDATE projects
        SET codex = COALESCE(?, codex),
            outline_text = COALESCE(?, outline_text),
            hooks = COALESCE(?, hooks),
            foreshadow_ledger = COALESCE(?, foreshadow_ledger),
            volume_summary = COALESCE(?, volume_summary),
            phase_summary = COALESCE(?, phase_summary),
            character_state_table = COALESCE(?, character_state_table),
            foreshadow_timeline = COALESCE(?, foreshadow_timeline),
            chapter_summaries = COALESCE(?, chapter_summaries),
            chapter_goal = COALESCE(?, chapter_goal),
            volume_outline = CASE WHEN ? <> '' THEN ? ELSE volume_outline END,
            active_volume_id = CASE WHEN ? <> '' THEN ? ELSE active_volume_id END,
            active_chapter_id = CASE WHEN ? <> '' THEN ? ELSE active_chapter_id END,
            updated_at = ?
        WHERE id = ?
      `,
      [
        memory.codex ?? null,
        memory.outline ?? null,
        memory.hooks ?? null,
        memory.foreshadowLedger ?? null,
        memory.volumeSummary ?? null,
        memory.phaseSummary ?? null,
        memory.characterStateTable ?? null,
        memory.foreshadowTimeline ?? null,
        memory.chapterSummaries ?? null,
        memory.chapterGoal ?? null,
        volumeOutline,
        volumeOutline,
        activeVolumeId,
        activeVolumeId,
        activeChapterId,
        activeChapterId,
        now,
        projectId,
      ],
    );

    if (activeVolumeId) {
      await connection.query(
        `
          INSERT INTO volumes (
            id, project_id, title, status, chapter_range, summary, outline_text, content, key_chars, key_hooks, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            title = VALUES(title),
            status = VALUES(status),
            chapter_range = VALUES(chapter_range),
            summary = VALUES(summary),
            outline_text = VALUES(outline_text),
            content = VALUES(content),
            key_chars = VALUES(key_chars),
            key_hooks = VALUES(key_hooks),
            notes = VALUES(notes),
            updated_at = VALUES(updated_at)
        `,
        [
          activeVolumeId,
          projectId,
          String(volume?.title || "").trim() || "当前卷",
          String(volume?.status || "").trim(),
          String(volume?.chapterRange || "").trim(),
          String(volume?.summary || "").trim(),
          String(volume?.outline || "").trim(),
          String(volume?.content || "").trim(),
          String(volume?.keyChars || "").trim(),
          String(volume?.keyHooks || "").trim(),
          String(volume?.notes || "").trim(),
          Number(volume?.createdAt || now),
          Number(volume?.updatedAt || now),
        ],
      );
    }

    if (activeChapterId) {
      await connection.query(
        `
          INSERT INTO chapters (
            id, project_id, volume_id, volume_title, status_text, title, content, summary, goal, hooks_snapshot, versions_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            volume_id = VALUES(volume_id),
            volume_title = VALUES(volume_title),
            status_text = COALESCE(NULLIF(VALUES(status_text), ''), status_text),
            title = VALUES(title),
            content = COALESCE(NULLIF(VALUES(content), ''), content),
            summary = COALESCE(NULLIF(VALUES(summary), ''), summary),
            goal = COALESCE(NULLIF(VALUES(goal), ''), goal),
            hooks_snapshot = COALESCE(NULLIF(VALUES(hooks_snapshot), ''), hooks_snapshot),
            versions_json = CASE WHEN VALUES(versions_json) <> '[]' THEN VALUES(versions_json) ELSE versions_json END,
            updated_at = VALUES(updated_at)
        `,
        [
          activeChapterId,
          projectId,
          String(chapter?.volumeId || activeVolumeId || "").trim(),
          String(chapter?.volumeTitle || volume?.title || "").trim(),
          String(chapter?.status || "").trim(),
          String(chapter?.title || "").trim() || "正文章节",
          String(chapter?.content || ""),
          String(chapter?.summary || "").trim(),
          String(chapter?.goal || "").trim(),
          String(chapter?.hooksSnapshot || "").trim(),
          JSON.stringify(Array.isArray(chapter?.versions) ? chapter.versions : []),
          Number(chapter?.createdAt || now),
          Number(chapter?.updatedAt || now),
        ],
      );
    }

    const [[projectRow]] = await connection.query(
      `SELECT character_state_table, hooks, foreshadow_ledger, foreshadow_timeline FROM projects WHERE id = ? LIMIT 1`,
      [projectId],
    );
    const [volumeRows] = await connection.query(
      `SELECT key_chars, key_hooks FROM volumes WHERE project_id = ? ORDER BY created_at ASC, updated_at ASC`,
      [projectId],
    );
    const [chapterRows] = await connection.query(
      `SELECT hooks_snapshot FROM chapters WHERE project_id = ? ORDER BY created_at ASC, updated_at ASC`,
      [projectId],
    );
    await syncProjectKnowledgeTables(connection, projectId, {
      projectRow,
      volumeRows,
      chapterRows,
      updatedAt: now,
    });

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  await syncWorkspaceStoreFromNormalized();
  return {
    projectId,
    activeVolumeId,
    activeChapterId,
  };
}

async function getProjectPlanningContext(projectId, options = {}) {
  const pool = await ensureMysqlReady();
  const recentChapterLimit = Math.max(1, Math.min(Number(options.recentChapterLimit || 6), 12));
  const [[project]] = await pool.query(
    `
      SELECT id, title, bible, style_guide, codex, outline_text, volume_outline, hooks, foreshadow_ledger,
             volume_summary, phase_summary, character_state_table, foreshadow_timeline, chapter_summaries,
             chapter_goal, active_volume_id, active_chapter_id, updated_at
      FROM projects
      WHERE id = ?
      LIMIT 1
    `,
    [projectId],
  );
  if (!project) return null;

  const [[activeVolumeRow]] = project.active_volume_id
    ? await pool.query(
        `
          SELECT id, title, status, chapter_range, summary, outline_text, content, key_chars, key_hooks, notes, created_at, updated_at
          FROM volumes
          WHERE project_id = ? AND id = ?
          LIMIT 1
        `,
        [projectId, project.active_volume_id],
      )
    : [[null]];

  const [chapterRows] = await pool.query(
    `
      SELECT id, volume_id, volume_title, status_text, title, content, summary, goal, hooks_snapshot, created_at, updated_at
      FROM chapters
      WHERE project_id = ?
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ?
    `,
    [projectId, recentChapterLimit],
  );

  const [messageRows] = await pool.query(
    `
      SELECT message_id, role_name, content, created_at
      FROM controller_messages
      WHERE project_id = ?
      ORDER BY position_index DESC, id DESC
      LIMIT 8
    `,
    [projectId],
  );
  const [characterRows] = await pool.query(
    `
      SELECT name, aliases, identity_text, faction, location_text, status_text, relations_text, notes, raw_line, source_type, updated_at
      FROM character_cards
      WHERE project_id = ?
      ORDER BY name ASC, id ASC
    `,
    [projectId],
  );
  const [hookRows] = await pool.query(
    `
      SELECT hook_code, content, status_text, first_seen, recent_progress, planned_resolution, related_entities, raw_line, source_type, updated_at
      FROM hook_items
      WHERE project_id = ?
      ORDER BY hook_code ASC, id ASC
    `,
    [projectId],
  );

  return {
    projectId,
    projectTitle: project.title || "",
    memory: {
      bible: project.bible || "",
      styleGuide: project.style_guide || "",
      codex: project.codex || "",
      outline: project.outline_text || "",
      volumeOutline: project.volume_outline || "",
      hooks: project.hooks || "",
      foreshadowLedger: project.foreshadow_ledger || "",
      volumeSummary: project.volume_summary || "",
      phaseSummary: project.phase_summary || "",
      characterStateTable: project.character_state_table || "",
      foreshadowTimeline: project.foreshadow_timeline || "",
      chapterSummaries: project.chapter_summaries || "",
      chapterGoal: project.chapter_goal || "",
    },
    activeVolume: activeVolumeRow ? {
      id: activeVolumeRow.id,
      title: activeVolumeRow.title || "",
      status: activeVolumeRow.status || "",
      chapterRange: activeVolumeRow.chapter_range || "",
      summary: activeVolumeRow.summary || "",
      outline: activeVolumeRow.outline_text || "",
      content: activeVolumeRow.content || "",
      keyChars: activeVolumeRow.key_chars || "",
      keyHooks: activeVolumeRow.key_hooks || "",
      notes: activeVolumeRow.notes || "",
      createdAt: Number(activeVolumeRow.created_at || 0),
      updatedAt: Number(activeVolumeRow.updated_at || 0),
    } : null,
    activeVolumeId: project.active_volume_id || "",
    activeChapterId: project.active_chapter_id || "",
    recentChapters: chapterRows.map((row) => ({
      id: row.id,
      volumeId: row.volume_id || "",
      volumeTitle: row.volume_title || "",
      status: row.status_text || "",
      title: row.title || "",
      content: row.content || "",
      summary: row.summary || "",
      goal: row.goal || "",
      hooksSnapshot: row.hooks_snapshot || "",
      createdAt: Number(row.created_at || 0),
      updatedAt: Number(row.updated_at || 0),
    })),
    controllerMessages: messageRows
      .slice()
      .reverse()
      .map((row) => ({
        id: row.message_id || "",
        role: row.role_name || "system",
        content: row.content || "",
        createdAt: Number(row.created_at || 0),
      })),
    characterCards: characterRows.map((row) => ({
      name: row.name || "",
      aliases: row.aliases || "",
      identity: row.identity_text || "",
      faction: row.faction || "",
      location: row.location_text || "",
      status: row.status_text || "",
      relations: row.relations_text || "",
      notes: row.notes || "",
      rawLine: row.raw_line || "",
      sourceType: row.source_type || "",
      updatedAt: Number(row.updated_at || 0),
    })),
    hookItems: hookRows.map((row) => ({
      code: row.hook_code || "",
      content: row.content || "",
      status: row.status_text || "",
      firstSeen: row.first_seen || "",
      recentProgress: row.recent_progress || "",
      plannedResolution: row.planned_resolution || "",
      relatedEntities: row.related_entities || "",
      rawLine: row.raw_line || "",
      sourceType: row.source_type || "",
      updatedAt: Number(row.updated_at || 0),
    })),
    updatedAt: Number(project.updated_at || 0),
  };
}

async function handleProjectsList(_req, res) {
  try {
    const projects = await listProjectsNormalized();
    send(res, 200, JSON.stringify({ projects }), "application/json; charset=utf-8");
  } catch (error) {
    send(res, 500, error.message);
  }
}

async function handleProjectVolumeStudioGet(req, res, projectId) {
  try {
    const data = await getProjectVolumeStudio(projectId);
    if (!data) {
      send(res, 404, "Project not found");
      return;
    }
    send(res, 200, JSON.stringify(data), "application/json; charset=utf-8");
  } catch (error) {
    send(res, 500, error.message);
  }
}

async function handleProjectVolumeStudioSave(req, res, projectId) {
  try {
    const data = await readJsonBody(req, 32 * 1024 * 1024);
    const saved = await saveProjectVolumeStudio(projectId, data || {});
    send(res, 200, JSON.stringify(saved), "application/json; charset=utf-8");
  } catch (error) {
    send(res, 500, error.message);
  }
}

async function handleProjectChaptersGet(req, res, projectId) {
  try {
    const data = await listProjectChapters(projectId);
    if (!data) {
      send(res, 404, "Project not found");
      return;
    }
    send(res, 200, JSON.stringify(data), "application/json; charset=utf-8");
  } catch (error) {
    send(res, 500, error.message);
  }
}

async function handleProjectChapterSave(req, res, projectId, chapterId = "") {
  try {
    const data = await readJsonBody(req, 16 * 1024 * 1024);
    const chapter = { ...(data?.chapter || data || {}), id: chapterId || data?.chapter?.id || data?.id };
    const saved = await upsertProjectChapter(projectId, chapter, {
      setActiveChapterId: data?.activeChapterId || chapter.id || "",
    });
    send(res, 200, JSON.stringify(saved), "application/json; charset=utf-8");
  } catch (error) {
    send(res, 500, error.message);
  }
}

async function handleProjectChapterDelete(req, res, projectId, chapterId) {
  try {
    const data = await deleteProjectChapter(projectId, chapterId);
    send(res, 200, JSON.stringify(data), "application/json; charset=utf-8");
  } catch (error) {
    send(res, 500, error.message);
  }
}

async function handleProjectActiveChapterSave(req, res, projectId) {
  try {
    const data = await readJsonBody(req);
    const saved = await setProjectActiveChapter(projectId, data?.activeChapterId || "");
    send(res, 200, JSON.stringify(saved), "application/json; charset=utf-8");
  } catch (error) {
    send(res, 500, error.message);
  }
}

async function handleProjectChapterWriteback(req, res, projectId) {
  try {
    const data = await readJsonBody(req, 16 * 1024 * 1024);
    const saved = await applyProjectChapterWriteback(projectId, data || {});
    send(res, 200, JSON.stringify(saved), "application/json; charset=utf-8");
  } catch (error) {
    send(res, 500, error.message);
  }
}

async function handleProjectPlanningContextGet(req, res, projectId, url) {
  try {
    const recentChapterLimit = Number(url.searchParams.get("recentChapterLimit") || 6);
    const data = await getProjectPlanningContext(projectId, { recentChapterLimit });
    if (!data) {
      send(res, 404, "Project not found");
      return;
    }
    send(res, 200, JSON.stringify(data), "application/json; charset=utf-8");
  } catch (error) {
    send(res, 500, error.message);
  }
}

async function handleProjectControllerStateGet(_req, res, projectId) {
  try {
    const data = await getProjectControllerState(projectId);
    if (!data) {
      send(res, 404, "Project not found");
      return;
    }
    send(res, 200, JSON.stringify(data), "application/json; charset=utf-8");
  } catch (error) {
    send(res, 500, error.message);
  }
}

async function handleProjectControllerStateSave(req, res, projectId) {
  try {
    const data = await readJsonBody(req, 16 * 1024 * 1024);
    const saved = await saveProjectControllerState(projectId, data || {});
    send(res, 200, JSON.stringify(saved), "application/json; charset=utf-8");
  } catch (error) {
    send(res, 500, error.message);
  }
}

async function handleProjectControllerMessageAppend(req, res, projectId) {
  try {
    const data = await readJsonBody(req, 2 * 1024 * 1024);
    const saved = await appendProjectControllerMessage(projectId, data?.message || data || {});
    send(res, 200, JSON.stringify(saved), "application/json; charset=utf-8");
  } catch (error) {
    send(res, 500, error.message);
  }
}

async function handleProjectControllerMessagesClear(_req, res, projectId) {
  try {
    const saved = await clearProjectControllerMessages(projectId);
    send(res, 200, JSON.stringify(saved), "application/json; charset=utf-8");
  } catch (error) {
    send(res, 500, error.message);
  }
}

async function handleProjectKnowledgeStateSave(req, res, projectId) {
  try {
    const data = await readJsonBody(req, 8 * 1024 * 1024);
    const saved = await saveProjectKnowledgeState(projectId, data || {});
    send(res, 200, JSON.stringify(saved), "application/json; charset=utf-8");
  } catch (error) {
    send(res, 500, error.message);
  }
}

async function deleteWorkspaceFromMysql() {
  const pool = await ensureMysqlReady();
  await pool.query("DELETE FROM workspace_store WHERE store_key = ?", [workspaceStoreKey]);
}

async function getWorkspaceStorageStatus() {
  try {
    await ensureMysqlReady();
    return {
      provider: "mysql",
      mysqlAvailable: true,
      mysqlConfig: {
        host: mysqlConfig.host,
        port: mysqlConfig.port,
        user: mysqlConfig.user,
        database: mysqlConfig.database,
      },
      normalized: await getNormalizedWorkspaceStats(),
      fileFallback: workspaceFile,
    };
  } catch (error) {
    mysqlAvailable = false;
    return {
      provider: "file",
      mysqlAvailable: false,
      mysqlError: error.message,
      normalized: null,
      fileFallback: workspaceFile,
    };
  }
}

async function readWorkspaceStore() {
  try {
    const workspace = await readWorkspaceFromMysql();
    if (workspace) return { workspace, provider: "mysql" };
  } catch (error) {
    mysqlAvailable = false;
    console.warn("Failed to read workspace from MySQL:", error.message);
  }

  try {
    const normalizedWorkspace = await readWorkspaceFromMysqlNormalized();
    if (normalizedWorkspace) {
      return { workspace: normalizedWorkspace, provider: "mysql-normalized" };
    }
  } catch (error) {
    mysqlAvailable = false;
    console.warn("Failed to rebuild workspace from normalized MySQL tables:", error.message);
  }

  return { workspace: readWorkspaceFile(), provider: "file" };
}

async function writeWorkspaceStore(workspace) {
  try {
    await writeWorkspaceToMysql(workspace);
    await syncWorkspaceToMysqlNormalized(workspace);
    mysqlAvailable = true;
    return { provider: "mysql" };
  } catch (error) {
    mysqlAvailable = false;
    console.warn("Failed to write workspace to MySQL:", error.message);
    writeWorkspaceFile(workspace);
    return { provider: "file", warning: error.message };
  }
}

async function deleteWorkspaceStore() {
  let mysqlError = "";
  try {
    await deleteWorkspaceFromMysql();
    mysqlAvailable = true;
  } catch (error) {
    mysqlAvailable = false;
    mysqlError = error.message;
    console.warn("Failed to delete workspace from MySQL:", error.message);
  }

  if (fs.existsSync(workspaceFile)) {
    fs.unlinkSync(workspaceFile);
  }

  return {
    provider: mysqlError ? "file" : "mysql",
    mysqlError,
  };
}

async function migrateFileWorkspaceToMysql() {
  try {
    const fileWorkspace = readWorkspaceFile();
    if (!fileWorkspace) return;
    const mysqlWorkspace = await readWorkspaceFromMysql();
    if (mysqlWorkspace?.projects?.length) return;
    await writeWorkspaceToMysql(fileWorkspace);
    await syncWorkspaceToMysqlNormalized(fileWorkspace);
    console.log("Migrated existing workspace.json to MySQL.");
  } catch (error) {
    mysqlAvailable = false;
    console.warn("Workspace migration to MySQL skipped:", error.message);
  }
}

async function repairTableTextColumns(connection, tableName, idColumn, columns) {
  const [rows] = await connection.query(
    `SELECT ${[idColumn, ...columns].join(", ")} FROM ${tableName}`,
  );
  let updated = 0;

  for (const row of rows) {
    const next = {};
    let changed = false;
    for (const column of columns) {
      const before = row[column];
      const after = typeof before === "string" ? tryRepairMojibake(before) : before;
      if (after !== before) {
        next[column] = after;
        changed = true;
      }
    }
    if (!changed) continue;
    const setSql = Object.keys(next).map((column) => `${column} = ?`).join(", ");
    const params = [...Object.values(next), row[idColumn]];
    await connection.query(`UPDATE ${tableName} SET ${setSql} WHERE ${idColumn} = ?`, params);
    updated += 1;
  }

  return updated;
}

async function repairHistoricalTextData() {
  if (startupRepairDone) return;
  startupRepairDone = true;

  const pool = await ensureMysqlReady();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await repairTableTextColumns(connection, "projects", "id", [
      "title", "bible", "style_guide", "style_distillation_report", "style_reference_title",
      "codex", "outline_text", "volume_outline", "hooks", "foreshadow_ledger", "volume_summary",
      "phase_summary", "character_state_table", "foreshadow_timeline", "chapter_summaries",
      "chapter_goal", "controller_draft", "controller_memory", "workflow_output_html",
    ]);
    await repairTableTextColumns(connection, "volumes", "id", [
      "title", "status", "chapter_range", "summary", "outline_text", "content", "key_chars", "key_hooks", "notes",
    ]);
    await repairTableTextColumns(connection, "chapters", "id", [
      "volume_title", "title", "content", "summary", "goal", "hooks_snapshot", "versions_json",
    ]);
    await repairTableTextColumns(connection, "controller_messages", "id", [
      "message_id", "role_name", "content",
    ]);
    await repairTableTextColumns(connection, "controller_archives", "id", [
      "title", "content",
    ]);

    const [workspaceRows] = await connection.query(
      `SELECT store_key, payload FROM workspace_store WHERE store_key = ?`,
      [workspaceStoreKey],
    );
    for (const row of workspaceRows) {
      let parsed = null;
      try {
        parsed = JSON.parse(row.payload || "{}");
      } catch {
        parsed = null;
      }
      if (!parsed) continue;
      const repaired = deepRepairText(parsed);
      const repairedPayload = JSON.stringify(repaired);
      if (repairedPayload !== row.payload) {
        await connection.query(
          `UPDATE workspace_store SET payload = ?, updated_at = ? WHERE store_key = ?`,
          [repairedPayload, Date.now(), row.store_key],
        );
      }
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const fileWorkspace = readWorkspaceFile();
  if (fileWorkspace) {
    writeWorkspaceFile(fileWorkspace);
  }

  const normalized = await readWorkspaceFromMysqlNormalized();
  if (normalized?.projects?.length) {
    await syncWorkspaceStoreFromNormalized();
  }
}

async function handleWorkspaceGet(_req, res) {
  try {
    const { workspace, provider } = await readWorkspaceStore();
    const status = await getWorkspaceStorageStatus();
    send(
      res,
      200,
      JSON.stringify({ workspace, path: workspaceFile, provider, storage: status }),
      "application/json; charset=utf-8",
    );
  } catch (error) {
    send(res, 500, error.message);
  }
}

async function handleWorkspaceSave(req, res) {
  try {
    const data = await readJsonBody(req, 64 * 1024 * 1024);
    if (!data || typeof data !== "object" || !data.workspace || typeof data.workspace !== "object") {
      send(res, 400, "Missing workspace payload");
      return;
    }

    const result = await writeWorkspaceStore(data.workspace);
    const status = await getWorkspaceStorageStatus();
    send(
      res,
      200,
      JSON.stringify({ saved: true, path: workspaceFile, updatedAt: Date.now(), provider: result.provider, storage: status }),
      "application/json; charset=utf-8",
    );
  } catch (error) {
    send(res, 500, error.message);
  }
}

async function handleWorkspaceDelete(_req, res) {
  try {
    const result = await deleteWorkspaceStore();
    const status = await getWorkspaceStorageStatus();
    send(
      res,
      200,
      JSON.stringify({ deleted: true, path: workspaceFile, provider: result.provider, storage: status }),
      "application/json; charset=utf-8",
    );
  } catch (error) {
    send(res, 500, error.message);
  }
}

function safeSkillName(name) {
  return String(name || "").replace(/[^a-zA-Z0-9_-]/g, "");
}

function handleSkillsList(_req, res) {
  try {
    if (!fs.existsSync(skillsDir)) {
      send(res, 200, JSON.stringify({ skills: [] }), "application/json; charset=utf-8");
      return;
    }

    const skills = fs.readdirSync(skillsDir)
      .filter((file) => file.endsWith(".md"))
      .map((file) => path.basename(file, ".md"));
    send(res, 200, JSON.stringify({ skills }), "application/json; charset=utf-8");
  } catch (error) {
    send(res, 500, error.message);
  }
}

function handleSkill(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const name = safeSkillName(decodeURIComponent(url.pathname.replace("/api/skills/", "")));
    if (!name) {
      send(res, 400, "Missing skill name");
      return;
    }

    const filePath = path.join(skillsDir, `${name}.md`);
    if (!filePath.startsWith(skillsDir) || !fs.existsSync(filePath)) {
      send(res, 404, "Skill not found");
      return;
    }

    const content = fs.readFileSync(filePath, "utf8");
    send(res, 200, JSON.stringify({ name, content }), "application/json; charset=utf-8");
  } catch (error) {
    send(res, 500, error.message);
  }
}

function handleStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const fullPath = path.normalize(path.join(root, requested));

  if (!fullPath.startsWith(root)) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.readFile(fullPath, (error, data) => {
    if (error) {
      send(res, 404, "Not found");
      return;
    }
    const type = mimeTypes[path.extname(fullPath)] || "application/octet-stream";
    res.writeHead(200, corsHeaders(type));
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    send(res, 204, "");
    return;
  }

  if (req.method === "POST" && pathname === "/api/chat") {
    handleChat(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/export-draft") {
    handleExport(req, res);
    return;
  }

  if (req.method === "GET" && pathname === "/api/workspace") {
    handleWorkspaceGet(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/workspace") {
    handleWorkspaceSave(req, res);
    return;
  }

  if (req.method === "DELETE" && pathname === "/api/workspace") {
    handleWorkspaceDelete(req, res);
    return;
  }

  if (req.method === "GET" && pathname === "/api/projects") {
    handleProjectsList(req, res);
    return;
  }

  const volumeStudioMatch = pathname.match(/^\/api\/projects\/([^/]+)\/volume-studio$/);
  if (volumeStudioMatch && req.method === "GET") {
    handleProjectVolumeStudioGet(req, res, decodeURIComponent(volumeStudioMatch[1]));
    return;
  }
  if (volumeStudioMatch && (req.method === "PUT" || req.method === "POST")) {
    handleProjectVolumeStudioSave(req, res, decodeURIComponent(volumeStudioMatch[1]));
    return;
  }

  const chaptersMatch = pathname.match(/^\/api\/projects\/([^/]+)\/chapters$/);
  if (chaptersMatch && req.method === "GET") {
    handleProjectChaptersGet(req, res, decodeURIComponent(chaptersMatch[1]));
    return;
  }
  if (chaptersMatch && (req.method === "POST" || req.method === "PUT")) {
    handleProjectChapterSave(req, res, decodeURIComponent(chaptersMatch[1]));
    return;
  }

  const chapterItemMatch = pathname.match(/^\/api\/projects\/([^/]+)\/chapters\/([^/]+)$/);
  if (chapterItemMatch && (req.method === "POST" || req.method === "PUT")) {
    handleProjectChapterSave(req, res, decodeURIComponent(chapterItemMatch[1]), decodeURIComponent(chapterItemMatch[2]));
    return;
  }
  if (chapterItemMatch && req.method === "DELETE") {
    handleProjectChapterDelete(req, res, decodeURIComponent(chapterItemMatch[1]), decodeURIComponent(chapterItemMatch[2]));
    return;
  }

  const activeChapterMatch = pathname.match(/^\/api\/projects\/([^/]+)\/active-chapter$/);
  if (activeChapterMatch && (req.method === "POST" || req.method === "PUT")) {
    handleProjectActiveChapterSave(req, res, decodeURIComponent(activeChapterMatch[1]));
    return;
  }

  const chapterWritebackMatch = pathname.match(/^\/api\/projects\/([^/]+)\/chapter-writeback$/);
  if (chapterWritebackMatch && (req.method === "POST" || req.method === "PUT")) {
    handleProjectChapterWriteback(req, res, decodeURIComponent(chapterWritebackMatch[1]));
    return;
  }

  const planningContextMatch = pathname.match(/^\/api\/projects\/([^/]+)\/planning-context$/);
  if (planningContextMatch && req.method === "GET") {
    handleProjectPlanningContextGet(req, res, decodeURIComponent(planningContextMatch[1]), url);
    return;
  }

  const controllerStateMatch = pathname.match(/^\/api\/projects\/([^/]+)\/controller-state$/);
  if (controllerStateMatch && req.method === "GET") {
    handleProjectControllerStateGet(req, res, decodeURIComponent(controllerStateMatch[1]));
    return;
  }
  if (controllerStateMatch && (req.method === "PUT" || req.method === "POST")) {
    handleProjectControllerStateSave(req, res, decodeURIComponent(controllerStateMatch[1]));
    return;
  }

  const controllerMessagesMatch = pathname.match(/^\/api\/projects\/([^/]+)\/controller-messages$/);
  if (controllerMessagesMatch && req.method === "POST") {
    handleProjectControllerMessageAppend(req, res, decodeURIComponent(controllerMessagesMatch[1]));
    return;
  }
  if (controllerMessagesMatch && req.method === "DELETE") {
    handleProjectControllerMessagesClear(req, res, decodeURIComponent(controllerMessagesMatch[1]));
    return;
  }

  const knowledgeStateMatch = pathname.match(/^\/api\/projects\/([^/]+)\/knowledge-state$/);
  if (knowledgeStateMatch && (req.method === "PUT" || req.method === "POST")) {
    handleProjectKnowledgeStateSave(req, res, decodeURIComponent(knowledgeStateMatch[1]));
    return;
  }

  if (req.method === "GET" && pathname === "/api/skills") {
    handleSkillsList(req, res);
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/skills/")) {
    handleSkill(req, res);
    return;
  }

  if (req.method === "GET") {
    handleStatic(req, res);
    return;
  }

  send(res, 405, "Method not allowed");
});

server.listen(port, () => {
  console.log(`Novel workflow server running at http://localhost:${port}/`);
  console.log(`Exports will be written to ${exportDir}`);
  console.log(`Workspace data will be written to ${workspaceFile}`);
  ensureMysqlReady()
    .then(async () => {
      console.log(`Workspace storage MySQL ready: ${mysqlConfig.user}@${mysqlConfig.host}:${mysqlConfig.port}/${mysqlConfig.database}`);
      await migrateFileWorkspaceToMysql();
      await repairHistoricalTextData();
    })
    .catch((error) => {
      mysqlAvailable = false;
      console.warn(`MySQL unavailable, workspace will fallback to file storage: ${error.message}`);
    });
});
