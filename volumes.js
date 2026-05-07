const STORAGE_KEY = "novelWorkflowWorkspaceV2";
const LEGACY_STORAGE_KEY = "novelWorkflowConfig";
const WORKSPACE_MIRROR_SCHEMA = "novel-workflow-workspace-mirror-v1";
const VOLUME_STUDIO_SYNC_KEY = "novelWorkflowVolumeStudioSync";

const $ = (id) => document.getElementById(id);
let workspace = null;
let activeProjectId = "";
let activeVolumeId = "";
let saveTimer = null;
let saveChain = Promise.resolve();
let lastSavedAt = 0;

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function clonePlainData(value) {
  return JSON.parse(JSON.stringify(value));
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createVolumeRecord(volume = {}, index = 0) {
  const now = Date.now() + index;
  const createdAt = Number(volume.createdAt || now);
  const updatedAt = Number(volume.updatedAt || createdAt || now);
  return {
    id: volume.id || createId("volume"),
    title: String(volume.title || `第 ${index + 1} 卷`).trim() || `第 ${index + 1} 卷`,
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

  return source.map((volume, index) => createVolumeRecord(volume, index));
}

function resolveActiveVolumeId(volumes = [], preferredId = "") {
  if (preferredId && volumes.some((volume) => volume.id === preferredId)) return preferredId;
  return volumes[0]?.id || "";
}

function normalizeWorkspaceShape(input) {
  const base = input && typeof input === "object" ? input : {};
  base.global ||= {};
  base.projects = Array.isArray(base.projects) ? base.projects : [];
  base.projects = base.projects.map((project) => {
    const volumes = normalizeVolumeRecords(project.volumes, project.volumeOutline);
    return {
      ...project,
      title: String(project.title || "未命名新书").trim() || "未命名新书",
      outline: String(project.outline || "").trim(),
      volumeOutline: String(project.volumeOutline || "").trim(),
      volumes,
      activeVolumeId: resolveActiveVolumeId(volumes, project.activeVolumeId || ""),
      updatedAt: Number(project.updatedAt || Date.now()),
    };
  });
  return base;
}

function apiUrl(pathname) {
  if (location.protocol === "file:") return `http://localhost:8788${pathname}`;
  return new URL(pathname, location.origin).toString();
}

function projectsApiUrl() {
  return apiUrl("/api/projects");
}

function projectVolumeStudioApiUrl(projectId) {
  return apiUrl(`/api/projects/${encodeURIComponent(projectId)}/volume-studio`);
}

async function fetchWorkspaceFromServer() {
  if (!(location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    return null;
  }

  const projectsResponse = await fetch(projectsApiUrl(), { method: "GET" });
  if (!projectsResponse.ok) {
    throw new Error(await projectsResponse.text());
  }
  const projectsData = await projectsResponse.json();
  const projects = Array.isArray(projectsData?.projects) ? projectsData.projects : [];
  if (!projects.length) {
    return normalizeWorkspaceShape({ global: {}, projects: [], activeProjectId: "" });
  }

  const search = new URLSearchParams(location.search);
  const queryProjectId = search.get("project");
  const local = readJson(STORAGE_KEY);
  const preferredProjectId = projects.some((project) => project.id === queryProjectId)
    ? queryProjectId
    : projects.some((project) => project.id === local?.activeProjectId)
      ? local.activeProjectId
      : projects[0].id;

  const response = await fetch(projectVolumeStudioApiUrl(preferredProjectId), { method: "GET" });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const detail = await response.json();
  const mergedProjects = projects.map((project) => (
    project.id === preferredProjectId
      ? { ...project, ...detail.project, volumes: detail.volumes || [] }
      : { ...project, volumes: Array.isArray(project.volumes) ? project.volumes : [] }
  ));
  return normalizeWorkspaceShape({
    global: local?.global || {},
    mockMode: local?.mockMode ?? false,
    activeProjectId: preferredProjectId,
    projects: mergedProjects,
  });
}

async function fetchProjectVolumeStudio(projectId) {
  if (!(location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    return null;
  }
  const response = await fetch(projectVolumeStudioApiUrl(projectId), {
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

async function saveWorkspaceToServer(payload) {
  if (!(location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    return false;
  }
  const project = payload?.projects?.find((item) => item.id === activeProjectId) || payload?.projects?.[0];
  if (!project) return false;
  const response = await fetch(projectVolumeStudioApiUrl(project.id), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: project.title || "",
      outline: project.outline || "",
      activeVolumeId: project.activeVolumeId || "",
      volumes: project.volumes || [],
    }),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const data = await response.json();
  return data || true;
}

function buildWorkspaceMirror(payload) {
  return {
    __type: WORKSPACE_MIRROR_SCHEMA,
    activeProjectId: payload?.activeProjectId || "",
    mockMode: payload?.mockMode ?? false,
    global: clonePlainData(payload?.global || {}),
    projects: (payload?.projects || []).map((project) => ({
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

function broadcastVolumeStudioSync(projectId) {
  if (!projectId) return;
  const payload = JSON.stringify({
    projectId,
    updatedAt: Date.now(),
  });
  localStorage.setItem(VOLUME_STUDIO_SYNC_KEY, payload);
}

async function readWorkspace() {
  try {
    const serverWorkspace = await fetchWorkspaceFromServer();
    if (serverWorkspace && Array.isArray(serverWorkspace.projects)) {
      return normalizeWorkspaceShape(serverWorkspace);
    }
  } catch (error) {
    console.warn("Failed to read workspace from local server:", error);
  }

  const local = readJson(STORAGE_KEY);
  if (local?.projects?.length && local.__type !== WORKSPACE_MIRROR_SCHEMA) {
    return normalizeWorkspaceShape(local);
  }

  const legacy = readJson(LEGACY_STORAGE_KEY);
  if (legacy && typeof legacy === "object") {
    const legacyProjectId = createId("book");
    return normalizeWorkspaceShape({
      global: {},
      mockMode: legacy.mockMode ?? false,
      activeProjectId: legacyProjectId,
      projects: [{
        id: legacyProjectId,
        title: "我的第一本书",
        outline: legacy.outline || "",
        volumeOutline: legacy.volumeOutline || "",
        volumes: [],
        updatedAt: Date.now(),
      }],
    });
  }

  return normalizeWorkspaceShape({ global: {}, projects: [], activeProjectId: "" });
}

async function writeWorkspace() {
  const payload = clonePlainData(workspace);
  saveChain = saveChain
    .catch(() => {})
    .then(async () => {
      try {
        const saved = await saveWorkspaceToServer(payload);
        if (saved && typeof saved === "object" && payload?.projects?.length) {
          const currentIndex = payload.projects.findIndex((project) => project.id === activeProjectId);
          if (currentIndex >= 0) {
            payload.projects[currentIndex] = {
              ...payload.projects[currentIndex],
              ...saved.project,
              volumes: saved.volumes || payload.projects[currentIndex].volumes || [],
            };
          }
          workspace = normalizeWorkspaceShape(payload);
        }
        const syncedProjectId = activeProjectId || payload.activeProjectId || payload.projects?.[0]?.id || "";
        broadcastVolumeStudioSync(syncedProjectId);
        if (saved) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } else {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        }
      } catch (error) {
        console.warn("Failed to write workspace to local server:", error);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      }
      lastSavedAt = Date.now();
      updateSaveMeta();
    });

  return saveChain;
}

async function loadProjectVolumeStudio(projectId) {
  const detail = await fetchProjectVolumeStudio(projectId);
  const existing = workspace.projects.find((project) => project.id === projectId) || { id: projectId };
  const merged = {
    ...existing,
    ...detail.project,
    volumes: detail.volumes || [],
  };
  const index = workspace.projects.findIndex((project) => project.id === projectId);
  if (index >= 0) workspace.projects[index] = merged;
  else workspace.projects.push(merged);
  workspace.activeProjectId = projectId;
  activeProjectId = projectId;
  ensureProjectVolumeState(merged);
  activeVolumeId = merged.activeVolumeId || merged.volumes[0]?.id || "";
  return merged;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  setStudioStatus("保存中", "running");
  saveTimer = setTimeout(() => {
    writeWorkspace().catch((error) => {
      console.error("Failed to save volume studio workspace:", error);
      setStudioStatus("保存失败", "");
    });
  }, 260);
}

function getProject() {
  return workspace.projects.find((project) => project.id === activeProjectId) || workspace.projects[0] || null;
}

function getActiveVolume(project = getProject()) {
  if (!project) return null;
  return project.volumes.find((volume) => volume.id === activeVolumeId) || project.volumes[0] || null;
}

function ensureProjectVolumeState(project) {
  if (!project) return;
  project.volumes = normalizeVolumeRecords(project.volumes, project.volumeOutline);
  project.activeVolumeId = resolveActiveVolumeId(project.volumes, project.activeVolumeId || "");
  if (!activeVolumeId || !project.volumes.some((volume) => volume.id === activeVolumeId)) {
    activeVolumeId = project.activeVolumeId;
  }
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

function markProjectUpdated(project) {
  if (!project) return;
  project.updatedAt = Date.now();
  workspace.activeProjectId = project.id;
}

function syncCurrentVolumeToMain(project, volume) {
  if (!project) return;
  if (!volume) {
    project.volumeOutline = "";
    return;
  }
  project.activeVolumeId = volume.id;
  project.volumeOutline = composeVolumeOutlineText(volume);
}

function updateSaveMeta() {
  const meta = $("studioSaveMeta");
  if (!meta) return;
  if (!lastSavedAt) {
    meta.textContent = "自动保存到当前项目";
    return;
  }
  meta.textContent = `自动保存到当前项目 · 最近保存 ${new Date(lastSavedAt).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })}`;
  setStudioStatus("已保存", "done");
}

function setStudioStatus(text, mode = "") {
  const pill = $("studioStatusPill");
  if (!pill) return;
  pill.textContent = text;
  pill.className = `pill ${mode}`;
}

function renderProjectPicker() {
  const picker = $("studioProjectPicker");
  const projects = workspace.projects || [];
  picker.innerHTML = "";
  projects.forEach((project) => {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.title || "未命名新书";
    picker.appendChild(option);
  });
  picker.value = activeProjectId;
}

function renderVolumeList() {
  const project = getProject();
  const list = $("volumeList");
  const meta = $("volumeCountMeta");
  list.innerHTML = "";

  if (!project) {
    meta.textContent = "0 卷";
    list.innerHTML = `<div class="volume-list-empty">当前没有可用项目。</div>`;
    return;
  }

  ensureProjectVolumeState(project);
  meta.textContent = `${project.volumes.length} 卷`;

  if (!project.volumes.length) {
    list.innerHTML = `<div class="volume-list-empty">还没有分卷，先新增一卷。</div>`;
    return;
  }

  project.volumes.forEach((volume) => {
    const item = document.createElement("div");
    item.className = `volume-item ${volume.id === activeVolumeId ? "active" : ""} ${volume.id === project.activeVolumeId ? "current" : ""}`.trim();
    const button = document.createElement("button");
    button.className = "volume-item-btn";
    button.type = "button";

    const top = document.createElement("div");
    top.className = "volume-item-top";

    const title = document.createElement("strong");
    title.textContent = volume.title || "未命名卷";
    top.appendChild(title);

    if (volume.id === project.activeVolumeId) {
      const badge = document.createElement("span");
      badge.className = "volume-current-badge";
      badge.textContent = "当前";
      top.appendChild(badge);
    }

    const metaText = document.createElement("div");
    metaText.className = "volume-item-meta";
    metaText.textContent = [volume.status, volume.chapterRange].filter(Boolean).join(" · ") || "未填写状态 / 章节范围";

    button.append(top, metaText);
    button.addEventListener("click", () => {
      activeVolumeId = volume.id;
      renderVolumeStudio();
    });
    item.appendChild(button);
    list.appendChild(item);
  });
}

function refreshVolumeDetailChrome() {
  const project = getProject();
  const volume = getActiveVolume(project);
  const hasVolume = Boolean(volume);
  $("volumeDetailHeading").textContent = hasVolume ? (volume.title || "未命名卷") : "未选择分卷";
  $("currentVolumeMeta").textContent = hasVolume
    ? `当前卷状态：${volume.status || "未填写"}${volume.chapterRange ? ` · ${volume.chapterRange}` : ""}`
    : "选中一卷后，在这里沉淀本卷的具体内容。";
  $("setCurrentVolumeBtn").disabled = !hasVolume;
  $("deleteVolumeBtn").disabled = !hasVolume;
  $("setCurrentVolumeBtn").textContent = hasVolume && project.activeVolumeId === volume.id
    ? "当前写作卷"
    : "设为当前写作卷";
  $("volumeOutlinePreview").textContent = hasVolume ? (composeVolumeOutlineText(volume) || "暂无内容") : "暂无内容";
}

function renderVolumeFields() {
  const project = getProject();
  const volume = getActiveVolume(project);
  const hasVolume = Boolean(volume);

  $("studioBookTitleInput").value = project?.title || "";
  $("masterOutline").value = project?.outline || "";
  [
    "volumeTitleInput",
    "volumeStatusInput",
    "volumeChapterRangeInput",
    "volumeSummaryInput",
    "volumeOutlineInput",
    "volumeContentInput",
    "volumeKeyCharsInput",
    "volumeKeyHooksInput",
    "volumeNotesInput",
  ].forEach((id) => {
    $(id).disabled = !hasVolume;
  });

  $("volumeTitleInput").value = volume?.title || "";
  $("volumeStatusInput").value = volume?.status || "";
  $("volumeChapterRangeInput").value = volume?.chapterRange || "";
  $("volumeSummaryInput").value = volume?.summary || "";
  $("volumeOutlineInput").value = volume?.outline || "";
  $("volumeContentInput").value = volume?.content || "";
  $("volumeKeyCharsInput").value = volume?.keyChars || "";
  $("volumeKeyHooksInput").value = volume?.keyHooks || "";
  $("volumeNotesInput").value = volume?.notes || "";
  refreshVolumeDetailChrome();
}

function renderVolumeStudio() {
  renderProjectPicker();
  renderVolumeList();
  renderVolumeFields();
  updateSaveMeta();
}

function updateCurrentVolumeField(field, value) {
  const project = getProject();
  const volume = getActiveVolume(project);
  if (!project || !volume) return;

  volume[field] = String(value || "");
  volume.updatedAt = Date.now();
  if (!volume.title.trim()) {
    volume.title = "未命名卷";
  }
  if (project.activeVolumeId === volume.id) {
    project.volumeOutline = composeVolumeOutlineText(volume);
  }
  markProjectUpdated(project);
  renderVolumeList();
  refreshVolumeDetailChrome();
  scheduleSave();
}

function addVolume() {
  const project = getProject();
  if (!project) return;

  const volume = createVolumeRecord({}, project.volumes.length);
  project.volumes.push(volume);
  activeVolumeId = volume.id;
  if (!project.activeVolumeId) {
    syncCurrentVolumeToMain(project, volume);
  }
  markProjectUpdated(project);
  renderVolumeStudio();
  scheduleSave();
}

function deleteVolume() {
  const project = getProject();
  const volume = getActiveVolume(project);
  if (!project || !volume) return;
  if (!confirm(`确定删除《${volume.title || "未命名卷"}》吗？`)) return;

  project.volumes = project.volumes.filter((item) => item.id !== volume.id);
  activeVolumeId = project.volumes[0]?.id || "";

  if (project.activeVolumeId === volume.id) {
    if (project.volumes[0]) {
      syncCurrentVolumeToMain(project, project.volumes[0]);
      activeVolumeId = project.volumes[0].id;
    } else {
      project.activeVolumeId = "";
      project.volumeOutline = "";
    }
  }

  markProjectUpdated(project);
  renderVolumeStudio();
  scheduleSave();
}

function setCurrentWritingVolume() {
  const project = getProject();
  const volume = getActiveVolume(project);
  if (!project || !volume) return;
  syncCurrentVolumeToMain(project, volume);
  markProjectUpdated(project);
  renderVolumeStudio();
  scheduleSave();
}

function bindEvents() {
  $("studioProjectPicker").addEventListener("change", async (event) => {
    try {
      setStudioStatus("读取中", "running");
      await loadProjectVolumeStudio(event.target.value);
      renderVolumeStudio();
      setStudioStatus("就绪", "done");
    } catch (error) {
      console.error("Failed to switch project in volume studio:", error);
      setStudioStatus("读取失败", "");
    }
  });

  $("studioBookTitleInput").addEventListener("input", (event) => {
    const project = getProject();
    if (!project) return;
    project.title = event.target.value.trim() || "未命名新书";
    markProjectUpdated(project);
    renderProjectPicker();
    scheduleSave();
  });

  $("masterOutline").addEventListener("input", (event) => {
    const project = getProject();
    if (!project) return;
    project.outline = event.target.value.trim();
    markProjectUpdated(project);
    scheduleSave();
  });

  [
    ["volumeTitleInput", "title"],
    ["volumeStatusInput", "status"],
    ["volumeChapterRangeInput", "chapterRange"],
    ["volumeSummaryInput", "summary"],
    ["volumeOutlineInput", "outline"],
    ["volumeContentInput", "content"],
    ["volumeKeyCharsInput", "keyChars"],
    ["volumeKeyHooksInput", "keyHooks"],
    ["volumeNotesInput", "notes"],
  ].forEach(([id, field]) => {
    $(id).addEventListener("input", (event) => updateCurrentVolumeField(field, event.target.value));
  });

  $("addVolumeBtn").addEventListener("click", addVolume);
  $("deleteVolumeBtn").addEventListener("click", deleteVolume);
  $("setCurrentVolumeBtn").addEventListener("click", setCurrentWritingVolume);

  window.addEventListener("beforeunload", () => {
    if (workspace) {
      const payload = clonePlainData(workspace);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(buildWorkspaceMirror(payload)));
      }
    }
  });
}

async function init() {
  workspace = await readWorkspace();
  if (!workspace.projects.length) {
    setStudioStatus("无项目", "");
    $("volumeList").innerHTML = `<div class="volume-list-empty">当前没有项目。先回主工作台新建一本书。</div>`;
    return;
  }

  const search = new URLSearchParams(location.search);
  const queryProjectId = search.get("project");
  activeProjectId = workspace.projects.some((project) => project.id === queryProjectId)
    ? queryProjectId
    : workspace.activeProjectId || workspace.projects[0].id;

  await loadProjectVolumeStudio(activeProjectId);

  bindEvents();
  renderVolumeStudio();
  setStudioStatus("就绪", "done");
}

init().catch((error) => {
  console.error("Failed to load volume studio:", error);
  setStudioStatus("读取失败", "");
  $("volumeList").innerHTML = `<div class="volume-list-empty">卷纲页加载失败：${error.message}</div>`;
});
