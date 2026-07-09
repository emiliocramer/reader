import * as PDFLib from "../vendor/pdf-lib/pdf-lib.esm.js";

(async function startBoldLeadPdfViewer(global) {
  "use strict";

  const API = global.BoldLeadExtensionAPI;
  const Config = global.BoldLeadReaderConfig;
  const PdfBionicize = global.BoldLeadPdfBionicize;

  const pdfSurface = document.getElementById("pdfSurface");
  const diagnostic = document.getElementById("diagnostic");
  const params = new URLSearchParams(global.location.search);
  const fileUrl = params.get("file");

  if (!API || !Config || !PdfBionicize) {
    showError("Extension runtime was not available.");
    return;
  }

  const settings = await loadSettings();

  if (!fileUrl) {
    showError("No PDF URL was provided.");
    return;
  }

  notifyReady();

  try {
    const bytes = await getPdfBytes(fileUrl);
    await renderNativeBionicPdf(bytes, settings);
  } catch (error) {
    showError(error && error.message ? error.message : String(error));
  }

  async function loadSettings() {
    try {
      const storedSettings = await API.storageGet(Config.DEFAULT_SETTINGS);
      return Config.normalizeSettings(storedSettings);
    } catch (_error) {
      return Config.DEFAULT_SETTINGS;
    }
  }

  async function getPdfBytes(url) {
    try {
      return await waitForParentPdfBytes(url, 6000);
    } catch (_error) {
      return fetchPdfBytes(url);
    }
  }

  async function fetchPdfBytes(url) {
    const response = await fetch(url, {
      credentials: "include",
      cache: "default"
    });

    if (!response.ok) {
      throw new Error("Could not fetch PDF: HTTP " + response.status);
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  async function renderNativeBionicPdf(bytes, settings) {
    if (!settings.enabled) {
      renderPdfBytes(bytes);
      return;
    }

    const result = await PdfBionicize.bionicizePdfBytes(bytes.slice(), {
      pdfLib: PDFLib,
      fixationRatio: settings.fixationRatio,
      minFixation: settings.minFixation,
      maxFixation: settings.maxFixation,
      strokeWidth: strokeWidthFor(settings.fontWeight)
    });

    if (!result.stats || result.stats.boldGlyphs <= 0) {
      throw new Error("No embedded PDF text was rewritten.");
    }

    renderPdfBytes(result.bytes);
  }

  function renderPdfBytes(bytes) {
    const blobUrl = URL.createObjectURL(new Blob([bytes], {
      type: "application/pdf"
    }));
    pdfSurface.src = blobUrl;
  }

  function showError(message) {
    diagnostic.textContent = message;
    global.console.error("reader PDF unavailable:", message);
  }

  function strokeWidthFor(fontWeight) {
    const normalized = Math.min(900, Math.max(500, Number(fontWeight) || 700));
    return 0.025 + ((normalized - 500) / 400) * 0.05;
  }

  function notifyReady() {
    try {
      global.parent.postMessage({
        type: "boldlead-pdf-viewer-ready",
        url: fileUrl
      }, "*");
    } catch (_error) {
      // Parent delivery is best effort; extension-page fetch remains a fallback.
    }
  }

  function waitForParentPdfBytes(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeout = global.setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for page PDF bytes."));
      }, timeoutMs);

      function cleanup() {
        global.clearTimeout(timeout);
        global.removeEventListener("message", onMessage);
      }

      function onMessage(event) {
        const data = event.data;
        if (!data || data.url !== url) {
          return;
        }

        if (data.type === "boldlead-pdf-byte-error") {
          cleanup();
          reject(new Error(data.message || "Page could not provide PDF bytes."));
          return;
        }

        if (data.type === "boldlead-pdf-bytes") {
          cleanup();
          if (!data.buffer) {
            reject(new Error("Page did not provide PDF bytes."));
            return;
          }
          resolve(new Uint8Array(data.buffer));
        }
      }

      global.addEventListener("message", onMessage);
      notifyReady();
    });
  }
})(globalThis);
