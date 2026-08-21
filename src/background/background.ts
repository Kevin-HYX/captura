chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  if (message.type === "LWR_CAPTURE_VISIBLE_TAB") {
    const windowId = sender.tab && sender.tab.windowId;
    captureVisibleTabDataUrl(windowId)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "LWR_DOWNLOAD") {
    chrome.downloads.download(
      {
        url: message.url,
        filename: message.filename,
        saveAs: Boolean(message.saveAs),
        conflictAction: "uniquify"
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ ok: true, downloadId });
      }
    );
    return true;
  }

  if (message.type === "LWR_DEV_RELOAD") {
    chrome.runtime.reload();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type.startsWith("LWR_RAW_")) {
    handleRawRecorderMessage(message, sender)
      .then((response) => sendResponse({ ok: true, ...response }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type.startsWith("LWR_DYNAMIC_SESSION_")) {
    handleDynamicSessionMessage(message)
      .then((response) => sendResponse({ ok: true, ...response }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type.startsWith("LWR_STORE_")) {
    handleStoreMessage(message)
      .then((response) => sendResponse({ ok: true, ...response }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

const DB_NAME = "captura";
const DB_VERSION = 3;
const ANNOTATION_STORE = "annotations";
const META_STORE = "meta";
const RAW_DYNAMIC_EVENT_STORE = "rawDynamicEvents";
const DYNAMIC_ARTIFACT_STORE = "dynamicArtifacts";
const RAW_DYNAMIC_INDEX_SESSION_ID = "sessionId";
const RAW_DYNAMIC_INDEX_SESSION_GENERATION = "sessionIdGeneration";
const RAW_DYNAMIC_INDEX_EXPORT_ORDER = "sessionGenerationTimelineReceivedSequence";
const RAW_DYNAMIC_EXPORT_BATCH_LIMIT_DEFAULT = 1000;
const RAW_DYNAMIC_EXPORT_BATCH_LIMIT_MAX = 5000;
const RAW_DYNAMIC_EXPORT_RANGE_MAX = Number.MAX_SAFE_INTEGER;
const ANNOTATION_ORDER_KEY = "annotationOrder";
const FIELDS_KEY = "fields";
const DYNAMIC_STATE_KEY = "dynamicState";
const DYNAMIC_SESSION_KEY = "dynamicSession";
const RAW_DYNAMIC_SEQUENCE_PREFIX = "rawDynamicSequence:";
const RAW_EVENT_SCHEMA = "captura.raw-event";
const RAW_EVENT_VERSION = 3;
const RAW_EVENT_LINE_UNIT = "unit";
const RAW_EVENT_LINE_USER_OPERATION = "user-operation";
const RAW_EVENT_LINE_DOM_CHANGE = "dom-change";
const RAW_EVENT_LINE_SCREEN_FRAME = "screen-frame";
const RAW_EVENT_TYPE_DOCUMENT_JOINED = "document.joined";
const RAW_EVENT_TYPE_DOCUMENT_CHANGED = "document.changed";
const RAW_EVENT_TYPE_DOCUMENT_LEFT = "document.left";
const RAW_EVENT_TYPE_ARTIFACT_READY = "artifact.ready";
const RAW_EVENT_TYPE_USER_OPERATION = "user.operation";
const RAW_EVENT_TYPE_LEGACY_USER_EVENT = "user.event";
const RAW_EVENT_TYPE_DOM_CHANGE = "dom.change";
const RAW_EVENT_TYPE_DOM_SNAPSHOT = "dom.snapshot";
const RAW_EVENT_TYPE_LEGACY_DOM_MUTATION = "dom.mutation";
const RAW_EVENT_TYPE_LEGACY_DOCUMENT_SNAPSHOT = "document.snapshot";
const RAW_EVENT_TYPE_SCREEN_FRAME = "screen.frame";
const SCREEN_FRAME_MIN_INTERVAL_MS = 200;
const SCREEN_FRAME_CAPTURE_FORMAT = "png";
const SCREEN_FRAME_ARTIFACT_KIND = "screen-frame";
const SCREEN_FRAME_ARTIFACT_MIME_TYPE = "image/png";
const SCREEN_FRAME_ARTIFACT_PREFIX = "screen-frame";
const SCREEN_FRAME_FLUSH_MAX_LOOPS = 10;
const SCREEN_FRAME_IDLE_WAIT_MS = 25;
const SCREEN_FRAME_DEFAULT_VIEWPORT_SIZE = 0;
const SCREEN_FRAME_MAX_CONSECUTIVE_FAILURES = 3;
const BASE64_SINGLE_PADDING_BYTES = 1;
const BASE64_DOUBLE_PADDING_BYTES = 2;
const BASE64_BYTES_PER_QUARTET = 3;
const BASE64_CHARS_PER_QUARTET = 4;

let screenFrameLastCapturedAtMs = 0;
let screenFramePendingTimer = null;
let screenFrameLatestRequest = null;
let screenFrameDirty = false;
let screenFrameCaptureRunning = false;
let screenFrameConsecutiveFailures = 0;

async function handleRawRecorderMessage(message, sender) {
  if (message.type === "LWR_RAW_EVENT_APPEND") {
    const event = await appendRawDynamicEvent(message.event || {}, sender);
    const count = event.accepted === false ? await countRawDynamicEvents(event.sessionId || "", event.generation) : event.globalSequence;
    return { event, count, accepted: event.accepted !== false, reason: event.reason || "" };
  }

  if (message.type === "LWR_RAW_EVENTS_GET") {
    const events = await getRawDynamicEvents(message.sessionId || "", message.generation);
    return { events };
  }

  if (message.type === "LWR_RAW_EVENTS_EXPORT_BATCH") {
    return await getRawDynamicEventsExportBatch(message.sessionId || "", message.generation, message.cursor || null, message.limit);
  }

  if (message.type === "LWR_RAW_EVENTS_COUNT") {
    const count = await countRawDynamicEvents(message.sessionId || "", message.generation);
    return { count };
  }

  if (message.type === "LWR_RAW_EVENTS_CLEAR") {
    await clearRawDynamicEvents(message.sessionId || "", message.generation);
    return { events: [] };
  }

  if (message.type === "LWR_RAW_ARTIFACT_SAVE") {
    const artifact = await saveDynamicArtifact(message.artifact || {}, sender);
    return { artifact };
  }

  if (message.type === "LWR_RAW_ARTIFACT_GET") {
    const artifact = await getDynamicArtifact(message.artifactRef || "");
    return { artifact };
  }

  if (message.type === "LWR_RAW_SCREEN_FRAMES_FLUSH") {
    await flushScreenFrameScheduler();
    return { flushed: true };
  }

  throw new Error(`Unknown raw recorder message: ${message.type}`);
}

async function handleDynamicSessionMessage(message) {
  if (message.type === "LWR_DYNAMIC_SESSION_START") {
    const session = await startDynamicSession();
    return { session };
  }

  if (message.type === "LWR_DYNAMIC_SESSION_GET") {
    const session = await getDynamicSession();
    return { session };
  }

  if (message.type === "LWR_DYNAMIC_SESSION_STOP") {
    const session = await stopDynamicSession(message.sessionId || "", message.generation, message.reason || "");
    return { session };
  }

  if (message.type === "LWR_DYNAMIC_SESSION_CLEAR_RAW") {
    await clearRawDynamicEvents(message.sessionId || "", message.generation);
    return { cleared: true };
  }

  throw new Error(`Unknown dynamic session message: ${message.type}`);
}

async function handleStoreMessage(message) {
  if (message.type === "LWR_STORE_GET" || message.type === "LWR_STORE_GET_INDEX") {
    const annotations = await getAnnotationSummaries();
    const fields = await getFields();
    return { annotations, fields };
  }

  if (message.type === "LWR_STORE_GET_BY_ID") {
    const annotation = await getAnnotationById(message.id);
    return { annotation };
  }

  if (message.type === "LWR_STORE_CREATE") {
    const annotation = await createAnnotation(message.annotation || {});
    const annotations = await getAnnotationSummaries();
    const fields = await getFields();
    return { annotation: createAnnotationSummary(annotation), annotations, fields };
  }

  if (message.type === "LWR_STORE_UPDATE") {
    const annotation = await updateAnnotation(message.annotation || {});
    const annotations = await getAnnotationSummaries();
    const fields = await getFields();
    return { annotation: createAnnotationSummary(annotation), annotations, fields };
  }

  if (message.type === "LWR_STORE_DELETE") {
    await deleteAnnotation(message.id);
    const annotations = await getAnnotationSummaries();
    const fields = await getFields();
    return { annotations, fields };
  }

  if (message.type === "LWR_STORE_CLEAR") {
    await clearAnnotationStore();
    const fields = await getFields();
    return { annotations: [], fields };
  }

  if (message.type === "LWR_STORE_FIELD_UPSERT") {
    const field = await upsertField(message.field || {});
    const fields = await getFields();
    return { field, fields };
  }

  if (message.type === "LWR_STORE_FIELD_DELETE") {
    await deleteField(message.id);
    const fields = await getFields();
    return { fields };
  }

  if (message.type === "LWR_STORE_FIELDS_IMPORT") {
    const fields = await importFields(message.fields || []);
    return { fields };
  }

  if (message.type === "LWR_STORE_REORDER") {
    const result = await reorderAnnotations(message.orderedIds || []);
    return result;
  }

  if (message.type === "LWR_STORE_IMPORT_STATE") {
    const result = await importRecorderState(message.state || {});
    return result;
  }

  if (message.type === "LWR_STORE_DYNAMIC_GET") {
    const dynamic = await getDynamicState();
    return { dynamic };
  }

  if (message.type === "LWR_STORE_DYNAMIC_SAVE") {
    const dynamic = await saveDynamicState(message.dynamic || {});
    return { dynamic };
  }

  if (message.type === "LWR_STORE_DYNAMIC_CLEAR") {
    await clearDynamicState();
    return { dynamic: null };
  }

  throw new Error(`Unknown store message: ${message.type}`);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ANNOTATION_STORE)) {
        const store = db.createObjectStore(ANNOTATION_STORE, { keyPath: "id" });
        store.createIndex("sequence", "sequence", { unique: true });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
      const rawStore = db.objectStoreNames.contains(RAW_DYNAMIC_EVENT_STORE)
        ? request.transaction.objectStore(RAW_DYNAMIC_EVENT_STORE)
        : db.createObjectStore(RAW_DYNAMIC_EVENT_STORE, { keyPath: "id" });
      ensureIndex(rawStore, RAW_DYNAMIC_INDEX_SESSION_ID, "sessionId", { unique: false });
      ensureIndex(rawStore, "eventType", "eventType", { unique: false });
      ensureIndex(rawStore, "unitRef", "unitRef", { unique: false });
      ensureIndex(rawStore, "globalSequence", "globalSequence", { unique: false });
      ensureIndex(rawStore, RAW_DYNAMIC_INDEX_SESSION_GENERATION, ["sessionId", "generation"], { unique: false });
      ensureIndex(rawStore, RAW_DYNAMIC_INDEX_EXPORT_ORDER, ["sessionId", "generation", "timelineEpochMs", "receivedAtEpochMs", "globalSequence"], { unique: false });

      const artifactStore = db.objectStoreNames.contains(DYNAMIC_ARTIFACT_STORE)
        ? request.transaction.objectStore(DYNAMIC_ARTIFACT_STORE)
        : db.createObjectStore(DYNAMIC_ARTIFACT_STORE, { keyPath: "artifactRef" });
      ensureIndex(artifactStore, RAW_DYNAMIC_INDEX_SESSION_ID, "sessionId", { unique: false });
      ensureIndex(artifactStore, "unitRef", "unitRef", { unique: false });
      ensureIndex(artifactStore, "kind", "kind", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开批注记忆库"));
  });
}

function ensureIndex(store, name, keyPath, options) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options);
  }
}

async function getAnnotations() {
  const db = await openDb();
  let ordered = [];
  let shouldRewrite = false;
  try {
    const tx = db.transaction([ANNOTATION_STORE, META_STORE], "readonly");
    const annotations = await idbRequest(tx.objectStore(ANNOTATION_STORE).getAll());
    const orderRecord = await idbRequest(tx.objectStore(META_STORE).get(ANNOTATION_ORDER_KEY));
    await txDone(tx);
    const order = Array.isArray(orderRecord && orderRecord.value) ? orderRecord.value : [];
    ordered = orderAnnotations(annotations, order);
    shouldRewrite = annotations.some((annotation) => Object.prototype.hasOwnProperty.call(annotation, "sequence")) || order.length === 0;
  } finally {
    db.close();
  }

  if (shouldRewrite && ordered.length > 0) {
    await rewriteAnnotationStore(ordered);
  }
  return ordered;
}

async function getAnnotationSummaries() {
  const annotations = await getAnnotations();
  return annotations.map(createAnnotationSummary);
}

async function getAnnotationById(id) {
  if (!id) {
    return null;
  }
  const db = await openDb();
  try {
    const annotation = await requestFromStore(db, ANNOTATION_STORE, "readonly", (store) => store.get(id));
    return annotation || null;
  } finally {
    db.close();
  }
}

function createAnnotationSummary(annotation) {
  const {
    screenshotDataUrl,
    domHtml,
    outerHTML,
    parentOuterHTML,
    grandparentOuterHTML,
    ...summary
  } = annotation || {};
  return summary;
}

async function getFields() {
  const db = await openDb();
  try {
    const record = await requestFromStore(db, META_STORE, "readonly", (store) => store.get(FIELDS_KEY));
    const fields = Array.isArray(record && record.value) ? record.value : [];
    return fields.sort((left, right) => left.name.localeCompare(right.name));
  } finally {
    db.close();
  }
}

async function upsertField(field) {
  const name = String(field.name || "").trim();
  if (!name) {
    throw new Error("字段名称不能为空。");
  }

  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readwrite");
      const store = tx.objectStore(META_STORE);
      let savedField;

      tx.oncomplete = () => resolve(savedField);
      tx.onabort = () => reject(tx.error || new Error("字段库事务已取消"));
      tx.onerror = () => reject(tx.error || new Error("字段库事务失败"));

      const request = store.get(FIELDS_KEY);
      request.onerror = () => reject(request.error || new Error("无法读取字段库"));
      request.onsuccess = () => {
        const fields = Array.isArray(request.result && request.result.value) ? request.result.value : [];
        const now = new Date().toISOString();
        const existingIndex = fields.findIndex(
          (item) => item.id === field.id || item.name.toLowerCase() === name.toLowerCase()
        );
        savedField = {
          id: field.id || (existingIndex >= 0 ? fields[existingIndex].id : `field-${Date.now()}`),
          name,
          description: String(field.description || "").trim(),
          createdAt: existingIndex >= 0 ? fields[existingIndex].createdAt : now,
          updatedAt: existingIndex >= 0 ? now : ""
        };
        if (existingIndex >= 0) {
          fields[existingIndex] = savedField;
        } else {
          fields.push(savedField);
        }
        store.put({ key: FIELDS_KEY, value: fields });
      };
    });
  } finally {
    db.close();
  }
}

