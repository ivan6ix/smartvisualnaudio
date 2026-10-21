/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createIncidentTracker } from "../src/lib/examViolationLimit.js";
import { LIVE_CLEAR_SAMPLES, createLiveObjectMonitor } from "../src/lib/liveObjectMonitor.js";

const sample = (...predictions) => ({ ok: true, predictions });
const laptop = (confidence) => ({ class: "laptop", confidence });
const types = (actions, type) => actions.filter((action) => action.type === type);

// Feeds samples and counts violations the page would record (the page latches each violation type
// with the incident tracker until the monitor reports the event cleared).
function run(samples) {
  const monitor = createLiveObjectMonitor();
  const tracker = createIncidentTracker();
  const recorded = [];
  const warnings = [];
  samples.forEach((entry) => {
    monitor.observe(entry).forEach((action) => {
      if (action.type === "violation" && tracker.claim(action.violationType)) recorded.push(action);
      if (action.type === "uncertain") warnings.push(action);
      if (action.type === "cleared" && !monitor.activeTypes().has(action.violationType)) tracker.clear(action.violationType);
    });
  });
  return { recorded, warnings, monitor };
}

// Clear environment: furniture, keyboard, mouse and the student never warn or record.
{
  const clear = run(Array.from({ length: 10 }, () => sample({ class: "keyboard", confidence: 0.9 }, { class: "person", confidence: 0.97 }, { class: "chair", confidence: 0.8 })));
  assert.equal(clear.recorded.length, 0);
  assert.equal(clear.warnings.length, 0);
}

// One reliably detected laptop is a violation, after temporal confirmation (not on the first frame).
{
  const monitor = createLiveObjectMonitor();
  assert.deepEqual(types(monitor.observe(sample(laptop(0.82))), "violation"), [], "A single frame must not confirm a violation.");
  const second = types(monitor.observe(sample(laptop(0.8))), "violation");
  assert.equal(second.length, 1, "Two reliable laptop frames confirm a violation.");
  assert.equal(second[0].violationType, "GADGET_DETECTED");
  assert.match(second[0].message, /Laptop detected in camera view \(82%\)/);
}

// Multiple laptops in view are one continuous laptop event.
{
  const many = run(Array.from({ length: 6 }, () => sample(laptop(0.9), laptop(0.75))));
  assert.equal(many.recorded.length, 1);
  assert.equal(many.recorded[0].category, "laptop");
}

// Uncertain laptop detections warn once and never record a violation.
{
  const uncertain = run([sample(laptop(0.5)), sample(), sample(laptop(0.52)), sample(), sample(), sample()]);
  assert.equal(uncertain.recorded.length, 0, "Sporadic mid-confidence laptops must not become violations.");
  assert.equal(uncertain.warnings.length, 1, "The student is asked once to remove/verify the item.");
  assert.match(uncertain.warnings[0].message, /Possible laptop[\s\S]*being verified/);
  // A persistent lower-confidence laptop is confirmed by duration.
  const persistent = run(Array.from({ length: 4 }, () => sample(laptop(0.5))));
  assert.equal(persistent.recorded.length, 1);
  // Below the floor is ignored entirely.
  assert.equal(run(Array.from({ length: 8 }, () => sample(laptop(0.3)))).warnings.length, 0);
}

// One continuous event with flicker records exactly one violation; it can never alone reach the limit.
{
  const flicker = run([
    sample(laptop(0.8)), sample(laptop(0.8)), sample(), sample(laptop(0.7)), sample(), sample(),
    sample(laptop(0.9)), sample(), sample(laptop(0.85)), sample(laptop(0.85)),
  ]);
  assert.equal(flicker.recorded.length, 1, "Flicker within one event must not create duplicate violations.");
  // After the event clears, a new appearance is a new event.
  const again = run([
    sample(laptop(0.8)), sample(laptop(0.8)),
    ...Array.from({ length: LIVE_CLEAR_SAMPLES }, () => sample()),
    sample(laptop(0.8)), sample(laptop(0.8)),
  ]);
  assert.equal(again.recorded.length, 2);
}

// Technical failures never confirm, extend or clear an event.
{
  const failures = run([sample(laptop(0.8)), { ok: false }, { ok: false }, { ok: false }, { ok: false }, { ok: false }]);
  assert.equal(failures.recorded.length, 0, "Detector failures between frames must not confirm a detection.");
  const duringEvent = run([sample(laptop(0.8)), sample(laptop(0.8)), { ok: false }, { ok: false }, { ok: false }, { ok: false }, sample(laptop(0.8)), sample(laptop(0.8))]);
  assert.equal(duringEvent.recorded.length, 1, "Failures must not clear an active event and re-trigger it.");
  assert.ok(duringEvent.monitor.activeTypes().has("GADGET_DETECTED"));
  assert.equal(run([{ ok: false }, undefined, { ok: true, predictions: "bad" }]).recorded.length, 0);
}

// Phones and tablets keep their own violation type; a laptop alongside a phone is a separate event.
{
  const mixed = run([
    sample({ class: "cell phone", confidence: 0.7 }), sample({ class: "cell phone", confidence: 0.7 }, laptop(0.8)), sample(laptop(0.8)),
  ]);
  assert.deepEqual(mixed.recorded.map((action) => action.violationType), ["PHONE_DETECTED", "GADGET_DETECTED"]);
  const tablet = run([sample({ class: "tablet", confidence: 0.9 }), sample({ class: "tablet", confidence: 0.9 })]);
  assert.equal(tablet.recorded[0].violationType, "PHONE_DETECTED");
}

// The page feeds every live detection through the monitor and treats failed samples as technical.
{
  const page = readFileSync("src/pages/student/StudentExamTake.jsx", "utf8");
  assert.ok(page.includes("liveObjectMonitorRef.current.observe({ ok: succeeded, predictions })"), "Interval detection must report technical failures as ok:false.");
  assert.ok(page.includes("liveObjectMonitorRef.current.observe({ ok: true, predictions: collectRoboflowPredictions(data) })"), "WebRTC detections must use the same monitor.");
  assert.ok(page.includes("if (!video?.videoWidth || objectDetectionInFlightRef.current) return;"), "Overlapping detection runs must be skipped.");
  assert.ok(!/phoneAlertCooldownRef|objectAlertCooldownRef|roboflowAlertCooldownRef|GADGET_LABELS/.test(page), "Per-frame cooldown object detection must stay removed.");
}

console.log("live object monitor ok");
