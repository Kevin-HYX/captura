// Dynamic target snapshots, frame deltas, object candidates, and transition value classification.
  async function captureDynamicScreenshot() {
    const restoreRecorderUi = hideRecorderUiForCapture();
    try {
      await waitFrames(2);
      const response = await chrome.runtime.sendMessage({ type: "LWR_CAPTURE_VISIBLE_TAB" });
      return response && response.ok ? response.dataUrl || "" : "";
    } catch {
      return "";
    } finally {
      restoreRecorderUi();
    }
  }

  function buildDynamicPageContext() {
    return {
      url: location.href,
      title: document.title,
      visibleTextSummary: summarizeVisibleText(document.body, 8)
    };
  }

  function sanitizeDynamicDomPayloadText(value, options = {}) {
    const text = String(value || "");
    if (!text) {
      return "";
    }
    if (options.css || looksLikeDynamicCssPayload(text)) {
      return DYNAMIC_DOM_PAYLOAD_CSS_REPLACEMENT;
    }
    return replaceDynamicDomPayloadInlineResources(text);
  }

  function sanitizeDynamicDomPayloadTextList(values) {
    if (!Array.isArray(values)) {
      return [];
    }
    return values
      .map((value) => sanitizeDynamicDomPayloadText(value))
      .filter(Boolean);
  }

  function sanitizeDynamicDomPayloadHtml(value) {
    const text = String(value || "");
    if (!text) {
      return "";
    }
    return replaceDynamicDomPayloadInlineResources(text)
      .replace(DYNAMIC_DOM_PAYLOAD_STYLE_TAG_RE, DYNAMIC_DOM_PAYLOAD_CSS_REPLACEMENT)
      .replace(DYNAMIC_DOM_PAYLOAD_INLINE_STYLE_RE, "");
  }

  function replaceDynamicDomPayloadInlineResources(value) {
    return String(value || "")
      .replace(DYNAMIC_DOM_PAYLOAD_DATA_IMAGE_RE, DYNAMIC_DOM_PAYLOAD_DATA_IMAGE_REPLACEMENT)
      .replace(DYNAMIC_DOM_PAYLOAD_DATA_RESOURCE_RE, DYNAMIC_DOM_PAYLOAD_DATA_RESOURCE_REPLACEMENT);
  }

  function looksLikeDynamicCssPayload(value) {
    const text = String(value || "").trim();
    return Boolean(text && DYNAMIC_DOM_PAYLOAD_CSS_BLOCK_RE.test(text) && DYNAMIC_DOM_PAYLOAD_CSS_PROPERTY_RE.test(text));
  }

  function isDynamicCssCarrierNode(node) {
    const element = normalizeEventTarget(node);
    const tag = element && element.tagName ? element.tagName.toLowerCase() : "";
    return tag === "style" || tag === "script";
  }

  function buildDynamicTargetSnapshot(element) {
    const normalized = normalizeEventTarget(element) || document.body;
    const rect = normalized.getBoundingClientRect ? normalized.getBoundingClientRect() : null;
    const objectCandidates = detectObjectCandidates(normalized);
    const primary = objectCandidates[0] || {
      kind: "field-like",
      matchedSignals: ["event-target"],
      missingSignals: ["semantic-role", "recognized-tag"]
    };
    const identity = {
      role: normalized.getAttribute ? normalized.getAttribute("role") || inferElementRole(normalized) : "",
      text: getOwnText(normalized, 80),
      label: getElementLabel(normalized),
      name: normalized.getAttribute ? normalized.getAttribute("name") || "" : "",
      locatorHint: buildLocatorHint(normalized)
    };
    return {
      state: {
        visible: isElementVisible(normalized),
        enabled: isElementEnabled(normalized),
        editable: isEditableElement(normalized)
      },
      identity,
      html: sanitizeDynamicDomPayloadHtml(getOuterHtmlWithoutRecorder(normalized)),
      contextHtml: buildDynamicContextHtml(normalized),
      primaryKind: primary.kind,
      matchedSignals: primary.matchedSignals || [],
      missingSignals: primary.missingSignals || [],
      objectCandidates,
      appendix: {
        targetGeometry: rect
          ? {
              rect: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              },
              viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
                devicePixelRatio: window.devicePixelRatio || 1
              },
              scroll: {
                x: Math.round(window.scrollX),
                y: Math.round(window.scrollY)
              }
            }
          : null,
        locatorCandidates: buildLocatorCandidates(normalized),
        nearbyTextAll: collectNearbyText(normalized, 12),
        ancestorChainSummary: buildAncestorChainSummary(normalized)
      }
    };
  }

  function buildDynamicTargetReference(element, snapshot = null) {
    const normalized = normalizeEventTarget(element) || document.body;
    const resolved = snapshot || buildDynamicTargetSnapshot(normalized);
    return {
      kind: resolved.primaryKind,
      selector: buildElementPath(normalized),
      identity: resolved.identity,
      state: resolved.state,
      matchedSignals: resolved.matchedSignals || [],
      missingSignals: resolved.missingSignals || [],
      objectCandidates: resolved.objectCandidates || []
    };
  }

  function canonicalActionTarget(target) {
    const rawElement = normalizeEventTarget(target) || document.body;
    const candidates = [];
    let current = rawElement;
    let distance = 0;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement && distance < 8) {
      if (!isRecorderNode(current)) {
        const score = scoreDynamicActionableElement(current, rawElement, distance);
        if (score.value > 0) {
          candidates.push({
            element: current,
            score: score.value,
            distance,
            matchedSignals: score.matchedSignals,
            suppressedSignals: score.suppressedSignals
          });
        }
      }
      current = current.parentElement;
      distance += 1;
    }
    candidates.sort((left, right) => right.score - left.score || left.distance - right.distance);
    const best = candidates[0] || {
      element: rawElement,
      score: 0,
      distance: 0,
      matchedSignals: ["raw-event-target"],
      suppressedSignals: []
    };
    const rawSelector = buildElementPath(rawElement);
    const canonicalSelector = buildElementPath(best.element);
    const matchedSignals = best.matchedSignals.slice();
    const suppressedSignals = best.suppressedSignals.slice();
    if (best.element !== rawElement) {
      matchedSignals.push("canonical-target-promoted-from-descendant");
      if (isIconLikeElement(rawElement)) suppressedSignals.push("raw-target-icon-like");
      if (isFrameworkTransientElement(rawElement)) suppressedSignals.push("raw-target-framework-transient-like");
    }
    return {
      rawElement,
      canonicalElement: best.element,
      rawSelector,
      canonicalSelector,
      matchedSignals: uniqueStrings(matchedSignals),
      suppressedSignals: uniqueStrings(suppressedSignals)
    };
  }

  function scoreDynamicActionableElement(element, rawElement, distance) {
    const matchedSignals = [];
    const suppressedSignals = [];
    if (!element || !element.tagName) {
      return { value: 0, matchedSignals, suppressedSignals };
    }
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute("role") || "";
    const type = String(element.getAttribute("type") || "").toLowerCase();
    const className = getElementClassText(element);
    let score = 0;
    if (tag === "input" || tag === "select" || tag === "textarea" || element.isContentEditable) {
      score = Math.max(score, 100);
      matchedSignals.push("native-editable-control");
    }
    if (tag === "button" || (tag === "input" && ["button", "submit", "reset"].includes(type))) {
      score = Math.max(score, 96);
      matchedSignals.push("native-button-control");
    }
    if (tag === "a" && element.getAttribute("href")) {
      score = Math.max(score, 92);
      matchedSignals.push("native-link-control");
    }
    if (DYNAMIC_ACTIONABLE_ROLES.has(role)) {
      score = Math.max(score, role === "combobox" || role === "listbox" ? 88 : 90);
      matchedSignals.push(`aria-role=${role}`);
    }
    if (tag === "label") {
      score = Math.max(score, 78);
      matchedSignals.push("label-control-wrapper");
    }
    if (element.hasAttribute("tabindex") && Number(element.getAttribute("tabindex")) >= 0) {
      score = Math.max(score, 68);
      matchedSignals.push("focusable-tabindex");
    }
    if (element.hasAttribute("onclick")) {
      score = Math.max(score, 66);
      matchedSignals.push("onclick-attribute");
    }
    if (DYNAMIC_WEAK_ACTIONABLE_CLASS_RE.test(className)) {
      score = Math.max(score, 64);
      matchedSignals.push("weak-framework-actionable-class");
    }
    if (hasPointerCursor(element)) {
      score = Math.max(score, 62);
      matchedSignals.push("pointer-cursor");
    }
    if (isFrameworkTransientElement(element)) {
      score = Math.max(0, score - 30);
      suppressedSignals.push("framework-transient-node");
    }
    if (isIconLikeElement(element) && element !== rawElement) {
      score = Math.max(0, score - 20);
      suppressedSignals.push("icon-like-node");
    }
    return {
      value: score > 0 ? score - distance : 0,
      matchedSignals,
      suppressedSignals
    };
  }

  function hasPointerCursor(element) {
    try {
      return window.getComputedStyle(element).cursor === "pointer";
    } catch {
      return false;
    }
  }

  function getElementClassText(element) {
    if (!element) return "";
    if (element.getAttribute) {
      return element.getAttribute("class") || "";
    }
    const className = element.className;
    if (typeof className === "string") return className;
    return className && typeof className.baseVal === "string" ? className.baseVal : "";
  }

  function isIconLikeElement(element) {
    if (!element || !element.tagName) return false;
    const tag = element.tagName.toLowerCase();
    const className = getElementClassText(element);
    return tag === "svg" || tag === "path" || tag === "use" || tag === "i" || /\b(icon|svg)\b/i.test(className) || Boolean(element.getAttribute && element.getAttribute("aria-label") && !getOwnText(element, 20));
  }

  function isFrameworkTransientElement(element) {
    if (!element || !element.tagName) return false;
    const className = getElementClassText(element);
    return DYNAMIC_LOW_VALUE_SELECTOR_RE.test(className);
  }

  function shouldSkipDynamicMutation(mutation) {
    if (state.settings.includeStyleChanges || !mutation) {
      return false;
    }
    if (isRecorderOnlyMutation(mutation)) {
      return true;
    }
    if (mutation.type === "attributes") {
      return mutation.attributeName === DYNAMIC_STYLE_ATTRIBUTE_NAME;
    }
    if (mutation.type === "characterData") {
      return isDynamicCssCarrierNode(mutation.target);
    }
    if (mutation.type === "childList") {
      return isStyleOnlyChildListMutation(mutation);
    }
    return false;
  }

  function isRecorderOnlyMutation(mutation) {
    if (!mutation) {
      return false;
    }
    if (isRecorderNode(mutation.target)) {
      return true;
    }
    if (mutation.type !== "childList") {
      return false;
    }
    const nodes = [
      ...Array.from(mutation.addedNodes || []),
      ...Array.from(mutation.removedNodes || [])
    ];
    return Boolean(nodes.length && nodes.every(isRecorderMutationNode));
  }

  function isRecorderMutationNode(node) {
    if (!node) {
      return false;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      return isRecorderNode(node.parentElement);
    }
    return node.nodeType === Node.ELEMENT_NODE && isRecorderNode(node);
  }

  function isStyleOnlyChildListMutation(mutation) {
    const nodes = [
      ...Array.from(mutation.addedNodes || []),
      ...Array.from(mutation.removedNodes || [])
    ];
    return Boolean(nodes.length && nodes.every(isDynamicCssCarrierMutationNode));
  }

  function isDynamicCssCarrierMutationNode(node) {
    if (!node) {
      return false;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      return isDynamicCssCarrierNode(node.parentElement);
    }
    return isDynamicCssCarrierNode(node);
  }

  function buildMutationFact(mutation) {
    const target = normalizeEventTarget(mutation.target);
    if (!target || isRecorderNode(target)) {
      return null;
    }
    const fact = {
      t: getDynamicOffsetMs(),
      type: mutation.type,
      target: buildElementPath(target),
      attributeName: mutation.attributeName || "",
      oldValue: "",
      newValue: "",
      addedText: [],
      removedText: []
    };
    if (mutation.type === "attributes" && mutation.attributeName) {
      const isStyleAttribute = mutation.attributeName === "style";
      fact.oldValue = sanitizeDynamicDomPayloadText(mutation.oldValue || "", { css: isStyleAttribute });
      fact.newValue = sanitizeDynamicDomPayloadText(target.getAttribute(mutation.attributeName) || "", { css: isStyleAttribute });
    }
    if (mutation.type === "characterData") {
      fact.oldValue = sanitizeDynamicDomPayloadText(mutation.oldValue || "", { css: isDynamicCssCarrierNode(mutation.target) });
      fact.newValue = sanitizeDynamicDomPayloadText(String(mutation.target.textContent || "").trim().slice(0, 160), { css: isDynamicCssCarrierNode(mutation.target) });
    }
    if (mutation.type === "childList") {
      fact.addedText = sanitizeDynamicDomPayloadTextList(summarizeNodeListText(mutation.addedNodes, 5));
      fact.removedText = sanitizeDynamicDomPayloadTextList(summarizeNodeListText(mutation.removedNodes, 5));
    }
    return fact;
  }

  function createDynamicTransitionNode({ reason, previousSnapshot, currentSnapshot, mutations, deltaOverride }) {
    const identity = createDynamicNodeIdentity("transition");
    const delta = {
      ...buildDynamicFrameDelta(previousSnapshot, currentSnapshot, mutations),
      ...(deltaOverride || {})
    };
    const changedRegions = buildChangedRegions(mutations, delta);
    const changedObjects = detectTransitionObjects(delta, changedRegions);
    const frameValue = classifyDynamicTransitionValue(reason, delta, changedObjects, changedRegions, mutations);
    const summaryBudgetUsed = buildTransitionSummaryBudget(delta);
    const node = {
      id: identity.id,
      folder: identity.folder,
      nodeUid: identity.nodeUid,
      originalNodeId: identity.id,
      localNodeId: identity.id,
      agentInstanceId: identity.agentInstanceId,
      documentLifecycleId: identity.documentLifecycleId,
      nodeType: "transition",
      type: "transition",
      sequence: identity.sequence,
      offsetMs: currentSnapshot.offsetMs,
      sampledAt: new Date().toISOString(),
      reason,
      pageUrl: currentSnapshot.url,
      pageTitle: currentSnapshot.title,
      previousNodeId: getLastDynamicNodeId(),
      noChangeFrameCountBefore: state.dynamic.noChangeFrameCount || 0,
      summaryPriority: frameValue.summaryPriority,
      changeSignals: frameValue.changeSignals,
      suppressedSignals: frameValue.suppressedSignals,
      reasonCodes: frameValue.reasonCodes,
      summaryBudgetUsed,
      lowValueReason: frameValue.lowValueReason,
      deltaSummary: buildDeltaSummary(delta, changedObjects, changedRegions),
      changedObjects,
      changedRegions,
      delta,
      appendix: {
        previousOffsetMs: previousSnapshot.offsetMs,
        currentOffsetMs: currentSnapshot.offsetMs,
        mutationStats: summarizeMutationStats(mutations),
        previousVisibleText: previousSnapshot.visibleText,
        currentVisibleText: currentSnapshot.visibleText,
        previousInteractive: previousSnapshot.interactive,
        currentInteractive: currentSnapshot.interactive
      },
      mutations,
      referenceRefs: [],
      screenshots: {
        currentDataUrl: ""
      },
      domFragments: {
        beforeHtml: previousSnapshot.mainHtml || "",
        afterHtml: currentSnapshot.mainHtml || ""
      }
    };
    node.referenceRefs = buildDynamicTransitionReferenceRefs(node);
    return node;
  }

  function buildChangedRegions(mutations, delta) {
    const buckets = new Map();
    mutations.forEach((mutation) => {
      const key = mutation.target || "document";
      if (!buckets.has(key)) {
        buckets.set(key, {
          regionId: `R${buckets.size + 1}`,
          selectorCandidate: key,
          changePattern: "subtree-change",
          visibleTextAdded: [],
          visibleTextRemoved: [],
          objectCandidates: [],
          appendix: {
            mutationCount: 0,
            addedNodes: 0,
            removedNodes: 0,
            textChanges: 0,
            attributeChanges: 0
          }
        });
      }
      const bucket = buckets.get(key);
      bucket.appendix.mutationCount += 1;
      if (mutation.type === "attributes") bucket.appendix.attributeChanges += 1;
      if (mutation.type === "characterData") bucket.appendix.textChanges += 1;
      if (mutation.addedText && mutation.addedText.length) {
        bucket.appendix.addedNodes += mutation.addedText.length;
        bucket.visibleTextAdded.push(...mutation.addedText);
      }
      if (mutation.removedText && mutation.removedText.length) {
        bucket.appendix.removedNodes += mutation.removedText.length;
        bucket.visibleTextRemoved.push(...mutation.removedText);
      }
    });
    const regions = Array.from(buckets.values())
      .sort((left, right) => right.appendix.mutationCount - left.appendix.mutationCount)
      .slice(0, 5)
      .map((region) => ({
        ...region,
        visibleTextAdded: uniqueStrings(region.visibleTextAdded).slice(0, 8),
        visibleTextRemoved: uniqueStrings(region.visibleTextRemoved).slice(0, 8),
        objectCandidates: detectRegionObjectCandidates(region)
      }));
    if (!regions.length && (delta.visibleTextAdded.length || delta.visibleTextRemoved.length || delta.urlChanged || delta.titleChanged)) {
      regions.push({
        regionId: "R1",
        selectorCandidate: "document",
        changePattern: delta.urlChanged ? "url-change" : "frame-text-change",
        visibleTextAdded: delta.visibleTextAdded.slice(0, 8),
        visibleTextRemoved: delta.visibleTextRemoved.slice(0, 8),
        objectCandidates: [
          {
            kind: "main-region-like",
            matchedSignals: [delta.urlChanged ? "url-change" : "visible-text-delta"],
            missingSignals: []
          }
        ],
        appendix: summarizeMutationStats(mutations)
      });
    }
    return regions;
  }

  function buildDynamicActionReferenceRefs(action) {
    const folder = action.folder;
    return [
      `${folder}/action.json`,
      `${folder}/appendix.json`,
      `${folder}/target.html`,
      `${folder}/context.html`,
      `${folder}/raw-events.ndjson`
    ];
  }

  function buildDynamicTransitionReferenceRefs(transition) {
    const folder = transition.folder;
    return [
      `${folder}/transition.json`,
      `${folder}/delta.json`,
      `${folder}/region-digest.json`,
      `${folder}/mutations.ndjson`,
      `${folder}/dom-fragment-before.html`,
      `${folder}/dom-fragment-after.html`
    ];
  }

  function countDynamicActions(nodes) {
    return nodes.filter((node) => node && node.type === "action").length;
  }

  function getDynamicOffsetMs() {
    const startedAt = state.dynamic.startedAt ? new Date(state.dynamic.startedAt).getTime() : Date.now();
    return Math.max(0, Date.now() - startedAt);
  }

  function getLastDynamicNodeId() {
    const last = state.dynamic.nodes[state.dynamic.nodes.length - 1];
    return last ? last.id : "";
  }

  function buildDynamicRawEvent(event, type, rawTarget, canonicalTarget = rawTarget) {
    return {
      t: getDynamicOffsetMs(),
      type,
      eventType: event && event.type ? event.type : type,
      key: event && event.key ? event.key : "",
      target: buildElementPath(rawTarget),
      targetText: getOwnText(rawTarget, 80),
      targetRole: rawTarget && rawTarget.getAttribute ? rawTarget.getAttribute("role") || inferElementRole(rawTarget) : "",
      canonicalTarget: buildElementPath(canonicalTarget),
      canonicalTargetText: getOwnText(canonicalTarget, 80),
      canonicalTargetRole: canonicalTarget && canonicalTarget.getAttribute ? canonicalTarget.getAttribute("role") || inferElementRole(canonicalTarget) : "",
      pageUrl: location.href,
      pageTitle: document.title
    };
  }

  function pushDynamicRawEvent(rawEvent) {
    state.dynamic.rawEvents.push(rawEvent);
    if (state.dynamic.rawEvents.length > DYNAMIC_MAX_RAW_EVENTS) {
      state.dynamic.rawEvents.shift();
    }
  }

  function buildDynamicFrameSnapshot() {
    const main = findDynamicMainRegion();
    return {
      offsetMs: getDynamicOffsetMs(),
      url: location.href,
      title: document.title,
      visibleText: summarizeVisibleText(document.body, 24),
      interactive: collectInteractiveDigest(document.body, 40),
      mainHtml: main ? sanitizeDynamicDomPayloadHtml(getOuterHtmlWithoutRecorder(main).slice(0, 20000)) : ""
    };
  }

  function buildDynamicFrameDelta(previousSnapshot, currentSnapshot, mutations) {
    const previousTexts = previousSnapshot ? previousSnapshot.visibleText || [] : [];
    const currentTexts = currentSnapshot ? currentSnapshot.visibleText || [] : [];
    const previousInteractive = previousSnapshot ? previousSnapshot.interactive || [] : [];
    const currentInteractive = currentSnapshot ? currentSnapshot.interactive || [] : [];
    return {
      urlChanged: previousSnapshot && previousSnapshot.url !== currentSnapshot.url ? { from: previousSnapshot.url, to: currentSnapshot.url } : null,
      titleChanged: previousSnapshot && previousSnapshot.title !== currentSnapshot.title ? { from: previousSnapshot.title, to: currentSnapshot.title } : null,
      visibleTextAdded: arrayDifference(currentTexts, previousTexts).slice(0, 12),
      visibleTextRemoved: arrayDifference(previousTexts, currentTexts).slice(0, 12),
      interactiveAdded: arrayDifference(currentInteractive, previousInteractive).slice(0, 12),
      interactiveRemoved: arrayDifference(previousInteractive, currentInteractive).slice(0, 12),
      mutationStats: summarizeMutationStats(mutations)
    };
  }

  function hasDynamicFrameChange(delta) {
    return Boolean(
      delta.urlChanged ||
        delta.titleChanged ||
        delta.visibleTextAdded.length ||
        delta.visibleTextRemoved.length ||
        delta.interactiveAdded.length ||
        delta.interactiveRemoved.length ||
        delta.mutationStats.mutationCount
    );
  }

  function buildDeltaSummary(delta, changedObjects, changedRegions) {
    return {
      urlChanged: delta.urlChanged,
      titleChanged: delta.titleChanged,
      visibleTextAdded: delta.visibleTextAdded.slice(0, 8),
      visibleTextRemoved: delta.visibleTextRemoved.slice(0, 8),
      interactiveAdded: delta.interactiveAdded.slice(0, 8),
      interactiveRemoved: delta.interactiveRemoved.slice(0, 8),
      changedObjectKinds: changedObjects.map((item) => item.kind).slice(0, 8),
      changedRegionIds: changedRegions.map((item) => item.regionId).slice(0, 5),
      mutationStats: delta.mutationStats
    };
  }

  function buildTransitionSummaryBudget(delta) {
    return {
      maxItemsPerCategory: DYNAMIC_SUMMARY_MAX_ITEMS,
      maxTextLength: DYNAMIC_SUMMARY_MAX_TEXT_LENGTH,
      visibleTextAdded: summarizeBudgetCount(delta.visibleTextAdded),
      visibleTextRemoved: summarizeBudgetCount(delta.visibleTextRemoved),
      interactiveAdded: summarizeBudgetCount(delta.interactiveAdded),
      interactiveRemoved: summarizeBudgetCount(delta.interactiveRemoved)
    };
  }

  function summarizeBudgetCount(values) {
    const items = Array.isArray(values) ? values : [];
    return {
      total: items.length,
      shown: Math.min(items.length, DYNAMIC_SUMMARY_MAX_ITEMS),
      omitted: Math.max(0, items.length - DYNAMIC_SUMMARY_MAX_ITEMS),
      truncated: items.filter((item) => String(item || "").length > DYNAMIC_SUMMARY_MAX_TEXT_LENGTH).length
    };
  }

  function classifyDynamicTransitionValue(reason, delta, changedObjects, changedRegions, mutations) {
    const changeSignals = [];
    const suppressedSignals = [];
    const reasonCodes = [];
    const objectKinds = changedObjects.map((candidate) => candidate.kind);
    const mutationStats = delta.mutationStats || summarizeMutationStats(mutations || []);
    const lowMutationSignals = collectLowValueMutationSignals(mutations || []);
    suppressedSignals.push(...lowMutationSignals.signals);

    if (delta.urlChanged) changeSignals.push("url-change");
    if (delta.titleChanged) changeSignals.push("title-change");
    if (delta.visibleTextAdded.length || delta.visibleTextRemoved.length) changeSignals.push("visible-text-delta");
    if (delta.interactiveAdded.length || delta.interactiveRemoved.length) changeSignals.push("interactive-delta");
    if (mutationStats.mutationCount) changeSignals.push("mutation-window");
    if (reason === "before-action") changeSignals.push("pre-action-flush");
    if (objectKinds.length) objectKinds.forEach((kind) => changeSignals.push(`object-${kind}`));
    if (changedRegions.some((region) => isMainRegionSelector(region.selectorCandidate))) changeSignals.push("main-region-change");
    if (changedRegions.some((region) => isTableLikeSelector(region.selectorCandidate))) changeSignals.push("table-or-list-region-change");

    const textDeltaChars = delta.visibleTextAdded.concat(delta.visibleTextRemoved).reduce((sum, text) => sum + String(text || "").length, 0);
    const largeTextDelta = delta.visibleTextAdded.length + delta.visibleTextRemoved.length >= 4 || textDeltaChars > 360;
    const substantialInteractiveDelta = delta.interactiveAdded.length + delta.interactiveRemoved.length >= 3;
    const highObject = objectKinds.some((kind) => ["dialog-like", "dropdown-like", "menu-like", "loading-like", "validation-message-like", "main-region-like"].includes(kind));
    const lowOnly = mutationStats.mutationCount > 0 &&
      lowMutationSignals.count >= mutationStats.mutationCount &&
      !delta.urlChanged &&
      !delta.titleChanged &&
      !delta.visibleTextAdded.length &&
      !delta.visibleTextRemoved.length &&
      !delta.interactiveAdded.length &&
      !delta.interactiveRemoved.length &&
      !highObject;

    if (lowOnly) {
      reasonCodes.push("low-value-mutation-only");
      return {
        summaryPriority: "low",
        changeSignals: uniqueStrings(changeSignals),
        suppressedSignals: uniqueStrings(suppressedSignals),
        reasonCodes: uniqueStrings(reasonCodes),
        lowValueReason: summarizeLowValueReason(suppressedSignals)
      };
    }

    if (delta.urlChanged || delta.titleChanged || largeTextDelta || substantialInteractiveDelta || highObject || changeSignals.includes("main-region-change")) {
      reasonCodes.push("high-value-mechanical-change");
      return {
        summaryPriority: "high",
        changeSignals: uniqueStrings(changeSignals),
        suppressedSignals: uniqueStrings(suppressedSignals),
        reasonCodes: uniqueStrings(reasonCodes),
        lowValueReason: ""
      };
    }

    reasonCodes.push("medium-value-local-change");
    return {
      summaryPriority: "medium",
      changeSignals: uniqueStrings(changeSignals),
      suppressedSignals: uniqueStrings(suppressedSignals),
      reasonCodes: uniqueStrings(reasonCodes),
      lowValueReason: ""
    };
  }

  function collectLowValueMutationSignals(mutations) {
    const signals = [];
    let count = 0;
    mutations.forEach((mutation) => {
      const mutationSignals = lowValueMutationSignals(mutation);
      if (mutationSignals.length) {
        count += 1;
        signals.push(...mutationSignals);
      }
    });
    return {
      count,
      signals: uniqueStrings(signals)
    };
  }

  function lowValueMutationSignals(mutation) {
    const signals = [];
    const target = String(mutation.target || "").toLowerCase();
    const attribute = String(mutation.attributeName || "").toLowerCase();
    const oldValue = String(mutation.oldValue || "").toLowerCase();
    const newValue = String(mutation.newValue || "").toLowerCase();
    const joined = `${target} ${oldValue} ${newValue}`;
    if (/^(html|head|head\s|style|script)|\bhead\b|style\[|script\[/.test(target)) signals.push("head-or-style-mutation");
    if (DYNAMIC_LOW_VALUE_SELECTOR_RE.test(joined)) signals.push("animation-hover-or-measure-mutation");
    if (attribute === "class" && /(hover|active|focus|wave|motion|appear|leave|enter|row-hover)/.test(joined)) signals.push("class-animation-or-hover-change");
    if (attribute === "style" && !mutation.addedText.length && !mutation.removedText.length) signals.push("style-only-change");
    if ((mutation.type === "childList" || mutation.type === "attributes") && !mutation.addedText.length && !mutation.removedText.length && /(scrollbar|measure|resize-observer|sentinel)/.test(joined)) signals.push("layout-measurement-change");
    return uniqueStrings(signals);
  }

  function summarizeLowValueReason(signals) {
    const normalized = uniqueStrings(signals);
    if (!normalized.length) return "low-value-mutation-only";
    return normalized.slice(0, DYNAMIC_SUMMARY_MAX_SIGNAL_ITEMS).join(", ");
  }

  function isMainRegionSelector(selector) {
    return /\b(main|app|root|content|container|layout)\b|^\s*body\b/i.test(String(selector || ""));
  }

  function isTableLikeSelector(selector) {
    return /\b(table|grid|tbody|thead|tr|td|row|list|ul|ol)\b|\[role=["']?(grid|table|row|list|listitem)["']?\]/i.test(String(selector || ""));
  }

  function detectTransitionObjects(delta, changedRegions) {
    const candidates = [];
    const addedText = delta.visibleTextAdded.join(" ").toLowerCase();
    const removedText = delta.visibleTextRemoved.join(" ").toLowerCase();
    const interactiveText = delta.interactiveAdded.concat(delta.interactiveRemoved).join(" ").toLowerCase();
    const regionText = changedRegions.map((region) => `${region.selectorCandidate || ""} ${(region.visibleTextAdded || []).join(" ")} ${(region.visibleTextRemoved || []).join(" ")}`).join(" ").toLowerCase();
    if (/loading|please wait|spinner|progress|加载|处理中/.test(`${addedText} ${removedText}`)) {
      candidates.push({
        kind: "loading-like",
        matchedSignals: ["loading-like-visible-text-delta"],
        missingSignals: []
      });
    }
    if (delta.urlChanged || delta.titleChanged || changedRegions.some((region) => region.changePattern === "frame-text-change")) {
      candidates.push({
        kind: "main-region-like",
        matchedSignals: [delta.urlChanged ? "url-change" : "visible-text-delta"],
        missingSignals: []
      });
    }
    if (changedRegions.some((region) => isTableLikeSelector(region.selectorCandidate)) || /\b(table|grid|row|rows|list|empty|no data)\b|暂无|无数据/.test(`${addedText} ${interactiveText} ${regionText}`)) {
      candidates.push({
        kind: "table-like",
        matchedSignals: ["table-or-list-like-structure-delta"],
        missingSignals: ["confirmed-table-root"]
      });
    }
    if (/\b(dialog|modal|popup|drawer|overlay)\b|确认|取消/.test(`${addedText} ${interactiveText} ${regionText}`)) {
      candidates.push({
        kind: "dialog-like",
        matchedSignals: ["dialog-like-text-or-button-delta"],
        missingSignals: ["confirmed-dialog-role"]
      });
    }
    if (/\b(dropdown|popover|listbox|combobox|option|select-dropdown|menu)\b|\[role=["']?(listbox|option|menu|menuitem)["']?\]/.test(`${interactiveText} ${regionText}`)) {
      candidates.push({
        kind: /\bmenu|menuitem/.test(`${interactiveText} ${regionText}`) ? "menu-like" : "dropdown-like",
        matchedSignals: ["dropdown-or-menu-like-region-delta"],
        missingSignals: []
      });
    }
    if (/error|required|invalid|warning|必填|错误|无效/.test(addedText)) {
      candidates.push({
        kind: "validation-message-like",
        matchedSignals: ["validation-like-visible-text-added"],
        missingSignals: []
      });
    }
    return dedupeObjectCandidates(candidates);
  }

  function detectRegionObjectCandidates(region) {
    const candidates = [];
    const text = region.visibleTextAdded.concat(region.visibleTextRemoved).join(" ").toLowerCase();
    const selector = String(region.selectorCandidate || "").toLowerCase();
    if (region.appendix && region.appendix.mutationCount > 20) {
      candidates.push({
        kind: "main-region-like",
        matchedSignals: ["many-mutations-under-region"],
        missingSignals: []
      });
    }
    if (isTableLikeSelector(selector)) {
      candidates.push({
        kind: "table-like",
        matchedSignals: ["table-or-list-like-selector"],
        missingSignals: []
      });
    }
    if (/\b(dropdown|popover|listbox|combobox|option|select|menu)\b|\[role=["']?(listbox|option|menu|menuitem)["']?\]/.test(selector)) {
      candidates.push({
        kind: /\bmenu|menuitem/.test(selector) ? "menu-like" : "dropdown-like",
        matchedSignals: ["dropdown-or-menu-like-selector"],
        missingSignals: []
      });
    }
    if (/loading|please wait|加载|处理中/.test(text)) {
      candidates.push({
        kind: "loading-like",
        matchedSignals: ["loading-like-visible-text-under-region"],
        missingSignals: []
      });
    }
    if (/error|required|invalid|warning|必填|错误|无效/.test(text)) {
      candidates.push({
        kind: "validation-message-like",
        matchedSignals: ["validation-like-visible-text-under-region"],
        missingSignals: []
      });
    }
    return dedupeObjectCandidates(candidates);
  }

  function buildDynamicContextHtml(element) {
    const context = element && element.closest
      ? element.closest('[role="dialog"], dialog, form, tr, [role="row"], [role="menu"], [role="listbox"], main, section, article, [class*="modal"], [class*="drawer"], [class*="panel"]')
      : null;
    const node = context || (element && element.parentElement) || element;
    return node ? sanitizeDynamicDomPayloadHtml(getOuterHtmlWithoutRecorder(node).slice(0, 20000)) : "";
  }

  function findDynamicMainRegion() {
    return document.querySelector("main, [role='main'], #root, #app") || document.body;
  }

  function collectInteractiveDigest(root, limit = 40) {
    if (!root || !root.querySelectorAll) {
      return [];
    }
    const selectors = [
      "button",
      "a[href]",
      "input",
      "select",
      "textarea",
      "[role='button']",
      "[role='link']",
      "[role='tab']",
      "[role='checkbox']",
      "[role='radio']",
      "[role='menuitem']",
      "[contenteditable='true']"
    ].join(",");
    return Array.from(root.querySelectorAll(selectors))
      .filter((element) => !isRecorderNode(element) && isElementVisible(element))
      .slice(0, limit)
      .map((element) => {
        const role = element.getAttribute("role") || inferElementRole(element) || element.tagName.toLowerCase();
        const label = getElementLabel(element) || getOwnText(element, 60) || element.getAttribute("placeholder") || "";
        const enabled = isElementEnabled(element) ? "enabled" : "disabled";
        return `${role}:${label}:${enabled}`;
      });
  }

  function detectObjectCandidates(element) {
    const candidates = [];
    if (!element || !element.tagName) {
      return candidates;
    }
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute("role") || "";
    const type = String(element.getAttribute("type") || "").toLowerCase();
    const text = getOwnText(element, 80);
    const label = getElementLabel(element);
    const className = getElementClassText(element).toLowerCase();
    if (tag === "button" || role === "button" || (tag === "input" && ["button", "submit", "reset"].includes(type))) {
      candidates.push(objectCandidate("button-like", element, ["button-tag-or-role"], ["button-text"], Boolean(text || label)));
    }
    if (tag === "input" || tag === "textarea" || element.isContentEditable || role === "textbox" || role === "combobox") {
      candidates.push(objectCandidate("input-like", element, ["editable-control"], ["label-candidate"], Boolean(label || element.getAttribute("placeholder"))));
    }
    if (tag === "select" || role === "listbox" || role === "combobox") {
      candidates.push(objectCandidate("select-like", element, ["select-or-listbox-role"], ["option-items"], tag === "select"));
    }
    if (role === "option" || element.closest('[role="listbox"], [role="combobox"]') || /\b(select|dropdown|combobox|picker|option|popover)\b/i.test(className)) {
      candidates.push(objectCandidate("dropdown-like", element, ["dropdown-or-option-signal"], ["expanded-state"], true));
    }
    if ((tag === "input" && type === "checkbox") || role === "checkbox") {
      candidates.push(objectCandidate("checkbox-like", element, ["checkbox-control"], ["label-candidate"], Boolean(label || text)));
    }
    if ((tag === "input" && type === "radio") || role === "radio") {
      candidates.push(objectCandidate("radio-like", element, ["radio-control"], ["group-label"], Boolean(label || text)));
    }
    if (tag === "a" || role === "link") {
      candidates.push(objectCandidate("link-like", element, ["link-tag-or-role"], ["href-or-text"], Boolean(element.getAttribute("href") || text)));
    }
    if (role === "menuitem" || element.closest('[role="menu"], [role="listbox"]')) {
      candidates.push(objectCandidate("menu-like", element, ["menu-role-ancestor"], ["visible-menu-items"], true));
    }
    if (element.closest('[role="dialog"], dialog, .modal, .drawer')) {
      candidates.push(objectCandidate("dialog-like", element, ["dialog-ancestor"], ["dialog-title"], true));
    }
    if (role === "alert" || role === "status" || /toast|snackbar|notification|alert/.test(className)) {
      candidates.push(objectCandidate("toast-like", element, ["status-or-alert-signal"], ["message-text"], Boolean(text)));
    }
    if (role === "progressbar" || element.getAttribute("aria-busy") === "true" || /spinner|loading|progress|skeleton/.test(className) || /loading|加载|处理中/i.test(text)) {
      candidates.push(objectCandidate("loading-like", element, ["loading-signal"], ["related-region"], true));
    }
    if (element.closest('table, [role="grid"], [role="table"]')) {
      candidates.push(objectCandidate("table-like", element, ["table-or-grid-ancestor"], ["header-like-texts"], true));
    }
    if (tag === "tr" || role === "row" || element.closest('tr, [role="row"]')) {
      candidates.push(objectCandidate("row-like", element, ["row-tag-or-role"], ["cell-like-children"], true));
    }
    if (element.closest('form, [role="form"], fieldset')) {
      candidates.push(objectCandidate("form-like", element, ["form-ancestor"], ["field-labels"], true));
    }
    if (label || element.closest("label")) {
      candidates.push(objectCandidate("field-like", element, ["label-candidate"], ["control-pair"], true));
    }
    if (role === "tab" || element.closest('[role="tablist"]') || /\b(tab|segmented)\b/i.test(className)) {
      candidates.push(objectCandidate("tab-like", element, ["tab-role-or-tablist"], ["active-tab-state"], true));
    }
    if (/next|back|finish|submit|previous|上一步|下一步|提交|完成/i.test(text)) {
      candidates.push(objectCandidate("wizard-like", element, ["wizard-navigation-text"], ["stepper-context"], true));
    }
    if (element.closest("section, article, aside, [class*='panel'], [class*='card'], [class*='accordion']")) {
      candidates.push(objectCandidate("panel-like", element, ["section-or-panel-ancestor"], ["heading-text"], true));
    }
    if (tag === "li" || element.closest("ul, ol, [role='list']")) {
      candidates.push(objectCandidate("list-like", element, ["list-ancestor"], ["repeated-items"], true));
    }
    if (element.getAttribute("aria-invalid") === "true" || /error|required|invalid|warning|必填|错误|无效/i.test(text)) {
      candidates.push(objectCandidate("validation-message-like", element, ["validation-signal"], ["related-field"], true));
    }
    return dedupeObjectCandidates(candidates);
  }

  function objectCandidate(kind, element, matchedSignals, missingSignals, hasExpectedSignal) {
    const signals = matchedSignals.slice();
    const missing = hasExpectedSignal ? [] : missingSignals.slice();
    const label = getElementLabel(element);
    const text = getOwnText(element, 80);
    if (label) signals.push(`label-candidate=${label}`);
    if (text) signals.push(`visible-text=${text}`);
    return {
      kind,
      matchedSignals: signals,
      missingSignals: missing
    };
  }

  function dedupeObjectCandidates(candidates) {
    const seen = new Set();
    return candidates.filter((candidate) => {
      if (!candidate || !candidate.kind || seen.has(candidate.kind)) {
        return false;
      }
      seen.add(candidate.kind);
      return true;
    });
  }

  function arrayDifference(left, right) {
    const rightSet = new Set(right.map((item) => String(item || "").toLowerCase()));
    return uniqueStrings(left.filter((item) => !rightSet.has(String(item || "").toLowerCase())));
  }

  function summarizeMutationStats(mutations) {
    return mutations.reduce(
      (stats, mutation) => {
        stats.mutationCount += 1;
        if (mutation.type === "attributes") stats.attributeChanges += 1;
        if (mutation.type === "characterData") stats.textChanges += 1;
        if (mutation.addedText && mutation.addedText.length) stats.addedNodes += mutation.addedText.length;
        if (mutation.removedText && mutation.removedText.length) stats.removedNodes += mutation.removedText.length;
        return stats;
      },
      { mutationCount: 0, addedNodes: 0, removedNodes: 0, textChanges: 0, attributeChanges: 0 }
    );
  }

  function normalizeEventTarget(target) {
    if (!target) {
      return null;
    }
    if (target.nodeType === Node.TEXT_NODE) {
      return target.parentElement;
    }
    return target.nodeType === Node.ELEMENT_NODE ? target : null;
  }

  function isSameDynamicTarget(left, right) {
    return Boolean(left && right && left === right);
  }

  function isEditableElement(element) {
    if (!element || !element.tagName) {
      return false;
    }
    const tag = element.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || element.isContentEditable || element.getAttribute("role") === "textbox" || element.getAttribute("role") === "combobox";
  }

  function readElementValue(element) {
    const redacted = isSensitiveEditable(element);
    if (redacted) {
      return { value: "", redacted: true };
    }
    if (!element) {
      return { value: "", redacted: false };
    }
    if ("value" in element) {
      return { value: String(element.value || ""), redacted: false };
    }
    return { value: String(element.textContent || "").trim(), redacted: false };
  }

  function isSensitiveEditable(element) {
    if (!element || !isEditableElement(element)) {
      return false;
    }
    const type = String(element.getAttribute("type") || "").toLowerCase();
    const joined = [
      type,
      element.getAttribute("name") || "",
      element.getAttribute("id") || "",
      element.getAttribute("aria-label") || "",
      element.getAttribute("placeholder") || "",
      getElementLabel(element)
    ]
      .join(" ")
      .toLowerCase();
    return /password|token|secret|otp|auth|key|credential/.test(joined);
  }

  function inferEditKind(before, after, redacted) {
    if (redacted) return "redacted";
    if (before === after) return "unchanged";
    if (!before && after) return "append";
    if (before && !after) return "delete";
    if (after.startsWith(before)) return "append";
    return "replace";
  }

  function isElementVisible(element) {
    if (!element || !element.getBoundingClientRect) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || "1") !== 0;
  }

  function isElementEnabled(element) {
    if (!element) {
      return false;
    }
    return !element.disabled && element.getAttribute("aria-disabled") !== "true";
  }

  function inferElementRole(element) {
    if (!element || !element.tagName) return "";
    const tag = element.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a") return "link";
    if (tag === "input") return element.getAttribute("type") || "input";
    if (tag === "select") return "select";
    if (tag === "textarea") return "textbox";
    return "";
  }

  function getOwnText(element, maxLength = 120) {
    if (!element) return "";
    const text = String(element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  }

  function getElementLabel(element) {
    if (!element) return "";
    const aria = element.getAttribute && (element.getAttribute("aria-label") || element.getAttribute("title"));
    if (aria) return aria.trim();
    const id = element.getAttribute && element.getAttribute("id");
    if (id) {
      try {
        const label = document.querySelector(`label[for="${cssString(id)}"]`);
        if (label) return getOwnText(label, 120);
      } catch {
        // Label lookup is best effort for dynamic summaries.
      }
    }
    const wrappingLabel = element.closest && element.closest("label");
    return wrappingLabel ? getOwnText(wrappingLabel, 120) : "";
  }

  function buildLocatorHint(element) {
    const label = getElementLabel(element);
    const role = element.getAttribute("role") || inferElementRole(element);
    const text = getOwnText(element, 80);
    if (role && text) return `${role} text=${text}`;
    if (label) return `label=${label}`;
    try {
      return buildSelector(element);
    } catch {
      return "";
    }
  }

  function buildLocatorCandidates(element) {
    const candidates = [];
    const text = getOwnText(element, 80);
    const label = getElementLabel(element);
    const role = element.getAttribute("role") || inferElementRole(element);
    if (role && text) candidates.push({ kind: "role-text", value: `${role}:${text}`, matchedSignals: ["role", "visible-text"] });
    if (label) candidates.push({ kind: "label", value: label, matchedSignals: ["label-candidate"] });
    try {
      candidates.push({ kind: "css", value: buildSelector(element), matchedSignals: ["css-selector-generated"] });
    } catch {
