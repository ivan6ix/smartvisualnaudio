import { buildQuestionStorage, createChoiceItem } from "./examQuestionTypes.js";

export const PDF_MAX_BYTES = 10 * 1024 * 1024;
export const PDF_MAX_PAGES = 100;
export const PDF_MIN_TEXT_CHARS = 200;
export const PDF_MAX_TEXT_CHARS = 240000;
export const MIN_QUESTION_COUNT = 1;
export const MAX_QUESTION_COUNT = 50;
export const QUESTION_COUNT_OPTIONS = [5, 10, 20, 30, 50];
export const DIFFICULTY_OPTIONS = ["Easy", "Moderate", "Hard", "Mixed"];
export const QUESTION_DIFFICULTIES = ["Easy", "Moderate", "Hard"];
export const CHOICE_KEYS = ["A", "B", "C", "D"];
export const MAX_QUESTION_TEXT_LENGTH = 1000;
export const MAX_CHOICE_TEXT_LENGTH = 300;

// A page with fewer characters than this is treated as having no text layer.
const SCANNED_PAGE_CHARS = 30;
const SCANNED_PAGE_RATIO = 0.6;
const SCANNED_AVERAGE_CHARS = 100;
const REPEATED_LINE_MIN_PAGES = 4;
const REPEATED_LINE_RATIO = 0.6;
const REPEATED_LINE_MAX_LENGTH = 80;
const REPEATED_LINE_MAX_REMOVED_RATIO = 0.5;

function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function validatePdfFile(file) {
  if (!file) return "Choose a PDF file to continue.";
  const isPdfName = /\.pdf$/i.test(String(file.name || ""));
  const isPdfType = file.type === "application/pdf";
  if (!isPdfName && !isPdfType) return "Only PDF files are supported.";
  if (file.type && !isPdfType) return "Only PDF files are supported.";
  if (!Number(file.size)) return "This PDF is empty.";
  if (file.size > PDF_MAX_BYTES) return "PDF files must be 10 MB or smaller.";
  return "";
}

// The PDF header may follow a few junk bytes, so look within the first kilobyte.
export function hasPdfSignature(bytes) {
  if (!bytes?.length) return false;
  const head = Array.from(bytes.subarray(0, 1024), (byte) => String.fromCharCode(byte)).join("");
  return head.includes("%PDF-");
}

export function parsePageRange(input, pageCount) {
  const value = String(input || "").trim();
  if (!value) {
    if (pageCount > PDF_MAX_PAGES) {
      return { start: 1, end: pageCount, error: `This PDF has ${pageCount} pages. Enter a page range of up to ${PDF_MAX_PAGES} pages.` };
    }
    return { start: 1, end: pageCount, error: "" };
  }

  const match = value.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
  const start = match ? Number(match[1]) : 0;
  const end = match ? Number(match[2] || match[1]) : 0;
  if (!match || start < 1 || end < start) return { start: 0, end: 0, error: "Enter a page range like 1-40." };
  if (end > pageCount) return { start: 0, end: 0, error: `This PDF only has ${pageCount} pages.` };
  if (end - start + 1 > PDF_MAX_PAGES) return { start: 0, end: 0, error: `Choose ${PDF_MAX_PAGES} pages or fewer.` };
  return { start, end, error: "" };
}

export function normalizePageText(text) {
  return String(text || "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// Course headers, footers and page labels repeat on most pages and only add noise.
export function removeRepeatedLines(pages) {
  if (pages.length < REPEATED_LINE_MIN_PAGES) return pages;
  const counts = new Map();
  for (const page of pages) {
    for (const line of new Set(page.text.split("\n"))) {
      if (line.length <= REPEATED_LINE_MAX_LENGTH) counts.set(line, (counts.get(line) || 0) + 1);
    }
  }
  const threshold = Math.ceil(pages.length * REPEATED_LINE_RATIO);
  const repeated = new Set([...counts].filter(([, count]) => count >= threshold).map(([line]) => line));
  if (!repeated.size) return pages;
  const cleaned = pages.map((page) => ({
    ...page,
    text: page.text.split("\n").filter((line) => !repeated.has(line)).join("\n"),
  }));
  // Repeated material that makes up most of the document is content, not a header or footer.
  const charCount = (list) => list.reduce((total, page) => total + page.text.length, 0);
  return charCount(cleaned) < charCount(pages) * REPEATED_LINE_MAX_REMOVED_RATIO ? pages : cleaned;
}

export function assessExtractedText(pages) {
  const totalChars = pages.reduce((total, page) => total + page.text.length, 0);
  if (totalChars < PDF_MIN_TEXT_CHARS) {
    return {
      status: "empty",
      totalChars,
      message: "No readable text was found in this PDF. If it is scanned, upload a version with selectable text.",
    };
  }
  if (totalChars > PDF_MAX_TEXT_CHARS) {
    return { status: "too_long", totalChars, message: "This PDF has too much text for one run. Choose a smaller page range." };
  }
  const sparsePages = pages.filter((page) => page.text.length < SCANNED_PAGE_CHARS).length;
  if (sparsePages / pages.length >= SCANNED_PAGE_RATIO || totalChars / pages.length < SCANNED_AVERAGE_CHARS) {
    return {
      status: "scanned",
      totalChars,
      message: "This PDF looks scanned or image-only. Upload a PDF with selectable text; scanned PDFs are not supported yet.",
    };
  }
  return { status: "ok", totalChars, message: "" };
}

export function normalizeQuestionCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count)) return { count: 0, error: "Enter a whole number of questions." };
  if (count < MIN_QUESTION_COUNT || count > MAX_QUESTION_COUNT) {
    return { count: 0, error: `Choose between ${MIN_QUESTION_COUNT} and ${MAX_QUESTION_COUNT} questions.` };
  }
  return { count, error: "" };
}

