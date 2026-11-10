/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ANGLE_STATUS,
  SCAN_ANGLE_IDS,
  SCAN_OUTCOME,
  CAMERA_HORIZONTAL_FOV_DEGREES,
  SWEEP_MAX_FRAMES,
  SWEEP_SAMPLE_INTERVAL_MS,
  TURN_ANALYSIS_HEIGHT,
  TURN_ANALYSIS_WIDTH,
  analyzeAngleCapture,
  assessCaptureQuality,
  classifyAngleDetections,
  createScanState,
  createSweep,
  estimateTurnShift,
  findDetectionRule,
  findDuplicateAngle,
  finishSweep,
  getColumnProfile,
  getGraySignature,
  getSweepProgress,
  getViewDistance,
  parseDetectorResponse,
  recordSweepSample,
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

// 1. Both steps captured and approved: complete, never "incomplete", exam entry allowed.
{
  const summary = summarizeScan(allApproved());
  assert.equal(summary.capturedCount, 2);
  assert.equal(summary.approvedCount, 2);
  assert.equal(summary.outcome, SCAN_OUTCOME.CLEAR);
  assert.equal(summary.canEnterExam, true);
  assert.deepEqual(summary.missingIds, []);
}

// 2. One step missing: incomplete, names the missing angle, no exam entry.
{
  const state = SCAN_ANGLE_IDS.filter((id) => id !== "desk")
    .reduce((current, id) => analyze(captureAngle(current, id), id, SCAN_OUTCOME.CLEAR), createScanState());
  const summary = summarizeScan(state);
  assert.equal(summary.capturedCount, 1);
  assert.equal(summary.outcome, "incomplete");
  assert.deepEqual(summary.missingIds, ["desk"]);
  assert.equal(summary.nextAngleId, "desk");
  assert.equal(summary.canEnterExam, false);
}

// 3. One angle needs recapture: still counted as captured (2 of 2), outcome rescan_required with a reason.
{
  const state = analyze(captureAngle(allApproved(), "sweep", "left-2"), "sweep", SCAN_OUTCOME.RESCAN, "left-r2", { reason: "The image was unclear." });
  const summary = summarizeScan(state);
  assert.equal(summary.capturedCount, 2);
  assert.equal(summary.outcome, SCAN_OUTCOME.RESCAN);
  assert.deepEqual(summary.recaptureIds, ["sweep"]);
  assert.equal(state.angles.sweep.reason, "The image was unclear.");
  assert.equal(summary.nextAngleId, "sweep");
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
  const after = scanReducer(before, { type: "retake", angleId: "sweep" });
  assert.equal(after.angles.sweep.status, ANGLE_STATUS.PENDING);
  SCAN_ANGLE_IDS.filter((id) => id !== "sweep").forEach((id) => assert.equal(after.angles[id], before.angles[id]));
  const summary = summarizeScan(after);
  assert.equal(summary.capturedCount, 1);
  assert.equal(summary.approvedCount, 1);
  assert.equal(summary.nextAngleId, "sweep");
  const redone = analyze(captureAngle(after, "sweep", "right-2"), "sweep", SCAN_OUTCOME.CLEAR, "right-r2");
  assert.equal(summarizeScan(redone).canEnterExam, true);
}

// 5. AI pending: captured but not approved, outcome analyzing, no exam entry.
{
  const state = scanReducer(captureAngle(allApproved(), "desk", "desk-2"), { type: "analysis_started", angleId: "desk", requestId: "desk-r2" });
  const summary = summarizeScan(state);
  assert.equal(summary.capturedCount, 2);
  assert.equal(summary.outcome, "analyzing");
  assert.deepEqual(summary.analyzingIds, ["desk"]);
  assert.equal(summary.canEnterExam, false);
}

// 6. Clear environment: walls, furniture, keyboard, mouse, the student and decor are not flagged.
{
  const result = classifyAngleDetections({
    angleId: "sweep",
    frames: sameFrames([
      prediction("keyboard", 0.9), prediction("mouse", 0.88), prediction("chair", 0.9),
      prediction("person", 0.97), prediction("potted plant", 0.7), prediction("clock", 0.8), prediction("dining table", 0.7),
      prediction("book", 0.82, { areaRatio: 0.004 }),
    ]),
  });
  assert.equal(result.outcome, SCAN_OUTCOME.CLEAR);
  assert.deepEqual(result.findings, []);
}

