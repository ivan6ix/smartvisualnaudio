/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  RISK_RULES,
  buildRiskQueue,
  riskLevel,
  scoreRisk,
  summarizeIntegrity,
  violationLabel,
} from "../src/lib/integrityRisk.js";

const start = "2026-10-28T08:00:00Z";
const at = (minutes) => new Date(Date.parse(start) + minutes * 60000).toISOString();
const violation = (type, minutes, extra = {}) => ({ violation_type: type, created_at: at(minutes), exam_id: "e1", student_id: "s1", ...extra });

// Levels.
assert.equal(riskLevel(0), "Low");
assert.equal(riskLevel(29), "Low");
assert.equal(riskLevel(30), "Medium");
assert.equal(riskLevel(59), "Medium");
assert.equal(riskLevel(60), "High");

// Each rule adds points per event up to its cap; the total is capped at 100.
const attempt = { id: "a1", exam_id: "e1", student_id: "s1", score: 70, started_at: start, submitted_at: at(40) };
const none = scoreRisk({ violations: [], attempt, durationMinutes: 60, classMean: 65 });
assert.deepEqual({ score: none.score, level: none.level, reasons: none.reasons }, { score: 0, level: "Low", reasons: [] });

const mixed = scoreRisk({
  violations: [
    ...Array.from({ length: 6 }, (_, index) => violation("NO_FACE", 5 + index)),
    violation("LOOKING_AWAY", 20),
    violation("PHONE_DETECTED", 30),
    violation("TAB_SWITCH", 35),
    violation("TAB_SWITCH", 36),
  ],
  attempt,
  durationMinutes: 60,
  classMean: 65,
});
// Face: 7 events x 4 = 28 -> cap 24. Phone: 25. Tab: 2 x 5 = 10. Total 59.
assert.equal(mixed.score, 59);
assert.equal(mixed.level, "Medium");
assert.deepEqual(mixed.reasons.map((reason) => [reason.label, reason.count, reason.points]), [
  ["Phone or gadget", 1, 25],
  ["No face or looking away", 7, 24],
  ["Tab switch, copy or fullscreen exit", 2, 10],
]);

const capped = scoreRisk({
  violations: [
    ...Array.from({ length: 4 }, (_, index) => violation("PHONE_DETECTED", index)),
    ...Array.from({ length: 4 }, (_, index) => violation("MULTIPLE_FACE", index)),
    ...Array.from({ length: 9 }, (_, index) => violation("FULLSCREEN_EXIT", index)),
  ],
  attempt,
  durationMinutes: 60,
  classMean: 65,
});
assert.equal(capped.score, 100, "Total is capped at 100.");
assert.equal(capped.level, "High");
assert.equal(capped.reasons.find((reason) => reason.label === "Phone or gadget").points, 40, "Phone points are capped at 40.");

// Finishing very fast with a score far above the class mean adds 15 points; either alone adds nothing.
const fastHigh = scoreRisk({ violations: [], attempt: { ...attempt, score: 95, submitted_at: at(10) }, durationMinutes: 60, classMean: 60 });
assert.equal(fastHigh.score, 15);
assert.equal(fastHigh.reasons[0].label, "Very fast with a much higher score");
assert.equal(scoreRisk({ violations: [], attempt: { ...attempt, score: 95, submitted_at: at(30) }, durationMinutes: 60, classMean: 60 }).score, 0);
assert.equal(scoreRisk({ violations: [], attempt: { ...attempt, score: 70, submitted_at: at(10) }, durationMinutes: 60, classMean: 60 }).score, 0);
assert.equal(scoreRisk({ violations: [], attempt: null, durationMinutes: 60, classMean: 60 }).score, 0);

// Every violation type the app records belongs to exactly one rule.
const types = ["MULTIPLE_FACE", "NO_FACE", "BACKGROUND_VOICE", "TAB_SWITCH", "COPY_ATTEMPT", "FULLSCREEN_EXIT", "LOOKING_AWAY", "PHONE_DETECTED", "GADGET_DETECTED", "LOUD_NOISE_DETECTED", "AUDIO_DETECTED", "LOUD_AUDIO", "MICROPHONE_UNAVAILABLE", "MICROPHONE_DISCONNECTED", "MICROPHONE_MUTED", "MICROPHONE_ACCESS_LOST"];
for (const type of types) {
  assert.equal(RISK_RULES.filter((rule) => rule.types.includes(type)).length, 1, `${type} must map to one rule.`);
  assert.notEqual(violationLabel(type), type, `${type} needs a readable label.`);
}
assert.equal(violationLabel("SOMETHING_NEW"), "Other alert");

// Queue: one row per exam and student, highest risk first, including students with alerts but no attempt.
const attempts = [
  { id: "a1", exam_id: "e1", student_id: "s1", score: 90, started_at: start, submitted_at: at(58) },
  { id: "a2", exam_id: "e1", student_id: "s2", score: 50, started_at: start, submitted_at: at(50) },
  { id: "a3", exam_id: "e1", student_id: "s3", score: 70, started_at: start, submitted_at: at(55) },
];
const violations = [
  violation("PHONE_DETECTED", 12, { student_id: "s2" }),
  violation("MULTIPLE_FACE", 13, { student_id: "s2" }),
  violation("NO_FACE", 54, { student_id: "s1" }),
  violation("TAB_SWITCH", 5, { student_id: "s4" }),
];
const queue = buildRiskQueue({ attempts, violations, durationByExam: { e1: 60 } });
assert.deepEqual(queue.map((row) => [row.studentId, row.score, row.level]), [["s2", 45, "Medium"], ["s4", 5, "Low"], ["s1", 4, "Low"], ["s3", 0, "Low"]]);
assert.equal(queue[0].attempt.id, "a2");
assert.equal(queue[1].attempt, null, "A student with alerts but no submitted attempt still appears.");
assert.equal(queue[0].violationCount, 2);

// Summary: counts, clean attempts, alerts by type, and when they happened (6 equal parts of the exam time).
const summary = summarizeIntegrity({ queue, violations, attempts, durationMinutes: 60 });
assert.equal(summary.attemptCount, 3);
assert.deepEqual([summary.high, summary.medium, summary.low], [0, 1, 3]);
assert.equal(summary.cleanAttempts, 1);
assert.equal(summary.violationCount, 4);
assert.deepEqual(summary.byType.map((row) => [row.label, row.count]), [["Cellphone detected", 1], ["Multiple faces", 1], ["No face", 1], ["Tab switch", 1]]);
assert.deepEqual(summary.timeline.map((bucket) => bucket.label), ["0–10", "10–20", "20–30", "30–40", "40–50", "50–60"]);
assert.deepEqual(summary.timeline.map((bucket) => bucket.count), [0, 2, 0, 0, 0, 1], "Alerts without a matching attempt are not placed on the timeline.");
assert.equal(summary.timelineUnit, "minutes");
const percentSummary = summarizeIntegrity({ queue, violations, attempts, durationMinutes: null });
assert.equal(percentSummary.timelineUnit, "percent");
assert.deepEqual(percentSummary.timeline.map((bucket) => bucket.count), [0, 2, 0, 0, 0, 1]);
assert.deepEqual(summarizeIntegrity({ queue: [], violations: [], attempts: [], durationMinutes: 60 }).timeline.map((bucket) => bucket.count), [0, 0, 0, 0, 0, 0]);

// Wiring: the professor Integrity tab and the dean risk review use the shared component; no database change.
const scoresPage = readFileSync("src/pages/professor/ProfessorScores.jsx", "utf8");
assert.match(scoresPage, /setTab\("integrity"\)/);
assert.match(scoresPage, /from\("violations"\)/);
assert.match(scoresPage, /<IntegrityReview/);
const deanPage = readFileSync("src/pages/dean/DeanExamIntegrity.jsx", "utf8");
assert.match(deanPage, /<IntegrityReview/);
assert.match(deanPage, /from\("exam_attempts"\)/);
const panel = readFileSync("src/components/exam/IntegrityReview.jsx", "utf8");
assert.match(panel, /only orders attempts for review/i, "The panel must say a person decides.");

console.log("Integrity risk checks passed.");