async function deleteField(id) {
  if (!id) {
    throw new Error("缺少字段 ID，无法删除。");
  }

  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readwrite");
      const store = tx.objectStore(META_STORE);

      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error("字段库事务已取消"));
      tx.onerror = () => reject(tx.error || new Error("字段库事务失败"));

      const request = store.get(FIELDS_KEY);
      request.onerror = () => reject(request.error || new Error("无法读取字段库"));
      request.onsuccess = () => {
        const fields = Array.isArray(request.result && request.result.value) ? request.result.value : [];
        store.put({ key: FIELDS_KEY, value: fields.filter((field) => field.id !== id) });
      };
    });
  } finally {
    db.close();
  }
}

async function importFields(importedFields) {
  if (!Array.isArray(importedFields)) {
    throw new Error("字段配置格式错误。");
  }

  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readwrite");
      const store = tx.objectStore(META_STORE);
      let savedFields = [];

      tx.oncomplete = () => resolve(savedFields.sort((left, right) => left.name.localeCompare(right.name)));
      tx.onabort = () => reject(tx.error || new Error("字段库事务已取消"));
      tx.onerror = () => reject(tx.error || new Error("字段库事务失败"));

      const request = store.get(FIELDS_KEY);
      request.onerror = () => reject(request.error || new Error("无法读取字段库"));
      request.onsuccess = () => {
        const existing = Array.isArray(request.result && request.result.value) ? request.result.value : [];
        const fields = [...existing];
        importedFields.forEach((field) => {
          const name = String(field.name || "").trim();
          if (!name) {
            return;
          }
          const now = new Date().toISOString();
          const existingIndex = fields.findIndex(
            (item) => item.id === field.id || item.name.toLowerCase() === name.toLowerCase()
          );
          const savedField = {
            id: field.id || (existingIndex >= 0 ? fields[existingIndex].id : `field-${Date.now()}-${Math.random().toString(16).slice(2)}`),
            name,
            description: String(field.description || "").trim(),
            createdAt: existingIndex >= 0 ? fields[existingIndex].createdAt : now,
            updatedAt: existingIndex >= 0 ? now : ""
          };
          if (existingIndex >= 0) {
            fields[existingIndex] = savedField;
          } else {
            fields.push(savedField);
          }
        });
        savedFields = fields;
        store.put({ key: FIELDS_KEY, value: fields });
      };
    });
  } finally {
    db.close();
  }
}

