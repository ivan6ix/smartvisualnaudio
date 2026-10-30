/* global Worker, URL */
// Browser side of the OWL-ViT worker: one shared worker per page, loaded on first use.
let worker = null;
let readyPromise = null;
let nextRequestId = 0;
const pending = new Map();
const progressListeners = new Set();

function getWorker() {
  if (worker) return worker;
  // Written exactly as `new Worker(new URL(..., import.meta.url))` so Vite bundles the worker.
  worker = new Worker(new URL("../workers/owlDetector.worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (event) => {
    const message = event.data || {};
    if (message.type === "progress") {
      progressListeners.forEach((listener) => listener(message));
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.type === "error") request.reject(new Error(message.message));
    else request.resolve(message);
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || "The browser AI stopped unexpectedly.");
    pending.forEach((request) => request.reject(error));
    pending.clear();
    worker?.terminate();
    worker = null;
    readyPromise = null;
  };
  return worker;
}

function send(message) {
  nextRequestId += 1;
  const id = nextRequestId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...message, id });
  });
}

// Starts the model download (about 150 MB the first time; the browser keeps it afterwards).
// onProgress receives { loaded, total } in bytes while files download.
export function loadOwlDetector(onProgress) {
  if (onProgress) progressListeners.add(onProgress);
  readyPromise ||= send({ type: "load" }).catch((error) => {
    readyPromise = null;
    throw error;
  });
  return readyPromise.finally(() => {
    if (onProgress) progressListeners.delete(onProgress);
  });
}

// Returns { frames: [{ predictions }] } for the given data-URL images, in order.
export async function detectWithOwl(images) {
  await loadOwlDetector();
  const result = await send({ type: "detect", images });
  return { frames: result.frames };
}
