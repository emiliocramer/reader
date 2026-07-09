(function attachBoldLeadPdfRouting(global) {
  "use strict";

  const VIEWER_PATH = "pdf/viewer.html";

  function parseUrl(value) {
    try {
      return new URL(value);
    } catch (_error) {
      return null;
    }
  }

  function isSupportedPdfScheme(protocol) {
    return protocol === "http:" || protocol === "https:" || protocol === "file:";
  }

  function looksLikePdfUrl(value) {
    const url = parseUrl(value);
    if (!url || !isSupportedPdfScheme(url.protocol)) {
      return false;
    }
    return /\.pdf$/i.test(decodeURIComponent(url.pathname));
  }

  function headerValue(headers, name) {
    const lower = String(name).toLowerCase();
    const match = (headers || []).find((header) => {
      return String(header.name || "").toLowerCase() === lower;
    });
    return match ? String(match.value || "") : "";
  }

  function isPdfResponse(headers) {
    const contentType = headerValue(headers, "content-type").toLowerCase();
    const disposition = headerValue(headers, "content-disposition").toLowerCase();
    return (
      contentType.includes("application/pdf") ||
      /filename\*?=.*\.pdf(?:["';\s]|$)/i.test(disposition)
    );
  }

  function makeViewerUrl(pdfUrl, getURL) {
    const base = typeof getURL === "function" ? getURL(VIEWER_PATH) : VIEWER_PATH;
    const viewerUrl = new URL(base, global.location ? global.location.href : "https://extension.invalid/");
    viewerUrl.searchParams.set("file", pdfUrl);
    return viewerUrl.toString();
  }

  function isViewerUrl(value, getURL) {
    const expected = typeof getURL === "function" ? getURL(VIEWER_PATH) : VIEWER_PATH;
    return String(value || "").startsWith(expected);
  }

  global.BoldLeadPdfRouting = {
    VIEWER_PATH,
    looksLikePdfUrl,
    isPdfResponse,
    makeViewerUrl,
    isViewerUrl
  };
})(globalThis);
