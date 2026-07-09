(function startBoldLeadContentScript(global) {
  "use strict";

  const API = global.BoldLeadExtensionAPI;
  const Config = global.BoldLeadReaderConfig;
  const Engine = global.BoldLeadReaderEngine;
  const PdfRouting = global.BoldLeadPdfRouting;
  const PdfBionicize = global.BoldLeadPdfBionicize;

  if (!API || !Config || !Engine || !global.document) {
    return;
  }

  if (global.__boldLeadReaderContentScriptStarted) {
    return;
  }
  global.__boldLeadReaderContentScriptStarted = true;

  function isTopFrame() {
    try {
      return global.top === global;
    } catch (_error) {
      return false;
    }
  }

  function absoluteUrl(value) {
    try {
      return new URL(value, global.location.href).toString();
    } catch (_error) {
      return "";
    }
  }

  function findPdfUrl() {
    if (!PdfRouting || !isTopFrame() || PdfRouting.isViewerUrl(global.location.href, API.getURL)) {
      return "";
    }

    const contentType = String(global.document.contentType || "").toLowerCase();
    if (contentType.includes("application/pdf") || PdfRouting.looksLikePdfUrl(global.location.href)) {
      return global.location.href;
    }

    if (!global.document.body) {
      return "";
    }

    const candidates = Array.from(
      global.document.querySelectorAll("embed, object, iframe")
    ).filter((element) => {
      const type = String(element.getAttribute("type") || "").toLowerCase();
      const src = absoluteUrl(element.getAttribute("src") || element.getAttribute("data") || "");
      return type.includes("application/pdf") || PdfRouting.looksLikePdfUrl(src);
    });

    if (candidates.length !== 1) {
      return "";
    }

    const bodyElementChildren = Array.from(global.document.body.children).filter((element) => {
      return element.tagName !== "SCRIPT" && element.tagName !== "STYLE";
    });

    if (bodyElementChildren.length > 1) {
      return "";
    }

    return absoluteUrl(
      candidates[0].getAttribute("src") || candidates[0].getAttribute("data") || global.location.href
    );
  }

  function mountPdfReader(settings) {
    const normalized = Config.normalizeSettings(settings || Config.DEFAULT_SETTINGS);
    if (!normalized.enabled || normalized.pdfRedirectEnabled === false || global.__boldLeadPdfMounted) {
      return;
    }

    const pdfUrl = findPdfUrl();
    if (!pdfUrl) {
      return;
    }

    if (!global.document.body) {
      global.setTimeout(() => mountPdfReader(normalized), 0);
      return;
    }

    global.__boldLeadPdfMounted = true;
    renderRewrittenPdfInPlace(pdfUrl, normalized).catch((error) => {
      global.__boldLeadPdfMounted = false;
      global.console.warn("reader PDF rewrite failed; leaving original PDF visible", error);
    });
  }

  async function fetchPdfBytes(pdfUrl) {
    const response = await global.fetch(pdfUrl, {
      credentials: "include",
      cache: "default"
    });

    if (!response.ok) {
      throw new Error("Could not fetch PDF: HTTP " + response.status);
    }

    return response.arrayBuffer();
  }

  async function renderRewrittenPdfInPlace(pdfUrl, settings) {
    if (!PdfBionicize || !global.PDFLib) {
      throw new Error("PDF byte rewriter was not loaded.");
    }

    let buffer;
    try {
      buffer = await fetchPdfBytes(pdfUrl);
    } catch (_error) {
      buffer = await fetchPdfBytesInPageWorld(pdfUrl);
    }
    const result = await PdfBionicize.bionicizePdfBytes(new Uint8Array(buffer), {
      pdfLib: global.PDFLib,
      fixationRatio: settings.fixationRatio,
      minFixation: settings.minFixation,
      maxFixation: settings.maxFixation,
      strokeWidth: strokeWidthFor(settings.fontWeight)
    });

    if (!result.stats || result.stats.boldGlyphs <= 0) {
      throw new Error("No embedded PDF text was rewritten.");
    }

    installPdfSurface(result.bytes, pdfUrl);
  }

  function installPdfSurface(bytes, originalUrl) {
    const blobUrl = global.URL.createObjectURL(new Blob([bytes], {
      type: "application/pdf"
    }));
    const existingSurface = findExistingPdfSurface(originalUrl);
    const surface = existingSurface || global.document.createElement("embed");

    surface.setAttribute("type", "application/pdf");
    if (surface.tagName === "OBJECT") {
      surface.setAttribute("data", blobUrl);
    } else {
      surface.setAttribute("src", blobUrl);
    }
    surface.setAttribute("data-reader-rewritten-pdf", "true");

    if (!existingSurface) {
      surface.style.setProperty("display", "block", "important");
      surface.style.setProperty("width", "100%", "important");
      surface.style.setProperty("height", "100%", "important");
      surface.style.setProperty("border", "0", "important");
      global.document.body.replaceChildren(surface);
    }
  }

  function findExistingPdfSurface(pdfUrl) {
    const candidates = Array.from(global.document.querySelectorAll("embed, object, iframe"));
    return candidates.find((element) => {
      if (element.getAttribute("data-reader-rewritten-pdf") === "true") {
        return true;
      }
      const type = String(element.getAttribute("type") || "").toLowerCase();
      const src = absoluteUrl(element.getAttribute("src") || element.getAttribute("data") || "");
      return type.includes("application/pdf") || src === pdfUrl || PdfRouting.looksLikePdfUrl(src);
    }) || null;
  }

  function fetchPdfBytesInPageWorld(pdfUrl) {
    return new Promise((resolve, reject) => {
      const requestId = "boldlead-" + Date.now() + "-" + Math.random().toString(16).slice(2);
      const timeout = global.setTimeout(() => {
        cleanup();
        reject(new Error("Timed out fetching PDF bytes in page world."));
      }, 10000);

      function cleanup() {
        global.clearTimeout(timeout);
        global.removeEventListener("message", onMessage);
      }

      function onMessage(event) {
        if (event.source !== global) {
          return;
        }

        const data = event.data;
        if (!data || data.requestId !== requestId) {
          return;
        }

        if (data.type === "boldlead-page-pdf-bytes") {
          cleanup();
          resolve(data.buffer);
        } else if (data.type === "boldlead-page-pdf-byte-error") {
          cleanup();
          reject(new Error(data.message || "Page-world PDF fetch failed."));
        }
      }

      global.addEventListener("message", onMessage);

      const script = global.document.createElement("script");
      script.textContent = [
        "(() => {",
        "const requestId = " + JSON.stringify(requestId) + ";",
        "const url = " + JSON.stringify(pdfUrl) + ";",
        "fetch(url, { credentials: 'include', cache: 'default' })",
        ".then((response) => {",
        "if (!response.ok) throw new Error('Could not fetch PDF: HTTP ' + response.status);",
        "return response.arrayBuffer();",
        "})",
        ".then((buffer) => window.postMessage({ type: 'boldlead-page-pdf-bytes', requestId, url, buffer }, '*', [buffer]))",
        ".catch((error) => window.postMessage({ type: 'boldlead-page-pdf-byte-error', requestId, url, message: error && error.message ? error.message : String(error) }, '*'));",
        "})();"
      ].join("");

      (global.document.documentElement || global.document).appendChild(script);
      script.remove();
    });
  }

  function postPdfMessage(iframe, message, transfer) {
    if (!iframe.contentWindow) {
      return;
    }
    iframe.contentWindow.postMessage(message, "*", transfer || []);
  }

  function strokeWidthFor(fontWeight) {
    const normalized = Math.min(900, Math.max(500, Number(fontWeight) || 700));
    return 0.025 + ((normalized - 500) / 400) * 0.05;
  }

  function schedulePdfMount(settings) {
    mountPdfReader(settings);
    if (global.document.readyState === "loading") {
      global.document.addEventListener(
        "DOMContentLoaded",
        () => {
          mountPdfReader(settings);
        },
        { once: true }
      );
    }
    global.setTimeout(() => mountPdfReader(settings), 250);
    global.setTimeout(() => mountPdfReader(settings), 1000);
  }

  const reader = Engine.createReader({
    document: global.document,
    window: global,
    settings: Config.DEFAULT_SETTINGS
  });

  reader.enable(Config.DEFAULT_SETTINGS);

  API.storageGet(Config.DEFAULT_SETTINGS)
    .then((storedSettings) => {
      const normalized = Config.normalizeSettings(storedSettings);
      reader.updateSettings(normalized);
      schedulePdfMount(normalized);
    })
    .catch(() => {
      reader.updateSettings(Config.DEFAULT_SETTINGS);
      schedulePdfMount(Config.DEFAULT_SETTINGS);
    });

  if (API.raw && API.raw.storage && API.raw.storage.onChanged) {
    API.raw.storage.onChanged.addListener((changes, areaName) => {
      if (areaName && areaName !== "local") {
        return;
      }

      const nextSettings = {};
      for (const key of Object.keys(Config.DEFAULT_SETTINGS)) {
        if (changes[key]) {
          nextSettings[key] = changes[key].newValue;
        }
      }

      if (Object.keys(nextSettings).length > 0) {
        const normalized = Config.normalizeSettings(Object.assign({}, Config.DEFAULT_SETTINGS, nextSettings));
        reader.updateSettings(normalized);
        schedulePdfMount(normalized);
      }
    });
  }

  if (API.raw && API.raw.runtime && API.raw.runtime.onMessage) {
    API.raw.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || message.type !== "boldlead-force-refresh") {
        return false;
      }

      reader.refresh();
      if (typeof sendResponse === "function") {
        sendResponse({
          ok: true,
          stats: reader.getStats()
        });
      }
      return false;
    });
  }
})(globalThis);
