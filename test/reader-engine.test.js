import assert from "node:assert/strict";
import { test } from "node:test";
import { createDom, flushTimers } from "./helpers.js";

test("transforms headings, paragraphs, links, buttons, and code text", async () => {
  const dom = createDom(`<!doctype html>
    <html>
      <body>
        <h1>Every single heading word</h1>
        <p>Every paragraph word is transformed.</p>
        <a href="#">Every link word</a>
        <button>Every button word</button>
        <pre>Every preformatted word</pre>
        <code>Every code word</code>
      </body>
    </html>`);

  const reader = dom.window.BoldLeadReaderEngine.createReader({
    document: dom.window.document,
    window: dom.window,
    settings: dom.window.BoldLeadReaderConfig.DEFAULT_SETTINGS
  });

  reader.enable();
  await flushTimers(dom);

  assert.equal(dom.window.document.body.textContent.replace(/\s+/g, " ").trim(), [
    "Every single heading word",
    "Every paragraph word is transformed.",
    "Every link word",
    "Every button word",
    "Every preformatted word",
    "Every code word"
  ].join(" "));
  assert.equal(dom.window.document.querySelectorAll("[data-boldlead-word]").length, 21);
  assert.equal(dom.window.document.querySelectorAll("code [data-boldlead-word]").length, 3);
  assert.equal(dom.window.document.querySelectorAll("pre [data-boldlead-word]").length, 3);
});

test("uses the configured fixation width", async () => {
  const dom = createDom("<p>reading exhaustive</p>");
  const reader = dom.window.BoldLeadReaderEngine.createReader({
    document: dom.window.document,
    window: dom.window,
    settings: {
      enabled: true,
      fixationRatio: 0.5,
      minFixation: 1,
      maxFixation: 8
    }
  });

  reader.enable();
  await flushTimers(dom);

  const fixationText = Array.from(
    dom.window.document.querySelectorAll("[data-boldlead-fixation]")
  ).map((node) => node.textContent);

  assert.deepEqual(fixationText, ["read", "exhau"]);
});

test("does not alter scripts, styles, or form controls", async () => {
  const dom = createDom(`<!doctype html>
    <body>
      <script>const words = "not changed";</script>
      <style>.words { content: "not changed"; }</style>
      <input value="not changed">
      <textarea>not changed</textarea>
      <div contenteditable="true">not changed</div>
      <p>changed words</p>
    </body>`);
  const reader = dom.window.BoldLeadReaderEngine.createReader({
    document: dom.window.document,
    window: dom.window,
    settings: dom.window.BoldLeadReaderConfig.DEFAULT_SETTINGS
  });

  reader.enable();
  await flushTimers(dom);

  assert.equal(dom.window.document.querySelectorAll("[data-boldlead-word]").length, 4);
  assert.equal(dom.window.document.querySelector("textarea").value, "not changed");
  assert.equal(dom.window.document.querySelector("[contenteditable]").querySelectorAll("[data-boldlead-word]").length, 2);
});

test("does not alter document head or title", async () => {
  const dom = createDom(`<!doctype html>
    <html>
      <head>
        <title>Important Page Title | Dashboard</title>
        <meta name="description" content="Important description text">
      </head>
      <body>
        <p>visible words</p>
      </body>
    </html>`);
  const reader = dom.window.BoldLeadReaderEngine.createReader({
    document: dom.window.document,
    window: dom.window,
    settings: dom.window.BoldLeadReaderConfig.DEFAULT_SETTINGS
  });

  reader.enable();
  await flushTimers(dom);

  assert.equal(dom.window.document.title, "Important Page Title | Dashboard");
  assert.equal(dom.window.document.head.querySelectorAll("[data-boldlead-word]").length, 0);
  assert.equal(dom.window.document.body.querySelectorAll("[data-boldlead-word]").length, 2);
});


test("can skip editable content when configured", async () => {
  const dom = createDom('<div contenteditable="true">editable words</div><p>visible words</p>');
  const reader = dom.window.BoldLeadReaderEngine.createReader({
    document: dom.window.document,
    window: dom.window,
    settings: Object.assign({}, dom.window.BoldLeadReaderConfig.DEFAULT_SETTINGS, {
      skipEditable: true
    })
  });

  reader.enable();
  await flushTimers(dom);

  assert.equal(dom.window.document.querySelector("[contenteditable]").querySelectorAll("[data-boldlead-word]").length, 0);
  assert.equal(dom.window.document.querySelector("p").querySelectorAll("[data-boldlead-word]").length, 2);
});

test("transforms words added after initial page load", async () => {
  const dom = createDom("<main><p>initial words</p></main>");
  const reader = dom.window.BoldLeadReaderEngine.createReader({
    document: dom.window.document,
    window: dom.window,
    settings: dom.window.BoldLeadReaderConfig.DEFAULT_SETTINGS
  });
  reader.enable();
  await flushTimers(dom);

  const paragraph = dom.window.document.createElement("p");
  paragraph.textContent = "dynamic words arrived";
  dom.window.document.querySelector("main").appendChild(paragraph);
  await flushTimers(dom);

  assert.equal(paragraph.querySelectorAll("[data-boldlead-word]").length, 3);
  assert.equal(paragraph.textContent, "dynamic words arrived");
});