async function createAnnotation(annotation) {
  const existingOrder = (await getAnnotations()).map((item) => item.id);
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([ANNOTATION_STORE, META_STORE], "readwrite");
      const metaStore = tx.objectStore(META_STORE);
      const annotationStore = tx.objectStore(ANNOTATION_STORE);
      const stored = {
        ...stripDisplaySequence(annotation),
        id: createAnnotationId()
      };

      tx.oncomplete = () => resolve(stored);
      tx.onabort = () => reject(tx.error || new Error("批注记忆库事务已取消"));
      tx.onerror = () => reject(tx.error || new Error("批注记忆库事务失败"));

      annotationStore.put(stored);
      metaStore.put({ key: ANNOTATION_ORDER_KEY, value: [...existingOrder.filter((id) => id !== stored.id), stored.id] });
    });
  } finally {
    db.close();
  }
}

async function updateAnnotation(annotation) {
  if (!annotation.id) {
    throw new Error("缺少批注 ID，无法更新。");
  }

  const db = await openDb();
  try {
    const stored = stripDisplaySequence(annotation);
    await requestFromStore(db, ANNOTATION_STORE, "readwrite", (store) => store.put(stored));
    return stored;
  } finally {
    db.close();
  }
}

async function deleteAnnotation(id) {
  if (!id) {
    throw new Error("缺少批注 ID，无法删除。");
  }

  const db = await openDb();
  try {
    const tx = db.transaction([ANNOTATION_STORE, META_STORE], "readwrite");
    const done = txDone(tx);
    const metaStore = tx.objectStore(META_STORE);
    tx.objectStore(ANNOTATION_STORE).delete(id);
    const orderRecord = await idbRequest(metaStore.get(ANNOTATION_ORDER_KEY));
    const order = Array.isArray(orderRecord && orderRecord.value) ? orderRecord.value : [];
    metaStore.put({ key: ANNOTATION_ORDER_KEY, value: order.filter((item) => item !== id) });
    await done;
  } finally {
    db.close();
  }
}

async function clearAnnotationStore() {
  const db = await openDb();
  try {
    const tx = db.transaction([ANNOTATION_STORE, META_STORE], "readwrite");
    const done = txDone(tx);
    const metaStore = tx.objectStore(META_STORE);
    tx.objectStore(ANNOTATION_STORE).clear();
    metaStore.put({ key: ANNOTATION_ORDER_KEY, value: [] });
    metaStore.delete("nextSequence");
    await done;
  } finally {
    db.close();
  }
}

async function reorderAnnotations(orderedIds) {
  if (!Array.isArray(orderedIds)) {
    throw new Error("批注排序数据格式错误。");
  }
  const annotations = await getAnnotations();
  const byId = new Map(annotations.map((annotation) => [annotation.id, annotation]));
  const orderedOrder = [];
  orderedIds.forEach((id) => {
    if (byId.has(id)) {
      orderedOrder.push(id);
      byId.delete(id);
    }
  });
  orderedOrder.push(...Array.from(byId.keys()));

  const db = await openDb();
  try {
    const tx = db.transaction(META_STORE, "readwrite");
    const done = txDone(tx);
    tx.objectStore(META_STORE).put({ key: ANNOTATION_ORDER_KEY, value: orderedOrder });
    await done;
  } finally {
    db.close();
  }

  const fields = await getFields();
  return { annotations: orderAnnotations(annotations, orderedOrder).map(createAnnotationSummary), fields };
}

async function importRecorderState(importedState) {
  const annotations = Array.isArray(importedState.annotations) ? importedState.annotations : [];
  const fields = Array.isArray(importedState.fields) ? importedState.fields : [];
  const normalizedAnnotations = normalizeImportedAnnotations(annotations);
  const annotationOrder = normalizedAnnotations.map((annotation) => annotation.id);
  const normalizedFields = normalizeImportedFields(fields);

  const db = await openDb();
  try {
    const tx = db.transaction([ANNOTATION_STORE, META_STORE], "readwrite");
    const done = txDone(tx);
    const annotationStore = tx.objectStore(ANNOTATION_STORE);
    const metaStore = tx.objectStore(META_STORE);

    annotationStore.clear();
    normalizedAnnotations.forEach((annotation) => annotationStore.put(annotation));
    metaStore.put({ key: ANNOTATION_ORDER_KEY, value: annotationOrder });
    metaStore.put({ key: FIELDS_KEY, value: normalizedFields });
    metaStore.delete("nextSequence");
    await done;
  } finally {
    db.close();
  }

  return {
    annotations: normalizedAnnotations.map(createAnnotationSummary),
    fields: normalizedFields.sort((left, right) => left.name.localeCompare(right.name))
  };
}

