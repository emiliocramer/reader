import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as PDFLib from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createDom, loadScript } from "./helpers.js";

function bytesToString(bytes) {
  return String.fromCharCode(...bytes);
}

function stringToBytes(value) {
  return new Uint8Array([...value].map((character) => character.charCodeAt(0)));
}

test("rewrites PDF text-show operators with native synthetic bold", () => {
  const dom = createDom();
  loadScript(dom, "shared/pdf-bionicize.js");

  const source = "BT /F1 12 Tf (Hello world) Tj ET";
  const result = dom.window.BoldLeadPdfBionicize.rewriteContentBytes(stringToBytes(source), {
    leadingGlyphs: 1,
    strokeWidth: 0.035
  });
  const rewritten = bytesToString(result.bytes);

  assert.equal(result.changed, true);
  assert.equal(result.boldGlyphs, 2);
  assert.match(rewritten, /2 Tr\s+0\.035 w\s+<48> Tj/s);
  assert.match(rewritten, /<656c6c6f20> Tj/s);
  assert.match(rewritten, /2 Tr\s+0\.035 w\s+<77> Tj/s);
  assert.match(rewritten, /<6f726c64> Tj/s);
});

test("keeps two-byte CID glyph codes intact while bolding word starts", () => {
  const dom = createDom();
  loadScript(dom, "shared/pdf-bionicize.js");

  const source = "BT /F1 12 Tf [<000C000300B700BD>] TJ ET";
  const result = dom.window.BoldLeadPdfBionicize.rewriteContentBytes(stringToBytes(source), {
    leadingGlyphs: 1,
    strokeWidth: 0.035
  });
  const rewritten = bytesToString(result.bytes);

  assert.equal(result.changed, true);
  assert.equal(result.boldGlyphs, 2);
  assert.match(rewritten, /2 Tr\s+0\.035 w\s+\[ <000c> \] TJ/s);
  assert.match(rewritten, /\[ <0003> \] TJ/s);
  assert.match(rewritten, /2 Tr\s+0\.035 w\s+\[ <00b7> \] TJ/s);
  assert.match(rewritten, /\[ <00bd> \] TJ/s);
});

test("uses fixation ratio with min and max limits for PDF words", () => {
  const dom = createDom();
  loadScript(dom, "shared/pdf-bionicize.js");

  const source = "BT /F1 12 Tf (You should zoom in on the following) Tj ET";
  const result = dom.window.BoldLeadPdfBionicize.rewriteContentBytes(stringToBytes(source), {
    fixationRatio: 0.5,
    minFixation: 1,
    maxFixation: 4,
    strokeWidth: 0.035
  });
  const rewritten = bytesToString(result.bytes);

  assert.equal(result.changed, true);
  assert.match(rewritten, /<596f> Tj/s);
  assert.match(rewritten, /<73686f> Tj/s);
  assert.match(rewritten, /<7a6f> Tj/s);
  assert.match(rewritten, /<66[0-9a-f]+> Tj/s);
  assert.doesNotMatch(rewritten, /<59> Tj[\s\S]*<6f75> Tj/);
});

test("does not restart fixation inside split PDF words", () => {
  const dom = createDom();
  loadScript(dom, "shared/pdf-bionicize.js");

  const source = "BT /F1 12 Tf [ (nego) 3 (ti) 3 (ation ) (following) ] TJ ET";
  const result = dom.window.BoldLeadPdfBionicize.rewriteContentBytes(stringToBytes(source), {
    fixationRatio: 0.5,
    minFixation: 1,
    maxFixation: 4,
    strokeWidth: 0.035
  });
  const rewritten = bytesToString(result.bytes);

  assert.equal(result.changed, true);
  assert.match(rewritten, /\[ <6e65676f> 3 \] TJ/s);
  assert.match(rewritten, /\[ <7469> 3 <6174696f6e20> \] TJ/s);
  assert.doesNotMatch(rewritten, /2 Tr\s+0\.035 w\s+\[ <7469>/s);
  assert.match(rewritten, /2 Tr\s+0\.035 w\s+\[ <666f6c6c> \] TJ/s);
});

test("uses fill color for synthetic PDF bold stroke and restores stroke color", () => {
  const dom = createDom();
  loadScript(dom, "shared/pdf-bionicize.js");

  const source = "0 0 1 RG 0 g BT /F1 12 Tf (Hello) Tj ET";
  const result = dom.window.BoldLeadPdfBionicize.rewriteContentBytes(stringToBytes(source), {
    fixationRatio: 0.5,
    minFixation: 1,
    maxFixation: 4,
    strokeWidth: 0.035
  });
  const rewritten = bytesToString(result.bytes);

  assert.match(rewritten, /0\s+g\s+BT/s);
  assert.match(rewritten, /0 G\s+2 Tr\s+0\.035 w\s+<48656c6c> Tj/s);
  assert.match(rewritten, /<48656c6c> Tj\s+0 0 1 RG\s+0 Tr/s);
});

test("copies custom fill color space to synthetic PDF bold stroke", () => {
  const dom = createDom();
  loadScript(dom, "shared/pdf-bionicize.js");

  const source = "/Cs1 cs 0.129 sc BT /F1 12 Tf (Text) Tj ET";
  const result = dom.window.BoldLeadPdfBionicize.rewriteContentBytes(stringToBytes(source), {
    fixationRatio: 0.5,
    minFixation: 1,
    maxFixation: 4,
    strokeWidth: 0.035
  });
  const rewritten = bytesToString(result.bytes);

  assert.match(rewritten, /\/Cs1 CS\s+0\.129 SC\s+2 Tr\s+0\.035 w/s);
});

test("bionicized fixture PDF remains a parseable PDF", async () => {
  const dom = createDom();
  loadScript(dom, "shared/pdf-bionicize.js");

  const data = new Uint8Array(readFileSync(join(process.cwd(), "fixtures", "sample.pdf")));
  const result = await dom.window.BoldLeadPdfBionicize.bionicizePdfBytes(data, {
    pdfLib: PDFLib,
    leadingGlyphs: 1,
    strokeWidth: 0.035
  });

  assert.equal(result.stats.pages, 1);
  assert.ok(result.stats.textOperators > 0);
  assert.ok(result.stats.boldGlyphs > 0);

  const pdf = await pdfjsLib.getDocument({
    data: result.bytes.slice(),
    disableAutoFetch: true,
    disableRange: true,
    disableStream: true,
    isEvalSupported: false,
    isOffscreenCanvasSupported: false,
    useWorkerFetch: false
  }).promise;
  const page = await pdf.getPage(1);
  const textContent = await page.getTextContent();

  assert.equal(pdf.numPages, 1);
  assert.ok(textContent.items.length > 0);
});
