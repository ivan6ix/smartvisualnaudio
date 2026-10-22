/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ANGLE_STATUS,
  SCAN_ANGLE_IDS,
  SCAN_OUTCOME,
  analyzeAngleCapture,
  assessCaptureQuality,
  classifyAngleDetections,
  createScanState,
  findDuplicateAngle,
  parseDetectorResponse,
  scanReducer,
  summarizeScan,
} from "../src/lib/environmentScan.js";

const frames = [{ image: "a" }, { image: "b" }, { image: "c" }];
const texturedSignature = (offset = 0) => Array.from({ length: 96 }, (_, index) => 60 + offset + ((index * 37) % 120));

function captureAngle(state, angleId, captureId = `${angleId}-1`) {
  let next = scanReducer(state, { type: "capture_started", angleId, captureId });
  next = scanReducer(next, { type: "capture_succeeded", angleId, captureId, frames, signature: texturedSignature() });
  return next;
}

function analyze(state, angleId, outcome, requestId = `${angleId}-r1`, extra = {}) {
  let next = scanReducer(state, { type: "analysis_started", angleId, requestId });
  next = scanReducer(next, { type: "analysis_resolved", angleId, requestId, outcome, findings: [], ...extra });
  return next;
}

function allApproved() {
  return SCAN_ANGLE_IDS.reduce((state, id) => analyze(captureAngle(state, id), id, SCAN_OUTCOME.CLEAR), createScanState());
}

const prediction = (label, confidence, extra = {}) => ({ class: label, confidence, ...extra });
const sameFrames = (predictions, count = 3) => Array.from({ length: count }, () => ({ predictions }));

// 1. All five captured and approved: complete, never "incomplete", exam entry allowed.
{
  const summary = summarizeScan(allApproved());
  assert.equal(summary.capturedCount, 5);
  assert.equal(summary.approvedCount, 5);
  assert.equal(summary.outcome, SCAN_OUTCOME.CLEAR);
  assert.equal(summary.canEnterExam, true);
  assert.deepEqual(summary.missingIds, []);
}

// 2. One angle missing: incomplete, names the missing angle, no exam entry.
{
  const state = SCAN_ANGLE_IDS.filter((id) => id !== "upper")
    .reduce((current, id) => analyze(captureAngle(current, id), id, SCAN_OUTCOME.CLEAR), createScanState());
  const summary = summarizeScan(state);
  assert.equal(summary.capturedCount, 4);
  assert.equal(summary.outcome, "incomplete");
  assert.deepEqual(summary.missingIds, ["upper"]);
  assert.equal(summary.nextAngleId, "upper");
  assert.equal(summary.canEnterExam, false);
}

// 3. One angle needs recapture: still counted as captured (5 of 5), outcome rescan_required with a reason.
{
  const state = analyze(captureAngle(allApproved(), "left", "left-2"), "left", SCAN_OUTCOME.RESCAN, "left-r2", { reason: "The image was unclear." });
  const summary = summarizeScan(state);
  assert.equal(summary.capturedCount, 5);
  assert.equal(summary.outcome, SCAN_OUTCOME.RESCAN);
  assert.deepEqual(summary.recaptureIds, ["left"]);
  assert.equal(state.angles.left.reason, "The image was unclear.");
  assert.equal(summary.nextAngleId, "left");
  assert.equal(summary.canEnterExam, false);
  // A capture rejected for quality before analysis is not counted as captured.
  let blank = scanReducer(createScanState(), { type: "capture_started", angleId: "desk", captureId: "d1" });
  blank = scanReducer(blank, { type: "capture_failed", angleId: "desk", captureId: "d1", reason: "too dark" });
  assert.equal(blank.angles.desk.status, ANGLE_STATUS.RECAPTURE);
  assert.equal(summarizeScan(blank).capturedCount, 0);
}

// 4. Retaking one angle keeps every other angle's capture and approval.
{
  const before = allApproved();
  const after = scanReducer(before, { type: "retake", angleId: "right" });
  assert.equal(after.angles.right.status, ANGLE_STATUS.PENDING);
  SCAN_ANGLE_IDS.filter((id) => id !== "right").forEach((id) => assert.equal(after.angles[id], before.angles[id]));
  const summary = summarizeScan(after);
  assert.equal(summary.capturedCount, 4);
  assert.equal(summary.approvedCount, 4);
  assert.equal(summary.nextAngleId, "right");
  const redone = analyze(captureAngle(after, "right", "right-2"), "right", SCAN_OUTCOME.CLEAR, "right-r2");
  assert.equal(summarizeScan(redone).canEnterExam, true);
}