// 7. Low-confidence or ambiguous detections approve the step: if nothing is clearly on the desk, it passes.
{
  const singleFrame = classifyAngleDetections({ angleId: "desk", frames: [{ predictions: [prediction("cell phone", 0.6)] }, { predictions: [] }, { predictions: [] }] });
  assert.equal(singleFrame.outcome, SCAN_OUTCOME.CLEAR, "A phone seen once at moderate confidence is not confirmed, so the desk passes.");
  assert.deepEqual(singleFrame.findings, []);
  const lowConfidence = classifyAngleDetections({ angleId: "desk", frames: sameFrames([prediction("cell phone", 0.32)]) });
  assert.equal(lowConfidence.outcome, SCAN_OUTCOME.CLEAR);
  const belowFloor = classifyAngleDetections({ angleId: "desk", frames: sameFrames([prediction("cell phone", 0.2)]) });
  assert.equal(belowFloor.outcome, SCAN_OUTCOME.CLEAR);
  // Earbuds, earphones, headphones and headsets are allowed, and never read as a phone; "mobile" alone is still a phone.
  for (const label of ["headphones", "head phones", "ear-phones", "earbuds", "wireless earbuds", "headset", "AirPods"]) {
    assert.equal(findDetectionRule(label), null, `${label} is allowed.`);
    assert.equal(classifyAngleDetections({ angleId: "desk", frames: sameFrames([prediction(label, 0.95, { areaRatio: 0.2 })]) }).outcome, SCAN_OUTCOME.CLEAR, `${label} must not block the scan.`);
  }
  assert.equal(classifyAngleDetections({ angleId: "desk", frames: sameFrames([prediction("Mobile", 0.9)]) }).findings[0].category, "phone");
  assert.equal(classifyAngleDetections({ angleId: "desk", frames: sameFrames([prediction("phone", 0.9), prediction("headphones", 0.9)]) }).findings[0].category, "phone", "A phone next to allowed headphones is still flagged.");
}

// 7b. Only the desk decides about items: the room sweep only looks for another person, so a phone, a laptop, a TV
// or a smartwatch somewhere else in the room never fails the scan, however clearly it is seen.
{
  for (const label of ["cell phone", "laptop", "tv", "smartwatch", "book", "calculator"]) {
    assert.equal(classifyAngleDetections({ angleId: "sweep", frames: sameFrames([prediction(label, 0.95, { areaRatio: 0.2 })]) }).outcome, SCAN_OUTCOME.CLEAR, `A ${label} elsewhere in the room is not checked.`);
  }
  // Older pages' room angles are judged like the sweep.
  assert.equal(classifyAngleDetections({ angleId: "left", frames: sameFrames([prediction("cell phone", 0.95)]) }).outcome, SCAN_OUTCOME.CLEAR);
  // OWL-ViT's guesses never decide alone, even when it says it is sure; with a reliable sighting they count.
  const owlWatch = sameFrames([prediction("smartwatch", 0.95, { source: "owl", areaRatio: 0.05 })]);
  assert.equal(classifyAngleDetections({ angleId: "desk", frames: owlWatch }).outcome, SCAN_OUTCOME.CLEAR, "An OWL-only smartwatch does not fail the desk.");
  const backedUp = [{ predictions: [prediction("smartwatch", 0.95, { source: "owl" }), prediction("smartwatch", 0.4)] }, { predictions: [prediction("smartwatch", 0.9, { source: "owl" })] }];
  assert.equal(classifyAngleDetections({ angleId: "desk", frames: backedUp }).outcome, SCAN_OUTCOME.RISK, "OWL counts once a reliable detector also saw the item.");
  assert.match(classifyAngleDetections({ angleId: "desk", frames: backedUp }).findings[0].reason, /on your desk/);
}

