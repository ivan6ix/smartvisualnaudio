/* global console, TextEncoder */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CHOICE_KEYS,
  MAX_QUESTIONS_PER_REQUEST,
  PDF_MAX_BYTES,
  PDF_MAX_PAGES,
  PDF_MAX_TEXT_CHARS,
  assessExtractedText,
  createBlankPreviewQuestion,
  evidenceAppearsOnPage,
  hasPdfSignature,
  moveItem,
  normalizeGeneratedQuestion,
  normalizePageText,
  normalizeQuestionCount,
  parsePageRange,
  planQuestionBatches,
  removeRepeatedLines,
  toBuilderQuestion,
  validatePdfFile,
  validatePreviewQuestion,
  validatePreviewQuestions,
} from "../src/lib/aiQuestionGenerator.js";
import { createFakeQuestions } from "../supabase/functions/generate-mcq/mcq.js";
import { buildQuestionStorage, gradeAnswer, sanitizeQuestionForStudent } from "../src/lib/examQuestionTypes.js";

const encoder = new TextEncoder();

// File checks: extension or MIME, size, emptiness, and the PDF signature.
assert.equal(validatePdfFile({ name: "notes.pdf", type: "application/pdf", size: 1000 }), "");
assert.equal(validatePdfFile({ name: "NOTES.PDF", type: "", size: 1000 }), "");
assert.match(validatePdfFile(null), /Choose a PDF/);
assert.match(validatePdfFile({ name: "photo.png", type: "image/png", size: 1000 }), /PDF/);
assert.match(validatePdfFile({ name: "notes.pdf", type: "application/pdf", size: 0 }), /empty/);
assert.match(validatePdfFile({ name: "notes.pdf", type: "application/pdf", size: PDF_MAX_BYTES + 1 }), /10 MB/);
assert.equal(PDF_MAX_BYTES, 10 * 1024 * 1024);
assert.equal(hasPdfSignature(encoder.encode("%PDF-1.7\n...")), true);
assert.equal(hasPdfSignature(encoder.encode("\n\n%PDF-1.4")), true, "A few leading bytes before the header are allowed.");
assert.equal(hasPdfSignature(encoder.encode("\x89PNG\r\n")), false, "A renamed image must be rejected.");
assert.equal(hasPdfSignature(new Uint8Array()), false);

// Page ranges.
assert.deepEqual(parsePageRange("", 12), { start: 1, end: 12, error: "" });
assert.deepEqual(parsePageRange(" 3 - 7 ", 12), { start: 3, end: 7, error: "" });
assert.deepEqual(parsePageRange("5", 12), { start: 5, end: 5, error: "" });
assert.match(parsePageRange("7-3", 12).error, /range/);
assert.match(parsePageRange("0-3", 12).error, /range/);
assert.match(parsePageRange("abc", 12).error, /range/);
assert.match(parsePageRange("10-20", 12).error, /12 pages/);
assert.match(parsePageRange("", PDF_MAX_PAGES + 20).error, /page range/, "Long PDFs need a page range.");
assert.match(parsePageRange("1-101", 300).error, /100 pages/);
assert.deepEqual(parsePageRange("101-200", 300), { start: 101, end: 200, error: "" });

// Text normalization strips control characters and collapses whitespace but keeps line breaks.
assert.equal(normalizePageText("  Cells\u0000 are   the\tbasic\r\n\n\n unit.  "), "Cells are the basic\nunit.");

// Repeated headers and footers are removed when they appear on most pages.
const withFooters = [1, 2, 3, 4, 5].map((page) => ({ page, text: `BIO 101 Lecture Notes\nUnique content for page ${page} about cell structure and the functions of each organelle.\nPage footer` }));
const cleaned = removeRepeatedLines(withFooters);
assert.ok(cleaned.every((page) => !page.text.includes("BIO 101 Lecture Notes") && !page.text.includes("Page footer")));
assert.ok(cleaned.every((page) => page.text.includes(`Unique content for page ${page.page} about`)));
assert.deepEqual(removeRepeatedLines(withFooters.slice(0, 2)), withFooters.slice(0, 2), "Short documents keep every line.");
const repeatedContent = [1, 2, 3, 4].map((page) => ({ page, text: "Enzymes lower activation energy.\nMitochondria produce ATP.\nHeader" }));
assert.deepEqual(removeRepeatedLines(repeatedContent), repeatedContent, "Repeated lines that make up most of the document are kept.");

