import { strFromU8, unzipSync } from "fflate";

// Reads the text of the files the question generator accepts besides PDF: Word (.docx), PowerPoint (.pptx),
// plain text (.txt) and pictures. Everything here runs in the browser and in Node, so the checks can use it.
// Each file becomes a list of "pages" ({ page, text, unit }): PDF pages, slides, parts of a text or Word file,
// or pictures. The question builder works the same on all of them.

export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const MAX_PICTURE_FILES = 20;
// Word and text files have no fixed pages, so their text is cut into parts of about this many characters.
export const TEXT_PART_CHARS = 2500;
// A zip entry larger than this when unpacked is refused, so a crafted file cannot exhaust memory.
const MAX_UNZIPPED_ENTRY_BYTES = 40 * 1024 * 1024;

export const DOCUMENT_ACCEPT = ".pdf,.docx,.pptx,.txt,.jpg,.jpeg,.png,.webp,application/pdf,text/plain,image/jpeg,image/png,image/webp,"
  + "application/vnd.openxmlformats-officedocument.wordprocessingml.document,"
  + "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const KIND_BY_EXTENSION = {
  pdf: "pdf",
  docx: "docx",
  pptx: "pptx",
  txt: "text",
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
  doc: "old-word",
  ppt: "old-powerpoint",
};

const UNIT_BY_KIND = { pdf: "page", docx: "part", pptx: "slide", text: "part", image: "picture" };

export function detectDocumentKind(file) {
  const extension = String(file?.name || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
  if (KIND_BY_EXTENSION[extension]) return KIND_BY_EXTENSION[extension];
  const type = String(file?.type || "");
  if (type === "application/pdf") return "pdf";
  if (type === "text/plain") return "text";
  if (/^image\/(jpeg|png|webp)$/.test(type)) return "image";
  return "";
}

export function unitForKind(kind) {
  return UNIT_BY_KIND[kind] || "page";
}

// "Page 4", "Slide 4", "Part 4" or "Picture 4"; lowercase for use inside a sentence.
export function sourceLabel(unit, number, { lower = false } = {}) {
  const word = { page: "Page", slide: "Slide", part: "Part", picture: "Picture" }[unit] || "Page";
  return `${lower ? word.toLowerCase() : word} ${number}`;
}

// One file, or several pictures at once. Returns a message for the professor, or "" when the files can be read.
export function validateDocumentFiles(files) {
  const list = [...(files || [])].filter(Boolean);
  if (!list.length) return "Choose a file to continue.";
  const kinds = list.map(detectDocumentKind);
  if (kinds.includes("old-word")) return "Old Word files (.doc) cannot be read. Open it in Word and save it as .docx, then upload it again.";
  if (kinds.includes("old-powerpoint")) return "Old PowerPoint files (.ppt) cannot be read. Open it in PowerPoint and save it as .pptx, then upload it again.";
  if (kinds.some((kind) => !kind)) return "Choose a PDF, Word (.docx), PowerPoint (.pptx), text (.txt) or picture (.jpg, .png, .webp) file.";
  if (list.length > 1 && kinds.some((kind) => kind !== "image")) return "Choose one file at a time. Only pictures can be chosen together.";
  if (list.length > MAX_PICTURE_FILES) return `Choose up to ${MAX_PICTURE_FILES} pictures at a time.`;
  if (list.some((file) => !Number(file.size))) return "This file is empty.";
  if (list.some((file) => file.size > DOCUMENT_MAX_BYTES)) return "Each file must be 10 MB or smaller.";
  return "";
}

export function decodeXmlText(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Text of the paragraphs in Office XML: one line per paragraph, runs joined, tabs and breaks kept as spaces/lines.
function officeParagraphs(xml, { paragraph, text, tab, lineBreak }) {
  const paragraphPattern = new RegExp(`<${paragraph}\\b[^>]*?(?:/>|>([\\s\\S]*?)</${paragraph}>)`, "g");
  const piecePattern = new RegExp(`<${text}\\b[^>]*>([\\s\\S]*?)</${text}>|<${tab}\\b[^>]*/>|<${lineBreak}\\b[^>]*/>`, "g");
  const lines = [];
  for (const match of String(xml || "").matchAll(paragraphPattern)) {
    let line = "";
    for (const piece of String(match[1] || "").matchAll(piecePattern)) {
      if (piece[1] !== undefined) line += decodeXmlText(piece[1]);
      else line += piece[0].startsWith(`<${tab}`) ? " " : "\n";
    }
    lines.push(line);
  }
  return lines.join("\n");
}

export function docxXmlToText(xml) {
  return officeParagraphs(xml, { paragraph: "w:p", text: "w:t", tab: "w:tab", lineBreak: "w:br" });
}

export function slideXmlToText(xml) {
  return officeParagraphs(xml, { paragraph: "a:p", text: "a:t", tab: "a:tab", lineBreak: "a:br" });
}

// Cuts long text into parts at line breaks (and at sentence ends inside very long lines).
export function splitTextIntoParts(text, { size = TEXT_PART_CHARS, unit = "part" } = {}) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n").flatMap((line) => (
    line.length > size ? line.split(/(?<=[.!?])\s+/) : [line]
  ));
  const parts = [];
  let current = [];
  let length = 0;
  for (const line of lines) {
    if (length && length + line.length > size) {
      parts.push(current.join("\n"));
      current = [];
      length = 0;
    }
    current.push(line);
    length += line.length + 1;
  }
  if (current.join("").trim()) parts.push(current.join("\n"));
  return parts.map((part, index) => ({ page: index + 1, text: part, unit }));
}