async function getDynamicState() {
  const db = await openDb();
  try {
    const record = await requestFromStore(db, META_STORE, "readonly", (store) => store.get(DYNAMIC_STATE_KEY));
    return record && record.value ? record.value : null;
  } finally {
    db.close();
  }
}

async function getDynamicSession() {
  const db = await openDb();
  try {
    const record = await requestFromStore(db, META_STORE, "readonly", (store) => store.get(DYNAMIC_SESSION_KEY));
    return record && record.value ? record.value : null;
  } finally {
    db.close();
  }
}

async function saveDynamicSession(session) {
  const stored = normalizeDynamicSession(session);
  const db = await openDb();
  try {
    await requestFromStore(db, META_STORE, "readwrite", (store) => store.put({ key: DYNAMIC_SESSION_KEY, value: stored }));
    return stored;
  } finally {
    db.close();
  }
}

async function startDynamicSession() {
  const existing = await getDynamicSession();
  const now = new Date();
  const generation = Math.max(0, Number(existing && existing.generation) || 0) + 1;
  return saveDynamicSession({
    sessionId: `dynamic-${now.toISOString().replace(/[:.]/g, "-")}`,
    generation,
    active: true,
    startedAt: now.toISOString(),
    stoppedAt: "",
    stopReason: ""
  });
}

async function stopDynamicSession(sessionId, generation, reason) {
  const existing = await getDynamicSession();
  const now = new Date();
  const normalizedSessionId = String(sessionId || (existing && existing.sessionId) || "").trim();
  const normalizedGeneration = Math.max(0, Number(generation) || Number(existing && existing.generation) || 0);
  const base = existing && existing.sessionId === normalizedSessionId && Number(existing.generation) === normalizedGeneration ? existing : {};
  return saveDynamicSession({
    ...base,
    sessionId: normalizedSessionId,
    generation: normalizedGeneration,
    active: false,
    startedAt: base.startedAt || "",
    stoppedAt: now.toISOString(),
    stopReason: String(reason || "manual-stop")
  });
}

async function saveDynamicState(dynamic) {
  const stored = normalizeDynamicState(dynamic);
  const session = await getDynamicSession();
  if (shouldBlockDynamicStateSave(stored, session)) {
    return {
      ...stored,
      active: false,
      stoppedAt: session.stoppedAt || stored.stoppedAt
    };
  }
  const db = await openDb();
  try {
    await requestFromStore(db, META_STORE, "readwrite", (store) => store.put({ key: DYNAMIC_STATE_KEY, value: stored }));
    return stored;
  } finally {
    db.close();
  }
}

async function clearDynamicState() {
  const db = await openDb();
  try {
    await requestFromStore(db, META_STORE, "readwrite", (store) => store.delete(DYNAMIC_STATE_KEY));
  } finally {
    db.close();
  }
}

async function appendRawDynamicEvent(event, sender) {
  const sessionId = String(event.sessionId || "").trim();
  if (!sessionId) {
    throw new Error("raw dynamic event missing sessionId");
  }
  const session = await getDynamicSession();
  const eventGeneration = Math.max(0, Number(event.generation) || 0);
  const rejectionReason = rawEventRejectionReason(event, session);
  if (rejectionReason) {
    return {
      accepted: false,
      reason: rejectionReason,
      sessionId,
      generation: eventGeneration
    };
  }

  const db = await openDb();
  try {
    const tx = db.transaction([RAW_DYNAMIC_EVENT_STORE, META_STORE], "readwrite");
    const done = txDone(tx);
    const rawStore = tx.objectStore(RAW_DYNAMIC_EVENT_STORE);
    const metaStore = tx.objectStore(META_STORE);
    const sequenceKey = `${RAW_DYNAMIC_SEQUENCE_PREFIX}${sessionId}`;
    const sequenceRecord = await idbRequest(metaStore.get(sequenceKey));
    const globalSequence = Math.max(0, Number(sequenceRecord && sequenceRecord.value) || 0) + 1;
    const normalized = normalizeRawDynamicEvent(event, sender, globalSequence);
    rawStore.put(normalized);
    metaStore.put({ key: sequenceKey, value: globalSequence });
    await done;
    scheduleScreenFrameCaptureFromRawEvent(normalized, sender);
    return normalized;
  } finally {
    db.close();
  }
}

function captureVisibleTabDataUrl(windowId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format: SCREEN_FRAME_CAPTURE_FORMAT }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(dataUrl || "");
    });
  });
}

function scheduleScreenFrameCaptureFromRawEvent(event, sender) {
  if (!shouldTriggerScreenFrameCapture(event) || !sender || !sender.tab || !Number.isFinite(sender.tab.windowId)) {
    return;
  }
  const requestedAtMs = Date.now();
  screenFrameLatestRequest = {
    sessionId: String(event.sessionId || ""),
    generation: Math.max(0, Number(event.generation) || 0),
    requestedAtMs,
    windowId: sender.tab.windowId,
    tabId: Number.isFinite(sender.tab.id) ? sender.tab.id : null,
    viewport: normalizeScreenFrameViewport(event)
  };
  screenFrameDirty = true;
  scheduleScreenFrameTimer();
}

function shouldTriggerScreenFrameCapture(event) {
  const line = String(event && event.line ? event.line : "");
  const eventType = String(event && event.eventType ? event.eventType : "");
  return (
    line === RAW_EVENT_LINE_USER_OPERATION
    || line === RAW_EVENT_LINE_DOM_CHANGE
    || eventType === RAW_EVENT_TYPE_USER_OPERATION
    || eventType === RAW_EVENT_TYPE_LEGACY_USER_EVENT
    || eventType === RAW_EVENT_TYPE_DOM_CHANGE
    || eventType === RAW_EVENT_TYPE_DOM_SNAPSHOT
    || eventType === RAW_EVENT_TYPE_LEGACY_DOM_MUTATION
    || eventType === RAW_EVENT_TYPE_LEGACY_DOCUMENT_SNAPSHOT
  );
}

function scheduleScreenFrameTimer() {
  if (screenFrameCaptureRunning || !screenFrameDirty || !screenFrameLatestRequest || screenFramePendingTimer) {
    return;
  }
  const delayMs = Math.max(0, screenFrameLastCapturedAtMs + SCREEN_FRAME_MIN_INTERVAL_MS - Date.now());
  screenFramePendingTimer = setTimeout(() => {
    screenFramePendingTimer = null;
    runScreenFrameCapture().catch((error) => console.warn("LWR screen frame capture failed", error));
  }, delayMs);
}