// 5. AI pending: captured but not approved, outcome analyzing, no exam entry.
{
  const state = scanReducer(captureAngle(allApproved(), "desk", "desk-2"), { type: "analysis_started", angleId: "desk", requestId: "desk-r2" });
  const summary = summarizeScan(state);
  assert.equal(summary.capturedCount, 5);
  assert.equal(summary.outcome, "analyzing");
  assert.deepEqual(summary.analyzingIds, ["desk"]);
  assert.equal(summary.canEnterExam, false);
}

// 6. Clear environment: walls, furniture, keyboard, mouse, the student and decor are not flagged.
{
  const result = classifyAngleDetections({
    angleId: "front",
    frames: sameFrames([
      prediction("keyboard", 0.9), prediction("mouse", 0.88), prediction("chair", 0.9),
      prediction("person", 0.97), prediction("potted plant", 0.7), prediction("clock", 0.8), prediction("dining table", 0.7),
      prediction("book", 0.82, { areaRatio: 0.004 }),
    ]),
  });
  assert.equal(result.outcome, SCAN_OUTCOME.CLEAR);
  assert.deepEqual(result.findings, []);
}

// 7. Low-confidence or ambiguous detections ask for a recapture, never a violation.
{
  const singleFrame = classifyAngleDetections({ angleId: "left", frames: [{ predictions: [prediction("cell phone", 0.6)] }, { predictions: [] }, { predictions: [] }] });
  assert.equal(singleFrame.outcome, SCAN_OUTCOME.RESCAN);
  assert.equal(singleFrame.findings[0].detected, false);
  assert.match(singleFrame.findings[0].reason, /retake this angle/i);
  const lowConfidence = classifyAngleDetections({ angleId: "left", frames: sameFrames([prediction("cell phone", 0.32)]) });
  assert.equal(lowConfidence.outcome, SCAN_OUTCOME.RESCAN);
  const belowFloor = classifyAngleDetections({ angleId: "left", frames: sameFrames([prediction("cell phone", 0.2)]) });
  assert.equal(belowFloor.outcome, SCAN_OUTCOME.CLEAR);
  // "headphones" is never read as a phone; "mobile" alone is still a phone.
  assert.equal(classifyAngleDetections({ angleId: "front", frames: sameFrames([prediction("headphones", 0.9)]) }).findings[0].category, "audio_device");
  assert.equal(classifyAngleDetections({ angleId: "front", frames: sameFrames([prediction("Mobile", 0.9)]) }).findings[0].category, "phone");
}

// 8. Genuine prohibited objects are flagged with a meaningful, deduplicated finding.
{
  const phone = classifyAngleDetections({ angleId: "desk", frames: sameFrames([prediction("cell phone", 0.71), prediction("cell_phone", 0.66)]) });
  assert.equal(phone.outcome, SCAN_OUTCOME.RISK);
  assert.equal(phone.findings.length, 1, "Duplicate detections of one item must produce one finding.");
  assert.equal(phone.findings[0].category, "phone");
  assert.match(phone.findings[0].reason, /Phone detected \(71%\)/);
  const strongSingle = classifyAngleDetections({ angleId: "front", frames: [{ predictions: [prediction("tablet", 0.9)] }, { predictions: [] }] });
  assert.equal(strongSingle.outcome, SCAN_OUTCOME.RISK);
  const extraPerson = classifyAngleDetections({ angleId: "right", frames: sameFrames([prediction("person", 0.92), prediction("person", 0.81)]) });
  assert.equal(extraPerson.findings[0].category, "person");
  assert.equal(extraPerson.outcome, SCAN_OUTCOME.RISK);
  // Laptops are prohibited: one reliable laptop rejects the angle, several give one finding,
  // and an uncertain laptop asks for a recapture instead.
  const oneLaptop = classifyAngleDetections({ angleId: "front", frames: sameFrames([prediction("laptop", 0.72)]) });
  assert.equal(oneLaptop.outcome, SCAN_OUTCOME.RISK, "A single reliably detected laptop must be rejected.");
  assert.match(oneLaptop.findings[0].reason, /Laptop detected \(72%\)/);
  const laptops = classifyAngleDetections({ angleId: "left", frames: sameFrames([prediction("laptop", 0.9), prediction("laptop", 0.7)]) });
  assert.equal(laptops.outcome, SCAN_OUTCOME.RISK);
  assert.equal(laptops.findings.length, 1, "Several laptops in one frame produce one laptop finding.");
  const uncertainLaptop = classifyAngleDetections({ angleId: "right", frames: sameFrames([prediction("laptop", 0.5)]) });
  assert.equal(uncertainLaptop.outcome, SCAN_OUTCOME.RESCAN, "An uncertain laptop requests a recapture.");
  const flickerLaptop = classifyAngleDetections({ angleId: "right", frames: [{ predictions: [prediction("laptop", 0.7)] }, { predictions: [] }, { predictions: [] }] });
  assert.equal(flickerLaptop.outcome, SCAN_OUTCOME.RESCAN, "A laptop in one burst frame only is not confirmed.");
  assert.equal(classifyAngleDetections({ angleId: "right", frames: sameFrames([prediction("laptop", 0.3)]) }).outcome, SCAN_OUTCOME.CLEAR, "Laptop below the floor is ignored.");
  const deskNotes = classifyAngleDetections({ angleId: "desk", frames: sameFrames([prediction("book", 0.7, { areaRatio: 0.01 })]) });
  assert.equal(deskNotes.outcome, SCAN_OUTCOME.RISK, "Small books on the desk view are within reach and must be flagged.");
  for (const label of ["notes", "calculator", "tv", "earbuds", "smartwatch"]) {
    assert.equal(classifyAngleDetections({ angleId: "desk", frames: sameFrames([prediction(label, 0.9, { areaRatio: 0.2 })]) }).outcome, SCAN_OUTCOME.RISK, `${label} must be flagged.`);
  }
}

