/* global console, TextEncoder */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import {
  CHOICE_KEYS,
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
  removeRepeatedLines,
  shuffleChoices,
  toBuilderQuestion,
  validatePdfFile,
  validatePreviewQuestion,
  validatePreviewQuestions,
} from "../src/lib/pdfQuestionGenerator.js";
import { extractSentences, findDefinition, generateQuestions } from "../src/lib/questionBuilder.js";
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

// Question counts.
assert.deepEqual(normalizeQuestionCount("20"), { count: 20, error: "" });
assert.match(normalizeQuestionCount("0").error, /1 and 50/);
assert.match(normalizeQuestionCount("51").error, /1 and 50/);
assert.match(normalizeQuestionCount("2.5").error, /whole number/);

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
assert.equal(normalized.source, "generated");
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

// Shuffling keeps the correct answer text attached to the correct key.
const shuffled = shuffleChoices(normalized, () => 0);
assert.equal(shuffled.choices[shuffled.correct], "Mitochondrion");
assert.deepEqual(Object.values(shuffled.choices).sort(), Object.values(raw.choices).sort());

// Inserted questions are ordinary Multiple Choice builder questions with no generator metadata.
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
  assert.ok(!serialized.includes(leaked), `Generator metadata (${leaked}) must not be stored with the question.`);
}
assert.deepEqual(buildQuestionStorage(builderQuestion).correctAnswers, [builderQuestion.correctAnswer], "Re-storing the question keeps the same answer key.");
assert.equal(gradeAnswer(builderQuestion, builderQuestion.correctAnswer).earnedPoints, 2);
assert.equal(gradeAnswer(builderQuestion, builderQuestion.choices[0].id).earnedPoints, 0);
assert.ok(!JSON.stringify(sanitizeQuestionForStudent(builderQuestion).config).includes("correctAnswer"));

// The free generator works from the PDF text alone, in the browser.
const notes = [
  { page: 1, text: "Photosynthesis is the process by which green plants convert light energy into chemical energy. Chlorophyll is a green pigment that absorbs mostly blue and red light. The Calvin cycle fixes carbon dioxide into three-carbon sugar molecules inside the chloroplast stroma." },
  { page: 2, text: "Cellular respiration is the process that releases energy from glucose molecules inside living cells. Glycolysis takes place in the cytoplasm and splits one glucose molecule into two pyruvate molecules. The Krebs cycle takes place inside the matrix of the mitochondria." },
  { page: 3, text: "An enzyme is a protein that speeds up chemical reactions without being consumed. The active site is the region of an enzyme where the substrate binds during a reaction. Most human enzymes work best at a temperature of about 37 degrees Celsius." },
  { page: 4, text: "Mitosis is a type of cell division that produces two identical daughter cells. Meiosis produces four haploid gametes with shuffled genetic combinations in each generation. Gregor Mendel published his experiments on pea plants in 1866 after eight years of work." },
  { page: 5, text: "CHAPTER 3 REVIEW\nFigure 2. Table 4\nIt is important to review these notes carefully before the long exam next week." },
  { page: 6, text: "The process of moving water across a membrane is called osmosis. Diffusion refers to the movement of particles from an area of higher concentration to lower concentration. A mutation is a permanent change in the DNA sequence of an organism." },
];

// Sentence selection skips headings, figure labels and sentences that depend on earlier context.
const sentences = extractSentences(notes);
assert.ok(sentences.some((item) => item.page === 1 && item.text.startsWith("Photosynthesis is the process")));
assert.ok(!sentences.some((item) => item.page === 5), "Headings, labels and 'It is…' sentences are skipped.");
assert.ok(sentences.every((item) => /[.!?]$/.test(item.text) && item.text.length >= 50));
const wrapped = extractSentences([{ page: 1, text: "Diffusion refers to the movement of molecules from an area of higher\nconcentration to an area of lower concentration.\nOsmosis moves water across a membrane that is selectively permeable to\nsolutes\nThe membrane controls what enters and leaves the cell in every organism." }]).map((item) => item.text);
assert.deepEqual(wrapped, [
  "Diffusion refers to the movement of molecules from an area of higher concentration to an area of lower concentration.",
  "The membrane controls what enters and leaves the cell in every organism.",
], "Wrapped lines are joined, and a sentence missing its period is not glued onto the next one.");

