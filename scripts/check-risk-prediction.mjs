/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildDeanAnalytics } from "../src/lib/deanAnalytics.js";
import { backtest, predictNext, predictStudents, trendSlope } from "../src/lib/riskPrediction.js";

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.0005, `${message}: ${actual} vs ${expected}`);

// Least-squares slope per exam.
close(trendSlope([72, 61, 52]), -10, "slope of 72, 61, 52");
close(trendSlope([60, 60]), 0, "flat slope");
close(trendSlope([50, 70, 60, 80]), 8, "slope of four points");
assert.equal(trendSlope([70]), 0);

// Prediction = average of the last 3 scores + a quarter of the trend of the last 5, clamped to 0-100.
const falling = predictNext([72, 61, 52], 60);
close(falling.predicted, 61.6667 - 2.5, "falling prediction");
assert.equal(falling.level, "High");
assert.deepEqual(falling.reasons, ["Falling about 10 points per exam", "Below passing in 1 of the last 3 exams", "Latest score 52%"]);
const steady = predictNext([90, 88, 92], 60);
assert.equal(steady.level, "Low");
close(steady.predicted, 90 + 0.25, "steady prediction");
assert.equal(predictNext([66, 63, 64], 60).level, "Medium", "Predicted within 5 points of passing is medium risk.");
assert.equal(predictNext([100, 100, 0, 0, 0], 60).predicted, 0, "Predictions never go below 0.");
assert.equal(predictNext([100, 100, 100, 100], 60).predicted, 100, "Predictions never exceed 100.");
assert.equal(predictNext([55], 60), null, "One score is not enough to predict.");
const longSeries = predictNext([40, 45, 50, 60, 62, 64], 60);
close(longSeries.predicted, 62 + 0.25 * 5, "Only the last 3 scores are averaged and the last 5 used for the trend.");

// Students: one series per student and section, ordered by submission time, using each exam's passing score.
const courses = [
  { id: "c1", course_code: "CPR2", section: "4A", course_name: "Computer Programming 2" },
  { id: "c2", course_code: "CPR2", section: "4B", course_name: "Computer Programming 2" },
];
const exams = [
  { id: "e1", course_id: "c1", status: "Published", description: "Prelim" },
  { id: "e2", course_id: "c1", status: "Published", description: "Midterm" },
  { id: "e3", course_id: "c1", status: "Published", description: "Semi-Final", passing_score: 75 },
  { id: "e4", course_id: "c2", status: "Published", description: "Prelim" },
  { id: "e5", course_id: "c2", status: "Published", description: "Midterm" },
];
const at = (day) => `2026-10-${String(day).padStart(2, "0")}T08:00:00Z`;
const attempt = (examId, studentId, score, day) => ({ id: `${examId}-${studentId}`, exam_id: examId, student_id: studentId, score, status: "Submitted", submitted_at: at(day) });
const attempts = [
  attempt("e1", "s1", 72, 1), attempt("e2", "s1", 61, 8), attempt("e3", "s1", 52, 15),
  attempt("e1", "s2", 90, 1), attempt("e2", "s2", 88, 8), attempt("e3", "s2", 92, 15),
  attempt("e1", "s3", 70, 1), attempt("e3", "s3", 76, 15), attempt("e2", "s3", 78, 8),
  attempt("e4", "s1", 80, 2), attempt("e5", "s1", 85, 9),
  attempt("e4", "s4", 50, 2),
];
const students = predictStudents({ exams, courses, attempts });
// Highest risk first, then lowest predicted score: 59.2 (High, passing 65), 75.4, 83.8, 90.3.
assert.deepEqual(students.map((row) => [row.studentId, row.courseId, row.level]), [["s1", "c1", "High"], ["s3", "c1", "Low"], ["s1", "c2", "Low"], ["s2", "c1", "Low"]]);
assert.deepEqual(students[0].scores, [72, 61, 52]);
assert.equal(students[0].sectionLabel, "CPR2 - 4A");
assert.equal(students[0].passingScore, 65, "Passing score is the average of the section's exams (60, 60, 75).");
assert.deepEqual(students[1].scores, [70, 78, 76], "Scores are ordered by submission time.");
assert.ok(!students.some((row) => row.studentId === "s4"), "A single score is not enough to predict.");

// Backtest: hide each student's latest exam, predict it from the earlier ones, and compare with what happened.
const history = [
  { scores: [70, 55, 40], passingScore: 60 },
  { scores: [90, 85, 88], passingScore: 60 },
  { scores: [65, 56, 62], passingScore: 60 },
  { scores: [70, 66, 40], passingScore: 60 },
  { scores: [50, 45], passingScore: 60 },
];
const result = backtest(history);
// Predictions from the first two scores: 62.5 - 3.75 = 58.75 (High, failed: TP), 87.5 - 1.25 = 86.25 (Low, passed: TN),
// 60.5 - 2.25 = 58.25 (High, passed: FP), 68 - 1 = 67 (not High, failed: FN). The two-score series cannot be tested.
assert.deepEqual({ evaluated: result.evaluated, tp: result.tp, fp: result.fp, fn: result.fn, tn: result.tn }, { evaluated: 4, tp: 1, fp: 1, fn: 1, tn: 1 });
close(result.precision, 0.5, "precision");
close(result.recall, 0.5, "recall");
close(result.accuracy, 0.5, "accuracy");
close(result.baselineAccuracy, 0.5, "baseline: predicting that nobody fails is right for the 2 who passed");
assert.deepEqual(backtest([{ scores: [70, 80], passingScore: 60 }]), { evaluated: 0, tp: 0, fp: 0, fn: 0, tn: 0, precision: null, recall: null, accuracy: null, baselineAccuracy: null });

// The dean analytics include the at-risk list, the backtest and a recommendation per section.
const analysis = buildDeanAnalytics({ exams, courses, attempts, violations: [] });
assert.deepEqual(analysis.atRisk.map((row) => row.studentId), ["s1"], "Only medium and high risk students are listed.");
assert.equal(analysis.kpis.studentsAtRisk, 1);
assert.equal(analysis.backtest.evaluated, 3);
assert.ok(analysis.recommendations.some((item) => item.title === "Reach out to 1 student at risk in CPR2 - 4A"));

// Wiring.
const page = readFileSync("src/pages/dean/DeanAnalytics.jsx", "utf8");
assert.match(page, /Students at risk of failing the next exam/);
assert.match(page, /How accurate is this\?/);
assert.match(page, /missed exams are not counted/i, "The page must say what the prediction does not see.");

console.log("Risk prediction checks passed.");