// 9. Timeouts and network failures become technical_error, never findings.
{
  const timedOut = await analyzeAngleCapture({ angleId: "front", frames, timeoutMs: 20, detectors: [() => new Promise(() => {})] });
  assert.equal(timedOut.outcome, SCAN_OUTCOME.TECHNICAL);
  assert.deepEqual(timedOut.findings, []);
  assert.match(timedOut.reason, /timed out[\s\S]*not a violation/i);
  const offline = await analyzeAngleCapture({ angleId: "front", frames, detectors: [async () => { throw new TypeError("Failed to fetch"); }] });
  assert.equal(offline.outcome, SCAN_OUTCOME.TECHNICAL);
  assert.match(offline.reason, /could not reach/i);
  // One detector failing while another succeeds still yields a real classification.
  const partial = await analyzeAngleCapture({
    angleId: "front",
    frames,
    detectors: [async () => { throw new Error("Roboflow 502"); }, async () => ({ frames: sameFrames([prediction("chair", 0.9)]) })],
  });
  assert.equal(partial.outcome, SCAN_OUTCOME.CLEAR);
  // Fallback detectors only run when no primary detector produced a result.
  let fallbackCalls = 0;
  const fallback = await analyzeAngleCapture({
    angleId: "front",
    frames,
    detectors: [async () => { throw new Error("offline"); }],
    fallbackDetectors: [async () => { fallbackCalls += 1; return { passed: true, findings: [] }; }],
  });
  assert.equal(fallback.outcome, SCAN_OUTCOME.CLEAR);
  assert.equal(fallbackCalls, 1);
  // A required (server-side) detector cannot be bypassed: if it fails or is unavailable, browser-only
  // results never approve the angle, but a server result still counts with the others.
  const browserOnly = { frames: sameFrames([prediction("chair", 0.9)]) };
  const serverDown = await analyzeAngleCapture({ angleId: "front", frames, requiredDetectors: [async () => { throw new Error("Detector request failed for front scan."); }], detectors: [async () => browserOnly] });
  assert.equal(serverDown.outcome, SCAN_OUTCOME.TECHNICAL, "Browser detectors must not pass an angle the server could not check.");
  assert.match(serverDown.reason, /not a violation/);
  const serverMissing = await analyzeAngleCapture({ angleId: "front", frames, requiredDetectors: [async () => null], detectors: [async () => browserOnly] });
  assert.equal(serverMissing.outcome, SCAN_OUTCOME.TECHNICAL);
  const serverPhone = await analyzeAngleCapture({ angleId: "desk", frames, requiredDetectors: [async () => ({ frames: sameFrames([prediction("cell phone", 0.9, { areaRatio: 0.2 })]) })], detectors: [async () => browserOnly] });
  assert.equal(serverPhone.outcome, SCAN_OUTCOME.RISK, "A server finding must count even when browser detectors see nothing.");
  const serverClear = await analyzeAngleCapture({ angleId: "front", frames, requiredDetectors: [async () => browserOnly], detectors: [async () => { throw new Error("offline"); }] });
  assert.equal(serverClear.outcome, SCAN_OUTCOME.CLEAR);
  // Every detector unavailable (not configured, or failed) -> retry state, never approval.
  const unchecked = await analyzeAngleCapture({ angleId: "front", frames, detectors: [async () => null], fallbackDetectors: [async () => null] });
  assert.equal(unchecked.outcome, SCAN_OUTCOME.TECHNICAL, "An angle no detector checked must not be approved.");
  assert.match(unchecked.reason, /not a violation/);
  const noFallbackDetector = await analyzeAngleCapture({
    angleId: "front",
    frames,
    detectors: [async () => { throw new Error("Failed to fetch"); }],
    fallbackDetectors: [async () => { throw new Error("No environment detector is configured (ENV_SCAN_DETECTOR_ENDPOINT)."); }],
  });
  assert.equal(noFallbackDetector.outcome, SCAN_OUTCOME.TECHNICAL);
  const edge = readFileSync("supabase/functions/environment-scan/index.ts", "utf8");
  assert.ok(/Without a detector nothing was checked.*\n\s*throw new DetectorUnavailableError\(\);/.test(edge) && edge.includes("json({ error: error.message }, 503)"), "Edge Function must fail, not pass, when no detector is configured.");
  // The reducer maps a technical failure to a retryable error state, not a rejection.
  const errored = analyze(captureAngle(createScanState(), "front"), "front", SCAN_OUTCOME.TECHNICAL, "front-r1", { reason: offline.reason });
  assert.equal(errored.angles.front.status, ANGLE_STATUS.ERROR);
  assert.equal(summarizeScan(errored).rejectedIds.length, 0);
  const retried = analyze(errored, "front", SCAN_OUTCOME.CLEAR, "front-r2");
  assert.equal(retried.angles.front.status, ANGLE_STATUS.APPROVED, "A failed check must be retryable without recapturing.");
}

