import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

const root = process.cwd();

export function createDom(html = "<!doctype html><html><body></body></html>") {
  const dom = new JSDOM(html, {
    url: "https://example.test/",
    pretendToBeVisual: true,
    runScripts: "outside-only"
  });

  dom.window.eval(readFileSync(join(root, "shared", "config.js"), "utf8"));
  dom.window.eval(readFileSync(join(root, "shared", "reader-engine.js"), "utf8"));

  return dom;
}

export function loadScript(dom, path) {
  dom.window.eval(readFileSync(join(root, path), "utf8"));
}

export function flushTimers(dom) {
  return new Promise((resolve) => {
    dom.window.setTimeout(resolve, 10);
  });
}