// 8. Genuine prohibited objects are flagged with a meaningful, deduplicated finding.
{
  const phone = classifyAngleDetections({ angleId: "desk", frames: sameFrames([prediction("cell phone", 0.71), prediction("cell_phone", 0.66)]) });
  assert.equal(phone.outcome, SCAN_OUTCOME.RISK);
  assert.equal(phone.findings.length, 1, "Duplicate detections of one item must produce one finding.");
  assert.equal(phone.findings[0].category, "phone");
  assert.match(phone.findings[0].reason, /Phone detected \(71%\)/);
  const strongSingle = classifyAngleDetections({ angleId: "desk", frames: [{ predictions: [prediction("tablet", 0.9)] }, { predictions: [] }] });
  assert.equal(strongSingle.outcome, SCAN_OUTCOME.RISK);
  const extraPerson = classifyAngleDetections({ angleId: "sweep", frames: sameFrames([prediction("person", 0.92), prediction("person", 0.81)]) });
  assert.equal(extraPerson.findings[0].category, "person");
  assert.equal(extraPerson.outcome, SCAN_OUTCOME.RISK, "The room sweep still catches another person.");
  assert.match(extraPerson.findings[0].reason, /Another person was detected/);
  // Laptops are prohibited on the desk: one reliable laptop rejects the step, several give one finding,
  // and an uncertain laptop is approved.
  const oneLaptop = classifyAngleDetections({ angleId: "desk", frames: sameFrames([prediction("laptop", 0.72)]) });
  assert.equal(oneLaptop.outcome, SCAN_OUTCOME.RISK, "A single reliably detected laptop must be rejected.");
  assert.match(oneLaptop.findings[0].reason, /Laptop detected \(72%\)/);
  const laptops = classifyAngleDetections({ angleId: "desk", frames: sameFrames([prediction("laptop", 0.9), prediction("laptop", 0.7)]) });
  assert.equal(laptops.outcome, SCAN_OUTCOME.RISK);
  assert.equal(laptops.findings.length, 1, "Several laptops in one frame produce one laptop finding.");
  const uncertainLaptop = classifyAngleDetections({ angleId: "desk", frames: sameFrames([prediction("laptop", 0.5)]) });
  assert.equal(uncertainLaptop.outcome, SCAN_OUTCOME.CLEAR, "An uncertain laptop is approved.");
  const flickerLaptop = classifyAngleDetections({ angleId: "desk", frames: [{ predictions: [prediction("laptop", 0.7)] }, { predictions: [] }, { predictions: [] }] });
  assert.equal(flickerLaptop.outcome, SCAN_OUTCOME.CLEAR, "A laptop in one burst frame only is not confirmed.");
  assert.equal(classifyAngleDetections({ angleId: "desk", frames: sameFrames([prediction("laptop", 0.3)]) }).outcome, SCAN_OUTCOME.CLEAR, "Laptop below the floor is ignored.");
  const deskNotes = classifyAngleDetections({ angleId: "desk", frames: sameFrames([prediction("book", 0.7, { areaRatio: 0.01 })]) });
  assert.equal(deskNotes.outcome, SCAN_OUTCOME.RISK, "Small books on the desk view are within reach and must be flagged.");
  for (const label of ["notes", "calculator", "tv", "smartwatch"]) {
    assert.equal(classifyAngleDetections({ angleId: "desk", frames: sameFrames([prediction(label, 0.9, { areaRatio: 0.2 })]) }).outcome, SCAN_OUTCOME.RISK, `${label} must be flagged.`);
  }
}