// 10. Duplicate capture and analysis requests are ignored.
{
  const capturing = scanReducer(createScanState(), { type: "capture_started", angleId: "front", captureId: "f1" });
  assert.equal(scanReducer(capturing, { type: "capture_started", angleId: "front", captureId: "f2" }), capturing, "A second capture while capturing must be ignored.");
  const captured = scanReducer(capturing, { type: "capture_succeeded", angleId: "front", captureId: "f1", frames, signature: texturedSignature() });
  assert.equal(scanReducer(captured, { type: "capture_succeeded", angleId: "front", captureId: "f1", frames }), captured, "A repeated capture result must be ignored.");
  const started = scanReducer(captured, { type: "analysis_started", angleId: "front", requestId: "r1" });
  assert.equal(scanReducer(started, { type: "analysis_started", angleId: "front", requestId: "r2" }), started, "A second analysis for the same capture must be ignored.");
  // A view identical to another angle (camera not moved) is reported, a different view is not.
  assert.equal(findDuplicateAngle("left", texturedSignature(), { front: texturedSignature() }), "front");
  assert.equal(findDuplicateAngle("left", texturedSignature(40), { front: texturedSignature() }), null);
}

// 11. Out-of-order and stale results never overwrite newer state.
{
  let state = captureAngle(createScanState(), "left", "c1");
  state = scanReducer(state, { type: "analysis_started", angleId: "left", requestId: "old" });
  // Student retakes while the first check is still running.
  state = captureAngle(state, "left", "c2");
  state = scanReducer(state, { type: "analysis_started", angleId: "left", requestId: "new" });
  state = scanReducer(state, { type: "analysis_resolved", angleId: "left", requestId: "new", outcome: SCAN_OUTCOME.CLEAR, findings: [] });
  const late = scanReducer(state, { type: "analysis_resolved", angleId: "left", requestId: "old", outcome: SCAN_OUTCOME.RISK, findings: [{ label: "Phone" }] });
  assert.equal(late, state, "A late result for a superseded capture must be ignored.");
  assert.equal(late.angles.left.status, ANGLE_STATUS.APPROVED);
  // A capture result arriving after the angle was retaken is ignored.
  let retaken = scanReducer(createScanState(), { type: "capture_started", angleId: "upper", captureId: "u1" });
  retaken = scanReducer(retaken, { type: "retake", angleId: "upper" });
  assert.equal(scanReducer(retaken, { type: "capture_succeeded", angleId: "upper", captureId: "u1", frames }), retaken);
  // Results from before a full reset are ignored.
  const reset = scanReducer(allApproved(), { type: "reset" });
  assert.equal(scanReducer(reset, { type: "analysis_resolved", angleId: "front", requestId: "front-r1", outcome: SCAN_OUTCOME.CLEAR }), reset);
  assert.equal(summarizeScan(reset).capturedCount, 0);
}

