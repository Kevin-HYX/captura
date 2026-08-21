// Shared DOM helpers, selectors, clipboard, HTML formatting, ZIP reader/writer, and download helpers.
    return value ? "true" : "false";
  }

  function formatMaybeMs(value) {
    return value === null || value === undefined ? "unknown" : `+${value}ms`;
  }

  function buildDetailedAnnotationsText(annotations = state.annotations, fields = state.fields) {
    const lines = [
      "# Captura Detailed Annotation Text",
      "",
      `Generated at: ${formatShanghaiTime(new Date())}`,
      `Annotation total: ${annotations.length}`,
      ""
    ];

    annotations.forEach((annotation, index) => {
      const id = exportAnnotationId(index);
      lines.push(`## ${id}`);
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(buildDetailedAnnotationMeta(annotation, id, index + 1, fields), null, 2));
      lines.push("```");
      lines.push("");
    });

    return `${lines.join("\n")}\n`;
  }

  function buildDetailedAnnotationMeta(annotation, id, sequence, fields = state.fields) {
    return {
      id,
      sequence,
      type: annotation.type,
      annotationText: annotation.annotationText || "",
      fieldReferences: extractFieldReferences(annotation.annotationText || "", fields),
      selector: annotation.selector || "",
      pageUrl: annotation.pageUrl || "",
      pageTitle: annotation.pageTitle || "",
      createdAt: annotation.createdAt || "",
      updatedAt: annotation.updatedAt || "",
      viewport: annotation.viewport || null,
      selection: annotation.selection || null,
      documentSelection: annotation.documentSelection || null,
      outerHTML: annotation.outerHTML || "",
      htmlContext: buildAnnotationHtmlContext(annotation),
      frameContext: annotation.frameContext || null
    };
  }

  function buildElementHtmlContext(element) {
    const parent = element && element.parentElement ? element.parentElement : null;
    const grandparent = parent && parent.parentElement ? parent.parentElement : null;
    return {
      targetOuterHTML: getOuterHtmlWithoutRecorder(element),
      parentOuterHTML: getOuterHtmlWithoutRecorder(parent),
      grandparentOuterHTML: getOuterHtmlWithoutRecorder(grandparent)
    };
  }

  function buildAnnotationHtmlContext(annotation) {
    const parsed = parseAnnotationDomContext(annotation);
    const frameContext = annotation && annotation.frameContext ? annotation.frameContext : null;
    return {
      selector: annotation.selector || "",
      targetOuterHTML: frameContext && frameContext.targetOuterHTML ? frameContext.targetOuterHTML : annotation.outerHTML || parsed.targetOuterHTML || "",
      parentOuterHTML: frameContext && frameContext.targetParentOuterHTML ? frameContext.targetParentOuterHTML : annotation.parentOuterHTML || parsed.parentOuterHTML || "",
      grandparentOuterHTML: frameContext && frameContext.targetGrandparentOuterHTML ? frameContext.targetGrandparentOuterHTML : annotation.grandparentOuterHTML || parsed.grandparentOuterHTML || "",
      parentFrameOuterHTML: annotation.outerHTML || ""
    };
  }

  function parseAnnotationDomContext(annotation) {
    if (!annotation || !annotation.selector || !annotation.domHtml) {
      return {};
    }
    try {
      const doc = new DOMParser().parseFromString(annotation.domHtml, "text/html");
      const target = doc.querySelector(annotation.selector);
      if (!target) {
        return {};
      }
      return buildElementHtmlContext(target);
    } catch {
      return {};
    }
  }

  async function writeClipboardText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // Fall back to document.execCommand for pages that block async clipboard access.
      }
    }
    const textarea = document.createElement("textarea");
    textarea.setAttribute(ROOT_ATTR, "true");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "-9999px";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.opacity = "0";
    document.documentElement.append(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) {
      throw new Error("浏览器拒绝写入剪贴板。");
    }
  }

  function formatShanghaiTime(date) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    })
      .formatToParts(date)
      .reduce((values, part) => {
        if (part.type !== "literal") {
          values[part.type] = part.value;
        }
        return values;
      }, {});
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} Asia/Shanghai`;
  }

  function collectUsedFields(annotations = state.annotations, fields = state.fields) {
    const byName = new Map();
    annotations.forEach((annotation) => {
      extractFieldReferences(annotation.annotationText || "", fields).forEach((field) => {
        byName.set(field.name.toLowerCase(), field);
      });
    });
    return Array.from(byName.values()).sort((left, right) => left.name.localeCompare(right.name));
  }

  function extractFieldReferences(text, fields = state.fields) {
    const names = new Set();
    const references = [];
    const pattern = /@\{([^}]+)\}/g;
    let match;
    while ((match = pattern.exec(text))) {
      const name = match[1].trim();
      const key = name.toLowerCase();
      if (!name || names.has(key)) {
        continue;
      }
      names.add(key);
      const defined = fields.find((field) => field.name.toLowerCase() === key);
      references.push({
        id: defined ? defined.id : "",
        name,
        description: defined ? defined.description || "" : "未定义字段"
      });
    }
    return references;
  }

  function renderAnnotationTextHtml(text) {
    return escapeHtml(text).replace(/@\{([^}]+)\}/g, (_match, name) => {
      return `<span class="lwr-field-token">@${escapeHtml(name.trim())}</span>`;
    });
  }

  function renderAnnotationTextMarkdown(text) {
    return escapeHtml(text).replace(/@\{([^}]+)\}/g, (_match, name) => {
      return `<span style="display:inline-block;padding:1px 6px;border:1px solid #8ec5ff;border-radius:999px;background:#eef7ff;color:#0969da;font-weight:600;">@${escapeHtml(name.trim())}</span>`;
    });
  }

  function getPageHtmlWithoutRecorder() {
    const clone = cloneNodeWithoutRecorder(document.documentElement);
    return `<!doctype html>\n${clone.outerHTML}`;
  }

  function getOuterHtmlWithoutRecorder(node) {
    const element = normalizeEventTarget(node);
    if (!element || isRecorderNode(element) || !element.outerHTML) {
      return "";
    }
    const clone = cloneNodeWithoutRecorder(element);
    return clone && clone.outerHTML ? clone.outerHTML : "";
  }

  function cloneNodeWithoutRecorder(node) {
    if (!node || !node.cloneNode) {
      return null;
    }
    const clone = node.cloneNode(true);
    removeRecorderNodesFromClone(clone);
    return clone;
  }

  function removeRecorderNodesFromClone(clone) {
    if (!clone || clone.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    if (clone.getAttribute && clone.getAttribute(ROOT_ATTR) === "true") {
      clone.remove();
      return;
    }
    if (clone.querySelectorAll) {
      clone.querySelectorAll(`[${ROOT_ATTR}="true"]`).forEach((node) => node.remove());
    }
  }

  function formatHtml(html) {
    const tokens = html
      .replace(/>\s+</g, "><")
      .replace(/</g, "\n<")
      .replace(/>/g, ">\n")
      .split("\n")
      .map((part) => part.trim())
      .filter(Boolean);

    let indent = 0;
    const lines = [];
    tokens.forEach((token) => {
      if (/^<\/[^>]+>/.test(token)) {
        indent = Math.max(indent - 1, 0);
      }

      lines.push(`${"  ".repeat(indent)}${token}`);

      if (
        /^<[^!?/][^>]*[^/]?>$/.test(token) &&
        !/^<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/i.test(token)
      ) {
        indent += 1;
      }
    });

    return `${lines.join("\n")}\n`;
  }

  function getAnnotatableElement(x, y) {
    const element = elementFromPointBelowRecorder(x, y);
    if (!element || isRecorderNode(element)) {
      return null;
    }
    return pickStaticAnnotationTarget(element, x, y);
  }

  function elementFromPointBelowRecorder(x, y) {
    const shieldPointerEvents = ui.eventShield ? ui.eventShield.style.pointerEvents : "";
    const hostPointerEvents = ui.host ? ui.host.style.pointerEvents : "";
    if (ui.eventShield) {
      ui.eventShield.style.pointerEvents = "none";
    }
    if (ui.host) {
      ui.host.style.pointerEvents = "none";
    }
    try {
      return document.elementFromPoint(x, y);
    } finally {
      if (ui.eventShield) {
        ui.eventShield.style.pointerEvents = shieldPointerEvents;
      }
      if (ui.host) {
        ui.host.style.pointerEvents = hostPointerEvents;
      }
    }
  }

  function pickStaticAnnotationTarget(element, x, y) {
    const closestTarget = closestStaticAnnotationTarget(element);
    if (closestTarget) {
      return closestTarget;
    }
    const containedTarget = findStaticAnnotationTargetAtPoint(element, x, y);
    return containedTarget || element;
  }

  function closestStaticAnnotationTarget(element) {
    if (!element || !element.closest) {
      return null;
    }
    const target = element.closest(STATIC_TARGET_PREFERRED_SELECTOR);
    return target && !isRecorderNode(target) ? target : null;
  }

  function findStaticAnnotationTargetAtPoint(root, x, y) {
    if (!root || !root.querySelectorAll) {
      return null;
    }
    const candidates = Array.from(root.querySelectorAll(STATIC_TARGET_PREFERRED_SELECTOR))
      .filter((candidate) => {
        if (isRecorderNode(candidate)) {
          return false;
        }
        const rect = candidate.getBoundingClientRect();
        return rect
          && rect.width > 0
          && rect.height > 0
          && x >= rect.left
          && x <= rect.right
          && y >= rect.top
          && y <= rect.bottom;
      })
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
      });
    return candidates[0] || null;
  }

  function isRecorderNode(node) {
    return Boolean(node && node.closest && node.closest(`[${ROOT_ATTR}="true"]`));
  }

  function isAnnotationShieldEvent(event) {
    return event.currentTarget === ui.eventShield || event.target === ui.eventShield;
  }

  function isolateAnnotationPointerEvent(event) {
    if (!state.annotationMode) {
      return;
    }
    if (event.type && event.type.startsWith("pointer")) {
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function showBox(box, rect) {
    if (!box) {
      return;
    }
    const normalized = clampRect(rect);
    box.style.display = "block";
    box.style.left = `${normalized.x}px`;
    box.style.top = `${normalized.y}px`;
    box.style.width = `${normalized.width}px`;
    box.style.height = `${normalized.height}px`;
  }

  function hideHoverBox() {
    if (!ui.hoverBox) {
      return;
    }
    ui.hoverBox.style.display = "none";
  }

  function hideRegionBox() {
    if (!ui.regionBox) {
      return;
    }
    ui.regionBox.style.display = "none";
  }

  function rectFromPoints(x1, y1, x2, y2) {
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1)
    };
  }

  function clampRect(rect) {
    const x = Math.max(0, Math.min(window.innerWidth, rect.x ?? rect.left));
    const y = Math.max(0, Math.min(window.innerHeight, rect.y ?? rect.top));
    const right = Math.max(0, Math.min(window.innerWidth, (rect.x ?? rect.left) + rect.width));
    const bottom = Math.max(0, Math.min(window.innerHeight, (rect.y ?? rect.top) + rect.height));
    return {
      x,
      y,
      width: Math.max(1, right - x),
      height: Math.max(1, bottom - y)
    };
  }

  function selectionToDocument(selection) {
    const normalized = normalizeSelection(selection);
    return {
      x: normalized.x + Math.round(window.scrollX),
      y: normalized.y + Math.round(window.scrollY),
      width: normalized.width,
      height: normalized.height
    };
  }

  function selectionForViewport(source) {
    if (source.documentSelection) {
      return documentSelectionToViewport(source.documentSelection);
    }
    return source.selection;
  }

  function viewportSelectionFromAnnotation(annotation) {
    if (annotation.type === "element" && annotation.selector) {
      const liveSelection = liveSelectionFromSelector(annotation.selector);
      if (liveSelection) {
        return liveSelection;
      }
    }
    const selection = annotation.documentSelection
      ? documentSelectionToViewport(annotation.documentSelection)
      : annotation.selection;
    if (!selection || !intersectsViewport(selection)) {
      return null;
    }
    return clampRect(selection);
  }

  function liveSelectionFromSelector(selector) {
    let element;
    try {
      element = document.querySelector(selector);
    } catch {
      return null;
    }
    if (!element || isRecorderNode(element)) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0 || !intersectsViewport(rect)) {
      return null;
    }
    return clampRect(rect);
  }

  function documentSelectionToViewport(documentSelection) {
    return {
      x: documentSelection.x - window.scrollX,
      y: documentSelection.y - window.scrollY,
      width: documentSelection.width,
      height: documentSelection.height
    };
  }

  function intersectsViewport(selection) {
    return (
      selection.x + selection.width >= 0 &&
      selection.y + selection.height >= 0 &&
      selection.x <= window.innerWidth &&
      selection.y <= window.innerHeight
    );
  }

  function normalizeSelection(selection) {
    return {
      x: Math.round(selection.x),
      y: Math.round(selection.y),
      width: Math.round(selection.width),
      height: Math.round(selection.height)
    };
  }

  function buildSelector(element) {
    if (element.id) {
      const selector = `#${cssEscape(element.id)}`;
      if (isUnique(selector)) return selector;
    }

    const preferred = selectorWithPreferredAttribute(element);
    if (preferred && isUnique(preferred)) {
      return preferred;
    }

    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
      parts.unshift(selectorPart(current));
      const selector = parts.join(" > ");
      if (isUnique(selector)) {
        return selector;
      }
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  function selectorWithPreferredAttribute(element) {
    const attrs = ["data-testid", "data-test", "data-cy", "name", "aria-label", "title", "role"];
    for (const attr of attrs) {
      const value = element.getAttribute(attr);
      if (value) {
        return `${element.localName}[${attr}="${cssString(value)}"]`;
      }
    }
    return "";
  }

  function selectorPart(element) {
    let part = element.localName;
    const attrSelector = selectorWithPreferredAttribute(element);
    if (attrSelector) {
      part = attrSelector;
    } else if (element.classList.length) {
      const classes = Array.from(element.classList)
        .filter((name) => !name.startsWith("lwr-"))
        .slice(0, 3)
        .map((name) => `.${cssEscape(name)}`)
        .join("");
      if (classes) {
        part += classes;
      }
    }

    const index = nthOfType(element);
    if (index > 1 || !isUniqueWithinParent(element, part)) {
      part += `:nth-of-type(${index})`;
    }
    return part;
  }

  function nthOfType(element) {
    let index = 1;
    let sibling = element.previousElementSibling;
    while (sibling) {
      if (sibling.localName === element.localName) {
        index += 1;
      }
      sibling = sibling.previousElementSibling;
    }
    return index;
  }

  function isUniqueWithinParent(element, selector) {
    if (!element.parentElement) return true;
    try {
      return element.parentElement.querySelectorAll(`:scope > ${selector}`).length === 1;
    } catch {
      return false;
    }
  }

  function isUnique(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function cssString(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function normalizeInlineText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function firstNonEmpty(values) {
    return values.map((value) => normalizeInlineText(value)).find(Boolean) || "";
  }

  function truncateText(text, maxLength) {
    const normalized = normalizeInlineText(text);
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
  }

  function hashText(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }

  function encodeText(text) {
    return new TextEncoder().encode(text);
  }

  const BACKGROUND_DOWNLOAD_MAX_BLOB_BYTES = 32 * 1024 * 1024;
  const BLOB_URL_REVOKE_DELAY_MS = 30000;

  async function downloadBlob(blob, filename, options = {}) {
    try {
      downloadBlobInPage(blob, filename);
      return;
    } catch (error) {
      if (options.forcePageDownload || blob.size > BACKGROUND_DOWNLOAD_MAX_BLOB_BYTES) {
        throw new Error(`下载触发失败，且文件过大，不能通过扩展消息兜底：${error.message}`);
      }
    }
    await downloadBlobViaBackground(blob, filename, options);
  }

  function downloadBlobInPage(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename || "captura-download";
    anchor.rel = "noopener";
    anchor.style.display = "none";
    anchor.setAttribute(ROOT_ATTR, "true");
    (ui.root || document.documentElement).append(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_REVOKE_DELAY_MS);
    }
  }

  async function downloadBlobViaBackground(blob, filename, options = {}) {
    if (blob.size > BACKGROUND_DOWNLOAD_MAX_BLOB_BYTES) {
      throw new Error("文件过大，不能通过扩展消息下载。");
    }
    const dataUrl = await blobToDataUrl(blob);
    const response = await chrome.runtime.sendMessage({
      type: "LWR_DOWNLOAD",
      url: dataUrl,
      filename,
      saveAs: Boolean(options.saveAs)
    });
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "下载请求失败");
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("文件数据转换失败"));
      reader.readAsDataURL(blob);
    });
  }

  function dataUrlToBytes(dataUrl) {
    const base64 = dataUrl.split(",")[1] || "";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function bytesToDataUrl(bytes, mimeType) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.slice(offset, offset + 0x8000));
    }
    return `data:${mimeType};base64,${btoa(binary)}`;
  }

  function buildRecorderStateFromZipEntries(entries) {
    const stateEntry = entries.get("StaticRecorderState.json");
    if (stateEntry) {
      const parsed = JSON.parse(decodeText(stateEntry));
      if (!Array.isArray(parsed.annotations)) {
        throw new Error("Recorder state 中缺少 annotations。");
      }
      return parsed;
    }
    throw new Error("ZIP 中缺少 StaticRecorderState.json，无法恢复静态批注状态。");
  }

  function readZipEntries(zipBytes) {
    const eocdOffset = findEndOfCentralDirectory(zipBytes);
    if (eocdOffset < 0) {
      throw new Error("不是有效的 ZIP 文件。");
    }
    const entryCount = readU16(zipBytes, eocdOffset + 10);
    let centralOffset = readU32(zipBytes, eocdOffset + 16);
    const entries = new Map();
    for (let index = 0; index < entryCount; index += 1) {
      if (readU32(zipBytes, centralOffset) !== 0x02014b50) {
        throw new Error("ZIP 中央目录格式错误。");
      }
      const method = readU16(zipBytes, centralOffset + 10);
      const compressedSize = readU32(zipBytes, centralOffset + 20);
      const uncompressedSize = readU32(zipBytes, centralOffset + 24);
      const nameLength = readU16(zipBytes, centralOffset + 28);
      const extraLength = readU16(zipBytes, centralOffset + 30);
      const commentLength = readU16(zipBytes, centralOffset + 32);
      const localOffset = readU32(zipBytes, centralOffset + 42);
      const path = decodeText(zipBytes.slice(centralOffset + 46, centralOffset + 46 + nameLength));
      if (method !== 0) {
        throw new Error(`ZIP 条目使用了暂不支持的压缩方式：${path}`);
      }
      if (readU32(zipBytes, localOffset) !== 0x04034b50) {
        throw new Error(`ZIP 本地文件头格式错误：${path}`);
      }
      const localNameLength = readU16(zipBytes, localOffset + 26);
      const localExtraLength = readU16(zipBytes, localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const data = zipBytes.slice(dataOffset, dataOffset + compressedSize);
      if (data.length !== uncompressedSize) {
        throw new Error(`ZIP 条目大小不一致：${path}`);
      }
      entries.set(path, data);
      centralOffset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  function findEndOfCentralDirectory(bytes) {
    for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
      if (readU32(bytes, offset) === 0x06054b50) {
        return offset;
      }
    }
    return -1;
  }

  function readU16(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
  }

  function readU32(bytes, offset) {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  }

  function decodeText(bytes) {
    return new TextDecoder().decode(bytes);
  }

  function createZip(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    files.forEach((file) => {
      const name = encodeText(file.path);
      const dataChunks = normalizeZipFileDataChunks(file.data);
      const dataLength = zipDataLength(dataChunks);
      const crc = crc32Chunks(dataChunks);
      const localHeader = concatBytes(
        u32(0x04034b50),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(dataLength),
        u32(dataLength),
        u16(name.length),
        u16(0),
        name
      );

      localParts.push(localHeader, ...dataChunks);

      const centralHeader = concatBytes(
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(dataLength),
        u32(dataLength),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name
      );
      centralParts.push(centralHeader);
      offset += localHeader.length + dataLength;
    });

    const centralDirectory = concatBytes(...centralParts);
    const end = concatBytes(
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(files.length),
      u16(files.length),
      u32(centralDirectory.length),
      u32(offset),
      u16(0)
    );

    return new Blob([...localParts, centralDirectory, end], { type: "application/zip" });
  }

  function normalizeZipFileDataChunks(data) {
    const chunks = Array.isArray(data) ? data : [data];
    return chunks
      .map((chunk) => chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk || []))
      .filter((chunk) => chunk.length > 0);
  }

  function zipDataLength(chunks) {
    return chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  }

  function concatBytes(...arrays) {
    const length = arrays.reduce((sum, array) => sum + array.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    arrays.forEach((array) => {
      result.set(array, offset);
      offset += array.length;
    });
    return result;
  }

  function u16(value) {
    const bytes = new Uint8Array(2);
    bytes[0] = value & 0xff;
    bytes[1] = (value >>> 8) & 0xff;
    return bytes;
  }

  function u32(value) {
    const bytes = new Uint8Array(4);
    bytes[0] = value & 0xff;
    bytes[1] = (value >>> 8) & 0xff;
    bytes[2] = (value >>> 16) & 0xff;
    bytes[3] = (value >>> 24) & 0xff;
    return bytes;
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(data) {
    return crc32Chunks([data]);
  }

  function crc32Chunks(chunks) {
    let crc = 0xffffffff;
    chunks.forEach((chunk) => {
      crc = crc32Update(crc, chunk);
    });
    return (crc ^ 0xffffffff) >>> 0;
  }

  function crc32Update(crc, data) {
    for (let i = 0; i < data.length; i += 1) {
      crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    }
    return crc >>> 0;
  }
