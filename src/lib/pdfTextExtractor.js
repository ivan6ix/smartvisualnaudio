import {
  PDF_MAX_PAGES,
  hasPdfSignature,
  normalizePageText,
  parsePageRange,
  removeRepeatedLines,
  validatePdfFile,
} from "./pdfQuestionGenerator.js";
import { detectDocumentKind, readDocxText, readPptxSlides, splitTextIntoParts, textFromBytes, unitForKind, validateDocumentFiles } from "./documentText.js";
import { readPicturePages } from "./imageTextReader.js";

export class PdfReadError extends Error {
  constructor(message) {
    super(message);
    this.name = "PdfReadError";
  }
}

let pdfjsPromise;

// pdf.js and its worker are loaded only when a professor opens the generator.
async function loadPdfjs() {
  pdfjsPromise ||= Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return pdfjsPromise;
}

function pageText(content) {
  return content.items.map((item) => `${item.str || ""}${item.hasEOL ? "\n" : ""}`).join("");
}

export async function extractPdfPages(file, { pageRange = "", onProgress, signal } = {}) {
  const fileError = validatePdfFile(file);
  if (fileError) throw new PdfReadError(fileError);

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasPdfSignature(bytes)) throw new PdfReadError("This file is not a valid PDF.");

  const pdfjs = await loadPdfjs();
  if (signal?.aborted) throw new globalThis.DOMException("Reading was cancelled.", "AbortError");
  const loadingTask = pdfjs.getDocument({ data: bytes, enableXfa: false, stopAtErrors: false });
  const cancelLoading = () => loadingTask.destroy();
  signal?.addEventListener("abort", cancelLoading, { once: true });
  let document;
  try {
    document = await loadingTask.promise;
  } catch (error) {
    signal?.removeEventListener("abort", cancelLoading);
    await loadingTask.destroy();
    if (signal?.aborted) throw new globalThis.DOMException("Reading was cancelled.", "AbortError");
    if (error?.name === "PasswordException") throw new PdfReadError("This PDF is password-protected. Remove the password and upload it again.");
    throw new PdfReadError("This PDF could not be read. It may be damaged.");
  }

  try {
    const range = parsePageRange(pageRange, document.numPages);
    if (range.error) throw new PdfReadError(range.error);

    const pages = [];
    for (let pageNumber = range.start; pageNumber <= range.end && pages.length < PDF_MAX_PAGES; pageNumber += 1) {
      if (signal?.aborted) throw new globalThis.DOMException("Reading was cancelled.", "AbortError");
      onProgress?.({ current: pageNumber - range.start + 1, total: range.end - range.start + 1 });
      const page = await document.getPage(pageNumber);
      try {
        pages.push({ page: pageNumber, text: normalizePageText(pageText(await page.getTextContent())), unit: "page" });
      } finally {
        page.cleanup();
      }
    }
    return { pageCount: document.numPages, pages: removeRepeatedLines(pages) };
  } catch (error) {
    if (error instanceof PdfReadError || error?.name === "AbortError") throw error;
    if (signal?.aborted) throw new globalThis.DOMException("Reading was cancelled.", "AbortError");
    throw new PdfReadError("This PDF could not be read. It may be damaged.");
  } finally {
    signal?.removeEventListener("abort", cancelLoading);
    await loadingTask.destroy();
  }
}

function abortIfCancelled(signal) {
  if (signal?.aborted) throw new globalThis.DOMException("Reading was cancelled.", "AbortError");
}

// Reads any file the question generator accepts: a PDF, Word (.docx), PowerPoint (.pptx) or text (.txt) file,
// or up to 20 pictures. Returns { kind, unit, pageCount, pages } where pages are PDF pages, slides, parts of a
// Word or text file, or pictures. The optional range ("5-30") picks pages, slides, parts or pictures.
export async function extractDocumentPages(files, { pageRange = "", onProgress, signal } = {}) {
  const list = [...files];
  const fileError = validateDocumentFiles(list);
  if (fileError) throw new PdfReadError(fileError);
  const kind = detectDocumentKind(list[0]);
  const unit = unitForKind(kind);

  if (kind === "pdf") {
    const { pageCount, pages } = await extractPdfPages(list[0], {
      pageRange,
      signal,
      onProgress: ({ current, total }) => onProgress?.(`Reading page ${current} of ${total}...`),
    });
    return { kind, unit, pageCount, pages };
  }

  let allPages;
  if (kind === "image") {
    allPages = await readPicturePages(list, {
      signal,
      onProgress: ({ stage, current, total, progress = 0 }) => onProgress?.(stage === "loading"
        ? "Loading text recognition (first time only)..."
        : `Reading text in picture ${current} of ${total}... ${Math.round(progress * 100)}%`),
    });
  } else {
    onProgress?.("Reading the file...");
    const bytes = new Uint8Array(await list[0].arrayBuffer());
    abortIfCancelled(signal);
    try {
      if (kind === "pptx") allPages = readPptxSlides(bytes);
      else allPages = splitTextIntoParts(kind === "docx" ? readDocxText(bytes) : textFromBytes(bytes));
    } catch (error) {
      throw new PdfReadError(error.message || "This file could not be read. It may be damaged.");
    }
  }
  abortIfCancelled(signal);

  const range = parsePageRange(pageRange, allPages.length, unit);
  if (range.error) throw new PdfReadError(range.error);
  const pages = allPages
    .slice(range.start - 1, range.end)
    .map((page) => ({ ...page, text: normalizePageText(page.text) }));
  return { kind, unit, pageCount: allPages.length, pages: removeRepeatedLines(pages) };
}