// Extracted text assessment: empty, scanned, too long, and usable.
const sentence = "Photosynthesis converts light energy into chemical energy stored in glucose molecules. ";
assert.equal(assessExtractedText([]).status, "empty");
assert.equal(assessExtractedText([{ page: 1, text: "Hi" }]).status, "empty");
const scanned = Array.from({ length: 10 }, (_, index) => ({ page: index + 1, text: index < 2 ? sentence.repeat(4) : "" }));
assert.equal(assessExtractedText(scanned).status, "scanned");
assert.match(assessExtractedText(scanned).message, /scanned/);
const usable = Array.from({ length: 6 }, (_, index) => ({ page: index + 1, text: sentence.repeat(6) }));
assert.equal(assessExtractedText(usable).status, "ok");
assert.equal(assessExtractedText(usable).message, "");
const huge = [{ page: 1, text: "x".repeat(PDF_MAX_TEXT_CHARS + 1) }];
assert.equal(assessExtractedText(huge).status, "too_long");

// Question counts and batching.
assert.deepEqual(normalizeQuestionCount("20"), { count: 20, error: "" });
assert.match(normalizeQuestionCount("0").error, /1 and 50/);
assert.match(normalizeQuestionCount("51").error, /1 and 50/);
assert.match(normalizeQuestionCount("2.5").error, /whole number/);
assert.equal(MAX_QUESTIONS_PER_REQUEST, 20);
assert.deepEqual(planQuestionBatches(50, "Hard"), [
  { count: 20, difficulty: "Hard" },
  { count: 20, difficulty: "Hard" },
  { count: 10, difficulty: "Hard" },
]);
assert.deepEqual(planQuestionBatches(5, "Mixed"), [{ count: 5, difficulty: "Mixed" }]);

// Evidence must appear on the cited page (case, spacing and quote style are ignored).
const pageText = "The mitochondrion is the “powerhouse” of the cell.\nIt produces ATP.";
assert.equal(evidenceAppearsOnPage("the mitochondrion is the \"powerhouse\"   of the cell", pageText), true);
assert.equal(evidenceAppearsOnPage("ribosomes make proteins", pageText), false);
assert.equal(evidenceAppearsOnPage("", pageText), false);

// Generated questions are normalized against the pages that were sent.
const pages = [{ page: 1, text: "Intro" }, { page: 4, text: pageText }];
const raw = {
  question: "  What produces ATP? ",
  choices: { A: "Ribosome", B: "Mitochondrion", C: "Nucleus", D: "Golgi body" },
  correct: "B",
  difficulty: "Easy",
  explanation: "The page says the mitochondrion produces ATP.",
  sourcePage: 4,
  evidence: "It produces ATP.",
};
const normalized = normalizeGeneratedQuestion(raw, pages, { points: "2" });
assert.equal(normalized.question, "What produces ATP?");
assert.deepEqual(normalized.choices, raw.choices);
assert.equal(normalized.correct, "B");
assert.equal(normalized.points, "2");
assert.equal(normalized.verified, true);
assert.equal(normalized.source, "ai");
assert.ok(normalized.id);
assert.equal(normalizeGeneratedQuestion({ ...raw, sourcePage: 9 }, pages).verified, false, "A page that was not sent is unverified.");
assert.equal(normalizeGeneratedQuestion({ ...raw, evidence: "Not in the text." }, pages).verified, false);
assert.equal(normalizeGeneratedQuestion({ ...raw, correct: "E" }, pages).correct, "", "An invalid answer key is cleared for the professor to fix.");
assert.equal(normalizeGeneratedQuestion({ ...raw, difficulty: "Brutal" }, pages).difficulty, "Moderate");

