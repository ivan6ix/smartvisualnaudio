// Open-vocabulary detection for the environment scan: the browser model (OWL-ViT, run with transformers.js in a
// worker) is asked for each item below in plain words, and its answers are turned into predictions that the shared
// DETECTION_RULES in environmentScan.js classify. Pure functions only, so they run in check scripts.

export const OWL_MODEL_ID = "onnx-community/owlvit-base-patch32-ONNX";
// Lowest model score returned at all; anything weaker is noise.
export const OWL_MIN_SCORE = 0.08;
// A box covering most of the picture is the model naming the whole view (a white desk read as "paper"), not an item.
export const OWL_MAX_AREA = 0.8;
// The model takes a few seconds per image on a typical laptop, so it checks a spread of the captured views.
export const OWL_FRAMES_PER_STEP = { sweep: 6, desk: 2 };

// `label` is what DETECTION_RULES match on; several phrasings of the same item improve recall.
export const OWL_QUERIES = [
  { query: "a mobile phone", label: "cell phone" },
  { query: "a smartphone in a hand", label: "cell phone" },
  { query: "a laptop computer", label: "laptop" },
  { query: "a desktop computer monitor", label: "monitor" },
  { query: "a television screen", label: "tv" },
  { query: "a tablet computer", label: "tablet" },
  { query: "a calculator", label: "calculator" },
  { query: "a smartwatch", label: "smartwatch" },
  { query: "wireless earbuds", label: "earbuds" },
  { query: "headphones", label: "headphones" },
  { query: "a sheet of paper", label: "paper" },
  { query: "handwritten notes", label: "notes" },
  { query: "a printed document", label: "document" },
  { query: "an open notebook", label: "notebook" },
  { query: "a sticky note", label: "sticky note" },
  { query: "a book", label: "book" },
];
export const OWL_CANDIDATE_LABELS = OWL_QUERIES.map((item) => item.query);
const LABEL_BY_QUERY = new Map(OWL_QUERIES.map((item) => [item.query, item.label]));

// OWL-ViT scores run much lower than a trained detector's confidence (a clear object often scores 0.2-0.3), so they
// are stretched onto the same scale the rules use: 0.08 -> 0.35 (possible), 0.18 -> 0.6 (flag), 0.26+ -> 0.8 (strong).
export function owlScoreToConfidence(score) {
  const value = Number(score);
  if (!Number.isFinite(value) || value < OWL_MIN_SCORE) return 0;
  return Math.min(0.99, 0.15 + 2.5 * value);
}

function overlap(first, second) {
  const width = Math.max(0, Math.min(first.xmax, second.xmax) - Math.max(first.xmin, second.xmin));
  const height = Math.max(0, Math.min(first.ymax, second.ymax) - Math.max(first.ymin, second.ymin));
  const shared = width * height;
  const area = (box) => Math.max(0, box.xmax - box.xmin) * Math.max(0, box.ymax - box.ymin);
  const union = area(first) + area(second) - shared;
  return union > 0 ? shared / union : 0;
}

// The model answers every question for the same object (a page is "a document" and, weakly, "a mobile phone"),
// so only the best-scoring label is kept for boxes that are practically the same.
export const OWL_SAME_BOX_OVERLAP = 0.7;

// `results` is the pipeline output for one image with percentage boxes: [{ label, score, box: { xmin, ymin, xmax, ymax } }].
// Returns predictions in the shape parseDetectorResponse reads: [{ class, confidence, areaRatio }].
export function owlResultsToPredictions(results) {
  if (!Array.isArray(results)) return [];
  const kept = [];
  [...results].sort((first, second) => Number(second?.score) - Number(first?.score)).forEach((result) => {
    if (!result?.box || kept.some((other) => overlap(other.box, result.box) >= OWL_SAME_BOX_OVERLAP)) return;
    kept.push(result);
  });
  return kept.flatMap((result) => {
    const label = LABEL_BY_QUERY.get(result?.label);
    const confidence = owlScoreToConfidence(result?.score);
    if (!label || !confidence) return [];
    const box = result.box || {};
    const width = Math.max(0, Math.min(1, Number(box.xmax)) - Math.max(0, Number(box.xmin)));
    const height = Math.max(0, Math.min(1, Number(box.ymax)) - Math.max(0, Number(box.ymin)));
    const areaRatio = Number.isFinite(width * height) ? width * height : null;
    if (areaRatio !== null && areaRatio > OWL_MAX_AREA) return [];
    return [{ class: label, confidence, areaRatio, source: "owl" }];
  });
}

// Indexes of `count` frames spread evenly over `total` (all of them when there are few).
export function pickOwlFrameIndexes(total, count) {
  if (total <= count) return Array.from({ length: total }, (_, index) => index);
  return [...new Set(Array.from({ length: count }, (_, index) => Math.round((index * (total - 1)) / (count - 1))))];
}

// Puts the checked frames' results back at their positions, so multi-frame consensus counts the right views.
// Frames that were not checked get no predictions.
export function placeOwlFrames(total, indexes, checkedFrames) {
  const frames = Array.from({ length: total }, () => ({ predictions: [] }));
  indexes.forEach((frameIndex, position) => {
    frames[frameIndex] = { predictions: checkedFrames[position]?.predictions || [] };
  });
  return frames;
}
