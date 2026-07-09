import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as PDFLib from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import "../shared/pdf-bionicize.js";
import "../shared/pdf-text.js";

const root = process.cwd();
const PdfBionicize = globalThis.BoldLeadPdfBionicize;
const PdfText = globalThis.BoldLeadPdfText;

const pdfs = [
  {
    label: "Palantir Institutional Sovereignty",
    url: "https://assets.ctfassets.net/xrfr7uokpv1b/yF0AXklHQd7K3SqKICNTM/e9f9167d1b3c7cce56ab3b8c4cc572da/Palantir_-_Institutional_Sovereignty_in_the_Age_of_AI.pdf"
  },
  {
    label: "arXiv PDF without .pdf suffix",
    url: "https://arxiv.org/pdf/1706.03762"
  },
  {
    label: "IRS Form W-4",
    url: "https://www.irs.gov/pub/irs-pdf/fw4.pdf"
  },
  {
    label: "IRS Publication 1040 CID/form-heavy PDF",
    url: "https://www.irs.gov/pub/irs-pdf/p1040.pdf"
  },
  {
    label: "W3C XSL FOP table/border PDF",
    url: "https://www.w3.org/Style/XSL/TestSuite/results/4/FOP/borders.pdf"
  },
  {
    label: "W3C small dummy PDF",
    url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
  }
];

if (!PdfBionicize || !PdfText) {
  throw new Error("PDF text helper did not load.");
}

for (const pdf of pdfs) {
  await smokePdf(pdf);
}

async function smokePdf(pdf) {
  const response = await fetch(pdf.url, {
    credentials: "include",
    cache: "default",
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(pdf.label + " failed to download: HTTP " + response.status);
  }

  const contentType = response.headers.get("content-type") || "unknown content-type";
  const data = new Uint8Array(await response.arrayBuffer());
  const rewritten = await PdfBionicize.bionicizePdfBytes(data, {
    pdfLib: PDFLib,
    fixationRatio: 0.5,
    minFixation: 1,
    maxFixation: 4,
    strokeWidth: 0.035
  });

  if (!rewritten.stats || rewritten.stats.boldGlyphs <= 0) {
    throw new Error(pdf.label + " did not rewrite any PDF text starts.");
  }

  const document = await pdfjsLib.getDocument({
    data: rewritten.bytes.slice(),
    disableAutoFetch: true,
    disableRange: true,
    disableStream: true,
    isEvalSupported: false,
    isOffscreenCanvasSupported: false,
    useWorkerFetch: false,
    cMapPacked: true,
    cMapUrl: fileUrl("vendor/pdfjs/cmaps/"),
    standardFontDataUrl: fileUrl("vendor/pdfjs/standard_fonts/")
  }).promise;

  let textCharacters = 0;
  let firstText = "";
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent({
      includeMarkedContent: false,
      disableNormalization: false
    });
    const text = PdfText.textItemsToText(textContent.items);
    textCharacters += text.length;
    if (!firstText && text) {
      firstText = text.replace(/\s+/g, " ").slice(0, 96);
    }
  }

  if (textCharacters <= 0) {
    throw new Error(pdf.label + " did not expose embedded text after rewrite.");
  }

  console.log(
    [
      "ok",
      pdf.label,
      "-",
      document.numPages + " pages",
      rewritten.stats.textOperators + " text ops",
      rewritten.stats.boldGlyphs + " word starts",
      textCharacters + " extracted chars",
      "(" + contentType + ")",
      firstText
    ].join(" ")
  );
}

function fileUrl(relativePath) {
  return pathToFileURL(join(root, relativePath)).href;
}
