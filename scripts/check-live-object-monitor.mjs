/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createIncidentTracker } from "../src/lib/examViolationLimit.js";
import { LIVE_CLEAR_SAMPLES, LIVE_GUESS_CONFIRM_SAMPLES, createLiveObjectMonitor } from "../src/lib/liveObjectMonitor.js";

const sample = (...predictions) => ({ ok: true, predictions });
// A sample from OWL-ViT, the guessing detector (the only one that knows what paper looks like).
const owlSample = (...predictions) => ({ ok: true, guessChecked: true, predictions: predictions.map((item) => ({ ...item, source: "owl" })) });
const laptop = (confidence) => ({ class: "laptop", confidence });
const phone = (confidence) => ({ class: "cell phone", confidence });
const paper = (confidence, areaRatio = 0.2) => ({ class: "paper", confidence, areaRatio });
const types = (actions, type) => actions.filter((action) => action.type === type);

// Feeds samples and counts violations the page would record (the page latches each violation type
// with the incident tracker until the monitor reports the event cleared).
function run(samples) {
  const monitor = createLiveObjectMonitor();
  const tracker = createIncidentTracker();
  const recorded = [];
  const other = [];
  samples.forEach((entry) => {
    monitor.observe(entry).forEach((action) => {
      if (action.type === "violation" && tracker.claim(action.violationType)) recorded.push(action);
      else if (action.type === "cleared") {
        if (!monitor.activeTypes().has(action.violationType)) tracker.clear(action.violationType);
      } else if (action.type !== "violation") other.push(action);
    });
  });
  return { recorded, other, monitor };
}

// Clear environment: furniture, keyboard, mouse and the student never record.
{
  const clear = run(Array.from({ length: 10 }, () => sample({ class: "keyboard", confidence: 0.9 }, { class: "person", confidence: 0.97 }, { class: "chair", confidence: 0.8 })));
  assert.equal(clear.recorded.length, 0);
  assert.equal(clear.other.length, 0);
}

// A phone shown to the camera is a violation at once: one clear sighting, no warning first.
{
  const monitor = createLiveObjectMonitor();
  const first = monitor.observe(sample(phone(0.62)));
  assert.equal(types(first, "violation").length, 1, "The first clear phone sighting must be a violation.");
  assert.equal(first[0].violationType, "PHONE_DETECTED");
  assert.match(first[0].message, /Phone detected in camera view \(62%\)/);
  assert.ok(first.every((action) => action.type !== "uncertain"), "There is no warning step.");
  // Weaker sightings are ignored without a warning.
  const faint = run([sample(phone(0.4)), sample(phone(0.45)), sample(phone(0.35))]);
  assert.equal(faint.recorded.length, 0);
  assert.equal(faint.other.length, 0, "A faint sighting never warns the student.");
  assert.equal(run(Array.from({ length: 8 }, () => sample(phone(0.2)))).recorded.length, 0, "Below the floor is ignored.");
}

// The same goes for a laptop, and several laptops in view are one continuous event.
{
  const monitor = createLiveObjectMonitor();
  const first = types(monitor.observe(sample(laptop(0.82))), "violation");
  assert.equal(first.length, 1);
  assert.equal(first[0].violationType, "GADGET_DETECTED");
  const many = run(Array.from({ length: 6 }, () => sample(laptop(0.9), laptop(0.75))));
  assert.equal(many.recorded.length, 1);
  assert.equal(many.recorded[0].category, "laptop");
}

// Paper held up to the camera: OWL-ViT only guesses, so it counts after two of its checks in a row.
{
  assert.equal(LIVE_GUESS_CONFIRM_SAMPLES, 2);
  const held = run([owlSample(paper(0.8)), sample(), sample(), owlSample(paper(0.75))]);
  assert.equal(held.recorded.length, 1, "Paper seen on two OWL checks in a row is a violation.");
  assert.equal(held.recorded[0].violationType, "NOTES_DETECTED");
  assert.match(held.recorded[0].message, /Notes or papers detected in camera view/);
  // One OWL sighting alone is not enough, and a check in between without paper resets it.
  assert.equal(run([owlSample(paper(0.9))]).recorded.length, 0, "One OWL guess does not count.");
  assert.equal(run([owlSample(paper(0.9)), owlSample(), owlSample(paper(0.9))]).recorded.length, 0, "The two sightings must be in a row.");
  // The trained detectors' checks in between (they cannot see paper) do not reset it.
  assert.equal(run([owlSample(paper(0.8)), sample(), sample(), sample(), owlSample(paper(0.8))]).recorded.length, 1);
  // A paper that stays in view is one violation, not one every few seconds; it clears only on OWL's own checks.
  const stays = run([owlSample(paper(0.8)), owlSample(paper(0.8)), ...Array.from({ length: 10 }, () => sample()), owlSample(paper(0.8))]);
  assert.equal(stays.recorded.length, 1);
  assert.ok(stays.monitor.activeTypes().has("NOTES_DETECTED"));
  const removed = run([owlSample(paper(0.8)), owlSample(paper(0.8)), ...Array.from({ length: LIVE_CLEAR_SAMPLES }, () => owlSample()), owlSample(paper(0.8)), owlSample(paper(0.8))]);
  assert.equal(removed.recorded.length, 2, "Paper shown again after it was put away is a new violation.");
  // A small book far behind the student (a shelf) is not in their hand.
  assert.equal(run([sample({ class: "book", confidence: 0.9, areaRatio: 0.01 })]).recorded.length, 0);
  // A book the trained detector sees clearly, close to the camera, counts at once.
  assert.equal(run([sample({ class: "book", confidence: 0.7, areaRatio: 0.15 })]).recorded[0].violationType, "NOTES_DETECTED");
  // A phone guessed by OWL alone also needs two checks in a row; a trained detector's sighting is instant.
  assert.equal(run([owlSample(phone(0.9))]).recorded.length, 0);
  assert.equal(run([owlSample(phone(0.9)), owlSample(phone(0.9))]).recorded[0].violationType, "PHONE_DETECTED");
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
    sample(laptop(0.8)),
    ...Array.from({ length: LIVE_CLEAR_SAMPLES }, () => sample()),
    sample(laptop(0.8)),
  ]);
  assert.equal(again.recorded.length, 2);
}

