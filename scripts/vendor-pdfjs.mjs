import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const pdfjsOutputRoot = join(process.cwd(), "vendor", "pdfjs");
const pdfLibRoot = dirname(require.resolve("pdf-lib/package.json"));
const pdfLibOutputRoot = join(process.cwd(), "vendor", "pdf-lib");

await mkdir(pdfjsOutputRoot, { recursive: true });
await mkdir(pdfLibOutputRoot, { recursive: true });

await cp(join(pdfjsRoot, "legacy", "build", "pdf.mjs"), join(pdfjsOutputRoot, "pdf.mjs"));
await cp(join(pdfjsRoot, "legacy", "build", "pdf.worker.mjs"), join(pdfjsOutputRoot, "pdf.worker.mjs"));
await cp(join(pdfjsRoot, "cmaps"), join(pdfjsOutputRoot, "cmaps"), {
  recursive: true,
  force: true
});
await cp(join(pdfjsRoot, "standard_fonts"), join(pdfjsOutputRoot, "standard_fonts"), {
  recursive: true,
  force: true
});
await cp(join(pdfLibRoot, "dist", "pdf-lib.esm.min.js"), join(pdfLibOutputRoot, "pdf-lib.esm.js"));
await cp(join(pdfLibRoot, "dist", "pdf-lib.min.js"), join(pdfLibOutputRoot, "pdf-lib.js"));