// 9. Timeouts and network failures become technical_error, never findings.
{
  const timedOut = await analyzeAngleCapture({ angleId: "sweep", frames, timeoutMs: 20, detectors: [() => new Promise(() => {})] });
  assert.equal(timedOut.outcome, SCAN_OUTCOME.TECHNICAL);
  assert.deepEqual(timedOut.findings, []);
  assert.match(timedOut.reason, /timed out[\s\S]*not a violation/i);
  const offline = await analyzeAngleCapture({ angleId: "sweep", frames, detectors: [async () => { throw new TypeError("Failed to fetch"); }] });
  assert.equal(offline.outcome, SCAN_OUTCOME.TECHNICAL);
  assert.match(offline.reason, /could not reach/i);
  // One detector failing while another succeeds still yields a real classification.
  const partial = await analyzeAngleCapture({
    angleId: "sweep",
    frames,
    detectors: [async () => { throw new Error("Roboflow 502"); }, async () => ({ frames: sameFrames([prediction("chair", 0.9)]) })],
  });
  assert.equal(partial.outcome, SCAN_OUTCOME.CLEAR);
  // Fallback detectors only run when no primary detector produced a result.
  let fallbackCalls = 0;
  const fallback = await analyzeAngleCapture({
    angleId: "sweep",
    frames,
    detectors: [async () => { throw new Error("offline"); }],
    fallbackDetectors: [async () => { fallbackCalls += 1; return { passed: true, findings: [] }; }],
  });
  assert.equal(fallback.outcome, SCAN_OUTCOME.CLEAR);
  assert.equal(fallbackCalls, 1);
  // A required (server-side) detector cannot be bypassed: if it fails or is unavailable, browser-only
  // results never approve the angle, but a server result still counts with the others.
  const browserOnly = { frames: sameFrames([prediction("chair", 0.9)]) };
  const serverDown = await analyzeAngleCapture({ angleId: "sweep", frames, requiredDetectors: [async () => { throw new Error("Detector request failed for front scan."); }], detectors: [async () => browserOnly] });
  assert.equal(serverDown.outcome, SCAN_OUTCOME.TECHNICAL, "Browser detectors must not pass an angle the server could not check.");
  assert.match(serverDown.reason, /not a violation/);
  const serverMissing = await analyzeAngleCapture({ angleId: "sweep", frames, requiredDetectors: [async () => null], detectors: [async () => browserOnly] });
  assert.equal(serverMissing.outcome, SCAN_OUTCOME.TECHNICAL);
  const serverPhone = await analyzeAngleCapture({ angleId: "desk", frames, requiredDetectors: [async () => ({ frames: sameFrames([prediction("cell phone", 0.9, { areaRatio: 0.2 })]) })], detectors: [async () => browserOnly] });
  assert.equal(serverPhone.outcome, SCAN_OUTCOME.RISK, "A server finding must count even when browser detectors see nothing.");
  const serverClear = await analyzeAngleCapture({ angleId: "sweep", frames, requiredDetectors: [async () => browserOnly], detectors: [async () => { throw new Error("offline"); }] });
  assert.equal(serverClear.outcome, SCAN_OUTCOME.CLEAR);
  // Every detector unavailable (not configured, or failed) -> retry state, never approval.
  const unchecked = await analyzeAngleCapture({ angleId: "sweep", frames, detectors: [async () => null], fallbackDetectors: [async () => null] });
  assert.equal(unchecked.outcome, SCAN_OUTCOME.TECHNICAL, "An angle no detector checked must not be approved.");
  assert.match(unchecked.reason, /not a violation/);
  const noFallbackDetector = await analyzeAngleCapture({
    angleId: "sweep",
    frames,
    detectors: [async () => { throw new Error("Failed to fetch"); }],
    fallbackDetectors: [async () => { throw new Error("No environment detector is configured (ENV_SCAN_DETECTOR_ENDPOINT)."); }],
  });
  assert.equal(noFallbackDetector.outcome, SCAN_OUTCOME.TECHNICAL);
  const edge = readFileSync("supabase/functions/environment-scan/index.ts", "utf8");
  assert.ok(/Without a detector nothing was checked.*\n\s*throw new DetectorUnavailableError\(\);/.test(edge) && edge.includes("json({ error: error.message }, 503)"), "Edge Function must fail, not pass, when no detector is configured.");
  // The reducer maps a technical failure to a retryable error state, not a rejection.
  const errored = analyze(captureAngle(createScanState(), "sweep"), "sweep", SCAN_OUTCOME.TECHNICAL, "front-r1", { reason: offline.reason });
  assert.equal(errored.angles.sweep.status, ANGLE_STATUS.ERROR);
  assert.equal(summarizeScan(errored).rejectedIds.length, 0);
  const retried = analyze(errored, "sweep", SCAN_OUTCOME.CLEAR, "front-r2");
  assert.equal(retried.angles.sweep.status, ANGLE_STATUS.APPROVED, "A failed check must be retryable without recapturing.");
}