// Technical failures never confirm, extend or clear an event.
{
  const duringEvent = run([sample(laptop(0.8)), { ok: false }, { ok: false }, { ok: false }, { ok: false }, sample(laptop(0.8))]);
  assert.equal(duringEvent.recorded.length, 1, "Failures must not clear an active event and re-trigger it.");
  assert.ok(duringEvent.monitor.activeTypes().has("GADGET_DETECTED"));
  assert.equal(run([{ ok: false }, undefined, { ok: true, predictions: "bad" }]).recorded.length, 0);
}

// Phones and tablets keep their own violation type; a laptop alongside a phone is a separate event.
{
  const mixed = run([sample(phone(0.7)), sample(phone(0.7), laptop(0.8)), sample(laptop(0.8))]);
  assert.deepEqual(mixed.recorded.map((action) => action.violationType), ["PHONE_DETECTED", "GADGET_DETECTED"]);
  assert.equal(run([sample({ class: "tablet", confidence: 0.9 })]).recorded[0].violationType, "PHONE_DETECTED");
}

// The page feeds every live detection through the monitor, runs OWL-ViT on its own timer, never warns first,
// and labels directions from the student's point of view.
{
  const page = readFileSync("src/pages/student/StudentExamTake.jsx", "utf8");
  assert.ok(page.includes("liveObjectMonitorRef.current.observe({ ok: succeeded, predictions })"), "Interval detection must report technical failures as ok:false.");
  assert.ok(page.includes("liveObjectMonitorRef.current.observe({ ok: true, predictions: collectRoboflowPredictions(data) })"), "WebRTC detections must use the same monitor.");
  assert.ok(page.includes("liveObjectMonitorRef.current.observe({ ok: true, guessChecked: true,"), "OWL-ViT checks must be marked as the guessing detector.");
  assert.ok(page.includes("if (!video?.videoWidth || objectDetectionInFlightRef.current) return;"), "Overlapping detection runs must be skipped.");
  assert.ok(page.includes("if (!video?.videoWidth || owlDetectionInFlightRef.current) return;"), "Overlapping OWL runs must be skipped.");
  assert.ok(/window\.clearInterval\(owlMonitorRef\.current\)/.test(page), "The OWL timer must stop with the other monitors.");
  assert.ok(!/action\.type === "uncertain"/.test(page), "No warning step for detected items.");
  assert.ok(!/phoneAlertCooldownRef|objectAlertCooldownRef|roboflowAlertCooldownRef|GADGET_LABELS/.test(page), "Per-frame cooldown object detection must stay removed.");
  assert.ok(page.includes('const status = centerX < 0.5 ? "Looking right" : "Looking left";'), "A face on the left of the unmirrored picture is the student turning to their right.");
  assert.ok(/horizontalDelta < -GAZE_HORIZONTAL_THRESHOLD[^\n]*\n\s*nextDirection = "looking right";/.test(page.replace(/\r/g, "")), "Eyes moving to the left of the picture are the student looking right.");
  assert.ok(page.includes('"NOTES_DETECTED"') && /SNAPSHOT_VIOLATION_TYPES = new Set\(\[[^\]]*"NOTES_DETECTED"/.test(page), "Notes violations keep a snapshot like phones.");
}

// The new violation type exists in the database and has labels wherever violations are shown.
{
  assert.match(readFileSync("supabase/migrations/20261110130000_notes_detected_violation.sql", "utf8"), /add value if not exists 'NOTES_DETECTED'/);
  for (const file of ["src/lib/integrityRisk.js", "src/pages/Dashboard.jsx", "src/pages/dean/DeanDashboard.jsx", "src/pages/dean/DeanExamIntegrity.jsx", "src/pages/professor/ProfessorDashboard.jsx", "src/pages/professor/ProfessorMonitoring.jsx", "src/pages/Reports.jsx"]) {
    assert.ok(readFileSync(file, "utf8").includes("NOTES_DETECTED"), `${file} must know the notes violation type.`);
  }
}

console.log("live object monitor ok");