async function runScreenFrameCapture() {
  if (screenFrameCaptureRunning || !screenFrameDirty || !screenFrameLatestRequest) {
    return;
  }
  const request = screenFrameLatestRequest;
  screenFrameDirty = false;
  screenFrameCaptureRunning = true;
  const captureStartedAtMs = Date.now();
  try {
    const dataUrl = await captureVisibleTabDataUrl(request.windowId);
    const capturedAtMs = Date.now();
    screenFrameLastCapturedAtMs = capturedAtMs;
    if (!dataUrl) {
      throw new Error("screen frame capture returned empty dataUrl");
    }
    const session = await getDynamicSession();
    if (!session || session.sessionId !== request.sessionId || Number(session.generation) !== request.generation) {
      return;
    }
    const artifactRef = createScreenFrameArtifactRef(request.sessionId, request.generation, capturedAtMs);
    const sender = createScreenFrameSender(request);
    const artifact = await saveDynamicArtifact({
      artifactRef,
      sessionId: request.sessionId,
      generation: request.generation,
      unitRef: "document",
      kind: SCREEN_FRAME_ARTIFACT_KIND,
      mimeType: SCREEN_FRAME_ARTIFACT_MIME_TYPE,
      createdAt: new Date(capturedAtMs).toISOString(),
      createdAtMs: capturedAtMs,
      data: dataUrl,
      meta: {
        captureRequestedAtEpochMs: request.requestedAtMs,
        captureStartedAtEpochMs: captureStartedAtMs,
        capturedAtEpochMs: capturedAtMs
      }
    }, sender);
    await appendRawDynamicEvent({
      protocol: RAW_EVENT_SCHEMA,
      version: RAW_EVENT_VERSION,
      sessionId: request.sessionId,
      generation: request.generation,
      eventId: `screen-frame-${artifactRef}`,
      eventType: RAW_EVENT_TYPE_SCREEN_FRAME,
      line: RAW_EVENT_LINE_SCREEN_FRAME,
      sentAtEpochMs: capturedAtMs,
      localSequence: 0,
      unit: {
        kind: "document",
        viewport: request.viewport
      },
      payload: {
        artifactRef,
        captureRequestedAtEpochMs: request.requestedAtMs,
        captureStartedAtEpochMs: captureStartedAtMs,
        capturedAtEpochMs: capturedAtMs,
        captureDurationMs: Math.max(0, capturedAtMs - captureStartedAtMs),
        viewport: request.viewport,
        mimeType: SCREEN_FRAME_ARTIFACT_MIME_TYPE,
        byteLength: artifact.byteLength
      }
    }, sender);
    screenFrameConsecutiveFailures = 0;
  } catch (error) {
    screenFrameConsecutiveFailures += 1;
    if (screenFrameConsecutiveFailures <= SCREEN_FRAME_MAX_CONSECUTIVE_FAILURES) {
      screenFrameDirty = true;
    }
    throw error;
  } finally {
    screenFrameCaptureRunning = false;
    if (screenFrameDirty && screenFrameLatestRequest) {
      scheduleScreenFrameTimer();
    }
  }
}

async function flushScreenFrameScheduler() {
  for (let loop = 0; loop < SCREEN_FRAME_FLUSH_MAX_LOOPS; loop += 1) {
    if (!screenFrameDirty && !screenFrameCaptureRunning && !screenFramePendingTimer) {
      return;
    }
    if (screenFramePendingTimer) {
      clearTimeout(screenFramePendingTimer);
      screenFramePendingTimer = null;
    }
    if (screenFrameDirty && screenFrameLatestRequest && !screenFrameCaptureRunning) {
      const delayMs = Math.max(0, screenFrameLastCapturedAtMs + SCREEN_FRAME_MIN_INTERVAL_MS - Date.now());
      if (delayMs) {
        await waitMs(delayMs);
      }
      await runScreenFrameCapture();
      continue;
    }
    await waitMs(SCREEN_FRAME_IDLE_WAIT_MS);
  }
}

function createScreenFrameSender(request) {
  return {
    frameId: 0,
    url: "",
    tab: {
      id: request.tabId,
      windowId: request.windowId
    }
  };
}

function createScreenFrameArtifactRef(sessionId, generation, capturedAtMs) {
  const randomPart = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : String(capturedAtMs);
  return [
    SCREEN_FRAME_ARTIFACT_PREFIX,
    sanitizeScreenFrameArtifactRefPart(sessionId),
    String(generation),
    String(capturedAtMs),
    sanitizeScreenFrameArtifactRefPart(randomPart)
  ].join("-");
}

function sanitizeScreenFrameArtifactRefPart(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function normalizeScreenFrameViewport(event) {
  const eventViewport = event && event.unit && event.unit.viewport && typeof event.unit.viewport === "object"
    ? event.unit.viewport
    : event && event.payload && event.payload.viewport && typeof event.payload.viewport === "object"
      ? event.payload.viewport
      : null;
  return {
    width: Math.max(SCREEN_FRAME_DEFAULT_VIEWPORT_SIZE, Number(eventViewport && eventViewport.width) || SCREEN_FRAME_DEFAULT_VIEWPORT_SIZE),
    height: Math.max(SCREEN_FRAME_DEFAULT_VIEWPORT_SIZE, Number(eventViewport && eventViewport.height) || SCREEN_FRAME_DEFAULT_VIEWPORT_SIZE)
  };
}

function waitMs(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function getRawDynamicEvents(sessionId, generation) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) {
    return [];
  }
  const normalizedGeneration = Number(generation);
  if (!Number.isFinite(normalizedGeneration) || normalizedGeneration <= 0) {
    return await getRawDynamicEventsBySession(normalizedSessionId);
  }
  const events = [];
  let cursor = null;
  let done = false;
  while (!done) {
    const batch = await getRawDynamicEventsExportBatch(
      normalizedSessionId,
      generation,
      cursor,
      RAW_DYNAMIC_EXPORT_BATCH_LIMIT_MAX
    );
    events.push(...batch.events);
    cursor = batch.cursor;
    done = batch.done || batch.events.length === 0;
  }
  if (!events.length && (await countRawDynamicEvents(normalizedSessionId, normalizedGeneration))) {
    return await getRawDynamicEventsBySessionGenerationLegacy(normalizedSessionId, normalizedGeneration);
  }
  return events;
}

async function getRawDynamicEventsBySession(sessionId) {
  const events = [];
  const db = await openDb();
  try {
    const tx = db.transaction(RAW_DYNAMIC_EVENT_STORE, "readonly");
    const done = txDone(tx);
    const index = tx.objectStore(RAW_DYNAMIC_EVENT_STORE).index(RAW_DYNAMIC_INDEX_SESSION_ID);
    await new Promise((resolve, reject) => {
      const request = index.openCursor(IDBKeyRange.only(sessionId));
      request.onerror = () => reject(request.error || new Error("raw event session cursor failed"));
      request.onsuccess = () => {
        const idbCursor = request.result;
        if (!idbCursor) {
          resolve();
          return;
        }
        events.push(idbCursor.value);
        idbCursor.continue();
      };
    });
    await done;
    return events.sort(compareRawDynamicEvents);
  } finally {
    db.close();
  }
}

