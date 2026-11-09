// Reads printed text from pictures with Tesseract.js (text recognition in the browser, free, no account).
// The library and its English language data (about 4-5 MB, cached by the browser) load only when a professor
// chooses pictures. Pictures never leave the computer.

let tesseractPromise;

function loadTesseract() {
  tesseractPromise ||= import("tesseract.js");
  return tesseractPromise;
}

function abortError() {
  return new globalThis.DOMException("Reading was cancelled.", "AbortError");
}

export async function readPicturePages(files, { onProgress, signal } = {}) {
  const { createWorker } = await loadTesseract();
  if (signal?.aborted) throw abortError();
  let current = 0;
  onProgress?.({ stage: "loading", current: 0, total: files.length });
  const worker = await createWorker("eng", undefined, {
    logger: (message) => {
      if (message.status === "recognizing text") onProgress?.({ stage: "reading", current, total: files.length, progress: message.progress });
    },
  });
  const stop = () => void worker.terminate();
  signal?.addEventListener("abort", stop, { once: true });
  try {
    const pages = [];
    for (const [index, file] of files.entries()) {
      if (signal?.aborted) throw abortError();
      current = index + 1;
      onProgress?.({ stage: "reading", current, total: files.length, progress: 0 });
      const { data } = await worker.recognize(file);
      pages.push({ page: index + 1, text: String(data?.text || ""), unit: "picture" });
    }
    return pages;
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener("abort", stop);
    if (!signal?.aborted) await worker.terminate();
  }
}
