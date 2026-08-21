// Dynamic recorder test hooks and debug-only adapters.

  function installDynamicRecorderTestHooks() {
    window.__LIGENTIA_DYNAMIC_RECORDER_TEST_HOOKS__ = {
      canonicalActionTarget(target) {
        const normalized = canonicalActionTarget(target);
        return {
          rawTag: normalized.rawElement && normalized.rawElement.tagName ? normalized.rawElement.tagName.toLowerCase() : "",
          canonicalTag: normalized.canonicalElement && normalized.canonicalElement.tagName ? normalized.canonicalElement.tagName.toLowerCase() : "",
          rawSelector: normalized.rawSelector,
          canonicalSelector: normalized.canonicalSelector,
          matchedSignals: normalized.matchedSignals,
          suppressedSignals: normalized.suppressedSignals
        };
      },
      detectObjectCandidates(element) {
        return detectObjectCandidates(element);
      },
      detectTransitionObjects(delta, changedRegions = []) {
        return detectTransitionObjects(delta, changedRegions);
      },
      shouldMergeClickIntoInputAction(element) {
        return shouldMergeClickIntoInputAction(element);
      },
      classifyDynamicTransitionValue({ reason = "frame", delta, changedObjects = [], changedRegions = [], mutations = [] }) {
        return classifyDynamicTransitionValue(reason, delta, changedObjects, changedRegions, mutations);
      },
      buildLowValueTransitionGroups(nodes) {
        return buildLowValueTransitionGroups(nodes);
      },
      shouldExportDynamicRecording(rawBusPackageCount, nodes) {
        return shouldExportDynamicRecording(rawBusPackageCount, nodes);
      },
      shouldEmitDynamicSnapshotForDelta(delta) {
        return hasDynamicFrameChange(delta);
      },
      sanitizeDynamicDomPayloadText(value, options = {}) {
        return sanitizeDynamicDomPayloadText(value, options);
      },
      sanitizeDynamicDomPayloadHtml(value) {
        return sanitizeDynamicDomPayloadHtml(value);
      },
      buildMutationFact(mutation) {
        return buildMutationFact(mutation);
      },
      buildDynamicTargetSnapshot(element) {
        return buildDynamicTargetSnapshot(element);
      },
      buildExportNodesForRawBus(rawBusEvents, fallbackNodes = []) {
        return buildExportNodesFromRawBus(rawBusEvents, fallbackNodes);
      },
      buildDocumentIndexForRawEvents(events) {
        const previousRawBusEvents = state.dynamic.rawBusEvents;
        state.dynamic.rawBusEvents = Array.isArray(events) ? events : [];
        try {
          return buildDocumentIndex();
        } finally {
          state.dynamic.rawBusEvents = previousRawBusEvents;
        }
      },
      buildDynamicSummaryForNodes(nodes) {
        const previousNodes = state.dynamic.nodes;
        const previousSessionId = state.dynamic.sessionId;
        state.dynamic.nodes = Array.isArray(nodes) ? nodes : [];
        state.dynamic.sessionId = "dynamic-recorder-test";
        try {
          return buildDynamicSummary();
        } finally {
          state.dynamic.nodes = previousNodes;
          state.dynamic.sessionId = previousSessionId;
        }
      },
      buildDynamicSummaryForRawBusOnly(events) {
        const previousNodes = state.dynamic.nodes;
        const previousRawBusEvents = state.dynamic.rawBusEvents;
        const previousSessionId = state.dynamic.sessionId;
        state.dynamic.nodes = [];
        state.dynamic.rawBusEvents = Array.isArray(events) ? events : [];
        state.dynamic.sessionId = "dynamic-recorder-test";
        try {
          return buildDynamicSummary();
        } finally {
          state.dynamic.nodes = previousNodes;
          state.dynamic.rawBusEvents = previousRawBusEvents;
          state.dynamic.sessionId = previousSessionId;
        }
      }
    };
  }