test("transforms character data changes after initial load", async () => {
  const dom = createDom("<p>first words</p>");
  const reader = dom.window.BoldLeadReaderEngine.createReader({
    document: dom.window.document,
    window: dom.window,
    settings: dom.window.BoldLeadReaderConfig.DEFAULT_SETTINGS
  });
  reader.enable();
  await flushTimers(dom);

  const paragraph = dom.window.document.querySelector("p");
  paragraph.textContent = "changed words now";
  await flushTimers(dom);

  assert.equal(paragraph.querySelectorAll("[data-boldlead-word]").length, 3);
});

test("transforms open shadow roots", async () => {
  const dom = createDom("<article><host-element></host-element></article>");
  const host = dom.window.document.querySelector("host-element");
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = "<p>shadow words here</p>";

  const reader = dom.window.BoldLeadReaderEngine.createReader({
    document: dom.window.document,
    window: dom.window,
    settings: dom.window.BoldLeadReaderConfig.DEFAULT_SETTINGS
  });
  reader.enable();
  await flushTimers(dom);

  assert.equal(shadowRoot.querySelectorAll("[data-boldlead-word]").length, 3);
  assert.equal(shadowRoot.textContent, "shadow words here");
});

test("transforms open shadow roots added after enable", async () => {
  const dom = createDom("<article></article>");
  const reader = dom.window.BoldLeadReaderEngine.createReader({
    document: dom.window.document,
    window: dom.window,
    settings: dom.window.BoldLeadReaderConfig.DEFAULT_SETTINGS
  });
  reader.enable();
  await flushTimers(dom);

  const host = dom.window.document.createElement("late-host");
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = "<p>late shadow words</p>";
  dom.window.document.querySelector("article").appendChild(host);
  await flushTimers(dom);

  assert.equal(shadowRoot.querySelectorAll("[data-boldlead-word]").length, 3);

  const dynamic = dom.window.document.createElement("p");
  dynamic.textContent = "new shadow content";
  shadowRoot.appendChild(dynamic);
  await flushTimers(dom);

  assert.equal(dynamic.querySelectorAll("[data-boldlead-word]").length, 3);
});

test("transforms SVG text with SVG tspan wrappers", async () => {
  const dom = createDom(`<!doctype html>
    <body>
      <svg viewBox="0 0 200 40">
        <text x="0" y="20">Every SVG label word</text>
      </svg>
    </body>`);
  const reader = dom.window.BoldLeadReaderEngine.createReader({
    document: dom.window.document,
    window: dom.window,
    settings: dom.window.BoldLeadReaderConfig.DEFAULT_SETTINGS
  });

  reader.enable();
  await flushTimers(dom);

  const text = dom.window.document.querySelector("text");
  const words = text.querySelectorAll("[data-boldlead-word]");
  const fixations = text.querySelectorAll("[data-boldlead-fixation]");
  assert.equal(words.length, 4);
  assert.equal(fixations[0].namespaceURI, "http://www.w3.org/2000/svg");
  assert.equal(fixations[0].tagName.toLowerCase(), "tspan");
  assert.equal(text.textContent, "Every SVG label word");
});

test("restores original visible text when disabled", async () => {
  const dom = createDom("<p>restore every word</p>");
  const reader = dom.window.BoldLeadReaderEngine.createReader({
    document: dom.window.document,
    window: dom.window,
    settings: dom.window.BoldLeadReaderConfig.DEFAULT_SETTINGS
  });
  reader.enable();
  await flushTimers(dom);
  reader.disable();

  assert.equal(dom.window.document.querySelectorAll("[data-boldlead-word]").length, 0);
  assert.equal(dom.window.document.body.textContent.trim(), "restore every word");
});

test("refresh does not duplicate wrappers", async () => {
  const dom = createDom("<p>no duplicate wrappers here</p>");
  const reader = dom.window.BoldLeadReaderEngine.createReader({
    document: dom.window.document,
    window: dom.window,
    settings: dom.window.BoldLeadReaderConfig.DEFAULT_SETTINGS
  });
  reader.enable();
  await flushTimers(dom);
  reader.refresh();
  await flushTimers(dom);

  assert.equal(dom.window.document.querySelectorAll("[data-boldlead-word]").length, 4);
  assert.equal(dom.window.document.querySelectorAll("[data-boldlead-word] [data-boldlead-word]").length, 0);
});

test("handles unicode word and grapheme segmentation", async () => {
  const dom = createDom("<p>cafe naive resume emojis</p>");
  const reader = dom.window.BoldLeadReaderEngine.createReader({
    document: dom.window.document,
    window: dom.window,
    settings: dom.window.BoldLeadReaderConfig.DEFAULT_SETTINGS
  });
  reader.enable();
  await flushTimers(dom);

  assert.equal(dom.window.document.querySelectorAll("[data-boldlead-word]").length, 4);
  assert.equal(dom.window.document.body.textContent.trim(), "cafe naive resume emojis");
});
