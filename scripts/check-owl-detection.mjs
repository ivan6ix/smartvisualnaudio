/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SCAN_OUTCOME, analyzeAngleCapture, classifyAngleDetections, findDetectionRule, mergeDetectorFrames, parseDetectorResponse } from "../src/lib/environmentScan.js";
import {
  OWL_CANDIDATE_LABELS,
  OWL_FRAMES_PER_STEP,
  OWL_QUERIES,
  owlResultsToPredictions,
  owlScoreToConfidence,
  pickOwlFrameIndexes,
  placeOwlFrames,
} from "../src/lib/owlDetection.js";

// Every question asked to the model maps to an existing detection rule, and each prohibited kind is asked for.
for (const { query, label } of OWL_QUERIES) assert.ok(findDetectionRule(label), `${query} -> ${label} must match a detection rule.`);
const categories = new Set(OWL_QUERIES.map(({ label }) => findDetectionRule(label).category));
for (const category of ["phone", "laptop", "second_screen", "tablet", "calculator", "smartwatch", "audio_device", "notes", "book"]) {
  assert.ok(categories.has(category), `The browser AI must look for ${category}.`);
}
assert.equal(OWL_CANDIDATE_LABELS.length, OWL_QUERIES.length);

// Scores are stretched onto the rules' confidence scale: weak = possible, clear = flag, strong = confirmed alone.
assert.equal(owlScoreToConfidence(0.05), 0, "Below the minimum score is ignored.");
assert.equal(owlScoreToConfidence("x"), 0);
assert.ok(Math.abs(owlScoreToConfidence(0.08) - 0.35) < 1e-9);
assert.ok(Math.abs(owlScoreToConfidence(0.18) - 0.6) < 1e-9);
assert.ok(owlScoreToConfidence(0.26) >= 0.8);
assert.equal(owlScoreToConfidence(0.9), 0.99);

// Pipeline output (percentage boxes) becomes rule predictions; whole-picture boxes and unknown labels are dropped.
const predictions = owlResultsToPredictions([
  { label: "a sheet of paper", score: 0.3, box: { xmin: 0.4, ymin: 0.5, xmax: 0.6, ymax: 0.75 } },
  { label: "a mobile phone", score: 0.2, box: { xmin: 0.1, ymin: 0.1, xmax: 0.2, ymax: 0.3 } },
  { label: "a sheet of paper", score: 0.5, box: { xmin: 0, ymin: 0, xmax: 1, ymax: 0.95 } },
  { label: "a dragon", score: 0.9, box: { xmin: 0, ymin: 0, xmax: 0.1, ymax: 0.1 } },
  { label: "a book", score: 0.02, box: { xmin: 0, ymin: 0, xmax: 0.1, ymax: 0.1 } },
]);
assert.deepEqual(predictions.map((item) => item.class), ["paper", "cell phone"]);
assert.ok(Math.abs(predictions[0].areaRatio - 0.05) < 1e-9);
assert.deepEqual(owlResultsToPredictions(null), []);
// The same box under several labels keeps only the best one (a page is not also "a mobile phone").
const page = { xmin: 0.3, ymin: 0.3, xmax: 0.7, ymax: 0.72 };
assert.deepEqual(owlResultsToPredictions([
  { label: "a mobile phone", score: 0.09, box: page },
  { label: "a printed document", score: 0.32, box: page },
  { label: "a sheet of paper", score: 0.22, box: { ...page, xmax: 0.71 } },
  { label: "a mobile phone", score: 0.25, box: { xmin: 0.05, ymin: 0.05, xmax: 0.15, ymax: 0.25 } },
]).map((item) => item.class), ["document", "cell phone"]);

// The predictions go through the shared rules: paper on the desk blocks entry, a clear phone in the sweep does too.
const paperOnDesk = classifyAngleDetections({ angleId: "desk", frames: parseDetectorResponse({ frames: [{ predictions: [predictions[0]] }, { predictions: [predictions[0]] }] }).frames });
assert.equal(paperOnDesk.outcome, SCAN_OUTCOME.RISK);
assert.equal(paperOnDesk.findings[0].category, "notes");
const strongPhone = owlResultsToPredictions([{ label: "a mobile phone", score: 0.3, box: { xmin: 0.1, ymin: 0.1, xmax: 0.2, ymax: 0.3 } }]);
assert.equal(classifyAngleDetections({ angleId: "sweep", frames: [{ predictions: strongPhone }, { predictions: [] }] }).outcome, SCAN_OUTCOME.RISK);

// The student is told about the confirmed item, not an uncertain one that happens to be listed first.
const deskResult = await analyzeAngleCapture({
  angleId: "desk",
  frames: [{ image: "a" }, { image: "b" }],
  detectors: [async () => ({ frames: [
    { predictions: [{ class: "cell phone", confidence: 0.36, areaRatio: 0.1 }, { class: "document", confidence: 0.94, areaRatio: 0.17 }] },
    { predictions: [] },
  ] })],
});
assert.equal(deskResult.outcome, SCAN_OUTCOME.RISK);
assert.match(deskResult.reason, /^Notes or papers detected \(94%\)/);

// The model checks a spread of the views, and its answers go back to the right frame positions.
assert.deepEqual(pickOwlFrameIndexes(12, OWL_FRAMES_PER_STEP.sweep), [0, 2, 4, 7, 9, 11]);
assert.deepEqual(pickOwlFrameIndexes(3, OWL_FRAMES_PER_STEP.desk), [0, 2]);
assert.deepEqual(pickOwlFrameIndexes(1, 2), [0]);
const placed = placeOwlFrames(4, [0, 3], [{ predictions: [predictions[1]] }, { predictions: [predictions[0]] }]);
assert.deepEqual(placed.map((frame) => frame.predictions.length), [1, 0, 0, 1]);
const merged = mergeDetectorFrames([{ frames: placed }, { frames: [{ predictions: [] }, { predictions: [] }, { predictions: [] }, { predictions: [] }] }], 4);
assert.equal(merged[3].predictions[0].class, "paper", "OWL answers line up with the other detectors' frames.");

// Wiring.
const examPage = readFileSync("src/pages/student/StudentExamTake.jsx", "utf8");
assert.match(examPage, /detectors: \[detectScanFramesWithRoboflow, detectScanFramesWithCocoSsd, detectScanFramesWithOwl\]/);
assert.match(examPage, /loadOwlDetector\(/, "The browser AI starts downloading when the scan starts.");
const worker = readFileSync("src/workers/owlDetector.worker.js", "utf8");
assert.match(worker, /device: "webgpu", dtype: "q8"[\s\S]*device: "wasm", dtype: "q8"/, "GPU and CPU must share one model file.");

console.log("OWL detection checks passed.");