function unzipEntries(bytes, wanted) {
  let tooLarge = false;
  let entries;
  try {
    entries = unzipSync(bytes, {
      filter: (entry) => {
        if (!wanted(entry.name)) return false;
        if (entry.originalSize > MAX_UNZIPPED_ENTRY_BYTES) {
          tooLarge = true;
          return false;
        }
        return true;
      },
    });
  } catch {
    throw new Error("This file could not be opened. It may be damaged.");
  }
  if (tooLarge) throw new Error("This file is too large to read.");
  return Object.fromEntries(Object.entries(entries).map(([name, data]) => [name, strFromU8(data)]));
}

export function readDocxText(bytes) {
  const entries = unzipEntries(bytes, (name) => name === "word/document.xml");
  if (!entries["word/document.xml"]) throw new Error("This Word file could not be read. Save it again as .docx and upload it.");
  return docxXmlToText(entries["word/document.xml"]);
}

function relationshipTargets(relsXml) {
  const targets = new Map();
  for (const match of String(relsXml || "").matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = match[1].match(/\bId="([^"]+)"/)?.[1];
    const target = match[1].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) targets.set(id, target);
  }
  return targets;
}

function resolvePath(base, target) {
  const parts = `${base}/${target}`.split("/");
  const resolved = [];
  for (const part of parts) {
    if (part === "..") resolved.pop();
    else if (part && part !== ".") resolved.push(part);
  }
  return resolved.join("/");
}

// Slides in presentation order, each with its speaker notes (notes are often full sentences, good for questions).
export function readPptxSlides(bytes) {
  const entries = unzipEntries(bytes, (name) => (
    /^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/slide\d+\.xml|slides\/_rels\/slide\d+\.xml\.rels|notesSlides\/notesSlide\d+\.xml)$/.test(name)
  ));
  const slideNames = Object.keys(entries).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  if (!slideNames.length) throw new Error("This PowerPoint file has no slides that can be read.");

  const presentationTargets = relationshipTargets(entries["ppt/_rels/presentation.xml.rels"]);
  const ordered = [...String(entries["ppt/presentation.xml"] || "").matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)]
    .map((match) => presentationTargets.get(match[1]))
    .filter(Boolean)
    .map((target) => resolvePath("ppt", target))
    .filter((name) => entries[name]);
  const slideNumber = (name) => Number(name.match(/slide(\d+)\.xml$/)[1]);
  const order = ordered.length ? ordered : slideNames.sort((left, right) => slideNumber(left) - slideNumber(right));

  return order.map((name, index) => {
    const relsName = name.replace(/^ppt\/slides\/(slide\d+\.xml)$/, "ppt/slides/_rels/$1.rels");
    const notesTarget = [...relationshipTargets(entries[relsName]).values()].find((target) => /notesSlide\d+\.xml$/.test(target));
    const notesXml = notesTarget ? entries[resolvePath("ppt/slides", notesTarget)] : "";
    // Notes pages repeat the slide number as a field; drop lines that are only a number.
    const notes = slideXmlToText(notesXml).split("\n").filter((line) => !/^\s*\d+\s*$/.test(line)).join("\n");
    return { page: index + 1, text: [slideXmlToText(entries[name]), notes].filter((part) => part.trim()).join("\n"), unit: "slide" };
  });
}

export function textFromBytes(bytes) {
  return new globalThis.TextDecoder("utf-8").decode(bytes).replace(/^\u{FEFF}/u, "");
}