export function comparableText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, "\"")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function evidenceAppearsOnPage(evidence, pageText) {
  const quote = comparableText(evidence);
  return Boolean(quote) && comparableText(pageText).includes(quote);
}

export function normalizeGeneratedQuestion(raw, pages, { points = "1" } = {}) {
  const choices = Object.fromEntries(CHOICE_KEYS.map((key) => [key, String(raw?.choices?.[key] || "").trim()]));
  const sourcePage = Number(raw?.sourcePage) || 0;
  const page = pages.find((item) => item.page === sourcePage);
  const evidence = String(raw?.evidence || "").trim();
  return {
    id: makeId(),
    source: "generated",
    question: String(raw?.question || "").trim(),
    choices,
    correct: CHOICE_KEYS.includes(raw?.correct) ? raw.correct : "",
    difficulty: QUESTION_DIFFICULTIES.includes(raw?.difficulty) ? raw.difficulty : "Moderate",
    explanation: String(raw?.explanation || "").trim(),
    sourcePage,
    evidence,
    verified: Boolean(page) && evidenceAppearsOnPage(evidence, page.text),
    points: String(points),
  };
}

export function createBlankPreviewQuestion(points = "1") {
  return {
    id: makeId(),
    source: "manual",
    question: "",
    choices: Object.fromEntries(CHOICE_KEYS.map((key) => [key, ""])),
    correct: "",
    difficulty: "Moderate",
    explanation: "",
    sourcePage: 0,
    evidence: "",
    verified: false,
    points: String(points),
  };
}

export function validatePreviewQuestion(item) {
  const question = String(item?.question || "").trim();
  if (!question) return "Enter the question text.";
  if (question.length > MAX_QUESTION_TEXT_LENGTH) return `Keep the question under ${MAX_QUESTION_TEXT_LENGTH} characters.`;
  const values = CHOICE_KEYS.map((key) => String(item.choices?.[key] || "").trim());
  if (values.some((value) => !value)) return "Fill in all four choices.";
  if (values.some((value) => value.length > MAX_CHOICE_TEXT_LENGTH)) return `Keep each choice under ${MAX_CHOICE_TEXT_LENGTH} characters.`;
  if (new Set(values.map(comparableText)).size !== CHOICE_KEYS.length) return "Each choice must be different.";
  if (!CHOICE_KEYS.includes(item.correct)) return "Select the correct answer.";
  const points = Number(item.points);
  if (!Number.isFinite(points) || points < 0.01 || points > 1000) return "Enter points between 0.01 and 1000.";
  return "";
}

export function validatePreviewQuestions(items) {
  if (!items.length) return { index: -1, message: "Add at least one question." };
  for (const [index, item] of items.entries()) {
    const message = validatePreviewQuestion(item);
    if (message) return { index, message: `Question ${index + 1}: ${message}` };
  }
  return { index: -1, message: "" };
}

export function moveItem(list, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// Spreads correct answers across A-D so the answer position gives nothing away.
export function shuffleChoices(item, random = Math.random) {
  const values = CHOICE_KEYS.map((key) => item.choices[key]);
  const correctValue = item.choices[item.correct];
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  const choices = Object.fromEntries(CHOICE_KEYS.map((key, index) => [key, values[index]]));
  return { ...item, choices, correct: CHOICE_KEYS[values.indexOf(correctValue)] || "" };
}

// Only the question, choices, answer key and points are stored. Explanations and evidence stay in the
// preview because question_config is returned to students.
export function toBuilderQuestion(item) {
  const choices = CHOICE_KEYS.map((key) => createChoiceItem(String(item.choices[key]).trim(), key));
  const correct = choices[CHOICE_KEYS.indexOf(item.correct)];
  return buildQuestionStorage({
    title: String(item.question).trim(),
    type: "Multiple Choice",
    choices,
    correctAnswer: correct?.id || "",
    points: String(item.points),
  });
}
