// Bootstrap, shared state, toolbar UI, annotation shell, and page event binding.
(() => {
  const ROOT_ATTR = "data-lwr-root";
  const RECORDER_FRAME_ATTR = "data-lwr-recorder-frame";
  if (window.__LIGENTIA_WORKFLOW_RECORDER__ || isRecorderOwnedFrameWindow()) {
    return;
  }
  window.__LIGENTIA_WORKFLOW_RECORDER__ = true;

  const DRAG_THRESHOLD = 6;
  const BLUE = "#60a5fa";
  const DYNAMIC_FRAME_INTERVAL_MS = 200;
  const DYNAMIC_MAX_MUTATIONS_PER_FRAME = 500;
  const DYNAMIC_MAX_RAW_EVENTS = 2000;
  const DYNAMIC_MAX_RAW_MUTATIONS = 5000;
  const DYNAMIC_RAW_EXPORT_BATCH_LIMIT = 1000;
  const DYNAMIC_SUMMARY_MAX_ITEMS = 3;
  const DYNAMIC_SUMMARY_MAX_TEXT_LENGTH = 120;
  const DYNAMIC_SUMMARY_MAX_SIGNAL_ITEMS = 5;
  const DYNAMIC_POSSIBLY_SAME_TARGET_MIN_SIGNALS = 2;
  const DYNAMIC_SESSION_POLL_INTERVAL_MS = 1000;
  const DYNAMIC_ELAPSED_INTERVAL_MS = 1000;
  const DYNAMIC_ARTIFACT_KIND_SCREENSHOT = "screenshot";
  const DYNAMIC_ARTIFACT_MIME_PNG = "image/png";
  const DYNAMIC_SCREENSHOT_ROLE_BEFORE = "before";
  const DYNAMIC_SCREENSHOT_ROLE_AFTER_IMMEDIATE = "after-immediate";
  const DYNAMIC_SCREENSHOT_ROLE_TRANSITION = "transition";
  const DYNAMIC_SCREENSHOT_FILE_BEFORE = "screenshot-before.png";
  const DYNAMIC_SCREENSHOT_FILE_AFTER_IMMEDIATE = "screenshot-after-immediate.png";
  const DYNAMIC_SCREENSHOT_FILE_TRANSITION = "screenshot.png";
  const DYNAMIC_CAPTURE_TIMING_POST_EVENT_DELAYED = "post-event-delayed";
  const DYNAMIC_CAPTURE_TIMING_TRANSITION_DELAYED = "transition-delayed";
  const DYNAMIC_RAW_EVENT_SCHEMA = "captura.raw-event";
  const DYNAMIC_RAW_EVENT_VERSION = 3;
  const DYNAMIC_RAW_RECORDING_SCHEMA = "captura.dynamic-raw-recording";
  const DYNAMIC_RAW_RECORDING_VERSION = 1;
  const DYNAMIC_RAW_LINE_UNIT = "unit";
  const DYNAMIC_RAW_LINE_USER_OPERATION = "user-operation";
  const DYNAMIC_RAW_LINE_DOM_CHANGE = "dom-change";
  const DYNAMIC_RAW_LINE_SCREEN_FRAME = "screen-frame";
  const DYNAMIC_RAW_LINE_UNKNOWN = "unknown";
  const DYNAMIC_RAW_EVENT_TYPE_USER_OPERATION = "user.operation";
  const DYNAMIC_RAW_EVENT_TYPE_DOM_CHANGE = "dom.change";
  const DYNAMIC_RAW_EVENT_TYPE_DOM_SNAPSHOT = "dom.snapshot";
  const DYNAMIC_RAW_EVENT_TYPE_SCREEN_FRAME = "screen.frame";
  const DYNAMIC_RAW_EVENT_TYPE_LEGACY_USER_EVENT = "user.event";
  const DYNAMIC_RAW_EVENT_TYPE_LEGACY_DOM_MUTATION = "dom.mutation";
  const DYNAMIC_RAW_EVENT_TYPE_LEGACY_DOCUMENT_SNAPSHOT = "document.snapshot";
  const DYNAMIC_RAW_EVENT_TYPE_DOCUMENT_JOINED = "document.joined";
  const DYNAMIC_RAW_EVENT_TYPE_DOCUMENT_CHANGED = "document.changed";
  const DYNAMIC_RAW_EVENT_TYPE_DOCUMENT_LEFT = "document.left";
  const DYNAMIC_RAW_PACKAGE_RECORDING_PATH = "recording.json";
  const DYNAMIC_RAW_PACKAGE_EVENTS_PATH = "raw/events.ndjson";
  const DYNAMIC_RAW_PACKAGE_ARTIFACTS_DIR = "artifacts";
  const DYNAMIC_RAW_ARTIFACT_EXTENSION_PNG = ".png";
  const DYNAMIC_RAW_ARTIFACT_FALLBACK_NAME = "artifact";
  const DYNAMIC_RAW_DOWNLOAD_FILENAME_PREFIX = "dynamic-raw-recording";
  const RECORDER_SETTINGS_STORAGE_KEY = "captura.settings";
  const RECORDER_DEV_LOOP_STORAGE_KEY = "captura.devLoop";
  const RECORDER_DEV_LOOP_PROTOCOL = "ligentia.dev-loop.v1";
  const RECORDER_DEV_LOOP_TARGET = "recorder";
  const RECORDER_DEV_LOOP_DEFAULT_SERVER_URL = LIGENTIA_DEV_LOOP_SERVER_URL || "http://127.0.0.1:8795";
  const RECORDER_DEV_LOOP_POLL_MS = 500;
  const RECORDER_DEV_LOOP_COMMAND_LIMIT = 5;
  const RECORDER_INCLUDE_STYLE_CHANGES_DEFAULT = false;
  const DYNAMIC_STYLE_ATTRIBUTE_NAME = "style";
  const DYNAMIC_MUTATION_ATTRIBUTE_FILTER_BASE = ["disabled", "aria-busy", "aria-expanded", "aria-hidden", "class", "value"];
  const STATIC_FRAME_AGENT_MESSAGE_TYPE = "LWR_STATIC_FRAME_AGENT";
  const STATIC_FRAME_AGENT_REQUEST_TIMEOUT_MS = 1600;
  const STATIC_POPOVER_FRAME_WIDTH = 560;
  const STATIC_POPOVER_FRAME_HEIGHT = 620;
  const STATIC_POPOVER_FRAME_MIN_WIDTH = 420;
  const STATIC_POPOVER_FRAME_MIN_HEIGHT = 460;
  const STATIC_POPOVER_FRAME_VIEWPORT_MARGIN = 12;
  const DYNAMIC_DOM_PAYLOAD_DATA_IMAGE_REPLACEMENT = "[lwr-data-image-redacted]";
  const DYNAMIC_DOM_PAYLOAD_DATA_RESOURCE_REPLACEMENT = "[lwr-data-resource-redacted]";
  const DYNAMIC_DOM_PAYLOAD_CSS_REPLACEMENT = "[lwr-css-redacted]";
  const DYNAMIC_DOM_PAYLOAD_DATA_IMAGE_RE = /data:image\/[^"')\s<>]+/gi;
  const DYNAMIC_DOM_PAYLOAD_DATA_RESOURCE_RE = /data:[^"')\s<>]+;base64,[^"')\s<>]+/gi;
  const DYNAMIC_DOM_PAYLOAD_STYLE_TAG_RE = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
  const DYNAMIC_DOM_PAYLOAD_INLINE_STYLE_RE = /\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
  const DYNAMIC_DOM_PAYLOAD_CSS_BLOCK_RE = /\{[^}]*\}/;
  const DYNAMIC_DOM_PAYLOAD_CSS_PROPERTY_RE = /(^|[{};])\s*(?:--[\w-]+|[a-z][\w-]*)\s*:/i;
  const DYNAMIC_ACTIONABLE_ROLES = new Set(["button", "link", "menuitem", "option", "tab", "checkbox", "radio", "switch", "combobox", "listbox"]);
  const DYNAMIC_WEAK_ACTIONABLE_CLASS_RE = /\b(btn|button|clickable|menu-item|menuitem|select-selector|select-item|option|dropdown|tab|segmented|checkbox|radio|switch|tree-node)\b/i;
  const DYNAMIC_LOW_VALUE_SELECTOR_RE = /(^|[\s.#-])(wave|motion|ripple|ink|hover|row-hover|scrollbar|measure-row|resize-observer|sentinel)([\s.#-]|$)/i;
  const STATIC_TARGET_PREFERRED_SELECTOR = [
    "a[href]",
    "button",
    "input",
    "select",
    "textarea",
    "label",
    "summary",
    "option",
    "[role]",
    "[onclick]",
    "[tabindex]",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "li",
    "td",
    "th"
  ].join(",");
  const testMode = Boolean(window.__LIGENTIA_WORKFLOW_RECORDER_TEST_MODE__);
  const isTopDocument = window.top === window;
  const dynamicAgentInstanceId = createDynamicRuntimeId("agent");
  const dynamicDocumentLifecycleId = createDynamicRuntimeId(isTopDocument ? "document" : "iframe");
  const state = {
    toolbarExpanded: false,
    annotationMode: false,
    annotations: [],
    pageAnnotations: [],
    fields: [],
    dragging: null,
    toolbarDrag: null,
    toolbarDock: "right",
    toolbarDockTransition: "idle",
    toolbarDockTransitionToken: 0,
    toolbarDragCollapsed: false,
    toolbarOffset: { left: null, right: 18, top: 18 },
    suppressToolbarClick: false,
    annotationDragId: null,
    draft: null,
    hoverElement: null,
    pageKey: location.href,
    dynamic: createEmptyDynamicState(),
    settings: {
      includeStyleChanges: RECORDER_INCLUDE_STYLE_CHANGES_DEFAULT
    },
    devLoop: {
      enabled: false,
      serverUrl: RECORDER_DEV_LOOP_DEFAULT_SERVER_URL,
      runId: "",
      connected: false,
      lastError: "",
      lastCommandAt: "",
      pollTimer: null
    },
    staticFrameRequests: new Map(),
    staticFrameRequestSeq: 0,
    staticFrameAgentGeneration: 0,
    staticFramePointerSeq: 0,
    staticFrameLocalDrag: null,
    staticFrameLocalHovering: false,
    staticFrameLocalAnnotationPending: false,
    staticFrameAnnotationLocked: false,
    rawLocalSequence: 0,
    sessionPollTimer: null
  };

  if (testMode) {
    installDynamicRecorderTestHooks();
    return;
  }

  const ui = isTopDocument ? createUi() : createFrameAgentUi();
  window.addEventListener("error", suppressInvalidatedExtensionAlert, true);
  window.addEventListener("unhandledrejection", suppressInvalidatedExtensionAlert, true);
  if (isTopDocument) {
    bindToolbar();
    bindAnnotationShield();
    bindMessages();
    watchPageNavigation();
    syncAnnotationStore().catch((error) => console.warn("LWR store sync failed", error));
  }
  installRecorderSettingsListener();
  installRecorderDevLoopListener();
  installStaticFrameAgentMessaging();
  syncRecorderSettings()
    .catch((error) => console.warn("LWR recorder settings sync failed", error))
    .finally(() => {
      syncRecorderDevLoopSettings().catch((error) => console.warn("LWR recorder dev mcp bridge sync failed", error));
      bindPageEvents();
      restoreDynamicRecordingState().catch((error) => console.warn("LWR dynamic restore failed", error));
      startDynamicSessionPoller();
      updateToolbar();
    });

  function isRecorderOwnedFrameWindow() {
    try {
      const frame = window.frameElement;
      return Boolean(frame && (
        frame.id === "lwr-popover-frame"
        || frame.getAttribute(ROOT_ATTR) === "true"
        || frame.getAttribute(RECORDER_FRAME_ATTR) === "true"
      ));
    } catch (_) {
      return false;
    }
  }

  async function syncRecorderSettings() {
    if (!chrome.storage || !chrome.storage.local) {
      return;
    }
    const stored = await chrome.storage.local.get(RECORDER_SETTINGS_STORAGE_KEY);
    applyRecorderSettings(stored[RECORDER_SETTINGS_STORAGE_KEY]);
  }

  function installRecorderSettingsListener() {
    if (!chrome.storage || !chrome.storage.onChanged) {
      return;
    }
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[RECORDER_SETTINGS_STORAGE_KEY]) {
        return;
      }
      applyRecorderSettings(changes[RECORDER_SETTINGS_STORAGE_KEY].newValue);
    });
  }

  function applyRecorderSettings(settings) {
    const previousIncludeStyleChanges = state.settings.includeStyleChanges;
    const next = normalizeRecorderSettings(settings);
    state.settings = next;
    if (previousIncludeStyleChanges !== next.includeStyleChanges && state.dynamic.enabled) {
      stopDynamicMutationObserver();
      startDynamicMutationObserver();
    }
  }

  function normalizeRecorderSettings(settings) {
    return {
      includeStyleChanges: Boolean(settings && settings.includeStyleChanges)
    };
  }

  async function syncRecorderDevLoopSettings() {
    if (!isTopDocument || !isRecorderDevBuild() || !chrome.storage || !chrome.storage.local) {
      return;
    }
    const stored = await chrome.storage.local.get(RECORDER_DEV_LOOP_STORAGE_KEY);
    applyRecorderDevLoopSettings(stored[RECORDER_DEV_LOOP_STORAGE_KEY]);
  }

  function installRecorderDevLoopListener() {
    if (!isTopDocument || !chrome.storage || !chrome.storage.onChanged) {
      return;
    }
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[RECORDER_DEV_LOOP_STORAGE_KEY]) {
        return;
      }
      applyRecorderDevLoopSettings(changes[RECORDER_DEV_LOOP_STORAGE_KEY].newValue);
    });
  }

  function applyRecorderDevLoopSettings(settings) {
    const next = normalizeRecorderDevLoopSettings(settings);
    const wasEnabled = state.devLoop.enabled;
    state.devLoop = {
      ...state.devLoop,
      ...next,
      connected: false,
      lastError: ""
    };
    if (!isRecorderDevBuild() || !state.devLoop.enabled) {
      stopRecorderDevLoopPoller();
      return;
    }
    if (!wasEnabled || !state.devLoop.pollTimer) {
      startRecorderDevLoopPoller();
    }
  }

  function normalizeRecorderDevLoopSettings(settings) {
    const value = settings && typeof settings === "object" ? settings : {};
    return {
      enabled: Boolean(value.enabled),
      serverUrl: String(value.serverUrl || LIGENTIA_DEV_LOOP_SERVER_URL || RECORDER_DEV_LOOP_DEFAULT_SERVER_URL).trim() || RECORDER_DEV_LOOP_DEFAULT_SERVER_URL,
      runId: String(value.runId || "").trim()
    };
  }

  function startRecorderDevLoopPoller() {
    stopRecorderDevLoopPoller();
    state.devLoop.pollTimer = window.setInterval(() => {
      pollRecorderDevLoopOnce().catch((error) => {
        state.devLoop.connected = false;
        state.devLoop.lastError = error && error.message ? error.message : String(error);
      });
    }, RECORDER_DEV_LOOP_POLL_MS);
    pollRecorderDevLoopOnce().catch((error) => {
      state.devLoop.connected = false;
      state.devLoop.lastError = error && error.message ? error.message : String(error);
    });
  }

  function stopRecorderDevLoopPoller() {
    if (state.devLoop.pollTimer) {
      window.clearInterval(state.devLoop.pollTimer);
      state.devLoop.pollTimer = null;
    }
    state.devLoop.connected = false;
  }

  async function pollRecorderDevLoopOnce() {
    if (!isTopDocument || !state.devLoop.enabled) {
      return;
    }
    if (!state.devLoop.runId) {
      const registered = await registerRecorderDevLoopClient();
      if (!registered) return;
    }
    const response = await fetch(buildRecorderDevLoopUrl("commands", {
      target: RECORDER_DEV_LOOP_TARGET,
      runId: state.devLoop.runId,
      limit: String(RECORDER_DEV_LOOP_COMMAND_LIMIT)
    }), { cache: "no-store" });
    if (response.status === 401) {
      state.devLoop.runId = "";
      state.devLoop.connected = false;
      state.devLoop.lastError = "Dev MCP Bridge run expired; re-registering.";
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    state.devLoop.connected = true;
    state.devLoop.lastError = "";
    const commands = Array.isArray(body.commands) ? body.commands : [];
    for (const command of commands) {
      await runRecorderDevLoopCommand(command);
    }
  }

  async function registerRecorderDevLoopClient() {
    const response = await fetch(buildRecorderDevLoopUrl("register", {
      target: RECORDER_DEV_LOOP_TARGET,
      clientId: chrome.runtime.id,
      versionName: chrome.runtime.getManifest().version_name || ""
    }), { cache: "no-store" });
    if (!response.ok) {
      if (response.status === 404) return false;
      throw new Error(`Dev MCP Bridge register failed: HTTP ${response.status}`);
    }
    const body = await response.json();
    if (!body || !body.ok || !body.runId) return false;
    state.devLoop.runId = body.runId;
    state.devLoop.connected = true;
    state.devLoop.lastError = "";
    return true;
  }

  async function runRecorderDevLoopCommand(command) {
    const result = {
      protocol: RECORDER_DEV_LOOP_PROTOCOL,
      runId: state.devLoop.runId,
      commandId: command && command.commandId ? command.commandId : "",
      target: RECORDER_DEV_LOOP_TARGET,
      status: "ok",
      value: null
    };
    try {
      assertRecorderDevLoopCommand(command);
      state.devLoop.lastCommandAt = new Date().toISOString();
      result.value = await handleRecorderDevLoopCommand(command.command, command.payload);
    } catch (error) {
      result.status = "error";
      result.error = {
        message: error && error.message ? error.message : String(error),
        stack: error && error.stack ? error.stack : undefined
      };
      delete result.value;
    }
    await postRecorderDevLoopResult(result);
  }

  function assertRecorderDevLoopCommand(command) {
    if (!command || command.protocol !== RECORDER_DEV_LOOP_PROTOCOL) throw new Error("Invalid Dev MCP Bridge protocol.");
    if (command.target !== RECORDER_DEV_LOOP_TARGET) throw new Error(`Invalid Dev MCP Bridge target: ${command.target}`);
    if (command.runId !== state.devLoop.runId) throw new Error("Invalid Dev MCP Bridge run.");
    if (!command.commandId || !command.command) throw new Error("Invalid Dev MCP Bridge command.");
  }

  async function handleRecorderDevLoopCommand(command, payload = {}) {
    if (command === "recorder.getState") return serializeRecorderDevLoopState();
    if (command === "recorder.startDynamic") return startRecorderDevLoopDynamic(payload);
    if (command === "recorder.stopDynamic") return stopRecorderDevLoopDynamic(payload);
    if (command === "recorder.exportDynamicRaw") return exportRecorderDevLoopDynamicRaw(payload);
    if (command === "recorder.stopAndExportDynamicRaw") return stopAndExportRecorderDevLoopDynamicRaw(payload);
    if (command === "recorder.clear") {
      await clearAnnotations();
      await storeMessage("LWR_STORE_DYNAMIC_CLEAR");
      if (state.dynamic.sessionId) {
        await storeMessage("LWR_DYNAMIC_SESSION_CLEAR_RAW", {
          sessionId: state.dynamic.sessionId,
          generation: state.dynamic.generation
        });
      }
      state.dynamic = createEmptyDynamicState();
      updateToolbar();
      return serializeRecorderDevLoopState();
    }
    throw new Error(`Unknown Recorder Dev MCP Bridge command: ${command}`);
  }

  async function postRecorderDevLoopResult(result) {
    const response = await fetch(buildRecorderDevLoopUrl("results"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(result)
    });
    if (!response.ok) throw new Error(`Dev MCP Bridge result POST failed: HTTP ${response.status}`);
  }

  function buildRecorderDevLoopUrl(pathName, params = {}) {
    const base = (state.devLoop.serverUrl || RECORDER_DEV_LOOP_DEFAULT_SERVER_URL).replace(/\/+$/, "");
    const url = new URL(`${base}/${String(pathName).replace(/^\/+/, "")}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    return url.toString();
  }

  function serializeRecorderDevLoopState() {
    const manifest = chrome.runtime.getManifest();
    return {
      protocol: "ligentia.recorder.dev-loop.v1",
      name: manifest.name,
      version: manifest.version,
      versionName: manifest.version_name || "",
      dynamicRecording: state.dynamic.enabled,
      sessionId: state.dynamic.sessionId,
      generation: state.dynamic.generation,
      rawBusPackageCount: state.dynamic.rawBusPackageCount || 0,
      annotationMode: state.annotationMode,
      annotationCount: state.annotations.length,
      pageAnnotationCount: state.pageAnnotations.length,
      page: {
        url: location.href,
        title: document.title
      },
      devMcpBridge: {
        enabled: state.devLoop.enabled,
        connected: state.devLoop.connected,
        lastError: state.devLoop.lastError,
        lastCommandAt: state.devLoop.lastCommandAt
      }
    };
  }

  async function startRecorderDevLoopDynamic(payload = {}) {
    if (payload.clearPrevious) {
      await storeMessage("LWR_STORE_DYNAMIC_CLEAR");
      if (state.dynamic.sessionId) {
        await storeMessage("LWR_DYNAMIC_SESSION_CLEAR_RAW", {
          sessionId: state.dynamic.sessionId,
          generation: state.dynamic.generation
        });
      }
      state.dynamic = createEmptyDynamicState();
    }
    if (!state.dynamic.enabled) {
      await startDynamicRecording({
        runId: payload.runId || state.devLoop.runId,
        metadata: payload.metadata || {}
      });
    }
    return serializeRecorderDevLoopState();
  }

  async function stopRecorderDevLoopDynamic(payload = {}) {
    if (!state.dynamic.enabled) {
      return serializeRecorderDevLoopState();
    }
    return stopDynamicRecording(payload.reason || "dev-loop-stop", {
      exportMode: "none"
    });
  }

  async function exportRecorderDevLoopDynamicRaw(payload = {}) {
    const result = await downloadDynamicRecordingZip({
      uploadUrl: payload.uploadUrl,
      filename: payload.filename,
      metadata: payload.metadata || {},
      clearRawAfterUpload: payload.clearRawAfterUpload !== false
    });
    if (result.uploaded && payload.clearRawAfterUpload !== false && state.dynamic.sessionId) {
      await storeMessage("LWR_DYNAMIC_SESSION_CLEAR_RAW", {
        sessionId: state.dynamic.sessionId,
        generation: state.dynamic.generation
      });
    }
    return result;
  }

  async function stopAndExportRecorderDevLoopDynamicRaw(payload = {}) {
    if (state.dynamic.enabled) {
      return stopDynamicRecording(payload.reason || "dev-loop-stop-export", {
        exportMode: "upload",
        uploadUrl: payload.uploadUrl,
        filename: payload.filename,
        metadata: payload.metadata || {},
        clearRawAfterUpload: payload.clearRawAfterUpload !== false
      });
    }
    return exportRecorderDevLoopDynamicRaw(payload);
  }

  function isRecorderDevBuild() {
    const manifest = chrome.runtime.getManifest();
    return String(manifest.version_name || "").endsWith("-dev")
      || String(manifest.version_name || "") === "dev"
      || String(manifest.name || "").endsWith("Dev");
  }

  function createUi() {
    const host = document.createElement("div");
    host.id = "lwr-shadow-host";
    host.setAttribute(ROOT_ATTR, "true");
    const root = host.attachShadow({ mode: "closed", delegatesFocus: true });
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = chrome.runtime.getURL("content/recorder.css");

    const toolbar = document.createElement("div");
    toolbar.id = "lwr-toolbar";
    toolbar.innerHTML = [
      '<button type="button" class="lwr-launcher" data-action="launcher" title="开始静态标注" aria-label="Captura">',
      recorderMarkHtml(),
      "</button>",
      '<div class="lwr-toolbar-main">',
      '<button type="button" class="lwr-tool-button lwr-mode-tool lwr-dynamic-entry" data-action="dynamic-record" title="动态录入"><span class="lwr-tool-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3a9 9 0 1 1-9 9"/></svg></span><span>动态录入</span></button>',
      '<span class="lwr-divider"></span>',
      '<button type="button" class="lwr-tool-button" data-action="annotations" title="批注列表"><span class="lwr-tool-badge" data-role="annotation-count" hidden>0</span><span class="lwr-tool-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 6.5h14v9H9l-4 3v-12Z"/><path d="M8 10h8M8 13h5"/></svg></span><span>批注</span></button>',
      '<button type="button" class="lwr-tool-button" data-action="fields" title="字段配置"><span class="lwr-tool-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 4h10v16H7z"/><path d="M4 8h3M4 16h3M17 8h3M17 16h3"/></svg></span><span>字段</span></button>',
      '<button type="button" class="lwr-tool-button" data-action="export" title="复制文本"><span class="lwr-tool-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 7h8M8 11h8M8 15h5"/><path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4"/></svg></span><span>复制文本</span></button>',
      '<button type="button" class="lwr-tool-button" data-action="export-zip" title="导出 ZIP"><span class="lwr-tool-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 4v10"/><path d="m8 10 4 4 4-4"/><path d="M5 19h14"/></svg></span><span>导出 ZIP</span></button>',
      '<button type="button" class="lwr-tool-button" data-action="import-zip" title="导入 ZIP"><span class="lwr-tool-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 20V10"/><path d="m8 14 4-4 4 4"/><path d="M5 5h14"/></svg></span><span>导入 ZIP</span></button>',
      '<button type="button" class="lwr-tool-button" data-action="clear" title="清空"><span class="lwr-tool-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 7h14"/><path d="M9 7V4h6v3"/><path d="M8 10v9M12 10v9M16 10v9"/><path d="M6 7l1 14h10l1-14"/></svg></span><span>清空</span></button>',
      "</div>",
      '<div class="lwr-dynamic-panel" hidden>',
      '<span class="lwr-record-pulse" aria-hidden="true"><span></span></span>',
      '<strong>动态录入中</strong>',
      '<span class="lwr-divider"></span>',
      '<span class="lwr-dynamic-nodes">N0</span>',
      '<span class="lwr-dynamic-elapsed">00:00:00</span>',
      '<button type="button" class="lwr-stop-button" data-action="stop-dynamic">停止</button>',
      "</div>"
    ].join("");

    const hoverBox = document.createElement("div");
    hoverBox.id = "lwr-hover-box";

    const regionBox = document.createElement("div");
    regionBox.id = "lwr-region-box";

    const eventShield = document.createElement("div");
    eventShield.id = "lwr-event-shield";
    eventShield.setAttribute(ROOT_ATTR, "true");

    const markerLayer = document.createElement("div");
    markerLayer.id = "lwr-marker-layer";

    root.append(stylesheet, eventShield, toolbar, hoverBox, regionBox, markerLayer);
    document.documentElement.append(host);
    return {
      host,
      root,
      toolbar,
      eventShield,
      hoverBox,
      regionBox,
      markerLayer,
      popover: null,
      fieldPanel: null,
      annotationPanel: null,
      editorFocusTimer: null,
      activeEditor: null
    };
  }

  function createFrameAgentUi() {
    const host = document.createElement("div");
    host.id = "lwr-shadow-host";
    host.setAttribute(ROOT_ATTR, "true");
    host.setAttribute("data-frame-agent-host", "true");
    host.style.setProperty("pointer-events", "none", "important");
    const root = host.attachShadow({ mode: "closed", delegatesFocus: true });
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = chrome.runtime.getURL("content/recorder.css");
    const hoverBox = document.createElement("div");
    hoverBox.id = "lwr-hover-box";
    hoverBox.setAttribute("data-frame-agent", "true");
    const regionBox = document.createElement("div");
    regionBox.id = "lwr-region-box";
    regionBox.setAttribute("data-frame-agent", "true");
    root.append(stylesheet, hoverBox, regionBox);
    document.documentElement.append(host);
    return {
      host,
      root,
      toolbar: null,
      eventShield: null,
      hoverBox,
      regionBox,
      markerLayer: null,
      popover: null,
      fieldPanel: null,
      annotationPanel: null,
      editorFocusTimer: null,
      activeEditor: null
    };
  }

  function recorderMarkHtml() {
    return [
      '<span class="lwr-recorder-mark" aria-hidden="true">',
      '<svg viewBox="0 0 28 28" focusable="false">',
      '<path class="lwr-flow-line" d="M7.1 17.7c2.8-3.8 5.3-4.1 6.6-1.1 1.2 2.8 4.5 2 5.2-.8.2-.8.2-1.7.2-2.7V10.8" />',
      '<circle class="lwr-flow-dot" cx="6.7" cy="17.8" r="2.7" />',
      '<rect class="lwr-flow-node" x="16.8" y="6.1" width="5.8" height="5.8" rx="0.7" />',
      "</svg>",
      "</span>"
    ].join("");
  }

  function bindToolbar() {
    ui.toolbar.addEventListener("mousedown", onToolbarMouseDown, true);
    ui.toolbar.addEventListener("click", (event) => {
      if (state.suppressToolbarClick) {
        state.suppressToolbarClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const button = event.target.closest("button");
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();

      const action = button.getAttribute("data-action");
      if (action === "launcher") {
        toggleToolbarExpanded();
      } else if (action === "dynamic-record") {
        toggleDynamicRecording().catch((error) => showRecorderError("动态录入切换失败", error));
      } else if (action === "stop-dynamic") {
        stopDynamicRecording("stop-button").catch((error) => showRecorderError("停止动态录入失败", error));
      } else if (action === "annotations") {
        closeExportMenu();
        openAnnotationManager();
      } else if (action === "fields") {
        closeExportMenu();
        openFieldManager();
      } else if (action === "export") {
        closeExportMenu();
        copyDetailedAnnotationsText().catch((error) => showRecorderError("复制文本失败", error));
      } else if (action === "toggle-export-menu") {
        toggleExportMenu();
      } else if (action === "export-zip") {
        closeExportMenu();
        exportZip().catch((error) => showRecorderError("导出失败", error));
      } else if (action === "import-zip") {
        closeExportMenu();
        openZipImportPicker();
      } else if (action === "clear") {
        closeExportMenu();
        clearAnnotations().catch((error) => showRecorderError("清空失败", error));
      }
    });
  }

  function toggleExportMenu() {
    const menu = ui.toolbar.querySelector(".lwr-export-menu");
    if (!menu) {
      return;
    }
    menu.hidden = !menu.hidden;
  }

  function closeExportMenu() {
    const menu = ui.toolbar.querySelector(".lwr-export-menu");
    if (menu) {
      menu.hidden = true;
    }
  }

  function bindAnnotationShield() {
    ui.eventShield.addEventListener("mousemove", onMouseMove, true);
    ui.eventShield.addEventListener("mousedown", onMouseDown, true);
    ui.eventShield.addEventListener("mouseup", onMouseUp, true);
    ui.eventShield.addEventListener("click", onClick, true);
    ["pointerdown", "pointermove", "pointerup", "pointercancel", "dblclick", "auxclick", "contextmenu"].forEach((type) => {
      ui.eventShield.addEventListener(type, isolateAnnotationPointerEvent, true);
    });
  }

  function onToolbarMouseDown(event) {
    if (event.button !== 0) {
      return;
    }
    const rect = ui.toolbar.getBoundingClientRect();
    state.toolbarDrag = {
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      originLeft: rect.left,
      originTop: rect.top,
      latestLeft: rect.left,
      latestTop: rect.top,
      width: rect.width,
      height: rect.height,
      moved: false
    };
    document.addEventListener("mousemove", onToolbarMouseMove, true);
    document.addEventListener("mouseup", onToolbarMouseUp, true);
  }

  function onToolbarMouseMove(event) {
    if (!state.toolbarDrag) {
      return;
    }
    const dx = Math.abs(event.clientX - state.toolbarDrag.startX);
    const dy = Math.abs(event.clientY - state.toolbarDrag.startY);
    if ((dx > 3 || dy > 3) && !state.toolbarDrag.moved) {
      state.toolbarDrag.moved = true;
      state.suppressToolbarClick = true;
      ui.toolbar.setAttribute("data-dragging", "true");
      if (collapseToolbarForDrag()) {
        state.toolbarDrag.offsetX = (state.toolbarDrag.width || 42) / 2;
        state.toolbarDrag.offsetY = (state.toolbarDrag.height || 42) / 2;
      }
    }
    if (!state.toolbarDrag.moved) {
      return;
    }

    const width = state.toolbarDrag.width || 42;
    const height = state.toolbarDrag.height || 42;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, event.clientX - state.toolbarDrag.offsetX));
    const top = Math.max(8, Math.min(window.innerHeight - height - 8, event.clientY - state.toolbarDrag.offsetY));
    state.toolbarDrag.latestLeft = left;
    state.toolbarDrag.latestTop = top;
    ui.toolbar.style.transform = `translate3d(${left - state.toolbarDrag.originLeft}px, ${top - state.toolbarDrag.originTop}px, 0)`;
    event.preventDefault();
    event.stopPropagation();
  }

  function onToolbarMouseUp(event) {
    if (state.toolbarDrag && state.toolbarDrag.moved) {
      ui.toolbar.style.transform = "";
      ui.toolbar.style.left = `${state.toolbarDrag.latestLeft}px`;
      ui.toolbar.style.top = `${state.toolbarDrag.latestTop}px`;
      ui.toolbar.style.right = "auto";
      dockToolbarToNearestSide();
      event.preventDefault();
      event.stopPropagation();
    } else {
      ui.toolbar.style.transform = "";
    }
    state.toolbarDrag = null;
    ui.toolbar.removeAttribute("data-dragging");
    document.removeEventListener("mousemove", onToolbarMouseMove, true);
    document.removeEventListener("mouseup", onToolbarMouseUp, true);
  }

  function collapseToolbarForDrag() {
    if (state.toolbarDragCollapsed || state.dynamic.enabled) {
      return false;
    }
    if (!(state.toolbarExpanded || state.annotationMode)) {
      return false;
    }
    state.toolbarDragCollapsed = true;
    closeExportMenu();
    ui.toolbar.setAttribute("data-drag-collapse", "true");
    ui.toolbar.setAttribute("data-expanded", "false");
    return true;
  }

  async function dockToolbarToNearestSide() {
    const rect = ui.toolbar.getBoundingClientRect();
    const nextDock = rect.left + rect.width / 2 < window.innerWidth / 2 ? "left" : "right";
    const nextPosition = getToolbarDockPosition(rect, nextDock);
    const currentDock = state.toolbarDock || "right";
    const logicallyExpanded = (state.toolbarExpanded || state.annotationMode) && !state.dynamic.enabled;
    const wasCollapsedForDrag = state.toolbarDragCollapsed;
    const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const shouldAnimateDockChange = nextDock !== currentDock && (logicallyExpanded || wasCollapsedForDrag) && !reducedMotion;
    const transitionToken = state.toolbarDockTransitionToken + 1;
    state.toolbarDockTransitionToken = transitionToken;

    if (!shouldAnimateDockChange && !wasCollapsedForDrag) {
      applyToolbarDockPosition(nextDock, nextPosition);
      setToolbarDockTransition("idle");
      repositionOpenToolbarPanels();
      return;
    }

    if (!wasCollapsedForDrag) {
      setToolbarDockTransition("collapsing");
      await waitForToolbarTransition(140);
      if (state.toolbarDockTransitionToken !== transitionToken) {
        return;
      }
    }

    const collapsedRect = ui.toolbar.getBoundingClientRect();
    const launcherBeforeDockChange = getToolbarLauncherRect();
    if (shouldAnimateDockChange) {
      setToolbarDockTransition("moving");
      state.toolbarDock = nextDock;
      ui.toolbar.style.left = `${collapsedRect.left}px`;
      ui.toolbar.style.right = "auto";
      ui.toolbar.style.top = `${nextPosition.top}px`;
      updateToolbarDockAttribute();
      const launcherAfterDockChange = getToolbarLauncherRect();
      if (launcherBeforeDockChange && launcherAfterDockChange) {
        const compensatedLeft = collapsedRect.left + launcherBeforeDockChange.left - launcherAfterDockChange.left;
        ui.toolbar.style.left = `${compensatedLeft}px`;
      }
      void ui.toolbar.offsetWidth;
      ui.toolbar.style.left = `${getToolbarLeftForDockPosition(nextDock, nextPosition, ui.toolbar.getBoundingClientRect().width)}px`;
      ui.toolbar.style.right = "auto";
      await waitForToolbarTransition(120);
      if (state.toolbarDockTransitionToken !== transitionToken) {
        return;
      }
    }

    applyToolbarDockPosition(nextDock, nextPosition);
    state.toolbarDragCollapsed = false;
    ui.toolbar.removeAttribute("data-drag-collapse");
    setToolbarDockTransition("expanding");
    updateToolbar();
    repositionOpenToolbarPanels();
    await waitForToolbarTransition(180);
    if (state.toolbarDockTransitionToken !== transitionToken) {
      return;
    }

    setToolbarDockTransition("idle");
    repositionOpenToolbarPanels();
  }

  function getToolbarDockPosition(rect, nextDock) {
    const top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, rect.top));
    if (nextDock === "left") {
      return {
        top,
        left: Math.max(8, Math.min(window.innerWidth - rect.width - 8, rect.left)),
        right: null
      };
    }
    return {
      top,
      left: null,
      right: Math.max(8, Math.min(window.innerWidth - rect.width - 8, window.innerWidth - rect.right))
    };
  }

  function getToolbarLeftForDockPosition(nextDock, nextPosition, width) {
    if (nextDock === "left") {
      return nextPosition.left;
    }
    return Math.max(8, Math.min(window.innerWidth - width - 8, window.innerWidth - nextPosition.right - width));
  }

  function getToolbarLauncherRect() {
    const launcher = ui.toolbar.querySelector(".lwr-launcher");
    return launcher && !launcher.hidden ? launcher.getBoundingClientRect() : null;
  }

  function applyToolbarDockPosition(nextDock, nextPosition) {
    state.toolbarDock = nextDock;
    state.toolbarOffset.top = nextPosition.top;
    ui.toolbar.style.top = `${nextPosition.top}px`;
    if (nextDock === "left") {
      state.toolbarOffset.left = nextPosition.left;
      state.toolbarOffset.right = null;
      ui.toolbar.style.left = `${nextPosition.left}px`;
      ui.toolbar.style.right = "auto";
    } else {
      state.toolbarOffset.right = nextPosition.right;
      state.toolbarOffset.left = null;
      ui.toolbar.style.right = `${nextPosition.right}px`;
      ui.toolbar.style.left = "auto";
    }
    updateToolbarDockAttribute();
  }

  function setToolbarDockTransition(nextTransition) {
    state.toolbarDockTransition = nextTransition || "idle";
    updateToolbarDockTransitionAttribute();
  }

  function updateToolbarDockAttribute() {
    ui.toolbar.setAttribute("data-dock", state.toolbarDock || "right");
    updateToolbarDockTransitionAttribute();
  }

  function updateToolbarDockTransitionAttribute() {
    const transition = state.toolbarDockTransition || "idle";
    if (transition === "idle") {
      ui.toolbar.removeAttribute("data-dock-transition");
      return;
    }
    ui.toolbar.setAttribute("data-dock-transition", transition);
  }

  function waitForToolbarTransition(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function keepToolbarWithinViewport() {
    const rect = ui.toolbar.getBoundingClientRect();
    const margin = 8;
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    const top = Math.max(margin, Math.min(maxTop, rect.top));
    if (top !== rect.top) {
      state.toolbarOffset.top = top;
      ui.toolbar.style.top = `${top}px`;
    }
    if ((state.toolbarDock || "right") === "left") {
      const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
      const anchoredLeft = Number.isFinite(state.toolbarOffset.left) ? state.toolbarOffset.left : rect.left;
      const left = Math.max(margin, Math.min(maxLeft, anchoredLeft));
      if (left !== anchoredLeft || rect.left < margin || rect.right > window.innerWidth - margin) {
        state.toolbarOffset.left = left;
        state.toolbarOffset.right = null;
        ui.toolbar.style.left = `${left}px`;
        ui.toolbar.style.right = "auto";
      }
      return;
    }
    const maxRight = Math.max(margin, window.innerWidth - rect.width - margin);
    const anchoredRight = Number.isFinite(state.toolbarOffset.right) ? state.toolbarOffset.right : window.innerWidth - rect.right;
    const right = Math.max(margin, Math.min(maxRight, anchoredRight));
    if (right !== anchoredRight || rect.left < margin || rect.right > window.innerWidth - margin) {
      state.toolbarOffset.right = right;
      state.toolbarOffset.left = null;
      ui.toolbar.style.right = `${right}px`;
      ui.toolbar.style.left = "auto";
    }
  }

  function bindMessages() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message.type !== "string") {
        return false;
      }

      if (message.type === "LWR_GET_STATE") {
        sendResponse({
          annotationMode: state.annotationMode,
          dynamicRecording: state.dynamic.enabled,
          dynamicCount: state.dynamic.rawBusPackageCount || 0,
          count: state.annotations.length,
          pageCount: state.pageAnnotations.length
        });
        return false;
      }

      if (message.type === "LWR_TOGGLE_MODE") {
        setAnnotationMode(!state.annotationMode);
        sendResponse({
          annotationMode: state.annotationMode,
          dynamicRecording: state.dynamic.enabled,
          dynamicCount: state.dynamic.rawBusPackageCount || 0,
          count: state.annotations.length,
          pageCount: state.pageAnnotations.length
        });
        return false;
      }

      if (message.type === "LWR_TOGGLE_DYNAMIC") {
        toggleDynamicRecording()
          .then(() =>
            sendResponse({
              annotationMode: state.annotationMode,
              dynamicRecording: state.dynamic.enabled,
              dynamicCount: state.dynamic.rawBusPackageCount || 0,
              count: state.annotations.length,
              pageCount: state.pageAnnotations.length
            })
          )
          .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
      }

      if (message.type === "LWR_CLEAR") {
        clearAnnotations()
          .then(() =>
            sendResponse({
              annotationMode: state.annotationMode,
              count: state.annotations.length,
              pageCount: state.pageAnnotations.length
            })
          )
          .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
      }

      if (message.type === "LWR_EXPORT_ZIP") {
        exportZip()
          .then(() => sendResponse({ ok: true }))
          .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
      }

      if (message.type === "LWR_COPY_TEXT") {
        copyDetailedAnnotationsText()
          .then(() => sendResponse({ ok: true }))
          .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
      }

      return false;
    });
  }

  function bindPageEvents() {
    if (isTopDocument) {
      document.addEventListener("mousemove", onMouseMove, true);
      document.addEventListener("mousedown", onMouseDown, true);
      document.addEventListener("mouseup", onMouseUp, true);
      document.addEventListener("click", onClick, true);
      document.addEventListener("keydown", onPageKeyDown, true);
      document.addEventListener("focusin", onPageFocusEvent, true);
      document.addEventListener("focusout", onPageFocusEvent, true);
      document.addEventListener("scroll", refreshViewportPositions, true);
      window.addEventListener("focus", onPageFocusEvent, true);
      window.addEventListener("blur", onPageFocusEvent, true);
      window.addEventListener("scroll", refreshViewportPositions, true);
      window.addEventListener("resize", refreshViewportPositions, true);
    } else {
      document.addEventListener("mousemove", onStaticFrameLocalMouseMove, true);
      document.addEventListener("mousedown", onStaticFrameLocalMouseDown, true);
      document.addEventListener("mouseup", onStaticFrameLocalMouseUp, true);
      document.addEventListener("click", onStaticFrameLocalClick, true);
      document.addEventListener("mouseleave", onStaticFrameLocalLeave, true);
      window.addEventListener("blur", onStaticFrameLocalLeave, true);
      window.addEventListener("pagehide", onStaticFrameLocalLeave, true);
    }
    document.addEventListener("click", onDynamicClick, true);
    document.addEventListener("input", onDynamicInput, true);
    document.addEventListener("change", onDynamicChange, true);
    document.addEventListener("keydown", onDynamicKeyDown, true);
    document.addEventListener("paste", onDynamicPaste, true);
    document.addEventListener("compositionstart", onDynamicCompositionStart, true);
    document.addEventListener("compositionend", onDynamicCompositionEnd, true);
    document.addEventListener("focusout", onDynamicFocusOut, true);
    window.addEventListener("pagehide", onDynamicPageHide, true);
    window.addEventListener("beforeunload", onDynamicPageHide, true);
  }

  function installStaticFrameAgentMessaging() {
    window.addEventListener("message", onStaticFrameAgentMessage, false);
    if (!isTopDocument) {
      requestStaticAnnotationModeFromParent();
    }
  }

  // Static frame protocol:
  // - top document owns toolbar, popover, persistence, and global locks.
  // - child frames own local mouse capture, hover/region boxes, and DOM target picking.
  // - frame drafts are relayed upward; each parent projects coordinates and appends frame metadata.
  function onStaticFrameAgentMessage(event) {
    const message = event.data;
    if (!message || message.type !== STATIC_FRAME_AGENT_MESSAGE_TYPE) {
      return;
    }
    if (message.responseTo) {
      const pending = state.staticFrameRequests.get(message.responseTo);
      if (pending) {
        window.clearTimeout(pending.timer);
        state.staticFrameRequests.delete(message.responseTo);
        pending.resolve(message.payload || {});
      }
      return;
    }
    if (message.action === "mode-request") {
      postStaticFrameAgentResponse(event.source, message.requestId, {
        enabled: Boolean(state.annotationMode)
      });
      return;
    }
    if (message.action === "mode") {
      setStaticAnnotationModeFromParent(Boolean(message.payload && message.payload.enabled));
      postStaticFrameAgentResponse(event.source, message.requestId, { ok: true });
      return;
    }
    if (message.action === "clear") {
      clearStaticFrameAgentBoxes();
      postStaticFrameAgentResponse(event.source, message.requestId, { ok: true });
      return;
    }
    if (message.action === "annotation-lock") {
      setStaticFrameAnnotationLock(Boolean(message.payload && message.payload.locked), {
        preserveHover: Boolean(message.payload && message.payload.preserveHover)
      });
      postStaticFrameAgentResponse(event.source, message.requestId, { ok: true });
      return;
    }
    if (message.action === "local-hover") {
      handleStaticFrameLocalHover(event.source)
        .then((payload) => postStaticFrameAgentResponse(event.source, message.requestId, payload))
        .catch((error) => postStaticFrameAgentResponse(event.source, message.requestId, {
          ok: false,
          unreachableReason: error && error.message ? error.message : String(error)
        }));
      return;
    }
    if (message.action === "local-annotation") {
      handleStaticFrameLocalAnnotation(event.source, message.payload || {})
        .then((payload) => postStaticFrameAgentResponse(event.source, message.requestId, payload))
        .catch((error) => postStaticFrameAgentResponse(event.source, message.requestId, {
          ok: false,
          unreachableReason: error && error.message ? error.message : String(error)
        }));
      return;
    }
  }

  function postStaticFrameAgentResponse(targetWindow, requestId, payload) {
    if (!targetWindow || !requestId) {
      return;
    }
    targetWindow.postMessage({
      type: STATIC_FRAME_AGENT_MESSAGE_TYPE,
      responseTo: requestId,
      payload
    }, "*");
  }

  function requestStaticFrameAgent(targetWindow, action, payload = {}) {
    if (!targetWindow) {
      return Promise.reject(new Error("目标 iframe 不可访问。"));
    }
    const requestId = `${dynamicAgentInstanceId}:static:${state.staticFrameRequestSeq += 1}`;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        state.staticFrameRequests.delete(requestId);
        reject(new Error("iframe agent 未响应。"));
      }, STATIC_FRAME_AGENT_REQUEST_TIMEOUT_MS);
      state.staticFrameRequests.set(requestId, { resolve, reject, timer });
      targetWindow.postMessage({
        type: STATIC_FRAME_AGENT_MESSAGE_TYPE,
        requestId,
        action,
        payload
      }, "*");
    });
  }

  function requestStaticAnnotationModeFromParent() {
    if (!window.parent || window.parent === window) {
      return;
    }
    requestStaticFrameAgent(window.parent, "mode-request")
      .then((response) => setStaticAnnotationModeFromParent(Boolean(response && response.enabled)))
      .catch(() => {});
  }

  function setStaticAnnotationModeFromParent(enabled) {
    state.annotationMode = enabled;
    if (!enabled) {
      state.dragging = null;
      state.staticFrameLocalDrag = null;
      state.staticFrameLocalHovering = false;
      state.staticFrameLocalAnnotationPending = false;
      state.staticFrameAnnotationLocked = false;
      invalidateStaticFrameAgentBoxes();
    }
    broadcastStaticAnnotationMode(enabled);
  }

  function broadcastStaticAnnotationMode(enabled) {
    broadcastStaticFrameAgent("mode", { enabled });
  }

  function broadcastStaticFrameAgent(action, payload = {}) {
    getStaticFrameElements().forEach((frame) => {
      if (!frame.contentWindow) {
        return;
      }
      requestStaticFrameAgent(frame.contentWindow, action, payload).catch(() => {});
    });
  }

  function broadcastStaticFrameAgentExcept(exceptWindow, action, payload = {}) {
    getStaticFrameElements().forEach((frame) => {
      if (!frame.contentWindow || frame.contentWindow === exceptWindow) {
        return;
      }
      requestStaticFrameAgent(frame.contentWindow, action, payload).catch(() => {});
    });
  }

  function lockStaticFramesForAnnotation(preserveWindow = null) {
    state.staticFrameAnnotationLocked = true;
    state.staticFrameLocalDrag = null;
    if (preserveWindow) {
      broadcastStaticFrameAgentExcept(preserveWindow, "annotation-lock", { locked: true, preserveHover: false });
      requestStaticFrameAgent(preserveWindow, "annotation-lock", { locked: true, preserveHover: true }).catch(() => {});
      return;
    }
    state.staticFrameLocalHovering = false;
    invalidateStaticFrameAgentBoxes();
    broadcastStaticFrameAgent("annotation-lock", { locked: true, preserveHover: false });
  }

  function setStaticFrameAnnotationLock(locked, options = {}) {
    state.staticFrameAnnotationLocked = Boolean(locked);
    if (state.staticFrameAnnotationLocked && options.preserveHover) {
      state.staticFrameLocalAnnotationPending = false;
    }
    if (!state.staticFrameAnnotationLocked) {
      state.staticFrameLocalAnnotationPending = false;
    }
    if (state.staticFrameAnnotationLocked) {
      state.staticFrameLocalDrag = null;
      if (!options.preserveHover) {
        state.staticFrameLocalHovering = false;
        invalidateStaticFrameAgentBoxes();
      }
    }
    broadcastStaticFrameAgent("annotation-lock", {
      locked: state.staticFrameAnnotationLocked,
      preserveHover: Boolean(options.preserveHover)
    });
  }

  function onPageKeyDown(event) {
    if (event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "m") {
      event.preventDefault();
      event.stopPropagation();
      setAnnotationMode(!state.annotationMode);
    }
  }

  function onPageFocusEvent(event) {
    if (!state.annotationMode || !ui.popover || isRecorderNode(event.target)) {
      return;
    }
    event.stopImmediatePropagation();
    if (ui.activeEditor && ui.activeEditor.isConnected) {
      requestAnimationFrame(() => ui.activeEditor.focus({ preventScroll: true }));
    }
  }

  function watchPageNavigation() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    history.pushState = function pushState(...args) {
      const result = originalPushState.apply(this, args);
      handlePossiblePageChange();
      return result;
    };
    history.replaceState = function replaceState(...args) {
      const result = originalReplaceState.apply(this, args);
      handlePossiblePageChange();
      return result;
    };
    window.addEventListener("popstate", handlePossiblePageChange);
    window.addEventListener("hashchange", handlePossiblePageChange);
  }

  function shouldHandleStaticFrameLocalEvent(event) {
    return !isTopDocument
      && state.annotationMode
      && !state.staticFrameAnnotationLocked
      && !ui.popover
      && !isRecorderNode(event.target);
  }

  function isolateStaticFrameLocalEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function onStaticFrameLocalMouseMove(event) {
    if (!shouldHandleStaticFrameLocalEvent(event)) {
      return;
    }
    isolateStaticFrameLocalEvent(event);
    notifyStaticFrameLocalHover();
    if (state.staticFrameLocalDrag) {
      handleStaticFramePointerRequest({
        phase: "move",
        x: event.clientX,
        y: event.clientY,
        startX: state.staticFrameLocalDrag.startX,
        startY: state.staticFrameLocalDrag.startY
      }).catch(() => {});
      return;
    }
    handleStaticFramePointerRequest({
      phase: "move",
      x: event.clientX,
      y: event.clientY
    }).catch(() => {});
  }

  function onStaticFrameLocalMouseDown(event) {
    if (!shouldHandleStaticFrameLocalEvent(event) || event.button !== 0) {
      return;
    }
    isolateStaticFrameLocalEvent(event);
    notifyStaticFrameLocalHover();
    state.staticFrameLocalDrag = {
      startX: event.clientX,
      startY: event.clientY
    };
    handleStaticFramePointerRequest({
      phase: "down",
      x: event.clientX,
      y: event.clientY
    }).catch(() => {});
  }

  function onStaticFrameLocalMouseUp(event) {
    if (!shouldHandleStaticFrameLocalEvent(event) || !state.staticFrameLocalDrag) {
      return;
    }
    isolateStaticFrameLocalEvent(event);
    const drag = state.staticFrameLocalDrag;
    state.staticFrameLocalDrag = null;
    handleStaticFramePointerRequest({
      phase: "up",
      x: event.clientX,
      y: event.clientY,
      startX: drag.startX,
      startY: drag.startY
    })
      .then((response) => {
        state.staticFrameLocalAnnotationPending = true;
        return requestStaticFrameAgent(window.parent, "local-annotation", { response });
      })
      .catch((error) => {
        state.staticFrameLocalAnnotationPending = true;
        return requestStaticFrameAgent(window.parent, "local-annotation", {
          response: {
            ok: false,
            unreachableReason: error && error.message ? error.message : String(error)
          }
        }).catch(() => {});
      });
  }

  function onStaticFrameLocalClick(event) {
    if (!shouldHandleStaticFrameLocalEvent(event)) {
      return;
    }
    isolateStaticFrameLocalEvent(event);
  }

  function onStaticFrameLocalLeave() {
    if (isTopDocument) {
      return;
    }
    if (state.staticFrameLocalAnnotationPending || state.staticFrameAnnotationLocked) {
      state.staticFrameLocalDrag = null;
      return;
    }
    state.staticFrameLocalDrag = null;
    state.staticFrameLocalHovering = false;
    clearStaticFrameAgentBoxes();
  }

  function notifyStaticFrameLocalHover() {
    if (state.staticFrameLocalHovering || !window.parent || window.parent === window) {
      return;
    }
    state.staticFrameLocalHovering = true;
    requestStaticFrameAgent(window.parent, "local-hover").catch(() => {});
  }

  function onMouseMove(event) {
    if (isAnnotationShieldEvent(event)) {
      isolateAnnotationPointerEvent(event);
    }
    if (ui.popover) {
      if (state.draft) {
        if (state.draft.frameContext) {
          hideHoverBox();
        } else {
          showBox(ui.hoverBox, selectionForViewport(state.draft));
        }
      }
      return;
    }

    if (!state.annotationMode || (isRecorderNode(event.target) && !isAnnotationShieldEvent(event))) {
      hideHoverBox();
      clearStaticActiveFrameAgent();
      return;
    }

    if (state.dragging) {
      const rect = rectFromPoints(state.dragging.startX, state.dragging.startY, event.clientX, event.clientY);
      if (rect.width > DRAG_THRESHOLD || rect.height > DRAG_THRESHOLD) {
        showBox(ui.regionBox, rect);
        hideHoverBox();
      }
      return;
    }

    const frameTarget = getAnnotatableFrameElement(event.clientX, event.clientY);
    if (frameTarget) {
      state.hoverElement = frameTarget;
      hideHoverBox();
      hideRegionBox();
      return;
    }
    clearStaticActiveFrameAgent();

    const target = getAnnotatableElement(event.clientX, event.clientY);
    state.hoverElement = target;
    if (target) {
      showBox(ui.hoverBox, target.getBoundingClientRect());
    } else {
      hideHoverBox();
    }
  }

  function onMouseDown(event) {
    if (isAnnotationShieldEvent(event)) {
      isolateAnnotationPointerEvent(event);
    }
    if (!state.annotationMode || event.button !== 0 || (isRecorderNode(event.target) && !isAnnotationShieldEvent(event)) || ui.popover) {
      return;
    }

    const frameTarget = getAnnotatableFrameElement(event.clientX, event.clientY);
    if (frameTarget) {
      state.dragging = null;
      state.hoverElement = frameTarget;
      hideHoverBox();
      hideRegionBox();
      return;
    }
    state.dragging = {
      startX: event.clientX,
      startY: event.clientY,
      target: getAnnotatableElement(event.clientX, event.clientY)
    };
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onMouseUp(event) {
    if (isAnnotationShieldEvent(event)) {
      isolateAnnotationPointerEvent(event);
    }
    if (!state.annotationMode || !state.dragging) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    const drag = state.dragging;
    state.dragging = null;
    hideRegionBox();

    const rect = rectFromPoints(drag.startX, drag.startY, event.clientX, event.clientY);
    if (rect.width > DRAG_THRESHOLD || rect.height > DRAG_THRESHOLD) {
      const selection = clampRect(rect);
      openAnnotationInput({
        type: "region",
        selector: "",
        selection,
        documentSelection: selectionToDocument(selection),
        mouse: { x: event.clientX, y: event.clientY }
      });
      return;
    }

    const element = getAnnotatableElement(drag.startX, drag.startY) || drag.target;
    if (!element) {
      return;
    }

    const selection = clampRect(element.getBoundingClientRect());
    const htmlContext = buildElementHtmlContext(element);
    openAnnotationInput({
      type: "element",
      selector: buildSelector(element),
      selection,
      documentSelection: selectionToDocument(selection),
      outerHTML: getOuterHtmlWithoutRecorder(element),
      parentOuterHTML: htmlContext.parentOuterHTML,
      grandparentOuterHTML: htmlContext.grandparentOuterHTML,
      mouse: { x: event.clientX, y: event.clientY }
    });
  }

  function onClick(event) {
    if (isAnnotationShieldEvent(event)) {
      isolateAnnotationPointerEvent(event);
    }
    if (!state.annotationMode || (isRecorderNode(event.target) && !isAnnotationShieldEvent(event)) || ui.popover) {
      return;
    }
    if (getAnnotatableFrameElement(event.clientX, event.clientY)) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  async function handleStaticFrameLocalHover(sourceWindow) {
    if (!state.annotationMode) {
      return { ok: false, unreachableReason: "页面未处于静态批注模式。" };
    }
    const frameElement = findStaticFrameElementForWindow(sourceWindow);
    if (!frameElement) {
      return { ok: false, unreachableReason: "无法定位来源 frame。" };
    }
    broadcastStaticFrameAgentExcept(sourceWindow, "clear");
    if (!isTopDocument && window.parent && window.parent !== window) {
      await requestStaticFrameAgent(window.parent, "local-hover");
    }
    return { ok: true };
  }

  async function handleStaticFrameLocalAnnotation(sourceWindow, payload) {
    if (!state.annotationMode) {
      return { ok: false, unreachableReason: "页面未处于静态批注模式。" };
    }
    if (ui.popover) {
      return { ok: true, skipped: "annotation-popover-open" };
    }
    const frameElement = findStaticFrameElementForWindow(sourceWindow);
    if (!frameElement) {
      return { ok: false, unreachableReason: "无法定位来源 frame。" };
    }
    const response = payload && payload.response ? payload.response : payload;
    if (!isTopDocument) {
      const relayedResponse = response && response.ok !== false
        ? buildNestedStaticFrameResponse(frameElement, response)
        : buildStaticFrameElementResponse(frameElement, "move", {}, new Error(response && response.unreachableReason ? response.unreachableReason : "frame 内未返回目标。"));
      return requestStaticFrameAgent(window.parent, "local-annotation", { response: relayedResponse });
    }
    if (!response || response.ok === false) {
      const frameRect = clampRect(frameElement.getBoundingClientRect());
      openAnnotationInput(buildUnreachableFrameDraft(frameElement, {
        clientX: frameRect.x + Math.min(frameRect.width, 12),
        clientY: frameRect.y + Math.min(frameRect.height, 12)
      }, new Error(response && response.unreachableReason ? response.unreachableReason : "frame 内未返回目标。")), "", {
        preserveFrameWindow: sourceWindow
      });
      return { ok: false, unreachableReason: response && response.unreachableReason ? response.unreachableReason : "frame 内未返回目标。" };
    }
    openAnnotationInput(buildFrameAnnotationDraft(frameElement, response, {}), "", {
      preserveFrameWindow: sourceWindow
    });
    return { ok: true };
  }

  function getAnnotatableFrameElement(x, y) {
    const element = getAnnotatableElement(x, y);
    return isAnnotatableFrameElement(element) ? element : null;
  }

  function isAnnotatableFrameElement(element) {
    return Boolean(element
      && element.tagName
      && /^(iframe|frame)$/i.test(element.tagName)
      && element.contentWindow
      && element.id !== "lwr-popover-frame"
      && element.getAttribute(RECORDER_FRAME_ATTR) !== "true"
      && !isRecorderNode(element)
      && !isOwnExtensionFrame(element));
  }

  function findStaticFrameElementForWindow(sourceWindow) {
    if (!sourceWindow) {
      return null;
    }
    return getStaticFrameElements()
      .find((frame) => frame.contentWindow === sourceWindow) || null;
  }

  function getStaticFrameElements() {
    return Array.from(document.querySelectorAll("iframe, frame"))
      .filter((frame) => isAnnotatableFrameElement(frame));
  }

  function isOwnExtensionFrame(frame) {
    const runtimeBaseUrl = chrome.runtime.getURL("");
    const rawSrc = String(frame.getAttribute("src") || frame.src || "").trim();
    if (!rawSrc) {
      return false;
    }
    try {
      return new URL(rawSrc, location.href).href.startsWith(runtimeBaseUrl);
    } catch (_) {
      return rawSrc.startsWith(runtimeBaseUrl);
    }
  }

  async function handleStaticFramePointerRequest(payload) {
    if (!state.annotationMode) {
      invalidateStaticFrameAgentBoxes();
      return { ok: false, unreachableReason: "iframe agent 未处于静态批注模式。" };
    }
    const pointerGeneration = state.staticFrameAgentGeneration;
    const pointerSeq = state.staticFramePointerSeq += 1;
    const x = Math.max(0, Number(payload.x) || 0);
    const y = Math.max(0, Number(payload.y) || 0);
    const phase = String(payload.phase || "move");
    if (phase === "clear") {
      clearStaticFrameAgentBoxes();
      return { ok: true };
    }
    clearStaticActiveFrameAgent();
    if (!isStaticFramePointerCurrent(pointerGeneration, pointerSeq)) {
      return { ok: false, unreachableReason: "iframe pointer request 已过期。" };
    }
    return buildStaticFrameElementResponse(getAnnotatableElement(x, y), phase, payload);
  }

  function clearStaticActiveFrameAgent() {
    broadcastStaticFrameAgent("clear");
  }

  function clearStaticFrameAgentBoxes() {
    invalidateStaticFrameAgentBoxes();
    clearStaticActiveFrameAgent();
  }

  function invalidateStaticFrameAgentBoxes() {
    state.staticFrameAgentGeneration += 1;
    state.staticFrameLocalHovering = false;
    state.staticFrameLocalDrag = null;
    hideHoverBox();
    hideRegionBox();
  }

  function isStaticFramePointerCurrent(pointerGeneration, pointerSeq) {
    return state.annotationMode
      && pointerGeneration === state.staticFrameAgentGeneration
      && pointerSeq === state.staticFramePointerSeq;
  }

  function buildStaticFrameElementResponse(element, phase, payload, error) {
    if (!element) {
      hideHoverBox();
      return {
        ok: false,
        unreachableReason: error && error.message ? error.message : "iframe 内未命中可标注元素。"
      };
    }
    const hasDragStart = Number.isFinite(Number(payload.startX)) && Number.isFinite(Number(payload.startY));
    const isRegion = hasDragStart && (phase === "up" || phase === "move") && (
      Math.abs((Number(payload.x) || 0) - (Number(payload.startX) || 0)) > DRAG_THRESHOLD
      || Math.abs((Number(payload.y) || 0) - (Number(payload.startY) || 0)) > DRAG_THRESHOLD
    );
    const selection = isRegion
      ? clampRect(rectFromPoints(Number(payload.startX) || 0, Number(payload.startY) || 0, Number(payload.x) || 0, Number(payload.y) || 0))
      : clampRect(element.getBoundingClientRect());
    showBox(isRegion ? ui.regionBox : ui.hoverBox, selection);
    if (!isRegion) {
      hideRegionBox();
    }
    const htmlContext = isRegion ? {} : buildElementHtmlContext(element);
    const selector = isRegion ? "" : buildSelector(element);
    return {
      ok: true,
      type: isRegion ? "region" : "element",
      selector,
      selection,
      documentSelection: selectionToDocument(selection),
      projectedSelection: selection,
      outerHTML: isRegion ? "" : getOuterHtmlWithoutRecorder(element),
      parentOuterHTML: htmlContext.parentOuterHTML || "",
      grandparentOuterHTML: htmlContext.grandparentOuterHTML || "",
      pageUrl: location.href,
      pageTitle: document.title,
      viewport: buildStaticFrameViewport(),
      domHtml: formatHtml(getPageHtmlWithoutRecorder()),
      frameChain: [],
      targetFrame: buildStaticFrameTargetMeta(),
      targetSelector: selector,
      targetSelection: selection,
      targetDocumentSelection: selectionToDocument(selection),
      targetDomHtml: formatHtml(getPageHtmlWithoutRecorder())
    };
  }

  function buildNestedStaticFrameResponse(frameElement, nested) {
    if (!nested || nested.ok === false) {
      return buildStaticFrameElementResponse(frameElement, "move", {}, new Error(nested && nested.unreachableReason ? nested.unreachableReason : "nested iframe agent 未响应。"));
    }
    const frameRect = clampRect(frameElement.getBoundingClientRect());
    const projectedSelection = projectFrameSelection(frameRect, nested.projectedSelection || nested.targetSelection || nested.selection);
    hideHoverBox();
    return {
      ...nested,
      projectedSelection,
      frameChain: [
        buildParentFrameMeta(frameElement),
        ...(Array.isArray(nested.frameChain) ? nested.frameChain : [])
      ]
    };
  }

  function projectFrameSelection(frameRect, childSelection) {
    const child = normalizeSelection(childSelection || { x: 0, y: 0, width: 1, height: 1 });
    return clampRect({
      x: frameRect.x + child.x,
      y: frameRect.y + child.y,
      width: child.width,
      height: child.height
    });
  }

  function buildFrameAnnotationDraft(frameElement, response, event) {
    const frameRect = clampRect(frameElement.getBoundingClientRect());
    const projectedSelection = projectFrameSelection(frameRect, response.projectedSelection || response.targetSelection || response.selection);
    const parentFrameMeta = buildParentFrameMeta(frameElement);
    return {
      type: response.type || "element",
      selector: buildSelector(frameElement),
      selection: frameRect,
      documentSelection: selectionToDocument(frameRect),
      outerHTML: parentFrameMeta.outerHTML,
      parentOuterHTML: parentFrameMeta.parentOuterHTML,
      grandparentOuterHTML: parentFrameMeta.grandparentOuterHTML,
      mouse: {
        x: projectedSelection.x + Math.min(projectedSelection.width, 12),
        y: projectedSelection.y + Math.min(projectedSelection.height, 12)
      },
      frameContext: {
        frameChain: [
          parentFrameMeta,
          ...(Array.isArray(response.frameChain) ? response.frameChain : [])
        ],
        targetFrame: response.targetFrame || null,
        targetSelector: response.targetSelector || response.selector || "",
        targetSelection: response.targetSelection || response.selection || null,
        targetDocumentSelection: response.targetDocumentSelection || response.documentSelection || null,
        targetDomHtml: response.targetDomHtml || response.domHtml || "",
        targetOuterHTML: response.outerHTML || "",
        targetParentOuterHTML: response.parentOuterHTML || "",
        targetGrandparentOuterHTML: response.grandparentOuterHTML || "",
        projectedSelection
      }
    };
  }

  function buildUnreachableFrameDraft(frameElement, event, error) {
    const frameRect = clampRect(frameElement.getBoundingClientRect());
    const parentFrameMeta = buildParentFrameMeta(frameElement);
    return {
      type: "element",
      selector: buildSelector(frameElement),
      selection: frameRect,
      documentSelection: selectionToDocument(frameRect),
      outerHTML: parentFrameMeta.outerHTML,
      parentOuterHTML: parentFrameMeta.parentOuterHTML,
      grandparentOuterHTML: parentFrameMeta.grandparentOuterHTML,
      mouse: { x: event.clientX, y: event.clientY },
      frameContext: {
        frameChain: [parentFrameMeta],
        unreachableReason: error && error.message ? error.message : String(error)
      }
    };
  }

  function buildParentFrameMeta(frameElement) {
    const htmlContext = buildElementHtmlContext(frameElement);
    const viewportRect = clampRect(frameElement.getBoundingClientRect());
    return {
      selector: buildSelector(frameElement),
      pageUrl: location.href,
      pageTitle: document.title,
      viewportRect,
      documentRect: selectionToDocument(viewportRect),
      outerHTML: getOuterHtmlWithoutRecorder(frameElement),
      parentOuterHTML: htmlContext.parentOuterHTML || "",
      grandparentOuterHTML: htmlContext.grandparentOuterHTML || ""
    };
  }

  function buildStaticFrameTargetMeta() {
    return {
      pageUrl: location.href,
      pageTitle: document.title,
      viewport: buildStaticFrameViewport()
    };
  }

  function buildStaticFrameViewport() {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1
    };
  }

  function openAnnotationInput(draft, initialText = "", options = {}) {
    closePopover({ preserveFrameAgent: Boolean(draft && draft.frameContext) });
    lockStaticFramesForAnnotation(options.preserveFrameWindow || null);
    state.draft = draft;
    if (draft.frameContext) {
      hideHoverBox();
    } else {
      showBox(ui.hoverBox, selectionForViewport(draft));
    }

    const popoverFrame = createPopoverFrame(draft.mouse.x, draft.mouse.y);
    const popoverDocument = popoverFrame.contentDocument;
    const popover = popoverDocument.createElement("div");
    popover.id = "lwr-popover";
    popover.setAttribute(ROOT_ATTR, "true");
    popover.innerHTML = [
      `<label>${draft.editId ? "编辑批注文本" : "批注文本"}</label>`,
      '<div class="lwr-rich-editor" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="记录这个动作、判断标准、数据来源或验收标准"></div>',
      '<div class="lwr-field-hint">输入 @ 引用字段来源</div>',
      '<div class="lwr-field-suggest" hidden></div>',
      '<div class="lwr-popover-actions">',
      '<button type="button" data-action="cancel">取消</button>',
      draft.editId ? '<button type="button" data-action="delete" data-danger="true">删除</button>' : "",
      '<button type="button" data-action="save" data-primary="true" title="Ctrl+Enter 保存">保存 Ctrl+Enter</button>',
      "</div>"
    ].join("");

    popover.style.left = "0";
    popover.style.top = "0";
    popoverDocument.body.append(popover);
    ui.popover = popoverFrame;

    const editor = popover.querySelector(".lwr-rich-editor");
    const saveButton = popover.querySelector('[data-action="save"]');
    const suggestBox = popover.querySelector(".lwr-field-suggest");
    ui.activeEditor = editor;
    setEditorValue(editor, initialText);
    editor.focus();
    const editorDocument = editor.ownerDocument;
    const focusEditor = () => {
      if (!ui.popover || !editor.isConnected) {
        return;
      }
      editor.focus({ preventScroll: true });
    };
    const keepEditorFocus = (event) => {
      if (event.type !== "keydown" && event.type !== "keyup") {
        event.stopPropagation();
      }
      if (event.type === "focusin" || event.type === "beforeinput" || event.type === "input") {
        requestAnimationFrame(focusEditor);
      }
    };
    ["pointerdown", "mousedown", "mouseup", "click", "mousemove", "focusin", "keydown", "keyup", "beforeinput", "input"].forEach(
      (type) => editor.addEventListener(type, keepEditorFocus, true)
    );
    ui.editorFocusTimer = window.setInterval(() => {
      if (!ui.popover || !editor.isConnected) {
        return;
      }
      const frameHasTopFocus = document.activeElement === ui.popover;
      const editorHasFocus = editorDocument.activeElement === editor;
      const popoverActive = editorDocument.activeElement && popover.contains(editorDocument.activeElement);
      if (!frameHasTopFocus || (!editorHasFocus && !popoverActive)) {
        focusEditor();
      }
    }, 80);
    requestAnimationFrame(focusEditor);
    editor.addEventListener("mousedown", () => {
      requestAnimationFrame(focusEditor);
    });

    const refreshSuggestions = () => {
      renderFieldSuggestions(editor, suggestBox);
    };
    editor.addEventListener("input", refreshSuggestions);
    editor.addEventListener("keyup", refreshSuggestions);
    editor.addEventListener("click", refreshSuggestions);

    suggestBox.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    suggestBox.addEventListener("click", (event) => {
      const fieldButton = event.target.closest("[data-field-id]");
      const addButton = event.target.closest("[data-action='add-field-from-suggest']");
      if (fieldButton) {
        const field = state.fields.find((item) => item.id === fieldButton.getAttribute("data-field-id"));
        if (field) {
          insertFieldReference(editor, field, suggestBox);
        }
      } else if (addButton) {
        createFieldFromMention(editor, suggestBox).catch((error) => showRecorderError("新增字段失败", error));
      }
    });

    popover.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.key === "Enter" && !event.altKey && !event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        if (!saveButton.disabled) {
          saveDraft(serializeEditorValue(editor).trim(), saveButton).catch((error) => showRecorderError("保存失败", error));
        }
        return;
      }
      if (event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        event.stopPropagation();
        setAnnotationMode(!state.annotationMode);
      }
    });

    popover.addEventListener("click", (event) => {
      event.stopPropagation();
      const button = event.target.closest("button");
      if (!button) return;

      event.preventDefault();
      const action = button.getAttribute("data-action");
      if (action === "save") {
        saveDraft(serializeEditorValue(editor).trim(), button).catch((error) => showRecorderError("保存失败", error));
      } else if (action === "delete" && state.draft && state.draft.editId) {
        deleteAnnotation(state.draft.editId).catch((error) => showRecorderError("删除失败", error));
        state.draft = null;
        closePopover();
      } else if (action === "cancel" || action === "delete") {
        state.draft = null;
        closePopover();
      }
    });
  }

  async function saveDraft(annotationText, button) {
    if (!state.draft) return;
    button.textContent = "保存中";
    button.setAttribute("disabled", "true");

    const draft = state.draft;
    const existing = draft.editId ? await loadAnnotationById(draft.editId) : null;
    let annotation;

    if (draft.editId && !existing) {
      throw new Error("找不到要编辑的 Annotation。");
    }

    if (existing) {
      annotation = {
        ...existing,
        annotationText,
        fieldReferences: extractFieldReferences(annotationText),
        updatedAt: new Date().toISOString()
      };
      await storeMessage("LWR_STORE_UPDATE", { annotation });
    } else {
      const selection = normalizeSelection(draft.selection);
      const documentSelection = normalizeSelection(draft.documentSelection || selectionToDocument(selection));
      const formattedDom = formatHtml(getPageHtmlWithoutRecorder());
      const screenshotSelection = draft.frameContext && draft.frameContext.projectedSelection
        ? normalizeSelection(draft.frameContext.projectedSelection)
        : selection;
      const screenshotDataUrl = await captureScreenshotWithSelection(screenshotSelection);
      annotation = {
        type: draft.type,
        annotationText,
        selector: draft.selector || "",
        screenshotDataUrl,
        domHtml: formattedDom,
        outerHTML: draft.outerHTML || "",
        parentOuterHTML: draft.parentOuterHTML || "",
        grandparentOuterHTML: draft.grandparentOuterHTML || "",
        frameContext: draft.frameContext || null,
        pageUrl: location.href,
        pageTitle: document.title,
        createdAt: new Date().toISOString(),
        updatedAt: "",
        fieldReferences: extractFieldReferences(annotationText),
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1
        },
        selection,
        documentSelection
      };
      await storeMessage("LWR_STORE_CREATE", { annotation });
    }
    state.draft = null;
    closePopover();
    await syncAnnotationStore();
  }

  async function captureScreenshotWithSelection(selection) {
    const restoreRecorderUi = hideRecorderUiForCapture();
    let response;
    try {
      await waitFrames(4);
      response = await chrome.runtime.sendMessage({ type: "LWR_CAPTURE_VISIBLE_TAB" });
    } finally {
      restoreRecorderUi();
    }

    if (!response || !response.ok || !response.dataUrl) {
      throw new Error(response && response.error ? response.error : "无法捕获页面截图");
    }

    const image = await loadImage(response.dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);

    const scaleX = image.naturalWidth / window.innerWidth;
    const scaleY = image.naturalHeight / window.innerHeight;
    const x = selection.x * scaleX;
    const y = selection.y * scaleY;
    const width = selection.width * scaleX;
    const height = selection.height * scaleY;

    ctx.save();
    ctx.fillStyle = "rgba(96, 165, 250, 0.16)";
    ctx.strokeStyle = BLUE;
    ctx.lineWidth = Math.max(3, 3 * Math.max(scaleX, scaleY));
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);
    ctx.restore();

    return canvas.toDataURL("image/png");
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("截图图像加载失败"));
      image.src = src;
    });
  }

  function hideRecorderUiForCapture() {
    const nodes = uniqueNodes([
      ui.host,
      ui.toolbar,
      ui.eventShield,
      ui.hoverBox,
      ui.regionBox,
      ui.markerLayer,
      ui.popover,
      ui.fieldPanel,
      ui.annotationPanel,
      ...Array.from(document.querySelectorAll(`[${ROOT_ATTR}="true"]`))
    ]);
    const previous = nodes.map((node) => ({
      node,
      visibility: node.style.getPropertyValue("visibility"),
      visibilityPriority: node.style.getPropertyPriority("visibility"),
      opacity: node.style.getPropertyValue("opacity"),
      opacityPriority: node.style.getPropertyPriority("opacity"),
      display: node.style.getPropertyValue("display"),
      displayPriority: node.style.getPropertyPriority("display"),
      pointerEvents: node.style.getPropertyValue("pointer-events"),
      pointerEventsPriority: node.style.getPropertyPriority("pointer-events")
    }));
    nodes.forEach((node) => {
      node.style.setProperty("visibility", "hidden", "important");
      node.style.setProperty("opacity", "0", "important");
      node.style.setProperty("display", "none", "important");
      node.style.setProperty("pointer-events", "none", "important");
    });
    document.documentElement.getBoundingClientRect();
    return () => {
      previous.forEach((snapshot) => {
        restoreStyleProperty(snapshot.node, "visibility", snapshot.visibility, snapshot.visibilityPriority);
        restoreStyleProperty(snapshot.node, "opacity", snapshot.opacity, snapshot.opacityPriority);
        restoreStyleProperty(snapshot.node, "display", snapshot.display, snapshot.displayPriority);
        restoreStyleProperty(snapshot.node, "pointer-events", snapshot.pointerEvents, snapshot.pointerEventsPriority);
      });
    };
  }

  function uniqueNodes(nodes) {
    return Array.from(new Set(nodes.filter((node) => node && node.style)));
  }

  function restoreStyleProperty(node, property, value, priority) {
    if (value) {
      node.style.setProperty(property, value, priority || "");
      return;
    }
    node.style.removeProperty(property);
  }

  function waitFrames(count) {
    return new Promise((resolve) => {
      const step = () => {
        count -= 1;
        if (count <= 0) {
          resolve();
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }
