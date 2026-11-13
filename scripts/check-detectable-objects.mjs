/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ALL_DETECTABLE_CATEGORIES, DETECTABLE_OBJECTS, allowedObjectLabels, isObjectDetected, normalizeDetectObjects, toggleDetectObject } from "../src/lib/detectableObjects.js";
import { DETECTION_RULES, SCAN_OUTCOME, analyzeAngleCapture, classifyAngleDetections } from "../src/lib/environmentScan.js";
import { GUESS_DETECTOR_CATEGORIES, LIVE_OBJECT_CATEGORIES, createLiveObjectMonitor } from "../src/lib/liveObjectMonitor.js";

// Every listed item is a real detection rule, and every rule except another person can be turned off.
const ruleCategories = DETECTION_RULES.map((rule) => rule.category);
DETECTABLE_OBJECTS.forEach((item) => assert.ok(ruleCategories.includes(item.category), `${item.category} has a detection rule`));
assert.deepEqual(ruleCategories.filter((category) => !ALL_DETECTABLE_CATEGORIES.includes(category)), ["person"]);
Object.keys(LIVE_OBJECT_CATEGORIES).forEach((category) => assert.ok(ALL_DETECTABLE_CATEGORIES.includes(category)));

// Exams saved before the setting existed keep every item on; a saved list is cleaned and kept in order.
assert.deepEqual(normalizeDetectObjects(undefined), ALL_DETECTABLE_CATEGORIES);
assert.deepEqual(normalizeDetectObjects(null), ALL_DETECTABLE_CATEGORIES);
assert.deepEqual(normalizeDetectObjects("phone"), ALL_DETECTABLE_CATEGORIES);
assert.deepEqual(normalizeDetectObjects([]), [], "An empty list means every item is off.");
assert.deepEqual(normalizeDetectObjects(["book", "phone", "person", "nonsense", "phone"]), ["phone", "book"]);
assert.equal(isObjectDetected(null, "calculator"), true);
assert.equal(isObjectDetected(["phone"], "calculator"), false);
assert.equal(isObjectDetected([], "person"), true, "Another person is always checked.");
assert.deepEqual(toggleDetectObject(undefined, "calculator"), ALL_DETECTABLE_CATEGORIES.filter((item) => item !== "calculator"));
assert.deepEqual(toggleDetectObject(["book"], "phone"), ["phone", "book"]);
assert.deepEqual(allowedObjectLabels(ALL_DETECTABLE_CATEGORIES.filter((item) => !["calculator", "book"].includes(item))), ["Calculator", "Book"]);
assert.deepEqual(allowedObjectLabels(undefined), []);

// Environment scan: an item that is off never fails a step; items that are on and another person still do.
const desk = (...predictions) => ({ angleId: "desk", frames: [{ predictions }, { predictions }] });
const calculator = { class: "calculator", confidence: 0.9 };
const phone = { class: "cell phone", confidence: 0.9 };
const people = [{ class: "person", confidence: 0.95 }, { class: "person", confidence: 0.92 }];
const noCalculator = ALL_DETECTABLE_CATEGORIES.filter((item) => item !== "calculator");
assert.deepEqual(classifyAngleDetections(desk(calculator)).findings.map((item) => item.category), ["calculator"]);
assert.equal(classifyAngleDetections({ ...desk(calculator), enabledCategories: noCalculator }).outcome, SCAN_OUTCOME.CLEAR);
assert.deepEqual(classifyAngleDetections({ ...desk(calculator, phone), enabledCategories: noCalculator }).findings.map((item) => item.category), ["phone"]);
assert.deepEqual(classifyAngleDetections({ ...desk(...people), enabledCategories: [] }).findings.map((item) => item.category), ["person"]);
{
  const detector = async () => ({ frames: [{ predictions: [calculator] }, { predictions: [calculator] }] });
  const frames = [{ image: "a" }, { image: "b" }];
  const off = await analyzeAngleCapture({ angleId: "desk", frames, detectors: [detector], enabledCategories: noCalculator });
  assert.equal(off.outcome, SCAN_OUTCOME.CLEAR, "The exam's list reaches the scan check.");
  const on = await analyzeAngleCapture({ angleId: "desk", frames, detectors: [detector] });
  assert.equal(on.outcome, SCAN_OUTCOME.RISK);
}

// Live camera: items that are off are not watched and never record a violation.
{
  const monitor = createLiveObjectMonitor({ enabledCategories: noCalculator });
  assert.ok(!monitor.watchedCategories().includes("calculator"));
  assert.deepEqual(monitor.observe({ ok: true, predictions: [calculator] }), []);
  assert.deepEqual(monitor.observe({ ok: true, predictions: [phone] }).map((action) => action.category), ["phone"]);
  assert.deepEqual(createLiveObjectMonitor().watchedCategories(), Object.keys(LIVE_OBJECT_CATEGORIES), "No list watches every item.");
  assert.deepEqual(createLiveObjectMonitor({ enabledCategories: [] }).watchedCategories(), []);
  assert.ok(!GUESS_DETECTOR_CATEGORIES.includes("smartwatch"), "The browser model is not asked about smartwatches.");
  assert.ok(GUESS_DETECTOR_CATEGORIES.includes("notes"));
}

// Wiring: the professor picks the items, and the exam page passes them to both checks.
const create = readFileSync("src/pages/professor/ProfessorCreateExam.jsx", "utf8");
const take = readFileSync("src/pages/student/StudentExamTake.jsx", "utf8");
assert.match(create, /detectObjects: \[\.\.\.ALL_DETECTABLE_CATEGORIES\]/, "New exams start with every item on.");
assert.match(create, /requireEnvironmentScan \|\| examForm\.settings\.liveCameraMonitoring \? \([\s\S]*<legend>Objects to detect<\/legend>[\s\S]*DETECTABLE_OBJECTS\.map/);
assert.match(create, /toggleDetectObject\(current\.settings\.detectObjects, category\)/);
assert.match(take, /detectObjects: normalizeDetectObjects\(parsed\.detectObjects \?\? parsed\.detect_objects\)/);
assert.match(take, /enabledCategories: examSettings\.detectObjects,\s*\}\);/, "The scan uses the exam's list.");
assert.match(take, /liveObjectMonitorRef\.current = createLiveObjectMonitor\(\{ enabledCategories: examSettings\.detectObjects \}\);\s*const watched = liveObjectMonitorRef\.current\.watchedCategories\(\);\s*if \(!watched\.length\) return;/);
assert.match(take, /if \(!watched\.some\(\(category\) => GUESS_DETECTOR_CATEGORIES\.includes\(category\)\)\) return;/);
assert.match(take, /Allowed in this exam:/);

console.log("Detectable object checks passed.");
