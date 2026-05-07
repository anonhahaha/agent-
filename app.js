const fields = [
  "openaiBaseUrl",
  "openaiApiKey",
  "controllerModel",
  "writerModel",
  "geminiBaseUrl",
  "geminiApiKey",
  "geminiModel",
  "deepseekBaseUrl",
  "deepseekApiKey",
  "deepseekModel",
];

const $ = (id) => document.getElementById(id);
let workflowAborted = false;
let currentAbortController = null;
let controllerMessages = [];
let appState = null;
let activeProjectId = "";
let activeChapterId = "";
let persistTimer = null;
const skillCache = {};
const boundOutputControls = new WeakSet();
const expandedSkillRoles = new Set(["controller"]);
const FLOW_SEQUENCE = ["controller", "analysis", "brief", "draft", "audit", "extract", "next", "export"];
const workflowFlowOverrides = {};
let activeSkillName = "";
let activeSkillContent = "";
let activeSkillError = "";
let activeSkillLoading = false;
let activeSkillRequestId = 0;
let uploadedStyleSourceText = "";
let uploadedStyleSourceName = "";
let uploadedStyleSourceEncoding = "";
let volumeStudioSyncToken = "";
let knowledgeSyncTimer = null;
const CHAPTER_STATUS = {
  PLANNING: "规划中",
  DRAFTING: "草稿中",
  WRITTEN_BACK: "已回写",
};
const AUTO_REVISE_AFTER_AUDIT = true;
const AUTO_REVISE_MAX_PASSES = 1;
const ROLE_SKILL_STACKS = {
  controller: [
    "wuxia-longform",
    "xuanhuan-longform",
    "xuanhuan-upgrade-prose",
    "character-bible",
    "chapter-goal-planner",
    "hook-engine",
  ],
  writer: [
    "wuxia-longform",
    "xuanhuan-longform",
    "xuanhuan-upgrade-prose",
    "character-bible",
    "continuity-fixer",
    "power-system-guard",
    "hook-engine",
    "anti-ai-style",
  ],
  auditor: [
    "wuxia-longform",
    "xuanhuan-longform",
    "xuanhuan-upgrade-prose",
    "character-bible",
    "continuity-fixer",
    "power-system-guard",
    "anti-ai-style",
  ],
  "memory-maintainer": [
    "wuxia-longform",
    "xuanhuan-longform",
    "character-bible",
    "chapter-goal-planner",
  ],
};
const ROLE_DISPLAY_META = {
  controller: {
    label: "主控",
    hint: "沉淀需求、推进章节和下一章目标",
  },
  writer: {
    label: "正文",
    hint: "生成正文、微调和修订章节",
  },
  auditor: {
    label: "审稿",
    hint: "检查连续性、设定和逻辑偏移",
  },
  "memory-maintainer": {
    label: "记忆",
    hint: "回写设定档案、摘要和长期状态",
  },
};
const SKILL_DISPLAY_META = {
  "wuxia-longform": {
    label: "武侠长篇",
    hint: "通用长篇结构、势力节奏和伏笔规则",
  },
  "xuanhuan-longform": {
    label: "玄幻长篇",
    hint: "只管境界、血脉、秘境、飞升和世界层级，不碰文笔",
  },
  "xuanhuan-upgrade-prose": {
    label: "升级推进体",
    hint: "硬朗叙事、短对白、战斗动作链和章末抬门槛",
  },
  "character-bible": {
    label: "人物档案",
    hint: "核对姓名、称呼、关系、状态和位置",
  },
  "chapter-goal-planner": {
    label: "章节规划",
    hint: "把本章结果自然转成下一章目标",
  },
  "hook-engine": {
    label: "钩子生成",
    hint: "强化章末承接点和下一章入口",
  },
  "continuity-fixer": {
    label: "连续性修复",
    hint: "修人物名、信息边界、承接和场景过渡",
  },
  "power-system-guard": {
    label: "战力守卫",
    hint: "守境界、功法、法宝、代价和越级逻辑",
  },
  "anti-ai-style": {
    label: "去 AI 味",
    hint: "压模板句和解释腔，保留动作与场景感",
  },
};

const STORAGE_KEY = "novelWorkflowWorkspaceV2";
const LEGACY_STORAGE_KEY = "novelWorkflowConfig";
const WORKSPACE_MIRROR_SCHEMA = "novel-workflow-workspace-mirror-v1";
const VOLUME_STUDIO_SYNC_KEY = "novelWorkflowVolumeStudioSync";
const OUTPUT_EXPAND_LABEL = "\u5c55\u5f00";
const OUTPUT_COLLAPSE_LABEL = "\u6536\u8d77";
const OUTPUT_EXPAND_ALL_LABEL = "\u5c55\u5f00\u5168\u90e8";
const OUTPUT_COLLAPSE_ALL_LABEL = "\u6536\u8d77\u5168\u90e8";
const LEGACY_OUTPUT_TITLE_MAP = new Map([
  ["涓绘帶 Brief", "主控 Brief"],
  ["姝ｆ枃鑽夌", "正文草稿"],
  ["瀹＄鎰忚", "审稿意见"],
  ["鐘舵€佹洿鏂?", "状态更新"],
  ["鎵归噺鏍″悕 / 鏍¤瀹?", "批量校名 / 校设定"],
  ["鏂囬钂搁", "文风蒸馏"],
  ["鏂囬钂搁锛堣拷鍔狅級", "文风蒸馏（追加）"],
]);

const KNOWN_UI_TEXT_REPAIRS = [
  ["鏈懡鍚嶆柊涔?", "未命名新书"],
  ["鎴戠殑绗竴鏈功", "我的第一本书"],
  ["姝ｆ枃鑽夌", "正文草稿"],
  ["瀹＄鎰忚", "审稿意见"],
  ["鐘舵€佹洿鏂?", "状态更新"],
  ["涓绘帶 Brief", "主控 Brief"],
  ["鏃ф暟鎹?", "旧数据："],
  ["鍒濈", "初稿"],
  ["瑕嗙洊鏇存柊", "覆盖更新"],
];

function repairKnownUiText(value) {
  let next = String(value || "");
  KNOWN_UI_TEXT_REPAIRS.forEach(([from, to]) => {
    next = next.split(from).join(to);
  });
  return next;
}

function normalizeOutputTitle(title) {
  const value = repairKnownUiText(String(title || "").trim());
  return LEGACY_OUTPUT_TITLE_MAP.get(value) || value;
}

const emptyOutputHtml = `<div class="empty-state">
            <p>等待指令中</p>
            <span>默认使用真实 API。需要离线演示时，可以在右上角开启模拟模式。</span>
          </div>`;

const defaultValues = {
  openaiBaseUrl: "https://api.openai.com/v1",
  geminiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  deepseekBaseUrl: "https://api.deepseek.com",
  controllerModel: "gpt-4o",
  writerModel: "gpt-4o",
  geminiModel: "gemini-1.5-pro",
  deepseekModel: "deepseek-chat",
  mockMode: false,
  bible: "",
  styleGuide: "",
  codex: "",
  outline: "",
  volumeOutline: "",
  hooks: "",
  foreshadowLedger: "",
  volumeSummary: "",
  phaseSummary: "",
  characterStateTable: "",
  foreshadowTimeline: "",
  chapterSummaries: "",
  chapterGoal: "",
};

const WORKFLOW_RUN_MODES = {
  fast: {
    label: "快速",
    description: "Brief + 正文 + 轻量回写，跳过审稿和质量评分。",
    qualityThreshold: 0,
  },
  standard: {
    label: "标准",
    description: "完整生成、审稿、质量评分和状态回写。",
    qualityThreshold: 70,
  },
  strict: {
    label: "严格",
    description: "开启写前校验、质量阈值和更强自动修订。",
    qualityThreshold: 78,
  },
};

function normalizeWorkflowRunMode(mode) {
  const value = String(mode || "").trim();
  return Object.prototype.hasOwnProperty.call(WORKFLOW_RUN_MODES, value) ? value : "standard";
}

function normalizeWorkflowRunState(state = null) {
  const source = state && typeof state === "object" ? state : {};
  return {
    runId: String(source.runId || "").trim(),
    mode: normalizeWorkflowRunMode(source.mode),
    status: String(source.status || "").trim(),
    sourceContext: String(source.sourceContext || ""),
    memoryPack: source.memoryPack && typeof source.memoryPack === "object" ? source.memoryPack : null,
    preflight: source.preflight && typeof source.preflight === "object" ? source.preflight : null,
    results: source.results && typeof source.results === "object" ? source.results : {},
    completedStepIds: Array.isArray(source.completedStepIds) ? source.completedStepIds.filter(Boolean) : [],
    qualityReport: source.qualityReport && typeof source.qualityReport === "object" ? source.qualityReport : null,
    failedStepId: String(source.failedStepId || "").trim(),
    error: String(source.error || "").trim(),
    startedAt: Number(source.startedAt || 0),
    updatedAt: Number(source.updatedAt || 0),
  };
}

function normalizeQualityReport(report = null) {
  const source = report && typeof report === "object" ? report : {};
  const score = Number(source.overall || 0);
  return {
    humanTaste: Number(source.humanTaste || 0),
    sceneVividness: Number(source.sceneVividness || 0),
    dialogueNaturalness: Number(source.dialogueNaturalness || 0),
    aiFlavorControl: Number(source.aiFlavorControl || 0),
    continuity: Number(source.continuity || 0),
    plotProgress: Number(source.plotProgress || 0),
    overall: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
    majorIssues: Array.isArray(source.majorIssues) ? source.majorIssues.filter(Boolean) : [],
    rewriteAdvice: Array.isArray(source.rewriteAdvice) ? source.rewriteAdvice.filter(Boolean) : [],
    mode: normalizeWorkflowRunMode(source.mode),
    chapterId: String(source.chapterId || "").trim(),
    createdAt: Number(source.createdAt || 0),
    rawText: String(source.rawText || ""),
    parseFailed: Boolean(source.parseFailed),
  };
}

let workspaceWriteChain = Promise.resolve();

function createId() {
  return `book-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createVolumeEntity(volume = {}, index = 0) {
  const now = Date.now() + index;
  const createdAt = Number(volume.createdAt || now);
  const updatedAt = Number(volume.updatedAt || createdAt || now);
  return {
    id: volume.id || `volume-${createdAt}-${Math.random().toString(16).slice(2)}`,
    title: String(volume.title || `第${index + 1}卷`).trim() || `第${index + 1}卷`,
    status: String(volume.status || "").trim(),
    chapterRange: String(volume.chapterRange || "").trim(),
    summary: String(volume.summary || "").trim(),
    outline: String(volume.outline || "").trim(),
    content: String(volume.content || "").trim(),
    keyChars: String(volume.keyChars || "").trim(),
    keyHooks: String(volume.keyHooks || "").trim(),
    notes: String(volume.notes || "").trim(),
    createdAt,
    updatedAt,
  };
}

function normalizeVolumeRecords(input = [], fallbackOutline = "") {
  const source = Array.isArray(input) && input.length
    ? input
    : String(fallbackOutline || "").trim()
      ? [{
          title: "当前卷",
          status: "已迁移",
          outline: String(fallbackOutline || "").trim(),
        }]
      : [];

  return source.map((volume, index) => createVolumeEntity(volume, index));
}

function resolveActiveVolumeId(volumes = [], preferredId = "") {
  if (preferredId && volumes.some((volume) => volume.id === preferredId)) return preferredId;
  return volumes[0]?.id || "";
}

function getActiveVolume(project = getActiveProject()) {
  if (!project) return null;
  project.volumes = normalizeVolumeRecords(project.volumes, project.volumeOutline);
  project.activeVolumeId = resolveActiveVolumeId(project.volumes, project.activeVolumeId || "");
  return project.volumes.find((volume) => volume.id === project.activeVolumeId) || project.volumes[0] || null;
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

function syncActiveVolumeOutline(project = getActiveProject()) {
  const volume = getActiveVolume(project);
  project.volumeOutline = composeVolumeOutlineText(volume);
  const field = $("volumeOutline");
  if (field) field.value = project.volumeOutline || "";
  return volume;
}

function ensureActiveVolume(project = getActiveProject()) {
  if (!project) return null;
  let volume = getActiveVolume(project);
  if (volume) return volume;
  project.volumes = normalizeVolumeRecords(project.volumes, "");
  volume = createVolumeEntity({ title: "当前卷", status: "在写" }, project.volumes.length);
  project.volumes.push(volume);
  project.activeVolumeId = volume.id;
  syncActiveVolumeOutline(project);
  return volume;
}

function applyPlainVolumeOutlineToActiveVolume(text) {
  const value = String(text || "").trim();
  if (!value) return null;
  const project = getActiveProject();
  const volume = ensureActiveVolume(project);
  if (!volume) return null;
  volume.outline = value;
  volume.updatedAt = Date.now();
  project.activeVolumeId = volume.id;
  project.volumeOutline = composeVolumeOutlineText(volume);
  if ($("volumeOutline")) $("volumeOutline").value = project.volumeOutline;
  return volume;
}

function buildActiveVolumeContext(project = getActiveProject()) {
  const volume = syncActiveVolumeOutline(project);
  if (!volume) {
    return {
      id: "",
      title: "",
      status: "",
      chapterRange: "",
      summary: "",
      outline: "",
      content: "",
      keyChars: "",
      keyHooks: "",
      notes: "",
      composed: "",
    };
  }

  return {
    id: volume.id,
    title: volume.title,
    status: volume.status,
    chapterRange: volume.chapterRange,
    summary: volume.summary,
    outline: volume.outline,
    content: volume.content,
    keyChars: volume.keyChars,
    keyHooks: volume.keyHooks,
    notes: volume.notes,
    composed: composeVolumeOutlineText(volume),
  };
}

function splitNonEmptyLines(text) {
  return String(text || "")
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function mergeUniqueLineBlocks(...blocks) {
  const seen = new Set();
  const merged = [];
  blocks.forEach((block) => {
    splitNonEmptyLines(block).forEach((line) => {
      const key = line.replace(/\s+/g, " ").trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push(line);
    });
  });
  return merged.join("\n");
}

function extractChapterRangeBounds(text) {
  const numbers = String(text || "").match(/\d+/g);
  if (!numbers?.length) return null;
  const values = numbers.map((item) => Number(item)).filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return null;
  return {
    start: Math.min(...values),
    end: Math.max(...values),
  };
}

function formatChapterRange(start, end) {
  if (!start && !end) return "";
  if (!end || start === end) return `第${start || end}章`;
  return `第${start}章-第${end}章`;
}

function mergeChapterRange(existingRange, chapterNumber) {
  const existing = extractChapterRangeBounds(existingRange);
  if (!chapterNumber) {
    if (!existing) return "";
    return formatChapterRange(existing.start, existing.end);
  }
  if (!existing) return formatChapterRange(chapterNumber, chapterNumber);
  return formatChapterRange(Math.min(existing.start, chapterNumber), Math.max(existing.end, chapterNumber));
}

function buildVolumeCardFromAnalysis(analysis = {}, fallback = {}) {
  const volumeInput = analysis.activeVolume || {};
  return {
    title: String(volumeInput.title || fallback.title || "").trim(),
    status: String(volumeInput.status || fallback.status || "").trim(),
    chapterRange: String(volumeInput.chapterRange || fallback.chapterRange || "").trim(),
    summary: String(volumeInput.summary || analysis.volumeSummary || fallback.summary || "").trim(),
    outline: String(volumeInput.outline || analysis.volumeOutline || fallback.outline || "").trim(),
    content: String(volumeInput.content || fallback.content || "").trim(),
    keyChars: String(volumeInput.keyChars || fallback.keyChars || "").trim(),
    keyHooks: String(volumeInput.keyHooks || analysis.hooks || fallback.keyHooks || "").trim(),
    notes: String(volumeInput.notes || fallback.notes || "").trim(),
  };
}

function updateActiveVolumeFromController(analysis = {}) {
  const project = getActiveProject();
  const volume = ensureActiveVolume(project);
  if (!project || !volume) return null;

  const next = buildVolumeCardFromAnalysis(analysis, volume);
  if (next.title) volume.title = next.title;
  if (next.status) volume.status = next.status;
  if (next.chapterRange) volume.chapterRange = next.chapterRange;
  if (next.summary) volume.summary = next.summary;
  if (next.outline) volume.outline = next.outline;
  if (next.content) volume.content = next.content;
  if (next.keyChars) volume.keyChars = mergeUniqueLineBlocks(volume.keyChars, next.keyChars);
  if (next.keyHooks) volume.keyHooks = mergeUniqueLineBlocks(volume.keyHooks, next.keyHooks);
  if (next.notes) volume.notes = next.notes;

  volume.updatedAt = Date.now();
  project.activeVolumeId = volume.id;
  syncActiveVolumeOutline(project);
  return volume;
}

function isVolumeCompletionStatus(status) {
  return /(完成|已完成|完结|卷终|终卷|收束完成|已收束)/.test(String(status || "").trim());
}

function hasVolumeClosingSignal(...parts) {
  return /(卷末|收束|完成|已完成|完结|终卷|进入下一卷|切卷|转入下一卷|阶段结束)/.test(parts.map((part) => String(part || "")).join("\n"));
}

function getVolumeCompletionReview(project = getActiveProject(), analysis = null, chapter = null) {
  const activeVolume = getActiveVolume(project);
  const volumeUpdate = analysis?.activeVolume || {};
  const statusText = [activeVolume?.status, volumeUpdate.status].filter(Boolean).join(" / ");
  const chapterNumber = getChapterNumberFromEntity(chapter)
    || getChapterNumberFromEntity(project?.chapters?.find((item) => item.id === activeChapterId))
    || getChapterNumberFromEntity(project?.chapters?.[0]);
  const range = extractChapterRangeBounds(volumeUpdate.chapterRange || activeVolume?.chapterRange || "");
  const reviewText = [
    statusText,
    volumeUpdate.summary,
    volumeUpdate.outline,
    volumeUpdate.content,
    activeVolume?.summary,
    activeVolume?.outline,
    activeVolume?.content,
    analysis?.volumeSummary,
    analysis?.phaseSummary,
    analysis?.chapterGoal,
  ].join("\n");

  const signals = [];
  let score = 0;
  const explicitCompleted = analysis?.volumeCompleted === true || isVolumeCompletionStatus(statusText);

  if (explicitCompleted) {
    score += 70;
    signals.push("模型或卷状态已明确标记当前卷完成");
  }
  if (analysis?.switchToNextVolume === true) {
    score += 20;
    signals.push("模型建议切换到下一卷");
  }
  if (range?.end && chapterNumber && chapterNumber >= range.end) {
    score += 25;
    signals.push(`当前章节已到达卷章节范围末端：第${chapterNumber}章 / 目标第${range.end}章`);
  }
  if (hasVolumeClosingSignal(reviewText)) {
    score += 20;
    signals.push("卷摘要或阶段摘要出现收束/切卷信号");
  }
  if (/(已回收|回收完成|主线钩子已落地)/.test(String(volumeUpdate.keyHooks || activeVolume?.keyHooks || analysis?.foreshadowLedger || ""))) {
    score += 10;
    signals.push("关键钩子出现回收完成信号");
  }
  if (/(未回收|待回收|未触发|待触发|待确认|继续推进)/.test(String(volumeUpdate.keyHooks || activeVolume?.keyHooks || analysis?.foreshadowLedger || ""))) {
    score -= 10;
    signals.push("仍存在待触发或待回收钩子");
  }

  score = Math.max(0, Math.min(100, score));
  const reachedPlannedEnd = Boolean(range?.end && chapterNumber && chapterNumber >= range.end);
  const closingSignal = hasVolumeClosingSignal(reviewText);
  const completed = explicitCompleted || (score >= 75 && reachedPlannedEnd && closingSignal);

  return {
    score,
    completed,
    explicitCompleted,
    reachedPlannedEnd,
    closingSignal,
    chapterNumber,
    rangeEnd: range?.end || null,
    signals: signals.length ? signals : ["未检测到明确切卷信号，继续当前卷。"],
  };
}

function isCurrentVolumeCompleted(project = getActiveProject(), analysis = null, chapter = null) {
  return getVolumeCompletionReview(project, analysis, chapter).completed;
}

function formatVolumeCompletionReview(review) {
  return [
    `### 卷完成度：${review.score}/100`,
    review.completed ? "**结论：当前卷可以收束 / 切卷。**" : "**结论：当前卷继续推进。**",
    "",
    ...review.signals.map((item) => `- ${item}`),
  ].join("\n");
}

function advanceToNextVolume(project = getActiveProject(), options = {}) {
  if (!project) return null;
  const current = getActiveVolume(project);
  if (!current) return null;

  current.status = options.currentStatus || "完成";
  current.updatedAt = Date.now();

  const list = normalizeVolumeRecords(project.volumes, project.volumeOutline);
  project.volumes = list;
  const currentIndex = list.findIndex((volume) => volume.id === current.id);
  let nextVolume = currentIndex >= 0 ? list[currentIndex + 1] : null;

  if (!nextVolume && String(options.nextVolumeTitle || "").trim()) {
    nextVolume = createVolumeEntity({
      title: String(options.nextVolumeTitle).trim(),
      status: "在写",
      summary: String(options.nextVolumeSummary || "").trim(),
      outline: String(options.nextVolumeOutline || "").trim(),
    }, list.length);
    list.push(nextVolume);
  }

  if (nextVolume) {
    nextVolume.status = nextVolume.status || "在写";
    nextVolume.updatedAt = Date.now();
    project.activeVolumeId = nextVolume.id;
    syncActiveVolumeOutline(project);
    return nextVolume;
  }

  syncActiveVolumeOutline(project);
  return current;
}

function createDefaultSkillToggles() {
  return Object.fromEntries(
    Object.entries(ROLE_SKILL_STACKS).map(([role, skillNames]) => [
      role,
      Object.fromEntries(skillNames.map((skillName) => [skillName, true])),
    ]),
  );
}

function normalizeSkillToggles(input = {}) {
  const defaults = createDefaultSkillToggles();
  const next = {};

  Object.entries(defaults).forEach(([role, defaultSkills]) => {
    const source = input?.[role] || {};
    next[role] = {};
    Object.keys(defaultSkills).forEach((skillName) => {
      next[role][skillName] = source[skillName] !== false;
    });
  });

  return next;
}

function normalizeControllerArchive(input = []) {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry, index) => ({
      id: entry?.id || `controller-archive-${index}-${Math.random().toString(16).slice(2)}`,
      title: String(entry?.title || "主控归档").trim() || "主控归档",
      content: String(entry?.content || "").trim(),
      createdAt: Number(entry?.createdAt || 0),
      sourceCount: Number(entry?.sourceCount || 0),
    }))
    .filter((entry) => entry.content);
}

function createChapterVersionSnapshot(content, note = "当前稿", createdAt = Date.now()) {
  return {
    id: `chapter-version-${createdAt}-${Math.random().toString(16).slice(2)}`,
    content: String(content || "").trim(),
    note: String(note || "当前稿").trim() || "当前稿",
    createdAt,
  };
}

function getChapterStatusLabel(status = "") {
  const value = String(status || "").trim();
  if (!value) return CHAPTER_STATUS.PLANNING;
  return value;
}

function setChapterStatus(chapter, status) {
  if (!chapter) return;
  chapter.status = getChapterStatusLabel(status);
  chapter.updatedAt = Date.now();
}

function normalizeChapterVersions(input = [], currentContent = "", updatedAt = Date.now()) {
  const normalized = Array.isArray(input)
    ? input
        .map((entry, index) => ({
          id: entry?.id || `chapter-version-${updatedAt}-${index}-${Math.random().toString(16).slice(2)}`,
          content: String(entry?.content || "").trim(),
          note: String(entry?.note || "历史稿").trim() || "历史稿",
          createdAt: Number(entry?.createdAt || updatedAt),
        }))
        .filter((entry) => entry.content)
    : [];

  if (!normalized.length && String(currentContent || "").trim()) {
    normalized.push(createChapterVersionSnapshot(currentContent, "当前稿", updatedAt));
  }

  if (normalized.length && String(currentContent || "").trim() && normalized[0].content !== String(currentContent || "").trim()) {
    normalized.unshift(createChapterVersionSnapshot(currentContent, "当前稿", updatedAt));
  }

  return normalized.slice(0, 12);
}

function normalizeChapterEntity(chapter = {}, index = 0) {
  const now = Date.now() + index;
  const content = String(chapter.content || "").trim();
  const createdAt = Number(chapter.createdAt || now);
  const updatedAt = Number(chapter.updatedAt || createdAt || now);
  const explicitStatus = String(chapter.status || "").trim();
  return {
    id: chapter.id || `chapter-${createdAt}-${Math.random().toString(16).slice(2)}`,
    status: explicitStatus || (content ? CHAPTER_STATUS.DRAFTING : CHAPTER_STATUS.PLANNING),
    title: repairKnownUiText(String(chapter.title || `第${index + 1}章 正文草稿`).trim() || `第${index + 1}章 正文草稿`),
    content,
    summary: String(chapter.summary || "").trim(),
    goal: String(chapter.goal || "").trim(),
    hooksSnapshot: String(chapter.hooksSnapshot || "").trim(),
    volumeId: String(chapter.volumeId || "").trim(),
    volumeTitle: String(chapter.volumeTitle || "").trim(),
    createdAt,
    updatedAt,
    versions: normalizeChapterVersions(chapter.versions, content, updatedAt),
  };
}

