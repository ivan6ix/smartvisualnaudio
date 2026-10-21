/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DIGITAL_SILENCE_NOTICE_MS,
  MICROPHONE_VIOLATION_CONFIRM_MS,
  classifyMicrophoneState,
  createMicrophoneInterruptionGate,
  createSilenceTracker,
  isMicrophonePermissionRevoked,
  measureRms,
} from "../src/lib/microphoneSignal.js";

// A quiet but working microphone: ~-66 dBFS noise floor.
const quietFloat = Float32Array.from({ length: 1024 }, (_, index) => Math.sin(index * 1.7) * 0.0007);
const quietBytes = Uint8Array.from(quietFloat, (value) => Math.round(128 + value * 128));
const zeros = new Float32Array(1024);

// Root cause: 8-bit samples round a quiet room to exact zero; float samples do not.
assert.equal(measureRms(quietBytes, { byteSamples: true }), 0, "8-bit analyser data cannot represent a quiet room's noise floor.");
assert.ok(measureRms(quietFloat) > 0.0004);

function silenceRun(rms, precise, ms) {
  const tracker = createSilenceTracker();
  const events = [];
  for (let now = 0; now <= ms; now += 1000) {
    const event = tracker.observe({ rms, precise, now });
    if (event) events.push(event);
  }
  return events;
}

// 1. Quiet but active microphone: never a notice, pause or violation.
assert.deepEqual(silenceRun(measureRms(quietFloat), true, 5 * 60000), []);
// Byte-only browsers (no float API) cannot tell silence apart, so they never raise a notice.
assert.deepEqual(silenceRun(0, false, 5 * 60000), []);

// 2. Exact digital silence (possible OS/hardware mute) only raises one non-blocking notice.
assert.deepEqual(silenceRun(measureRms(zeros), true, DIGITAL_SILENCE_NOTICE_MS - 1000), []);
assert.deepEqual(silenceRun(measureRms(zeros), true, 5 * 60000), ["notice"]);
{
  const tracker = createSilenceTracker();
  for (let now = 0; now <= DIGITAL_SILENCE_NOTICE_MS; now += 1000) tracker.observe({ rms: 0, precise: true, now });
  assert.equal(tracker.observe({ rms: 0.001, precise: true, now: DIGITAL_SILENCE_NOTICE_MS + 1000 }), "signal_restored");
}

// 3. Browser-reported failures map to the right violation type; a healthy track is null.
const live = { readyState: "live", enabled: true, muted: false };
assert.equal(classifyMicrophoneState({ track: live }), null);
assert.equal(classifyMicrophoneState({ track: null }).type, "MICROPHONE_UNAVAILABLE");
assert.equal(classifyMicrophoneState({ track: { ...live, readyState: "ended" } }).type, "MICROPHONE_DISCONNECTED");
assert.equal(classifyMicrophoneState({ track: { ...live, enabled: false } }).type, "MICROPHONE_MUTED");
assert.equal(classifyMicrophoneState({ track: { ...live, muted: true } }).type, "MICROPHONE_MUTED");
assert.equal(classifyMicrophoneState({ track: live, permissionState: "denied" }).type, "MICROPHONE_ACCESS_LOST");

// Permission revocation: denied, or granted -> prompt; an initial prompt (Firefox one-time grant) is not.
assert.equal(isMicrophonePermissionRevoked("granted", "denied"), true);
assert.equal(isMicrophonePermissionRevoked("granted", "prompt"), true);
assert.equal(isMicrophonePermissionRevoked(null, "prompt"), false);
assert.equal(isMicrophonePermissionRevoked("granted", "granted"), false);

// 4. One violation per genuine interruption, only after it persists.
{
  const gate = createMicrophoneInterruptionGate();
  const issue = { type: "MICROPHONE_MUTED", reason: "muted" };
  assert.equal(gate.report(issue, 0), true);
  assert.equal(gate.report(issue, 500), false, "Repeated reports belong to the same interruption.");
  assert.equal(gate.due(MICROPHONE_VIOLATION_CONFIRM_MS - 1), null, "A momentary mute is not a violation.");
  gate.restore();
  assert.equal(gate.due(10000), null, "A mute that recovered before confirmation is never recorded.");

  gate.report({ type: "MICROPHONE_DISCONNECTED", reason: "ended" }, 20000);
  assert.deepEqual(gate.due(20000 + MICROPHONE_VIOLATION_CONFIRM_MS), { type: "MICROPHONE_DISCONNECTED", reason: "ended" });
  assert.equal(gate.due(60000), null, "A continuing interruption is recorded once.");
  gate.report({ type: "MICROPHONE_ACCESS_LOST", reason: "lost" }, 61000);
  assert.equal(gate.due(70000), null, "A second failure during the same interruption is not a second violation.");
  gate.restore();
  gate.report({ type: "MICROPHONE_ACCESS_LOST", reason: "lost" }, 80000);
  assert.equal(gate.due(80000 + MICROPHONE_VIOLATION_CONFIRM_MS).type, "MICROPHONE_ACCESS_LOST", "A new interruption after recovery is a new event.");
}

// 5. Wiring: silence never reaches the violation path; violations go through the gate.
{
  const hook = readFileSync("src/hooks/useLiveAudioMonitoring.js", "utf8");
  const page = readFileSync("src/pages/student/StudentExamTake.jsx", "utf8");
  assert.ok(!/MICROPHONE_|onMicrophoneIssue/.test(hook), "Audio level/silence must not raise microphone violations.");
  assert.ok(hook.includes("getFloatTimeDomainData"), "Silence must be measured with float samples where available.");
  assert.ok(/function handleMicrophoneIssue[\s\S]{0,600}microphoneInterruptionRef\.current\.report/.test(page), "Microphone issues must go through the interruption gate.");
  assert.ok(/function confirmMicrophoneInterruption\(\) \{\s*if \(!microphoneBlockedRef\.current\) return;\s*const due = microphoneInterruptionRef\.current\.due\(Date\.now\(\)\);\s*if \(due\) recordManualViolation\(due\.type, due\.reason, "High"\);/.test(page));
  assert.ok(!/handleMicrophoneIssue[^;]*recordManualViolation/.test(page.match(/function handleMicrophoneIssue[\s\S]*?\n {2}\}/)[0]), "handleMicrophoneIssue must not record directly.");
}

console.log("microphone signal ok");