// 10. Duplicate capture and analysis requests are ignored.
{
  const capturing = scanReducer(createScanState(), { type: "capture_started", angleId: "sweep", captureId: "f1" });
  assert.equal(scanReducer(capturing, { type: "capture_started", angleId: "sweep", captureId: "f2" }), capturing, "A second capture while capturing must be ignored.");
  const captured = scanReducer(capturing, { type: "capture_succeeded", angleId: "sweep", captureId: "f1", frames, signature: texturedSignature() });
  assert.equal(scanReducer(captured, { type: "capture_succeeded", angleId: "sweep", captureId: "f1", frames }), captured, "A repeated capture result must be ignored.");
  const started = scanReducer(captured, { type: "analysis_started", angleId: "sweep", requestId: "r1" });
  assert.equal(scanReducer(started, { type: "analysis_started", angleId: "sweep", requestId: "r2" }), started, "A second analysis for the same capture must be ignored.");
  // A view identical to another angle (camera not moved) is reported, a different view is not.
  assert.equal(findDuplicateAngle("desk", texturedSignature(), { sweep: texturedSignature() }), "sweep");
  assert.equal(findDuplicateAngle("desk", texturedSignature(40), { sweep: texturedSignature() }), null);
}

// 11. Out-of-order and stale results never overwrite newer state.
{
  let state = captureAngle(createScanState(), "sweep", "c1");
  state = scanReducer(state, { type: "analysis_started", angleId: "sweep", requestId: "old" });
  // Student retakes while the first check is still running.
  state = captureAngle(state, "sweep", "c2");
  state = scanReducer(state, { type: "analysis_started", angleId: "sweep", requestId: "new" });
  state = scanReducer(state, { type: "analysis_resolved", angleId: "sweep", requestId: "new", outcome: SCAN_OUTCOME.CLEAR, findings: [] });
  const late = scanReducer(state, { type: "analysis_resolved", angleId: "sweep", requestId: "old", outcome: SCAN_OUTCOME.RISK, findings: [{ label: "Phone" }] });
  assert.equal(late, state, "A late result for a superseded capture must be ignored.");
  assert.equal(late.angles.sweep.status, ANGLE_STATUS.APPROVED);
  // A capture result arriving after the angle was retaken is ignored.
  let retaken = scanReducer(createScanState(), { type: "capture_started", angleId: "desk", captureId: "u1" });
  retaken = scanReducer(retaken, { type: "retake", angleId: "desk" });
  assert.equal(scanReducer(retaken, { type: "capture_succeeded", angleId: "desk", captureId: "u1", frames }), retaken);
  // Results from before a full reset are ignored.
  const reset = scanReducer(allApproved(), { type: "reset" });
  assert.equal(scanReducer(reset, { type: "analysis_resolved", angleId: "sweep", requestId: "front-r1", outcome: SCAN_OUTCOME.CLEAR }), reset);
  assert.equal(summarizeScan(reset).capturedCount, 0);
}