async function getRawDynamicEventsBySessionGenerationLegacy(sessionId, generation) {
  const events = [];
  const db = await openDb();
  try {
    const tx = db.transaction(RAW_DYNAMIC_EVENT_STORE, "readonly");
    const done = txDone(tx);
    const index = tx.objectStore(RAW_DYNAMIC_EVENT_STORE).index(RAW_DYNAMIC_INDEX_SESSION_GENERATION);
    await new Promise((resolve, reject) => {
      const request = index.openCursor(IDBKeyRange.only([sessionId, generation]));
      request.onerror = () => reject(request.error || new Error("raw event legacy generation cursor failed"));
      request.onsuccess = () => {
        const idbCursor = request.result;
        if (!idbCursor) {
          resolve();
          return;
        }
        events.push(idbCursor.value);
        idbCursor.continue();
      };
    });
    await done;
    return events.sort(compareRawDynamicEvents);
  } finally {
    db.close();
  }
}

async function getRawDynamicEventsExportBatch(sessionId, generation, cursor, limit) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) {
    return { events: [], cursor: null, done: true };
  }
  const normalizedGeneration = Math.max(0, Number(generation) || 0);
  const normalizedLimit = normalizeRawDynamicExportBatchLimit(limit);
  const db = await openDb();
  try {
    const tx = db.transaction(RAW_DYNAMIC_EVENT_STORE, "readonly");
    const done = txDone(tx);
    const index = tx.objectStore(RAW_DYNAMIC_EVENT_STORE).index(RAW_DYNAMIC_INDEX_EXPORT_ORDER);
    const lowerCursor = normalizeRawDynamicExportCursor(cursor, normalizedSessionId, normalizedGeneration);
    const lowerKey = lowerCursor
      ? lowerCursor
      : [normalizedSessionId, normalizedGeneration, 0, 0, 0];
    const upperKey = [
      normalizedSessionId,
      normalizedGeneration,
      RAW_DYNAMIC_EXPORT_RANGE_MAX,
      RAW_DYNAMIC_EXPORT_RANGE_MAX,
      RAW_DYNAMIC_EXPORT_RANGE_MAX
    ];
    const range = IDBKeyRange.bound(lowerKey, upperKey, Boolean(lowerCursor), false);
    const events = [];
    let nextCursor = null;
    await new Promise((resolve, reject) => {
      const request = index.openCursor(range);
      request.onerror = () => reject(request.error || new Error("raw event export cursor failed"));
      request.onsuccess = () => {
        const idbCursor = request.result;
        if (!idbCursor || events.length >= normalizedLimit) {
          resolve();
          return;
        }
        const value = idbCursor.value;
        events.push(value);
        nextCursor = buildRawDynamicExportCursor(value);
        idbCursor.continue();
      };
    });
    await done;
    return {
      events,
      cursor: nextCursor,
      done: events.length < normalizedLimit
    };
  } finally {
    db.close();
  }
}

async function countRawDynamicEvents(sessionId, generation) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) {
    return 0;
  }
  const normalizedGeneration = Number(generation);
  const db = await openDb();
  try {
    const tx = db.transaction(RAW_DYNAMIC_EVENT_STORE, "readonly");
    const done = txDone(tx);
    let count = 0;
    if (Number.isFinite(normalizedGeneration) && normalizedGeneration > 0) {
      count = await idbRequest(
        tx.objectStore(RAW_DYNAMIC_EVENT_STORE)
          .index(RAW_DYNAMIC_INDEX_SESSION_GENERATION)
          .count(IDBKeyRange.only([normalizedSessionId, normalizedGeneration]))
      );
    } else {
      count = await idbRequest(tx.objectStore(RAW_DYNAMIC_EVENT_STORE).index(RAW_DYNAMIC_INDEX_SESSION_ID).count(normalizedSessionId));
    }
    await done;
    return Math.max(0, Number(count) || 0);
  } finally {
    db.close();
  }
}

function normalizeRawDynamicExportBatchLimit(limit) {
  const value = Math.max(0, Math.floor(Number(limit) || 0));
  if (!value) {
    return RAW_DYNAMIC_EXPORT_BATCH_LIMIT_DEFAULT;
  }
  return Math.min(value, RAW_DYNAMIC_EXPORT_BATCH_LIMIT_MAX);
}

function normalizeRawDynamicExportCursor(cursor, sessionId, generation) {
  if (!cursor) {
    return null;
  }
  const values = Array.isArray(cursor)
    ? cursor
    : [cursor.sessionId, cursor.generation, cursor.timelineEpochMs, cursor.receivedAtEpochMs, cursor.globalSequence];
  if (String(values[0] || "") !== sessionId || Number(values[1]) !== generation) {
    return null;
  }
  return [
    sessionId,
    generation,
    Math.max(0, Number(values[2]) || 0),
    Math.max(0, Number(values[3]) || 0),
    Math.max(0, Number(values[4]) || 0)
  ];
}

function buildRawDynamicExportCursor(event) {
  return [
    String(event && event.sessionId ? event.sessionId : ""),
    Math.max(0, Number(event && event.generation) || 0),
    Math.max(0, Number(event && event.timelineEpochMs) || 0),
    Math.max(0, Number(event && event.receivedAtEpochMs) || 0),
    Math.max(0, Number(event && event.globalSequence) || 0)
  ];
}

async function clearRawDynamicEvents(sessionId, generation) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) {
    return;
  }
  const normalizedGeneration = Number(generation);
  const db = await openDb();
  try {
    const tx = db.transaction([RAW_DYNAMIC_EVENT_STORE, DYNAMIC_ARTIFACT_STORE, META_STORE], "readwrite");
    const done = txDone(tx);
    await deleteByIndexValue(tx.objectStore(RAW_DYNAMIC_EVENT_STORE).index(RAW_DYNAMIC_INDEX_SESSION_ID), normalizedSessionId, normalizedGeneration);
    await deleteByIndexValue(tx.objectStore(DYNAMIC_ARTIFACT_STORE).index(RAW_DYNAMIC_INDEX_SESSION_ID), normalizedSessionId, normalizedGeneration);
    tx.objectStore(META_STORE).delete(`${RAW_DYNAMIC_SEQUENCE_PREFIX}${normalizedSessionId}`);
    await done;
  } finally {
    db.close();
  }
}

async function saveDynamicArtifact(artifact, sender) {
  const sessionId = String(artifact.sessionId || "").trim();
  if (!sessionId) {
    throw new Error("dynamic artifact missing sessionId");
  }
  const session = await getDynamicSession();
  const generation = Math.max(0, Number(artifact.generation) || 0);
  const rejectionReason = dynamicArtifactRejectionReason(sessionId, generation, session);
  if (rejectionReason) {
    throw new Error(rejectionReason);
  }
  const unit = inferSenderUnit(sender);
  const stored = {
    artifactRef: String(artifact.artifactRef || `artifact:${sessionId}:${Date.now()}:${Math.random().toString(16).slice(2)}`),
    sessionId,
    generation,
    unitRef: String(artifact.unitRef || unit.unitRef),
    kind: String(artifact.kind || "unknown"),
    mimeType: String(artifact.mimeType || "application/octet-stream"),
    createdAt: String(artifact.createdAt || new Date().toISOString()),
    createdAtMs: Math.max(0, Number(artifact.createdAtMs) || Date.now()),
    data: artifact.data || "",
    byteLength: dynamicArtifactByteLength(artifact),
    meta: artifact.meta && typeof artifact.meta === "object" ? artifact.meta : {},
    sender: unit
  };
  const db = await openDb();
  try {
    await requestFromStore(db, DYNAMIC_ARTIFACT_STORE, "readwrite", (store) => store.put(stored));
    return {
      artifactRef: stored.artifactRef,
      sessionId: stored.sessionId,
      generation: stored.generation,
      unitRef: stored.unitRef,
      kind: stored.kind,
      mimeType: stored.mimeType,
      createdAt: stored.createdAt,
      createdAtMs: stored.createdAtMs,
      byteLength: stored.byteLength,
      meta: stored.meta
    };
  } finally {
    db.close();
  }
}

