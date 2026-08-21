// Static annotation rendering, field management, store messaging, import/export controls, and workspace state.
      // Selector generation is best effort for dynamic appendix only.
    }
    return candidates;
  }

  function collectNearbyText(element, limit = 12) {
    const texts = [];
    let current = element;
    while (current && current !== document.body && texts.length < limit) {
      summarizeVisibleText(current, 4).forEach((text) => texts.push(text));
      current = current.parentElement;
    }
    return uniqueStrings(texts).slice(0, limit);
  }

  function buildAncestorChainSummary(element) {
    const items = [];
    let current = element;
    while (current && current !== document.documentElement && items.length < 6) {
      items.push({
        tag: current.tagName ? current.tagName.toLowerCase() : "",
        role: current.getAttribute ? current.getAttribute("role") || "" : "",
        textSummary: getOwnText(current, 120)
      });
      current = current.parentElement;
    }
    return items;
  }

  function summarizeVisibleText(root, limit = 8) {
    if (!root || isRecorderNode(root)) return [];
    const source = root === document.body || root === document.documentElement
      ? cloneNodeWithoutRecorder(root)
      : root;
    const text = String(source && (source.innerText || source.textContent) || "").replace(/\s+/g, " ").trim();
    if (!text) return [];
    return uniqueStrings(text.split(/(?<=[。！？.!?])\s+|\s{2,}|(?<=\S)\s(?=\S{12,})/).map((part) => part.trim()).filter(Boolean)).slice(0, limit);
  }

  function summarizeNodeListText(nodes, limit = 5) {
    const texts = [];
    nodes.forEach((node) => {
      if (isDynamicCssCarrierNode(node)) {
        return;
      }
      if (node.nodeType === Node.ELEMENT_NODE && !isRecorderNode(node)) {
        texts.push(...summarizeVisibleText(node, limit));
      } else if (node.nodeType === Node.TEXT_NODE) {
        if (isRecorderNode(node.parentElement) || isDynamicCssCarrierNode(node.parentElement)) {
          return;
        }
        const text = String(node.textContent || "").replace(/\s+/g, " ").trim();
        if (text) texts.push(sanitizeDynamicDomPayloadText(text));
      }
    });
    return uniqueStrings(texts).slice(0, limit);
  }

  function buildElementPath(element) {
    if (!element || !element.tagName) {
      return "";
    }
    try {
      return buildSelector(element);
    } catch {
      return element.tagName.toLowerCase();
    }
  }

  function uniqueStrings(values) {
    const seen = new Set();
    return values.filter((value) => {
      const normalized = String(value || "").replace(/\s+/g, " ").trim();
      if (!normalized || seen.has(normalized.toLowerCase())) {
        return false;
      }
      seen.add(normalized.toLowerCase());
      return true;
    });
  }

  function renderMarkers() {
    ui.markerLayer.innerHTML = "";
    if (!state.annotationMode) {
      return;
    }
    state.pageAnnotations.forEach((annotation) => {
      const selection = viewportSelectionFromAnnotation(annotation);
      if (!selection) return;
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "lwr-marker";
      marker.textContent = String(annotationSequence(annotation));
      marker.title = "点击编辑或删除 Annotation";
      marker.setAttribute(ROOT_ATTR, "true");
      marker.style.left = `${Math.max(4, selection.x)}px`;
      marker.style.top = `${Math.max(4, selection.y)}px`;
      marker.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openAnnotationInput(
          {
            editId: annotation.id,
            type: annotation.type,
            selector: annotation.selector || "",
            selection,
            documentSelection: annotation.documentSelection || selectionToDocument(selection),
            outerHTML: annotation.outerHTML || "",
            parentOuterHTML: annotation.parentOuterHTML || "",
            grandparentOuterHTML: annotation.grandparentOuterHTML || "",
            mouse: {
              x: selection.x,
              y: selection.y
            }
          },
          annotation.annotationText || ""
        );
      });
      ui.markerLayer.append(marker);
    });
  }

  async function clearAnnotations() {
    await storeMessage("LWR_STORE_CLEAR");
    state.annotations = [];
    state.pageAnnotations = [];
    state.draft = null;
    closePopover();
    closeAnnotationPanel();
    renderMarkers();
    updateToolbar();
  }

  async function deleteAnnotation(id) {
    await storeMessage("LWR_STORE_DELETE", { id });
    await syncAnnotationStore();
  }

  async function syncAnnotationStore() {
    const response = await storeMessage("LWR_STORE_GET_INDEX");
    state.annotations = Array.isArray(response.annotations) ? response.annotations : [];
    state.fields = Array.isArray(response.fields) ? response.fields : [];
    state.pageKey = location.href;
    state.pageAnnotations = state.annotations.filter((annotation) => annotation.pageUrl === state.pageKey);
    renderMarkers();
    renderAnnotationPanel();
    updateToolbar();
  }

  async function loadAnnotationById(id) {
    const response = await storeMessage("LWR_STORE_GET_BY_ID", { id });
    return response.annotation || null;
  }

  async function loadFullAnnotationStore() {
    const response = await storeMessage("LWR_STORE_GET_INDEX");
    const summaries = Array.isArray(response.annotations) ? response.annotations : [];
    const annotations = [];
    for (const summary of summaries) {
      const annotation = await loadAnnotationById(summary.id);
      if (annotation) {
        annotations.push(annotation);
      }
    }
    return {
      annotations,
      fields: Array.isArray(response.fields) ? response.fields : []
    };
  }

  async function storeMessage(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...payload });
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "批注记忆库无响应");
    }
    return response;
  }

  function handlePossiblePageChange() {
    setTimeout(() => {
      if (state.pageKey === location.href) {
        return;
      }
      state.pageKey = location.href;
      state.draft = null;
      closePopover();
      syncAnnotationStore().catch((error) => console.warn("LWR page sync failed", error));
    }, 0);
  }

  function refreshViewportPositions() {
    renderMarkers();
    positionFieldPanelNearToolbar();
    if (ui.popover && state.draft) {
      showBox(ui.hoverBox, selectionForViewport(state.draft));
    }
  }

  function renderFieldSuggestions(editor, suggestBox) {
    const mention = getActiveMention(editor);
    if (!mention) {
      suggestBox.hidden = true;
      suggestBox.innerHTML = "";
      return;
    }

    const query = mention.query.toLowerCase();
    const matches = state.fields
      .filter((field) => field.name.toLowerCase().includes(query))
      .slice(0, 8);
    const items = matches.map(
      (field) =>
        `<button type="button" data-field-id="${escapeAttribute(field.id)}"><strong>${escapeHtml(field.name)}</strong><span>${escapeHtml(field.description || "")}</span></button>`
    );
    items.push('<button type="button" data-action="add-field-from-suggest">+ 新增字段</button>');
    suggestBox.innerHTML = items.join("");
    suggestBox.hidden = false;
  }

  function getActiveMention(editor) {
    const position = getCaretTextOffset(editor);
    if (position < 0) {
      return null;
    }
    const beforeCursor = editor.textContent.slice(0, position);
    const match = beforeCursor.match(/@([^\s@{}]*)$/);
    if (!match) {
      return null;
    }
    return {
      start: position - match[0].length,
      end: position,
      query: match[1] || ""
    };
  }

  function insertFieldReference(editor, field, suggestBox, existingMention = null) {
    const mention = existingMention || getActiveMention(editor);
    if (!mention) {
      return;
    }
    replaceEditorRangeWithToken(editor, mention.start, mention.end, field);
    editor.focus({ preventScroll: true });
    suggestBox.hidden = true;
    suggestBox.innerHTML = "";
  }

  async function createFieldFromMention(editor, suggestBox) {
    const mention = getActiveMention(editor);
    const suggestedName = mention && mention.query ? mention.query : "";
    const name = prompt("字段名称", suggestedName);
    if (!name || !name.trim()) {
      return;
    }
    const description = prompt("字段说明", "") || "";
    const field = await upsertField({ name: name.trim(), description });
    insertFieldReference(editor, field, suggestBox, mention);
    if (ui.fieldPanel) {
      renderFieldPanel();
    }
  }

  function setEditorValue(editor, value) {
    editor.innerHTML = "";
    const text = String(value || "");
    const pattern = /@\{([^}]+)\}/g;
    let lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) {
      appendEditorText(editor, text.slice(lastIndex, match.index));
      appendFieldToken(editor, { name: match[1].trim() });
      lastIndex = pattern.lastIndex;
    }
    appendEditorText(editor, text.slice(lastIndex));
  }

  function serializeEditorValue(editor) {
    const parts = serializeEditorNodes(editor.childNodes);
    return parts.join("").replace(/\u00a0/g, " ");
  }

  function serializeEditorNodes(nodes) {
    const parts = [];
    nodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.textContent);
      } else if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("lwr-field-token")) {
        parts.push(`@{${node.getAttribute("data-field-name") || node.textContent.replace(/^@/, "")}}`);
      } else if (node.nodeType === Node.ELEMENT_NODE && node.localName === "br") {
        parts.push("\n");
      } else {
        parts.push(...serializeEditorNodes(node.childNodes));
        if (node.nodeType === Node.ELEMENT_NODE && /^(div|p)$/i.test(node.localName)) {
          parts.push("\n");
        }
      }
    });
    return parts;
  }

  function appendEditorText(editor, text) {
    if (text) {
      editor.append(editor.ownerDocument.createTextNode(text));
    }
  }

  function appendFieldToken(parent, field) {
    const token = parent.ownerDocument.createElement("span");
    token.className = "lwr-field-token";
    token.setAttribute("contenteditable", "false");
    token.setAttribute("data-field-name", field.name);
    token.textContent = `@${field.name}`;
    parent.append(token);
  }

  function replaceEditorRangeWithToken(editor, start, end, field) {
    const range = rangeFromTextOffsets(editor, start, end);
    if (!range) {
      return;
    }
    range.deleteContents();
    const editorDocument = editor.ownerDocument;
    const token = editorDocument.createElement("span");
    token.className = "lwr-field-token";
    token.setAttribute("contenteditable", "false");
    token.setAttribute("data-field-name", field.name);
    token.textContent = `@${field.name}`;
    const trailingSpace = editorDocument.createTextNode(" ");
    range.insertNode(trailingSpace);
    range.insertNode(token);
    const selection = editorDocument.defaultView.getSelection();
    const nextRange = editorDocument.createRange();
    nextRange.setStartAfter(trailingSpace);
    nextRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(nextRange);
  }

  function getCaretTextOffset(editor) {
    const selection = editor.ownerDocument.defaultView.getSelection();
    if (!selection || !selection.rangeCount) {
      return -1;
    }
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.endContainer)) {
      return -1;
    }
    const prefix = range.cloneRange();
    prefix.selectNodeContents(editor);
    prefix.setEnd(range.endContainer, range.endOffset);
    return prefix.toString().length;
  }

  function rangeFromTextOffsets(root, start, end) {
    const rootDocument = root.ownerDocument;
    const range = rootDocument.createRange();
    let offset = 0;
    let startSet = false;
    const walker = rootDocument.createTreeWalker(root, rootDocument.defaultView.NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const nextOffset = offset + node.textContent.length;
      if (!startSet && start >= offset && start <= nextOffset) {
        range.setStart(node, start - offset);
        startSet = true;
      }
      if (startSet && end >= offset && end <= nextOffset) {
        range.setEnd(node, end - offset);
        return range;
      }
      offset = nextOffset;
    }
    return null;
  }

  async function upsertField(field) {
    const response = await storeMessage("LWR_STORE_FIELD_UPSERT", { field });
    state.fields = Array.isArray(response.fields) ? response.fields : [];
    return response.field;
  }

  async function deleteFieldDefinition(id) {
    const response = await storeMessage("LWR_STORE_FIELD_DELETE", { id });
    state.fields = Array.isArray(response.fields) ? response.fields : [];
    renderFieldPanel();
  }

  async function importFieldDefinitions(fields) {
    const response = await storeMessage("LWR_STORE_FIELDS_IMPORT", { fields });
    state.fields = Array.isArray(response.fields) ? response.fields : [];
    renderFieldPanel();
  }

  function openAnnotationManager() {
    if (ui.annotationPanel) {
      closeAnnotationPanel();
      return;
    }
    closeFieldPanel();
    const panel = document.createElement("div");
    panel.id = "lwr-annotation-panel";
    panel.setAttribute(ROOT_ATTR, "true");
    ui.root.append(panel);
    ui.annotationPanel = panel;
    renderAnnotationPanel();
    positionPanelNearToolbar(panel, 560);
    updateToolbar();
  }

  function renderAnnotationPanel() {
    if (!ui.annotationPanel) {
      return;
    }
    const rows = state.annotations
      .map((annotation) => {
        const isCurrent = annotation.pageUrl === state.pageKey;
        const text = annotation.annotationText || "未填写批注";
        const sequence = annotationSequence(annotation);
        return `
          <div class="lwr-annotation-row${isCurrent ? " is-current" : ""}" data-annotation-id="${escapeAttribute(annotation.id)}" draggable="true">
            <span class="lwr-annotation-drag" title="拖拽调整顺序">⋮⋮</span>
            <span class="lwr-annotation-sequence">${escapeHtml(String(sequence))}</span>
            <span class="lwr-annotation-main">
              <strong>${escapeHtml(text.length > 52 ? `${text.slice(0, 52)}...` : text)}</strong>
              <small>${escapeHtml(annotation.pageTitle || annotation.pageUrl || "未知页面")}</small>
            </span>
            <span class="lwr-annotation-actions">
              <button type="button" data-action="edit-annotation">编辑</button>
              <button type="button" data-action="delete-annotation" data-danger="true">删除</button>
            </span>
          </div>`;
      })
      .join("");

    ui.annotationPanel.innerHTML = `
      <div class="lwr-field-panel-head">
        <strong>批注列表</strong>
        <button type="button" data-action="close-annotations">关闭</button>
      </div>
      <div class="lwr-annotation-list">${rows || '<div class="lwr-empty">尚未创建批注</div>'}</div>
    `;

    ui.annotationPanel.onclick = onAnnotationPanelClick;
    ui.annotationPanel.ondragstart = onAnnotationDragStart;
    ui.annotationPanel.ondragover = onAnnotationDragOver;
    ui.annotationPanel.ondrop = onAnnotationDrop;
    ui.annotationPanel.ondragend = onAnnotationDragEnd;
  }

  function onAnnotationPanelClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const button = event.target.closest("button");
    if (!button) {
      return;
    }
    const action = button.getAttribute("data-action");
    if (action === "close-annotations") {
      closeAnnotationPanel();
      return;
    }
    if (action === "edit-annotation") {
      const row = button.closest(".lwr-annotation-row");
      const annotation = row ? state.annotations.find((item) => item.id === row.getAttribute("data-annotation-id")) : null;
      if (annotation) {
        openAnnotationEditorFromRecord(annotation);
      }
      return;
    }
    if (action === "delete-annotation") {
      const row = button.closest(".lwr-annotation-row");
      const id = row ? row.getAttribute("data-annotation-id") : "";
      if (id) {
        deleteAnnotation(id).catch((error) => showRecorderError("删除批注失败", error));
      }
    }
  }

  function onAnnotationDragStart(event) {
    const row = event.target.closest(".lwr-annotation-row");
    if (!row) {
      return;
    }
    state.annotationDragId = row.getAttribute("data-annotation-id");
    row.setAttribute("data-dragging", "true");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", state.annotationDragId);
  }

  function onAnnotationDragOver(event) {
    const row = event.target.closest(".lwr-annotation-row");
    if (!row || !state.annotationDragId || row.getAttribute("data-annotation-id") === state.annotationDragId) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const list = row.parentElement;
    const dragging = list.querySelector(`[data-annotation-id="${cssString(state.annotationDragId)}"]`);
    if (!dragging) {
      return;
    }
    const rect = row.getBoundingClientRect();
    if (event.clientY < rect.top + rect.height / 2) {
      list.insertBefore(dragging, row);
    } else {
      list.insertBefore(dragging, row.nextSibling);
    }
    renumberAnnotationPanelRows();
  }

  function onAnnotationDrop(event) {
    if (!state.annotationDragId || !ui.annotationPanel) {
      return;
    }
    event.preventDefault();
    const orderedIds = Array.from(ui.annotationPanel.querySelectorAll(".lwr-annotation-row")).map((row) =>
      row.getAttribute("data-annotation-id")
    );
    renumberAnnotationPanelRows();
    applyLocalAnnotationOrder(orderedIds);
    renderMarkers();
    updateToolbar();
    reorderAnnotations(orderedIds)
      .catch((error) => showRecorderError("批注重排失败", error))
      .finally(() => {
        state.annotationDragId = null;
      });
  }

  function onAnnotationDragEnd() {
    state.annotationDragId = null;
    if (ui.annotationPanel) {
      ui.annotationPanel.querySelectorAll("[data-dragging='true']").forEach((row) => row.removeAttribute("data-dragging"));
    }
  }

  async function reorderAnnotations(orderedIds) {
    const response = await storeMessage("LWR_STORE_REORDER", { orderedIds });
    state.annotations = Array.isArray(response.annotations) ? response.annotations : [];
    state.pageAnnotations = state.annotations.filter((annotation) => annotation.pageUrl === state.pageKey);
    renderMarkers();
    renderAnnotationPanel();
    updateToolbar();
  }

  function renumberAnnotationPanelRows() {
    if (!ui.annotationPanel) {
      return;
    }
    Array.from(ui.annotationPanel.querySelectorAll(".lwr-annotation-row")).forEach((row, index) => {
      const sequence = row.querySelector(".lwr-annotation-sequence");
      if (sequence) {
        sequence.textContent = String(index + 1);
      }
    });
  }

  function applyLocalAnnotationOrder(orderedIds) {
    const byId = new Map(state.annotations.map((annotation) => [annotation.id, annotation]));
    const ordered = [];
    orderedIds.forEach((id) => {
      if (byId.has(id)) {
        ordered.push(byId.get(id));
        byId.delete(id);
      }
    });
    ordered.push(...Array.from(byId.values()));
    state.annotations = ordered;
    state.pageAnnotations = state.annotations.filter((annotation) => annotation.pageUrl === state.pageKey);
  }

  function openAnnotationEditorFromRecord(annotation) {
    const selection = viewportSelectionFromAnnotation(annotation) || annotation.selection || { x: 24, y: 96, width: 1, height: 1 };
    openAnnotationInput(
      {
        editId: annotation.id,
        type: annotation.type,
        selector: annotation.selector || "",
        selection,
        documentSelection: annotation.documentSelection || selectionToDocument(selection),
        outerHTML: annotation.outerHTML || "",
        parentOuterHTML: annotation.parentOuterHTML || "",
        grandparentOuterHTML: annotation.grandparentOuterHTML || "",
        mouse: {
          x: Math.max(12, Math.min(window.innerWidth - 24, selection.x || 24)),
          y: Math.max(12, Math.min(window.innerHeight - 24, selection.y || 96))
        }
      },
      annotation.annotationText || ""
    );
  }

  function openFieldManager() {
    if (ui.fieldPanel) {
      closeFieldPanel();
      return;
    }
    closeAnnotationPanel();
    const panel = document.createElement("div");
    panel.id = "lwr-field-panel";
    panel.setAttribute(ROOT_ATTR, "true");
    ui.root.append(panel);
    ui.fieldPanel = panel;
    renderFieldPanel();
    positionFieldPanelNearToolbar();
    updateToolbar();
  }

  function renderFieldPanel() {
    if (!ui.fieldPanel) {
      return;
    }
    const rows = state.fields
      .map(
        (field) => `
          <div class="lwr-field-row" data-field-id="${escapeAttribute(field.id)}">
            <input data-role="name" value="${escapeAttribute(field.name)}" placeholder="字段名" />
            <input data-role="description" value="${escapeAttribute(field.description || "")}" placeholder="字段说明" />
            <button type="button" data-action="delete-field" data-danger="true">删除</button>
          </div>`
      )
      .join("");

    ui.fieldPanel.innerHTML = `
      <div class="lwr-field-panel-head">
        <strong>字段配置</strong>
        <span class="lwr-field-panel-actions">
          <button type="button" data-action="export-fields">导出字段 JSON</button>
          <button type="button" data-action="import-fields">导入字段 JSON</button>
          <button type="button" data-action="close-fields">关闭</button>
        </span>
      </div>
      <div class="lwr-field-new">
        <input data-role="new-name" placeholder="新增字段名" />
        <input data-role="new-description" placeholder="字段说明" />
        <button type="button" data-action="add-field">新增字段</button>
      </div>
      <div class="lwr-field-list">${rows || '<div class="lwr-empty">尚未定义字段</div>'}</div>
    `;

    ui.fieldPanel.onclick = onFieldPanelClick;
    ui.fieldPanel.oninput = onFieldPanelInput;
    ui.fieldPanel.onkeydown = onFieldPanelKeydown;
    ui.fieldPanel.onfocusout = onFieldPanelFocusOut;
  }

  function onFieldPanelClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const button = event.target.closest("button");
    if (!button) {
      return;
    }
    const action = button.getAttribute("data-action");
    if (action === "close-fields") {
      closeFieldPanel();
    } else if (action === "add-field") {
      const nameInput = ui.fieldPanel.querySelector('[data-role="new-name"]');
      const descriptionInput = ui.fieldPanel.querySelector('[data-role="new-description"]');
      upsertField({ name: nameInput.value, description: descriptionInput.value })
        .then(() => renderFieldPanel())
        .catch((error) => showRecorderError("保存字段失败", error));
    } else if (action === "delete-field") {
      const row = button.closest(".lwr-field-row");
      deleteFieldDefinition(row.getAttribute("data-field-id")).catch((error) => showRecorderError("删除字段失败", error));
    } else if (action === "export-fields") {
      exportFieldDefinitions().catch((error) => showRecorderError("导出字段失败", error));
    } else if (action === "import-fields") {
      openFieldImportPicker();
    }
  }

  function onFieldPanelInput(event) {
    const row = event.target.closest(".lwr-field-row");
    if (!row || !event.target.matches("input")) {
      return;
    }
    queueFieldAutoSave(row);
  }

  function onFieldPanelKeydown(event) {
    if (event.key !== "Enter" || !event.target.matches("input")) {
      return;
    }
    event.preventDefault();
    event.target.blur();
    const row = event.target.closest(".lwr-field-row");
    if (row) {
      saveFieldRow(row).catch((error) => showRecorderError("自动保存字段失败", error));
    }
  }

  function onFieldPanelFocusOut(event) {
    const row = event.target.closest(".lwr-field-row");
    if (!row || !event.target.matches("input")) {
      return;
    }
    window.clearTimeout(row.__lwrSaveTimer);
    saveFieldRow(row).catch((error) => showRecorderError("自动保存字段失败", error));
  }

  function queueFieldAutoSave(row) {
    window.clearTimeout(row.__lwrSaveTimer);
    row.__lwrSaveTimer = window.setTimeout(() => {
      saveFieldRow(row).catch((error) => showRecorderError("自动保存字段失败", error));
    }, 500);
  }

  async function saveFieldRow(row) {
    if (!row || row.__lwrSaving) {
      return;
    }
    const field = readFieldRow(row);
    if (!field.name.trim()) {
      return;
    }
    row.__lwrSaving = true;
    row.setAttribute("data-saving", "true");
    try {
      await upsertField(field);
      row.setAttribute("data-saving", "false");
    } finally {
      row.__lwrSaving = false;
    }
  }

  function readFieldRow(row) {
    return {
      id: row.getAttribute("data-field-id"),
      name: row.querySelector('[data-role="name"]').value,
      description: row.querySelector('[data-role="description"]').value
    };
  }

  async function exportFieldDefinitions() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      fields: state.fields.map((field) => ({
        id: field.id,
        name: field.name,
        description: field.description || ""
      }))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    await downloadBlob(blob, `captura-field-definitions-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  }

  function openFieldImportPicker() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.setAttribute(ROOT_ATTR, "true");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "-9999px";
    input.style.width = "1px";
    input.style.height = "1px";
    input.style.opacity = "0";
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      input.remove();
      importFieldFile(file);
    });
    document.documentElement.append(input);
    input.click();
  }

  function importFieldFile(file) {
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || "{}"));
        const fields = Array.isArray(parsed) ? parsed : parsed.fields;
        importFieldDefinitions(fields).catch((error) => showRecorderError("导入字段失败", error));
      } catch (error) {
        showRecorderError("导入字段失败", error);
      }
    };
    reader.readAsText(file);
  }

  function openZipImportPicker() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/zip,.zip";
    input.setAttribute(ROOT_ATTR, "true");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "-9999px";
    input.style.width = "1px";
    input.style.height = "1px";
    input.style.opacity = "0";
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      input.remove();
      importRecorderZip(file).catch((error) => showRecorderError("导入 ZIP 失败", error));
    });
    document.documentElement.append(input);
    input.click();
  }

  async function importRecorderZip(file) {
    if (!file) {
      return;
    }
    const zipBytes = new Uint8Array(await file.arrayBuffer());
    const entries = readZipEntries(zipBytes);
    const recorderState = buildRecorderStateFromZipEntries(entries);
    const response = await storeMessage("LWR_STORE_IMPORT_STATE", { state: recorderState });
    state.annotations = Array.isArray(response.annotations) ? response.annotations : [];
    state.fields = Array.isArray(response.fields) ? response.fields : [];
    state.pageKey = location.href;
    state.pageAnnotations = state.annotations.filter((annotation) => annotation.pageUrl === state.pageKey);
    state.draft = null;
    closePopover();
    closeFieldPanel();
    closeAnnotationPanel();
    renderMarkers();
    updateToolbar();
    showInlineNotice(`已导入 ${state.annotations.length} 个 Annotation，可从当前状态继续批注。`);
  }

  function setAnnotationMode(enabled) {
    state.annotationMode = enabled;
    if (enabled) {
      state.toolbarExpanded = true;
    }
    if (!enabled) {
      state.dragging = null;
      hideHoverBox();
      hideRegionBox();
      closePopover();
      closeFieldPanel();
      closeAnnotationPanel();
    }
    broadcastStaticAnnotationMode(enabled);
    updateToolbar();
  }

  function toggleToolbarExpanded() {
    if (state.dynamic.enabled) {
      state.toolbarExpanded = false;
      stopDynamicRecording("toolbar-close").catch((error) => showRecorderError("停止动态录入失败", error));
      return;
    }
    if (state.toolbarExpanded || state.annotationMode) {
      state.toolbarExpanded = false;
      setAnnotationMode(false);
      return;
    }
    setAnnotationMode(true);
  }

  function updateToolbar() {
    if (!isTopDocument || !ui.toolbar) {
      return;
    }
    updateToolbarDockAttribute();
    const launcher = ui.toolbar.querySelector('[data-action="launcher"]');
    const exportButton = ui.toolbar.querySelector('[data-action="export"]');
    const count = ui.toolbar.querySelector(".lwr-count");
    const dynamicButton = ui.toolbar.querySelector('[data-action="dynamic-record"]');
    const annotationBadge = ui.toolbar.querySelector('[data-role="annotation-count"]');
    const toolbarMain = ui.toolbar.querySelector(".lwr-toolbar-main");
    const dynamicPanel = ui.toolbar.querySelector(".lwr-dynamic-panel");
    const dynamicNodes = ui.toolbar.querySelector(".lwr-dynamic-nodes");
    const dynamicElapsed = ui.toolbar.querySelector(".lwr-dynamic-elapsed");
    const expanded = !state.toolbarDragCollapsed && (state.toolbarExpanded || state.annotationMode || state.dynamic.enabled);
    ui.toolbar.setAttribute("data-expanded", expanded ? "true" : "false");
    ui.toolbar.setAttribute("data-recording", state.annotationMode ? "true" : "false");
    ui.toolbar.setAttribute("data-dynamic-recording", state.dynamic.enabled ? "true" : "false");
    ui.eventShield.setAttribute("data-active", state.annotationMode ? "true" : "false");
    if (toolbarMain) {
      toolbarMain.hidden = state.dynamic.enabled;
    }
    if (dynamicPanel) {
      dynamicPanel.hidden = !state.dynamic.enabled;
    }
    launcher.hidden = state.dynamic.enabled;
    launcher.innerHTML = recorderMarkHtml();
    launcher.title = state.dynamic.enabled ? "停止动态录入并收回工具条" : expanded ? "收回工具条" : "开始静态标注";
    if (dynamicButton) {
      dynamicButton.setAttribute("data-active", state.dynamic.enabled ? "true" : "false");
      dynamicButton.title = state.dynamic.enabled ? "停止动态录入" : "开始动态录入";
    }
    if (exportButton) {
      exportButton.title = "复制全部 Annotation 的详细文本";
    }
    if (annotationBadge) {
      const annotationCount = state.annotations.length;
      annotationBadge.hidden = annotationCount === 0;
      annotationBadge.textContent = annotationCount > 99 ? "99+" : String(annotationCount);
    }
    const dynamicCount = state.dynamic.rawBusPackageCount || 0;
    if (dynamicNodes) {
      dynamicNodes.textContent = `N${dynamicCount}`;
    }
    if (dynamicElapsed) {
      dynamicElapsed.textContent = formatDynamicElapsed();
    }
    if (count) {
      count.textContent = `${state.pageAnnotations.length} current / ${state.annotations.length} total · dynamic ${dynamicCount}`;
    }
    keepToolbarWithinViewport();
    renderMarkers();
  }

  function formatDynamicElapsed() {
    const start = state.dynamic.startedAt ? new Date(state.dynamic.startedAt).getTime() : Date.now();
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = elapsedSeconds % 60;
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  }

  function closePopover(options = {}) {
    if (ui.editorFocusTimer) {
      window.clearInterval(ui.editorFocusTimer);
      ui.editorFocusTimer = null;
    }
    if (ui.popover) {
      ui.popover.remove();
      ui.popover = null;
    }
    ui.activeEditor = null;
    hideHoverBox();
    setStaticFrameAnnotationLock(false);
    if (!options.preserveFrameAgent) {
      clearStaticActiveFrameAgent();
    }
  }

  function closeFieldPanel() {
    if (ui.fieldPanel) {
      ui.fieldPanel.remove();
      ui.fieldPanel = null;
    }
    updateToolbar();
  }

  function closeAnnotationPanel() {
    if (ui.annotationPanel) {
      ui.annotationPanel.remove();
      ui.annotationPanel = null;
    }
    state.annotationDragId = null;
    updateToolbar();
  }

  function showRecorderError(title, error) {
    const message = error && error.message ? error.message : String(error || "未知错误");
    if (isExtensionInvalidatedError(message)) {
      showInlineNotice("扩展上下文已失效，请刷新当前业务页面后重试。");
      return;
    }
    showInlineNotice(`${title}：${message}`);
  }

  function showInlineNotice(message) {
    if (!isTopDocument || !ui.root) {
      return;
    }
    const oldNotice = ui.root.querySelector(".lwr-notice");
    if (oldNotice) {
      oldNotice.remove();
    }
    const notice = document.createElement("div");
    notice.className = "lwr-notice";
    notice.textContent = message;
    ui.root.append(notice);
    positionNoticeNearToolbar(notice);
    window.setTimeout(() => {
      notice.remove();
    }, 6000);
  }

  function positionNoticeNearToolbar(notice) {
    const toolbarRect = ui.toolbar.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 36);
    const left = Math.max(18, Math.min(window.innerWidth - width - 18, toolbarRect.right - width));
    const top = Math.max(18, Math.min(window.innerHeight - 72, toolbarRect.bottom + 10));
    notice.style.left = `${left}px`;
    notice.style.top = `${top}px`;
    notice.style.width = `${width}px`;
  }

  function isExtensionInvalidatedError(message) {
    return /Extension context invalidated|context invalidated|chrome-extension:\/\/invalid/i.test(String(message || ""));
  }

  function suppressInvalidatedExtensionAlert(event) {
    const reason = event.reason || event.error || event.message || "";
    const message = reason && reason.message ? reason.message : String(reason);
    if (!isExtensionInvalidatedError(message)) {
      return;
    }
    event.preventDefault();
    showInlineNotice("扩展上下文已失效，请刷新当前业务页面后重试。");
  }

  function positionFieldPanelNearToolbar() {
    if (!ui.fieldPanel) {
      return;
    }
    positionPanelNearToolbar(ui.fieldPanel, 560);
  }

  function repositionOpenToolbarPanels() {
    positionFieldPanelNearToolbar();
    if (ui.annotationPanel) {
      positionPanelNearToolbar(ui.annotationPanel, 560);
    }
  }

  function positionPanelNearToolbar(panel, preferredWidth) {
    const toolbarRect = ui.toolbar.getBoundingClientRect();
    const panelWidth = Math.min(preferredWidth, window.innerWidth - 36);
    const panelHeight = Math.min(panel.scrollHeight || panel.offsetHeight || 360, window.innerHeight - 36);
    const preferredLeft = state.toolbarDock === "left" ? toolbarRect.left : toolbarRect.right - panelWidth;
    const left = Math.max(18, Math.min(window.innerWidth - panelWidth - 18, preferredLeft));
    const spaceBelow = window.innerHeight - toolbarRect.bottom - 18;
    const spaceAbove = toolbarRect.top - 18;
    const shouldOpenAbove = spaceBelow < Math.min(panelHeight, 260) && spaceAbove > spaceBelow;
    const preferredTop = shouldOpenAbove ? toolbarRect.top - panelHeight - 10 : toolbarRect.bottom + 10;
    const top = Math.max(18, Math.min(window.innerHeight - panelHeight - 18, preferredTop));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = "auto";
  }

  function createPopoverFrame(x, y) {
    const margin = STATIC_POPOVER_FRAME_VIEWPORT_MARGIN;
    const width = Math.min(STATIC_POPOVER_FRAME_WIDTH, Math.max(STATIC_POPOVER_FRAME_MIN_WIDTH, window.innerWidth - margin * 2));
    const height = Math.min(STATIC_POPOVER_FRAME_HEIGHT, Math.max(STATIC_POPOVER_FRAME_MIN_HEIGHT, window.innerHeight - margin * 2));
    const left = Math.min(window.innerWidth - width - margin, Math.max(margin, x + margin));
    const top = Math.min(window.innerHeight - height - margin, Math.max(margin, y + margin));
    const frame = document.createElement("iframe");
    frame.id = "lwr-popover-frame";
    frame.setAttribute(ROOT_ATTR, "true");
    frame.setAttribute(RECORDER_FRAME_ATTR, "true");
    frame.setAttribute("title", "Captura Annotation Editor");
    frame.setAttribute("tabindex", "-1");
    frame.src = "about:blank";
    Object.assign(frame.style, {
      all: "initial",
      position: "fixed",
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
      zIndex: "2147483647",
      border: "0",
      margin: "0",
      padding: "0",
      background: "transparent",
      colorScheme: "normal",
      pointerEvents: "auto"
    });
    document.documentElement.append(frame);

    const frameDocument = frame.contentDocument;
    frameDocument.open();
    frameDocument.write(
      [
        "<!doctype html>",
        '<html lang="zh-CN">',
        "<head>",
        '<meta charset="utf-8">',
        `<link rel="stylesheet" href="${chrome.runtime.getURL("content/recorder.css")}">`,
        "<style>",
        "html,body{margin:0;padding:0;width:100%;height:100%;overflow:auto;background:transparent;}",
        "body{font-family:ui-sans-serif,'Segoe UI Variable','Segoe UI','Microsoft YaHei',sans-serif;}",
        "</style>",
        "</head>",
        "<body></body>",
        "</html>"
      ].join("")
    );
    frameDocument.close();
    return frame;
  }

  async function exportZip() {
    const exportStore = await loadFullAnnotationStore();
    const annotations = exportStore.annotations;
    const fields = exportStore.fields;
    if (annotations.length === 0) {
      showInlineNotice("没有可导出的 Annotation。");
      return;
    }
    const filename = `captura-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;

    const files = [];
    addStaticExportFiles(files, annotations, fields);

    const zipBlob = createZip(files);
    await downloadBlob(zipBlob, filename, { saveAs: true });
  }

  async function copyDetailedAnnotationsText() {
    const exportStore = await loadFullAnnotationStore();
    const annotations = exportStore.annotations;
    const fields = exportStore.fields;
    if (annotations.length === 0) {
      showInlineNotice("没有可复制的 Annotation。");
      return;
    }
    await writeClipboardText(buildDetailedAnnotationsText(annotations, fields));
    showInlineNotice(`已复制 ${annotations.length} 个 Annotation 的详细文本。`);
  }

  function annotationSequence(annotation) {
    const index = state.annotations.findIndex((item) => item.id === annotation.id);
    return index >= 0 ? index + 1 : "";
  }

  function exportAnnotationId(index) {
    return `Annotation${index + 1}`;
  }

  function stripRuntimeSequence(annotation) {
    const { sequence, ...rest } = annotation || {};
    return rest;
  }

  function buildRecorderStateExport(annotations = state.annotations, fields = state.fields) {
    return {
      schema: "captura.static-state",
      version: 1,
      exportedAt: new Date().toISOString(),
      source: {
        pageUrl: location.href,
        pageTitle: document.title
      },
      fields,
      annotations: annotations.map(stripRuntimeSequence)
    };
  }

  function buildMeta(annotation, id, sequence, screenshotPath, domPath, fields = state.fields) {
    const fieldReferences = extractFieldReferences(annotation.annotationText || "", fields);
    return {
      id,
      sequence,
      type: annotation.type,
      annotationText: annotation.annotationText,
      fieldReferences,
      selector: annotation.selector,
      screenshotPath,
      domPath,
      pageUrl: annotation.pageUrl,
      pageTitle: annotation.pageTitle,
      createdAt: annotation.createdAt,
      updatedAt: annotation.updatedAt,
      viewport: annotation.viewport,
      selection: annotation.selection,
      documentSelection: annotation.documentSelection,
      outerHTML: annotation.outerHTML,
      parentOuterHTML: annotation.parentOuterHTML,
      grandparentOuterHTML: annotation.grandparentOuterHTML,
      frameContext: annotation.frameContext || null
    };
  }