// 12. Transition into the exam: only a fully approved scan unlocks entry, and the page still gates
// Start Exam on scanPassed and authorizes server-side after fullscreen and devices.
{
  assert.equal(summarizeScan(allApproved()).canEnterExam, true);
  const withRisk = analyze(captureAngle(allApproved(), "front", "f2"), "front", SCAN_OUTCOME.RISK, "f-r2");
  assert.equal(summarizeScan(withRisk).outcome, SCAN_OUTCOME.RISK);
  assert.equal(summarizeScan(withRisk).canEnterExam, false);
  const page = readFileSync("src/pages/student/StudentExamTake.jsx", "utf8");
  assert.ok(/scanSummary\.canEnterExam && scanStatus === "scanning"[\s\S]{0,200}setScanStatus\("passed"\)/.test(page), "Only a fully approved scan may mark the scan as passed.");
  assert.equal((page.match(/setScanStatus\("passed"\)/g) || []).length, 4, "Scan passes only from full approval, saved/resumed progress, or an exam without a required scan.");
  assert.ok(page.includes('const scanPassed = !examSettings.requireEnvironmentScan || scanStatus === "passed";'), "Exam entry must stay gated on the scan.");
  assert.ok(page.includes("disabled={!scanPassed || attemptsExhausted || examStarting} onClick={enterExamMode}"), "Start Exam must stay disabled until the scan passes.");
  assert.ok(page.includes('supabase.rpc("authorize_exam_start"'), "Exam entry must still be authorized by the server.");
  assert.ok(!/runLiveEnvironmentScan|MAX_SCAN_DURATION_MS/.test(page), "The timed auto-scan loop must stay removed.");
  assert.ok(/if \(scanCaptureInFlightRef\.current \|\| scanStatus !== "scanning" \|\| !scanCameraReady\) return;\s*scanCaptureInFlightRef\.current = true;/.test(page), "Capture must ignore repeated clicks while a capture is in flight.");
}

// 13. Stale or malformed AI responses are technical failures, not findings or approvals.
{
  for (const raw of [null, "ok", [], {}, { predictions: "phone" }, { frames: [null] }, { passed: "yes", findings: [] }]) {
    assert.throws(() => parseDetectorResponse(raw), `Malformed response must be rejected: ${JSON.stringify(raw)}`);
  }
  assert.throws(() => parseDetectorResponse({ error: "Environment scan requires left, center, and right frames." }));
  // Predictions with invalid confidence are dropped rather than trusted.
  assert.deepEqual(parseDetectorResponse({ predictions: [{ class: "cell phone", confidence: "high" }, { class: "cell phone", confidence: 7 }] }).frames[0].predictions, []);
  const malformed = await analyzeAngleCapture({ angleId: "desk", frames, detectors: [async () => ({ unexpected: true })] });
  assert.equal(malformed.outcome, SCAN_OUTCOME.TECHNICAL);
  assert.deepEqual(malformed.findings, []);
  // Legacy { passed, findings } responses are still understood.
  const legacy = await analyzeAngleCapture({ angleId: "desk", frames, detectors: [async () => ({ passed: false, findings: [{ label: "cell phone", confidence: 0.8 }] })] });
  assert.equal(legacy.outcome, SCAN_OUTCOME.RISK);
  // Roboflow-style responses with image size and box size are understood.
  const roboflow = parseDetectorResponse({ image: { width: 100, height: 100 }, predictions: [{ class: "book", confidence: 0.7, width: 10, height: 10 }] });
  assert.equal(roboflow.frames[0].predictions[0].areaRatio, 0.01);
}

// Capture quality only rejects frames that cannot show anything; a plain wall passes.
{
  const plainWall = Array.from({ length: 96 }, (_, index) => 180 + (index % 12));
  assert.equal(assessCaptureQuality([plainWall, plainWall, plainWall]).ok, true);
  const dark = Array.from({ length: 96 }, () => 8);
  assert.match(assessCaptureQuality([dark, dark, dark]).reason, /too dark/);
  const blank = Array.from({ length: 96 }, () => 200);
  assert.match(assessCaptureQuality([blank, blank, blank]).reason, /blank or covered/);
}

console.log("environment scan helpers ok");
