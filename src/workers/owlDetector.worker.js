/* global self, fetch */
// Runs the OWL-ViT open-vocabulary detector off the main thread so the scan page stays responsive.
// Messages in:  { type: "load" } | { type: "detect", id, images: [dataUrl] }
// Messages out: { type: "progress", loaded, total } | { type: "ready", id, device } | { type: "result", id, frames } | { type: "error", id, message }
import { RawImage, env, pipeline } from "@huggingface/transformers";
import { OWL_CANDIDATE_LABELS, OWL_MIN_SCORE, OWL_MODEL_ID, owlResultsToPredictions } from "../lib/owlDetection";

env.allowLocalModels = false;

let detectorPromise = null;
const fileProgress = new Map();

function reportProgress(event) {
  if (event.status !== "progress" || !event.file) return;
  fileProgress.set(event.file, { loaded: event.loaded || 0, total: event.total || 0 });
  let loaded = 0;
  let total = 0;
  fileProgress.forEach((file) => {
    loaded += file.loaded;
    total += file.total;
  });
  self.postMessage({ type: "progress", loaded, total });
}

// Both devices use the same 8-bit model file, so falling back to WebAssembly never downloads it twice.
// (16-bit versions fail on GPUs without f16 support, which many school laptops lack.)
async function createDetector() {
  const hasWebGpu = Boolean(self.navigator?.gpu && await self.navigator.gpu.requestAdapter().catch(() => null));
  if (hasWebGpu) {
    try {
      const detector = await pipeline("zero-shot-object-detection", OWL_MODEL_ID, { device: "webgpu", dtype: "q8", progress_callback: reportProgress });
      return { detector, device: "webgpu" };
    } catch {
      // Unsupported GPU features: run on WebAssembly instead.
    }
  }
  const detector = await pipeline("zero-shot-object-detection", OWL_MODEL_ID, { device: "wasm", dtype: "q8", progress_callback: reportProgress });
  return { detector, device: "wasm" };
}

function loadDetector() {
  detectorPromise ||= createDetector().catch((error) => {
    detectorPromise = null;
    throw error;
  });
  return detectorPromise;
}

self.onmessage = async (event) => {
  const message = event.data || {};
  try {
    const { detector, device } = await loadDetector();
    if (message.type === "load") {
      self.postMessage({ type: "ready", id: message.id, device });
      return;
    }
    if (message.type !== "detect") return;
    const frames = [];
    for (const image of message.images || []) {
      const blob = await (await fetch(image)).blob();
      const results = await detector(await RawImage.fromBlob(blob), OWL_CANDIDATE_LABELS, { threshold: OWL_MIN_SCORE, percentage: true });
      frames.push({ predictions: owlResultsToPredictions(results) });
    }
    self.postMessage({ type: "result", id: message.id, frames });
  } catch (error) {
    self.postMessage({ type: "error", id: message.id, message: error?.message || "The browser AI could not run." });
  }
};
