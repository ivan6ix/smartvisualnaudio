/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";

import {
  DOCUMENT_ACCEPT,
  MAX_PICTURE_FILES,
  detectDocumentKind,
  docxXmlToText,
  readDocxText,
  readPptxSlides,
  slideXmlToText,
  sourceLabel,
  splitTextIntoParts,
  textFromBytes,
  validateDocumentFiles,
} from "../src/lib/documentText.js";
import { assessExtractedText, normalizeGeneratedQuestion, parsePageRange } from "../src/lib/pdfQuestionGenerator.js";
import { generateQuestions } from "../src/lib/questionBuilder.js";

const zip = (entries) => zipSync(Object.fromEntries(Object.entries(entries).map(([name, text]) => [name, strToU8(text)])));
const wordParagraph = (...runs) => `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${runs.map((run) => `<w:r><w:t xml:space="preserve">${run}</w:t></w:r>`).join("")}</w:p>`;
const slideParagraph = (text) => `<a:p><a:r><a:rPr lang="en-US"/><a:t>${text}</a:t></a:r></a:p>`;

// File types: PDF, Word, PowerPoint, text and pictures are accepted; old Office formats get a clear message.
assert.equal(detectDocumentKind({ name: "Module.PDF" }), "pdf");
assert.equal(detectDocumentKind({ name: "lesson.docx" }), "docx");
assert.equal(detectDocumentKind({ name: "deck.pptx" }), "pptx");
assert.equal(detectDocumentKind({ name: "notes.txt" }), "text");
assert.equal(detectDocumentKind({ name: "page.JPG" }), "image");
assert.equal(detectDocumentKind({ name: "scan", type: "image/png" }), "image");
assert.equal(detectDocumentKind({ name: "sheet.xlsx" }), "");
for (const extension of [".pdf", ".docx", ".pptx", ".txt", ".jpg", ".png", ".webp"]) assert.ok(DOCUMENT_ACCEPT.includes(extension), `The file picker accepts ${extension}.`);

const file = (name, size = 1000) => ({ name, size });
assert.equal(validateDocumentFiles([file("lesson.docx")]), "");
assert.equal(validateDocumentFiles([file("a.png"), file("b.jpg")]), "", "Several pictures can be chosen together.");
assert.match(validateDocumentFiles([]), /Choose a file/);
assert.match(validateDocumentFiles([file("old.doc")]), /save it as \.docx/);
assert.match(validateDocumentFiles([file("old.ppt")]), /save it as \.pptx/);
assert.match(validateDocumentFiles([file("sheet.xlsx")]), /PDF, Word/);
assert.match(validateDocumentFiles([file("a.pdf"), file("b.pdf")]), /one file at a time/);
assert.match(validateDocumentFiles([file("a.png"), file("b.docx")]), /one file at a time/);
assert.match(validateDocumentFiles(Array.from({ length: MAX_PICTURE_FILES + 1 }, (_, index) => file(`p${index}.png`))), /up to 20 pictures/);
assert.match(validateDocumentFiles([file("big.docx", 11 * 1024 * 1024)]), /10 MB/);
assert.match(validateDocumentFiles([file("empty.txt", 0)]), /empty/);

// Word: paragraphs become lines, runs are joined, entities decoded, tabs and breaks kept.
assert.equal(
  docxXmlToText(`<w:body>${wordParagraph("The cell ", "membrane &amp; wall")}<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t></w:r></w:p><w:p/></w:body>`),
  "The cell membrane & wall\nA B\nC\n",
);
const sentences = [
  "Photosynthesis is the process by which green plants make their own food using sunlight.",
  "The topic sentence is the sentence that tells the reader what the whole paragraph is about.",
  "Supporting details are the sentences that explain and prove the topic sentence of a paragraph.",
  "The concluding sentence is the last sentence that sums up the main idea of the paragraph.",
  "Chlorophyll is the green pigment that absorbs light energy inside the leaves of a plant.",
  "The stomata are the tiny openings on the leaves that let carbon dioxide enter the plant.",
];
const docx = zip({ "[Content_Types].xml": "<Types/>", "word/document.xml": `<w:document><w:body>${sentences.map((sentence) => wordParagraph(sentence)).join("")}</w:body></w:document>` });
const docxText = readDocxText(docx);
assert.ok(sentences.every((sentence) => docxText.includes(sentence)), "Word text is read in full.");
assert.throws(() => readDocxText(zip({ "other.xml": "<x/>" })), /Word file could not be read/);
assert.throws(() => readDocxText(new Uint8Array([1, 2, 3, 4])), /could not be opened/);

// Word and text files are cut into parts at line breaks; each part is one "page" for the generator.
const parts = splitTextIntoParts(Array.from({ length: 40 }, (_, index) => `${sentences[index % sentences.length]} (${index})`).join("\n"), { size: 600 });
assert.ok(parts.length > 3 && parts.every((part) => part.text.length <= 700 && part.unit === "part"));
assert.deepEqual(parts.map((part) => part.page), parts.map((_, index) => index + 1));
assert.equal(splitTextIntoParts("").length, 0);
assert.equal(textFromBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x48, 0x69])), "Hi", "A text file's byte order mark is dropped.");