// Preview validation: exactly four distinct filled choices, one correct answer, valid points.
assert.equal(validatePreviewQuestion(normalized), "");
assert.match(validatePreviewQuestion({ ...normalized, question: " " }), /question text/);
assert.match(validatePreviewQuestion({ ...normalized, choices: { ...raw.choices, C: "" } }), /all four choices/);
assert.match(validatePreviewQuestion({ ...normalized, choices: { ...raw.choices, C: " ribosome " } }), /different/);
assert.match(validatePreviewQuestion({ ...normalized, correct: "" }), /correct answer/);
assert.match(validatePreviewQuestion({ ...normalized, points: "0" }), /points/);
assert.match(validatePreviewQuestion({ ...normalized, question: "x".repeat(1001) }), /1000/);
assert.deepEqual(validatePreviewQuestions([normalized, { ...normalized, correct: "" }]), { index: 1, message: "Question 2: Select the correct answer." });
assert.deepEqual(validatePreviewQuestions([]), { index: -1, message: "Add at least one question." });
assert.deepEqual(validatePreviewQuestions([normalized]), { index: -1, message: "" });

// Blank manual questions start empty and unverified.
const blank = createBlankPreviewQuestion("1");
assert.equal(blank.source, "manual");
assert.deepEqual(Object.keys(blank.choices), CHOICE_KEYS);
assert.match(validatePreviewQuestion(blank), /question text/);

// Reordering never mutates the original list.
const list = ["a", "b", "c"];
assert.deepEqual(moveItem(list, 0, 1), ["b", "a", "c"]);
assert.deepEqual(moveItem(list, 0, -1), ["a", "b", "c"]);
assert.deepEqual(list, ["a", "b", "c"]);

// Inserted questions are ordinary Multiple Choice builder questions with no AI metadata.
const builderQuestion = toBuilderQuestion(normalized);
assert.equal(builderQuestion.type, "Multiple Choice");
assert.equal(builderQuestion.title, "What produces ATP?");
assert.equal(builderQuestion.points, "2");
assert.equal(builderQuestion.choices.length, 4);
assert.deepEqual(builderQuestion.choices.map((choice) => choice.key), CHOICE_KEYS);
const correctChoice = builderQuestion.choices.find((choice) => choice.id === builderQuestion.correctAnswer);
assert.equal(correctChoice?.value, "Mitochondrion");
assert.equal(builderQuestion.manualGrading, false);
const serialized = JSON.stringify(builderQuestion);
for (const leaked of ["explanation", "evidence", "sourcePage", "verified", "powerhouse", "The page says"]) {
  assert.ok(!serialized.includes(leaked), `AI metadata (${leaked}) must not be stored with the question.`);
}
assert.deepEqual(buildQuestionStorage(builderQuestion).correctAnswers, [builderQuestion.correctAnswer], "Re-storing the question keeps the same answer key.");
assert.equal(gradeAnswer(builderQuestion, builderQuestion.correctAnswer).earnedPoints, 2);
assert.equal(gradeAnswer(builderQuestion, builderQuestion.choices[0].id).earnedPoints, 0);
assert.ok(!JSON.stringify(sanitizeQuestionForStudent(builderQuestion).config).includes("correctAnswer"));

// The sample generator is deterministic, grounded in the text, and respects count and difficulty.
const notes = [
  { page: 1, text: "Photosynthesis converts light energy into chemical energy inside chloroplasts. Chlorophyll absorbs mostly blue and red wavelengths of light." },
  { page: 2, text: "Cellular respiration releases energy from glucose through glycolysis, the Krebs cycle, and oxidative phosphorylation in mitochondria." },
  { page: 3, text: "Enzymes lower the activation energy of reactions without being consumed. Temperature and acidity strongly influence enzyme activity." },
];
const fake = createFakeQuestions({ pages: notes, count: 6, difficulty: "Mixed" });
assert.equal(fake.length, 6);
assert.deepEqual(fake.map((item) => item.difficulty), ["Easy", "Moderate", "Hard", "Easy", "Moderate", "Hard"]);
for (const item of fake) {
  assert.deepEqual(Object.keys(item.choices), CHOICE_KEYS);
  assert.ok(CHOICE_KEYS.includes(item.correct));
  assert.equal(new Set(Object.values(item.choices).map((value) => value.toLowerCase())).size, 4);
  assert.equal(validatePreviewQuestion(normalizeGeneratedQuestion(item, notes)), "");
  assert.equal(normalizeGeneratedQuestion(item, notes).verified, true);
}
assert.deepEqual(createFakeQuestions({ pages: notes, count: 3, difficulty: "Easy" }), createFakeQuestions({ pages: notes, count: 3, difficulty: "Easy" }));
const avoided = createFakeQuestions({ pages: notes, count: 2, difficulty: "Hard", avoidStems: fake.map((item) => item.question) });
assert.ok(avoided.every((item) => !fake.some((other) => other.question === item.question)), "Regenerated questions avoid existing stems.");