// Definitions are recognised in the common textbook forms.
assert.deepEqual(findDefinition("Photosynthesis is the process by which green plants convert light energy into chemical energy."), { term: "Photosynthesis", definition: "the process by which green plants convert light energy into chemical energy" });
assert.deepEqual(findDefinition("An enzyme is a protein that speeds up chemical reactions without being consumed."), { term: "enzyme", definition: "a protein that speeds up chemical reactions without being consumed" });
assert.deepEqual(findDefinition("The process of moving water across a membrane is called osmosis."), { term: "osmosis", definition: "the process of moving water across a membrane" });
assert.deepEqual(findDefinition("Diffusion refers to the movement of particles from an area of higher concentration to lower concentration."), { term: "Diffusion", definition: "the movement of particles from an area of higher concentration to lower concentration" });
assert.equal(findDefinition("The Krebs cycle takes place inside the matrix of the mitochondria."), null);
assert.equal(findDefinition("Temperature is important for enzymes to work."), null, "'X is <adjective>' is not a definition.");
assert.equal(findDefinition("It is a protein that speeds up reactions in living cells."), null);

// Every generated question is complete, grounded in its page, and passes the preview checks.
const generated = generateQuestions({ pages: notes, count: 12, difficulty: "Mixed", seed: 1 });
assert.equal(generated.length, 12);
assert.deepEqual(generated.slice(0, 6).map((item) => item.difficulty), ["Easy", "Moderate", "Hard", "Easy", "Moderate", "Hard"]);
const allText = notes.map((page) => page.text).join(" ");
for (const item of generated) {
  const preview = normalizeGeneratedQuestion(item, notes);
  assert.equal(validatePreviewQuestion(preview), "", `Invalid generated question: ${item.question}`);
  assert.equal(preview.verified, true, `Question must cite text on its page: ${item.question}`);
  assert.equal(new Set(Object.values(item.choices).map((value) => value.toLowerCase())).size, 4);
  assert.notEqual(item.sourcePage, 5);
}
assert.equal(new Set(generated.map((item) => item.question)).size, generated.length, "No repeated questions.");
assert.equal(new Set(generated.map((item) => item.evidence)).size, generated.length, "One question per source sentence.");
assert.ok(new Set(generated.map((item) => item.correct)).size >= 3, "Correct answers are spread across positions.");

// All question styles appear on suitable text, and each style keeps its own rules.
const kinds = new Set(generateQuestions({ pages: notes, count: 50, difficulty: "Mixed", seed: 2 }).map((item) => item.kind));
for (const kind of ["term", "definition", "cloze", "number", "statement"]) assert.ok(kinds.has(kind), `Expected a ${kind} question.`);
for (const seed of [1, 2, 3, 4, 5]) {
  for (const item of generateQuestions({ pages: notes, count: 50, difficulty: "Mixed", seed })) {
    const answer = item.choices[item.correct];
    const wrong = CHOICE_KEYS.filter((key) => key !== item.correct).map((key) => item.choices[key]);
    if (item.kind === "term") {
      assert.match(item.question, /^Which term (refers to|is described as)/);
      assert.ok(wrong.every((choice) => !item.question.toLowerCase().includes(choice.toLowerCase())), "Wrong terms must not appear in the question.");
    }
    if (item.kind === "definition") assert.ok([answer, ...wrong].every((choice) => choice.split(" ").length >= 4), "Definition choices are descriptions.");
    if (item.kind === "cloze" || item.kind === "number") {
      assert.match(item.question, /_____/);
      assert.ok(item.evidence.includes(answer), "The blanked answer comes from the sentence.");
      assert.ok(wrong.every((choice) => !item.evidence.toLowerCase().includes(choice.toLowerCase())), "Wrong choices must not appear in the sentence.");
    }
    if (item.kind === "number") assert.ok([answer, ...wrong].every((choice) => /\d/.test(choice)));
    if (item.kind === "statement") {
      assert.equal(answer, item.evidence);
      assert.ok(wrong.every((choice) => !allText.includes(choice)), "Altered statements must not appear in the text.");
    }
  }
}

// Fixed difficulty, determinism, regeneration and short documents.
assert.ok(generateQuestions({ pages: notes, count: 5, difficulty: "Hard", seed: 1 }).every((item) => item.difficulty === "Hard"));
assert.deepEqual(generateQuestions({ pages: notes, count: 6, difficulty: "Easy", seed: 4 }), generateQuestions({ pages: notes, count: 6, difficulty: "Easy", seed: 4 }));
assert.notDeepEqual(generateQuestions({ pages: notes, count: 6, difficulty: "Easy", seed: 4 }).map((item) => item.question), generateQuestions({ pages: notes, count: 6, difficulty: "Easy", seed: 5 }).map((item) => item.question));
const avoided = generateQuestions({ pages: notes, count: 3, difficulty: "Mixed", seed: 1, avoidStems: generated.map((item) => item.question) });
assert.ok(avoided.length >= 1 && avoided.every((item) => !generated.some((other) => other.question === item.question)), "Regenerated questions avoid existing ones.");
const everything = generateQuestions({ pages: notes, count: 50, difficulty: "Mixed", seed: 1 });
assert.ok(everything.length >= 10 && everything.length < 50, "Only as many questions as the text supports.");