// 12. Transition into the exam: only a fully approved scan unlocks entry, and the page still gates
// Start Exam on scanPassed and authorizes server-side after fullscreen and devices.
{
  assert.equal(summarizeScan(allApproved()).canEnterExam, true);
  const withRisk = analyze(captureAngle(allApproved(), "sweep", "f2"), "sweep", SCAN_OUTCOME.RISK, "f-r2");
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

// Room sweep: the bar follows how far the camera actually turned, measured from the pictures.
{
  // A simulated room seen through a 65-degree webcam: brightness by direction, with furniture-like blocks, plus
  // camera noise. A dark "person" can stand in front of the camera.
  const W = TURN_ANALYSIS_WIDTH;
  const H = TURN_ANALYSIS_HEIGHT;
  let seed = 11;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const roomAt = (degree, y) => {
    const d = ((degree % 360) + 360) % 360;
    return 120 + 50 * Math.sin(d / 7) + 35 * Math.sin(d / 2.3 + 1) + (Math.floor(d / 17) % 3) * 25 + (y < H / 3 ? -20 : y > (2 * H) / 3 ? 15 : 0);
  };
  function render(heading, { brightness = 1, personX = null, personWidth = 22, dark = false } = {}) {
    const gray = new Array(W * H);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const degree = heading + ((x - W / 2) / W) * CAMERA_HORIZONTAL_FOV_DEGREES;
        let value = roomAt(degree, y) * brightness + (random() - 0.5) * 6;
        if (personX !== null && Math.abs(x - personX) < personWidth && y > H * 0.25) value = 60 + (random() - 0.5) * 6;
        gray[y * W + x] = dark ? 5 + random() * 3 : Math.max(0, Math.min(255, value));
      }
    }
    return gray;
  }
  function sweepThrough(headings, options = () => ({}), intervalMs = SWEEP_SAMPLE_INTERVAL_MS) {
    let sweep = createSweep(0);
    headings.forEach((heading, index) => {
      const gray = render(heading, options(index));
      sweep = recordSweepSample(sweep, {
        profile: getColumnProfile(gray, W, H),
        signature: getGraySignature(gray, W, H),
        timestamp: index * intervalMs,
        getImage: () => `view-${index}`,
      });
    });
    return sweep;
  }
  const turn = (degrees, samples) => Array.from({ length: samples + 1 }, (_, index) => (degrees * index) / samples);
  const still = (samples) => Array(samples).fill(0);
  const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message} (got ${Math.round(actual)}, expected about ${expected}).`);

  // 1. A camera kept in one spot does not move the bar: not from noise, not from a person moving in front of it
  // (even one filling almost half the picture), and not from the light changing.
  for (const [name, options] of [
    ["camera noise", () => ({})],
    ["a person moving in front", (index) => ({ personX: 40 + 60 * Math.abs(Math.sin(index / 6)) })],
    ["a large person moving", (index) => ({ personX: 50 + 60 * Math.abs(Math.sin(index / 6)), personWidth: 35 })],
    ["the light changing", (index) => ({ brightness: 0.8 + 0.4 * Math.abs(Math.sin(index / 15)) })],
  ]) {
    const progress = getSweepProgress(sweepThrough(still(150), options));
    assert.ok(progress.turnedDegrees < 1, `A still camera with ${name} must not turn the bar (got ${progress.turnedDegrees}).`);
    assert.equal(progress.coverage, 0);
    assert.equal(progress.canFinish, false);
  }
  assert.match(finishSweep(sweepThrough(still(150))).reason, /turned only about 0 degrees/);
  // Small shaking in place adds next to nothing.
  assert.ok(getSweepProgress(sweepThrough(Array.from({ length: 150 }, (_, index) => 3 * Math.sin(index)))).turnedDegrees < 10);

  // 2. The bar follows the turn: a quarter turn is a quarter of the bar, half a turn is half.
  near(getSweepProgress(sweepThrough(turn(90, 50))).turnedDegrees, 90, 6, "A quarter turn reads 90 degrees");
  near(getSweepProgress(sweepThrough(turn(180, 75))).coverage * 100, 50, 3, "Half a turn fills half the bar");
  assert.equal(finishSweep(sweepThrough(turn(180, 75))).ok, false, "Half a turn is not a room sweep.");

  // 3. A full 360-degree turn fills the bar and finishes, at a slow or a brisk pace, in either direction, with the
  // light changing or someone walking past. At most 12 photos, one per new direction, go to the AI check.
  for (const [name, headings, options] of [
    ["in 30 s", turn(360, 150), () => ({})],
    ["slowly, in 60 s", turn(360, 300), () => ({})],
    ["briskly, in 15 s", turn(360, 75), () => ({})],
    ["to the left", turn(-360, 150), () => ({})],
    ["while the light changes", turn(360, 150), (index) => ({ brightness: 0.85 + index / 600 })],
    ["while someone walks past", turn(360, 150), (index) => ({ personX: index > 40 && index < 80 ? (index - 40) * 4 : null })],
  ]) {
    const sweep = sweepThrough(headings, options);
    const progress = getSweepProgress(sweep);
    assert.equal(progress.complete, true, `A full turn ${name} completes the sweep (turned ${Math.round(progress.turnedDegrees)}).`);
    assert.equal(progress.coverage, 1);
    const finished = finishSweep(sweep);
    assert.equal(finished.ok, true, `A full turn ${name} passes.`);
    assert.ok(finished.frames.length >= 10 && finished.frames.length <= SWEEP_MAX_FRAMES, `About one photo per 30 degrees (${finished.frames.length}).`);
    assert.equal(finished.frames[0].image, "view-0", "The starting view is always sent.");
    assert.ok(finished.frames.every((frame) => frame.angle === "sweep"));
  }

  // 4. Turning back and forth over one corner only counts that corner once.
  const backAndForth = getSweepProgress(sweepThrough(Array.from({ length: 150 }, (_, index) => 60 * Math.abs(Math.sin(index / 10)))));
  near(backAndForth.turnedDegrees, 60, 6, "Going back and forth over 60 degrees counts 60 degrees");
  // Turning right a half circle then left a half circle shows the whole room.
  const bothWays = getSweepProgress(sweepThrough([...turn(180, 75), ...turn(-180, 150).map((heading) => 180 + heading), ...turn(-180, 75).map((heading) => heading)]));
  assert.equal(bothWays.complete, true, "Half a circle each way covers the whole room.");

  // 5. Spinning too fast to follow is not counted, so the bar stays low and the student slows down.
  assert.equal(getSweepProgress(sweepThrough(turn(360, 20))).complete, false, "A 4-second spin does not complete the sweep.");

  // 6. Done unlocks near a full turn, and coming back to the starting view after most of a turn finishes it
  // (the degree estimate depends on the camera's real width of view).
  assert.equal(getSweepProgress(sweepThrough(turn(270, 120))).canFinish, false);
  assert.equal(getSweepProgress(sweepThrough(turn(335, 140))).canFinish, true);
  assert.equal(getSweepProgress(sweepThrough(turn(335, 140))).complete, false, "Not complete until a full turn or back at the start.");

  // 7. A dark room cannot be followed or checked: the bar does not move and the reason is about light.
  const dark = sweepThrough(turn(360, 150), () => ({ dark: true }));
  assert.equal(getSweepProgress(dark).turnedDegrees, 0);
  assert.equal(getSweepProgress(dark).lostTrack, true, "The student is told the camera lost track.");
  assert.equal(finishSweep(dark).ok, false);

  // 8. Sweeps stop after the time limit.
  assert.equal(getSweepProgress(sweepThrough(still(10), () => ({}), 15000)).timedOut, true);

  // Building blocks: a slide is found in the right direction and size, a still picture reads no slide, and
  // brightness alone is not movement.
  const profileAt = (heading, options) => getColumnProfile(render(heading, options), W, H);
  const fiveDegrees = (5 / CAMERA_HORIZONTAL_FOV_DEGREES) * W;
  near(estimateTurnShift(profileAt(0), profileAt(5), 32).shift, fiveDegrees, 1, "Turning right 5 degrees slides the picture left");
  near(estimateTurnShift(profileAt(0), profileAt(-5), 32).shift, -fiveDegrees, 1, "Turning left slides it right");
  assert.ok(Math.abs(estimateTurnShift(profileAt(0), profileAt(0, { brightness: 1.3 }), 32).shift) <= 1, "Brighter is not a turn.");
  assert.equal(estimateTurnShift(profileAt(0, { dark: true }), profileAt(0, { dark: true }), 32), null, "A dark picture cannot be followed.");
  const signature = getGraySignature(render(0), W, H);
  assert.equal(signature.length, 96);
  assert.ok(getViewDistance(signature, signature.map((value) => value + 30)) < 0.001, "Brightness alone is not a different view.");
  assert.equal(assessCaptureQuality([getGraySignature(render(0, { dark: true }), W, H)]).ok, false);
}

console.log("environment scan helpers ok");