async function getDynamicArtifact(artifactRef) {
  const normalizedArtifactRef = String(artifactRef || "").trim();
  if (!normalizedArtifactRef) {
    return null;
  }
  const db = await openDb();
  try {
    return await requestFromStore(db, DYNAMIC_ARTIFACT_STORE, "readonly", (store) => store.get(normalizedArtifactRef));
  } finally {
    db.close();
  }
}

function normalizeRawDynamicEvent(event, sender, globalSequence) {
  const unit = inferSenderUnit(sender);
  const receivedAtEpochMs = Date.now();
  const sessionId = String(event.sessionId || "").trim();
  const eventType = normalizeRawEventType(event.eventType);
  const sentAtEpochMs = normalizeEpochMs(event.sentAtEpochMs, receivedAtEpochMs);
  const timelineEpochMs = normalizeRawEventTimelineEpochMs(event, eventType, sentAtEpochMs);
  return {
    id: `raw:${sessionId}:${globalSequence}`,
    protocol: RAW_EVENT_SCHEMA,
    version: RAW_EVENT_VERSION,
    sessionId,
    generation: Math.max(0, Number(event.generation) || 0),
    eventId: String(event.eventId || event.id || `raw:${sessionId}:${globalSequence}`),
    eventType,
    line: normalizeRawEventLine(event.line, eventType),
    unitRef: unit.unitRef,
    unit: {
      ...(event.unit && typeof event.unit === "object" ? event.unit : {}),
      unitRef: unit.unitRef,
      chromeFrameId: unit.chromeFrameId,
      tabId: unit.tabId,
      senderUrl: unit.url
    },
    tabId: unit.tabId,
    chromeFrameId: unit.chromeFrameId,
    parentFrameId: unit.parentFrameId,
    sentAtEpochMs,
    timelineEpochMs,
    receivedAtEpochMs,
    globalSequence: Math.max(0, Number(globalSequence) || 0),
    localSequence: Math.max(0, Number(event.localSequence) || 0),
    payload: event.payload || {}
  };
}

function normalizeRawEventTimelineEpochMs(event, eventType, fallbackEpochMs) {
  if (eventType === RAW_EVENT_TYPE_SCREEN_FRAME && event && event.payload) {
    return normalizeEpochMs(event.payload.capturedAtEpochMs, fallbackEpochMs);
  }
  return normalizeEpochMs(event && event.timelineEpochMs, fallbackEpochMs);
}

function normalizeEpochMs(primary, finalFallback) {
  const primaryValue = Number(primary);
  if (Number.isFinite(primaryValue) && primaryValue > 0) {
    return Math.round(primaryValue);
  }
  return Math.max(0, Math.round(Number(finalFallback) || 0));
}

function normalizeRawEventType(eventType) {
  const normalized = String(eventType || "unknown");
  if (normalized === RAW_EVENT_TYPE_LEGACY_USER_EVENT) {
    return RAW_EVENT_TYPE_USER_OPERATION;
  }
  if (normalized === RAW_EVENT_TYPE_LEGACY_DOM_MUTATION) {
    return RAW_EVENT_TYPE_DOM_CHANGE;
  }
  if (normalized === RAW_EVENT_TYPE_LEGACY_DOCUMENT_SNAPSHOT) {
    return RAW_EVENT_TYPE_DOM_SNAPSHOT;
  }
  return normalized;
}

function normalizeRawEventLine(line, eventType) {
  const normalizedLine = String(line || "");
  if (normalizedLine) {
    return normalizedLine;
  }
  if (eventType === RAW_EVENT_TYPE_USER_OPERATION) {
    return RAW_EVENT_LINE_USER_OPERATION;
  }
  if (eventType === RAW_EVENT_TYPE_DOM_CHANGE || eventType === RAW_EVENT_TYPE_DOM_SNAPSHOT) {
    return RAW_EVENT_LINE_DOM_CHANGE;
  }
  if (eventType === RAW_EVENT_TYPE_SCREEN_FRAME) {
    return RAW_EVENT_LINE_SCREEN_FRAME;
  }
  if (eventType === RAW_EVENT_TYPE_DOCUMENT_JOINED || eventType === RAW_EVENT_TYPE_DOCUMENT_CHANGED || eventType === RAW_EVENT_TYPE_DOCUMENT_LEFT) {
    return RAW_EVENT_LINE_UNIT;
  }
  return "unknown";
}

function inferSenderUnit(sender) {
  const frameId = Number.isFinite(sender && sender.frameId) ? Number(sender.frameId) : 0;
  const tabId = sender && sender.tab && Number.isFinite(sender.tab.id) ? Number(sender.tab.id) : null;
  return {
    tabId,
    chromeFrameId: frameId,
    parentFrameId: null,
    unitRef: frameId === 0 ? "document" : `iframe:${frameId}`,
    url: String(sender && sender.url ? sender.url : "")
  };
}

function compareRawDynamicEvents(left, right) {
  const leftTime = rawDynamicTimelineMs(left);
  const rightTime = rawDynamicTimelineMs(right);
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  const leftReceived = Number(left.receivedAtEpochMs) || 0;
  const rightReceived = Number(right.receivedAtEpochMs) || 0;
  if (leftReceived !== rightReceived) {
    return leftReceived - rightReceived;
  }
  return (Number(left.globalSequence) || 0) - (Number(right.globalSequence) || 0);
}

function rawDynamicTimelineMs(event) {
  if (!event) {
    return 0;
  }
  if (Number(event.timelineEpochMs) > 0) {
    return Number(event.timelineEpochMs) || 0;
  }
  if (event.eventType === RAW_EVENT_TYPE_SCREEN_FRAME && event.payload) {
    return Number(event.payload.capturedAtEpochMs) || Number(event.sentAtEpochMs) || 0;
  }
  return Number(event.sentAtEpochMs) || 0;
}

function countRawDynamicEventsInMemory(events, sessionId) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId || !Array.isArray(events)) {
    return 0;
  }
  return events.filter((event) => (
    event
    && String(event.sessionId || "").trim() === normalizedSessionId
    && typeof event.eventType === "string"
  )).length;
}

function normalizeDynamicSession(session) {
  return {
    schema: "captura.dynamic-session",
    version: 1,
    sessionId: String(session && session.sessionId ? session.sessionId : ""),
    generation: Math.max(0, Number(session && session.generation) || 0),
    active: Boolean(session && session.active),
    startedAt: String(session && session.startedAt ? session.startedAt : ""),
    stoppedAt: String(session && session.stoppedAt ? session.stoppedAt : ""),
    stopReason: String(session && session.stopReason ? session.stopReason : ""),
    updatedAt: new Date().toISOString()
  };
}

function shouldBlockDynamicStateSave(dynamic, session) {
  return Boolean(
    dynamic
    && dynamic.active
    && session
    && session.sessionId === dynamic.sessionId
    && Number(session.generation) === Number(dynamic.generation)
    && !session.active
  );
}

