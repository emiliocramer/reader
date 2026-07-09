import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const root = process.cwd();

function load(dom, path) {
  dom.window.eval(readFileSync(join(root, path), "utf8"));
}

function flush(dom) {
  return new Promise((resolve) => dom.window.setTimeout(resolve, 30));
}

function installPdfRewriteRuntime(dom, bytes = [1, 2, 3]) {
  dom.window.PDFLib = {};
  dom.window.URL.createObjectURL = () => "blob:rewritten-pdf";
  dom.window.fetch = () => Promise.resolve({
    ok: true,
    arrayBuffer() {
      return Promise.resolve(new Uint8Array(bytes).buffer);
    }
  });
  dom.window.BoldLeadPdfBionicize = {
    bionicizePdfBytes(inputBytes) {
      assert.deepEqual(Array.from(inputBytes), bytes);
      return Promise.resolve({
        bytes: new Uint8Array([9, 8, 7]),
        stats: { boldGlyphs: 3 }
      });
    }
  };
}

test("content script rewrites and installs PDF surface in-place on direct PDF URLs", async () => {
  const pdfUrl = "https://example.test/docs/file.pdf";
  const dom = new JSDOM("<!doctype html><html><body><embed type=\"application/pdf\"></body></html>", {
    url: pdfUrl,
    pretendToBeVisual: true,
    runScripts: "outside-only"
  });

  dom.window.chrome = {
    runtime: {
      getURL(path) {
        return "safari-web-extension://reader/" + path;
      }
    }
  };
  installPdfRewriteRuntime(dom);

  load(dom, "shared/browser-api.js");
  load(dom, "shared/config.js");
  load(dom, "shared/pdf-routing.js");
  load(dom, "shared/reader-engine.js");
  load(dom, "content/content.js");
  await flush(dom);

  const surface = dom.window.document.querySelector("[data-reader-rewritten-pdf]");
  assert.ok(surface);
  assert.equal(dom.window.location.href, pdfUrl);
  assert.equal(surface.getAttribute("src"), "blob:rewritten-pdf");
  assert.equal(surface.getAttribute("type"), "application/pdf");
  assert.equal(dom.window.document.getElementById("boldlead-reader-pdf-frame"), null);
});

test("content script rewrites in-place for the Palantir PDF URL", async () => {
  const pdfUrl = "https://assets.ctfassets.net/xrfr7uokpv1b/yF0AXklHQd7K3SqKICNTM/e9f9167d1b3c7cce56ab3b8c4cc572da/Palantir_-_Institutional_Sovereignty_in_the_Age_of_AI.pdf";
  const dom = new JSDOM("<!doctype html><html><body><embed type=\"application/pdf\"></body></html>", {
    url: pdfUrl,
    pretendToBeVisual: true,
    runScripts: "outside-only"
  });

  dom.window.chrome = {
    runtime: {
      getURL(path) {
        return "safari-web-extension://reader/" + path;
      }
    }
  };
  installPdfRewriteRuntime(dom);

  load(dom, "shared/browser-api.js");
  load(dom, "shared/config.js");
  load(dom, "shared/pdf-routing.js");
  load(dom, "shared/reader-engine.js");
  load(dom, "content/content.js");
  await flush(dom);

  const surface = dom.window.document.querySelector("[data-reader-rewritten-pdf]");
  assert.ok(surface);
  assert.equal(dom.window.location.href, pdfUrl);
  assert.equal(surface.getAttribute("src"), "blob:rewritten-pdf");
});

