import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createDom, loadScript } from "./helpers.js";

test("sample PDF has extractable text for the extension PDF reader", async () => {
  const data = new Uint8Array(readFileSync(join(process.cwd(), "fixtures", "sample.pdf")));
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const page = await pdf.getPage(1);
  const textContent = await page.getTextContent();
  const dom = createDom();
  loadScript(dom, "shared/pdf-text.js");
  const text = dom.window.BoldLeadPdfText.textItemsToText(textContent.items);

  assert.equal(pdf.numPages, 1);
  assert.match(text, /Every\s+PDF\s+word\s+should\s+become\s+reader\s+text/);
  assert.match(text, /PDF extraction and bionic transformation/);
});