function rawEventRejectionReason(event, session) {
  const sessionId = String(event && event.sessionId ? event.sessionId : "").trim();
  const generation = Math.max(0, Number(event && event.generation) || 0);
  if (!session || session.sessionId !== sessionId || Number(session.generation) !== generation) {
    return "stale-session";
  }
  const eventType = String(event && event.eventType ? event.eventType : "");
  const normalizedEventType = normalizeRawEventType(eventType);
  if (!session.active && normalizedEventType !== RAW_EVENT_TYPE_DOCUMENT_LEFT && normalizedEventType !== RAW_EVENT_TYPE_ARTIFACT_READY && normalizedEventType !== RAW_EVENT_TYPE_SCREEN_FRAME) {
    return "stopped-session";
  }
  return "";
}

function dynamicArtifactRejectionReason(sessionId, generation, session) {
  if (!session || session.sessionId !== sessionId || Number(session.generation) !== generation) {
    return "stale-session";
  }
  return "";
}

function dynamicArtifactByteLength(artifact) {
  const explicit = Number(artifact && artifact.byteLength);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.round(explicit);
  }
  const data = String(artifact && artifact.data ? artifact.data : "");
  const base64 = data.includes(",") ? data.split(",")[1] || "" : data;
  if (!base64) {
    return 0;
  }
  const padding = base64.endsWith("==") ? BASE64_DOUBLE_PADDING_BYTES : base64.endsWith("=") ? BASE64_SINGLE_PADDING_BYTES : 0;
  return Math.max(0, Math.floor((base64.length * BASE64_BYTES_PER_QUARTET) / BASE64_CHARS_PER_QUARTET) - padding);
}

async function deleteByIndexValue(index, value, generation) {
  const normalizedGeneration = Number(generation);
  await new Promise((resolve, reject) => {
    const request = index.openCursor(IDBKeyRange.only(value));
    request.onerror = () => reject(request.error || new Error("indexed delete cursor failed"));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      const record = cursor.value || {};
      const matchesGeneration = Number.isFinite(normalizedGeneration) && normalizedGeneration > 0
        ? Number(record.generation) === normalizedGeneration || !record.generation
        : true;
      if (matchesGeneration) {
        const deleteRequest = cursor.delete();
        deleteRequest.onerror = () => reject(deleteRequest.error || new Error("indexed delete cursor failed"));
        deleteRequest.onsuccess = () => cursor.continue();
        return;
      }
      cursor.continue();
    };
  });
}

function normalizeDynamicState(dynamic) {
  const nodes = Array.isArray(dynamic.nodes) ? dynamic.nodes : [];
  const rawEvents = Array.isArray(dynamic.rawEvents) ? dynamic.rawEvents : [];
  const rawMutations = Array.isArray(dynamic.rawMutations) ? dynamic.rawMutations : [];
  return {
    schema: "captura.dynamic-state",
    version: 1,
    active: Boolean(dynamic.active),
    sessionId: String(dynamic.sessionId || ""),
    generation: Math.max(0, Number(dynamic.generation) || 0),
    startedAt: String(dynamic.startedAt || ""),
    stoppedAt: String(dynamic.stoppedAt || ""),
    pageUrl: String(dynamic.pageUrl || ""),
    pageTitle: String(dynamic.pageTitle || ""),
    sequence: Math.max(0, Number(dynamic.sequence) || nodes.length),
    targetOrder: Math.max(0, Number(dynamic.targetOrder) || nodes.filter((node) => node && node.type === "action").length),
    noChangeFrameCount: Math.max(0, Number(dynamic.noChangeFrameCount) || 0),
    rawBusPackageCount: Math.max(0, Number(dynamic.rawBusPackageCount) || 0),
    rawEvents,
    rawMutations,
    nodes,
    updatedAt: new Date().toISOString()
  };
}

function normalizeImportedAnnotations(annotations) {
  const usedIds = new Set();
  return annotations.map((annotation, index) => {
    let id = String(annotation.id || createAnnotationId()).trim() || createAnnotationId();
    while (usedIds.has(id)) {
      id = `${id}-${index + 1}`;
    }
    usedIds.add(id);
    return {
      ...stripDisplaySequence(annotation),
      id
    };
  });
}

function orderAnnotations(annotations, order) {
  const byId = new Map();
  annotations.forEach((annotation) => {
    if (annotation && annotation.id) {
      byId.set(annotation.id, annotation);
    }
  });

  const ordered = [];
  order.forEach((id) => {
    if (byId.has(id)) {
      ordered.push(byId.get(id));
      byId.delete(id);
    }
  });

  const remaining = Array.from(byId.values()).sort((left, right) => {
    const leftSequence = Number(left.sequence) || Number.MAX_SAFE_INTEGER;
    const rightSequence = Number(right.sequence) || Number.MAX_SAFE_INTEGER;
    if (leftSequence !== rightSequence) {
      return leftSequence - rightSequence;
    }
    return String(left.createdAt || left.id).localeCompare(String(right.createdAt || right.id));
  });

  return [...ordered, ...remaining].map(stripDisplaySequence);
}

async function rewriteAnnotationStore(annotations) {
  const db = await openDb();
  try {
    const tx = db.transaction([ANNOTATION_STORE, META_STORE], "readwrite");
    const done = txDone(tx);
    const annotationStore = tx.objectStore(ANNOTATION_STORE);
    const metaStore = tx.objectStore(META_STORE);
    annotationStore.clear();
    annotations.forEach((annotation) => annotationStore.put(stripDisplaySequence(annotation)));
    metaStore.put({ key: ANNOTATION_ORDER_KEY, value: annotations.map((annotation) => annotation.id) });
    metaStore.delete("nextSequence");
    await done;
  } finally {
    db.close();
  }
}

function stripDisplaySequence(annotation) {
  const { sequence, ...rest } = annotation || {};
  return rest;
}

function createAnnotationId() {
  return `annotation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeImportedFields(fields) {
  const byKey = new Map();
  fields.forEach((field, index) => {
    const name = String(field.name || "").trim();
    if (!name) {
      return;
    }
    const key = name.toLowerCase();
    byKey.set(key, {
      id: field.id || `field-imported-${index + 1}`,
      name,
      description: String(field.description || "").trim(),
      createdAt: field.createdAt || "",
      updatedAt: field.updatedAt || ""
    });
  });
  return Array.from(byKey.values());
}

async function requestFromStore(db, storeName, mode, operation) {
  const tx = db.transaction(storeName, mode);
  const done = txDone(tx);
  const result = await idbRequest(operation(tx.objectStore(storeName)));
  await done;
  return result;
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("批注记忆库操作失败"));
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("批注记忆库事务已取消"));
    tx.onerror = () => reject(tx.error || new Error("批注记忆库事务失败"));
  });
}

if (globalThis.__LIGENTIA_WORKFLOW_RECORDER_BACKGROUND_TEST_MODE__) {
  globalThis.__LIGENTIA_WORKFLOW_RECORDER_BACKGROUND_TEST_HOOKS__ = {
    countRawDynamicEventsInMemory,
    normalizeRawDynamicEvent,
    normalizeDynamicSession,
    shouldBlockDynamicStateSave,
    rawEventRejectionReason,
    dynamicArtifactRejectionReason,
    dynamicArtifactByteLength
  };
}