// A full-size document stays fast enough for the browser.
const vocabulary = Array.from({ length: 3000 }, (_, index) => `term${index.toString(36)}ology`);
let random = 11;
const nextRandom = () => (random = (random * 1103515245 + 12345) % 2147483648) / 2147483648;
const bigPages = Array.from({ length: 100 }, (_, index) => {
  let text = "";
  while (text.length < 2300) {
    const words = Array.from({ length: 12 }, () => vocabulary[Math.floor(nextRandom() * vocabulary.length)]);
    const subject = `${words[0][0].toUpperCase()}${words[0].slice(1)}`;
    text += nextRandom() < 0.3 ? `${subject} is the process of ${words.slice(1, 9).join(" ")}. ` : `${subject} ${words.slice(1).join(" ")} in ${1900 + (index % 100)}. `;
  }
  return { page: index + 1, text };
});
const started = performance.now();
const big = generateQuestions({ pages: bigPages, count: 50, difficulty: "Mixed", seed: 9 });
const elapsed = performance.now() - started;
assert.equal(big.length, 50);
assert.ok(elapsed < 1500, `Generation took ${Math.round(elapsed)} ms.`);

// No AI provider, Edge Function or key is involved anywhere.
function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(jsx?|mjs)$/.test(name) ? [path] : [];
  });
}
for (const file of sourceFiles("src")) {
  assert.doesNotMatch(readFileSync(file, "utf8"), /generate-mcq|ANTHROPIC|sk-ant|api\.anthropic\.com/, `${file} must not call an AI service.`);
}
assert.equal(existsSync("supabase/functions/generate-mcq"), false);
assert.ok(!readdirSync("supabase/migrations").some((name) => name.includes("ai_question")), "No AI request log migration.");

const sources = [
  "src/lib/pdfQuestionGenerator.js",
  "src/lib/questionBuilder.js",
  "src/lib/pdfTextExtractor.js",
  "src/components/exam/PdfQuestionGeneratorModal.jsx",
  "src/pages/professor/ProfessorCreateExam.jsx",
].map((path) => [path, readFileSync(path, "utf8")]);
const find = (suffix) => sources.find(([path]) => path.endsWith(suffix))[1];

// pdf.js loads lazily, without XFA forms, and maps password and corrupt files to clear errors.
// Versions before 4.2.67 could run script from a crafted font (CVE-2024-4367).
const extractor = find("pdfTextExtractor.js");
assert.match(extractor, /import\("pdfjs-dist"\)/, "pdf.js must stay out of the main bundle.");
assert.doesNotMatch(extractor, /^import .*pdfjs-dist/m, "pdf.js must not be imported statically.");
assert.match(extractor, /enableXfa: false/);
const pdfjsVersion = JSON.parse(readFileSync("package.json", "utf8")).dependencies["pdfjs-dist"];
assert.ok(Number(pdfjsVersion.match(/\d+/)[0]) >= 5, "pdfjs-dist must stay on a patched major version.");
assert.match(extractor, /PasswordException[\s\S]*password-protected/);
assert.match(extractor, /hasPdfSignature/);

// The modal is wired into Create Exam, generates in the browser, and presents a normal feature.
const createExam = find("ProfessorCreateExam.jsx");
assert.match(createExam, /Generate from PDF/);
assert.match(createExam, /<PdfQuestionGeneratorModal[\s\S]*onInsert=\{handleInsertGeneratedQuestions\}/);
assert.match(createExam, /function handleInsertGeneratedQuestions\(generated\) \{\s*setQuestions\(\(current\) => \[\.\.\.current, \.\.\.generated\]\);/);
const modal = find("PdfQuestionGeneratorModal.jsx");
assert.match(modal, /createPortal\(/, "The generator modal must render in a body portal so its backdrop covers the page.");
assert.match(modal, /className="professor-share-backdrop professor-pdfq-backdrop" onClick=/);
assert.match(modal, /toBuilderQuestion/);
assert.match(modal, /generate = generateQuestionsInBrowser/);
assert.doesNotMatch(modal, /\bAI\b|Sample mode|functions\.invoke/, "The generator is a normal, free feature.");
assert.doesNotMatch(find("pdfQuestionGenerator.js"), /\bAI\b/);

console.log("PDF question generator checks passed.");