function createProject(title = "未命名新书", seed = {}) {
  const now = Date.now();
  const volumes = normalizeVolumeRecords(seed.volumes, seed.volumeOutline || "");
  return {
    id: createId(),
    title,
    bible: seed.bible || "",
    styleGuide: seed.styleGuide || "",
    styleDistillationReport: seed.styleDistillationReport || "",
    styleReferenceTitle: seed.styleReferenceTitle || "",
    styleDistilledAt: seed.styleDistilledAt || 0,
    codex: seed.codex || "",
    outline: seed.outline || "",
    volumeOutline: seed.volumeOutline || "",
    hooks: seed.hooks || "",
    foreshadowLedger: seed.foreshadowLedger || "",
    volumeSummary: seed.volumeSummary || "",
    phaseSummary: seed.phaseSummary || "",
    characterStateTable: seed.characterStateTable || "",
    foreshadowTimeline: seed.foreshadowTimeline || "",
    chapterSummaries: seed.chapterSummaries || "",
    chapterGoal: seed.chapterGoal || "",
    controllerDraft: seed.controllerDraft || "",
    controllerMessages: Array.isArray(seed.controllerMessages) ? seed.controllerMessages : [],
    controllerArchive: normalizeControllerArchive(seed.controllerArchive),
    controllerMemory: String(seed.controllerMemory || "").trim(),
    controllerMemoryUpdatedAt: Number(seed.controllerMemoryUpdatedAt || 0),
    characterCards: Array.isArray(seed.characterCards) ? seed.characterCards : [],
    hookItems: Array.isArray(seed.hookItems) ? seed.hookItems : [],
    workflowOutputHtml: seed.workflowOutputHtml || emptyOutputHtml,
    workflowRunMode: normalizeWorkflowRunMode(seed.workflowRunMode),
    workflowRunState: normalizeWorkflowRunState(seed.workflowRunState),
    lastQualityReport: seed.lastQualityReport ? normalizeQualityReport(seed.lastQualityReport) : null,
    skillToggles: normalizeSkillToggles(seed.skillToggles),
    volumes,
    activeVolumeId: resolveActiveVolumeId(volumes, seed.activeVolumeId || ""),
    chapters: Array.isArray(seed.chapters) ? seed.chapters.map((item, index) => normalizeChapterEntity(item, index)) : [],
    activeChapterId: seed.activeChapterId || "",
    createdAt: now,
    updatedAt: now,
  };
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function isWorkspaceMirror(workspace) {
  return workspace?.__type === WORKSPACE_MIRROR_SCHEMA;
}

function clonePlainData(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildWorkspaceMirror(workspace) {
  return {
    __type: WORKSPACE_MIRROR_SCHEMA,
    activeProjectId: workspace?.activeProjectId || "",
    mockMode: workspace?.mockMode ?? defaultValues.mockMode,
    workspaceUpdatedAt: getWorkspaceUpdatedAt(workspace),
    global: clonePlainData(workspace?.global || {}),
    projects: (workspace?.projects || []).map((project) => ({
      id: project.id,
      title: project.title,
      updatedAt: project.updatedAt,
      activeVolumeId: project.activeVolumeId || "",
      volumeCount: Array.isArray(project.volumes) ? project.volumes.length : 0,
      activeChapterId: project.activeChapterId || "",
      chapterCount: Array.isArray(project.chapters) ? project.chapters.length : 0,
    })),
  };
}

function getWorkspaceUpdatedAt(workspace) {
  if (!workspace || typeof workspace !== "object") return 0;
  const projectTimes = Array.isArray(workspace.projects)
    ? workspace.projects.map((project) => Number(project?.updatedAt || 0))
    : [];
  return Math.max(
    Number(workspace.workspaceUpdatedAt || 0),
    Number(workspace.legacyImportedAt || 0),
    0,
    ...projectTimes,
  );
}

function choosePreferredWorkspace(serverWorkspace, localWorkspace) {
  const serverTime = getWorkspaceUpdatedAt(serverWorkspace);
  const localTime = getWorkspaceUpdatedAt(localWorkspace);
  if (!serverTime && localWorkspace?.projects?.length) return localWorkspace;
  if (!localTime && serverWorkspace?.projects?.length) return serverWorkspace;
  return localTime > serverTime ? localWorkspace : serverWorkspace;
}

function workspaceApiUrl() {
  if (location.protocol === "file:") return "http://localhost:8788/api/workspace";
  return new URL("/api/workspace", location.origin).toString();
}

function projectChaptersApiUrl(projectId) {
  if (location.protocol === "file:") return `http://localhost:8788/api/projects/${encodeURIComponent(projectId)}/chapters`;
  return new URL(`/api/projects/${encodeURIComponent(projectId)}/chapters`, location.origin).toString();
}

function projectChapterItemApiUrl(projectId, chapterId) {
  if (location.protocol === "file:") return `http://localhost:8788/api/projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}`;
  return new URL(`/api/projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}`, location.origin).toString();
}

function projectActiveChapterApiUrl(projectId) {
  if (location.protocol === "file:") return `http://localhost:8788/api/projects/${encodeURIComponent(projectId)}/active-chapter`;
  return new URL(`/api/projects/${encodeURIComponent(projectId)}/active-chapter`, location.origin).toString();
}

function projectChapterWritebackApiUrl(projectId) {
  if (location.protocol === "file:") return `http://localhost:8788/api/projects/${encodeURIComponent(projectId)}/chapter-writeback`;
  return new URL(`/api/projects/${encodeURIComponent(projectId)}/chapter-writeback`, location.origin).toString();
}

function projectVolumeStudioApiUrl(projectId) {
  if (location.protocol === "file:") return `http://localhost:8788/api/projects/${encodeURIComponent(projectId)}/volume-studio`;
  return new URL(`/api/projects/${encodeURIComponent(projectId)}/volume-studio`, location.origin).toString();
}

function projectPlanningContextApiUrl(projectId, recentChapterLimit = 6) {
  const pathname = `/api/projects/${encodeURIComponent(projectId)}/planning-context?recentChapterLimit=${encodeURIComponent(recentChapterLimit)}`;
  if (location.protocol === "file:") return `http://localhost:8788${pathname}`;
  return new URL(pathname, location.origin).toString();
}

function projectControllerStateApiUrl(projectId) {
  if (location.protocol === "file:") return `http://localhost:8788/api/projects/${encodeURIComponent(projectId)}/controller-state`;
  return new URL(`/api/projects/${encodeURIComponent(projectId)}/controller-state`, location.origin).toString();
}

function projectControllerMessagesApiUrl(projectId) {
  if (location.protocol === "file:") return `http://localhost:8788/api/projects/${encodeURIComponent(projectId)}/controller-messages`;
  return new URL(`/api/projects/${encodeURIComponent(projectId)}/controller-messages`, location.origin).toString();
}

function projectKnowledgeStateApiUrl(projectId) {
  if (location.protocol === "file:") return `http://localhost:8788/api/projects/${encodeURIComponent(projectId)}/knowledge-state`;
  return new URL(`/api/projects/${encodeURIComponent(projectId)}/knowledge-state`, location.origin).toString();
}

async function fetchWorkspaceFromServer() {
  if (!(location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    return null;
  }

  const response = await fetch(workspaceApiUrl(), { method: "GET" });
  if (!response.ok) {
    throw new Error(await response.text());
  }

  const data = await response.json();
  return data?.workspace || null;
}

async function saveWorkspaceToServer(workspace) {
  if (!(location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    return false;
  }

  const response = await fetch(workspaceApiUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace }),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return true;
}

async function fetchProjectChaptersFromServer(projectId) {
  if (!(location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    return null;
  }
  const response = await fetch(projectChaptersApiUrl(projectId), { method: "GET" });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

async function saveProjectChapterToServer(projectId, chapter, activeChapter = "") {
  if (!(location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    return null;
  }
  const response = await fetch(projectChapterItemApiUrl(projectId, chapter.id), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chapter, activeChapterId: activeChapter || chapter.id }),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

async function deleteProjectChapterFromServer(projectId, chapterId) {
  if (!(location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    return null;
  }
  const response = await fetch(projectChapterItemApiUrl(projectId, chapterId), { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

async function saveProjectActiveChapterToServer(projectId, chapterId) {
  if (!(location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    return null;
  }
  const response = await fetch(projectActiveChapterApiUrl(projectId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activeChapterId: chapterId }),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

async function writebackProjectMemoryToServer(projectId, payload) {
  if (!(location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    return null;
  }
  const response = await fetch(projectChapterWritebackApiUrl(projectId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

async function fetchProjectPlanningContextFromServer(projectId, recentChapterLimit = 6) {
  if (!(location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    return null;
  }
  const response = await fetch(projectPlanningContextApiUrl(projectId, recentChapterLimit), { method: "GET" });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

async function fetchProjectVolumeStudioFromServer(projectId) {
  if (!(location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    return null;
  }
  const response = await fetch(projectVolumeStudioApiUrl(projectId), { method: "GET" });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

async function fetchProjectControllerStateFromServer(projectId) {
  if (!(location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    return null;
  }
  const response = await fetch(projectControllerStateApiUrl(projectId), { method: "GET" });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

async function appendProjectControllerMessageToServer(projectId, message) {
  if (!(location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    return null;
  }
  const response = await fetch(projectControllerMessagesApiUrl(projectId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

async function clearProjectControllerMessagesOnServer(projectId) {
  if (!(location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    return null;
  }
  const response = await fetch(projectControllerMessagesApiUrl(projectId), { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

async function saveProjectControllerStateToServer(projectId, payload) {
  if (!(location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    return null;
  }
  const response = await fetch(projectControllerStateApiUrl(projectId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

async function saveProjectKnowledgeStateToServer(projectId, payload) {
  if (!(location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    return null;
  }
  const response = await fetch(projectKnowledgeStateApiUrl(projectId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

async function deleteWorkspaceOnServer() {
  if (!(location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    return;
  }

  const response = await fetch(workspaceApiUrl(), { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

function migrateLegacyWorkspace() {
  const legacy = readJson(LEGACY_STORAGE_KEY) || {};
  const project = createProjectFromLegacy(legacy, "我的第一本书");

  return {
    global: Object.fromEntries(fields.map((id) => [id, legacy[id] || defaultValues[id] || ""])),
    mockMode: legacy.mockMode ?? defaultValues.mockMode,
    activeProjectId: project.id,
    projects: [project],
    legacyImportSignature: getLegacySignature(legacy),
    legacyImportedAt: Date.now(),
  };
}

function createProjectFromLegacy(legacy, title = "旧数据导入") {
  const chapters = Array.isArray(legacy.chapters) ? legacy.chapters : extractChaptersFromLegacyOutput(legacy);
  const project = createProject(title, {
    bible: legacy.bible || "",
    codex: legacy.codex || "",
    outline: legacy.outline || "",
    volumeOutline: legacy.volumeOutline || "",
    hooks: legacy.hooks || "",
    foreshadowLedger: legacy.foreshadowLedger || "",
    chapterSummaries: legacy.chapterSummaries || "",
    chapterGoal: legacy.chapterGoal || "",
    controllerDraft: legacy.controllerDraft || "",
    controllerMessages: legacy.controllerMessages || [],
    workflowOutputHtml: legacy.workflowOutputHtml || legacy.outputHtml || legacy.output || emptyOutputHtml,
    chapters,
  });

  project.legacySignature = getLegacySignature(legacy);
  return project;
}

function extractChaptersFromLegacyOutput(legacy) {
  const html = legacy.workflowOutputHtml || legacy.outputHtml || legacy.output || "";
  if (!html || typeof DOMParser === "undefined") return [];

  const doc = new DOMParser().parseFromString(html, "text/html");
  const sections = [...doc.querySelectorAll(".output-section")];
  const now = Date.now();
  const chapters = [];

  sections.forEach((section, index) => {
    const title = section.querySelector("h2")?.textContent?.trim() || "";
    if (!normalizeOutputTitle(title).includes("正文草稿")) return;
    const content = section.querySelector(".output-section-content")?.innerText?.trim()
      || section.innerText.replace(title, "").trim();
    if (!content) return;
    chapters.push({
      id: `chapter-${now}-${index}-${Math.random().toString(16).slice(2)}`,
      title: `旧数据：${normalizeOutputTitle(title)}`,
      content,
      summary: "",
      goal: legacy.chapterGoal || "",
      hooksSnapshot: legacy.hooks || "",
      createdAt: now + index,
      updatedAt: now + index,
    });
  });

  return chapters.reverse();
}

function getLegacySignature(legacy) {
  return [
    legacy.bible,
    legacy.codex,
    legacy.outline,
    legacy.volumeOutline,
    legacy.hooks,
    legacy.foreshadowLedger,
    legacy.chapterSummaries,
    legacy.chapterGoal,
    legacy.workflowOutputHtml || legacy.outputHtml || legacy.output,
    JSON.stringify(legacy.controllerMessages || []),
  ].map((value) => String(value || "").length).join(":");
}

function hasLegacyProjectData(legacy) {
  if (!legacy || typeof legacy !== "object") return false;
  return Boolean(
    legacy.bible
    || legacy.codex
    || legacy.outline
    || legacy.volumeOutline
    || legacy.hooks
    || legacy.foreshadowLedger
    || legacy.chapterSummaries
    || legacy.chapterGoal
    || legacy.workflowOutputHtml
    || legacy.outputHtml
    || legacy.output
    || (Array.isArray(legacy.controllerMessages) && legacy.controllerMessages.length)
  );
}

function normalizeWorkspace(workspace) {
  workspace.global ||= {};
  workspace.workspaceUpdatedAt = getWorkspaceUpdatedAt(workspace);
  workspace.projects = (workspace.projects || []).map((project) => {
    const volumes = normalizeVolumeRecords(project.volumes, project.volumeOutline);
    return {
      ...createProject(project.title || "未命名新书"),
      ...project,
      volumes,
      activeVolumeId: resolveActiveVolumeId(volumes, project.activeVolumeId || ""),
      chapters: Array.isArray(project.chapters) ? project.chapters.map((item, index) => normalizeChapterEntity(item, index)) : [],
      controllerMessages: Array.isArray(project.controllerMessages) ? project.controllerMessages : [],
      controllerArchive: normalizeControllerArchive(project.controllerArchive),
      controllerMemory: String(project.controllerMemory || "").trim(),
      controllerMemoryUpdatedAt: Number(project.controllerMemoryUpdatedAt || 0),
      characterCards: Array.isArray(project.characterCards) ? project.characterCards : [],
      hookItems: Array.isArray(project.hookItems) ? project.hookItems : [],
      workflowRunMode: normalizeWorkflowRunMode(project.workflowRunMode),
      workflowRunState: normalizeWorkflowRunState(project.workflowRunState),
      lastQualityReport: project.lastQualityReport ? normalizeQualityReport(project.lastQualityReport) : null,
    };
  });
  return workspace;
}

function applyChapterPayloadToProject(project, payload = {}) {
  if (!project || !payload) return project;
  project.chapters = Array.isArray(payload.chapters)
    ? payload.chapters.map((item, index) => normalizeChapterEntity(item, index))
    : [];
  project.activeChapterId = String(payload.activeChapterId || project.activeChapterId || project.chapters?.[0]?.id || "").trim();
  if (project.id === activeProjectId) {
    activeChapterId = project.activeChapterId;
  }
  project.updatedAt = Math.max(Number(payload.updatedAt || 0), Number(project.updatedAt || 0), Date.now());
  return project;
}

function applyVolumeStudioPayloadToProject(project, payload = {}) {
  if (!project || !payload) return project;
  if (payload.project && typeof payload.project === "object") {
    project.title = String(payload.project.title || project.title || "").trim() || project.title;
    project.outline = String(payload.project.outline || payload.project.outline_text || project.outline || "").trim();
    project.activeVolumeId = String(payload.project.activeVolumeId || payload.project.active_volume_id || project.activeVolumeId || "").trim();
    project.volumeOutline = String(payload.project.volumeOutline || payload.project.volume_outline || project.volumeOutline || "").trim();
    project.updatedAt = Math.max(Number(payload.project.updatedAt || payload.project.updated_at || 0), Number(project.updatedAt || 0), Date.now());
  }
  if (Array.isArray(payload.volumes)) {
    project.volumes = normalizeVolumeRecords(payload.volumes, project.volumeOutline);
  }
  project.activeVolumeId = resolveActiveVolumeId(project.volumes || [], project.activeVolumeId || "");
  syncActiveVolumeOutline(project);
  return project;
}

function applyControllerStateToProject(project, payload = {}) {
  if (!project || !payload) return project;
  project.controllerMessages = Array.isArray(payload.messages) ? payload.messages : project.controllerMessages || [];
  project.controllerArchive = normalizeControllerArchive(payload.archives || project.controllerArchive || []);
  project.controllerMemory = String(payload.memory ?? project.controllerMemory ?? "").trim();
  project.controllerMemoryUpdatedAt = Number(payload.memoryUpdatedAt ?? project.controllerMemoryUpdatedAt ?? 0);
  project.controllerDraft = String(payload.draft ?? project.controllerDraft ?? "");
  project.characterCards = Array.isArray(payload.characterCards) ? payload.characterCards : project.characterCards || [];
  project.hookItems = Array.isArray(payload.hookItems) ? payload.hookItems : project.hookItems || [];
  project.updatedAt = Math.max(Number(payload.updatedAt || 0), Number(project.updatedAt || 0), Date.now());
  if (project.id === activeProjectId) {
    controllerMessages = Array.isArray(project.controllerMessages) ? project.controllerMessages : [];
  }
  return project;
}

function applyKnowledgeStatePayload(project, payload = {}) {
  if (!project || !payload) return project;
  applyControllerStateToProject(project, payload);
  const memoryFields = payload.memoryFields || {};
  if (memoryFields.characterStateTable !== undefined) {
    project.characterStateTable = String(memoryFields.characterStateTable || "");
    if (project.id === activeProjectId && $("characterStateTable")) $("characterStateTable").value = project.characterStateTable;
  }
  if (memoryFields.hooks !== undefined) {
    project.hooks = String(memoryFields.hooks || "");
    if (project.id === activeProjectId && $("hooks")) $("hooks").value = project.hooks;
  }
  if (memoryFields.foreshadowLedger !== undefined) {
    project.foreshadowLedger = String(memoryFields.foreshadowLedger || "");
    if (project.id === activeProjectId && $("foreshadowLedger")) $("foreshadowLedger").value = project.foreshadowLedger;
  }
  if (memoryFields.foreshadowTimeline !== undefined) {
    project.foreshadowTimeline = String(memoryFields.foreshadowTimeline || "");
    if (project.id === activeProjectId && $("foreshadowTimeline")) $("foreshadowTimeline").value = project.foreshadowTimeline;
  }
  return project;
}

async function syncProjectChaptersFromServer(projectId = activeProjectId, { render = true } = {}) {
  try {
    const payload = await fetchProjectChaptersFromServer(projectId);
    const project = appState?.projects?.find((item) => item.id === projectId);
    if (!project) return null;
    applyChapterPayloadToProject(project, payload);
    if (render && projectId === activeProjectId) {
      renderChapterLibrary();
    }
    return payload;
  } catch (error) {
    console.warn("Failed to sync chapters from local server:", error);
    return null;
  }
}

async function syncProjectControllerStateFromServer(projectId = activeProjectId, { render = true } = {}) {
  try {
    const payload = await fetchProjectControllerStateFromServer(projectId);
    const project = appState?.projects?.find((item) => item.id === projectId);
    if (!project) return null;
    applyControllerStateToProject(project, payload);
    if (render && projectId === activeProjectId) {
      controllerMessages = Array.isArray(project.controllerMessages) ? project.controllerMessages : [];
      renderControllerMessages();
      renderControllerMemoryPanel();
      renderKnowledgePanels();
      renderWorkflowRail();
    }
    return payload;
  } catch (error) {
    console.warn("Failed to sync controller state from local server:", error);
    return null;
  }
}

async function syncProjectVolumeStudioFromServer(projectId = activeProjectId, { render = true } = {}) {
  try {
    const payload = await fetchProjectVolumeStudioFromServer(projectId);
    const project = appState?.projects?.find((item) => item.id === projectId);
    if (!project || !payload) return null;
    applyVolumeStudioPayloadToProject(project, payload);
    if (render && projectId === activeProjectId) {
      const activeVolume = getActiveVolume(project);
      if (activeVolume?.summary) {
        project.volumeSummary = activeVolume.summary;
      }
      $("projectTitle").value = project.title || $("projectTitle").value;
      $("outline").value = project.outline || $("outline").value;
      $("volumeOutline").value = project.volumeOutline || "";
      if (activeVolume?.summary && $("volumeSummary")) $("volumeSummary").value = activeVolume.summary;
      renderProjectList();
      updateVolumeStudioLink();
      renderWorkflowRail();
      renderProjectDashboard();
    }
    return payload;
  } catch (error) {
    console.warn("Failed to sync volume studio from local server:", error);
    return null;
  }
}

async function syncActiveProjectVolumeStudioIfNeeded(force = false) {
  const project = getActiveProject();
  if (!project?.id) return null;
  if (!force && document.visibilityState === "hidden") return null;
  return syncProjectVolumeStudioFromServer(project.id, { render: true });
}

function importLegacyIntoWorkspace(workspace) {
  const legacy = readJson(LEGACY_STORAGE_KEY);
  if (!legacy) return workspace;

  fields.forEach((id) => {
    if (!workspace.global?.[id] && legacy[id]) {
      workspace.global[id] = legacy[id];
    }
  });
  if (workspace.mockMode === undefined && legacy.mockMode !== undefined) {
    workspace.mockMode = legacy.mockMode;
  }

  if (!hasLegacyProjectData(legacy)) return workspace;

  const signature = getLegacySignature(legacy);
  const alreadyImported = workspace.legacyImportSignature === signature
    || workspace.projects?.some((project) => project.legacySignature === signature);
  if (alreadyImported) return workspace;

  const project = createProjectFromLegacy(legacy, "旧数据导入");
  workspace.projects.unshift(project);
  workspace.activeProjectId = project.id;
  workspace.legacyImportSignature = signature;
  workspace.legacyImportedAt = Date.now();
  return workspace;
}

async function readWorkspace() {
  const localWorkspace = readJson(STORAGE_KEY);
  try {
    const serverWorkspace = await fetchWorkspaceFromServer();
    if (serverWorkspace?.projects?.length) {
      if (localWorkspace?.projects?.length && !isWorkspaceMirror(localWorkspace)) {
        return importLegacyIntoWorkspace(
          normalizeWorkspace(
            choosePreferredWorkspace(serverWorkspace, localWorkspace),
          ),
        );
      }
      return importLegacyIntoWorkspace(normalizeWorkspace(serverWorkspace));
    }
  } catch (error) {
    console.warn("Failed to read workspace from local server:", error);
  }

  const workspace = localWorkspace;
  if (workspace?.projects?.length && !isWorkspaceMirror(workspace)) {
    return importLegacyIntoWorkspace(normalizeWorkspace(workspace));
  }
  return migrateLegacyWorkspace();
}

async function persistWorkspaceSnapshot(workspace) {
  const snapshot = clonePlainData(workspace);
  snapshot.workspaceUpdatedAt = Date.now();

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(buildWorkspaceMirror(snapshot)));
    } catch (mirrorError) {
      console.error("Workspace local save failed:", mirrorError);
    }
    console.error("Workspace primary local save failed:", error);
  }

  try {
    const savedToServer = await saveWorkspaceToServer(snapshot);
    if (savedToServer) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      return true;
    }
  } catch (error) {
    console.warn("Failed to write workspace to local server:", error);
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    return false;
  } catch (error) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildWorkspaceMirror(snapshot)));
    console.error("Workspace fallback save failed:", error);
    return false;
  }
}

function writeWorkspace() {
  if (!appState) return Promise.resolve(false);
  const snapshot = clonePlainData(appState);
  workspaceWriteChain = workspaceWriteChain
    .catch(() => {})
    .then(() => persistWorkspaceSnapshot(snapshot));
  return workspaceWriteChain;
}

function collectGlobalData() {
  return Object.fromEntries(fields.map((id) => [id, $(id).value.trim()]));
}

function getActiveProject() {
  return appState.projects.find((project) => project.id === activeProjectId) || appState.projects[0];
}

function getProjectSkillToggles(project = getActiveProject()) {
  if (!project) return createDefaultSkillToggles();
  project.skillToggles = normalizeSkillToggles(project?.skillToggles);
  return project.skillToggles;
}

function getEnabledRoleSkills(role, project = getActiveProject()) {
  const toggles = getProjectSkillToggles(project);
  return (ROLE_SKILL_STACKS[role] || []).filter((skillName) => toggles?.[role]?.[skillName] !== false);
}

function toggleProjectSkill(role, skillName, enabled) {
  const project = getActiveProject();
  const toggles = getProjectSkillToggles(project);
  if (!toggles[role] || !(skillName in toggles[role])) return;

  toggles[role][skillName] = Boolean(enabled);
  project.updatedAt = Date.now();
  renderSkillRoleList();
  renderProjectList();
  schedulePersist();
}

function getSkillUsageRoles(skillName, project = getActiveProject()) {
  const toggles = getProjectSkillToggles(project);
  return Object.entries(ROLE_SKILL_STACKS)
    .filter(([role, skillNames]) => skillNames.includes(skillName) && toggles?.[role]?.[skillName] !== false)
    .map(([role]) => ROLE_DISPLAY_META[role]?.label || role);
}

function stripSkillHeading(content) {
  return String(content || "").replace(/^#\s+.+?\n+/, "");
}

function getDefaultSkillName() {
  return Object.values(ROLE_SKILL_STACKS).flat()[0] || "";
}

function renderSkillDetailPanel() {
  const titleEl = $("skillDetailTitle");
  const metaEl = $("skillDetailMeta");
  const bodyEl = $("skillDetailBody");
  if (!titleEl || !metaEl || !bodyEl) return;

  if (!activeSkillName) {
    titleEl.textContent = "查看 Skill";
    metaEl.textContent = "点击左侧 skill 查看它的完整功能说明。";
    bodyEl.innerHTML = `<div class="skill-detail-empty">选择一个 skill 后，这里会显示完整说明和使用约束。</div>`;
    return;
  }

  const meta = SKILL_DISPLAY_META[activeSkillName] || { label: activeSkillName, hint: "" };
  const usageRoles = getSkillUsageRoles(activeSkillName);
  titleEl.textContent = meta.label;
  metaEl.textContent = [meta.hint, usageRoles.length ? `当前启用：${usageRoles.join("、")}` : "当前项目未启用该 skill"]
    .filter(Boolean)
    .join(" · ");

  if (activeSkillLoading) {
    bodyEl.innerHTML = `<div class="skill-detail-empty">正在读取 ${meta.label} ...</div>`;
    return;
  }

  if (activeSkillError) {
    bodyEl.innerHTML = `<div class="skill-detail-error">${activeSkillError}</div>`;
    return;
  }

  const content = stripSkillHeading(activeSkillContent);
  bodyEl.innerHTML = DOMPurify.sanitize(marked.parse(content || "当前 skill 没有内容。"));
}

async function showSkillDetail(skillName) {
  const normalized = String(skillName || "").trim();
  if (!normalized) return;
  if (normalized === activeSkillName && activeSkillLoading) return;
  if (normalized === activeSkillName && activeSkillContent && !activeSkillError) {
    renderSkillDetailPanel();
    return;
  }

  activeSkillName = normalized;
  activeSkillError = "";
  activeSkillLoading = true;
  renderSkillRoleList();

  const requestId = ++activeSkillRequestId;
  try {
    const content = await loadProjectSkill(normalized);
    if (requestId !== activeSkillRequestId) return;
    activeSkillContent = content || "";
    activeSkillError = content ? "" : "没有读取到这个 skill 的内容。";
  } catch (error) {
    if (requestId !== activeSkillRequestId) return;
    activeSkillContent = "";
    activeSkillError = error.message || "读取 skill 失败。";
  } finally {
    if (requestId !== activeSkillRequestId) return;
    activeSkillLoading = false;
    renderSkillRoleList();
  }
}

function ensureSkillDetailSelection() {
  const allSkillNames = [...new Set(Object.values(ROLE_SKILL_STACKS).flat())];
  if (activeSkillName && allSkillNames.includes(activeSkillName)) {
    renderSkillDetailPanel();
    return;
  }
  showSkillDetail(getDefaultSkillName());
}

function renderSkillToggleSummary() {
  const summary = $("skillToggleSummary");
  const project = getActiveProject();
  if (!summary || !project) return;

  const toggles = getProjectSkillToggles(project);
  let enabled = 0;
  let total = 0;

  Object.entries(ROLE_SKILL_STACKS).forEach(([role, skillNames]) => {
    skillNames.forEach((skillName) => {
      total += 1;
      if (toggles?.[role]?.[skillName] !== false) enabled += 1;
    });
  });

  summary.textContent = `当前项目已启用 ${enabled} / ${total} 个辅助能力`;
}

function toggleSkillRoleCard(role) {
  if (expandedSkillRoles.has(role)) {
    expandedSkillRoles.delete(role);
  } else {
    expandedSkillRoles.add(role);
  }
  renderSkillRoleList();
}

function resetProjectSkillToggles() {
  const project = getActiveProject();
  project.skillToggles = createDefaultSkillToggles();
  project.updatedAt = Date.now();
  renderSkillRoleList();
  renderProjectList();
  persistConfig();
  setStatus("已恢复本项目 Skill 默认开关", "done");
}

function syncModalBodyLock() {
  const hasOpenModal = $("skillModal")?.classList.contains("open")
    || $("styleDistillModal")?.classList.contains("open");
  document.body.classList.toggle("modal-open", Boolean(hasOpenModal));
}

function toggleSkillModal(open) {
  const modal = $("skillModal");
  if (!modal) return;

  if (open && !expandedSkillRoles.size) {
    expandedSkillRoles.add("controller");
  }
  modal.classList.toggle("open", open);
  modal.setAttribute("aria-hidden", String(!open));
  syncModalBodyLock();
  if (open) {
    ensureSkillDetailSelection();
  }
}

function toggleStyleDistillModal(open) {
  const modal = $("styleDistillModal");
  if (!modal) return;
  modal.classList.toggle("open", open);
  modal.setAttribute("aria-hidden", String(!open));
  syncModalBodyLock();
}

function saveActiveProject() {
  if (!appState || !activeProjectId) return;
  const project = ensureControllerProjectState(getActiveProject());
  if (!project) return;
  syncActiveVolumeOutline(project);

  project.title = $("projectTitle")?.value.trim() || project.title || "未命名新书";
  project.bible = $("bible")?.value.trim() || "";
  project.styleGuide = $("styleGuide")?.value.trim() || "";
  project.styleReferenceTitle = $("styleReferenceTitle")?.value.trim() || project.styleReferenceTitle || "";
  project.codex = $("codex")?.value.trim() || "";
  project.outline = $("outline")?.value.trim() || "";
  project.volumeOutline = composeVolumeOutlineText(getActiveVolume(project));
  project.hooks = $("hooks")?.value.trim() || "";
  project.foreshadowLedger = $("foreshadowLedger")?.value.trim() || "";
  project.volumeSummary = $("volumeSummary")?.value.trim() || "";
  project.phaseSummary = $("phaseSummary")?.value.trim() || "";
  project.characterStateTable = $("characterStateTable")?.value.trim() || "";
  project.foreshadowTimeline = $("foreshadowTimeline")?.value.trim() || "";
  project.chapterSummaries = $("chapterSummaries")?.value.trim() || "";
  project.chapterGoal = $("chapterGoal")?.value.trim() || "";
  project.controllerDraft = $("controllerInput")?.value || "";
  project.controllerMessages = controllerMessages;
  project.controllerArchive = normalizeControllerArchive(project.controllerArchive);
  project.controllerMemory = String(project.controllerMemory || "").trim();
  project.controllerMemoryUpdatedAt = Number(project.controllerMemoryUpdatedAt || 0);
  $("workflowOutput")?.querySelectorAll("[data-bound]").forEach((el) => el.removeAttribute("data-bound"));
  project.workflowOutputHtml = $("workflowOutput")?.innerHTML || emptyOutputHtml;
  project.workflowRunMode = normalizeWorkflowRunMode($("workflowRunMode")?.value || project.workflowRunMode);
  project.workflowRunState = normalizeWorkflowRunState(project.workflowRunState);
  project.lastQualityReport = project.lastQualityReport ? normalizeQualityReport(project.lastQualityReport) : null;
  project.skillToggles = getProjectSkillToggles(project);
  project.activeChapterId = activeChapterId;
  project.updatedAt = Date.now();
  appState.global = collectGlobalData();
  appState.mockMode = $("mockMode").checked;
  appState.activeProjectId = activeProjectId;
}

function persistConfig() {
  saveActiveProject();
  writeWorkspace();
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => persistConfig(), 300);
}

function applyGlobalConfig() {
  const saved = appState.global || {};
  fields.forEach((id) => {
    const el = $(id);
    if (el) el.value = saved[id] || defaultValues[id] || "";
  });
  $("mockMode").checked = appState.mockMode ?? defaultValues.mockMode;
}

function renderProjectList() {
  const list = $("projectList");
  list.innerHTML = "";
  $("projectCount").textContent = `${appState.projects.length} 本书`;

  appState.projects.forEach((project) => {
    const button = document.createElement("button");
    button.className = `project-item ${project.id === activeProjectId ? "active" : ""}`;
    button.dataset.projectId = project.id;
    button.innerHTML = DOMPurify.sanitize(`
      <span class="project-item-title">${project.title || "未命名新书"}</span>
      <span class="project-item-meta">${new Date(project.updatedAt || Date.now()).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
    `);
    button.addEventListener("click", () => switchProject(project.id));
    list.appendChild(button);
  });
}

function formatCompactNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  if (number >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1)}万`;
  return String(number);
}

function parseVolumeChapterRangeTarget(rangeText) {
  const text = String(rangeText || "");
  const range = text.match(/(\d+)\s*[-~—至到]\s*(\d+)/);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      return end - start + 1;
    }
  }
  const total = text.match(/(\d+)\s*[章回]/);
  return total ? Number(total[1]) : 0;
}

function isOpenHookStatus(statusText) {
  const text = String(statusText || "").trim();
  if (!text) return true;
  if (/(已回收|已解决|^完成$|关闭|废弃|作废|不用|无效)/.test(text)) return false;
  return /(未触发|已触发|待回收|推进|延后|打开|未解|悬而未决|进行中)/.test(text) || true;
}

function countOpenHooks(project = getActiveProject()) {
  const items = Array.isArray(project?.hookItems) ? project.hookItems : [];
  if (items.length) {
    return items.filter((item) => isOpenHookStatus(item.status || item.statusText || item.rawLine)).length;
  }

  const text = [$("hooks")?.value, $("foreshadowLedger")?.value, $("foreshadowTimeline")?.value]
    .filter(Boolean)
    .join("\n");
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && isOpenHookStatus(line)).length;
}

function buildProjectDashboard(project = getActiveProject()) {
  project = project || {};
  const chapters = Array.isArray(project.chapters) ? project.chapters : [];
  const activeVolume = getActiveVolume(project);
  const volumeChapters = activeVolume
    ? chapters.filter((chapter) => chapter.volumeId === activeVolume.id || chapter.volumeTitle === activeVolume.title)
    : [];
  const targetChapterCount = parseVolumeChapterRangeTarget(activeVolume?.chapterRange || "");
  const currentVolumeCount = volumeChapters.length || chapters.filter((chapter) => !chapter.volumeId && !chapter.volumeTitle).length;
  const totalChars = chapters.reduce((sum, chapter) => sum + String(chapter.content || "").replace(/\s/g, "").length, 0);
  const latestChapter = chapters
    .slice()
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0];
  const state = normalizeWorkflowRunState(project.workflowRunState);
  const quality = project.lastQualityReport ? normalizeQualityReport(project.lastQualityReport) : null;
  const riskCount = Array.isArray(state.memoryPack?.riskSignals) ? state.memoryPack.riskSignals.length : 0;

  return {
    totalChars,
    chapterCount: chapters.length,
    latestChapter,
    activeVolume,
    currentVolumeCount,
    targetChapterCount,
    openHooks: countOpenHooks(project),
    characterCount: Array.isArray(project.characterCards) ? project.characterCards.length : 0,
    quality,
    workflowState: state,
    riskCount,
  };
}

function setMetricState(id, stateClass = "") {
  const metric = $(id)?.closest(".dashboard-metric");
  if (!metric) return;
  metric.classList.remove("warning", "danger");
  if (stateClass) metric.classList.add(stateClass);
}

function formatWorkflowStateLabel(status) {
  const value = String(status || "");
  if (value === "running") return "运行中";
  if (value === "completed") return "完成";
  if (value === "failed") return "失败";
  if (value === "stopped") return "已停止";
  if (value === "ready") return "可续跑";
  return "未运行";
}

function renderProjectDashboard() {
  if (!$("projectDashboardGrid")) return;
  const dashboard = buildProjectDashboard();
  const mode = normalizeWorkflowRunMode($("workflowRunMode")?.value || dashboard.workflowState.mode);
  const modeLabel = WORKFLOW_RUN_MODES[mode]?.label || "标准";
  const volumeTitle = dashboard.activeVolume?.title || "未设置当前卷";
  const volumeProgress = dashboard.targetChapterCount
    ? `${dashboard.currentVolumeCount}/${dashboard.targetChapterCount}`
    : `${dashboard.currentVolumeCount || dashboard.chapterCount}章`;
  const qualityScore = dashboard.quality?.overall || 0;
  const qualityLabel = qualityScore ? `${qualityScore}` : "--";
  const qualityState = qualityScore && qualityScore < WORKFLOW_RUN_MODES[mode].qualityThreshold ? "warning" : "";
  const runState = formatWorkflowStateLabel(dashboard.workflowState.status);
  const runStateClass = dashboard.workflowState.status === "failed" ? "danger" : dashboard.workflowState.status === "stopped" ? "warning" : "";

  $("dashTotalChars").textContent = formatCompactNumber(dashboard.totalChars);
  $("dashTotalCharsMeta").textContent = dashboard.totalChars ? "正文章节库累计" : "正文库暂无内容";
  $("dashChapterCount").textContent = String(dashboard.chapterCount);
  $("dashChapterMeta").textContent = dashboard.latestChapter ? dashboard.latestChapter.title : "暂无章节";
  $("dashVolumeProgress").textContent = volumeProgress;
  $("dashVolumeMeta").textContent = dashboard.targetChapterCount ? volumeTitle : `${volumeTitle}，未设范围`;
  $("dashOpenHooks").textContent = String(dashboard.openHooks);
  $("dashHookMeta").textContent = dashboard.openHooks ? "需要后续回收或推进" : "暂无打开钩子";
  $("dashCharacterCount").textContent = String(dashboard.characterCount);
  $("dashCharacterMeta").textContent = dashboard.characterCount ? "人物档案已结构化" : "待沉淀人物档案";
  $("dashQualityScore").textContent = qualityLabel;
  $("dashQualityMeta").textContent = qualityScore ? `最近一次：${dashboard.quality.majorIssues?.[0] || "无重大硬伤"}` : "尚未评分";
  $("dashRunState").textContent = runState;
  $("dashRunMeta").textContent = `${modeLabel}模式${dashboard.workflowState.failedStepId ? ` · 卡在 ${dashboard.workflowState.failedStepId}` : ""}`;
  $("dashRiskCount").textContent = String(dashboard.riskCount);
  $("dashRiskMeta").textContent = dashboard.riskCount ? "本章记忆包有风险提示" : "未发现记忆包风险";
  $("dashboardUpdatedAt").textContent = dashboard.workflowState.updatedAt
    ? new Date(dashboard.workflowState.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "未运行";

  setMetricState("dashQualityScore", qualityState);
  setMetricState("dashRunState", runStateClass);
  setMetricState("dashRiskCount", dashboard.riskCount ? "warning" : "");
}

function canResumeWorkflow(project = getActiveProject()) {
  const state = normalizeWorkflowRunState(project?.workflowRunState);
  return Boolean(state.runId && ["failed", "stopped"].includes(state.status) && state.sourceContext);
}

function renderResumeWorkflowState() {
  const btn = $("resumeWorkflow");
  if (!btn) return;
  const project = getActiveProject();
  const state = normalizeWorkflowRunState(project?.workflowRunState);
  const ready = canResumeWorkflow(project);
  btn.disabled = !ready || Boolean(currentAbortController);
  btn.classList.toggle("resume-ready", ready);
  btn.textContent = ready ? `续跑${state.failedStepId ? ` ${state.failedStepId}` : ""}` : "续跑";
  renderProjectDashboard();
}

function updateVolumeStudioLink() {
  const link = $("openVolumeStudio");
  if (!link) return;
  link.href = `./volumes.html?project=${encodeURIComponent(activeProjectId || getActiveProject()?.id || "")}`;
}

function renderSkillRoleList() {
  const root = $("skillRoleList");
  const project = getActiveProject();
  if (!root || !project) return;

  renderSkillToggleSummary();
  renderSkillDetailPanel();
  const toggles = getProjectSkillToggles(project);
  root.innerHTML = "";

  Object.entries(ROLE_SKILL_STACKS).forEach(([role, skillNames]) => {
    const enabledCount = skillNames.filter((skillName) => toggles?.[role]?.[skillName] !== false).length;
    const roleMeta = ROLE_DISPLAY_META[role] || { label: role, hint: "" };
    const isExpanded = expandedSkillRoles.has(role);

    const card = document.createElement("section");
    card.className = `skill-role-card ${isExpanded ? "" : "collapsed"}`.trim();
    card.innerHTML = DOMPurify.sanitize(`
      <div class="skill-role-header">
        <button class="skill-role-toggle" type="button" aria-expanded="${isExpanded ? "true" : "false"}">
          <div class="skill-role-copy">
            <strong>${roleMeta.label}</strong>
            <span>${roleMeta.hint}</span>
          </div>
          <div class="skill-role-meta">
            <span class="skill-role-count">${enabledCount} / ${skillNames.length}</span>
            <span class="skill-role-chevron" aria-hidden="true">鈱?/span>
          </div>
        </button>
      </div>
      <div class="skill-role-body">
        <div class="skill-toggle-list"></div>
      </div>
    `);

    card.querySelector(".skill-role-toggle").addEventListener("click", () => {
      toggleSkillRoleCard(role);
    });

    const list = card.querySelector(".skill-toggle-list");
    skillNames.forEach((skillName) => {
      const meta = SKILL_DISPLAY_META[skillName] || { label: skillName, hint: "" };
      const row = document.createElement("div");
      row.className = `skill-toggle-item ${activeSkillName === skillName ? "selected" : ""}`.trim();
      row.innerHTML = DOMPurify.sanitize(`
        <button class="skill-toggle-view" type="button" aria-pressed="${activeSkillName === skillName ? "true" : "false"}">
          <div class="skill-toggle-copy">
            <strong>${meta.label}</strong>
            <span>${meta.hint}</span>
          </div>
        </button>
        <span class="skill-toggle-control">
          <input type="checkbox" ${toggles?.[role]?.[skillName] !== false ? "checked" : ""} />
        </span>
      `);
      row.querySelector(".skill-toggle-view").addEventListener("click", () => {
        showSkillDetail(skillName);
      });
      row.querySelector("input").addEventListener("change", (event) => {
        toggleProjectSkill(role, skillName, event.target.checked);
      });
      list.appendChild(row);
    });

    root.appendChild(card);
  });
}

function renderActiveProject() {
  const project = ensureControllerProjectState(getActiveProject());
  clearWorkflowFlowOverrides();
  activeProjectId = project.id;
  syncActiveVolumeOutline(project);
  $("projectTitle").value = project.title || "未命名新书";
  $("bible").value = project.bible || "";
  $("styleGuide").value = project.styleGuide || "";
  $("styleReferenceTitle").value = project.styleReferenceTitle || "";
  $("codex").value = project.codex || "";
  $("outline").value = project.outline || "";
  $("volumeOutline").value = project.volumeOutline || "";
  $("hooks").value = project.hooks || "";
  $("foreshadowLedger").value = project.foreshadowLedger || "";
  $("volumeSummary").value = project.volumeSummary || "";
  $("phaseSummary").value = project.phaseSummary || "";
  $("characterStateTable").value = project.characterStateTable || "";
  $("foreshadowTimeline").value = project.foreshadowTimeline || "";
  $("chapterSummaries").value = project.chapterSummaries || "";
  $("chapterGoal").value = project.chapterGoal || "";
  $("controllerInput").value = project.controllerDraft || "";
  $("workflowOutput").innerHTML = project.workflowOutputHtml || emptyOutputHtml;
  if ($("workflowRunMode")) $("workflowRunMode").value = normalizeWorkflowRunMode(project.workflowRunMode);
  activeChapterId = project.activeChapterId || project.chapters?.[0]?.id || "";
  controllerMessages = Array.isArray(project.controllerMessages) ? project.controllerMessages : [];
  uploadedStyleSourceText = "";
  uploadedStyleSourceName = "";
  uploadedStyleSourceEncoding = "";
  $("styleSourceFile").value = "";
  $("styleSourceText").value = "";
  $("styleDistillFocus").value = "";
  renderControllerMessages();
  renderControllerMemoryPanel();
  renderKnowledgePanels();
  renderProjectList();
  updateVolumeStudioLink();
  renderSkillRoleList();
  renderChapterLibrary();
  renderProjectDashboard();
  renderResumeWorkflowState();
  updateStyleSourceStatus();
  updateStyleGuideMeta();
  renderStyleDistillPreview(project.styleDistillationReport || "");
  normalizeOutputSections();
  renderWorkflowRail();
  syncCollapseButtonLabel();
  syncProjectVolumeStudioFromServer(project.id, { render: true });
  syncProjectChaptersFromServer(project.id, { render: true });
  syncProjectControllerStateFromServer(project.id, { render: true });
}

async function switchProject(projectId) {
  if (currentAbortController) {
    alert("当前请求还在运行，请先停止或等待完成后再切换书籍。");
    return;
  }
  if (projectId === activeProjectId) return;
  persistConfig();
  activeProjectId = projectId;
  appState.activeProjectId = projectId;
  renderActiveProject();
  await syncProjectVolumeStudioFromServer(projectId, { render: true });
  await syncProjectChaptersFromServer(projectId, { render: true });
  await syncProjectControllerStateFromServer(projectId, { render: true });
  writeWorkspace();
  setStatus("已切换书籍", "done");
}

function loadConfig() {
  return (async () => {
    appState = await readWorkspace();
    if (!appState.projects.length) {
      const project = createProject("我的第一本书");
      appState.projects = [project];
      appState.activeProjectId = project.id;
    }
    activeProjectId = appState.activeProjectId || appState.projects[0].id;
    applyGlobalConfig();
    renderActiveProject();
    await syncProjectVolumeStudioFromServer(activeProjectId, { render: true });
    await syncProjectChaptersFromServer(activeProjectId, { render: true });
    await syncProjectControllerStateFromServer(activeProjectId, { render: true });
    await writeWorkspace();
  })();
}

function saveConfig() {
  persistConfig();
  toggleDrawer(false);
  setStatus("配置已保存", "done");
}

async function resetConfig() {
  if (!confirm("确定要恢复默认配置并清空所有书籍吗？")) return;
  try {
    await deleteWorkspaceOnServer();
  } catch (error) {
    console.warn("Failed to delete workspace from local server:", error);
  }
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  controllerMessages = [];
  appState = null;
  activeProjectId = "";
  await loadConfig();
  setStatus("已重置", "done");
}

function createNewProject() {
  persistConfig();
  const title = prompt("新书名", `新书 ${appState.projects.length + 1}`)?.trim() || `新书 ${appState.projects.length + 1}`;
  const project = createProject(title);
  appState.projects.unshift(project);
  activeProjectId = project.id;
  appState.activeProjectId = project.id;
  renderActiveProject();
  persistConfig();
  setStatus("已新建本书", "done");
}

function deleteActiveProject() {
  if (appState.projects.length <= 1) {
    alert("至少保留一本书。");
    return;
  }

  const project = getActiveProject();
  if (!confirm(`确定删除《${project.title || "未命名新书"}》吗？这只会删除本地记录。`)) return;

  appState.projects = appState.projects.filter((item) => item.id !== project.id);
  activeProjectId = appState.projects[0].id;
  appState.activeProjectId = activeProjectId;
  renderActiveProject();
  persistConfig();
  setStatus("已删除本书", "done");
}

function recordChapterVersion(chapter, content, note = "当前稿") {
  const text = String(content || "").trim();
  if (!text) return;
  chapter.versions = normalizeChapterVersions(chapter.versions, chapter.content || text, chapter.updatedAt || Date.now());
  const latest = chapter.versions?.[0];
  if (latest && latest.content === text) {
    latest.note = note || latest.note || "当前稿";
    latest.createdAt = Date.now();
  } else {
    chapter.versions.unshift(createChapterVersionSnapshot(text, note, Date.now()));
    chapter.versions = chapter.versions.slice(0, 12);
  }
}

function getChapterNumberFromEntity(chapter) {
  if (!chapter) return null;
  return parseChapterNumber(`${chapter.title || ""}\n${chapter.goal || ""}`);
}

function buildChapterDraftLabel(project = getActiveProject(), goalText = $("chapterGoal").value.trim(), fallbackNumber = (project.chapters?.length || 0) + 1) {
  const explicitNumber = parseChapterNumber(goalText);
  return explicitNumber ? `第${explicitNumber}章` : `第${fallbackNumber}章`;
}

function promoteChapter(project, chapterId) {
  if (!Array.isArray(project?.chapters)) return;
  const index = project.chapters.findIndex((item) => item.id === chapterId);
  if (index <= 0) return;
  const [chapter] = project.chapters.splice(index, 1);
  project.chapters.unshift(chapter);
}

function findMatchingChapterForGoal(project = getActiveProject(), goalText = $("chapterGoal").value.trim()) {
  const chapters = Array.isArray(project?.chapters) ? project.chapters : [];
  const normalizedGoal = String(goalText || "").trim();
  const goalNumber = parseChapterNumber(normalizedGoal);

  if (goalNumber) {
    const byNumber = chapters.find((chapter) => getChapterNumberFromEntity(chapter) === goalNumber);
    if (byNumber) return byNumber;
  }

  if (normalizedGoal) {
    return chapters.find((chapter) => String(chapter.goal || "").trim() === normalizedGoal) || null;
  }

  return null;
}

function applyDraftToChapter(chapter, content, { summary, note = "覆盖更新", syncPlanningState = false } = {}) {
  const text = String(content || "").trim();
  if (!chapter || !text) return;

  const project = getActiveProject();
  const volume = getActiveVolume(project);
  if (String(chapter.content || "").trim() !== text) {
    recordChapterVersion(chapter, text, note);
  }

  chapter.content = text;
  if (summary !== undefined) {
    chapter.summary = String(summary || "").trim();
  }
  if (syncPlanningState) {
    chapter.goal = $("chapterGoal").value.trim() || chapter.goal;
    chapter.hooksSnapshot = $("hooks").value.trim() || chapter.hooksSnapshot;
  }
  if (!chapter.volumeId && volume) {
    chapter.volumeId = volume.id;
    chapter.volumeTitle = volume.title;
  }
  chapter.updatedAt = Date.now();
  setChapterStatus(chapter, CHAPTER_STATUS.DRAFTING);

  const goalText = syncPlanningState ? chapter.goal || $("chapterGoal").value.trim() : chapter.goal;
  const fallbackNumber = getChapterNumberFromEntity(chapter) || Math.max(1, project.chapters.indexOf(chapter) + 1);
  chapter.title = `${buildChapterDraftLabel(project, goalText, fallbackNumber)} 正文草稿`;
  promoteChapter(project, chapter.id);
}

function createChapterFromDraft(content) {
  const project = getActiveProject();
  const volume = getActiveVolume(project);
  const now = Date.now();
  const number = (project.chapters?.length || 0) + 1;
  const label = buildChapterDraftLabel(project, $("chapterGoal").value.trim(), number);

  return normalizeChapterEntity({
    id: `chapter-${now}-${Math.random().toString(16).slice(2)}`,
    status: CHAPTER_STATUS.DRAFTING,
    title: `${label} 正文草稿`,
    content,
    summary: "",
    goal: $("chapterGoal").value.trim(),
    hooksSnapshot: $("hooks").value.trim(),
    volumeId: volume?.id || "",
    volumeTitle: volume?.title || "",
    createdAt: now,
    updatedAt: now,
    versions: [createChapterVersionSnapshot(content, "初稿", now)],
  }, number - 1);
}

function createPlannedChapterFromGoal() {
  const project = getActiveProject();
  const volume = getActiveVolume(project);
  const now = Date.now();
  const number = inferNextChapterNumber(project);
  const label = buildChapterDraftLabel(project, $("chapterGoal").value.trim(), number);
  return normalizeChapterEntity({
    id: `chapter-${now}-${Math.random().toString(16).slice(2)}`,
    status: CHAPTER_STATUS.PLANNING,
    title: `${label} 规划`,
    content: "",
    summary: "",
    goal: $("chapterGoal").value.trim(),
    hooksSnapshot: $("hooks").value.trim(),
    volumeId: volume?.id || "",
    volumeTitle: volume?.title || "",
    createdAt: now,
    updatedAt: now,
    versions: [],
  }, number - 1);
}

async function saveDraftChapter(content) {
  const text = String(content || "").trim();
  if (!text) return;

  const project = getActiveProject();
  if (!Array.isArray(project.chapters)) project.chapters = [];

  const existingChapter = findMatchingChapterForGoal(project);
  if (existingChapter) {
    activeChapterId = existingChapter.id;
    project.activeChapterId = existingChapter.id;
    applyDraftToChapter(existingChapter, text, { note: "工作流覆盖", syncPlanningState: true });
    await saveProjectChapterToServer(project.id, existingChapter, existingChapter.id);
    renderChapterLibrary();
    persistConfig();
    return;
  }

  const chapter = createChapterFromDraft(text);
  project.chapters.unshift(chapter);
  activeChapterId = chapter.id;
  project.activeChapterId = chapter.id;
  await saveProjectChapterToServer(project.id, chapter, chapter.id);
  renderChapterLibrary();
  persistConfig();
}

async function overwriteActiveChapter(content, summary = undefined) {
  const text = String(content || "").trim();
  if (!text) return;

  const project = getActiveProject();
  const chapter = project.chapters?.find((item) => item.id === activeChapterId) || project.chapters?.[0];
  if (!chapter) {
    await saveDraftChapter(text);
    return;
  }

  applyDraftToChapter(chapter, text, { summary, note: summary || "覆盖更新", syncPlanningState: false });
  activeChapterId = chapter.id;
  project.activeChapterId = chapter.id;
  await saveProjectChapterToServer(project.id, chapter, chapter.id);
  renderChapterLibrary();
  persistConfig();
}

function renderChapterLibrary() {
  const project = getActiveProject();
  const chapters = Array.isArray(project.chapters) ? project.chapters.map((item, index) => normalizeChapterEntity(item, index)) : [];
  project.chapters = chapters;
  const list = $("chapterList");
  const reader = $("chapterReader");
  const count = $("chapterCount");
  const copyBtn = $("copyChapter");

  count.textContent = `${chapters.length} 章`;
  list.innerHTML = "";

  if (!chapters.length) {
    activeChapterId = "";
    copyBtn.disabled = true;
    reader.innerHTML = `<div class="empty-state small">
                <p>暂无正文章节</p>
                <span>运行工作流后，正文草稿会自动保存到这里。</span>
              </div>`;
    renderProjectDashboard();
    return;
  }

  if (!chapters.some((chapter) => chapter.id === activeChapterId)) {
    activeChapterId = chapters[0].id;
  }

  chapters.forEach((chapter) => {
    const statusLabel = DOMPurify.sanitize(getChapterStatusLabel(chapter.status));
    const item = document.createElement("div");
    item.className = `chapter-item ${chapter.id === activeChapterId ? "active" : ""}`;
    item.dataset.chapterId = chapter.id;
    item.innerHTML = DOMPurify.sanitize(`
      <button class="chapter-select" type="button">
        <strong>${chapter.title}</strong>
        <span class="chapter-status-badge">${statusLabel}</span>
        <span>${new Date(chapter.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} · ${chapter.versions?.length || 1} 版/span>
      </button>
      <button class="chapter-delete" type="button" title="删除本章">删除</button>
    `);
    item.querySelector(".chapter-select").addEventListener("click", async () => {
      activeChapterId = chapter.id;
      project.activeChapterId = chapter.id;
      await saveProjectActiveChapterToServer(project.id, chapter.id);
      renderChapterLibrary();
      persistConfig();
    });
    item.querySelector(".chapter-delete").addEventListener("click", async () => {
      await deleteChapterById(chapter.id);
    });
    list.appendChild(item);
  });

  const active = chapters.find((chapter) => chapter.id === activeChapterId) || chapters[0];
  copyBtn.disabled = false;
  const versionItems = (active.versions || []).slice(0, 8).map((version) => `
    <div class="chapter-version-item">
      <div class="chapter-version-copy">
        <strong>${version.note || "历史稿"}</strong>
        <span>${new Date(version.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
        <small>${DOMPurify.sanitize((version.content || "").replace(/\n+/g, " ").slice(0, 90))}${(version.content || "").length > 90 ? "..." : ""}</small>
      </div>
      <button class="copy-btn restore-version-btn" type="button" data-version-id="${version.id}">恢复</button>
    </div>
  `).join("");
  reader.innerHTML = DOMPurify.sanitize(`
    <div class="chapter-reader-header">
      <div>
        <h2>${active.title}</h2>
        <div class="chapter-reader-meta-row">
          <span class="chapter-status-badge">${getChapterStatusLabel(active.status)}</span>
        </div>
        <span>${new Date(active.createdAt).toLocaleString("zh-CN")} · 最近更新 ${new Date(active.updatedAt || active.createdAt).toLocaleString("zh-CN")}</span>
      </div>
      <div class="chapter-reader-actions">
        <button id="deleteChapter" class="copy-btn" type="button">删除本章</button>
      </div>
    </div>
    ${active.goal ? `<div class="chapter-meta-block"><strong>章节目标</strong><p>${active.goal}</p></div>` : ""}
    ${active.volumeTitle ? `<div class="chapter-meta-block"><strong>所属分卷</strong><p>${active.volumeTitle}</p></div>` : ""}
    ${active.summary ? `<blockquote>${active.summary}</blockquote>` : ""}
    <div class="chapter-version-panel">
      <div class="chapter-version-header">
        <strong>版本回滚</strong>
        <span>保留最近 ${active.versions?.length || 1} 个版本/span>
      </div>
      <div class="chapter-version-list">
        ${versionItems || `<div class="chapter-version-empty">暂无历史版本</div>`}
      </div>
    </div>
    <div class="chapter-reader-content">
      ${marked.parse(active.content)}
    </div>
  `);
  $("deleteChapter").addEventListener("click", () => {
    deleteActiveChapter().catch((error) => {
      console.error("Failed to delete active chapter:", error);
      setStatus("失败", "");
    });
  });
  reader.querySelectorAll(".restore-version-btn").forEach((button) => {
    button.addEventListener("click", () => {
      restoreChapterVersion(active.id, button.dataset.versionId).catch((error) => {
        console.error("Failed to restore chapter version:", error);
        setStatus("失败", "");
      });
    });
  });
  renderProjectDashboard();
}

async function restoreChapterVersion(chapterId, versionId) {
  const project = getActiveProject();
  const chapter = project.chapters?.find((item) => item.id === chapterId);
  const version = chapter?.versions?.find((item) => item.id === versionId);
  if (!chapter || !version) return;
  if (!confirm(`确定恢复《${version.note || "历史稿"}》吗？当前正文会先保留一个回滚版本。`)) return;

  const currentText = String(chapter.content || "").trim();
  if (currentText && currentText !== version.content) {
    chapter.versions.unshift(createChapterVersionSnapshot(currentText, "回滚前备份", Date.now()));
  }
  chapter.content = version.content;
  recordChapterVersion(chapter, version.content, `恢复：${version.note || "历史稿"}`);
  chapter.updatedAt = Date.now();
  activeChapterId = chapter.id;
  project.activeChapterId = chapter.id;
  await saveProjectChapterToServer(project.id, chapter, chapter.id);
  renderChapterLibrary();
  persistConfig();
  setStatus("已恢复章节版本", "done");
}

async function deleteActiveChapter() {
  await deleteChapterById(activeChapterId);
}

async function deleteChapterById(chapterId) {
  const project = getActiveProject();
  const chapter = project.chapters.find((item) => item.id === chapterId);
  if (!chapter) return;
  if (!confirm(`确定删除《${chapter.title}》吗？`)) return;

  project.chapters = project.chapters.filter((item) => item.id !== chapterId);
  if (activeChapterId === chapterId) {
    activeChapterId = project.chapters[0]?.id || "";
  }
  project.activeChapterId = activeChapterId;
  await deleteProjectChapterFromServer(project.id, chapterId);
  renderChapterLibrary();
  persistConfig();
  setStatus("已删除章节", "done");
}

async function copyActiveChapter() {
  const project = getActiveProject();
  const chapter = project.chapters?.find((item) => item.id === activeChapterId);
  if (!chapter) return;
  await navigator.clipboard.writeText(chapter.content);
  const btn = $("copyChapter");
  btn.textContent = "已复制";
  setTimeout(() => btn.textContent = "复制本章", 1600);
}

async function copyCharacterCards() {
  const project = getActiveProject();
  const text = buildCharacterCardsText(project.characterCards || []);
  if (!text.trim()) return;
  await navigator.clipboard.writeText(text);
  const btn = $("copyCharacterCards");
  if (!btn) return;
  const previous = btn.textContent;
  btn.textContent = "已复制";
  setTimeout(() => btn.textContent = previous, 1600);
}

async function copyHookItems() {
  const project = getActiveProject();
  const text = buildHookItemsText(project.hookItems || []);
  if (!text.trim()) return;
  await navigator.clipboard.writeText(text);
  const btn = $("copyHookItems");
  if (!btn) return;
  const previous = btn.textContent;
  btn.textContent = "已复制";
  setTimeout(() => btn.textContent = previous, 1600);
}

function parseChapterNumber(text) {
  const source = String(text || "");
  const arabic = source.match(/第\s*(\d+)\s*[章节回]/);
  if (arabic) return Number(arabic[1]);

  const cn = source.match(/第\s*([零一二三四五六七八九十百千万]+)\s*[章节回]/);
  if (!cn) return null;
  return chineseNumberToInt(cn[1]);
}

function chineseNumberToInt(text) {
  const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  let result = 0;
  let section = 0;
  let number = 0;

  for (const char of String(text || "")) {
    if (char in digits) {
      number = digits[char];
      continue;
    }

    const unit = units[char];
    if (!unit) return null;

    if (unit === 10000) {
      section += number;
      result += (section || 1) * unit;
      section = 0;
      number = 0;
      continue;
    }

    section += (number || 1) * unit;
    number = 0;
  }

  const total = result + section + number;
  return total > 0 ? total : null;
}

function getReferenceChapter(project = getActiveProject()) {
  const chapters = Array.isArray(project?.chapters) ? project.chapters : [];
  return chapters.find((chapter) => chapter.id === activeChapterId)
    || chapters
      .slice()
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0]
    || null;
}

function inferNextChapterNumber(project = getActiveProject(), referenceChapter = getReferenceChapter(project)) {
  const referenceNumber = getChapterNumberFromEntity(referenceChapter);
  if (referenceNumber) return referenceNumber + 1;

  const numbers = (project.chapters || [])
    .map((chapter) => getChapterNumberFromEntity(chapter))
    .filter(Boolean);

  if (numbers.length) return Math.max(...numbers) + 1;
  return (project.chapters?.length || 0) + 1;
}

function ensurePlanningChapterForCurrentGoal(project = getActiveProject()) {
  if (!project) return null;
  if (!Array.isArray(project.chapters)) project.chapters = [];
  const goalText = $("chapterGoal").value.trim();
  const matched = findMatchingChapterForGoal(project, goalText);
  const volume = getActiveVolume(project);
  const fallbackNumber = inferNextChapterNumber(project);
  if (matched) {
    matched.goal = goalText || matched.goal;
    matched.hooksSnapshot = $("hooks").value.trim() || matched.hooksSnapshot;
    matched.title = `${buildChapterDraftLabel(project, matched.goal, getChapterNumberFromEntity(matched) || fallbackNumber)} 瑙勫垝`;
    if (volume) {
      matched.volumeId = volume.id;
      matched.volumeTitle = volume.title;
    }
    if (!String(matched.content || "").trim()) {
      setChapterStatus(matched, CHAPTER_STATUS.PLANNING);
    }
    promoteChapter(project, matched.id);
    activeChapterId = matched.id;
    project.activeChapterId = matched.id;
    return matched;
  }

  const chapter = createPlannedChapterFromGoal();
  project.chapters.unshift(chapter);
  activeChapterId = chapter.id;
  project.activeChapterId = chapter.id;
  return chapter;
}

function setStatus(text, mode = "") {
  const pill = $("statusPill");
  pill.textContent = text;
  pill.className = `pill ${mode}`;
}

function setStep(name, state) {
  const el = document.querySelector(`[data-step="${name}"]`);
  if (el) {
    el.classList.remove("active", "done");
    if (state === "active") el.classList.add("active");
    if (state === "done") el.classList.add("done");
  }
  setFlowState(name, state);
}

function clearWorkflowFlowOverrides(names = FLOW_SEQUENCE) {
  names.forEach((name) => {
    delete workflowFlowOverrides[name];
  });
}

function collectWorkflowFlowStates() {
  const states = Object.fromEntries(FLOW_SEQUENCE.map((name) => [name, ""]));

  if (controllerMessages.some((message) => message.role === "user" || message.role === "assistant")) {
    states.controller = "done";
  }

  const inputs = getInputs();
  if (inputs.bible || inputs.hooks || inputs.chapterGoal) {
    states.analysis = "done";
  }

  const output = $("workflowOutput");
  if (output && !output.querySelector(".empty-state")) {
    const outputTitles = [...output.querySelectorAll(".output-section h2")]
      .map((item) => normalizeOutputTitle(item.textContent.trim()));
    if (outputTitles.includes("主控 Brief")) states.brief = "done";
    if (outputTitles.some((title) => ["正文草稿", "自动修订版正文", "修订版正文", "微调版正文"].includes(title))) states.draft = "done";
    if (outputTitles.some((title) => ["审稿意见", "复审意见"].includes(title))) states.audit = "done";
    if (outputTitles.includes("状态更新")) states.extract = "done";
  }

  Object.entries(workflowFlowOverrides).forEach(([name, state]) => {
    if (FLOW_SEQUENCE.includes(name)) {
      states[name] = state;
    }
  });

  return states;
}

function updateWorkflowTrackProgress(states) {
  const track = document.querySelector(".workflow-track");
  if (!track) return;

  const nodes = FLOW_SEQUENCE
    .map((name) => document.querySelector(`[data-flow="${name}"]`))
    .filter(Boolean);
  if (!nodes.length) return;

  const activeIndex = FLOW_SEQUENCE.findIndex((name) => states[name] === "active");
  const doneIndices = FLOW_SEQUENCE
    .map((name, index) => (states[name] === "done" ? index : -1))
    .filter((index) => index >= 0);
  const progressIndex = activeIndex >= 0 ? activeIndex : (doneIndices.length ? doneIndices[doneIndices.length - 1] : -1);

  track.classList.toggle("has-active", activeIndex >= 0);
  track.classList.toggle("has-progress", progressIndex >= 0);

  if (progressIndex < 0) {
    track.style.setProperty("--workflow-progress-offset", "0px");
    track.style.setProperty("--workflow-progress-height", "0px");
    return;
  }

  const firstDot = nodes[0].querySelector(".workflow-dot");
  const targetDot = nodes[Math.max(0, progressIndex)]?.querySelector(".workflow-dot");
  if (!firstDot || !targetDot) return;

  const firstCenter = firstDot.offsetTop + firstDot.offsetHeight / 2;
  const targetCenter = targetDot.offsetTop + targetDot.offsetHeight / 2;
  const progressHeight = Math.max(2, targetCenter - firstCenter);

  track.style.setProperty("--workflow-progress-offset", `${Math.round(firstCenter)}px`);
  track.style.setProperty("--workflow-progress-height", `${Math.round(progressHeight)}px`);
}

function applyWorkflowFlowStates(states) {
  FLOW_SEQUENCE.forEach((name, index) => {
    const node = document.querySelector(`[data-flow="${name}"]`);
    if (!node) return;

    const state = states[name] || "";
    node.classList.remove("active", "done", "pending");
    node.classList.add(state || "pending");
    node.style.setProperty("--flow-index", String(index));
  });

  updateWorkflowTrackProgress(states);
}

function resetSteps() {
  document.querySelectorAll(".step-dot").forEach((el) => {
    el.classList.remove("active", "done");
  });
  clearWorkflowFlowOverrides(["brief", "draft", "audit", "extract"]);
  renderWorkflowRail();
}

function setFlowState(name, state) {
  if (!FLOW_SEQUENCE.includes(name)) return;

  if (state) {
    workflowFlowOverrides[name] = state;
  } else {
    delete workflowFlowOverrides[name];
  }

  applyWorkflowFlowStates(collectWorkflowFlowStates());
}

function renderWorkflowRail() {
  applyWorkflowFlowStates(collectWorkflowFlowStates());
}

function toggleOutputSection(section, collapsed) {
  section.classList.toggle("collapsed", collapsed);

  const trigger = section.querySelector(".output-section-trigger");
  const toggle = section.querySelector(".output-section-toggle");
  const expanded = String(!collapsed);

  if (trigger) {
    trigger.setAttribute("aria-expanded", expanded);
  }
  if (toggle) {
    toggle.textContent = collapsed ? OUTPUT_EXPAND_LABEL : OUTPUT_COLLAPSE_LABEL;
    toggle.setAttribute("aria-expanded", expanded);
  }
}

function bindOutputSectionControl(control, section) {
  if (!control || boundOutputControls.has(control)) return;
  boundOutputControls.add(control);
  control.addEventListener("click", (event) => {
    event.preventDefault();
    const collapsed = !section.classList.contains("collapsed");
    toggleOutputSection(section, collapsed);
    syncCollapseButtonLabel();
    persistConfig();
  });
}

function attachOutputSectionToggle(section) {
  const header = section.querySelector(".output-section-header");
  const trigger = section.querySelector(".output-section-trigger");
  const toggle = section.querySelector(".output-section-toggle");
  const actions = section.querySelector(".output-section-actions");
  if (!header || !trigger || !toggle || !actions) return;

  const title = normalizeOutputTitle(section.querySelector("h2")?.textContent.trim() || "");
  if (normalizeOutputTitle(title) === "审稿意见" && !actions.querySelector(".revise-draft-btn")) {
    const reviseBtn = document.createElement("button");
    reviseBtn.className = "copy-btn revise-draft-btn";
    reviseBtn.type = "button";
    reviseBtn.textContent = "按建议修改";
    reviseBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      reviseDraftFromAudit(section);
    });
    actions.insertBefore(reviseBtn, toggle);
  }
  if (["正文草稿", "修订版正文", "微调版正文"].includes(title) && !actions.querySelector(".tune-draft-btn")) {
    const tuneBtn = document.createElement("button");
    tuneBtn.className = "copy-btn tune-draft-btn";
    tuneBtn.type = "button";
    tuneBtn.textContent = "小微调";
    tuneBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      tuneDraftSection(section);
    });
    actions.insertBefore(tuneBtn, toggle);
  }

  bindOutputSectionControl(trigger, section);
  bindOutputSectionControl(toggle, section);
  toggleOutputSection(section, section.classList.contains("collapsed"));
}

function isCanonicalOutputSection(section) {
  const children = [...section.children];
  const [header, content] = children;
  if (children.length !== 2 || !header || !content) return false;
  if (!header.classList.contains("output-section-header") || !content.classList.contains("output-section-content")) {
    return false;
  }
  return Boolean(
    header.querySelector(".output-section-trigger")
    && header.querySelector(".output-section-actions")
    && header.querySelector(".output-section-actions .output-section-toggle")
  );
}

function rebuildLegacySection(section) {
  const titleEl = section.querySelector("h2");
  const title = normalizeOutputTitle(titleEl?.textContent.trim() || "生成内容");
  const rebuilt = createOutputSection(title, section.classList.contains("collapsed"));
  [...section.classList]
    .filter((className) => !["output-section", "collapsed"].includes(className))
    .forEach((className) => rebuilt.section.classList.add(className));

  const directContent = [...section.children].find((node) => node.classList?.contains("output-section-content"));
  const sourceNodes = directContent
    ? [...directContent.childNodes]
    : [...section.childNodes].filter((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return Boolean(node.textContent?.trim());
      const element = node;
      return !element.classList.contains("output-section-header")
        && !element.classList.contains("output-section-actions")
        && !element.classList.contains("output-section-toggle")
        && !element.classList.contains("revise-draft-btn")
        && !element.classList.contains("tune-draft-btn")
        && element.tagName !== "H2";
    });

  rebuilt.contentEl.append(...sourceNodes.map((node) => node.cloneNode(true)));
  return rebuilt.section;
}

function normalizeOutputSections() {
  const output = $("workflowOutput");
  if (!output || output.querySelector(".empty-state")) return;

  const children = [...output.childNodes].filter((node) => {
    return node.nodeType !== Node.TEXT_NODE || node.textContent.trim();
  });
  if (!children.length) return;

  const hasOnlyModernSections = children.every((node) => {
    return node.nodeType === Node.ELEMENT_NODE
      && node.classList.contains("output-section")
      && isCanonicalOutputSection(node);
  });

  if (hasOnlyModernSections) {
    output.querySelectorAll(".output-section").forEach((section) => {
      attachOutputSectionToggle(section);
      toggleOutputSection(section, section.classList.contains("collapsed"));
    });
    return;
  }

  const fragment = document.createDocumentFragment();
  let current = null;

  children.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("output-section")) {
      if (current) {
        fragment.appendChild(current.section);
        current = null;
      }
      fragment.appendChild(rebuildLegacySection(node));
      return;
    }

    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "H2") {
      if (current) fragment.appendChild(current.section);
      current = createOutputSection(normalizeOutputTitle(node.textContent.trim() || "生成内容"), false);
      return;
    }

    if (!current) current = createOutputSection("生成内容", false);
    current.contentEl.appendChild(node);
  });

  if (current) fragment.appendChild(current.section);
  output.innerHTML = "";
  output.appendChild(fragment);
  output.querySelectorAll(".output-section").forEach(attachOutputSectionToggle);
  persistConfig();
}

function setAllOutputSections(collapsed) {
  normalizeOutputSections();
  $("workflowOutput").querySelectorAll(".output-section").forEach((section) => {
    toggleOutputSection(section, collapsed);
  });
  $("collapseOutput").textContent = collapsed ? OUTPUT_EXPAND_ALL_LABEL : OUTPUT_COLLAPSE_ALL_LABEL;
  persistConfig();
}

function syncCollapseButtonLabel() {
  const sections = [...$("workflowOutput").querySelectorAll(".output-section")];
  const allCollapsed = sections.length > 0 && sections.every((section) => section.classList.contains("collapsed"));
  $("collapseOutput").textContent = allCollapsed ? OUTPUT_EXPAND_ALL_LABEL : OUTPUT_COLLAPSE_ALL_LABEL;
}

async function typeWriter(title, body) {
  const output = $("workflowOutput");
  if (output.querySelector(".empty-state")) {
    output.innerHTML = "";
  }

  const { section, contentEl } = createOutputSection(title, normalizeOutputTitle(title) !== "正文草稿");
  output.appendChild(section);

  const words = body.split("");
  let currentText = "";
  const chunkSize = 30;

  for (let i = 0; i < words.length; i += chunkSize) {
    if (workflowAborted) break;
    currentText += words.slice(i, i + chunkSize).join("");
    contentEl.innerHTML = DOMPurify.sanitize(marked.parse(currentText));
    output.scrollTo({ top: output.scrollHeight, behavior: "smooth" });
    schedulePersist();
    await new Promise((r) => setTimeout(r, 15));
  }
  persistConfig();
}

function appendOutput(title, body, type = "") {
  const output = $("workflowOutput");
  if (output.querySelector(".empty-state")) {
    output.innerHTML = "";
  }
  const { section, contentEl } = createOutputSection(title, false);
  if (type) section.classList.add(type);
  contentEl.innerHTML = DOMPurify.sanitize(marked.parse(body));
  output.appendChild(section);
  output.scrollTo({ top: output.scrollHeight, behavior: "smooth" });
  persistConfig();
}

function createOutputSection(title, collapsed = false) {
  title = normalizeOutputTitle(title);
  const section = document.createElement("section");
  section.className = `output-section ${collapsed ? "collapsed" : ""}`.trim();

  const header = document.createElement("div");
  header.className = "output-section-header";

  const trigger = document.createElement("button");
  trigger.className = "output-section-trigger";
  trigger.type = "button";

  const titleEl = document.createElement("h2");
  titleEl.textContent = title;
  trigger.appendChild(titleEl);

  const toggle = document.createElement("button");
  toggle.className = "output-section-toggle";
  toggle.type = "button";

  const actions = document.createElement("div");
  actions.className = "output-section-actions";
  if (normalizeOutputTitle(title) === "审稿意见") {
    const reviseBtn = document.createElement("button");
    reviseBtn.className = "copy-btn revise-draft-btn";
    reviseBtn.type = "button";
    reviseBtn.textContent = "按建议修改";
    reviseBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      reviseDraftFromAudit(section);
    });
    actions.appendChild(reviseBtn);
  }
  if (["正文草稿", "修订版正文", "微调版正文"].includes(title)) {
    const tuneBtn = document.createElement("button");
    tuneBtn.className = "copy-btn tune-draft-btn";
    tuneBtn.type = "button";
    tuneBtn.textContent = "小微调";
    tuneBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      tuneDraftSection(section);
    });
    actions.appendChild(tuneBtn);
  }
  actions.appendChild(toggle);

  header.append(trigger, actions);

  const contentEl = document.createElement("div");
  contentEl.className = "output-section-content";

  section.append(header, contentEl);
  attachOutputSectionToggle(section);
  toggleOutputSection(section, collapsed);
  return { section, contentEl };
}

function findLatestOutputSectionText(title) {
  const sections = [...$("workflowOutput").querySelectorAll(".output-section")].reverse();
  const wantedTitle = normalizeOutputTitle(title);
  const section = sections.find((item) => normalizeOutputTitle(item.querySelector("h2")?.textContent.trim() || "") === wantedTitle);
  return section?.querySelector(".output-section-content")?.innerText.trim() || "";
}

function buildLatestWorkflowSnapshot() {
  const snapshot = {
    latestBrief: findLatestOutputSectionText("主控 Brief"),
    latestAudit: findLatestOutputSectionText("审稿意见"),
    latestStateUpdate: findLatestOutputSectionText("状态更新"),
    latestValidation: findLatestOutputSectionText("批量校名 / 校设定"),
  };

  return Object.fromEntries(
    Object.entries(snapshot)
      .filter(([, value]) => String(value || "").trim())
      .map(([key, value]) => [key, limitTextWindow(value, 3200, 0.32)]),
  );
}

function revisionPrompt() {
  return [
    "你是长篇小说正文修订写手。",
    "根据审稿意见修改正文草稿。",
    "必须保留原章节的主要事件、人物和结尾方向，只修正审稿指出的问题。",
    "必须遵守小说圣经、设定档案、全书大纲、当前卷大纲、章节摘要库、文风账本和本章目标。",
    "必须降低 AI 味：减少解释型旁白、抽象情绪词和模板句式，用动作、场景和台词承载修改。",
    "只输出修订后的完整正文，不要解释修改过程。",
  ].join("\n");
}

function tunePrompt() {
  return [
    "你是长篇小说正文微调写手。",
    "根据作者的微调要求，只修改当前这一章正文。",
    "必须尽量保留原文主线事件、章节目标、人物关系和结尾方向。",
    "不要重写成完全不同的一章，除非作者明确要求。",
    "必须遵守小说圣经、设定档案、全书大纲、当前卷大纲、章节摘要库、文风账本和本章目标。",
    "保持去 AI 味：减少解释型旁白和模板化句式，用动作、场景、台词承载变化。",
    "只输出微调后的完整正文，不要解释修改过程。",
  ].join("\n");
}


async function reviseDraftFromAudit(auditSection) {
  const auditText = auditSection.querySelector(".output-section-content")?.innerText.trim() || "";
  const draftText = findLatestOutputSectionText("正文草稿");
  if (!auditText || !draftText) {
    appendControllerMessage("system", "没有找到可修订的正文草稿或审稿意见。");
    return;
  }

  currentAbortController = new AbortController();
  setControllerBusy(true);
  setStatus("修订正文", "running");

  try {
    validateControllerAccess();
    const context = {
      memory: compactInputsForModel(),
      draftText: limitText(draftText, 18000),
      auditText: limitText(auditText, 10000),
    };
    const result = await callOpenAI({
      model: $("writerModel").value.trim() || $("controllerModel").value.trim(),
      signal: currentAbortController.signal,
      messages: [
        { role: "system", content: await withSkill("writer", revisionPrompt()) },
        { role: "user", content: `请按审稿意见修订正文：\n${JSON.stringify(context, null, 2)}` },
      ],
    });

    appendOutput("修订版正文", result);
    await overwriteActiveChapter(result, "已按审稿意见修订");
    appendControllerMessage("system", "已按审稿意见生成修订版正文，并覆盖当前正文章节。");
    setStatus("修订完成", "done");
  } catch (error) {
    if (error.name === "AbortError") {
      appendControllerMessage("system", "正文修订已停止。");
      setStatus("已停止", "");
    } else {
      appendControllerMessage("system", `正文修订失败：${error.message}`);
      setStatus("失败", "");
    }
  } finally {
    currentAbortController = null;
    setControllerBusy(false);
  }
}

async function tuneDraftSection(section) {
  const originalText = section.querySelector(".output-section-content")?.innerText.trim() || "";
  if (!originalText) {
    appendControllerMessage("system", "没有找到可微调的正文内容。");
    return;
  }

  const instruction = prompt("输入这次小微调要求", "例如：加强主角压迫感，减少解释，补一段对手试探台词，结尾钩子不变。");
  if (!instruction?.trim()) return;

  currentAbortController = new AbortController();
  setControllerBusy(true);
  setStatus("微调正文", "running");

  try {
    validateControllerAccess();
    const context = {
      memory: compactInputsForModel(),
      instruction: instruction.trim(),
      originalText: limitText(originalText, 20000),
    };
    const result = await callOpenAI({
      model: $("writerModel").value.trim() || $("controllerModel").value.trim(),
      signal: currentAbortController.signal,
      messages: [
        { role: "system", content: await withSkill("writer", tunePrompt()) },
        { role: "user", content: `请按微调要求修改本章正文：\n${JSON.stringify(context, null, 2)}` },
      ],
    });

    appendOutput("微调版正文", result);
    await overwriteActiveChapter(result, `微调要求：${instruction.trim()}`);
    appendControllerMessage("system", `已完成正文小微调，并覆盖当前正文章节。\n微调要求：${instruction.trim()}`);
    setStatus("微调完成", "done");
  } catch (error) {
    if (error.name === "AbortError") {
      appendControllerMessage("system", "正文微调已停止。");
      setStatus("已停止", "");
    } else {
      appendControllerMessage("system", `正文微调失败：${error.message}`);
      setStatus("失败", "");
    }
  } finally {
    currentAbortController = null;
    setControllerBusy(false);
  }
}

function auditNeedsRevision(auditText) {
  const text = String(auditText || "").trim();
  if (!text) return false;
  if (/(无明显问题|无需修改|可以通过|通过项[:：]?\s*全部通过)/.test(text) && !/(问题|错误|冲突|不一致|建议|偏离|AI 味|生硬|错名)/.test(text)) {
    return false;
  }
  return /(问题|错误|冲突|不一致|不通过|必须|建议|偏离|AI 味|生硬|错名|称呼错误|逻辑|连续性|需要修改|需修改)/.test(text);
}

function revisionReviewPrompt() {
  return [
    "你是小说复审员。",
    "只检查修订版是否已经处理原审稿意见中的关键问题，是否引入新的错名、设定冲突、逻辑断裂或文风硬伤。",
    "输出 Markdown，结构为：",
    "## 复审结论",
    "## 已修复",
    "## 仍需注意",
    "## 是否可以回写",
  ].join("\n");
}

async function maybeAutoReviseAfterAudit({ mockMode, sourceContext, memoryPack, briefResult, draftResult, auditResult, qualityReport = null, force = false, reason = "" }) {
  if (!AUTO_REVISE_AFTER_AUDIT || (!force && !auditNeedsRevision(auditResult)) || !draftResult || workflowAborted) {
    return null;
  }

  let currentDraft = draftResult;
  let combinedAudit = auditResult;
  let lastRevision = null;
  let lastReview = "";

  for (let pass = 1; pass <= AUTO_REVISE_MAX_PASSES; pass += 1) {
    if (workflowAborted) break;
    setStatus(`自动修订第 ${pass} 轮`, "running");

    const revised = mockMode
      ? `${currentDraft}\n\n【自动修订提示】已根据审稿意见压缩解释、补强场景压力，并保留原本章节走向。`
      : await callOpenAI({
          model: $("writerModel").value.trim() || $("controllerModel").value.trim(),
          signal: currentAbortController.signal,
          temperature: 0.62,
          messages: [
            { role: "system", content: await withSkill("writer", revisionPrompt()) },
            {
              role: "user",
              content: JSON.stringify({
                memoryPack,
                sourceContext: JSON.parse(sourceContext),
                briefResult,
                draftText: limitText(currentDraft, 18000),
                auditText: limitText(combinedAudit, 10000),
                qualityReport,
                instruction: [
                  "这是工作流自动修订。只修审稿和质量评分指出的问题，不另起新章，不改变章节目标和结尾钩子。",
                  reason ? `触发原因：${reason}` : "",
                ].filter(Boolean).join("\n"),
              }, null, 2),
            },
          ],
        });

    const cleanRevised = String(revised || "").trim();
    if (!cleanRevised) break;

    lastRevision = cleanRevised;
    currentDraft = cleanRevised;
    await overwriteActiveChapter(cleanRevised, `自动修订第 ${pass} 轮`);
    await typeWriter(pass === 1 ? "自动修订版正文" : `自动修订版正文 ${pass}`, cleanRevised);

    setStatus(`复审第 ${pass} 轮`, "running");
    lastReview = mockMode
      ? "## 复审结论\n模拟复审通过。\n\n## 已修复\n- 已根据审稿意见做自动修订。\n\n## 仍需注意\n- 真实项目请关闭模拟模式。\n\n## 是否可以回写\n可以回写。"
      : await callGeminiWithOpenAIFallback({
          model: $("geminiModel").value.trim(),
          signal: currentAbortController.signal,
          temperature: 0.25,
          taskLabel: "自动修订复审",
          annotate: true,
          messages: [
            { role: "system", content: revisionReviewPrompt() },
            {
              role: "user",
              content: JSON.stringify({
                memoryPack,
                briefResult,
                originalAudit: auditResult,
                revisedDraft: limitText(cleanRevised, 18000),
              }, null, 2),
            },
          ],
        });

    combinedAudit = [auditResult, `## 自动修订第 ${pass} 轮复审`, lastReview].filter(Boolean).join("\n\n---\n\n");
    await typeWriter(pass === 1 ? "复审意见" : `复审意见 ${pass}`, lastReview);

    if (!auditNeedsRevision(lastReview)) break;
  }

  if (!lastRevision) return null;
  appendControllerMessage("system", "审稿后已自动修订并完成复审，当前正文章节已覆盖为修订版。");
  return {
    draftResult: lastRevision,
    auditResult: combinedAudit,
    reviewResult: lastReview,
  };
}

function getInputs() {
  const activeVolume = buildActiveVolumeContext();
  const project = getActiveProject();
  const structuredCharacters = buildStructuredCharacterNotes(project?.characterCards || []);
  const structuredHooks = buildStructuredHookNotes(project?.hookItems || []);
  return {
    bible: $("bible").value.trim(),
    styleGuide: $("styleGuide").value.trim(),
    codex: mergeStructuredContextBlock($("codex").value.trim(), "结构化角色档案", structuredCharacters),
    outline: $("outline").value.trim(),
    volumeOutline: $("volumeOutline").value.trim(),
    activeVolume,
    hooks: mergeStructuredContextBlock($("hooks").value.trim(), "结构化钩子账本", structuredHooks),
    foreshadowLedger: mergeStructuredContextBlock($("foreshadowLedger").value.trim(), "结构化钩子账本", structuredHooks),
    volumeSummary: $("volumeSummary").value.trim(),
    phaseSummary: $("phaseSummary").value.trim(),
    characterStateTable: mergeStructuredContextBlock($("characterStateTable").value.trim(), "结构化角色档案", structuredCharacters),
    foreshadowTimeline: $("foreshadowTimeline").value.trim(),
    chapterSummaries: $("chapterSummaries").value.trim(),
    chapterGoal: $("chapterGoal").value.trim(),
  };
}

function buildInputsFromPlanningContext(planningContext = null, fallbackInputs = getInputs()) {
  if (!planningContext) return fallbackInputs;
  const memory = planningContext.memory || {};
  const activeVolume = planningContext.activeVolume || fallbackInputs.activeVolume || buildActiveVolumeContext();
  const structuredCharacters = buildStructuredCharacterNotes(planningContext.characterCards || []);
  const structuredHooks = buildStructuredHookNotes(planningContext.hookItems || []);
  return {
    bible: String(memory.bible ?? fallbackInputs.bible ?? "").trim(),
    styleGuide: String(memory.styleGuide ?? fallbackInputs.styleGuide ?? "").trim(),
    codex: mergeStructuredContextBlock(String(memory.codex ?? fallbackInputs.codex ?? "").trim(), "结构化角色档案", structuredCharacters),
    outline: String(memory.outline ?? fallbackInputs.outline ?? "").trim(),
    volumeOutline: String(memory.volumeOutline ?? fallbackInputs.volumeOutline ?? "").trim(),
    activeVolume: {
      id: String(activeVolume.id || fallbackInputs.activeVolume?.id || "").trim(),
      title: String(activeVolume.title || fallbackInputs.activeVolume?.title || "").trim(),
      status: String(activeVolume.status || fallbackInputs.activeVolume?.status || "").trim(),
      chapterRange: String(activeVolume.chapterRange || fallbackInputs.activeVolume?.chapterRange || "").trim(),
      summary: String(activeVolume.summary || fallbackInputs.activeVolume?.summary || "").trim(),
      outline: String(activeVolume.outline || fallbackInputs.activeVolume?.outline || "").trim(),
      content: String(activeVolume.content || fallbackInputs.activeVolume?.content || "").trim(),
      keyChars: String(activeVolume.keyChars || fallbackInputs.activeVolume?.keyChars || "").trim(),
      keyHooks: String(activeVolume.keyHooks || fallbackInputs.activeVolume?.keyHooks || "").trim(),
      notes: String(activeVolume.notes || fallbackInputs.activeVolume?.notes || "").trim(),
    },
    hooks: mergeStructuredContextBlock(String(memory.hooks ?? fallbackInputs.hooks ?? "").trim(), "结构化钩子账本", structuredHooks),
    foreshadowLedger: mergeStructuredContextBlock(String(memory.foreshadowLedger ?? fallbackInputs.foreshadowLedger ?? "").trim(), "结构化钩子账本", structuredHooks),
    volumeSummary: String(memory.volumeSummary ?? fallbackInputs.volumeSummary ?? "").trim(),
    phaseSummary: String(memory.phaseSummary ?? fallbackInputs.phaseSummary ?? "").trim(),
    characterStateTable: mergeStructuredContextBlock(String(memory.characterStateTable ?? fallbackInputs.characterStateTable ?? "").trim(), "结构化角色档案", structuredCharacters),
    foreshadowTimeline: String(memory.foreshadowTimeline ?? fallbackInputs.foreshadowTimeline ?? "").trim(),
    chapterSummaries: String(memory.chapterSummaries ?? fallbackInputs.chapterSummaries ?? "").trim(),
    chapterGoal: String(memory.chapterGoal ?? fallbackInputs.chapterGoal ?? "").trim(),
  };
}

function compactOneLine(text, max = 240) {
  return limitTextWindow(String(text || "").replace(/\s+/g, " ").trim(), max, 0.72);
}

function extractMemoryFocusTerms(text, limit = 36) {
  const stopWords = new Set([
    "本章", "当前", "目标", "需要", "必须", "推进", "主角", "剧情", "章节", "场景", "人物",
    "关系", "钩子", "伏笔", "卷内", "大纲", "结尾", "情绪", "信息", "读者",
  ]);
  return [...new Set((String(text || "").match(/[\u4e00-\u9fa5A-Za-z0-9]{2,18}/g) || [])
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !stopWords.has(item)))]
    .slice(0, limit);
}

function textContainsAny(text, terms = []) {
  const source = String(text || "");
  return terms.some((term) => term && source.includes(term));
}

function isActiveMemoryStatus(statusText) {
  const text = String(statusText || "").trim();
  if (!text) return false;
  if (/(已回收|已解决|^完成$|死亡|离场|废弃|作废|关闭|不用)/.test(text)) return false;
  return /(当前|在场|活跃|未触发|已触发|待回收|推进|延后|未解|打开|进行中|在写|存活)/.test(text);
}

function rankMemoryItems(items, focusText, focusTerms, textBuilder, limit = 10) {
  return items
    .map((item, index) => {
      const text = textBuilder(item);
      const directHit = textContainsAny(text, focusTerms);
      const activeBoost = isActiveMemoryStatus(text) ? 18 : 0;
      const score = relevanceScore(text, focusText) + (directHit ? 28 : 0) + activeBoost;
      return { ...item, score, _index: index, _activeBoost: activeBoost, _directHit: directHit };
    })
    .sort((a, b) => (b.score - a.score) || (b._activeBoost - a._activeBoost) || (a._index - b._index))
    .filter((item, index) => index < limit || item._directHit || item._activeBoost)
    .slice(0, limit);
}

function buildFocusText(inputs = getInputs()) {
  return [
    inputs.chapterGoal,
    inputs.hooks,
    inputs.foreshadowLedger,
    inputs.activeVolume?.title,
    inputs.activeVolume?.summary,
    inputs.activeVolume?.outline,
    inputs.activeVolume?.keyChars,
    inputs.activeVolume?.keyHooks,
    inputs.phaseSummary,
  ].filter(Boolean).join("\n");
}

function relevanceScore(text, focusText) {
  const source = String(text || "");
  const focus = String(focusText || "");
  if (!source || !focus) return 0;

  let score = 0;
  const pieces = source
    .split(/[｜|,，、\s\n\r:：;；/]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 24);

  pieces.forEach((piece) => {
    if (focus.includes(piece)) score += Math.min(16, piece.length * 2);
  });

  const focusTokens = (focus.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,}/g) || []).slice(0, 80);
  focusTokens.forEach((token) => {
    if (source.includes(token)) score += Math.min(10, token.length);
  });

  return score;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildChapterMemoryPack(planningContext = null, inputs = getInputs()) {
  const project = getActiveProject();
  const focusText = buildFocusText(inputs);
  const focusTerms = extractMemoryFocusTerms([
    focusText,
    inputs.codex,
    inputs.characterStateTable,
    inputs.chapterSummaries,
  ].filter(Boolean).join("\n"));
  const characterCards = uniqueBy([
    ...(planningContext?.characterCards || []),
    ...(project?.characterCards || []),
  ], (item) => item.name || item.rawLine || JSON.stringify(item));
  const hookItems = uniqueBy([
    ...(planningContext?.hookItems || []),
    ...(project?.hookItems || []),
  ], (item) => item.code || item.content || item.rawLine || JSON.stringify(item));
  const recentChapters = planningContext?.recentChapters?.length
    ? planningContext.recentChapters
    : buildRecentChapterContext(8, 2200);

  const relatedCharacters = characterCards
    .map((item) => ({
      name: item.name || "未命名角色",
      identity: item.identity || "",
      faction: item.faction || "",
      location: item.location || "",
      status: item.status || "",
      relations: item.relations || "",
      notes: item.notes || item.rawLine || "",
    }))
    .map((item) => ({
      ...item,
      score: relevanceScore([item.name, item.identity, item.faction, item.location, item.status, item.relations, item.notes].filter(Boolean).join("\n"), focusText),
    }));

  const relatedHooks = hookItems
    .map((item) => ({
      code: item.code || "",
      content: item.content || item.rawLine || "未命名钩子",
      status: item.status || "",
      firstSeen: item.firstSeen || "",
      recentProgress: item.recentProgress || "",
      plannedResolution: item.plannedResolution || "",
      relatedEntities: item.relatedEntities || "",
    }))
    .map((item) => ({
      ...item,
      score: relevanceScore([item.code, item.content, item.status, item.firstSeen, item.recentProgress, item.plannedResolution, item.relatedEntities].filter(Boolean).join("\n"), focusText),
    }));

  const relatedChapters = recentChapters
    .map((chapter) => ({
      title: chapter.title || "",
      volumeTitle: chapter.volumeTitle || "",
      goal: compactOneLine(chapter.goal, 360),
      summary: compactOneLine(chapter.summary, 420),
      hooksSnapshot: compactOneLine(chapter.hooksSnapshot, 360),
      contentWindow: limitTextWindow(chapter.content, 1800, 0.24),
      score: relevanceScore([chapter.title, chapter.volumeTitle, chapter.goal, chapter.summary, chapter.hooksSnapshot].filter(Boolean).join("\n"), focusText),
      updatedAt: chapter.updatedAt || chapter.createdAt || 0,
    }))
    .map((item) => ({
      ...item,
      score: item.score + (textContainsAny([item.title, item.goal, item.summary, item.hooksSnapshot].join("\n"), focusTerms) ? 24 : 0),
    }))
    .sort((a, b) => (b.score - a.score) || ((b.updatedAt || 0) - (a.updatedAt || 0)))
    .slice(0, 8);

  const selectedCharacters = rankMemoryItems(
    relatedCharacters,
    focusText,
    focusTerms,
    (item) => [item.name, item.identity, item.faction, item.location, item.status, item.relations, item.notes].filter(Boolean).join("\n"),
    12,
  );
  const selectedHooks = rankMemoryItems(
    relatedHooks,
    focusText,
    focusTerms,
    (item) => [item.code, item.content, item.status, item.firstSeen, item.recentProgress, item.plannedResolution, item.relatedEntities].filter(Boolean).join("\n"),
    12,
  );
  const mustUseLines = [
    inputs.chapterGoal ? `本章目标：${compactOneLine(inputs.chapterGoal, 260)}` : "",
    inputs.activeVolume?.title ? `当前卷：${inputs.activeVolume.title}${inputs.activeVolume.summary ? `｜${compactOneLine(inputs.activeVolume.summary, 220)}` : ""}` : "",
    ...selectedCharacters.slice(0, 8).map((item) => `人物固定：${[item.name, item.identity, item.faction, item.location, item.status].filter(Boolean).join("｜")}`),
    ...selectedHooks.slice(0, 8).map((item) => `钩子固定：${[item.code, item.content, item.status, item.plannedResolution].filter(Boolean).join("｜")}`),
  ].filter(Boolean);
  const forbiddenConflicts = [
    "不得改动已进入设定档案的人物姓名、称呼、阵营、地点归属和法宝术语。",
    "不得把未回收钩子当成已经解决，除非本章目标明确要求回收。",
    "不得为了单章爽点脱离当前卷目标或提前揭示终局秘密。",
    !selectedCharacters.length ? "本章缺少匹配角色档案，写作前需人工确认人物名和关系。" : "",
    !selectedHooks.length ? "本章缺少匹配钩子，结尾承接需人工确认。" : "",
  ].filter(Boolean);

  return {
    chapterGoal: inputs.chapterGoal,
    activeVolume: inputs.activeVolume,
    focusTerms,
    mustRespect: {
      bible: limitTextWindow(inputs.bible, 1200, 0.58),
      outline: limitTextWindow(inputs.outline, 1200, 0.58),
      codex: limitTextWindow(inputs.codex, 1600, 0.52),
      styleGuide: limitTextWindow(inputs.styleGuide, 1200, 0.52),
      phaseSummary: limitTextWindow(inputs.phaseSummary, 800, 0.55),
    },
    mustUseLines,
    forbiddenConflicts,
    relatedCharacters: selectedCharacters,
    relatedHooks: selectedHooks,
    relatedChapters,
    riskSignals: [
      !inputs.activeVolume?.summary && "当前卷缺少卷摘要，模型容易偏离卷目标。",
      !selectedCharacters.length && "本章没有匹配到结构化角色档案，人物姓名和关系需要额外留意。",
      !selectedHooks.length && "本章没有匹配到结构化钩子，章末承接需要手动确认。",
      !inputs.chapterGoal && "缺少本章目标。",
    ].filter(Boolean),
  };
}

function formatChapterMemoryPackMarkdown(pack) {
  const volume = pack.activeVolume || {};
  const characterLines = pack.relatedCharacters.length
    ? pack.relatedCharacters.map((item) => `- ${item.name}${item.identity ? `｜${item.identity}` : ""}${item.faction ? `｜${item.faction}` : ""}${item.status ? `｜${item.status}` : ""}${item.notes ? `｜${compactOneLine(item.notes, 120)}` : ""}`)
    : ["- 暂无匹配角色档案"];
  const hookLines = pack.relatedHooks.length
    ? pack.relatedHooks.map((item) => `- ${item.code ? `${item.code}｜` : ""}${item.content}${item.status ? `｜${item.status}` : ""}${item.recentProgress ? `｜最近：${compactOneLine(item.recentProgress, 120)}` : ""}`)
    : ["- 暂无匹配钩子"];
  const chapterLines = pack.relatedChapters.length
    ? pack.relatedChapters.map((item) => `- ${item.title}${item.summary ? `｜${item.summary}` : ""}`)
    : ["- 暂无相关历史章节"];
  const mustUseLines = pack.mustUseLines?.length ? pack.mustUseLines.map((item) => `- ${item}`) : ["- 按本章目标、当前卷和结构化档案执行"];
  const forbiddenLines = pack.forbiddenConflicts?.length ? pack.forbiddenConflicts.map((item) => `- ${item}`) : ["- 不得与长期设定、当前卷和历史章节冲突"];

  return [
    `### 本章目标`,
    pack.chapterGoal || "（空）",
    "",
    "### 当前卷硬约束",
    `- 卷名：${volume.title || "未命名当前卷"}`,
    `- 状态：${volume.status || "未标记"}`,
    `- 范围：${volume.chapterRange || "未设置"}`,
    `- 卷目标：${compactOneLine(volume.summary || volume.outline || "未填写", 420)}`,
    "",
    "### 相关角色",
    ...characterLines,
    "",
    "### 相关钩子",
    ...hookLines,
    "",
    "### 相关历史章节",
    ...chapterLines,
    "",
    "### 必须使用",
    ...mustUseLines,
    "",
    "### 禁止冲突",
    ...forbiddenLines,
    "",
    "### 风险信号",
    ...(pack.riskSignals.length ? pack.riskSignals.map((item) => `- ${item}`) : ["- 未检测到明显结构风险"]),
  ].join("\n");
}

function preflightConsistencyPrompt() {
  return [
    "你是长篇小说写前硬校验员。",
    "任务：在正文生成前检查本章相关记忆包是否足够支撑写作，是否存在会导致写错的硬冲突。",
    "只在硬冲突时给 block，例如：本章目标缺失、当前卷目标明显冲突、已完成章节被重复写、同一角色姓名/归属冲突、关键钩子状态自相矛盾。",
    "普通信息不足只给 warning，不要随便阻断。",
    "只返回 JSON，不要 Markdown。",
    "{",
    '  "status": "pass/warning/block",',
    '  "issues": ["具体问题"],',
    '  "requiredFixes": ["必须先修的项"],',
    '  "writingGuards": ["写正文时必须遵守的硬规则"]',
    "}",
  ].join("\n");
}

function normalizePreflightResult(raw) {
  const result = raw && typeof raw === "object" ? raw : {};
  const status = ["pass", "warning", "block"].includes(String(result.status || "").toLowerCase())
    ? String(result.status).toLowerCase()
    : "warning";
  return {
    status,
    issues: Array.isArray(result.issues) ? result.issues.filter(Boolean) : [],
    requiredFixes: Array.isArray(result.requiredFixes) ? result.requiredFixes.filter(Boolean) : [],
    writingGuards: Array.isArray(result.writingGuards) ? result.writingGuards.filter(Boolean) : [],
    rawText: typeof raw === "string" ? raw : "",
  };
}

function formatPreflightResult(result) {
  const title = result.status === "block"
    ? "### 写前硬校验：阻断"
    : result.status === "warning"
      ? "### 写前硬校验：警告"
      : "### 写前硬校验：通过";
  return [
    title,
    "",
    "#### 问题",
    ...(result.issues.length ? result.issues.map((item) => `- ${item}`) : ["- 未发现硬冲突"]),
    "",
    "#### 必须先修",
    ...(result.requiredFixes.length ? result.requiredFixes.map((item) => `- ${item}`) : ["- 无"]),
    "",
    "#### 写作护栏",
    ...(result.writingGuards.length ? result.writingGuards.map((item) => `- ${item}`) : ["- 按本章记忆包和当前卷目标执行"]),
    result.rawText ? `\n#### 原始返回\n${result.rawText}` : "",
  ].filter(Boolean).join("\n");
}

async function runPreflightCheck({ mockMode, sourceContext, memoryPack }) {
  if (mockMode) {
    return normalizePreflightResult({
      status: memoryPack.riskSignals.length ? "warning" : "pass",
      issues: memoryPack.riskSignals,
      requiredFixes: [],
      writingGuards: [
        "正文必须服务当前卷目标。",
        "人物姓名、阵营、地点以本章记忆包为准。",
        "章末必须承接当前钩子。",
      ],
    });
  }

  try {
    const parsed = parseJsonObject(await callOpenAI({
      model: $("controllerModel").value.trim(),
      signal: currentAbortController.signal,
      temperature: 0.2,
      messages: [
        { role: "system", content: preflightConsistencyPrompt() },
        { role: "user", content: sourceContext },
      ],
    }));
    return normalizePreflightResult(parsed);
  } catch (error) {
    return normalizePreflightResult({
      status: "warning",
      issues: [`写前硬校验解析失败，已降级为警告：${error.message}`],
      requiredFixes: [],
      writingGuards: ["继续生成前请人工扫一眼本章记忆包。"],
    });
  }
}

function qualityScorePrompt() {
  return [
    "你是长篇小说正文质量评估员。",
    "你只评估这一章正文是否可读、有人味、连续、能推进长篇，不负责改写。",
    "重点压低以下问题的分数：提纲扩写感、解释腔、空泛比喻、生硬动词、对白不像人话、人物名或设定不稳、脱离当前卷目标、章末没有承接。",
    "只返回 JSON，不要 Markdown。",
    "{",
    '  "humanTaste": 0-100,',
    '  "sceneVividness": 0-100,',
    '  "dialogueNaturalness": 0-100,',
    '  "aiFlavorControl": 0-100,',
    '  "continuity": 0-100,',
    '  "plotProgress": 0-100,',
    '  "overall": 0-100,',
    '  "majorIssues": ["最影响可读性的具体问题"],',
    '  "rewriteAdvice": ["下一轮改写要执行的具体动作"]',
    "}",
  ].join("\n");
}

function buildMockQualityScore(mode = "standard") {
  const strict = mode === "strict";
  return normalizeQualityReport({
    humanTaste: strict ? 74 : 78,
    sceneVividness: strict ? 76 : 80,
    dialogueNaturalness: strict ? 70 : 76,
    aiFlavorControl: strict ? 72 : 78,
    continuity: 82,
    plotProgress: 80,
    overall: strict ? 74 : 78,
    majorIssues: ["模拟评分：对白和动作承载还可以继续加强。"],
    rewriteAdvice: ["减少解释句，把关键情绪改成动作、停顿和现场反应。"],
    mode,
    chapterId: activeChapterId,
    createdAt: Date.now(),
  });
}

async function runDraftQualityScore({ mockMode, mode, sourceContext, memoryPack, briefResult, draftResult, auditResult }) {
  if (mockMode) return buildMockQualityScore(mode);

  try {
    const rawText = await callGemini({
      model: $("geminiModel").value.trim(),
      signal: currentAbortController.signal,
      temperature: 0.2,
      messages: [
        { role: "system", content: qualityScorePrompt() },
        {
          role: "user",
          content: JSON.stringify({
            memoryPack,
            sourceContext: JSON.parse(sourceContext),
            briefResult: limitText(briefResult, 9000),
            draftResult: limitText(draftResult, 18000),
            auditResult: limitText(auditResult, 9000),
          }, null, 2),
        },
      ],
    });
    const parsed = parseJsonObject(rawText);
    return normalizeQualityReport({
      ...parsed,
      mode,
      chapterId: activeChapterId,
      createdAt: Date.now(),
      rawText,
    });
  } catch (error) {
    return normalizeQualityReport({
      overall: 0,
      majorIssues: [`质量评分解析失败：${error.message}`],
      rewriteAdvice: ["本次不因评分失败自动修订，请先查看审稿意见。"],
      mode,
      chapterId: activeChapterId,
      createdAt: Date.now(),
      parseFailed: true,
    });
  }
}

function formatQualityScore(report) {
  const scoreLines = [
    ["人味", report.humanTaste],
    ["画面", report.sceneVividness],
    ["对白", report.dialogueNaturalness],
    ["去 AI 味", report.aiFlavorControl],
    ["连续性", report.continuity],
    ["推进", report.plotProgress],
  ].map(([label, value]) => `- ${label}：${Number(value || 0) || "--"}`);

  return [
    `### 正文质量评分：${report.overall || "--"}`,
    "",
    "#### 分项",
    ...scoreLines,
    "",
    "#### 主要问题",
    ...(report.majorIssues?.length ? report.majorIssues.map((item) => `- ${item}`) : ["- 未发现明显硬伤"]),
    "",
    "#### 修改建议",
    ...(report.rewriteAdvice?.length ? report.rewriteAdvice.map((item) => `- ${item}`) : ["- 保持当前方向"]),
  ].join("\n");
}

function qualityScoreNeedsRevision(report, mode = "standard") {
  if (!report || report.parseFailed || mode === "fast") return false;
  const threshold = WORKFLOW_RUN_MODES[normalizeWorkflowRunMode(mode)].qualityThreshold;
  return threshold > 0 && Number(report.overall || 0) > 0 && Number(report.overall || 0) < threshold;
}

function ensureControllerProjectState(project = getActiveProject()) {
  if (!project) return null;
  project.controllerArchive = normalizeControllerArchive(project.controllerArchive);
  project.controllerMemory = String(project.controllerMemory || "").trim();
  project.controllerMemoryUpdatedAt = Number(project.controllerMemoryUpdatedAt || 0);
  if (!project.controllerMemory && project.controllerArchive.length) {
    project.controllerMemory = buildControllerMemoryFromArchive(project.controllerArchive);
    project.controllerMemoryUpdatedAt = project.controllerArchive[project.controllerArchive.length - 1]?.createdAt || 0;
  }
  return project;
}

function cleanControllerArchiveText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function pickControllerArchiveSnippets(messages, keepCount = 4, maxPerItem = 240) {
  const snippets = messages
    .map((message) => limitTextWindow(cleanControllerArchiveText(message.content), maxPerItem, 0.66).replace(/\n+/g, " / "))
    .filter(Boolean);
  if (snippets.length <= keepCount) return snippets;
  return [snippets[0], ...snippets.slice(-(keepCount - 1))];
}

function buildControllerArchiveEntry(messages) {
  const normalized = messages.filter((message) => message.role === "user" || message.role === "assistant");
  if (!normalized.length) return null;

  const createdAt = Date.now();
  const userSnippets = pickControllerArchiveSnippets(normalized.filter((message) => message.role === "user"), 4, 260);
  const assistantSnippets = pickControllerArchiveSnippets(normalized.filter((message) => message.role === "assistant"), 3, 220);
  const parts = [`归档范围：${normalized.length} 条主控对话。`];

  if (userSnippets.length) {
    parts.push(["作者历史需求：", ...userSnippets.map((item) => `- ${item}`)].join("\n"));
  }
  if (assistantSnippets.length) {
    parts.push(["主控历史回复：", ...assistantSnippets.map((item) => `- ${item}`)].join("\n"));
  }

  return {
    id: `controller-archive-${createdAt}-${Math.random().toString(16).slice(2)}`,
    title: `主控归档 ${new Date(createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`,
    content: parts.join("\n\n"),
    createdAt,
    sourceCount: normalized.length,
  };
}

function buildControllerMemoryFromArchive(entries, maxChars = 6800) {
  const normalized = normalizeControllerArchive(entries);
  if (!normalized.length) return "";

  const selected = normalized.length <= 4
    ? normalized
    : [normalized[0], ...normalized.slice(-3)];

  const blocks = selected.map((entry) => `【${entry.title}】\n${entry.content}`);
  return limitTextWindow(blocks.join("\n\n"), maxChars, 0.58);
}

function renderControllerMemoryPanel() {
  const body = $("controllerMemoryBody");
  const meta = $("controllerMemoryMeta");
  const clearBtn = $("clearControllerMemory");
  if (!body || !meta) return;

  const project = ensureControllerProjectState(getActiveProject());
  const archive = project?.controllerArchive || [];
  const memory = project?.controllerMemory || "";

  if (!archive.length || !memory) {
    body.textContent = "旧对话一长会自动归档到这里。主控继续能读到，但不会再把全部历史对话硬塞进上下文。";
    body.classList.add("empty");
    meta.textContent = "暂无归档";
    if (clearBtn) clearBtn.disabled = true;
    return;
  }

  body.classList.remove("empty");
  body.textContent = memory;
  meta.textContent = `${archive.length} 段归档 · 更新 ${new Date(project.controllerMemoryUpdatedAt || archive[archive.length - 1]?.createdAt || Date.now()).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
  if (clearBtn) clearBtn.disabled = false;
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildCharacterCardsText(cards = []) {
  return cards.map((item) => [
    item.name || "",
    item.identity || "",
    item.faction || "",
    item.location || "",
    item.status || "",
    item.relations || "",
    item.notes || "",
  ].filter(Boolean).join("｜")).join("\n");
}

function buildHookItemsText(items = []) {
  return items.map((item) => {
    const header = [item.code || "", item.content || ""].filter(Boolean).join(" ");
    const tail = [item.status, item.firstSeen, item.recentProgress, item.plannedResolution, item.relatedEntities]
      .filter(Boolean)
      .join("｜");
    return [header, tail].filter(Boolean).join("｜");
  }).join("\n");
}

function buildStructuredCharacterNotes(cards = []) {
  return cards
    .slice(0, 24)
    .map((item) => [item.name, item.identity, item.faction, item.location, item.status, item.relations].filter(Boolean).join("｜"))
    .filter(Boolean)
    .join("\n");
}

function buildStructuredHookNotes(items = []) {
  return items
    .slice(0, 24)
    .map((item) => [item.code, item.content, item.status, item.firstSeen, item.recentProgress, item.plannedResolution].filter(Boolean).join("｜"))
    .filter(Boolean)
    .join("\n");
}

function mergeStructuredContextBlock(baseText, title, extraText) {
  const base = String(baseText || "").trim();
  const extra = String(extraText || "").trim();
  if (!extra) return base;
  if (base.includes(extra)) return base;
  return [base, `${title}：\n${extra}`].filter(Boolean).join("\n\n");
}

function collectCharacterCardFormInput(seed = {}) {
  const name = prompt("角色名", seed.name || "")?.trim();
  if (!name) return null;
  const identity = prompt("身份 / 定位", seed.identity || "")?.trim() || "";
  const faction = prompt("归属势力", seed.faction || "")?.trim() || "";
  const location = prompt("当前位置 / 常驻地", seed.location || "")?.trim() || "";
  const status = prompt("当前状态", seed.status || "")?.trim() || "";
  const relations = prompt("关系变化", seed.relations || "")?.trim() || "";
  const notes = prompt("备注 / 禁止写错", seed.notes || "")?.trim() || "";
  return { ...seed, name, identity, faction, location, status, relations, notes, sourceType: "manual" };
}

function collectHookItemFormInput(seed = {}) {
  const content = prompt("钩子内容", seed.content || "")?.trim();
  if (!content) return null;
  const code = prompt("编号", seed.code || "")?.trim() || "";
  const status = prompt("状态", seed.status || "")?.trim() || "";
  const firstSeen = prompt("首次出现", seed.firstSeen || "")?.trim() || "";
  const recentProgress = prompt("最近推进", seed.recentProgress || "")?.trim() || "";
  const plannedResolution = prompt("计划回收", seed.plannedResolution || "")?.trim() || "";
  const relatedEntities = prompt("相关人物 / 势力", seed.relatedEntities || "")?.trim() || "";
  return { ...seed, code, content, status, firstSeen, recentProgress, plannedResolution, relatedEntities, sourceType: "manual" };
}

async function persistKnowledgeState(payload = {}) {
  const project = getActiveProject();
  if (!project?.id) return null;
  const saved = await saveProjectKnowledgeStateToServer(project.id, payload);
  if (!saved) return null;
  applyKnowledgeStatePayload(project, saved);
  renderKnowledgePanels();
  renderWorkflowRail();
  persistConfig();
  return saved;
}

function scheduleKnowledgeTextSync(source = "") {
  clearTimeout(knowledgeSyncTimer);
  knowledgeSyncTimer = setTimeout(async () => {
    const project = getActiveProject();
    if (!project?.id) return;
    try {
      await persistKnowledgeState({
        characterStateTable: $("characterStateTable")?.value.trim() || "",
        hooks: $("hooks")?.value.trim() || "",
        foreshadowLedger: $("foreshadowLedger")?.value.trim() || "",
        foreshadowTimeline: $("foreshadowTimeline")?.value.trim() || "",
      });
    } catch (error) {
      console.warn(`Failed to sync knowledge text from ${source || "editor"}:`, error);
    }
  }, 800);
}

async function addCharacterCard() {
  const project = getActiveProject();
  const next = collectCharacterCardFormInput();
  if (!project || !next) return;
  const cards = [...(project.characterCards || []), next];
  await persistKnowledgeState({ characterCards: cards, hookItems: project.hookItems || [] });
}

async function editCharacterCard(index) {
  const project = getActiveProject();
  const cards = [...(project.characterCards || [])];
  const current = cards[index];
  if (!project || !current) return;
  const next = collectCharacterCardFormInput(current);
  if (!next) return;
  cards[index] = next;
  await persistKnowledgeState({ characterCards: cards, hookItems: project.hookItems || [] });
}

async function deleteCharacterCard(index) {
  const project = getActiveProject();
  const cards = [...(project.characterCards || [])];
  if (!project || !cards[index]) return;
  if (!confirm(`确定删除角色《${cards[index].name || "未命名"}》吗？`)) return;
  cards.splice(index, 1);
  await persistKnowledgeState({ characterCards: cards, hookItems: project.hookItems || [] });
}

async function addHookItem() {
  const project = getActiveProject();
  const next = collectHookItemFormInput();
  if (!project || !next) return;
  const items = [...(project.hookItems || []), next];
  await persistKnowledgeState({ characterCards: project.characterCards || [], hookItems: items });
}

async function editHookItem(index) {
  const project = getActiveProject();
  const items = [...(project.hookItems || [])];
  const current = items[index];
  if (!project || !current) return;
  const next = collectHookItemFormInput(current);
  if (!next) return;
  items[index] = next;
  await persistKnowledgeState({ characterCards: project.characterCards || [], hookItems: items });
}

async function deleteHookItem(index) {
  const project = getActiveProject();
  const items = [...(project.hookItems || [])];
  if (!project || !items[index]) return;
  if (!confirm(`确定删除钩子《${items[index].content || "未命名"}》吗？`)) return;
  items.splice(index, 1);
  await persistKnowledgeState({ characterCards: project.characterCards || [], hookItems: items });
}

function renderKnowledgePanels() {
  const project = ensureControllerProjectState(getActiveProject());
  const characterList = $("characterCardList");
  const hookList = $("hookItemList");
  const characterCount = $("characterCardCount");
  const hookCount = $("hookItemCount");
  if (!project || !characterList || !hookList || !characterCount || !hookCount) return;

  const cards = Array.isArray(project.characterCards) ? project.characterCards : [];
  const hooks = Array.isArray(project.hookItems) ? project.hookItems : [];

  characterCount.textContent = `${cards.length} 条`;
  hookCount.textContent = `${hooks.length} 条`;

  if (!cards.length) {
    characterList.innerHTML = `
      <div class="empty-state small">
        <p>暂无角色档案</p>
        <span>主控沉淀、章节回写后，这里会自动列出人物、归属和状态。</span>
      </div>
    `;
  } else {
    characterList.innerHTML = cards.map((item) => `
      <article class="knowledge-item">
        <div class="knowledge-item-top">
          <strong>${escapeHtml(item.name || "未命名角色")}</strong>
          <div class="knowledge-item-actions">
            ${item.sourceType ? `<span class="knowledge-code">${escapeHtml(item.sourceType)}</span>` : ""}
            <button class="knowledge-item-btn" type="button" data-action="edit-character" data-index="${cards.indexOf(item)}">编辑</button>
            <button class="knowledge-item-btn" type="button" data-action="delete-character" data-index="${cards.indexOf(item)}">删除</button>
          </div>
        </div>
        <div class="knowledge-meta">
          ${item.identity ? `<span class="knowledge-chip">${escapeHtml(item.identity)}</span>` : ""}
          ${item.faction ? `<span class="knowledge-chip">${escapeHtml(item.faction)}</span>` : ""}
          ${item.location ? `<span class="knowledge-chip">${escapeHtml(item.location)}</span>` : ""}
          ${item.status ? `<span class="knowledge-chip">${escapeHtml(item.status)}</span>` : ""}
        </div>
        ${item.relations ? `<div class="knowledge-body">${escapeHtml(`关系：${item.relations}`)}</div>` : ""}
        ${item.notes ? `<div class="knowledge-raw">${escapeHtml(item.notes)}</div>` : ""}
      </article>
    `).join("");
  }

  if (!hooks.length) {
    hookList.innerHTML = `
      <div class="empty-state small">
        <p>暂无钩子账本</p>
        <span>主控沉淀、工程记忆刷新、章节完成后，这里会自动列出钩子和回收状态。</span>
      </div>
    `;
  } else {
    hookList.innerHTML = hooks.map((item) => `
      <article class="knowledge-item">
        <div class="knowledge-item-top">
          <strong>${escapeHtml(item.content || "未命名钩子")}</strong>
          <div class="knowledge-item-actions">
            ${item.code ? `<span class="knowledge-code">${escapeHtml(item.code)}</span>` : ""}
            <button class="knowledge-item-btn" type="button" data-action="edit-hook" data-index="${hooks.indexOf(item)}">编辑</button>
            <button class="knowledge-item-btn" type="button" data-action="delete-hook" data-index="${hooks.indexOf(item)}">删除</button>
          </div>
        </div>
        <div class="knowledge-meta">
          ${item.status ? `<span class="knowledge-chip">${escapeHtml(item.status)}</span>` : ""}
          ${item.firstSeen ? `<span class="knowledge-chip">${escapeHtml(`首次：${item.firstSeen}`)}</span>` : ""}
          ${item.recentProgress ? `<span class="knowledge-chip">${escapeHtml(`最近：${item.recentProgress}`)}</span>` : ""}
        </div>
        ${item.plannedResolution ? `<div class="knowledge-body">${escapeHtml(`计划回收：${item.plannedResolution}`)}</div>` : ""}
        ${(item.relatedEntities || item.rawLine) ? `<div class="knowledge-raw">${escapeHtml(item.relatedEntities || item.rawLine)}</div>` : ""}
      </article>
    `).join("");
  }

  characterList.querySelectorAll("[data-action='edit-character']").forEach((button) => {
    button.addEventListener("click", () => {
      editCharacterCard(Number(button.dataset.index || -1)).catch((error) => {
        console.error("Failed to edit character card:", error);
      });
    });
  });
  characterList.querySelectorAll("[data-action='delete-character']").forEach((button) => {
    button.addEventListener("click", () => {
      deleteCharacterCard(Number(button.dataset.index || -1)).catch((error) => {
        console.error("Failed to delete character card:", error);
      });
    });
  });
  hookList.querySelectorAll("[data-action='edit-hook']").forEach((button) => {
    button.addEventListener("click", () => {
      editHookItem(Number(button.dataset.index || -1)).catch((error) => {
        console.error("Failed to edit hook item:", error);
      });
    });
  });
  hookList.querySelectorAll("[data-action='delete-hook']").forEach((button) => {
    button.addEventListener("click", () => {
      deleteHookItem(Number(button.dataset.index || -1)).catch((error) => {
        console.error("Failed to delete hook item:", error);
      });
    });
  });
  renderProjectDashboard();
}

function renderControllerMessages() {
  const container = $("controllerMessages");
  if (!container) return;

  container.innerHTML = "";
  if (!controllerMessages.length) {
    const empty = document.createElement("div");
    empty.className = "controller-empty";
    empty.textContent = "先把整本书的想法、题材、人物、卷线或本章需求发给主控。";
    container.appendChild(empty);
    return;
  }

  controllerMessages.forEach((message) => {
    const item = document.createElement("div");
    item.className = `controller-message ${message.role}`;
    item.textContent = message.content;
    container.appendChild(item);
  });
  container.scrollTop = container.scrollHeight;
}

function syncLocalControllerStateToProject() {
  const project = ensureControllerProjectState(getActiveProject());
  if (!project) return null;
  project.controllerMessages = Array.isArray(controllerMessages) ? controllerMessages.slice() : [];
  return project;
}

function queueControllerStateSave({ includeMessages = true } = {}) {
  const project = syncLocalControllerStateToProject();
  if (!project) return;
  saveProjectControllerStateToServer(project.id, {
    messages: includeMessages ? project.controllerMessages : undefined,
    archives: project.controllerArchive,
    memory: project.controllerMemory,
    memoryUpdatedAt: project.controllerMemoryUpdatedAt,
    draft: $("controllerInput")?.value || project.controllerDraft || "",
  }).then((payload) => {
    if (!payload) return;
    applyControllerStateToProject(project, payload);
    if (project.id === activeProjectId) {
      renderControllerMessages();
      renderControllerMemoryPanel();
      renderKnowledgePanels();
    }
  }).catch((error) => {
    console.warn("Failed to save controller state to local server:", error);
  });
}

function archiveControllerMessages({ force = false, silent = false, shouldPersist = true } = {}) {
  const project = ensureControllerProjectState(getActiveProject());
  if (!project) return false;

  const primaryMessages = controllerMessages.filter((message) => message.role === "user" || message.role === "assistant");
  const totalChars = primaryMessages.reduce((sum, message) => sum + String(message.content || "").length, 0);
  const preservePrimaryCount = force ? 2 : 6;

  if (primaryMessages.length <= preservePrimaryCount) return false;
  if (!force && primaryMessages.length < 14 && totalChars < 12000) return false;

  const archivePrimaryCount = Math.max(1, primaryMessages.length - preservePrimaryCount);
  let seenPrimary = 0;
  let splitIndex = 0;

  for (; splitIndex < controllerMessages.length; splitIndex += 1) {
    if (controllerMessages[splitIndex].role === "user" || controllerMessages[splitIndex].role === "assistant") {
      seenPrimary += 1;
    }
    if (seenPrimary >= archivePrimaryCount) {
      splitIndex += 1;
      break;
    }
  }

  const archivedMessages = controllerMessages.slice(0, splitIndex).filter((message) => message.role === "user" || message.role === "assistant");
  if (!archivedMessages.length) return false;

  const entry = buildControllerArchiveEntry(archivedMessages);
  controllerMessages = controllerMessages.slice(splitIndex);
  if (entry) {
    project.controllerArchive = normalizeControllerArchive([...(project.controllerArchive || []), entry]).slice(-12);
    project.controllerMemory = buildControllerMemoryFromArchive(project.controllerArchive);
    project.controllerMemoryUpdatedAt = Date.now();
    project.updatedAt = Date.now();
  }

  renderControllerMessages();
  renderControllerMemoryPanel();
  renderKnowledgePanels();
  renderWorkflowRail();
  queueControllerStateSave({ includeMessages: true });
  if (shouldPersist) persistConfig();
  if (!silent) setStatus(force ? "已归档旧对话" : "已压缩主控上下文", "done");
  return true;
}

function archiveControllerConversation() {
  if (!controllerMessages.some((message) => message.role === "user" || message.role === "assistant")) {
    setStatus("没有可归档的主控对话", "done");
    return;
  }
  if (!archiveControllerMessages({ force: true, shouldPersist: true })) {
    setStatus("当前主控对话还很短，无需归档", "done");
  }
}

function clearControllerMemory() {
  const project = ensureControllerProjectState(getActiveProject());
  if (!project || (!project.controllerArchive.length && !project.controllerMemory)) return;
  if (!confirm("确定要清空主控长期记忆吗？这会删除已归档的旧对话摘要。")) return;

  project.controllerArchive = [];
  project.controllerMemory = "";
  project.controllerMemoryUpdatedAt = 0;
  project.updatedAt = Date.now();
  renderControllerMemoryPanel();
  renderKnowledgePanels();
  queueControllerStateSave({ includeMessages: false });
  persistConfig();
  setStatus("已清空主控长期记忆", "done");
}

function appendControllerMessage(role, content, shouldPersist = true) {
  const project = ensureControllerProjectState(getActiveProject());
  const message = {
    id: `message-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    createdAt: Date.now(),
  };
  controllerMessages.push(message);
  let archived = false;
  if (role === "user" || role === "assistant") {
    archived = archiveControllerMessages({ silent: true, shouldPersist: false });
  }
  syncLocalControllerStateToProject();
  renderControllerMessages();
  renderControllerMemoryPanel();
  renderKnowledgePanels();
  renderWorkflowRail();
  if (project?.id && !archived) {
    appendProjectControllerMessageToServer(project.id, message).then((payload) => {
      if (!payload) return;
      applyControllerStateToProject(project, payload);
      if (project.id === activeProjectId) {
        renderControllerMessages();
        renderControllerMemoryPanel();
        renderKnowledgePanels();
      }
    }).catch((error) => {
      console.warn("Failed to append controller message to local server:", error);
    });
  }
  if (shouldPersist) persistConfig();
}

function setControllerBusy(isBusy) {
  $("sendController").disabled = isBusy;
  $("analyzeController").disabled = isBusy;
  $("clearController").disabled = isBusy;
  if ($("archiveController")) $("archiveController").disabled = isBusy;
  if ($("clearControllerMemory")) {
    const hasMemory = Boolean(ensureControllerProjectState(getActiveProject())?.controllerArchive?.length);
    $("clearControllerMemory").disabled = isBusy || !hasMemory;
  }
  $("controllerInput").disabled = isBusy;
  $("newProject").disabled = isBusy;
  $("deleteProject").disabled = isBusy;
  $("projectTitle").disabled = isBusy;
  $("openStyleDistill").disabled = isBusy;
  $("advanceChapter").disabled = isBusy;
  $("exportDraft").disabled = isBusy;
  if ($("refreshEngineeringMemory")) $("refreshEngineeringMemory").disabled = isBusy;
  if ($("batchValidateProject")) $("batchValidateProject").disabled = isBusy;
  $("stopWorkflow").disabled = !isBusy && !currentAbortController;
}

function validateControllerAccess() {
  if (shouldUseControllerMock()) return;
  if (!$("openaiApiKey").value.trim()) throw new Error("请先在 API 配置里填写 OpenAI API Key");
  if (!$("controllerModel").value.trim()) throw new Error("请先填写主控模型");
}

function shouldUseControllerMock() {
  return $("mockMode").checked && (!$("openaiApiKey").value.trim() || !$("controllerModel").value.trim());
}

function controllerSystemPrompt() {
  return [
    "你是长篇小说项目的主控编辑，负责把作者的松散需求变成可执行的创作计划。",
    "你的工作不是直接写正文，而是追问、澄清、压实设定、维护连续性，并提示下一步需要补足什么。",
    "回复要具体、可执行，优先围绕题材定位、主角欲望、核心冲突、卷线、章节目标、伏笔和禁忌展开。",
    "如果作者需求已经足够清楚，给出下一步建议；如果不清楚，最多提出 3 个关键问题。",
  ].join("\n");
}

function leanControllerSystemPrompt() {
  return [
    "你是长篇小说项目主控。",
    "任务：快速理解作者最新需求，给出可执行下一步，不要长篇发挥。",
    "优先处理：题材定位、主角欲望、核心冲突、第一卷目标、本章目标、伏笔和禁写项。",
    "如果需求已经明确，直接给一版大纲推进方向；如果还缺关键条件，最多问 3 个问题。",
    "回复控制在 800 字以内。",
  ].join("\n");
}


function controllerAnalysisPrompt() {
  return [
    "你是长篇小说项目的主控编辑。",
    "根据主控对话，沉淀出下方写作页可直接使用的结构化内容。",
    "最高优先级是作者最新需求；旧输入只作为参考，冲突时必须丢弃旧内容。",
    "只返回 JSON，不要 Markdown，不要解释。",
    "JSON 字段必须包含：",
    "{",
    '  "bible": "小说圣经",',
    '  "codex": "设定档案",',
    '  "outline": "全书大纲",',
    '  "volumeOutline": "当前卷大纲",',
    '  "hooks": "当前钩子",',
    '  "foreshadowLedger": "伏笔账本",',
    '  "volumeSummary": "卷摘要",',
    '  "phaseSummary": "阶段摘要",',
    '  "characterStateTable": "人物状态表",',
    '  "foreshadowTimeline": "伏笔生命周期",',
    '  "chapterSummaries": "章节摘要库",',
    '  "activeVolume": { "title": "当前卷名", "status": "规划中/在写/完成", "chapterRange": "章节范围", "summary": "卷目标摘要", "outline": "卷大纲", "content": "卷内沉淀", "keyChars": "关键人物/势力/地点", "keyHooks": "关键钩子", "notes": "备注" },',
    '  "chapterGoal": "本章目标",',
    '  "reply": "给作者的简短说明"',
    "}",
  ].join("\n");
}

function buildControllerProjectContextMessage(options = {}) {
  const compact = Boolean(options.compact);
  const project = getActiveProject();
  if (!project) return null;
  const volume = getActiveVolume(project);
  const activeVolumeText = composeVolumeOutlineText(volume);
  const parts = [
    `当前书名：${project.title || "未命名新书"}`,
    project.outline ? `全书大纲：\n${limitTextWindow(project.outline, compact ? 700 : 1400, 0.55)}` : "",
    activeVolumeText ? `卷纲页当前写作卷：\n${limitTextWindow(activeVolumeText, compact ? 1300 : 2600, 0.55)}` : "",
    project.chapterGoal ? `当前本章目标：\n${limitTextWindow(project.chapterGoal, compact ? 360 : 700, 0.45)}` : "",
    project.hooks ? `当前钩子：\n${limitTextWindow(project.hooks, compact ? 420 : 800, 0.38)}` : "",
  ].filter(Boolean);
  if (!parts.length) return null;
  return {
    role: "system",
    content: [
      "以下是卷纲页和写作页已经沉淀的项目上下文。主控必须读取，尤其不能无视“卷纲页当前写作卷”。",
      ...parts,
    ].join("\n\n"),
  };
}

function modelReadyMessages(options = {}) {
  const compact = Boolean(options.compact);
  const project = ensureControllerProjectState(getActiveProject());
  const memory = project?.controllerMemory || "";
  const source = controllerMessages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(compact ? -4 : -8);

  const kept = [];
  let totalChars = 0;
  const perMessageMax = compact ? 650 : 1100;
  const totalMax = compact ? 2600 : 5200;

  for (let index = source.length - 1; index >= 0; index -= 1) {
    const message = source[index];
    const content = limitTextWindow(message.content, perMessageMax, 0.38);
    const addition = content.length + 24;
    if (kept.length && totalChars + addition > totalMax) break;
    kept.unshift({ role: message.role, content });
    totalChars += addition;
  }

  const omitted = source.length - kept.length;
  if (omitted > 0) {
    kept.unshift({
      role: "system",
      content: `更早的主控对话已折叠 ${omitted} 条。稳定设定以下方已沉淀输入为准，最近作者消息优先。`,
    });
  }

  if (memory) {
    kept.unshift({
      role: "system",
      content: `以下是本项目主控长期记忆，来自较早对话归档。若与作者最新明确需求冲突，以最新需求优先。\n${limitTextWindow(memory, compact ? 1200 : 2200, 0.6)}`,
    });
  }

  const projectContext = buildControllerProjectContextMessage({ compact });
  if (projectContext) {
    kept.unshift(projectContext);
  }

  return kept;
}

function limitText(text, max = 12000) {
  const value = String(text || "");
  if (value.length <= max) return value;
  return `（前文已裁剪，仅保留末尾 ${max} 字）\n${value.slice(-max)}`;
}

function limitTextWindow(text, max = 12000, headRatio = 0.45) {
  const value = String(text || "").trim();
  if (value.length <= max) return value;
  if (max <= 80) return value.slice(0, max);

  const safeHeadRatio = Math.min(0.8, Math.max(0.2, headRatio));
  const marker = "\n\n（中间内容已折叠）\n\n";
  const available = Math.max(32, max - marker.length);
  const headSize = Math.max(16, Math.floor(available * safeHeadRatio));
  const tailSize = Math.max(16, available - headSize);
  return `${value.slice(0, headSize)}${marker}${value.slice(-tailSize)}`;
}

function buildControllerNeedText(maxChars = 12000) {
  const project = ensureControllerProjectState(getActiveProject());
  const memory = project?.controllerMemory ? `【较早主控归档】\n${limitTextWindow(project.controllerMemory, 2400, 0.58)}` : "";
  const projectContext = buildControllerProjectContextMessage({ compact: true })?.content || "";
  const userBlocks = controllerMessages
    .filter((message) => message.role === "user")
    .map((message, index) => `[作者需求 ${index + 1}]\n${message.content.trim()}`)
    .filter(Boolean);

  if (!userBlocks.length) return [memory, projectContext].filter(Boolean).join("\n\n---\n\n");

  const fullText = userBlocks.join("\n\n---\n\n");
  if (fullText.length <= maxChars) {
    return [memory, projectContext, fullText].filter(Boolean).join("\n\n---\n\n");
  }

  const leadBudget = Math.min(2600, Math.floor(maxChars * 0.28));
  const tailBudget = Math.max(2200, maxChars - leadBudget - 80);
  const tailBlocks = [];
  let usedChars = 0;

  for (let index = userBlocks.length - 1; index >= 1; index -= 1) {
    const block = limitTextWindow(userBlocks[index], 1500, 0.32);
    const addition = block.length + 14;
    if (tailBlocks.length && usedChars + addition > tailBudget) break;
    tailBlocks.unshift(block);
    usedChars += addition;
  }

  return [memory, projectContext, [
    limitTextWindow(userBlocks[0], leadBudget, 0.72),
    "（中间较早的主控需求已折叠；稳定设定以下方已沉淀输入为准，最近修改优先）",
    ...tailBlocks,
  ].join("\n\n---\n\n")].filter(Boolean).join("\n\n---\n\n");
}

async function loadProjectSkill(name) {
  if (skillCache[name]) return skillCache[name];
  try {
    const response = await fetch(`http://localhost:8788/api/skills/${encodeURIComponent(name)}`);
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    skillCache[name] = data.content || "";
  } catch {
    skillCache[name] = "";
  }
  return skillCache[name];
}

async function withSkill(name, fallbackPrompt) {
  const skillNames = [...new Set([...getEnabledRoleSkills(name), name])];
  const skillContents = await Promise.all(skillNames.map(loadProjectSkill));
  return [...skillContents, fallbackPrompt].filter(Boolean).join("\n\n---\n\n");
}

function compactInputsForModel(inputs = getInputs()) {
  return {
    bible: limitTextWindow(inputs.bible, 2200, 0.55),
    styleGuide: limitTextWindow(inputs.styleGuide, 1800, 0.58),
    codex: limitTextWindow(inputs.codex, 2600, 0.55),
    outline: limitTextWindow(inputs.outline, 2200, 0.55),
    volumeOutline: limitTextWindow(inputs.volumeOutline, 1400, 0.55),
    activeVolume: {
      id: inputs.activeVolume?.id || "",
      title: inputs.activeVolume?.title || "",
      status: inputs.activeVolume?.status || "",
      chapterRange: inputs.activeVolume?.chapterRange || "",
      summary: limitTextWindow(inputs.activeVolume?.summary, 1400, 0.55),
      outline: limitTextWindow(inputs.activeVolume?.outline, 1800, 0.55),
      content: limitTextWindow(inputs.activeVolume?.content, 2200, 0.34),
      keyChars: limitTextWindow(inputs.activeVolume?.keyChars, 1300, 0.45),
      keyHooks: limitTextWindow(inputs.activeVolume?.keyHooks, 1300, 0.45),
      notes: limitTextWindow(inputs.activeVolume?.notes, 900, 0.45),
    },
    hooks: limitTextWindow(inputs.hooks, 1600, 0.42),
    foreshadowLedger: limitTextWindow(inputs.foreshadowLedger, 1800, 0.42),
    volumeSummary: limitTextWindow(inputs.volumeSummary, 1600, 0.55),
    phaseSummary: limitTextWindow(inputs.phaseSummary, 1200, 0.55),
    characterStateTable: limitTextWindow(inputs.characterStateTable, 2200, 0.42),
    foreshadowTimeline: limitTextWindow(inputs.foreshadowTimeline, 2200, 0.42),
    chapterSummaries: limitTextWindow(inputs.chapterSummaries, 2200, 0.35),
    chapterGoal: limitTextWindow(inputs.chapterGoal, 900, 0.45),
  };
}

function applyTextField(id, value) {
  if (value === undefined || value === null) return false;
  const el = $(id);
  if (!el) return false;
  el.value = String(value);
  return true;
}

function updateStyleGuideMeta() {
  const project = getActiveProject();
  const meta = $("styleGuideMeta");
  if (!meta) return;

  const guideLength = $("styleGuide")?.value.trim().length || 0;
  const parts = [`文风锚点 ${guideLength} 字`];
  if (project?.styleReferenceTitle) {
    parts.push(`来源 ${project.styleReferenceTitle}`);
  }
  if (project?.styleDistilledAt) {
    parts.push(
      new Date(project.styleDistilledAt).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
  }
  meta.textContent = parts.join(" · ");
}

function updateStyleSourceStatus(extra = "") {
  const status = $("styleSourceStatus");
  if (!status) return;

  const parts = [];
  const referenceTitle = $("styleReferenceTitle")?.value.trim() || "";
  const pastedLength = $("styleSourceText")?.value.trim().length || 0;

  if (uploadedStyleSourceName) {
    parts.push(
      `已加载文件：${uploadedStyleSourceName}${uploadedStyleSourceEncoding ? ` (${uploadedStyleSourceEncoding})` : ""}`,
    );
  }
  if (referenceTitle) {
    parts.push(`参考名 ${referenceTitle}`);
  }
  if (pastedLength) {
    parts.push(`补充样文 ${pastedLength} 字`);
  }
  if (!parts.length) {
    parts.push("未加载文本，支持 UTF-8 / GB18030 常见 txt。原文只用于本次蒸馏，不会保存到项目。");
  }
  if (extra) {
    parts.push(extra);
  }
  status.textContent = parts.join(" · ");
}

function renderStyleDistillPreview(report = "") {
  const preview = $("styleDistillPreview");
  if (!preview) return;

  const content = String(report || "").trim();
  if (!content) {
    preview.innerHTML = `
      <div class="empty-state small">
        <p>暂无蒸馏结果</p>
        <span>导入参考文本后，右侧会保留最近一次文风蒸馏报告。</span>
      </div>
    `;
    return;
  }

  preview.innerHTML = DOMPurify.sanitize(marked.parse(content));
}

function setStyleDistillBusy(isBusy) {
  ["distillStyleReplace", "distillStyleAppend", "clearStyleSource", "closeStyleDistill", "styleSourceFile"].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = isBusy;
  });
  ["styleSourceText", "styleDistillFocus", "styleReferenceTitle"].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = isBusy;
  });
}

function normalizeStyleSource(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildStyleSamplingBlocks(text) {
  const normalized = normalizeStyleSource(text);
  if (!normalized) return [];

  const paragraphBlocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (paragraphBlocks.length >= 10) {
    return paragraphBlocks;
  }

  const sentenceChunks = normalized.match(/[\s\S]{1,220}(?:[。！？!?…]|$)/g) || [normalized];
  const blocks = [];
  let buffer = "";

  sentenceChunks.forEach((chunk) => {
    const piece = chunk.trim();
    if (!piece) return;
    const candidate = buffer ? `${buffer}${piece}` : piece;
    if (candidate.length > 320 && buffer) {
      blocks.push(buffer.trim());
      buffer = piece;
      return;
    }
    buffer = candidate;
  });

  if (buffer.trim()) {
    blocks.push(buffer.trim());
  }

  return blocks.filter(Boolean);
}

function scoreStyleSampleBlock(text) {
  const value = String(text || "");
  let score = Math.min(value.length, 420);
  score += (value.match(/[“”「」『』]/g) || []).length * 10;
  score += (value.match(/[，。！？；：]/g) || []).length * 2;
  if (/[风雨雪雷火血夜灯影骨]/.test(value)) score += 18;
  if (/[抬看握扣退站坐走笑骂喊]/.test(value)) score += 12;
  score -= Math.abs(value.length - 240) * 0.2;
  return score;
}

function sampleStyleSource(text, maxChars = 18000) {
  const normalized = normalizeStyleSource(text);
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;

  const blocks = buildStyleSamplingBlocks(normalized);
  if (!blocks.length) return limitText(normalized, maxChars);

  const windows = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const chunk = blocks.slice(index, Math.min(blocks.length, index + 2)).join("\n\n").trim();
    if (chunk.length < 80) continue;
    windows.push({ index, text: chunk, score: scoreStyleSampleBlock(chunk) });
  }

  if (!windows.length) return limitText(normalized, maxChars);

  const chosen = [];
  const used = new Set();
  let total = 0;

  const tryAdd = (item) => {
    if (!item || used.has(item.index)) return;
    const addition = item.text.length + 14;
    if (chosen.length && total + addition > maxChars) return;
    chosen.push(item);
    used.add(item.index);
    total += addition;
  };

  [0, 0.15, 0.35, 0.55, 0.75, 0.92].forEach((ratio) => {
    const target = windows[Math.min(windows.length - 1, Math.floor((windows.length - 1) * ratio))];
    tryAdd(target);
  });

  for (const item of windows.slice().sort((a, b) => b.score - a.score)) {
    if (total >= maxChars * 0.92 || chosen.length >= 10) break;
    tryAdd(item);
  }

  if (!chosen.length) {
    tryAdd(windows[0]);
  }

  return chosen
    .sort((a, b) => a.index - b.index)
    .map((item, idx) => `【片段 ${idx + 1}】\n${item.text}`)
    .join("\n\n");
}

function buildStyleDistillationContext() {
  const manualText = $("styleSourceText")?.value || "";
  const rawSource = normalizeStyleSource([uploadedStyleSourceText, manualText].filter(Boolean).join("\n\n"));
  if (!rawSource) return null;

  const project = getActiveProject();
  const title = $("styleReferenceTitle")?.value.trim()
    || uploadedStyleSourceName.replace(/\.[^.]+$/, "")
    || project?.styleReferenceTitle
    || "";

  return {
    rawSource,
    sampledSource: sampleStyleSource(rawSource, 18000),
    focus: $("styleDistillFocus")?.value.trim() || "",
    title,
    rawLength: rawSource.length,
  };
}

function styleDistillationPrompt(context) {
  return [
    "你是小说文风蒸馏器。",
    "任务：从参考文本中提炼可复用的写法资产，供同项目后续写作调用。",
    "只分析写法，不评价剧情，不复述设定，不保留专有名词，不照抄原句。",
    "如果参考文本来自长篇小说，只抓取句法节奏、叙述距离、对白组织、场景推进、动作与感官落点、段落呼吸和情绪收束方式。",
    context.focus ? `作者额外关注：${context.focus}` : "",
    `参考来源：${context.title || "未命名文本"}。原文约 ${context.rawLength} 字，本次抽样约 ${context.sampledSource.length} 字。`,
    "输出纯文本，控制在 2200-4200 字。",
    "严格使用以下结构：",
    "【风格定位】",
    "【句法与节奏】",
    "【叙述距离】",
    "【场景推进】",
    "【对白与动作】",
    "【高频有效手法】",
    "【避雷】",
    "【可直接写入文风锚点】",
    "最后一节必须写成后续模型可以直接执行的规则卡，尽量具体，可条目化，避免空话。",
  ].filter(Boolean).join("\n");
}


function extractStyleGuideFromReport(report) {
  const text = String(report || "").trim();
  const match = text.match(/【可直接写入文风锚点】\s*([\s\S]*)$/);
  return (match ? match[1] : text).trim();
}

function buildAppliedStyleGuide(report, mode, sourceTitle = "") {
  const core = extractStyleGuideFromReport(report);
  const nextBlock = [sourceTitle ? `【来源】${sourceTitle}` : "", core].filter(Boolean).join("\n");
  const existing = $("styleGuide").value.trim();
  if (mode === "append" && existing) {
    return `${existing}\n\n---\n\n${nextBlock}`;
  }
  return nextBlock;
}

function mockStyleDistillationReport(context) {
  return [
    "【风格定位】",
    `参考《${context.title || "未命名文本"}》抽样后，这份文风更偏近景叙事、动作承情、短促对白和克制收束。`,
    "",
    "【句法与节奏】",
    "- 长短句交替，不要整章都一个节拍。",
    "- 紧张段落压短句，安静段落允许句子舒展，但不要拖成说明文。",
    "",
    "【叙述距离】",
    "- 贴近主视角感知，不要站到作者席解释人物。",
    "",
    "【场景推进】",
    "- 每两三段至少有一次动作、视线、声音或空间变化。",
    "- 先让场景发生，再让情绪从动作里浮出来。",
    "",
    "【对白与动作】",
    "- 对白要带试探、回避、压迫或交换，不要只负责交代信息。",
    "- 重要对白前后配手势、停顿、位置变化。",
    "",
    "【高频有效手法】",
    "- 用物件和细小动作代替抽象情绪解释。",
    "- 段尾收在动作余波或气氛余压，不收在总结句。",
    "",
    "【避雷】",
    "- 不要连续使用“他知道 / 他明白 / 这意味着”。",
    "- 不要按提纲逐条翻译成正文。",
    "",
    "【可直接写入文风锚点】",
    "- 正文优先写成正在发生的场景，不写成提纲扩写稿。",
    "- 句长要有呼吸感，紧张处短，平静处放，但不要整齐划一。",
    "- 情绪不要先解释，先落在动作、对白、器物、光线、声音和空间变化上。",
    "- 段尾避免总结腔，收在悬念、停顿、动作余势或关系变化上。",
  ].join("\n");
}


function validateStyleDistillationAccess() {
  if (shouldUseControllerMock()) return;
  if (!$("openaiApiKey").value.trim()) throw new Error("请先在 API 配置里填写 OpenAI API Key");
  if (!($("writerModel").value.trim() || $("controllerModel").value.trim())) {
    throw new Error("请先填写 writerModel 或 controllerModel");
  }
}

async function readStyleSourceFile(file) {
  const buffer = await file.arrayBuffer();
  const attempts = ["utf-8", "gb18030", "gbk"];

  for (const encoding of attempts) {
    try {
      const text = new TextDecoder(encoding, { fatal: true }).decode(buffer);
      return { text, encoding };
    } catch {
      // Try the next decoder.
    }
  }

  return {
    text: new TextDecoder("utf-8").decode(buffer),
    encoding: "utf-8",
  };
}

async function distillStyleGuide(mode = "replace") {
  if (currentAbortController) {
    alert("当前还有请求在运行，请先停止或等待完成。");
    return;
  }

  const context = buildStyleDistillationContext();
  if (!context) {
    alert("请先导入 txt 或粘贴参考样文。");
    return;
  }

  currentAbortController = new AbortController();
  setControllerBusy(true);
  setStyleDistillBusy(true);
  setStatus("文风蒸馏中", "running");

  try {
    validateStyleDistillationAccess();
    const report = shouldUseControllerMock()
      ? mockStyleDistillationReport(context)
      : await callOpenAI({
          model: $("writerModel").value.trim() || $("controllerModel").value.trim(),
          signal: currentAbortController.signal,
          temperature: 0.42,
          messages: [
            { role: "system", content: styleDistillationPrompt(context) },
            { role: "user", content: context.sampledSource },
          ],
        });

    const cleanReport = report.trim();
    const project = getActiveProject();
    project.styleDistillationReport = cleanReport;
    project.styleReferenceTitle = context.title || project.styleReferenceTitle || "";
    project.styleDistilledAt = Date.now();

    $("styleGuide").value = buildAppliedStyleGuide(cleanReport, mode, project.styleReferenceTitle);
    renderStyleDistillPreview(cleanReport);
    updateStyleGuideMeta();
    renderWorkflowRail();
    appendOutput(mode === "append" ? "文风蒸馏（追加）" : "文风蒸馏", cleanReport);
    appendControllerMessage(
      "system",
      `已完成文风蒸馏，并${mode === "append" ? "追加到" : "覆盖"}文风锚点。${project.styleReferenceTitle ? `\n参考来源：${project.styleReferenceTitle}` : ""}`,
    );
    persistConfig();
    setStatus("文风蒸馏完成", "done");
  } catch (error) {
    if (error.name === "AbortError") {
      appendControllerMessage("system", "文风蒸馏已停止。");
      setStatus("已停止", "");
    } else {
      appendControllerMessage("system", `文风蒸馏失败：${error.message}`);
      setStatus("失败", "");
    }
  } finally {
    currentAbortController = null;
    setStyleDistillBusy(false);
    setControllerBusy(false);
  }
}

function mockControllerReply(text) {
  return [
    "我会先把这个项目当成长篇来控盘。",
    `当前我抓到的核心需求是：${text.slice(0, 120)}`,
    "下一步建议补齐主角长期欲望、第一卷反派压力、每章结尾要保留的悬念层级。确认后可以沉淀到下方。",
  ].join("\n\n");
}

function mockControllerAnalysis() {
  const userMessages = controllerMessages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n\n");
  const source = userMessages || "未命名长篇";
  return {
    bible: `项目定位：根据作者主控需求建立长篇小说项目。\n原始需求：${source}\n主控原则：先压实世界观、人物欲望、反派压力和信息揭示边界，再进入章节生成。`,
    codex: "待建档：从主控对话中抽取人物、身份、势力、地点、法宝术语和禁写项。",
    outline: "全书主线：围绕作者需求推进主角长期目标与核心冲突。",
    volumeOutline: "当前卷目标：建立主角当前阶段困境、主要阻力和卷末转折。",
    hooks: "H-001：作者需求中的核心悬念需要持续推进。\nH-002：主角长期欲望、阻力来源和阶段代价需要保持连续。",
    foreshadowLedger: "F-001：核心悬念｜状态：未触发｜计划：当前卷持续推进并延后回收。",
    volumeSummary: "当前卷摘要：刚建卷，优先建立主角困境、外部压迫和卷末门槛。",
    phaseSummary: "当前阶段摘要：先压实主角处境、敌我位置和下一步动作。",
    characterStateTable: "主角｜待确认身份｜当前位置待确认｜当前状态待确认｜禁写项待补充",
    foreshadowTimeline: "F-001｜核心悬念｜未触发｜主控需求阶段｜待推进｜待回收｜主角",
    chapterSummaries: "",
    activeVolume: {
      title: "第一卷：困局初开",
      status: "规划中",
      chapterRange: "第1章-第12章",
      summary: "当前卷先建立主角困局、主要阻力和卷末门槛。",
      outline: "卷首建立处境与欲望；卷中持续加压；卷末以一次代价明确的转折收束。",
      content: "",
      keyChars: "主角｜待确认身份\n主要反派｜待确认\n关键势力｜待确认",
      keyHooks: "主角长期欲望的真实代价\n当前卷阻力来源\n卷末转折触发条件",
      notes: "本卷先立局，不提前揭穿终局底牌。",
    },
    chapterGoal: "本章目标：基于当前主控对话，明确本章事件推进、情绪转折、信息边界和结尾钩子。",
    reply: "当前仍处于模拟沉淀；已按主控对话生成一版临时结构。",
  };
}

function parseJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1].trim() : text.trim();

  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("主控没有返回可解析的 JSON，请重试“沉淀到下方”。");
    }
    return JSON.parse(raw.slice(start, end + 1));
  }
}

async function callControllerReplyWithTimeoutFallback() {
  try {
    return await callOpenAI({
      model: $("controllerModel").value.trim(),
      signal: currentAbortController.signal,
      temperature: 0.45,
      messages: [
        { role: "system", content: leanControllerSystemPrompt() },
        ...modelReadyMessages({ compact: false }),
      ],
    });
  } catch (error) {
    if (!isTimeoutLikeError(error) || workflowAborted) throw error;
    appendControllerMessage("system", "主控上游超时，已自动压缩上下文重试一次。");
    return callOpenAI({
      model: $("controllerModel").value.trim(),
      signal: currentAbortController.signal,
      temperature: 0.35,
      messages: [
        { role: "system", content: leanControllerSystemPrompt() },
        ...modelReadyMessages({ compact: true }),
      ],
    });
  }
}

function buildControllerAnalysisUserContent({ latestUserNeed, existingInputs }) {
  return [
    "请立刻沉淀成 JSON。",
    "作者在主控对话中的需求如下，这是最高优先级：",
    latestUserNeed,
    "下方已有创作输入和工程记忆如下，它们可能来自旧项目或旧样例，只能作为低优先级参考：",
    existingInputs,
    "如果旧输入里出现主控对话没有确认的人名、设定、章节目标，必须删除，不得沿用。",
  ].join("\n\n");
}

async function callControllerAnalysisWithTimeoutFallback({ latestUserNeed, existingInputs }) {
  const firstPayload = {
    latestUserNeed: limitTextWindow(latestUserNeed, 7000, 0.45),
    existingInputs: limitTextWindow(existingInputs, 7000, 0.45),
  };
  try {
    return await callOpenAI({
      model: $("controllerModel").value.trim(),
      signal: currentAbortController.signal,
      temperature: 0.25,
      messages: [
        { role: "system", content: controllerAnalysisPrompt() },
        ...modelReadyMessages({ compact: false }),
        { role: "user", content: buildControllerAnalysisUserContent(firstPayload) },
      ],
    });
  } catch (error) {
    if (!isTimeoutLikeError(error) || workflowAborted) throw error;
    appendControllerMessage("system", "沉淀上游超时，已自动压缩上下文重试一次。");
    return callOpenAI({
      model: $("controllerModel").value.trim(),
      signal: currentAbortController.signal,
      temperature: 0.2,
      messages: [
        { role: "system", content: `${controllerAnalysisPrompt()}\n\n本次是超时后的紧凑重试，只保留最新需求和必要旧输入，必须返回 JSON。` },
        ...modelReadyMessages({ compact: true }),
        {
          role: "user",
          content: buildControllerAnalysisUserContent({
            latestUserNeed: limitTextWindow(latestUserNeed, 3600, 0.35),
            existingInputs: limitTextWindow(existingInputs, 3200, 0.35),
          }),
        },
      ],
    });
  }
}

async function sendControllerMessage() {
  const input = $("controllerInput");
  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  appendControllerMessage("user", text);
  currentAbortController = new AbortController();
  setControllerBusy(true);
  setFlowState("controller", "active");
  setStatus("主控思考中", "running");

  try {
    validateControllerAccess();
    const reply = shouldUseControllerMock()
      ? mockControllerReply(text)
      : await callControllerReplyWithTimeoutFallback();

    appendControllerMessage("assistant", reply);
    setFlowState("controller", "done");
    setStatus("主控已回复", "done");
  } catch (error) {
    if (error.name === "AbortError") {
      appendControllerMessage("system", "主控请求已停止。");
      setStatus("已停止", "");
    } else {
      appendControllerMessage("system", `主控错误：${error.message}`);
      setStatus("失败", "");
    }
  } finally {
    currentAbortController = null;
    setControllerBusy(false);
  }
}

async function analyzeControllerConversation() {
  if (!controllerMessages.some((message) => message.role === "user")) {
    appendControllerMessage("system", "请先至少发送一条需求给主控。");
    return;
  }

  currentAbortController = new AbortController();
  setControllerBusy(true);
  setFlowState("analysis", "active");
  setStatus("沉淀中", "running");

  try {
    validateControllerAccess();
    let planningContext = null;
    try {
      planningContext = await fetchProjectPlanningContextFromServer(activeProjectId, 6);
    } catch (error) {
      console.warn("Failed to fetch planning context for controller analysis:", error);
    }
    const existingInputs = JSON.stringify(
      compactInputsForModel(
        buildInputsFromPlanningContext(planningContext, getInputs()),
      ),
      null,
      2,
    );
    const latestUserNeed = buildControllerNeedText(8500);
    const analysis = shouldUseControllerMock()
      ? mockControllerAnalysis()
      : parseJsonObject(await callControllerAnalysisWithTimeoutFallback({ latestUserNeed, existingInputs }));

    applyTextField("bible", analysis.bible);
    applyTextField("codex", analysis.codex);
    applyTextField("outline", analysis.outline);
    updateActiveVolumeFromController(analysis);
    applyTextField("hooks", analysis.hooks);
    applyTextField("foreshadowLedger", analysis.foreshadowLedger);
    applyTextField("volumeSummary", analysis.volumeSummary);
    applyTextField("phaseSummary", analysis.phaseSummary);
    applyTextField("characterStateTable", analysis.characterStateTable);
    applyTextField("foreshadowTimeline", analysis.foreshadowTimeline);
    applyTextField("chapterSummaries", analysis.chapterSummaries);
    applyTextField("chapterGoal", analysis.chapterGoal);
    try {
      await writebackProjectMemoryToServer(getActiveProject().id, {
        memory: {
          codex: $("codex").value.trim(),
          outline: $("outline").value.trim(),
          hooks: $("hooks").value.trim(),
          foreshadowLedger: $("foreshadowLedger").value.trim(),
          volumeSummary: $("volumeSummary").value.trim(),
          phaseSummary: $("phaseSummary").value.trim(),
          characterStateTable: $("characterStateTable").value.trim(),
          foreshadowTimeline: $("foreshadowTimeline").value.trim(),
          chapterSummaries: $("chapterSummaries").value.trim(),
          chapterGoal: $("chapterGoal").value.trim(),
        },
        activeVolume: buildActiveVolumeContext(),
        activeVolumeId: getActiveProject().activeVolumeId || "",
      });
      await syncProjectControllerStateFromServer(getActiveProject().id, { render: true });
    } catch (error) {
      console.warn("Failed to write controller analysis back to server:", error);
    }
    appendControllerMessage("assistant", analysis.reply || "已沉淀到下方创作输入。");
    setFlowState("analysis", "done");
    persistConfig();
    setStatus("已沉淀", "done");
  } catch (error) {
    if (error.name === "AbortError") {
      appendControllerMessage("system", "沉淀请求已停止。");
      setStatus("已停止", "");
    } else {
      appendControllerMessage("system", `沉淀失败：${error.message}`);
      setStatus("失败", "");
    }
  } finally {
    currentAbortController = null;
    setControllerBusy(false);
  }
}

function nextChapterPrompt() {
  return [
    "你是长篇小说项目的主控编辑，负责在每章完成后维护项目状态并推进下一章。",
    "必须读取当前选中章节正文、章节摘要库、小说圣经、设定档案、全书大纲、当前卷大纲、伏笔账本、人物状态表和主控对话。",
    "你会收到 currentChapterNumber 和 targetChapterNumber。chapterGoal 必须以目标章节编号开头，不得回退到旧章节。",
    "先判断当前卷目标是否完成；如果完成，设置 volumeCompleted=true，并在需要时切换到下一卷。",
    "只返回 JSON，不要 Markdown，不要解释。",
    "JSON 字段必须包含：",
    "{",
    '  "bible": "更新后的小说圣经",',
    '  "codex": "更新后的设定档案",',
    '  "outline": "更新后的全书大纲",',
    '  "volumeOutline": "更新后的当前卷大纲",',
    '  "hooks": "更新后的当前钩子",',
    '  "foreshadowLedger": "更新后的伏笔账本",',
    '  "volumeSummary": "更新后的卷摘要",',
    '  "phaseSummary": "更新后的阶段摘要",',
    '  "characterStateTable": "更新后的人物状态表",',
    '  "foreshadowTimeline": "更新后的伏笔生命周期",',
    '  "chapterSummaries": "更新后的章节摘要库",',
    '  "activeVolume": { "status": "当前卷状态", "chapterRange": "章节范围", "summary": "卷目标摘要", "outline": "卷大纲", "content": "卷内沉淀", "keyChars": "关键人物", "keyHooks": "关键钩子", "notes": "备注" },',
    '  "volumeCompleted": false,',
    '  "switchToNextVolume": false,',
    '  "nextVolumeTitle": "",',
    '  "chapterGoal": "第 targetChapterNumber 章目标：事件推进、情绪转折、信息边界、结尾钩子",',
    '  "stateNote": "上一章状态摘要",',
    '  "reply": "给作者的简短说明"',
    "}",
  ].join("\n");
}
function mockNextChapterPlan() {
  const inputs = getInputs();
  const activeVolume = inputs.activeVolume || buildActiveVolumeContext();
  const nextNumber = inferNextChapterNumber(getActiveProject(), getReferenceChapter(getActiveProject()));
  return {
    bible: inputs.bible,
    codex: inputs.codex,
    outline: inputs.outline,
    volumeOutline: inputs.volumeOutline,
    activeVolume: {
      title: activeVolume.title || "当前卷",
      status: activeVolume.status || "在写",
      chapterRange: activeVolume.chapterRange || mergeChapterRange("", nextNumber),
      summary: activeVolume.summary || inputs.volumeSummary,
      outline: activeVolume.outline || inputs.volumeOutline,
      content: activeVolume.content || "",
      keyChars: activeVolume.keyChars || "",
      keyHooks: mergeUniqueLineBlocks(activeVolume.keyHooks, "下一章需要承接上一章结尾的新压力"),
      notes: activeVolume.notes || "",
    },
    hooks: `${inputs.hooks}\nH-NEXT：承接上一章结尾，下一章需要把新冲突推进到可行动场面。`.trim(),
    foreshadowLedger: inputs.foreshadowLedger,
    volumeSummary: inputs.volumeSummary,
    phaseSummary: inputs.phaseSummary,
    characterStateTable: inputs.characterStateTable,
    foreshadowTimeline: inputs.foreshadowTimeline,
    chapterSummaries: inputs.chapterSummaries,
    volumeCompleted: false,
    switchToNextVolume: false,
    nextVolumeTitle: "",
    chapterGoal: `第${nextNumber}章目标：承接上一章结尾，推动主角面对新的阻力；保留核心谜底不揭示，只展示新的线索、代价和结尾钩子。`,
    stateNote: "模拟状态摘要：上一章已完成当前事件推进，下一章需要承接结尾继续加压。",
    reply: "当前是模拟推进。若要让模型读取上下文规划下一章，请关闭模拟模式或填写 API 配置。",
  };
}

async function advanceChapterGoal() {
  const project = getActiveProject();
  let planningContext = null;
  try {
    planningContext = await fetchProjectPlanningContextFromServer(project.id, 6);
  } catch (error) {
    console.warn("Failed to fetch planning context for next chapter:", error);
  }
  if (planningContext?.recentChapters?.length) {
    applyChapterPayloadToProject(project, {
      chapters: planningContext.recentChapters,
      activeChapterId: planningContext.activeChapterId || project.activeChapterId,
      updatedAt: planningContext.updatedAt || project.updatedAt,
    });
  }
  const referenceChapter = getReferenceChapter(project);
  const workflowSnapshot = buildLatestWorkflowSnapshot();
  const latestChapter = referenceChapter
    ? {
        id: referenceChapter.id,
        title: referenceChapter.title,
        content: referenceChapter.content.slice(-16000),
        goal: referenceChapter.goal,
        hooksSnapshot: referenceChapter.hooksSnapshot,
        summary: referenceChapter.summary,
        createdAt: referenceChapter.createdAt,
        updatedAt: referenceChapter.updatedAt,
      }
    : null;

  if (!latestChapter) {
    appendControllerMessage("system", "请先运行当前章节工作流，生成并保存上一章正文后再推进下一章。");
    return;
  }

  if (getChapterStatusLabel(referenceChapter.status) !== CHAPTER_STATUS.WRITTEN_BACK) {
    appendControllerMessage("system", "当前章节还没有完成回写，先完成本章回写，再生成下一章目标。");
    setStatus("请先完成本章回写", "");
    return;
  }
  currentAbortController = new AbortController();
  setControllerBusy(true);
  setFlowState("next", "active");
  setStatus("规划下一章", "running");

  try {
    validateControllerAccess();
    const currentChapterNumber = getChapterNumberFromEntity(referenceChapter);
    const targetChapterNumber = inferNextChapterNumber(project, referenceChapter);
    const recentChapters = (planningContext?.recentChapters?.length
      ? planningContext.recentChapters
      : [referenceChapter, ...(project.chapters || []).filter((chapter) => chapter.id !== referenceChapter.id)])
      .slice(0, 6)
      .map((chapter) => ({
        title: chapter.title,
        volumeId: chapter.volumeId || "",
        volumeTitle: chapter.volumeTitle || "",
        content: limitTextWindow(chapter.content, 5000, 0.28),
        goal: limitTextWindow(chapter.goal, 900, 0.42),
        summary: limitTextWindow(chapter.summary, 900, 0.42),
        hooksSnapshot: limitTextWindow(chapter.hooksSnapshot, 1000, 0.42),
        createdAt: chapter.createdAt,
        updatedAt: chapter.updatedAt,
      }));

    const effectiveInputs = buildInputsFromPlanningContext(planningContext, getInputs());

    const context = {
      projectTitle: planningContext?.projectTitle || $("projectTitle").value.trim(),
      ...compactInputsForModel(effectiveInputs),
      volumes: (project.volumes || []).map((volume) => ({
        id: volume.id,
        title: volume.title,
        status: volume.status,
        chapterRange: volume.chapterRange,
        summary: limitTextWindow(volume.summary, 500, 0.55),
        outline: limitTextWindow(volume.outline, 800, 0.45),
      })),
      currentChapterNumber,
      targetChapterNumber,
      controllerMessages: planningContext?.controllerMessages?.length
        ? planningContext.controllerMessages
        : modelReadyMessages(),
      latestChapter,
      recentChapters,
      workflowSnapshot,
    };

    const analysis = shouldUseControllerMock()
      ? mockNextChapterPlan()
      : parseJsonObject(await callOpenAI({
          model: $("controllerModel").value.trim(),
          signal: currentAbortController.signal,
          messages: [
            { role: "system", content: await withSkill("controller", nextChapterPrompt()) },
            { role: "user", content: `请读取以下上下文，生成第 ${targetChapterNumber} 章的 bible、hooks 和 chapterGoal。chapterGoal 必须以“第 ${targetChapterNumber} 章目标：”开头。\n${JSON.stringify(context, null, 2)}` },
          ],
        }));

    applyTextField("bible", analysis.bible);
    applyTextField("codex", analysis.codex);
    applyTextField("outline", analysis.outline);
    applyTextField("hooks", analysis.hooks);
    applyTextField("foreshadowLedger", analysis.foreshadowLedger);
    applyTextField("volumeSummary", analysis.volumeSummary);
    applyTextField("phaseSummary", analysis.phaseSummary);
    applyTextField("characterStateTable", analysis.characterStateTable);
    applyTextField("foreshadowTimeline", analysis.foreshadowTimeline);
    applyTextField("chapterSummaries", analysis.chapterSummaries);
    const shouldAdvanceVolume = analysis.switchToNextVolume || isCurrentVolumeCompleted(project, analysis, referenceChapter);
    if (shouldAdvanceVolume) {
      advanceToNextVolume(project, {
        currentStatus: "完成",
        nextVolumeTitle: analysis.nextVolumeTitle,
        nextVolumeSummary: analysis.activeVolume?.summary,
        nextVolumeOutline: analysis.activeVolume?.outline || analysis.volumeOutline,
      });
    }
    updateActiveVolumeFromWorkflow(analysis, shouldAdvanceVolume ? null : referenceChapter);
    if (analysis.volumeOutline) syncActiveVolumeOutline(project);
    const chapterGoal = analysis.chapterGoal || "";
    if (chapterGoal) {
      $("chapterGoal").value = chapterGoal.includes(`第${targetChapterNumber}章`)
        ? chapterGoal
        : `第${targetChapterNumber}章目标：${chapterGoal.replace(/^第\s*[0-9零一二三四五六七八九十百千万]+\s*[章节回]\s*目标[:：]?/, "").trim()}`;
    }
    appendControllerMessage(
      "assistant",
      [analysis.reply || "已根据上一章结果推进到下一章目标。", analysis.stateNote ? `\n上一章状态摘要：\n${analysis.stateNote}` : ""].join("")
    );
    const planningChapter = ensurePlanningChapterForCurrentGoal(project);
    if (planningChapter) {
      await saveProjectChapterToServer(project.id, planningChapter, planningChapter.id);
    }
    try {
      await writebackProjectMemoryToServer(project.id, {
        memory: {
          codex: $("codex").value.trim(),
          outline: $("outline").value.trim(),
          hooks: $("hooks").value.trim(),
          foreshadowLedger: $("foreshadowLedger").value.trim(),
          volumeSummary: $("volumeSummary").value.trim(),
          phaseSummary: $("phaseSummary").value.trim(),
          characterStateTable: $("characterStateTable").value.trim(),
          foreshadowTimeline: $("foreshadowTimeline").value.trim(),
          chapterSummaries: $("chapterSummaries").value.trim(),
          chapterGoal: $("chapterGoal").value.trim(),
        },
        activeVolume: buildActiveVolumeContext(),
        activeVolumeId: getActiveProject().activeVolumeId || "",
        activeChapterId: planningChapter?.id || "",
        chapter: planningChapter || undefined,
      });
    } catch (error) {
      console.warn("Failed to persist next chapter planning:", error);
    }
    renderChapterLibrary();
    setFlowState("next", "done");
    persistConfig();
    setStatus("下一章已就绪", "done");
  } catch (error) {
    if (error.name === "AbortError") {
      appendControllerMessage("system", "下一章规划已停止。");
      setStatus("已停止", "");
    } else {
      appendControllerMessage("system", `下一章规划失败：${error.message}`);
      setStatus("失败", "");
    }
  } finally {
    currentAbortController = null;
    setControllerBusy(false);
  }
}

function codexMergePrompt() {
  return [
    "你是长篇小说长期记忆管理员。",
    "根据旧长期记忆、当前卷、本章目标、正文草稿、审稿意见和状态更新，合并出新的长期记忆。",
    "章节摘要只记录已经发生的事实；设定档案只保留明确出现或被确认的信息；不确定信息标为待确认。",
    "只返回 JSON，不要 Markdown，不要解释。",
    "JSON 字段必须包含：",
    "{",
    '  "codex": "更新后的设定档案",',
    '  "outline": "更新后的全书大纲",',
    '  "volumeOutline": "更新后的当前卷大纲",',
    '  "foreshadowLedger": "更新后的伏笔账本",',
    '  "volumeSummary": "更新后的卷摘要",',
    '  "phaseSummary": "更新后的阶段摘要",',
    '  "characterStateTable": "更新后的人物状态表",',
    '  "foreshadowTimeline": "更新后的伏笔生命周期",',
    '  "chapterSummaries": "更新后的章节摘要库",',
    '  "chapterSummary": "本章新增摘要",',
    '  "activeVolume": { "status": "当前卷状态", "chapterRange": "章节范围", "summary": "卷摘要", "outline": "卷大纲", "content": "卷内沉淀", "keyChars": "关键人物", "keyHooks": "关键钩子", "notes": "备注" }',
    "}",
  ].join("\n");
}
function updateActiveVolumeFromWorkflow(updated = {}, chapter = null) {
  const project = getActiveProject();
  const volume = ensureActiveVolume(project);
  if (!project || !volume) return null;

  const volumeUpdate = updated.activeVolume || {};
  const chapterNumber = getChapterNumberFromEntity(chapter);

  if (volumeUpdate.title !== undefined && volumeUpdate.title !== null) {
    volume.title = String(volumeUpdate.title).trim() || volume.title;
  }
  if (volumeUpdate.status !== undefined && volumeUpdate.status !== null) {
    const nextStatus = String(volumeUpdate.status).trim();
    if (nextStatus) volume.status = nextStatus;
  }

  volume.chapterRange = mergeChapterRange(
    String(volumeUpdate.chapterRange || volume.chapterRange || "").trim(),
    chapterNumber,
  );

  if (volumeUpdate.summary !== undefined && volumeUpdate.summary !== null) {
    const nextSummary = String(volumeUpdate.summary).trim();
    if (nextSummary) volume.summary = nextSummary;
  }
  if (updated.volumeSummary && !volume.summary) {
    volume.summary = String(updated.volumeSummary).trim();
  }

  if (volumeUpdate.outline !== undefined && volumeUpdate.outline !== null) {
    const nextOutline = String(volumeUpdate.outline).trim();
    if (nextOutline) volume.outline = nextOutline;
  }
  if (updated.volumeOutline && !volume.outline) {
    volume.outline = String(updated.volumeOutline).trim();
  }

  if (volumeUpdate.content !== undefined && volumeUpdate.content !== null) {
    const nextContent = String(volumeUpdate.content).trim();
    if (nextContent) volume.content = nextContent;
  }

  const chapterSummary = String(updated.chapterSummary || chapter?.summary || "").trim();
  if (chapterSummary) {
    const chapterLabel = chapter?.title || "本章";
    const addition = `${chapterLabel}：${chapterSummary}`;
    if (!String(volume.content || "").includes(addition)) {
      volume.content = [volume.content, addition].filter(Boolean).join("\n\n");
    }
  }

  volume.keyChars = mergeUniqueLineBlocks(
    volume.keyChars,
    volumeUpdate.keyChars,
    chapter?.volumeTitle ? `归属卷：${chapter.volumeTitle}` : "",
  );

  volume.keyHooks = mergeUniqueLineBlocks(
    volume.keyHooks,
    updated.hooks,
    updated.foreshadowLedger,
    volumeUpdate.keyHooks,
  );

  if (volumeUpdate.notes !== undefined && volumeUpdate.notes !== null) {
    const nextNotes = String(volumeUpdate.notes).trim();
    if (nextNotes) volume.notes = nextNotes;
  }

  if (chapter) {
    chapter.volumeId = volume.id;
    chapter.volumeTitle = volume.title;
  }

  volume.updatedAt = Date.now();
  project.activeVolumeId = volume.id;
  project.volumeOutline = composeVolumeOutlineText(volume);
  if ($("volumeOutline")) $("volumeOutline").value = project.volumeOutline;
  return volume;
}

function buildRecentChapterContext(limit = 6, contentMax = 3200) {
  const project = getActiveProject();
  return [...(project.chapters || [])]
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
    .slice(0, limit)
    .map((chapter) => ({
      title: chapter.title,
      volumeId: chapter.volumeId || "",
      volumeTitle: chapter.volumeTitle || "",
      summary: limitTextWindow(chapter.summary, 900, 0.55),
      goal: limitTextWindow(chapter.goal, 700, 0.55),
      content: limitTextWindow(chapter.content, contentMax, 0.25),
      updatedAt: chapter.updatedAt,
    }));
}

function engineeringMemoryPrompt() {
  return [
    "你是长篇小说工程记忆整理员。",
    "根据项目记忆、当前卷、钩子账本、人物状态表和最近章节，整理后续写作要用的工程记忆。",
    "只保留可回查、可校验、能约束后续正文的信息。",
    "只返回 JSON，不要 Markdown，不要解释。",
    "{",
    '  "volumeSummary": "卷摘要",',
    '  "phaseSummary": "阶段摘要",',
    '  "characterStateTable": "人物状态表",',
    '  "foreshadowTimeline": "伏笔生命周期"',
    "}",
  ].join("\n");
}
function projectConsistencyPrompt() {
  return [
    "你是长篇小说批量一致性审核员。",
    "任务：检查设定档案、人物状态表、伏笔生命周期、章节摘要库和最近章节之间的批量一致性问题。",
    "重点抓：错名、别名混乱、称呼错位、阵营或地点归属错误、人物状态断裂、伏笔状态不一致、境界或术语漂移。",
    "如果发现问题，必须给出“当前写法 -> 建议统一写法 -> 影响范围”。",
    "如果没有明显问题，也要指出仍需盯住的高风险点。",
    "输出 Markdown，使用以下结构：",
    "## 总览",
    "## 高风险错名 / 校设定",
    "## 人物状态断裂",
    "## 伏笔生命周期异常",
    "## 建议修正顺序",
  ].join("\n");
}


async function refreshEngineeringMemory() {
  currentAbortController = new AbortController();
  setControllerBusy(true);
  setStatus("鍒锋柊宸ョ▼璁板繂", "running");

  try {
    validateControllerAccess();
    const context = {
      projectTitle: $("projectTitle").value.trim(),
      memory: compactInputsForModel(),
      recentChapters: buildRecentChapterContext(6, 2600),
    };

    const result = shouldUseControllerMock()
      ? {
          volumeSummary: $("volumeSummary").value.trim() || "当前卷仍处于推进阶段，建议在跑完 2-3 章后刷新真实卷摘要。",
          phaseSummary: $("phaseSummary").value.trim() || "当前阶段重点仍是推进主冲突并保持人物状态连续。",
          characterStateTable: $("characterStateTable").value.trim() || "主角｜待补完｜当前位置待确认｜状态待确认｜关系待确认｜禁止写错项待补完",
          foreshadowTimeline: $("foreshadowTimeline").value.trim() || "F-001｜核心悬念｜未触发｜待确认｜待推进｜待回收｜主角",
        }
      : parseJsonObject(await callOpenAI({
          model: $("controllerModel").value.trim(),
          signal: currentAbortController.signal,
          messages: [
            { role: "system", content: engineeringMemoryPrompt() },
            { role: "user", content: `请刷新当前项目的工程记忆：\n${JSON.stringify(context, null, 2)}` },
          ],
        }));

    $("volumeSummary").value = result.volumeSummary || $("volumeSummary").value;
    $("phaseSummary").value = result.phaseSummary || $("phaseSummary").value;
    $("characterStateTable").value = result.characterStateTable || $("characterStateTable").value;
    $("foreshadowTimeline").value = result.foreshadowTimeline || $("foreshadowTimeline").value;
    try {
      await writebackProjectMemoryToServer(getActiveProject().id, {
        memory: {
          volumeSummary: $("volumeSummary").value.trim(),
          phaseSummary: $("phaseSummary").value.trim(),
          characterStateTable: $("characterStateTable").value.trim(),
          foreshadowTimeline: $("foreshadowTimeline").value.trim(),
          hooks: $("hooks").value.trim(),
          foreshadowLedger: $("foreshadowLedger").value.trim(),
          codex: $("codex").value.trim(),
          outline: $("outline").value.trim(),
          chapterSummaries: $("chapterSummaries").value.trim(),
          chapterGoal: $("chapterGoal").value.trim(),
        },
        activeVolume: buildActiveVolumeContext(),
        activeVolumeId: getActiveProject().activeVolumeId || "",
      });
      await syncProjectControllerStateFromServer(getActiveProject().id, { render: true });
    } catch (error) {
      console.warn("Failed to persist engineering memory refresh:", error);
    }
    renderWorkflowRail();
    appendControllerMessage("system", "已刷新卷摘要、阶段摘要、人物状态表和伏笔生命周期。");
    persistConfig();
    setStatus("工程记忆已刷新", "done");
  } catch (error) {
    if (error.name === "AbortError") {
      appendControllerMessage("system", "工程记忆刷新已停止。");
      setStatus("已停止", "");
    } else {
      appendControllerMessage("system", `工程记忆刷新失败：${error.message}`);
      setStatus("失败", "");
    }
  } finally {
    currentAbortController = null;
    setControllerBusy(false);
  }
}

async function batchValidateProject() {
  currentAbortController = new AbortController();
  setControllerBusy(true);
  setStatus("批量校验中", "running");

  try {
    validateControllerAccess();
    const useGemini = Boolean($("geminiApiKey").value.trim() && $("geminiModel").value.trim());
    const caller = useGemini ? callGemini : callOpenAI;
    const model = useGemini ? $("geminiModel").value.trim() : $("controllerModel").value.trim();
    const context = {
      projectTitle: $("projectTitle").value.trim(),
      memory: compactInputsForModel(),
      recentChapters: buildRecentChapterContext(10, 2200),
    };

    const report = shouldUseControllerMock()
      ? [
          "## 总览",
          "当前仍是模拟校验，真实项目请关闭模拟模式后重跑。",
          "",
          "## 高风险错名 / 校设定",
          "- 暂无真实校验结果。",
          "",
          "## 人物状态断裂",
          "- 暂无真实校验结果。",
          "",
          "## 伏笔生命周期异常",
          "- 暂无真实校验结果。",
          "",
          "## 建议修正顺序",
          "1. 先补齐设定档案和人物状态表。",
        ].join("\n")
      : await caller({
          model,
          signal: currentAbortController.signal,
          temperature: 0.25,
          messages: [
            { role: "system", content: projectConsistencyPrompt() },
            { role: "user", content: `请批量检查本项目最近章节与长期记忆的一致性：\n${JSON.stringify(context, null, 2)}` },
          ],
        });

    appendOutput("批量校名 / 校设定", report);
    appendControllerMessage("system", "已完成一轮批量校名 / 校设定检查，结果已写入生成画布。");
    setStatus("批量校验完成", "done");
  } catch (error) {
    if (error.name === "AbortError") {
      appendControllerMessage("system", "批量校验已停止。");
      setStatus("已停止", "");
    } else {
      appendControllerMessage("system", `批量校验失败：${error.message}`);
      setStatus("失败", "");
    }
  } finally {
    currentAbortController = null;
    setControllerBusy(false);
  }
}

async function mergeCodexFromWorkflow({ draftResult, auditResult, extractResult }) {
  if (shouldUseControllerMock()) {
    const chapter = activeChapterId
      ? getActiveProject().chapters?.find((item) => item.id === activeChapterId)
      : null;
    const fallbackSummary = limitTextWindow(String(draftResult || "").replace(/\n+/g, " "), 420, 0.2);
    if (chapter && !chapter.summary) {
      chapter.summary = `模拟摘要：${fallbackSummary}`;
    }
    if (chapter) {
      setChapterStatus(chapter, CHAPTER_STATUS.WRITTEN_BACK);
    }
    const volume = updateActiveVolumeFromWorkflow({
      chapterSummary: chapter?.summary || fallbackSummary,
      activeVolume: {
        status: "在写",
        content: [getActiveVolume()?.content, `${chapter?.title || "本章"}：${chapter?.summary || fallbackSummary}`].filter(Boolean).join("\n\n"),
      },
    }, chapter);
    const completionReview = getVolumeCompletionReview(getActiveProject(), null, chapter);
    if (completionReview.completed && volume) {
      volume.status = "完成";
      syncActiveVolumeOutline(getActiveProject());
    }
    appendOutput("卷完成度", formatVolumeCompletionReview(completionReview));
    try {
      await writebackProjectMemoryToServer(getActiveProject().id, {
        memory: {
          codex: $("codex").value.trim(),
          outline: $("outline").value.trim(),
          hooks: $("hooks").value.trim(),
          foreshadowLedger: $("foreshadowLedger").value.trim(),
          volumeSummary: $("volumeSummary").value.trim(),
          phaseSummary: $("phaseSummary").value.trim(),
          characterStateTable: $("characterStateTable").value.trim(),
          foreshadowTimeline: $("foreshadowTimeline").value.trim(),
          chapterSummaries: $("chapterSummaries").value.trim(),
          chapterGoal: $("chapterGoal").value.trim(),
        },
        activeVolume: buildActiveVolumeContext(),
        activeVolumeId: getActiveProject().activeVolumeId || volume?.id || "",
        activeChapterId: chapter?.id || "",
        chapter,
      });
      await syncProjectControllerStateFromServer(getActiveProject().id, { render: true });
    } catch (error) {
      console.warn("Failed to write mock workflow memory back to server:", error);
    }
    renderChapterLibrary();
    appendControllerMessage("system", `模拟模式已把本章结果回写到当前卷。${volume ? `\n当前卷：${volume.title}` : ""}`);
    persistConfig();
    return;
  }

  const context = {
    oldMemory: compactInputsForModel(),
    activeVolume: buildActiveVolumeContext(),
    draftResult: limitText(draftResult, 14000),
    auditResult: limitText(auditResult, 8000),
    extractResult: limitText(extractResult, 8000),
  };

  const updated = parseJsonObject(await callOpenAI({
    model: $("controllerModel").value.trim(),
    signal: currentAbortController?.signal,
    messages: [
      { role: "system", content: await withSkill("memory-maintainer", codexMergePrompt()) },
      { role: "user", content: `请合并并输出新的长期记忆 JSON：\n${JSON.stringify(context, null, 2)}` },
    ],
  }));

  $("codex").value = updated.codex || $("codex").value;
  $("outline").value = updated.outline || $("outline").value;
  if (updated.volumeOutline) applyPlainVolumeOutlineToActiveVolume(updated.volumeOutline);
  $("foreshadowLedger").value = updated.foreshadowLedger || $("foreshadowLedger").value;
  $("volumeSummary").value = updated.volumeSummary || $("volumeSummary").value;
  $("phaseSummary").value = updated.phaseSummary || $("phaseSummary").value;
  $("characterStateTable").value = updated.characterStateTable || $("characterStateTable").value;
  $("foreshadowTimeline").value = updated.foreshadowTimeline || $("foreshadowTimeline").value;
  $("chapterSummaries").value = updated.chapterSummaries || $("chapterSummaries").value;
  let activeChapter = null;
  if (activeChapterId) {
    const project = getActiveProject();
    const chapter = project.chapters?.find((item) => item.id === activeChapterId);
    if (chapter) {
      activeChapter = chapter;
      setChapterStatus(chapter, CHAPTER_STATUS.WRITTEN_BACK);
      if (updated.chapterSummary) {
        chapter.summary = updated.chapterSummary;
        chapter.updatedAt = Date.now();
      }
    }
  }
  const volume = updateActiveVolumeFromWorkflow(updated, activeChapter);
  const completionReview = getVolumeCompletionReview(getActiveProject(), updated, activeChapter);
  if (completionReview.completed && volume) {
    volume.status = "完成";
    syncActiveVolumeOutline(getActiveProject());
  }
  appendOutput("卷完成度", formatVolumeCompletionReview(completionReview));
  try {
    await writebackProjectMemoryToServer(getActiveProject().id, {
      memory: {
        codex: $("codex").value.trim(),
        outline: $("outline").value.trim(),
        hooks: $("hooks").value.trim(),
        foreshadowLedger: $("foreshadowLedger").value.trim(),
        volumeSummary: $("volumeSummary").value.trim(),
        phaseSummary: $("phaseSummary").value.trim(),
        characterStateTable: $("characterStateTable").value.trim(),
        foreshadowTimeline: $("foreshadowTimeline").value.trim(),
        chapterSummaries: $("chapterSummaries").value.trim(),
        chapterGoal: $("chapterGoal").value.trim(),
      },
      activeVolume: buildActiveVolumeContext(),
      activeVolumeId: getActiveProject().activeVolumeId || volume?.id || "",
      activeChapterId: activeChapter?.id || activeChapterId || "",
      chapter: activeChapter || undefined,
    });
    await syncProjectControllerStateFromServer(getActiveProject().id, { render: true });
  } catch (error) {
    console.warn("Failed to write workflow memory back to server:", error);
  }
  renderChapterLibrary();
  appendControllerMessage("system", `长期记忆已根据本章生成结果自动更新。${volume ? `\n当前卷已回写：${volume.title}` : ""}${updated.chapterSummary ? `\n本章摘要：${updated.chapterSummary}` : ""}`);
  persistConfig();
}

function buildDraftMarkdown() {
  const title = $("projectTitle").value.trim() || "未命名新书";
  const outputText = $("workflowOutput").innerText.trim();
  const project = getActiveProject();
  const chapters = project.chapters || [];
  const volumeText = (project.volumes || [])
    .map((volume) => [
      `### ${volume.title}`,
      volume.id === project.activeVolumeId ? "状态：当前写作卷" : "",
      volume.status ? `卷状态：${volume.status}` : "",
      volume.chapterRange ? `章节范围：${volume.chapterRange}` : "",
      volume.summary ? `卷定位 / 卷目标：\n${volume.summary}` : "",
      volume.outline ? `本卷大纲：\n${volume.outline}` : "",
      volume.content ? `本卷内容沉淀：\n${volume.content}` : "",
      volume.keyChars ? `关键人物 / 势力：\n${volume.keyChars}` : "",
      volume.keyHooks ? `关键钩子 / 回收：\n${volume.keyHooks}` : "",
      volume.notes ? `备注：\n${volume.notes}` : "",
    ].filter(Boolean).join("\n\n"))
    .join("\n\n");
  const chapterText = chapters
    .slice()
    .reverse()
    .map((chapter) => `### ${chapter.title}${chapter.volumeTitle ? `｜${chapter.volumeTitle}` : ""}\n\n${chapter.content}`)
    .join("\n\n");

  return [
    `# ${title}`,
    "",
    `导出时间：${new Date().toLocaleString("zh-CN")}`,
    "",
    "## 小说圣经",
    $("bible").value.trim() || "（空）",
    "",
    "## 文风锚点",
    $("styleGuide").value.trim() || "（空）",
    "",
    "## 设定档案",
    $("codex").value.trim() || "（空）",
    "",
    "## 全书大纲",
    $("outline").value.trim() || "（空）",
    "",
    "## 当前卷大纲",
    $("volumeOutline").value.trim() || "（空）",
    "",
    "## 分卷库",
    volumeText || "（尚未建立分卷）",
    "",
    "## 当前钩子",
    $("hooks").value.trim() || "（空）",
    "",
    "## 伏笔账本",
    $("foreshadowLedger").value.trim() || "（空）",
    "",
    "## 卷摘要",
    $("volumeSummary").value.trim() || "（空）",
    "",
    "## 阶段摘要",
    $("phaseSummary").value.trim() || "（空）",
    "",
    "## 人物状态表",
    $("characterStateTable").value.trim() || "（空）",
    "",
    "## 伏笔生命周期",
    $("foreshadowTimeline").value.trim() || "（空）",
    "",
    "## 章节摘要库",
    $("chapterSummaries").value.trim() || "（空）",
    "",
    "## 本章目标",
    $("chapterGoal").value.trim() || "（空）",
    "",
    "## 生成草稿",
    outputText && !$("workflowOutput").querySelector(".empty-state") ? outputText : "（尚未生成草稿）",
    "",
    "## 正文章节库",
    chapterText || "（尚未保存正文章节）",
    "",
  ].join("\n");
}

function downloadDraftFallback(filename, content) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function exportDraft() {
  persistConfig();
  const title = $("projectTitle").value.trim() || "未命名新书";
  const content = buildDraftMarkdown();
  const fallbackName = `${title.replace(/[\\/:*?"<>|]/g, "_") || "draft"}.md`;
  setFlowState("export", "active");
  setStatus("导出中", "running");

  try {
    const res = await fetch("/api/export-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content }),
    });

    if (!res.ok) {
      throw new Error(await res.text());
    }

    const data = await res.json();
    appendControllerMessage("system", `草稿已导出：${data.path}`);
    setFlowState("export", "done");
    setStatus("已导出", "done");
  } catch (error) {
    downloadDraftFallback(fallbackName, content);
    appendControllerMessage("system", "当前页面没有连接到本地导出服务，已改为浏览器下载。要直接写入项目文件夹，请使用本地 Node 服务地址打开页面。");
    setFlowState("export", "done");
    setStatus("已下载", "done");
  }
}

// API Functions
async function fetchChatCompletions(baseUrl, apiKey, model, messages, signal, temperature = 0.7) {
  if (!baseUrl) throw new Error("缺少 Base URL");
  if (!apiKey) throw new Error("缺少 API Key");
  if (!model) throw new Error("缺少模型名称");

  if (canUseLocalProxy()) {
    return fetchChatProxy({ provider: "openai-compatible", baseUrl, apiKey, model, messages }, signal);
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
    }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API 失败：${res.status} ${text}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("API 返回为空，请检查模型名称或服务商响应格式");
  return content;
}

function canUseLocalProxy() {
  return location.protocol === "file:"
    || ["localhost", "127.0.0.1"].includes(location.hostname);
}

function localProxyUrl() {
  return "http://localhost:8788/api/chat";
}

function normalizeProxyErrorMessage(message) {
  const text = String(message || "").trim();
  if (!text) return "未知代理错误";
  if (/(Resource has been exhausted|check quota|quota|insufficient_quota|rate limit|RESOURCE_EXHAUSTED|Too Many Requests|429|额度|配额|限流)/i.test(text)) {
    return "上游模型额度/配额/限流不足。已不是本地页面错误；可稍后重试、换模型/Key，或让流程自动降级到可用模型。";
  }
  if (/(524|504|Gateway time-out|timeout occurred|timed out|Cloudflare|origin web server timed out)/i.test(text)) {
    return "上游模型服务超时。通常不是本地页面坏了，而是 API 网关或模型源站太久没返回；请稍后重试，或改用更快模型/更短上下文。";
  }
  if (/API returned empty content/i.test(text) || /Gemini returned empty content/i.test(text)) {
    return `${text}。通常是上下文过长、输出被截断，或服务商只返回了思维内容没有返回正文。`;
  }
  return text;
}

function isTimeoutLikeError(error) {
  const text = String(error?.message || error || "");
  return /(524|504|Gateway time-out|timeout occurred|timed out|Cloudflare|AbortError|超时)/i.test(text);
}

function isQuotaLikeError(error) {
  const text = String(error?.message || error || "");
  return /(Resource has been exhausted|check quota|quota|insufficient_quota|rate limit|RESOURCE_EXHAUSTED|Too Many Requests|429|额度|配额|限流)/i.test(text);
}

async function fetchChatProxy(payload, signal) {
  let res;
  try {
    res = await fetch(localProxyUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, temperature: payload.temperature ?? 0.7 }),
      signal,
    });
  } catch (error) {
    throw new Error(`无法连接本地代理 ${localProxyUrl()}。请确认用 http://localhost:8788/ 打开页面，并且 server.js 正在运行。原始错误：${error.message}`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`本地代理失败：${res.status} ${normalizeProxyErrorMessage(text)}`);
  }
  const data = await res.json();
  if (!data.content) throw new Error("本地代理返回为空");
  return data.content;
}

async function callOpenAI({ model, messages, signal, temperature = 0.7 }) {
  const baseUrl = $("openaiBaseUrl").value.trim().replace(/\/$/, "") || defaultValues.openaiBaseUrl;
  const apiKey = $("openaiApiKey").value.trim();
  if (!apiKey) throw new Error("缺少 OpenAI API Key");
  return fetchChatCompletions(baseUrl, apiKey, model, messages, signal, temperature);
}

async function callDeepSeek({ model, messages, signal, temperature = 0.7 }) {
  const baseUrl = $("deepseekBaseUrl").value.trim().replace(/\/$/, "") || defaultValues.deepseekBaseUrl;
  const apiKey = $("deepseekApiKey").value.trim();
  if (!apiKey) throw new Error("缺少 DeepSeek API Key");
  return fetchChatCompletions(baseUrl, apiKey, model, messages, signal, temperature);
}

async function callGemini({ model, messages, signal, temperature = 0.7 }) {
  let baseUrl = $("geminiBaseUrl").value.trim().replace(/\/$/, "") || defaultValues.geminiBaseUrl;
  const apiKey = $("geminiApiKey").value.trim();
  if (!apiKey) throw new Error("缺少 Gemini API Key");

  // 1. 智能兼容检测
  const isGoogle = baseUrl.includes("googleapis.com");
  
  // 如果是中转站但没有 /v1，并且看起来不像官方地址，尝试补全 /v1
  if (!isGoogle && !baseUrl.includes("/v1")) {
    baseUrl += "/v1";
  }

  // 2. 确定使用哪种协议
  if (!isGoogle) {
    console.log(`[Gemini] 正在尝试通过 OpenAI 兼容协议请求: ${baseUrl}/chat/completions`);
    return fetchChatCompletions(baseUrl, apiKey, model, messages, signal, temperature);
  }

  // 3. 原生 Google AI 协议
  if (canUseLocalProxy()) {
    return fetchChatProxy({ provider: "gemini", baseUrl, apiKey, model, messages, temperature }, signal);
  }

  const contents = [];
  let systemInstruction = "";
  messages.forEach((m) => {
    if (m.role === "system") {
      systemInstruction = m.content;
    } else {
      contents.push({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      });
    }
  });

  const body = {
    contents,
    generationConfig: { temperature },
  };
  if (systemInstruction) {
    body.system_instruction = { parts: [{ text: systemInstruction }] };
  }

  const finalUrl = `${baseUrl}/models/${model}:generateContent?key=${apiKey}`;
  console.log(`[Gemini] 正在尝试通过 Google 原生协议请求: ${finalUrl}`);

  const res = await fetch(finalUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Gemini 请求失败 (${res.status})：${text.slice(0, 200)}...`);
  }

  if (!contentType.includes("application/json")) {
    throw new Error(`Gemini 返回了非 JSON 格式内容（可能是路径不对导致请求到了网页）。内容片段：${text.slice(0, 200)}...`);
  }

  const data = JSON.parse(text);
  const content = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!content) throw new Error("Gemini 返回为空，请检查模型名称或安全过滤设置");
  return content;
}

async function callGeminiWithOpenAIFallback({ model, messages, signal, temperature = 0.7, taskLabel = "审稿检查", annotate = true }) {
  let firstError = null;
  const hasGemini = Boolean($("geminiApiKey").value.trim() && (model || $("geminiModel").value.trim()));

  if (hasGemini) {
    try {
      return await callGemini({
        model: model || $("geminiModel").value.trim(),
        messages,
        signal,
        temperature,
      });
    } catch (error) {
      firstError = error;
      if (!isQuotaLikeError(error) && !isTimeoutLikeError(error)) {
        throw error;
      }
      appendControllerMessage("system", `${taskLabel}模型不可用，已自动切换到主控模型继续。原因：${normalizeProxyErrorMessage(error.message)}`);
    }
  }

  if (!$("openaiApiKey").value.trim() || !$("controllerModel").value.trim()) {
    throw firstError || new Error(`${taskLabel}需要 Gemini，或可降级使用的 OpenAI 主控模型。`);
  }

  const fallback = await callOpenAI({
    model: $("controllerModel").value.trim(),
    messages,
    signal,
    temperature: Math.min(temperature, 0.35),
  });

  if (!annotate) return fallback;
  return [
    `> 降级提示：${taskLabel}原模型额度/超时不可用，本次已改用主控模型完成。`,
    "",
    fallback,
  ].join("\n");
}

async function callAuditModel(args) {
  return callGeminiWithOpenAIFallback({
    ...args,
    taskLabel: "审稿检查",
    annotate: true,
  });
}

// Mock Data
const mocks = {
  brief: (inputs) => `### 本章创作约束\n- **核心设定**：记忆档案不可伪造。\n- **承接钩子**：${inputs.hooks.split("\n")[0] || "待确认"}\n- **禁止**：复活、瞬移。\n- **允许**：档案馆细节描写。`,
  draft: () => `林砚推开档案馆沉重的铜门。空气里浮着旧纸和电子臭氧混合的味道。\n\n他在终端输入了林遥的名字。屏幕上弹出的红字让他心口一停：\n\n> **自愿删除申请：已生效**\n\n就在这时，口袋里的旧手机震动起来。`,
  audit: () => `### 审稿反馈\n1. **逻辑**：通过，主角反应符合设定。\n2. **文风**：偏冷峻，可以继续压缩解释。\n3. **建议**：强化档案馆内部的压迫感。`,
  extract: () => `\`\`\`yaml\nfacts:\n  - 主角发现一条已生效的删除申请。\nhooks:\n  - 旧手机再次响起。\n\`\`\``
};

function validateWorkflow(inputs, mockMode, mode = "standard") {
  const missingInputs = [
    ["bible", "小说圣经"],
    ["hooks", "当前钩子"],
    ["chapterGoal", "本章目标"],
  ].filter(([id]) => !inputs[id]);

  if (missingInputs.length) {
    throw new Error(`请先填写：${missingInputs.map(([, label]) => label).join("、")}`);
  }

  if (mockMode) return;

  const requiredConfig = [
    ["openaiApiKey", "OpenAI API Key"],
    ["controllerModel", "主控模型"],
    ["writerModel", "写作模型"],
    ["deepseekApiKey", "DeepSeek Key"],
    ["deepseekModel", "DeepSeek 模型"],
  ];
  if (normalizeWorkflowRunMode(mode) !== "fast") {
    requiredConfig.push(["geminiApiKey", "Gemini Key"], ["geminiModel", "Gemini 模型"]);
  }
  const missingConfig = requiredConfig.filter(([id]) => !$(id).value.trim());

  if (missingConfig.length) {
    throw new Error(
      `真实 API 模式需要补全以下配置：\n${missingConfig.map(([, label]) => `- ${label}`).join("\n")}\n\n如果只是试跑界面，请开启右上角“模拟模式”。`
    );
  }
}

async function buildSteps(inputs, options = {}) {
  let planningContext = null;
  try {
    planningContext = await fetchProjectPlanningContextFromServer(activeProjectId, 8);
  } catch (error) {
    console.warn("Failed to fetch planning context for workflow:", error);
  }
  const effectiveInputs = buildInputsFromPlanningContext(planningContext, inputs);
  const memoryPack = options.memoryPack && typeof options.memoryPack === "object"
    ? options.memoryPack
    : buildChapterMemoryPack(planningContext, effectiveInputs);
  const sourceContext = String(options.sourceContext || "").trim() || JSON.stringify({
    ...compactInputsForModel(effectiveInputs),
    chapterMemoryPack: memoryPack,
    recentChapters: (planningContext?.recentChapters || []).map((chapter) => ({
      title: chapter.title,
      volumeId: chapter.volumeId || "",
      volumeTitle: chapter.volumeTitle || "",
      summary: limitTextWindow(chapter.summary, 900, 0.55),
      goal: limitTextWindow(chapter.goal, 700, 0.55),
      content: limitTextWindow(chapter.content, 2600, 0.25),
      hooksSnapshot: limitTextWindow(chapter.hooksSnapshot, 900, 0.42),
      updatedAt: chapter.updatedAt,
    })),
    controllerMessages: planningContext?.controllerMessages || [],
  }, null, 2);
  const controllerPrompt = await withSkill("controller", [
    "你是长篇小说创作流程的主控编辑。",
    "根据小说圣经、设定档案、全书大纲、当前写作卷结构化信息、卷摘要、阶段摘要、人物状态表、文风账本、伏笔生命周期、章节摘要库、当前钩子和本章目标，生成可执行的章节 Brief。",
    "当前写作卷是硬约束：本章必须服务 activeVolume 的卷目标、卷内阶段和关键钩子，不得脱离 activeVolume 另起一条线。",
    "必须先检查本章是否服务全书大纲和当前卷目标，不得偏离全书主线或卷内节奏。",
    "必须检查伏笔账本，明确本章触发、延后或回收哪些伏笔。",
    "必须检查人物名、势力名、地点名、法宝术语是否符合设定档案。",
    "输出必须包含：本章核心目标、对应大纲位置、对应卷目标、场景顺序、人物动机、必须承接的伏笔、禁止触碰的设定、结尾钩子。",
    "不要写正文，不要泛泛而谈。",
  ].join("\n"));
  const writerPrompt = await withSkill("writer", [
    "你是小说正文写手。",
    "根据章节 Brief 写出完整正文片段，保持中文叙事自然、具体、有画面、有流动感。",
    "正文必须遵守小说圣经、设定档案、人物状态表和全书大纲，不得写错人物姓名、称呼、阵营、地点归属或法宝术语。",
    "正文必须承接章节摘要库中的既有事实，并遵守 activeVolume 当前写作卷、当前卷大纲和伏笔账本。",
    "不得为了单章爽点偏离全书主线或提前揭示终局秘密。",
    "如果提供了文风锚点，无论它是样文还是蒸馏结果，都优先学习其中的句长变化、叙述距离、对白节奏、段落呼吸和画面组织方式；只学风格，不照抄情节、设定和具体句子。",
    "优先把本章写成 2-4 场正在发生的戏，而不是把 Brief 逐条翻译成说明文。",
    "每隔两三段就要落一次可感知细节，例如动作、声音、气味、光线、衣物、器物、空间变化或人物停顿。",
    "不要先解释情绪再写动作，尽量让动作、对话、物件反应和场景变化自己承载情绪。",
    "对白必须像这个人会在这个场景里脱口而出的话，先过一遍人耳，再决定是否保留。",
    "危险、催促、护人、翻脸、试探这些高压场景，优先用短促、顺口、带情绪的现场说法，不要写成书面命令或解释句。",
    "例如该说“快走”时，不要写成“现在走”；该说“你们不走，我就得分心”时，不要写成“你们不动，我就得分心”。",
    "台词要符合人物关系、身份、当下压力和嘴上习惯，同一句意思也要选最有人味、最省力、最顺口的说法。",
    "不要为了显得有文采就临时硬造比喻，尤其避免“X 得像 Y”“像刀子”“像钉子”“像什么东西砸下来”这类低信息、生拼出来的比喻。",
    "如果一个比喻不能同时带来更准确的感官信息、人物视角和场景质感，就删掉，改回动作、音色、停顿、目光、呼吸或器物反应。",
    "例如“声音不高，硬得像钉子”不如“声音不高，字字发硬”或“声音压得不高，却没有半点转圜”。",
    "还要避免语义勉强说得通、但落字像术语没落地的生硬动词，尤其是把“催、牵、压、灌、震”之类玄幻常用动词单独丢进口语或近身体感里。",
    "如果动作对象不明确、施力关系不明确，读者会觉得句子在发硬。该补对象就补对象，该换成人话就换成人话。",
    "例如“再这么催，真想把自己玩死？”偏硬；可改成“再这么逼自己，真想把自己玩死？”“再这么硬顶，真不要命了？”或“再这么往死里撞，真想把自己玩死？”",
    "避免段尾总结、抽象判断和策划案口吻，避免“他知道/他明白/这意味着”一类收束句。",
    "优先推进情节和人物反应，允许留白，不要把该写成戏的内容写成概述。",
    "输出只包含正文，不要附带分析。",
  ].join("\n"));
  const auditorPrompt = await withSkill("auditor", [
    "你是小说审稿员。",
    "检查正文是否符合小说圣经、设定档案、人物状态表、全书大纲、activeVolume 当前写作卷、当前卷大纲、卷摘要、阶段摘要、章节摘要库、文风账本、伏笔生命周期和章节 Brief。",
    "重点发现：错名、称呼错误、关系错误、阵营归属错误、地点归属错误、法宝术语错误、逻辑连续性、摘要事实冲突、伏笔状态错误、大纲偏离和信息泄露问题。",
    "额外检查文本是否僵硬、是否像提纲扩写、是否解释过多、是否缺少动作和场景承载、是否 AI 味过重。",
    "必须检查对白是否像人物在当下情境里真的会说的话，是否顺口，是否有人味，是否误用了书面命令、概念替换或不合场景的词。",
    "重点抓这种问题：危急催促场景把“快走”写成“现在走”，把“你们不走”写成“你们不动”，把人话写成解释味、转述味或错位表达。",
    "还要重点抓低信息硬比喻，例如“声音不高，硬得像钉子”这类为了显得有画面临时拼出的比喻；发现后要指出哪里硬、为什么不像人物视角、该改成什么类型的表达。",
    "还要抓语义能懂但落字发硬的动词，尤其是“催、牵、压、灌、震”这类术语味动词在口语或近身感受里悬空使用。发现后要指出动词为什么悬、对象缺在哪里、换成什么人话更顺。",
    "输出格式：通过项、设定档案一致性、摘要连续性、文风账本检查、问题项、大纲偏离风险、可执行修改建议。问题要具体到文本表现。",
  ].join("\n"));
  const memoryPrompt = await withSkill("memory-maintainer", [
    "你是长篇小说状态抽取器。",
    "从正文和审稿意见中抽取后续写作必须记住的信息。",
    "必须抽取新出现或被确认的人物、别名、身份、阵营、关系、地点、势力、法宝、术语和禁止写错项。",
    "必须抽取章节摘要、伏笔状态变化、当前写作卷进度变化。",
    "只输出 YAML 代码块，字段包含 chapter_summary、facts、codex_updates、outline_updates、volume_updates、volume_progress、foreshadow_updates、open_hooks、resolved_hooks、character_state、continuity_notes。",
  ].join("\n"));

  const steps = [
    {
      id: "brief",
      title: "主控 Brief",
      call: callOpenAI,
      model: $("controllerModel").value.trim(),
      temperature: 0.55,
      prompt: controllerPrompt,
      inputs: () => sourceContext,
    },
    {
      id: "draft",
      title: "正文草稿",
      call: callOpenAI,
      model: $("writerModel").value.trim(),
      temperature: 0.92,
      prompt: writerPrompt,
      inputs: (_last, brief) => `原始素材：\n${sourceContext}\n\n章节 Brief：\n${brief}`,
    },
    {
      id: "audit",
      title: "审稿意见",
      call: callGemini,
      model: $("geminiModel").value.trim(),
      temperature: 0.35,
      prompt: auditorPrompt,
      inputs: (_last, brief, draft) => `原始素材：\n${sourceContext}\n\n章节 Brief：\n${brief}\n\n正文草稿：\n${draft}`,
    },
    {
      id: "extract",
      title: "状态更新",
      call: callDeepSeek,
      model: $("deepseekModel").value.trim(),
      temperature: 0.25,
      prompt: memoryPrompt,
      inputs: (audit, brief, draft) => `原始素材：\n${sourceContext}\n\n章节 Brief：\n${brief}\n\n正文草稿：\n${draft}\n\n审稿意见：\n${audit}`,
    },
  ];

  return { steps, sourceContext, memoryPack };
}

function getWorkflowRunMode() {
  return normalizeWorkflowRunMode($("workflowRunMode")?.value || getActiveProject()?.workflowRunMode);
}

function createWorkflowRunState({ mode, sourceContext, memoryPack }) {
  const now = Date.now();
  return normalizeWorkflowRunState({
    runId: `run-${now}-${Math.random().toString(16).slice(2)}`,
    mode,
    status: "running",
    sourceContext,
    memoryPack,
    results: {},
    completedStepIds: [],
    startedAt: now,
    updatedAt: now,
  });
}

function updateWorkflowRunState(patch = {}) {
  const project = getActiveProject();
  if (!project) return null;
  const current = normalizeWorkflowRunState(project.workflowRunState);
  project.workflowRunState = normalizeWorkflowRunState({
    ...current,
    ...patch,
    results: {
      ...(current.results || {}),
      ...(patch.results || {}),
    },
    completedStepIds: patch.completedStepIds || current.completedStepIds || [],
    updatedAt: Date.now(),
  });
  if (patch.qualityReport) {
    project.lastQualityReport = normalizeQualityReport(patch.qualityReport);
  }
  project.workflowRunMode = normalizeWorkflowRunMode(project.workflowRunMode || project.workflowRunState.mode);
  renderResumeWorkflowState();
  persistConfig();
  return project.workflowRunState;
}

function markWorkflowStepCompleted(stepId, result) {
  const project = getActiveProject();
  const state = normalizeWorkflowRunState(project?.workflowRunState);
  const completed = [...new Set([...(state.completedStepIds || []), stepId])];
  return updateWorkflowRunState({
    status: "running",
    failedStepId: "",
    error: "",
    completedStepIds: completed,
    results: {
      [stepId]: result,
    },
  });
}

function getWorkflowStepInput(step, state) {
  if (typeof step.inputs !== "function") return step.inputs;
  const results = state.results || {};
  const lastCompletedId = (state.completedStepIds || [])[state.completedStepIds.length - 1] || "";
  const lastResult = results[lastCompletedId] || "";
  return step.inputs(
    step.id === "extract" ? (results.audit || "") : lastResult,
    results.brief || "",
    results.draft || "",
  );
}

function getExecutableWorkflowSteps(steps, mode) {
  if (mode === "fast") {
    return steps.filter((step) => ["brief", "draft", "extract"].includes(step.id));
  }
  return steps;
}

function getAutoRevisionReason(mode, auditResult, qualityReport) {
  if (mode === "fast") return "";
  if (qualityScoreNeedsRevision(qualityReport, mode)) {
    return `正文质量评分 ${qualityReport.overall} 低于${WORKFLOW_RUN_MODES[mode].label}模式阈值 ${WORKFLOW_RUN_MODES[mode].qualityThreshold}`;
  }
  if (auditNeedsRevision(auditResult)) return "审稿意见认为需要修改";
  return "";
}

async function scoreAndMaybeReviseWorkflowDraft({ mode, mockMode, sourceContext, memoryPack }) {
  if (mode === "fast" || workflowAborted) return;
  const state = normalizeWorkflowRunState(getActiveProject()?.workflowRunState);
  const briefResult = state.results.brief || "";
  let draftResult = state.results.draft || "";
  let auditResult = state.results.audit || "";
  if (!draftResult) return;

  updateWorkflowRunState({ failedStepId: "quality", error: "" });
  const qualityReport = await runDraftQualityScore({
    mockMode,
    mode,
    sourceContext,
    memoryPack,
    briefResult,
    draftResult,
    auditResult,
  });
  appendOutput("正文质量评分", formatQualityScore(qualityReport), qualityScoreNeedsRevision(qualityReport, mode) ? "error" : "");
  updateWorkflowRunState({
    qualityReport,
    failedStepId: "",
    error: "",
    results: {
      quality: JSON.stringify(qualityReport),
    },
  });

  const reason = getAutoRevisionReason(mode, auditResult, qualityReport);
  if (!reason) return;

  updateWorkflowRunState({ failedStepId: "revision", error: "" });
  const revised = await maybeAutoReviseAfterAudit({
    mockMode,
    sourceContext,
    memoryPack,
    briefResult,
    draftResult,
    auditResult,
    qualityReport,
    force: true,
    reason,
  });
  if (!revised) {
    updateWorkflowRunState({ failedStepId: "", error: "" });
    return;
  }

  markWorkflowStepCompleted("draft", revised.draftResult);
  markWorkflowStepCompleted("audit", revised.auditResult);
  updateWorkflowRunState({ failedStepId: "", error: "" });
}

function shouldSkipWorkflowStep(step, state) {
  return Array.isArray(state.completedStepIds) && state.completedStepIds.includes(step.id) && state.results?.[step.id];
}

async function runWorkflow(options = {}) {
  const resume = options?.resume === true;
  const inputs = getInputs();
  const mockMode = $("mockMode").checked;
  const project = getActiveProject();
  const previousState = normalizeWorkflowRunState(project?.workflowRunState);
  const mode = resume && previousState.runId ? previousState.mode : getWorkflowRunMode();
  workflowAborted = false;
  currentAbortController = new AbortController();
  resetSteps();
  if (!resume) $("workflowOutput").innerHTML = "";
  $("runWorkflow").disabled = true;
  $("resumeWorkflow").disabled = true;
  $("stopWorkflow").disabled = false;
  setControllerBusy(true);

  try {
    validateWorkflow(inputs, mockMode, mode);
    project.workflowRunMode = mode;
    if ($("workflowRunMode")) $("workflowRunMode").value = mode;
    persistConfig();
    setStatus(`${WORKFLOW_RUN_MODES[mode].label}模式运行中`, "running");
    const { steps, sourceContext, memoryPack } = await buildSteps(inputs, resume ? {
      sourceContext: previousState.sourceContext,
      memoryPack: previousState.memoryPack,
    } : {});

    if (resume && previousState.runId) {
      project.workflowRunState = normalizeWorkflowRunState({
        ...previousState,
        mode,
        status: "running",
        failedStepId: "",
        error: "",
      });
      appendOutput("续跑信息", [
        `- 续跑运行：${previousState.runId}`,
        `- 模式：${WORKFLOW_RUN_MODES[mode].label}`,
        `- 已完成：${previousState.completedStepIds?.join("、") || "无"}`,
        previousState.error ? `- 上次错误：${previousState.error}` : "",
      ].filter(Boolean).join("\n"));
      updateWorkflowRunState({ status: "running", failedStepId: "", error: "" });
    } else {
      project.workflowRunState = createWorkflowRunState({ mode, sourceContext, memoryPack });
      updateWorkflowRunState(project.workflowRunState);
      appendOutput("本章记忆包", formatChapterMemoryPackMarkdown(memoryPack));
      if (mode !== "fast") {
        updateWorkflowRunState({ failedStepId: "preflight" });
        const preflight = await runPreflightCheck({ mockMode, sourceContext, memoryPack });
        appendOutput("写前硬校验", formatPreflightResult(preflight), preflight.status === "block" ? "error" : "");
        updateWorkflowRunState({ preflight, failedStepId: "", error: "" });
        if (preflight.status === "block") {
          updateWorkflowRunState({ status: "failed", failedStepId: "preflight", error: "写前硬校验未通过" });
          throw new Error(`写前硬校验未通过：${preflight.requiredFixes.concat(preflight.issues).join("；") || "请先修正本章记忆包"}`);
        }
      }
    }

    const executableSteps = getExecutableWorkflowSteps(steps, mode);

    for (const step of executableSteps) {
      if (workflowAborted) break;
      let runState = normalizeWorkflowRunState(project.workflowRunState);
      if (shouldSkipWorkflowStep(step, runState)) {
        setStep(step.id, "done");
        continue;
      }

      setStatus(`${step.title}...`, "running");
      setStep(step.id, "active");
      updateWorkflowRunState({ status: "running", failedStepId: step.id, error: "" });
      runState = normalizeWorkflowRunState(project.workflowRunState);
      const stepInputs = getWorkflowStepInput(step, runState);
      
      const result = mockMode ? mocks[step.id](inputs) : await step.call({
        model: step.model,
        messages: [{ role: "system", content: step.prompt }, { role: "user", content: stepInputs }],
        signal: currentAbortController.signal,
        temperature: step.temperature,
      });

      if (step.id === "draft") {
        await saveDraftChapter(result);
      }

      setStep(step.id, "done");
      await typeWriter(step.title, result);
      markWorkflowStepCompleted(step.id, result);

      if (step.id === "audit") {
        await scoreAndMaybeReviseWorkflowDraft({ mode, mockMode, sourceContext, memoryPack });
      }
    }
    if (!workflowAborted) {
      const finalState = normalizeWorkflowRunState(project.workflowRunState);
      const draftResult = finalState.results.draft || "";
      const auditResult = finalState.results.audit || "";
      const extractResult = finalState.results.extract || "";
      await mergeCodexFromWorkflow({ draftResult, auditResult, extractResult });
      updateWorkflowRunState({ status: "completed", failedStepId: "", error: "" });
      appendControllerMessage("system", "本轮工作流已完成。可以继续在主控对话里提出修改、续写或下一章需求，再沉淀到下方进入下一轮。");
    } else {
      updateWorkflowRunState({ status: "stopped", error: "用户停止了本轮工作流" });
    }
    setStatus(workflowAborted ? "已停止" : "完成", workflowAborted ? "" : "done");
  } catch (error) {
    if (error.name === "AbortError" || workflowAborted) {
      setStatus("已停止", "");
      appendOutput("已停止", "当前请求已取消，已保留已经生成的内容。");
      updateWorkflowRunState({ status: "stopped", error: "请求已取消" });
    } else {
      setStatus("失败", "");
      appendOutput("错误", `\`\`\`\n${error.message}\n\`\`\``, "error");
      const state = normalizeWorkflowRunState(project?.workflowRunState);
      updateWorkflowRunState({
        status: "failed",
        failedStepId: state.failedStepId || "workflow",
        error: error.message,
      });
    }
  } finally {
    $("runWorkflow").disabled = false;
    $("stopWorkflow").disabled = true;
    currentAbortController = null;
    setControllerBusy(false);
    renderResumeWorkflowState();
    renderProjectDashboard();
  }
}

// UI Helpers
function toggleDrawer(open) {
  $("settingsDrawer").classList.toggle("open", open);
}

// Events
$("toggleSettings").addEventListener("click", () => toggleDrawer(true));
$("closeSettings").addEventListener("click", () => toggleDrawer(false));
document.querySelector(".drawer-overlay").addEventListener("click", () => toggleDrawer(false));
$("openStyleDistill").addEventListener("click", () => toggleStyleDistillModal(true));
$("closeStyleDistill").addEventListener("click", () => toggleStyleDistillModal(false));
document.querySelectorAll("[data-style-close]").forEach((node) => {
  node.addEventListener("click", () => toggleStyleDistillModal(false));
});
$("openSkillPanel").addEventListener("click", () => toggleSkillModal(true));
$("closeSkillPanel").addEventListener("click", () => toggleSkillModal(false));
document.querySelectorAll("[data-skill-close]").forEach((node) => {
  node.addEventListener("click", () => toggleSkillModal(false));
});

$("saveConfig").addEventListener("click", saveConfig);
$("resetConfig").addEventListener("click", resetConfig);
$("runWorkflow").addEventListener("click", () => runWorkflow());
$("resumeWorkflow").addEventListener("click", () => runWorkflow({ resume: true }));
$("newProject").addEventListener("click", createNewProject);
$("deleteProject").addEventListener("click", deleteActiveProject);
$("resetSkillToggles").addEventListener("click", resetProjectSkillToggles);
$("advanceChapter").addEventListener("click", advanceChapterGoal);
$("exportDraft").addEventListener("click", exportDraft);
$("copyChapter").addEventListener("click", copyActiveChapter);
$("clearStyleSource").addEventListener("click", () => {
  uploadedStyleSourceText = "";
  uploadedStyleSourceName = "";
  uploadedStyleSourceEncoding = "";
  $("styleSourceFile").value = "";
  $("styleSourceText").value = "";
  $("styleDistillFocus").value = "";
  $("styleReferenceTitle").value = getActiveProject()?.styleReferenceTitle || "";
  updateStyleSourceStatus();
});
$("distillStyleReplace").addEventListener("click", () => distillStyleGuide("replace"));
$("distillStyleAppend").addEventListener("click", () => distillStyleGuide("append"));
$("collapseOutput").addEventListener("click", () => {
  normalizeOutputSections();
  const sections = [...$("workflowOutput").querySelectorAll(".output-section")];
  const shouldCollapse = sections.some((section) => !section.classList.contains("collapsed"));
  setAllOutputSections(shouldCollapse);
});
$("jumpOutputTop").addEventListener("click", () => {
  $("workflowOutput").scrollTo({ top: 0, behavior: "smooth" });
});
$("jumpOutputBottom").addEventListener("click", () => {
  const output = $("workflowOutput");
  output.scrollTo({ top: output.scrollHeight, behavior: "smooth" });
});
$("projectTitle").addEventListener("input", () => {
  const project = getActiveProject();
  project.title = $("projectTitle").value.trim() || "未命名新书";
  project.updatedAt = Date.now();
  renderProjectList();
  schedulePersist();
});
$("sendController").addEventListener("click", sendControllerMessage);
$("analyzeController").addEventListener("click", analyzeControllerConversation);
$("archiveController").addEventListener("click", archiveControllerConversation);
$("clearControllerMemory").addEventListener("click", clearControllerMemory);
$("refreshEngineeringMemory").addEventListener("click", refreshEngineeringMemory);
$("batchValidateProject").addEventListener("click", batchValidateProject);
$("copyCharacterCards")?.addEventListener("click", copyCharacterCards);
$("copyHookItems")?.addEventListener("click", copyHookItems);
$("addCharacterCard")?.addEventListener("click", () => {
  addCharacterCard().catch((error) => {
    console.error("Failed to add character card:", error);
  });
});
$("addHookItem")?.addEventListener("click", () => {
  addHookItem().catch((error) => {
    console.error("Failed to add hook item:", error);
  });
});
$("clearController").addEventListener("click", () => {
  if (!confirm("确定要清空当前可见的主控对话吗？已归档的长期记忆和下方输入不会被清空。")) return;
  controllerMessages = [];
  syncLocalControllerStateToProject();
  renderControllerMessages();
  renderControllerMemoryPanel();
  renderKnowledgePanels();
  clearProjectControllerMessagesOnServer(getActiveProject().id).then((payload) => {
    if (!payload) return;
    applyControllerStateToProject(getActiveProject(), payload);
    renderControllerMessages();
    renderControllerMemoryPanel();
    renderKnowledgePanels();
  }).catch((error) => {
    console.warn("Failed to clear controller messages on local server:", error);
  });
  persistConfig();
  setStatus("对话已清空", "done");
});
$("controllerInput").addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    sendControllerMessage();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    toggleStyleDistillModal(false);
    toggleSkillModal(false);
  }
});
$("controllerInput").addEventListener("input", schedulePersist);
window.addEventListener("storage", (event) => {
  if (event.key !== VOLUME_STUDIO_SYNC_KEY || !event.newValue) return;
  if (event.newValue === volumeStudioSyncToken) return;
  volumeStudioSyncToken = event.newValue;
  try {
    const payload = JSON.parse(event.newValue);
    if (!payload?.projectId || payload.projectId !== activeProjectId) return;
  } catch {
    return;
  }
  syncActiveProjectVolumeStudioIfNeeded(true);
});
window.addEventListener("focus", () => {
  syncActiveProjectVolumeStudioIfNeeded(false);
});
window.addEventListener("resize", renderWorkflowRail);
$("stopWorkflow").addEventListener("click", () => {
  workflowAborted = true;
  if (currentAbortController) currentAbortController.abort();
  setStatus("停止中...", "running");
});
$("mockMode").addEventListener("change", () => {
  persistConfig();
});
$("workflowRunMode").addEventListener("change", () => {
  const project = getActiveProject();
  if (project) project.workflowRunMode = getWorkflowRunMode();
  renderProjectDashboard();
  persistConfig();
});
$("styleGuide").addEventListener("input", updateStyleGuideMeta);
$("styleSourceText").addEventListener("input", () => updateStyleSourceStatus());
$("styleReferenceTitle").addEventListener("input", () => {
  updateStyleSourceStatus();
  schedulePersist();
});
$("styleSourceFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    uploadedStyleSourceText = "";
    uploadedStyleSourceName = "";
    uploadedStyleSourceEncoding = "";
    updateStyleSourceStatus();
    return;
  }

  try {
    updateStyleSourceStatus("正在读取文件...");
    const { text, encoding } = await readStyleSourceFile(file);
    uploadedStyleSourceText = normalizeStyleSource(text);
    uploadedStyleSourceName = file.name;
    uploadedStyleSourceEncoding = encoding;
    if (!$("styleReferenceTitle").value.trim()) {
      $("styleReferenceTitle").value = file.name.replace(/\.[^.]+$/, "");
    }
    updateStyleSourceStatus(`原文 ${uploadedStyleSourceText.length} 字，蒸馏时会先抽样。`);
  } catch (error) {
    uploadedStyleSourceText = "";
    uploadedStyleSourceName = "";
    uploadedStyleSourceEncoding = "";
    updateStyleSourceStatus(`读取失败：${error.message}`);
    appendControllerMessage("system", `文风源文件读取失败：${error.message}`);
  }
});

[...fields, "bible", "styleGuide", "codex", "outline", "volumeOutline", "hooks", "foreshadowLedger", "volumeSummary", "phaseSummary", "characterStateTable", "foreshadowTimeline", "chapterSummaries", "chapterGoal"].forEach((id) => {
  $(id).addEventListener("input", () => {
    renderWorkflowRail();
    if (["hooks", "foreshadowLedger", "characterStateTable", "foreshadowTimeline"].includes(id)) {
      scheduleKnowledgeTextSync(id);
    }
    schedulePersist();
  });
  $(id).addEventListener("change", () => {
    renderWorkflowRail();
    if (["hooks", "foreshadowLedger", "characterStateTable", "foreshadowTimeline"].includes(id)) {
      scheduleKnowledgeTextSync(id);
    }
    schedulePersist();
  });
});

window.addEventListener("beforeunload", () => {
  persistConfig();
});

window.addEventListener("pagehide", () => {
  saveActiveProject();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clonePlainData(appState)));
  } catch (error) {
    console.error("pagehide local save failed:", error);
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    syncActiveProjectVolumeStudioIfNeeded(false);
    return;
  }
  if (document.visibilityState !== "hidden") return;
  saveActiveProject();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clonePlainData(appState)));
  } catch (error) {
    console.error("visibilitychange local save failed:", error);
  }
});

document.querySelectorAll(".toggle-password").forEach(btn => {
  btn.addEventListener("click", () => {
    const target = $(btn.dataset.target);
    const isPass = target.type === "password";
    target.type = isPass ? "text" : "password";
    btn.textContent = isPass ? "隐藏" : "显示";
  });
});

$("copyOutput").addEventListener("click", async () => {
  const text = $("workflowOutput").innerText;
  await navigator.clipboard.writeText(text);
  const btn = $("copyOutput");
  btn.textContent = "已复制";
  setTimeout(() => btn.textContent = "复制全文", 2000);
});

// Tests
const runTest = async (name, callFn, modelId) => {
  setStatus(`测试 ${name}...`, "running");
  try {
    const res = await callFn({ model: $(modelId).value, messages: [{role:"user", content:"hi"}] });
    appendOutput(`${name} 测试`, res);
    setStatus("测试通过", "done");
  } catch (e) {
    appendOutput(`${name} 错误`, e.message);
    setStatus("测试失败", "");
  }
};
$("testOpenAI").addEventListener("click", () => runTest("OpenAI", callOpenAI, "controllerModel"));
$("testGemini").addEventListener("click", () => runTest("Gemini", callGemini, "geminiModel"));
$("testDeepSeek").addEventListener("click", () => runTest("DeepSeek", callDeepSeek, "deepseekModel"));

loadConfig().catch((error) => {
  console.error("Failed to load workspace:", error);
  setStatus("读取失败", "");
});





