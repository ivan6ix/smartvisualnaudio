import {
  PDF_MAX_PAGES,
  hasPdfSignature,
  normalizePageText,
  parsePageRange,
  removeRepeatedLines,
  validatePdfFile,
} from "./pdfQuestionGenerator.js";

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
        pages.push({ page: pageNumber, text: normalizePageText(pageText(await page.getTextContent())) });
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
