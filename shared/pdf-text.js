(function attachBoldLeadPdfText(global) {
  "use strict";

  function textItemsToText(items) {
    let output = "";

    for (const item of items || []) {
      const text = item && typeof item.str === "string" ? item.str : "";
      if (!text) {
        if (item && item.hasEOL) {
          output += "\n";
        }
        continue;
      }

      if (shouldInsertSpace(output, text)) {
        output += " ";
      }
      output += text;

      if (item.hasEOL) {
        output += "\n";
      }
    }

    return output
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/([\p{L}\p{M}])\n([\p{Ll}\p{M}])/gu, "$1$2")
      .replace(/[ \t]{3,}/g, "  ")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();
  }

  function shouldInsertSpace(output, nextText) {
    if (!output || /\s$/u.test(output) || /^\s/u.test(nextText)) {
      return false;
    }
    if (/^[,.;:!?%)}\]'"”’]/u.test(nextText)) {
      return false;
    }
    if (/[(\[{'"“‘]$/u.test(output)) {
      return false;
    }
    return true;
  }

  global.BoldLeadPdfText = {
    textItemsToText
  };
})(globalThis);
