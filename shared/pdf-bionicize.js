(function attachBoldLeadPdfBionicize(global) {
  "use strict";

  const PDF_OPERATORS = new Set([
    "b", "B", "b*", "B*", "BDC", "BI", "BMC", "BT", "BX",
    "c", "cm", "CS", "cs",
    "d", "d0", "d1", "Do", "DP",
    "EI", "EMC", "ET", "EX",
    "f", "F", "f*", "G", "g", "gs",
    "h", "i", "ID", "j", "J", "K", "k",
    "l", "m", "M", "MP",
    "n", "q", "Q", "re", "RG", "rg", "ri", "s", "S", "SC", "sc", "SCN", "scn", "sh",
    "T*", "Tc", "Td", "TD", "Tf", "Tj", "TJ", "TL", "Tm", "Tr", "Ts", "Tw", "Tz",
    "v", "w", "W", "W*", "y", "'", "\""
  ]);

  async function bionicizePdfBytes(inputBytes, options) {
    const settings = normalizeOptions(options);
    const pdfLib = settings.pdfLib;
    if (!pdfLib || !pdfLib.PDFDocument || !pdfLib.PDFName) {
      throw new Error("pdf-lib runtime was not available.");
    }

    const pdfDoc = await pdfLib.PDFDocument.load(inputBytes, {
      ignoreEncryption: true,
      updateMetadata: false
    });
    const stats = {
      pages: 0,
      streams: 0,
      textOperators: 0,
      boldGlyphs: 0
    };

    for (const page of pdfDoc.getPages()) {
      if (rewritePageContents(pdfDoc, page, pdfLib, settings, stats)) {
        stats.pages += 1;
      }
    }

    const bytes = await pdfDoc.save({
      addDefaultPage: false,
      useObjectStreams: false
    });

    return {
      bytes,
      stats
    };
  }

  function rewritePageContents(pdfDoc, page, pdfLib, settings, stats) {
    const contentsKey = pdfLib.PDFName.of("Contents");
    const contents = page.node.get(contentsKey);
    if (!contents) {
      return false;
    }

    const streams = collectContentStreams(pdfDoc.context, contents, pdfLib);
    if (streams.length === 0) {
      return false;
    }

    const decodedParts = [];
    for (const stream of streams) {
      const decoded = decodeContentStream(stream, pdfLib);
      if (!decoded || decoded.length === 0) {
        continue;
      }
      stats.streams += 1;
      decodedParts.push(decoded);
    }

    if (decodedParts.length === 0) {
      return false;
    }

    const result = rewriteContentBytes(joinByteParts(decodedParts), settings);
    stats.textOperators += result.textOperators;
    stats.boldGlyphs += result.boldGlyphs;

    if (!result.changed) {
      return false;
    }

    const combined = result.bytes;
    const newStream = pdfDoc.context.flateStream(bytesToBinaryString(combined), {});
    const newRef = pdfDoc.context.register(newStream);
    page.node.set(contentsKey, newRef);
    return true;
  }

  function collectContentStreams(context, contents, pdfLib) {
    const lookedUp = context.lookup(contents);
    if (lookedUp instanceof pdfLib.PDFArray) {
      const streams = [];
      for (let index = 0; index < lookedUp.size(); index += 1) {
        const item = context.lookup(lookedUp.get(index));
        if (isPdfStream(item, pdfLib)) {
          streams.push(item);
        }
      }
      return streams;
    }

    return isPdfStream(lookedUp, pdfLib) ? [lookedUp] : [];
  }

  function isPdfStream(value, pdfLib) {
    return (
      value instanceof pdfLib.PDFRawStream ||
      value instanceof pdfLib.PDFContentStream ||
      value instanceof pdfLib.PDFStream
    );
  }

  function decodeContentStream(stream, pdfLib) {
    if (stream instanceof pdfLib.PDFRawStream) {
      return pdfLib.decodePDFRawStream(stream).decode();
    }
    if (stream instanceof pdfLib.PDFContentStream && stream.getUnencodedContents) {
      return stream.getUnencodedContents();
    }
    if (stream.getContents) {
      return stream.getContents();
    }
    return new Uint8Array();
  }

  function rewriteContentBytes(bytes, settings) {
    settings = normalizeOptions(settings);
    const input = bytesToBinaryString(bytes);
    const state = {
      inText: false,
      inWord: false,
      wordUnitsSeen: 0,
      wordFixationLength: 0,
      textRenderingMode: "0",
      lineWidth: "1",
      nonStrokeColorSpaceCommand: "",
      nonStrokeColorCommand: "0 G",
      strokeColorSpaceCommand: "",
      strokeColorCommand: "0 G",
      graphicsStack: []
    };
    const output = [];
    const operands = [];
    const stats = {
      changed: false,
      textOperators: 0,
      boldGlyphs: 0
    };
    let index = 0;

    while (index < input.length) {
      const token = readToken(input, index);
      if (!token) {
        break;
      }
      index = token.end;

      if (token.kind === "operator" && token.value === "BI") {
        flushOperands(output, operands);
        const inlineEnd = findInlineImageEnd(input, token.start);
        output.push(input.slice(token.start, inlineEnd));
        index = inlineEnd;
        continue;
      }

      if (token.kind !== "operator") {
        operands.push(token);
        continue;
      }

      if (token.value === "BT") {
        resetWord(state);
        state.inText = true;
        flushOperator(output, operands, token.value);
        continue;
      }

      if (token.value === "ET") {
        resetWord(state);
        state.inText = false;
        flushOperator(output, operands, token.value);
        continue;
      }

      if (token.value === "q") {
        state.graphicsStack.push(snapshotGraphicsState(state));
      } else if (token.value === "Q") {
        restoreGraphicsState(state);
      }

      if (state.inText && isTextPositionOperator(token.value)) {
        resetWord(state);
      }

      if (token.value === "Tr" && operands.length > 0) {
        state.textRenderingMode = operands[operands.length - 1].raw;
      } else if (token.value === "w" && operands.length > 0) {
        state.lineWidth = operands[operands.length - 1].raw;
      }
      updateColorState(state, operands, token.value);

      if (state.inText && isTextShowOperator(token.value)) {
        const rewritten = rewriteTextShow(operands, token.value, state, settings);
        if (rewritten) {
          output.push(rewritten.source);
          stats.changed = stats.changed || rewritten.changed;
          stats.textOperators += 1;
          stats.boldGlyphs += rewritten.boldGlyphs;
          operands.length = 0;
          continue;
        }
      }

      flushOperator(output, operands, token.value);
    }

    flushOperands(output, operands);
    return {
      bytes: binaryStringToBytes(output.join("")),
      changed: stats.changed,
      textOperators: stats.textOperators,
      boldGlyphs: stats.boldGlyphs
    };
  }

  function rewriteTextShow(operands, operator, state, settings) {
    if (operator === "Tj" || operator === "'") {
      const stringToken = operands[operands.length - 1];
      if (!isStringToken(stringToken)) {
        return null;
      }
      if (operator === "'") {
        resetWord(state);
      }
      const parts = segmentStringToken(stringToken, state, settings);
      return {
        source: (operator === "'" ? "T*\n" : "") + writeSegmentShows(parts, state, settings),
        changed: parts.some((part) => part.mode === "bold"),
        boldGlyphs: countBoldParts(parts)
      };
    }

    if (operator === "\"") {
      if (operands.length < 3 || !isStringToken(operands[operands.length - 1])) {
        return null;
      }
      const wordSpace = operands[operands.length - 3].raw;
      const charSpace = operands[operands.length - 2].raw;
      const stringToken = operands[operands.length - 1];
      resetWord(state);
      const parts = segmentStringToken(stringToken, state, settings);
      return {
        source:
          wordSpace + " Tw\n" +
          charSpace + " Tc\n" +
          "T*\n" +
          writeSegmentShows(parts, state, settings),
        changed: parts.some((part) => part.mode === "bold"),
        boldGlyphs: countBoldParts(parts)
      };
    }

    if (operator === "TJ") {
      const arrayToken = operands[operands.length - 1];
      if (!arrayToken || arrayToken.kind !== "array") {
        return null;
      }
      const rewritten = rewriteTextArray(arrayToken, state, settings);
      return {
        source: rewritten.source,
        changed: rewritten.changed,
        boldGlyphs: rewritten.boldGlyphs
      };
    }

    return null;
  }

  function rewriteTextArray(arrayToken, state, settings) {
    const chunks = [];
    let currentMode = "normal";
    let currentItems = [];
    let changed = false;
    let boldGlyphs = 0;

    function flush() {
      if (currentItems.length === 0) {
        return;
      }
      chunks.push(showArray(currentItems, currentMode, state, settings));
      currentItems = [];
    }

    function append(mode, raw) {
      if (mode !== currentMode && currentItems.length > 0) {
        flush();
      }
      currentMode = mode;
      currentItems.push(raw);
    }

    for (const item of arrayToken.items) {
      if (isStringToken(item)) {
        const parts = segmentStringToken(item, state, settings);
        for (const part of parts) {
          if (part.mode === "bold") {
            changed = true;
            boldGlyphs += part.units;
          }
          append(part.mode, part.raw);
        }
      } else {
        append(currentMode, item.raw);
      }
    }

    flush();

    return {
      source: chunks.join(""),
      changed,
      boldGlyphs
    };
  }

  function segmentStringToken(token, state, settings) {
    const bytes = token.kind === "literalString"
      ? decodeLiteralStringBytes(token.raw)
      : decodeHexStringBytes(token.raw);
    const units = splitStringBytes(bytes, token.kind === "hexString");
    const parts = [];
    let currentMode = null;
    let currentBytes = [];
    let currentUnits = 0;

    function flush() {
      if (currentBytes.length === 0) {
        return;
      }
      parts.push({
        mode: currentMode,
        raw: bytesToHexString(currentBytes),
        units: currentUnits
      });
      currentBytes = [];
      currentUnits = 0;
    }

    for (let index = 0; index < units.length; index += 1) {
      const unit = units[index];
      const separator = isSeparatorUnit(unit);
      let mode = "normal";
      if (separator) {
        resetWord(state);
      } else {
        if (!state.inWord) {
          startWord(state, countWordUnits(units, index), settings);
        }
        if (state.wordUnitsSeen < state.wordFixationLength) {
          mode = "bold";
        }
        state.wordUnitsSeen += 1;
      }

      if (currentMode !== mode && currentBytes.length > 0) {
        flush();
      }
      currentMode = mode;
      currentBytes.push(...unit);
      currentUnits += separator ? 0 : 1;
    }

    flush();
    return parts;
  }

  function writeSegmentShows(parts, state, settings) {
    return parts.map((part) => {
      if (part.mode === "bold") {
        return withBoldGraphics(part.raw + " Tj\n", state, settings);
      }
      return part.raw + " Tj\n";
    }).join("");
  }

  function showArray(items, mode, state, settings) {
    const source = "[ " + items.join(" ") + " ] TJ\n";
    return mode === "bold" ? withBoldGraphics(source, state, settings) : source;
  }

  function withBoldGraphics(source, state, settings) {
    return (
      strokeCommandsForFillColor(state) +
      "2 Tr\n" +
      settings.strokeWidth + " w\n" +
      source +
      restoreStrokeColorCommands(state) +
      state.textRenderingMode + " Tr\n" +
      state.lineWidth + " w\n"
    );
  }

  function strokeCommandsForFillColor(state) {
    return commandLine(state.nonStrokeColorSpaceCommand) + commandLine(state.nonStrokeColorCommand);
  }

  function restoreStrokeColorCommands(state) {
    return commandLine(state.strokeColorSpaceCommand) + commandLine(state.strokeColorCommand);
  }

  function commandLine(command) {
    return command ? command + "\n" : "";
  }

  function updateColorState(state, operands, operator) {
    if (!isColorOperator(operator)) {
      return;
    }

    const operandSource = operands.map((operand) => operand.raw).join(" ");
    if (operator === "cs") {
      state.nonStrokeColorSpaceCommand = operandSource + " CS";
    } else if (operator === "CS") {
      state.strokeColorSpaceCommand = operandSource + " CS";
    } else if (operator === "g" || operator === "rg" || operator === "k") {
      state.nonStrokeColorSpaceCommand = "";
      state.nonStrokeColorCommand = operandSource + " " + operator.toUpperCase();
    } else if (operator === "G" || operator === "RG" || operator === "K") {
      state.strokeColorSpaceCommand = "";
      state.strokeColorCommand = operandSource + " " + operator;
    } else if (operator === "sc" || operator === "scn") {
      state.nonStrokeColorCommand = operandSource + " " + operator.toUpperCase();
    } else if (operator === "SC" || operator === "SCN") {
      state.strokeColorCommand = operandSource + " " + operator;
    }
  }

  function isColorOperator(operator) {
    return operator === "g" ||
      operator === "G" ||
      operator === "rg" ||
      operator === "RG" ||
      operator === "k" ||
      operator === "K" ||
      operator === "cs" ||
      operator === "CS" ||
      operator === "sc" ||
      operator === "SC" ||
      operator === "scn" ||
      operator === "SCN";
  }

  function snapshotGraphicsState(state) {
    return {
      textRenderingMode: state.textRenderingMode,
      lineWidth: state.lineWidth,
      nonStrokeColorSpaceCommand: state.nonStrokeColorSpaceCommand,
      nonStrokeColorCommand: state.nonStrokeColorCommand,
      strokeColorSpaceCommand: state.strokeColorSpaceCommand,
      strokeColorCommand: state.strokeColorCommand
    };
  }

  function restoreGraphicsState(state) {
    const snapshot = state.graphicsStack.pop();
    if (!snapshot) {
      return;
    }
    state.textRenderingMode = snapshot.textRenderingMode;
    state.lineWidth = snapshot.lineWidth;
    state.nonStrokeColorSpaceCommand = snapshot.nonStrokeColorSpaceCommand;
    state.nonStrokeColorCommand = snapshot.nonStrokeColorCommand;
    state.strokeColorSpaceCommand = snapshot.strokeColorSpaceCommand;
    state.strokeColorCommand = snapshot.strokeColorCommand;
  }

  function countBoldParts(parts) {
    return parts.reduce((total, part) => total + (part.mode === "bold" ? part.units : 0), 0);
  }

  function isTextShowOperator(value) {
    return value === "Tj" || value === "TJ" || value === "'" || value === "\"";
  }

  function isTextPositionOperator(value) {
    return value === "Td" || value === "TD" || value === "Tm" || value === "T*";
  }

  function isStringToken(token) {
    return token && (token.kind === "literalString" || token.kind === "hexString");
  }

  function resetWord(state) {
    state.inWord = false;
    state.wordUnitsSeen = 0;
    state.wordFixationLength = 0;
  }

  function startWord(state, wordSpan, settings) {
    state.inWord = true;
    state.wordUnitsSeen = 0;
    state.wordFixationLength = wordSpan.reachesTokenEnd
      ? Math.min(settings.maxFixation, wordSpan.count)
      : fixationLengthFor(wordSpan.count, settings);
  }

  function countWordUnits(units, startIndex) {
    let count = 0;
    for (let index = startIndex; index < units.length; index += 1) {
      if (isSeparatorUnit(units[index])) {
        return {
          count,
          reachesTokenEnd: false
        };
      }
      count += 1;
    }
    return {
      count,
      reachesTokenEnd: true
    };
  }

  function fixationLengthFor(unitCount, settings) {
    if (unitCount <= 1) {
      return unitCount;
    }
    const rawLength = Math.ceil(unitCount * settings.fixationRatio);
    return Math.min(
      unitCount,
      Math.max(settings.minFixation, Math.min(settings.maxFixation, rawLength))
    );
  }

  function flushOperator(output, operands, operator) {
    flushOperands(output, operands);
    output.push(operator + "\n");
  }

  function flushOperands(output, operands) {
    if (operands.length === 0) {
      return;
    }
    output.push(operands.map((operand) => operand.raw).join(" ") + "\n");
    operands.length = 0;
  }

  function readToken(input, start) {
    let index = skipWhitespaceAndComments(input, start);
    if (index >= input.length) {
      return null;
    }

    const tokenStart = index;
    const char = input[index];
    if (char === "(") {
      return readLiteralString(input, index);
    }
    if (char === "<") {
      if (input[index + 1] === "<") {
        return readDictionary(input, index);
      }
      return readHexString(input, index);
    }
    if (char === "[") {
      return readArray(input, index);
    }
    if (char === "/") {
      index += 1;
      while (index < input.length && !isDelimiter(input[index])) {
        index += 1;
      }
      return {
        kind: "name",
        raw: input.slice(tokenStart, index),
        start: tokenStart,
        end: index
      };
    }
    if (char === "'" || char === "\"") {
      return {
        kind: "operator",
        raw: char,
        value: char,
        start: tokenStart,
        end: index + 1
      };
    }
    if (isDelimiter(char)) {
      return {
        kind: "delimiter",
        raw: char,
        value: char,
        start: tokenStart,
        end: index + 1
      };
    }

    while (index < input.length && !isDelimiter(input[index])) {
      index += 1;
    }
    const raw = input.slice(tokenStart, index);
    return {
      kind: PDF_OPERATORS.has(raw) ? "operator" : isNumberToken(raw) ? "number" : "bare",
      raw,
      value: raw,
      start: tokenStart,
      end: index
    };
  }

  function readLiteralString(input, start) {
    let index = start + 1;
    let depth = 1;
    while (index < input.length && depth > 0) {
      const char = input[index];
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
      }
      index += 1;
    }
    return {
      kind: "literalString",
      raw: input.slice(start, index),
      start,
      end: index
    };
  }

  function readHexString(input, start) {
    let index = start + 1;
    while (index < input.length && input[index] !== ">") {
      index += 1;
    }
    index = Math.min(index + 1, input.length);
    return {
      kind: "hexString",
      raw: input.slice(start, index),
      start,
      end: index
    };
  }

  function readDictionary(input, start) {
    let index = start + 2;
    let depth = 1;
    while (index < input.length && depth > 0) {
      if (input[index] === "(") {
        index = readLiteralString(input, index).end;
        continue;
      }
      if (input[index] === "<" && input[index + 1] !== "<") {
        index = readHexString(input, index).end;
        continue;
      }
      if (input[index] === "<" && input[index + 1] === "<") {
        depth += 1;
        index += 2;
        continue;
      }
      if (input[index] === ">" && input[index + 1] === ">") {
        depth -= 1;
        index += 2;
        continue;
      }
      index += 1;
    }
    return {
      kind: "dictionary",
      raw: input.slice(start, index),
      start,
      end: index
    };
  }

  function readArray(input, start) {
    const items = [];
    let index = start + 1;
    while (index < input.length) {
      index = skipWhitespaceAndComments(input, index);
      if (index >= input.length) {
        break;
      }
      if (input[index] === "]") {
        index += 1;
        break;
      }
      const token = readToken(input, index);
      if (!token) {
        break;
      }
      items.push(token);
      index = token.end;
    }
    return {
      kind: "array",
      raw: input.slice(start, index),
      items,
      start,
      end: index
    };
  }

  function findInlineImageEnd(input, start) {
    const match = /\sEI(?:\s|$)/g;
    match.lastIndex = start + 2;
    const found = match.exec(input);
    return found ? found.index + found[0].length : input.length;
  }

  function skipWhitespaceAndComments(input, start) {
    let index = start;
    while (index < input.length) {
      while (index < input.length && isWhitespace(input[index])) {
        index += 1;
      }
      if (input[index] !== "%") {
        return index;
      }
      while (index < input.length && input[index] !== "\n" && input[index] !== "\r") {
        index += 1;
      }
    }
    return index;
  }

  function isDelimiter(char) {
    return (
      isWhitespace(char) ||
      char === "(" ||
      char === ")" ||
      char === "<" ||
      char === ">" ||
      char === "[" ||
      char === "]" ||
      char === "{" ||
      char === "}" ||
      char === "/" ||
      char === "%"
    );
  }

  function isWhitespace(char) {
    return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f" || char === "\0";
  }

  function decodeLiteralStringBytes(raw) {
    const bytes = [];
    let index = 1;
    const end = raw.length - 1;
    while (index < end) {
      const code = raw.charCodeAt(index) & 0xff;
      if (raw[index] !== "\\") {
        bytes.push(code);
        index += 1;
        continue;
      }

      index += 1;
      if (index >= end) {
        break;
      }
      const escaped = raw[index];
      if (escaped === "n") {
        bytes.push(0x0a);
      } else if (escaped === "r") {
        bytes.push(0x0d);
      } else if (escaped === "t") {
        bytes.push(0x09);
      } else if (escaped === "b") {
        bytes.push(0x08);
      } else if (escaped === "f") {
        bytes.push(0x0c);
      } else if (escaped === "\n" || escaped === "\r") {
        if (escaped === "\r" && raw[index + 1] === "\n") {
          index += 1;
        }
      } else if (/[0-7]/.test(escaped)) {
        let octal = escaped;
        for (let count = 0; count < 2 && /[0-7]/.test(raw[index + 1] || ""); count += 1) {
          index += 1;
          octal += raw[index];
        }
        bytes.push(parseInt(octal, 8) & 0xff);
      } else {
        bytes.push(raw.charCodeAt(index) & 0xff);
      }
      index += 1;
    }
    return bytes;
  }

  function decodeHexStringBytes(raw) {
    const bytes = [];
    let highNibble = -1;
    for (let index = 1; index < raw.length - 1; index += 1) {
      const nibble = hexNibble(raw.charCodeAt(index));
      if (nibble < 0) {
        continue;
      }
      if (highNibble < 0) {
        highNibble = nibble;
      } else {
        bytes.push((highNibble << 4) | nibble);
        highNibble = -1;
      }
    }
    if (highNibble >= 0) {
      bytes.push(highNibble << 4);
    }
    return bytes;
  }

  function hexNibble(code) {
    if (code >= 0x30 && code <= 0x39) {
      return code - 0x30;
    }
    if (code >= 0x41 && code <= 0x46) {
      return code - 0x41 + 10;
    }
    if (code >= 0x61 && code <= 0x66) {
      return code - 0x61 + 10;
    }
    return -1;
  }

  function splitStringBytes(bytes, fromHexString) {
    const unitSize = shouldUseDoubleByteUnits(bytes, fromHexString) ? 2 : 1;
    const units = [];
    for (let index = 0; index < bytes.length; index += unitSize) {
      units.push(bytes.slice(index, Math.min(index + unitSize, bytes.length)));
    }
    return units;
  }

  function shouldUseDoubleByteUnits(bytes, fromHexString) {
    if (bytes.length >= 2 && (
      (bytes[0] === 0xfe && bytes[1] === 0xff) ||
      (bytes[0] === 0xff && bytes[1] === 0xfe)
    )) {
      return true;
    }
    if (!fromHexString || bytes.length < 4 || bytes.length % 2 !== 0) {
      return false;
    }

    let printableAscii = 0;
    let zeroHighBytes = 0;
    for (let index = 0; index < bytes.length; index += 1) {
      if (bytes[index] >= 0x20 && bytes[index] <= 0x7e) {
        printableAscii += 1;
      }
      if (index % 2 === 0 && bytes[index] === 0x00) {
        zeroHighBytes += 1;
      }
    }

    if (printableAscii / bytes.length > 0.8) {
      return false;
    }
    return zeroHighBytes > 0 || bytes.length >= 16;
  }

  function isSeparatorUnit(unit) {
    if (unit.length === 2 && (unit[0] === 0xfe || unit[0] === 0xff)) {
      return false;
    }
    if (unit.length === 2) {
      const code = unit[0] * 256 + unit[1];
      return code === 0x0000 ||
        code === 0x0003 ||
        code === 0x0009 ||
        code === 0x000a ||
        code === 0x000d ||
        code === 0x0020 ||
        code === 0x00a0 ||
        code === 0x2000 ||
        code === 0x2001 ||
        code === 0x2002 ||
        code === 0x2003 ||
        code === 0x2004 ||
        code === 0x2005 ||
        code === 0x2006 ||
        code === 0x2007 ||
        code === 0x2008 ||
        code === 0x2009 ||
        code === 0x200a ||
        code === 0x2028 ||
        code === 0x2029 ||
        code === 0x202f ||
        code === 0x205f ||
        code === 0x3000;
    }
    return unit.length === 1 && isSpaceByte(unit[0]);
  }

  function isSpaceByte(byte) {
    return byte === 0x00 ||
      byte === 0x09 ||
      byte === 0x0a ||
      byte === 0x0c ||
      byte === 0x0d ||
      byte === 0x20;
  }

  function bytesToHexString(bytes) {
    let hex = "";
    for (const byte of bytes) {
      hex += byte.toString(16).padStart(2, "0");
    }
    return "<" + hex + ">";
  }

  function bytesToBinaryString(bytes) {
    let output = "";
    for (let index = 0; index < bytes.length; index += 8192) {
      output += String.fromCharCode(...bytes.slice(index, index + 8192));
    }
    return output;
  }

  function binaryStringToBytes(value) {
    const bytes = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
      bytes[index] = value.charCodeAt(index) & 0xff;
    }
    return bytes;
  }

  function joinByteParts(parts) {
    const totalLength = parts.reduce((total, part) => total + part.length + 1, 0);
    const joined = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      joined.set(part, offset);
      offset += part.length;
      joined[offset] = 0x0a;
      offset += 1;
    }
    return joined;
  }

  function normalizeOptions(options) {
    const source = options || {};
    const minFixation = clampInteger(source.minFixation, 1, 16, source.leadingGlyphs || 1);
    const maxFixation = clampInteger(source.maxFixation, minFixation, 16, source.leadingGlyphs || 8);
    return {
      pdfLib: source.pdfLib || global.PDFLib,
      fixationRatio: clampNumber(source.fixationRatio, 0.2, 0.8, 0.5),
      minFixation,
      maxFixation,
      strokeWidth: String(clampNumber(source.strokeWidth, 0.005, 1, 0.035))
    };
  }

  function isNumberToken(raw) {
    if (raw.length === 0 || raw.length > 64) {
      return false;
    }
    let hasDigit = false;
    let hasDot = false;
    for (let index = 0; index < raw.length; index += 1) {
      const code = raw.charCodeAt(index);
      if (index === 0 && (code === 0x2b || code === 0x2d)) {
        continue;
      }
      if (code === 0x2e) {
        if (hasDot) {
          return false;
        }
        hasDot = true;
        continue;
      }
      if (code < 0x30 || code > 0x39) {
        return false;
      }
      hasDigit = true;
    }
    return hasDigit;
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, number));
  }

  function clampInteger(value, min, max, fallback) {
    return Math.round(clampNumber(value, min, max, fallback));
  }

  global.BoldLeadPdfBionicize = {
    bionicizePdfBytes,
    rewriteContentBytes
  };
})(globalThis);
