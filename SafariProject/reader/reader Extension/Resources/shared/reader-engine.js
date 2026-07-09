(function attachBoldLeadReaderEngine(global) {
  "use strict";

  const WORD_ATTR = "data-boldlead-word";
  const FIXATION_ATTR = "data-boldlead-fixation";
  const ROOT_ATTR = "data-boldlead-root";
  const SKIP_TAGS = new Set([
    "HEAD",
    "TITLE",
    "META",
    "LINK",
    "BASE",
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEMPLATE",
    "MATH",
    "CANVAS",
    "IFRAME",
    "OBJECT",
    "EMBED",
    "AUDIO",
    "VIDEO",
    "INPUT",
    "TEXTAREA",
    "SELECT",
    "OPTION"
  ]);

  const Config = global.BoldLeadReaderConfig || {
    normalizeSettings: (settings) => settings || {}
  };

  function createReader(options) {
    const documentRef = options && options.document ? options.document : global.document;
    const windowRef =
      (options && options.window) ||
      (documentRef && documentRef.defaultView) ||
      global.window ||
      global;
    const NodeCtor = windowRef.Node || global.Node;
    const NodeFilterCtor = windowRef.NodeFilter || global.NodeFilter;
    const settingsFromOptions = options && options.settings ? options.settings : {};

    let settings = Config.normalizeSettings(settingsFromOptions);
    let enabled = false;
    let scheduled = false;
    let flushing = false;
    let destroyed = false;
    let pendingRootScan = false;
    let transformedWords = 0;

    const pendingNodes = new Set();
    const observedRoots = new Set();
    const observers = new Map();

    const wordSegmenter =
      typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter(undefined, { granularity: "word" })
        : null;
    const graphemeSegmenter =
      typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
        : null;

    function enable(nextSettings) {
      if (destroyed) {
        return;
      }
      settings = Config.normalizeSettings(Object.assign({}, settings, nextSettings || {}));
      enabled = true;
      applyCssVariables();
      observeRoot(documentRef);
      enqueueRootScan();
    }

    function disable() {
      enabled = false;
      scheduled = false;
      pendingRootScan = false;
      pendingNodes.clear();
      disconnectObservers();
      restoreAll();
    }

    function destroy() {
      disable();
      observedRoots.clear();
      observers.clear();
      destroyed = true;
    }

    function updateSettings(nextSettings) {
      settings = Config.normalizeSettings(Object.assign({}, settings, nextSettings || {}));
      applyCssVariables();
      if (settings.enabled) {
        if (!enabled) {
          enable(settings);
        } else {
          refresh();
        }
      } else if (enabled) {
        disable();
      }
    }

    function refresh() {
      if (!enabled || destroyed) {
        return;
      }
      disconnectObservers();
      restoreAll();
      observeRoot(documentRef);
      enqueueRootScan();
    }

    function getStats() {
      return {
        enabled,
        transformedWords,
        observedRoots: observedRoots.size
      };
    }

    function applyCssVariables() {
      if (!documentRef || !documentRef.documentElement) {
        return;
      }
      documentRef.documentElement.style.setProperty(
        "--boldlead-reader-weight",
        String(settings.fontWeight || 700)
      );
    }

    function enqueueRootScan() {
      pendingRootScan = true;
      scheduleFlush();
    }

    function enqueueNode(node) {
      if (!node || !enabled || destroyed) {
        return;
      }
      pendingNodes.add(node);
      scheduleFlush();
    }

    function scheduleFlush() {
      if (scheduled || flushing || !enabled || destroyed) {
        return;
      }
      scheduled = true;

      const run = () => {
        scheduled = false;
        flush();
      };

      if (typeof windowRef.requestIdleCallback === "function") {
        windowRef.requestIdleCallback(run, { timeout: 250 });
      } else {
        windowRef.setTimeout(run, 0);
      }
    }

    function flush() {
      if (!enabled || destroyed || flushing) {
        return;
      }

      flushing = true;
      disconnectObservers();

      try {
        if (pendingRootScan) {
          pendingRootScan = false;
          transformSubtree(documentRef);
        }

        const nodes = Array.from(pendingNodes);
        pendingNodes.clear();
        for (const node of nodes) {
          transformNode(node);
        }
      } finally {
        connectObservers();
        flushing = false;
        if ((pendingRootScan || pendingNodes.size > 0) && enabled) {
          scheduleFlush();
        }
      }
    }

    function observeRoot(root) {
      if (!root || observedRoots.has(root) || destroyed) {
        return;
      }
      observedRoots.add(root);
      if (enabled) {
        connectObserver(root);
      }
    }

    function connectObservers() {
      for (const root of observedRoots) {
        connectObserver(root);
      }
    }

    function connectObserver(root) {
      if (!root || observers.has(root) || typeof windowRef.MutationObserver !== "function") {
        return;
      }

      const observer = new windowRef.MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === "characterData") {
            if (!isInsideReaderWord(mutation.target.parentElement)) {
              enqueueNode(mutation.target);
            }
            continue;
          }

          for (const node of mutation.addedNodes || []) {
            enqueueNode(node);
          }
        }
      });

      try {
        observer.observe(root, {
          childList: true,
          subtree: true,
          characterData: true
        });
        observers.set(root, observer);
      } catch (_error) {
        observers.delete(root);
      }
    }

    function disconnectObservers() {
      for (const observer of observers.values()) {
        observer.disconnect();
      }
      observers.clear();
    }

    function transformNode(node) {
      if (!node || !enabled || destroyed) {
        return;
      }

      if (node.nodeType === NodeCtor.TEXT_NODE) {
        transformTextNode(node);
        return;
      }

      if (
        node.nodeType === NodeCtor.ELEMENT_NODE ||
        node.nodeType === NodeCtor.DOCUMENT_FRAGMENT_NODE ||
        node.nodeType === NodeCtor.DOCUMENT_NODE
      ) {
        transformSubtree(node);
      }
    }

    function transformSubtree(root) {
      if (!root || !enabled || destroyed) {
        return;
      }

      discoverOpenShadowRoots(root);

      const walker = documentRef.createTreeWalker(
        root,
        NodeFilterCtor.SHOW_TEXT,
        {
          acceptNode(node) {
            return shouldTransformTextNode(node)
              ? NodeFilterCtor.FILTER_ACCEPT
              : NodeFilterCtor.FILTER_REJECT;
          }
        }
      );

      const textNodes = [];
      while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
      }

      for (const textNode of textNodes) {
        transformTextNode(textNode);
      }
    }

    function discoverOpenShadowRoots(root) {
      if (!root) {
        return;
      }

      if (root.nodeType === NodeCtor.ELEMENT_NODE && root.shadowRoot) {
        observeRoot(root.shadowRoot);
        transformSubtree(root.shadowRoot);
      }

      if (typeof root.querySelectorAll !== "function") {
        return;
      }

      const elements = root.querySelectorAll("*");
      for (const element of elements) {
        if (element.shadowRoot) {
          observeRoot(element.shadowRoot);
          transformSubtree(element.shadowRoot);
        }
      }
    }

    function shouldTransformTextNode(node) {
      if (!node || !node.nodeValue || !node.parentElement) {
        return false;
      }
      if (!hasWordLikeText(node.nodeValue)) {
        return false;
      }
      if (
        node.parentElement.namespaceURI === "http://www.w3.org/2000/svg" &&
        !isSvgTextElement(node.parentElement)
      ) {
        return false;
      }
      return !shouldSkipElement(node.parentElement);
    }

    function shouldSkipElement(element) {
      if (!element) {
        return true;
      }
      if (isInsideReaderWord(element)) {
        return true;
      }

      let current = element;
      while (current) {
        if (current.nodeType !== NodeCtor.ELEMENT_NODE) {
          current = current.parentNode || (current.host || null);
          continue;
        }

        if (current.hasAttribute(ROOT_ATTR)) {
          return true;
        }

        if (current.hasAttribute(WORD_ATTR) || current.hasAttribute(FIXATION_ATTR)) {
          return true;
        }

        if (SKIP_TAGS.has(current.tagName)) {
          return true;
        }

        if (!settings.transformCode && (current.tagName === "CODE" || current.tagName === "PRE")) {
          return true;
        }

        if (
          settings.skipEditable &&
          (current.isContentEditable ||
            current.getAttribute("contenteditable") === "" ||
            current.getAttribute("contenteditable") === "true")
        ) {
          return true;
        }

        current = current.parentNode || (current.getRootNode && current.getRootNode().host) || null;
      }

      return false;
    }

    function isInsideReaderWord(element) {
      return Boolean(
        element &&
          typeof element.closest === "function" &&
          element.closest("[" + WORD_ATTR + "], [" + ROOT_ATTR + "]")
      );
    }

    function hasWordLikeText(text) {
      if (!text || !/\S/u.test(text)) {
        return false;
      }

      if (wordSegmenter) {
        for (const segment of wordSegmenter.segment(text)) {
          if (segment.isWordLike) {
            return true;
          }
        }
        return false;
      }

      return /[\p{L}\p{N}]/u.test(text);
    }

    function textMode(element) {
      return isSvgTextElement(element) ? "svg" : "html";
    }

    function isSvgTextElement(element) {
      if (!element || element.namespaceURI !== "http://www.w3.org/2000/svg") {
        return false;
      }

      const tagName = String(element.tagName || "").toLowerCase();
      return tagName === "text" || tagName === "tspan" || tagName === "textpath";
    }

    function transformTextNode(textNode) {
      if (!shouldTransformTextNode(textNode)) {
        return;
      }

      const fragment = buildFragment(textNode.nodeValue, textMode(textNode.parentElement));
      if (!fragment) {
        return;
      }

      textNode.parentNode.replaceChild(fragment, textNode);
    }

    function buildFragment(text, mode) {
      const fragment = documentRef.createDocumentFragment();
      let lastIndex = 0;
      let wordCount = 0;

      if (wordSegmenter) {
        for (const segment of wordSegmenter.segment(text)) {
          if (!segment.isWordLike) {
            continue;
          }
          appendPlainText(fragment, text.slice(lastIndex, segment.index));
          appendBionicWord(fragment, segment.segment, mode);
          wordCount += 1;
          lastIndex = segment.index + segment.segment.length;
        }
      } else {
        const pattern = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/gu;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          appendPlainText(fragment, text.slice(lastIndex, match.index));
          appendBionicWord(fragment, match[0], mode);
          wordCount += 1;
          lastIndex = match.index + match[0].length;
        }
      }

      if (wordCount === 0) {
        return null;
      }

      appendPlainText(fragment, text.slice(lastIndex));
      transformedWords += wordCount;
      return fragment;
    }

    function appendPlainText(fragment, text) {
      if (text) {
        fragment.appendChild(documentRef.createTextNode(text));
      }
    }

    function appendBionicWord(fragment, word, mode) {
      const namespace = mode === "svg" ? "http://www.w3.org/2000/svg" : null;
      const wrapper = namespace
        ? documentRef.createElementNS(namespace, "tspan")
        : documentRef.createElement("span");
      const fixation = namespace
        ? documentRef.createElementNS(namespace, "tspan")
        : documentRef.createElement("span");
      const split = splitWord(word);

      wrapper.setAttribute(WORD_ATTR, "");
      fixation.setAttribute(FIXATION_ATTR, "");
      if (namespace) {
        fixation.setAttribute("font-weight", String(settings.fontWeight || 700));
      }
      fixation.textContent = split.head;
      wrapper.appendChild(fixation);

      if (split.tail) {
        wrapper.appendChild(documentRef.createTextNode(split.tail));
      }

      fragment.appendChild(wrapper);
    }

    function splitWord(word) {
      const graphemes = splitGraphemes(word);
      if (graphemes.length <= 1) {
        return {
          head: word,
          tail: ""
        };
      }

      const rawLength = Math.ceil(graphemes.length * settings.fixationRatio);
      const fixationLength = Math.min(
        graphemes.length,
        Math.max(settings.minFixation, Math.min(settings.maxFixation, rawLength))
      );

      return {
        head: graphemes.slice(0, fixationLength).join(""),
        tail: graphemes.slice(fixationLength).join("")
      };
    }

    function splitGraphemes(word) {
      if (graphemeSegmenter) {
        return Array.from(graphemeSegmenter.segment(word), (segment) => segment.segment);
      }
      return Array.from(word);
    }

    function restoreAll() {
      for (const root of observedRoots) {
        restoreRoot(root);
      }
      restoreRoot(documentRef);
      transformedWords = 0;
    }

    function restoreRoot(root) {
      if (!root || typeof root.querySelectorAll !== "function") {
        return;
      }

      const wrappers = Array.from(root.querySelectorAll("[" + WORD_ATTR + "]"));
      for (const wrapper of wrappers) {
        if (!wrapper.parentNode) {
          continue;
        }
        wrapper.parentNode.replaceChild(documentRef.createTextNode(wrapper.textContent || ""), wrapper);
      }
    }

    return {
      enable,
      disable,
      destroy,
      updateSettings,
      refresh,
      flush,
      getStats,
      _private: {
        splitWord,
        hasWordLikeText,
        shouldTransformTextNode
      }
    };
  }

  global.BoldLeadReaderEngine = {
    createReader
  };
})(globalThis);