// PowerPoint: slides in presentation order (not file name order), with speaker notes, without notes slide numbers.
assert.equal(slideXmlToText(`<p:sld>${slideParagraph("Parts of a Paragraph")}${slideParagraph("Topic &lt;main&gt; idea")}</p:sld>`), "Parts of a Paragraph\nTopic <main> idea");
const pptx = zip({
  "ppt/presentation.xml": `<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
  "ppt/_rels/presentation.xml.rels": `<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/><Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>`,
  "ppt/slides/slide1.xml": `<p:sld>${slideParagraph("Second slide title")}</p:sld>`,
  "ppt/slides/slide2.xml": `<p:sld>${slideParagraph("First slide title")}</p:sld>`,
  "ppt/slides/_rels/slide2.xml.rels": `<Relationships><Relationship Id="rId1" Target="../notesSlides/notesSlide7.xml"/></Relationships>`,
  "ppt/notesSlides/notesSlide7.xml": `<p:notes>${slideParagraph(sentences[0])}${slideParagraph("1")}</p:notes>`,
});
const slides = readPptxSlides(pptx);
assert.deepEqual(slides.map((slide) => slide.text), [`First slide title\n${sentences[0]}`, "Second slide title"]);
assert.deepEqual(slides.map((slide) => [slide.page, slide.unit]), [[1, "slide"], [2, "slide"]]);
assert.throws(() => readPptxSlides(zip({ "ppt/presentation.xml": "<p:presentation/>" })), /no slides/);

// Ranges and messages name slides, parts and pictures; only PDFs are checked for scanned pages.
assert.deepEqual(parsePageRange("2-3", 5, "slide"), { start: 2, end: 3, error: "" });
assert.match(parsePageRange("4-9", 5, "slide").error, /only has 5 slides/);
assert.match(parsePageRange("x", 5, "picture").error, /picture range/);
const shortSlides = Array.from({ length: 6 }, (_, index) => ({ page: index + 1, text: index ? "Short bullet" : sentences.join(" "), unit: "slide" }));
assert.equal(assessExtractedText(shortSlides, "pdf").status, "scanned");
assert.equal(assessExtractedText(shortSlides, "pptx").status, "ok", "Short slides are not mistaken for a scanned PDF.");
assert.match(assessExtractedText([{ page: 1, text: "blur", unit: "picture" }], "image").message, /clear, well-lit photo/);
assert.match(assessExtractedText([], "docx").message, /this file/);

// Questions from slides and Word parts name their source the same way.
assert.equal(sourceLabel("slide", 4), "Slide 4");
assert.equal(sourceLabel("picture", 2, { lower: true }), "picture 2");
const slidePages = sentences.map((sentence, index) => ({ page: index + 1, text: `${sentence}\n${sentences[(index + 1) % sentences.length]}`, unit: "slide" }));
const questions = generateQuestions({ pages: slidePages, count: 8, difficulty: "Hard", seed: 3 });
assert.ok(questions.length >= 4, "Questions are made from slide text.");
assert.ok(questions.every((question) => !/according to page|From page/.test(`${question.question} ${question.explanation}`)), "Slide questions do not say page.");
assert.ok(questions.some((question) => /according to slide \d+|From slide \d+/.test(`${question.question} ${question.explanation}`)));
assert.equal(normalizeGeneratedQuestion(questions[0], slidePages).sourceUnit, "slide");
const wordQuestions = generateQuestions({ pages: splitTextIntoParts(docxText), count: 5, difficulty: "Mixed", seed: 1 });
assert.ok(wordQuestions.length >= 3, "Questions are made from a Word file.");

// The window reads every type through one function; text recognition loads only when pictures are chosen.
const modal = readFileSync("src/components/exam/PdfQuestionGeneratorModal.jsx", "utf8");
const extractor = readFileSync("src/lib/pdfTextExtractor.js", "utf8");
const pictures = readFileSync("src/lib/imageTextReader.js", "utf8");
assert.match(modal, /extractDocumentPages\(files, \{ pageRange, signal, onProgress: setProgress \}\)/);
assert.match(modal, /<input accept=\{DOCUMENT_ACCEPT\} multiple/);
assert.match(modal, /sourceLabel\(item\.sourceUnit, item\.sourcePage\)/);
assert.match(extractor, /kind === "image"[\s\S]*readPicturePages/);
assert.match(pictures, /tesseractPromise \|\|= import\("tesseract\.js"\)/, "Tesseract loads lazily.");
assert.doesNotMatch(pictures, /^import .*tesseract/m, "Tesseract must not be in the main bundle.");
assert.match(pictures, /worker\.terminate\(\)/);

console.log("Document question source checks passed.");