test("content script rewrites in-place for PDF embeds without .pdf URL suffix", async () => {
  const pageUrl = "https://arxiv.org/pdf/1706.03762";
  const dom = new JSDOM("<!doctype html><html><body><embed type=\"application/pdf\" src=\"https://arxiv.org/pdf/1706.03762\"></body></html>", {
    url: pageUrl,
    pretendToBeVisual: true,
    runScripts: "outside-only"
  });

  dom.window.chrome = {
    runtime: {
      getURL(path) {
        return "safari-web-extension://reader/" + path;
      }
    }
  };
  installPdfRewriteRuntime(dom);

  load(dom, "shared/browser-api.js");
  load(dom, "shared/config.js");
  load(dom, "shared/pdf-routing.js");
  load(dom, "shared/reader-engine.js");
  load(dom, "content/content.js");
  await flush(dom);

  const surface = dom.window.document.querySelector("[data-reader-rewritten-pdf]");
  assert.ok(surface);
  assert.equal(dom.window.location.href, pageUrl);
  assert.equal(surface.getAttribute("src"), "blob:rewritten-pdf");
});

test("content script does not mount PDF reader when disabled in settings", async () => {
  const pdfUrl = "https://example.test/docs/file.pdf";
  const dom = new JSDOM("<!doctype html><html><body><embed type=\"application/pdf\"></body></html>", {
    url: pdfUrl,
    pretendToBeVisual: true,
    runScripts: "outside-only"
  });

  dom.window.chrome = {
    runtime: {
      getURL(path) {
        return "safari-web-extension://reader/" + path;
      }
    },
    storage: {
      local: {
        get(_defaults, callback) {
          callback({ enabled: true, pdfRedirectEnabled: false });
        }
      }
    }
  };
  installPdfRewriteRuntime(dom);

  load(dom, "shared/browser-api.js");
  load(dom, "shared/config.js");
  load(dom, "shared/pdf-routing.js");
  load(dom, "shared/reader-engine.js");
  load(dom, "content/content.js");
  await flush(dom);

  assert.equal(dom.window.document.querySelector("[data-reader-rewritten-pdf]"), null);
});

test("embedded PDF viewer has no visible interface and renders parent-sent PDF bytes", async () => {
  const fileUrl = "https://example.test/file.pdf";
  const html = readFileSync(join(root, "pdf", "viewer.html"), "utf8")
    .replace('<script type="module" src="viewer.js"></script>', "")
    .replace(/<script src="[^"]+"><\/script>/g, "");
  const dom = new JSDOM(html, {
    url: "safari-web-extension://reader/pdf/viewer.html?embedded=1&file=" + encodeURIComponent(fileUrl),
    pretendToBeVisual: true,
    runScripts: "outside-only"
  });

  dom.window.BoldLeadExtensionAPI = {
    storageGet(defaults) {
      return Promise.resolve(defaults);
    },
    getURL(path) {
      return "safari-web-extension://reader/" + path;
    }
  };
  dom.window.URL.createObjectURL = () => "blob:reader-pdf";
  dom.window.BoldLeadReaderConfig = {
    DEFAULT_SETTINGS: { enabled: true, minFixation: 1, fontWeight: 700 },
    normalizeSettings(settings) {
      return settings;
    }
  };
  dom.window.BoldLeadPdfBionicize = {
    bionicizePdfBytes(bytes) {
      assert.equal(bytes[0], 7);
      return Promise.resolve({
        bytes: new Uint8Array([8]),
        stats: { boldGlyphs: 1 }
      });
    }
  };
  dom.window.PDFLibForTesting = {};

  const viewerSource = readFileSync(join(root, "pdf", "viewer.js"), "utf8")
    .replace('import * as PDFLib from "../vendor/pdf-lib/pdf-lib.esm.js";', "const PDFLib = globalThis.PDFLibForTesting;");

  dom.window.eval(viewerSource);
  dom.window.postMessage({
    type: "boldlead-pdf-bytes",
    url: fileUrl,
    buffer: new Uint8Array([7]).buffer
  }, "*");
  await flush(dom);

  assert.equal(dom.window.document.body.textContent.trim(), "");
  assert.equal(dom.window.document.querySelector("h1"), null);
  assert.equal(dom.window.document.getElementById("openOriginal"), null);
  assert.equal(dom.window.document.getElementById("pdfSurface").src, "blob:reader-pdf");
});
