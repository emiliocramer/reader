import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();

function assertPath(path) {
  assert.equal(existsSync(join(root, path)), true, path + " should exist");
}

test("manifest is valid JSON and references existing files", () => {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.content_scripts[0].run_at, "document_start");
  assert.equal(manifest.content_scripts[0].all_frames, true);
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
  assert.equal(manifest.permissions.includes("webRequest"), false);
  assert.equal(manifest.web_accessible_resources.length, 1);
  assert.ok(manifest.web_accessible_resources[0].resources.includes("pdf/*"));
  assert.ok(manifest.web_accessible_resources[0].resources.includes("shared/*"));
  assert.ok(manifest.web_accessible_resources[0].resources.includes("vendor/pdf-lib/*"));
  assert.ok(manifest.web_accessible_resources[0].resources.includes("vendor/pdfjs/*"));

  for (const icon of Object.values(manifest.icons)) {
    assertPath(icon);
  }
  for (const icon of Object.values(manifest.action.default_icon)) {
    assertPath(icon);
  }
  for (const script of manifest.content_scripts[0].js) {
    assertPath(script);
  }
  for (const style of manifest.content_scripts[0].css) {
    assertPath(style);
  }

  assertPath(manifest.background.service_worker);
  assertPath(manifest.action.default_popup);
  assertPath("pdf/viewer.html");
  assertPath("shared/pdf-compat.js");
  assertPath("shared/pdf-bionicize.js");
  assertPath("vendor/pdf-lib/pdf-lib.esm.js");
  assertPath("vendor/pdf-lib/pdf-lib.js");
  assertPath("vendor/pdfjs/pdf.mjs");
  assertPath("vendor/pdfjs/pdf.worker.mjs");
});
