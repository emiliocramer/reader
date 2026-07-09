import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const outputRoot = join(root, "dist", "extension");
const resourcePaths = [
  "manifest.json",
  "background",
  "content",
  "shared",
  "popup",
  "pdf",
  "icons",
  "vendor"
];

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const resourcePath of resourcePaths) {
  await cp(join(root, resourcePath), join(outputRoot, resourcePath), {
    recursive: true,
    force: true
  });
}