// The browser never calls an AI provider directly or reads an AI key.
const sources = [
  "src/lib/aiQuestionGenerator.js",
  "src/lib/aiQuestionClient.js",
  "src/lib/pdfTextExtractor.js",
  "src/components/exam/AiQuestionGeneratorModal.jsx",
  "src/pages/professor/ProfessorCreateExam.jsx",
].map((path) => [path, readFileSync(path, "utf8")]);
for (const [path, source] of sources) {
  assert.doesNotMatch(source, /ANTHROPIC|sk-ant|api\.anthropic\.com|OPENAI|VITE_[A-Z_]*KEY/, `${path} must not reach an AI provider or key from the browser.`);
}

// pdf.js loads lazily, without XFA forms, and maps password and corrupt files to clear errors.
// Versions before 4.2.67 could run script from a crafted font (CVE-2024-4367).
const extractor = sources.find(([path]) => path.endsWith("pdfTextExtractor.js"))[1];
assert.match(extractor, /import\("pdfjs-dist"\)/, "pdf.js must stay out of the main bundle.");
assert.doesNotMatch(extractor, /^import .*pdfjs-dist/m, "pdf.js must not be imported statically.");
assert.match(extractor, /enableXfa: false/);
const pdfjsVersion = JSON.parse(readFileSync("package.json", "utf8")).dependencies["pdfjs-dist"];
assert.ok(Number(pdfjsVersion.match(/\d+/)[0]) >= 5, "pdfjs-dist must stay on a patched major version.");
assert.match(extractor, /PasswordException[\s\S]*password-protected/);
assert.match(extractor, /hasPdfSignature/);

// The modal is wired into Create Exam and inserts through the normal question list.
const createExam = sources.find(([path]) => path.endsWith("ProfessorCreateExam.jsx"))[1];
assert.match(createExam, /Generate from PDF/);
assert.match(createExam, /<AiQuestionGeneratorModal[\s\S]*onInsert=\{handleInsertGeneratedQuestions\}/);
assert.match(createExam, /function handleInsertGeneratedQuestions\(generated\) \{\s*setQuestions\(\(current\) => \[\.\.\.current, \.\.\.generated\]\);/);
const modal = sources.find(([path]) => path.endsWith("AiQuestionGeneratorModal.jsx"))[1];
assert.match(modal, /createPortal\(/, "The generator modal must render in a body portal so its backdrop covers the page.");
assert.match(modal, /className="professor-share-backdrop professor-ai-backdrop" onClick=/);
assert.match(modal, /toBuilderQuestion/);
assert.match(modal, /generate = requestGeneratedQuestions/, "The modal must generate through the authenticated Edge Function.");
assert.doesNotMatch(modal, /fakeMcqGenerator|createFakeQuestions/, "Sample questions come from the server, not the browser.");

// The client calls the Edge Function with a fresh request key and surfaces the server's message.
const client = sources.find(([path]) => path.endsWith("aiQuestionClient.js"))[1];
assert.match(client, /supabase\.functions\.invoke\("generate-mcq"/);
assert.match(client, /requestKey: crypto\.randomUUID\(\)/);
assert.match(client, /signal/);
assert.match(client, /error\.context/);

console.log("AI question generator checks passed.");
