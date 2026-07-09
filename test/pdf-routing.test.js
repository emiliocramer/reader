import assert from "node:assert/strict";
import { test } from "node:test";
import { createDom, loadScript } from "./helpers.js";

test("identifies direct PDF URLs", () => {
  const dom = createDom();
  loadScript(dom, "shared/pdf-routing.js");
  const routing = dom.window.BoldLeadPdfRouting;

  assert.equal(routing.looksLikePdfUrl("https://example.test/file.pdf"), true);
  assert.equal(routing.looksLikePdfUrl("https://example.test/file.PDF?download=1"), true);
  assert.equal(routing.looksLikePdfUrl("https://example.test/file.pdf#page=2"), true);
  assert.equal(routing.looksLikePdfUrl("https://example.test/file.html"), false);
});

test("identifies PDF response headers", () => {
  const dom = createDom();
  loadScript(dom, "shared/pdf-routing.js");
  const routing = dom.window.BoldLeadPdfRouting;

  assert.equal(
    routing.isPdfResponse([{ name: "content-type", value: "application/pdf; charset=binary" }]),
    true
  );
  assert.equal(
    routing.isPdfResponse([
      { name: "content-disposition", value: 'attachment; filename="report.pdf"' }
    ]),
    true
  );
  assert.equal(routing.isPdfResponse([{ name: "content-type", value: "text/html" }]), false);
});

test("builds extension viewer URLs", () => {
  const dom = createDom();
  loadScript(dom, "shared/pdf-routing.js");
  const routing = dom.window.BoldLeadPdfRouting;

  const viewerUrl = routing.makeViewerUrl(
    "https://example.test/report.pdf?download=1",
    (path) => "safari-web-extension://example/" + path
  );

  assert.equal(
    viewerUrl,
    "safari-web-extension://example/pdf/viewer.html?file=https%3A%2F%2Fexample.test%2Freport.pdf%3Fdownload%3D1"
  );
});
