// Static ZIP package, StaticSummary, indexes, reference map, and annotation metadata exports.
  function addStaticExportFiles(files, annotations = state.annotations, fields = state.fields) {
    const pages = buildStaticPages(annotations);
    const pageByKey = new Map(pages.map((page) => [page.key, page]));
    const annotationEntries = annotations.map((annotation, index) => {
      const folder = staticAnnotationFolder(index, annotation);
      const page = pageByKey.get(staticPageKey(annotation));
      return buildStaticAnnotationEntry(annotation, index, folder, page, fields);
    });
    const annotationIndex = buildAnnotationIndex(annotationEntries);
    const fieldReferenceIndex = buildFieldReferenceIndex(annotationEntries, fields);
    const pageIndex = buildPageIndex(pages, annotationEntries);
    const referenceMap = buildStaticReferenceMap(annotationEntries);
    const recorderState = buildRecorderStateExport(annotations, fields);
    const summary = buildStaticSummary(annotationEntries, fields, pages);

    files.push({
      path: "StaticSummary.md",
      data: encodeText(summary)
    });
    files.push({
      path: "AnnotationIndex.json",
      data: encodeText(JSON.stringify(annotationIndex, null, 2))
    });
    files.push({
      path: "FieldReferenceIndex.json",
      data: encodeText(JSON.stringify(fieldReferenceIndex, null, 2))
    });
    files.push({
      path: "PageIndex.json",
      data: encodeText(JSON.stringify(pageIndex, null, 2))
    });
    files.push({
      path: "ReferenceMap.json",
      data: encodeText(JSON.stringify(referenceMap, null, 2))
    });
    files.push({
      path: "StaticRecorderState.json",
      data: encodeText(JSON.stringify(recorderState, null, 2))
    });

    pages.forEach((page) => {
      files.push({
        path: `${page.folder}/page.json`,
        data: encodeText(JSON.stringify(pageToJson(page), null, 2))
      });
      files.push({
        path: `${page.folder}/dom.html`,
        data: encodeText(page.domHtml || "")
      });
      if (page.screenshotDataUrl) {
        files.push({
          path: `${page.folder}/screenshot.png`,
          data: dataUrlToBytes(page.screenshotDataUrl)
        });
      }
    });

    annotationEntries.forEach((entry) => {
      files.push({
        path: `${entry.folder}/annotation.json`,
        data: encodeText(JSON.stringify(entry.annotationJson, null, 2))
      });
      files.push({
        path: `${entry.folder}/screenshot.png`,
        data: dataUrlToBytes(entry.annotation.screenshotDataUrl)
      });
      files.push({
        path: `${entry.folder}/appendix.json`,
        data: encodeText(JSON.stringify(entry.appendixJson, null, 2))
      });
      if (entry.annotation.type === "region") {
        files.push({
          path: `${entry.folder}/region.html`,
          data: encodeText(entry.regionHtml)
        });
      } else {
        files.push({
          path: `${entry.folder}/target.html`,
          data: encodeText(entry.targetHtml)
        });
        files.push({
          path: `${entry.folder}/context.html`,
          data: encodeText(entry.contextHtml)
        });
        if (entry.parentFrameHtml) {
          files.push({
            path: `${entry.folder}/parent-frame.html`,
            data: encodeText(entry.parentFrameHtml)
          });
        }
      }
    });
  }

  function staticAnnotationFolder(index, annotation) {
    return `Annotation${index + 1}`;
  }

  function staticPageKey(annotation) {
    return `${annotation.pageUrl || ""}\n${annotation.pageTitle || ""}\n${hashText(annotation.domHtml || "")}`;
  }

  function buildStaticPages(annotations) {
    const pages = [];
    const byKey = new Map();
    annotations.forEach((annotation) => {
      const key = staticPageKey(annotation);
      if (byKey.has(key)) {
        return;
      }
      const pageId = `page-${String(pages.length + 1).padStart(3, "0")}`;
      const page = {
        key,
        pageId,
        pageOrderIndex: pages.length + 1,
        folder: `pages/${pageId}`,
        pageUrl: annotation.pageUrl || "",
        pageTitle: annotation.pageTitle || "",
        domFingerprint: hashText(annotation.domHtml || ""),
        domHtml: annotation.domHtml || "",
        screenshotDataUrl: annotation.screenshotDataUrl || "",
        representativeAnnotationId: annotation.id || "",
        representativeAnnotationFolder: "",
        annotationFolders: []
      };
      pages.push(page);
      byKey.set(key, page);
    });
    return pages;
  }

  function buildStaticAnnotationEntry(annotation, index, folder, page, fields) {
    if (page) {
      page.annotationFolders.push(folder);
      if (!page.representativeAnnotationFolder) {
        page.representativeAnnotationFolder = folder;
      }
    }
    const fieldReferences = extractFieldReferences(annotation.annotationText || "", fields);
    const targetAnnotation = staticTargetAnnotation(annotation);
    const targetProfile = buildStaticTargetProfile(targetAnnotation);
    const locatorCandidates = buildStaticLocatorCandidates(targetAnnotation, targetProfile);
    const references = buildStaticAnnotationReferences(annotation, folder, page);
    const annotationJson = {
      annotationId: annotation.id || folder,
      exportOrderIndex: index + 1,
      folder,
      annotationType: annotation.type || "element",
      annotationText: annotation.annotationText || "",
      fieldReferences,
      pageRef: page ? page.pageId : "",
      targetProfile,
      locatorCandidates,
      frameContext: annotation.frameContext || null,
      references
    };
    const appendixJson = buildStaticAppendix(annotation, folder, page);
    return {
      annotation,
      folder,
      fieldReferences,
      targetProfile,
      locatorCandidates,
      annotationJson,
      appendixJson,
      targetHtml: buildStaticTargetHtml(annotation),
      contextHtml: buildStaticContextHtml(annotation),
      parentFrameHtml: buildStaticParentFrameHtml(annotation),
      regionHtml: buildStaticRegionHtml(annotation),
      page
    };
  }

  function staticTargetAnnotation(annotation) {
    if (!annotation || !annotation.frameContext) {
      return annotation;
    }
    return {
      ...annotation,
      selector: annotation.frameContext.targetSelector || "",
      outerHTML: annotation.frameContext.targetOuterHTML || "",
      parentOuterHTML: annotation.frameContext.targetParentOuterHTML || "",
      grandparentOuterHTML: annotation.frameContext.targetGrandparentOuterHTML || ""
    };
  }

  function buildStaticAnnotationReferences(annotation, folder, page) {
    const references = {
      annotation: `${folder}/annotation.json`,
      screenshot: `${folder}/screenshot.png`,
      appendix: `${folder}/appendix.json`
    };
    if (annotation.type === "region") {
      references.regionHtml = `${folder}/region.html`;
    } else {
      references.targetHtml = `${folder}/target.html`;
      references.contextHtml = `${folder}/context.html`;
      if (annotation.frameContext) {
        references.parentFrameHtml = `${folder}/parent-frame.html`;
      }
    }
    if (page) {
      references.page = `${page.folder}/page.json`;
      references.fullDom = `${page.folder}/dom.html`;
      if (page.screenshotDataUrl) {
        references.pageScreenshot = `${page.folder}/screenshot.png`;
      }
    }
    return references;
  }

  function buildStaticTargetProfile(annotation) {
    if (!annotation || annotation.type === "region") {
      return {
        kind: "region-like",
        matchedSignals: ["manual-region-selection"],
        summary: {
          selection: annotation ? annotation.selection || null : null,
          documentSelection: annotation ? annotation.documentSelection || null : null
        }
      };
    }

    const element = parseHtmlElement(annotation.outerHTML || "");
    if (!element) {
      return {
        kind: "element-like",
        matchedSignals: ["manual-element-selection"],
        missingSignals: ["target-outer-html-parseable"]
      };
    }

    const tag = element.localName || "";
    const role = element.getAttribute("role") || "";
    const type = element.getAttribute("type") || "";
    const text = normalizeInlineText(element.textContent || "");
    const labelCandidate = firstNonEmpty([
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("placeholder"),
      element.getAttribute("name"),
      element.getAttribute("id"),
      text
    ]);
    const disabled = element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";
    const readonly = element.hasAttribute("readonly") || element.getAttribute("aria-readonly") === "true";
    const editable = isEditableLikeElement(element) && !disabled && !readonly;
    const matchedSignals = ["manual-element-selection", `tag=${tag}`];
    if (role) matchedSignals.push(`role=${role}`);
    if (type) matchedSignals.push(`type=${type}`);
    if (labelCandidate) matchedSignals.push("has-label-candidate");

    return {
      kind: inferStaticObjectKind(element),
      tag,
      role,
      type,
      text: truncateText(text, 120),
      labelCandidate: truncateText(labelCandidate, 120),
      visible: true,
      enabled: !disabled,
      editable,
      matchedSignals
    };
  }

  function parseHtmlElement(html) {
    if (!html) {
      return null;
    }
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      return doc.body.firstElementChild;
    } catch {
      return null;
    }
  }

  function inferStaticObjectKind(element) {
    const tag = element.localName || "";
    const role = element.getAttribute("role") || "";
    const type = (element.getAttribute("type") || "").toLowerCase();
    if (tag === "button" || role === "button" || (tag === "input" && ["button", "submit", "reset"].includes(type))) {
      return "button-like";
    }
    if ((tag === "input" && type === "checkbox") || role === "checkbox") {
      return "checkbox-like";
    }
    if ((tag === "input" && type === "radio") || role === "radio") {
      return "radio-like";
    }
    if (tag === "select" || role === "listbox") {
      return "select-like";
    }
    if (tag === "input" || tag === "textarea" || role === "textbox" || role === "combobox" || element.hasAttribute("contenteditable")) {
      return "input-like";
    }
    if (tag === "a" || role === "link") {
      return "link-like";
    }
    return "element-like";
  }

  function isEditableLikeElement(element) {
    const tag = element.localName || "";
    const role = element.getAttribute("role") || "";
    return tag === "input" || tag === "textarea" || role === "textbox" || role === "combobox" || element.hasAttribute("contenteditable");
  }

  function buildStaticLocatorCandidates(annotation, targetProfile) {
    const candidates = [];
    const element = parseHtmlElement(annotation.outerHTML || "");
    if (annotation.selector) {
      candidates.push({
        kind: "css",
        value: annotation.selector,
        matchedSignals: ["recorded-selector"]
      });
    }
    if (!element) {
      return candidates;
    }
    const tag = element.localName || "";
    ["data-testid", "data-test", "data-cy", "name", "aria-label", "title", "role"].forEach((attr) => {
      const value = element.getAttribute(attr);
      if (!value) {
        return;
      }
      candidates.push({
        kind: "css",
        value: `${tag}[${attr}="${cssString(value)}"]`,
        matchedSignals: [`attr=${attr}`]
      });
    });
    if (targetProfile && targetProfile.text) {
      candidates.push({
        kind: "text",
        value: targetProfile.text,
        matchedSignals: ["target-text"]
      });
    }
    if (targetProfile && targetProfile.labelCandidate) {
      candidates.push({
        kind: "label-candidate",
        value: targetProfile.labelCandidate,
        matchedSignals: ["target-label-candidate"]
      });
    }
    return dedupeLocatorCandidates(candidates).slice(0, 8);
  }

  function dedupeLocatorCandidates(candidates) {
    const seen = new Set();
    return candidates.filter((candidate) => {
      const key = `${candidate.kind}:${candidate.value}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  function buildStaticContextHtml(annotation) {
    if (annotation.frameContext && annotation.frameContext.targetGrandparentOuterHTML) {
      return annotation.frameContext.targetGrandparentOuterHTML;
    }
    if (annotation.frameContext && annotation.frameContext.targetParentOuterHTML) {
      return annotation.frameContext.targetParentOuterHTML;
    }
    if (annotation.grandparentOuterHTML) {
      return annotation.grandparentOuterHTML;
    }
    if (annotation.parentOuterHTML) {
      return annotation.parentOuterHTML;
    }
    return annotation.outerHTML || "";
  }

  function buildStaticTargetHtml(annotation) {
    return annotation && annotation.frameContext && annotation.frameContext.targetOuterHTML
      ? annotation.frameContext.targetOuterHTML
      : annotation.outerHTML || "";
  }

  function buildStaticParentFrameHtml(annotation) {
    if (!annotation || !annotation.frameContext) {
      return "";
    }
    return annotation.outerHTML || "";
  }

  function buildStaticRegionHtml(annotation) {
    return [
      "<!-- Static region annotation does not map to a single DOM node. -->",
      "<!-- Use screenshot.png and appendix.json geometry first; use page-level dom.html as fallback. -->",
      buildStaticContextHtml(annotation)
    ].filter(Boolean).join("\n");
  }

  function buildStaticAppendix(annotation, folder, page) {
    return {
      annotationId: annotation.id || folder,
      folder,
      rawSelector: annotation.selector || "",
      viewport: annotation.viewport || null,
      selection: annotation.selection || null,
      documentSelection: annotation.documentSelection || null,
      page: page
        ? {
            pageId: page.pageId,
            pageUrl: page.pageUrl,
            pageTitle: page.pageTitle
          }
        : null,
      htmlContext: {
        targetOuterHTML: buildStaticTargetHtml(annotation),
        parentOuterHTML: annotation.frameContext && annotation.frameContext.targetParentOuterHTML ? annotation.frameContext.targetParentOuterHTML : annotation.parentOuterHTML || "",
        grandparentOuterHTML: annotation.frameContext && annotation.frameContext.targetGrandparentOuterHTML ? annotation.frameContext.targetGrandparentOuterHTML : annotation.grandparentOuterHTML || "",
        parentFrameOuterHTML: annotation.frameContext ? annotation.outerHTML || "" : ""
      },
      frameContext: annotation.frameContext || null,
      parentFrameLocatorCandidates: annotation.frameContext ? buildStaticLocatorCandidates({
        ...annotation,
        outerHTML: annotation.outerHTML || "",
        selector: annotation.selector || ""
      }, buildStaticTargetProfile(annotation)) : [],
      targetFrameLocatorCandidates: annotation.frameContext ? buildStaticLocatorCandidates({
        ...annotation,
        outerHTML: annotation.frameContext.targetOuterHTML || "",
        selector: annotation.frameContext.targetSelector || ""
      }, buildStaticTargetProfile({
        ...annotation,
        outerHTML: annotation.frameContext.targetOuterHTML || "",
        selector: annotation.frameContext.targetSelector || ""
      })) : []
    };
  }

  function buildAnnotationIndex(entries) {
    return {
      schema: "captura.annotation-index",
      version: 1,
      annotations: entries.map((entry) => ({
        annotationId: entry.annotation.id || entry.folder,
        exportOrderIndex: entry.annotationJson.exportOrderIndex,
        folder: entry.folder,
        annotationType: entry.annotationJson.annotationType,
        annotationText: entry.annotationJson.annotationText,
        fieldReferences: entry.fieldReferences.map((field) => field.name),
        pageRef: entry.annotationJson.pageRef,
        targetKind: entry.targetProfile.kind,
        targetLabelCandidate: entry.targetProfile.labelCandidate || "",
        references: entry.annotationJson.references
      }))
    };
  }

  function buildFieldReferenceIndex(entries, fields) {
    const byName = new Map();
    fields.forEach((field) => {
      byName.set(field.name.toLowerCase(), {
        id: field.id || "",
        name: field.name,
        description: field.description || "",
        annotations: []
      });
    });
    entries.forEach((entry) => {
      entry.fieldReferences.forEach((field) => {
        const key = field.name.toLowerCase();
        if (!byName.has(key)) {
          byName.set(key, {
            id: field.id || "",
            name: field.name,
            description: field.description || "",
            annotations: []
          });
        }
        byName.get(key).annotations.push({
          annotationId: entry.annotation.id || entry.folder,
          exportOrderIndex: entry.annotationJson.exportOrderIndex,
          folder: entry.folder,
          annotationText: entry.annotationJson.annotationText
        });
      });
    });
    return {
      schema: "captura.field-reference-index",
      version: 1,
      fields: Array.from(byName.values())
        .filter((field) => field.annotations.length > 0)
        .sort((left, right) => left.name.localeCompare(right.name))
    };
  }

  function buildPageIndex(pages, entries) {
    const byPageId = new Map(pages.map((page) => [page.pageId, page]));
    entries.forEach((entry) => {
      const page = byPageId.get(entry.annotationJson.pageRef);
      if (page && !page.annotationFolders.includes(entry.folder)) {
        page.annotationFolders.push(entry.folder);
      }
    });
    return {
      schema: "captura.page-index",
      version: 1,
      pages: pages.map(pageToJson)
    };
  }

  function pageToJson(page) {
    return {
      pageId: page.pageId,
      pageOrderIndex: page.pageOrderIndex,
      folder: page.folder,
      pageUrl: page.pageUrl,
      pageTitle: page.pageTitle,
      domFingerprint: page.domFingerprint,
      domPath: `${page.folder}/dom.html`,
      screenshotPath: page.screenshotDataUrl ? `${page.folder}/screenshot.png` : "",
      representativeAnnotationId: page.representativeAnnotationId,
      representativeAnnotationFolder: page.representativeAnnotationFolder,
      annotationFolders: page.annotationFolders
    };
  }

  function buildStaticReferenceMap(entries) {
    const map = {};
    entries.forEach((entry) => {
      const baseKey = `${entry.folder}`;
      map[`${baseKey}.annotation`] = {
        summary: truncateText(entry.annotationJson.annotationText, 160),
        files: [entry.annotationJson.references.annotation, entry.annotationJson.references.appendix],
        screenshots: [entry.annotationJson.references.screenshot]
      };
      map[`${baseKey}.target`] = {
        summary: `${entry.targetProfile.kind || "object-like"} ${entry.targetProfile.labelCandidate || entry.targetProfile.text || ""}`.trim(),
        files: [
          entry.annotationJson.references.targetHtml || entry.annotationJson.references.regionHtml,
          entry.annotationJson.references.contextHtml,
          entry.annotationJson.references.annotation,
          entry.annotationJson.references.fullDom
        ].filter(Boolean),
        screenshots: [entry.annotationJson.references.screenshot]
      };
      if (entry.fieldReferences.length) {
        map[`${baseKey}.fields`] = {
          summary: entry.fieldReferences.map((field) => field.name).join(", "),
          files: [entry.annotationJson.references.annotation],
          screenshots: [entry.annotationJson.references.screenshot]
        };
      }
    });
    return map;
  }

  function buildStaticSummary(entries, fields, pages) {
    const usedFields = collectUsedFields(entries.map((entry) => entry.annotation), fields);
    const lines = [
      "# Static Summary",
      "",
      `Generated at: ${formatShanghaiTime(new Date())}`,
      `Annotation total: ${entries.length}`,
      `Page total: ${pages.length}`,
      "",
      "Static Summary 是 AI 默认阅读入口。完整 DOM 按页面放在 `pages/` 下，单个标注的高价值上下文放在对应 `Annotation{number}/` 文件夹。",
      ""
    ];

    if (usedFields.length) {
      lines.push("## Fields");
      lines.push("");
      usedFields.forEach((field) => {
        lines.push(`- \`${field.name}\`: ${field.description || "未填写说明"}`);
      });
      lines.push("");
    }

    lines.push("## Annotations");
    lines.push("");
    entries.forEach((entry) => {
      const profile = entry.targetProfile || {};
      lines.push(`### ${entry.folder}`);
      lines.push("");
      lines.push(renderAnnotationTextMarkdown(entry.annotationJson.annotationText || "（未填写批注）"));
      lines.push("");
      lines.push(`- pageRef: \`${entry.annotationJson.pageRef || "unknown"}\``);
      lines.push(`- type: \`${entry.annotationJson.annotationType}\``);
      lines.push(`- target: \`${profile.kind || "object-like"}\`${formatSummaryTargetSuffix(profile)}`);
      if (entry.annotationJson.frameContext) {
        const frameContext = entry.annotationJson.frameContext;
        const parentFrame = Array.isArray(frameContext.frameChain) && frameContext.frameChain.length ? frameContext.frameChain[0] : null;
        lines.push("- iframe target: true");
        lines.push(`- parent frame selector: \`${parentFrame && parentFrame.selector ? parentFrame.selector : entry.annotation.selector || ""}\``);
        lines.push(`- target frame selector: \`${frameContext.targetSelector || ""}\``);
      }
      if (entry.fieldReferences.length) {
        lines.push(`- fields: ${entry.fieldReferences.map((field) => `\`${field.name}\``).join(", ")}`);
      } else {
        lines.push("- fields: 无字段引用");
      }
      lines.push(`- reference: \`${entry.folder}/annotation.json\``);
      lines.push(`- screenshot: \`${entry.folder}/screenshot.png\``);
      lines.push("");
    });

    return `${lines.join("\n")}\n`;
  }

  function formatSummaryTargetSuffix(profile) {
    const parts = [];
    if (profile.labelCandidate) {
      parts.push(`label candidate \`${profile.labelCandidate}\``);
    }
    if (profile.text && profile.text !== profile.labelCandidate) {
      parts.push(`text \`${profile.text}\``);
    }
    if (profile.enabled !== undefined) {
      parts.push(`enabled ${profile.enabled}`);
    }
    if (profile.editable !== undefined) {
      parts.push(`editable ${profile.editable}`);
    }
    return parts.length ? `, ${parts.join(", ")}` : "";
  }

  async function addDynamicExportFiles(files, options = {}) {
