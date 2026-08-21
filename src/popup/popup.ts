const statusEl = document.getElementById("status");
const toggleButton = document.getElementById("toggle");
const dynamicButton = document.getElementById("dynamic");
const exportButton = document.getElementById("export");
const clearButton = document.getElementById("clear");
const includeStyleChangesInput = document.getElementById("include-style-changes") as HTMLInputElement | null;
const devLoopServerInput = document.getElementById("dev-loop-server") as HTMLInputElement | null;
const devLoopRunIdInput = document.getElementById("dev-loop-run-id") as HTMLInputElement | null;
const devLoopEnabledInput = document.getElementById("dev-loop-enabled") as HTMLInputElement | null;
const devLoopSaveButton = document.getElementById("dev-loop-save") as HTMLButtonElement | null;
const devBridgeStatusEl = document.getElementById("dev-bridge-status");

const RECORDER_SETTINGS_STORAGE_KEY = "captura.settings";
const RECORDER_DEV_LOOP_STORAGE_KEY = "captura.devLoop";
const RECORDER_DEV_LOOP_DEFAULT_SERVER_URL = LIGENTIA_DEV_LOOP_SERVER_URL || "http://127.0.0.1:8796";

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToPage(type, payload = {}) {
  const tab = await getActiveTab();
  if (!tab || !tab.id) {
    throw new Error("未找到当前页面");
  }
  return chrome.tabs.sendMessage(tab.id, { type, ...payload });
}

async function refreshStatus() {
  try {
    const state = await sendToPage("LWR_GET_STATE");
    const mode = state.annotationMode ? "批注模式" : "非批注模式";
    const dynamic = state.dynamicRecording ? "动态录入中" : "动态未录入";
    statusEl.textContent = `${mode}，${dynamic}，当前页 ${state.pageCount || 0} 个，共 ${state.count || 0} 个 Annotation，${state.dynamicCount || 0} 个 Dynamic 节点。`;
  } catch (error) {
    statusEl.textContent = "当前页面尚未注入 Recorder。请刷新页面后重试。";
  }
  await refreshDevBridgeStatus();
}

async function loadSettings() {
  if (!includeStyleChangesInput) {
    return;
  }
  const stored = await chrome.storage.local.get(RECORDER_SETTINGS_STORAGE_KEY);
  const settings = normalizeSettings(stored[RECORDER_SETTINGS_STORAGE_KEY]);
  includeStyleChangesInput.checked = settings.includeStyleChanges;
}

async function loadDevLoopSettings() {
  if (!devLoopServerInput || !devLoopRunIdInput || !devLoopEnabledInput) {
    return;
  }
  const stored = await chrome.storage.local.get(RECORDER_DEV_LOOP_STORAGE_KEY);
  const settings = normalizeDevLoopSettings(stored[RECORDER_DEV_LOOP_STORAGE_KEY]);
  devLoopServerInput.value = settings.serverUrl;
  devLoopRunIdInput.value = settings.runId;
  devLoopEnabledInput.checked = settings.enabled;
  await refreshDevBridgeStatus(settings);
}

async function saveSettings() {
  if (!includeStyleChangesInput) {
    return;
  }
  await chrome.storage.local.set({
    [RECORDER_SETTINGS_STORAGE_KEY]: {
      includeStyleChanges: includeStyleChangesInput.checked
    }
  });
}

async function saveDevLoopSettings() {
  if (!devLoopServerInput || !devLoopRunIdInput || !devLoopEnabledInput) {
    return;
  }
  await chrome.storage.local.set({
    [RECORDER_DEV_LOOP_STORAGE_KEY]: {
      enabled: devLoopEnabledInput.checked,
      serverUrl: devLoopServerInput.value.trim() || RECORDER_DEV_LOOP_DEFAULT_SERVER_URL,
      runId: devLoopRunIdInput.value.trim()
    }
  });
  await refreshDevBridgeStatus();
}

function normalizeSettings(settings: unknown) {
  const value = settings && typeof settings === "object" ? settings as { includeStyleChanges?: unknown } : {};
  return {
    includeStyleChanges: Boolean(value.includeStyleChanges)
  };
}

function normalizeDevLoopSettings(settings: unknown) {
  const value = settings && typeof settings === "object"
    ? settings as {
        enabled?: unknown;
        serverUrl?: unknown;
        runId?: unknown;
      }
    : {};
  return {
    enabled: Boolean(value.enabled),
    serverUrl: String(value.serverUrl || RECORDER_DEV_LOOP_DEFAULT_SERVER_URL).trim() || RECORDER_DEV_LOOP_DEFAULT_SERVER_URL,
    runId: String(value.runId || "").trim()
  };
}

async function refreshDevBridgeStatus(settings?: ReturnType<typeof normalizeDevLoopSettings>) {
  if (!devBridgeStatusEl) return;
  const config = settings || normalizeDevLoopSettings({
    enabled: devLoopEnabledInput?.checked,
    serverUrl: devLoopServerInput?.value
  });
  const serverUrl = config.serverUrl || RECORDER_DEV_LOOP_DEFAULT_SERVER_URL;
  if (!config.enabled) {
    setDevBridgeStatus("Dev Bridge disconnected", "disconnected");
    return;
  }
  if (!serverUrl) {
    setDevBridgeStatus("Dev Bridge disconnected", "disconnected");
    return;
  }
  try {
    const response = await fetch(`${serverUrl.replace(/\/+$/, "")}/health`, {
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const health = await response.json();
    setDevBridgeStatus(
      health && health.connected ? "Dev Bridge connected" : "Dev Bridge disconnected",
      health && health.connected ? "connected" : "disconnected"
    );
  } catch {
    setDevBridgeStatus("Dev Bridge disconnected", "disconnected");
  }
}

function setDevBridgeStatus(label: string, state: "connected" | "disconnected" | "unknown") {
  if (!devBridgeStatusEl) return;
  devBridgeStatusEl.textContent = label;
  devBridgeStatusEl.className = `bridge-status is-${state}`;
}

toggleButton.addEventListener("click", async () => {
  await sendToPage("LWR_TOGGLE_MODE");
  await refreshStatus();
});

dynamicButton.addEventListener("click", async () => {
  await sendToPage("LWR_TOGGLE_DYNAMIC");
  await refreshStatus();
});

exportButton.addEventListener("click", async () => {
  await sendToPage("LWR_COPY_TEXT");
  await refreshStatus();
});

clearButton.addEventListener("click", async () => {
  await sendToPage("LWR_CLEAR");
  await refreshStatus();
});

includeStyleChangesInput?.addEventListener("change", async () => {
  await saveSettings();
});

devLoopSaveButton?.addEventListener("click", async () => {
  await saveDevLoopSettings();
  await refreshStatus();
});

refreshStatus();
loadSettings();
loadDevLoopSettings();
