/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_PASSING_SCORE,
  MIN_ATTEMPTS_FOR_FLAGS,
  analyzeExam,
  classifyItem,
  kr20,
  summarizeScores,
} from "../src/lib/itemAnalysis.js";

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.005, `${message}: ${actual} vs ${expected}`);

// Ten students and five items, worked out by hand. Scores are distinct so the top and bottom 27% (3 students each)
// are unambiguous: upper = s1-s3, lower = s8-s10.
const matrix = [
  [1, 1, 1, 1, 1],
  [1, 1, 1, 1, 0],
  [1, 1, 1, 0, 1],
  [1, 1, 0, 1, 0],
  [1, 0, 1, 0, 1],
  [1, 1, 0, 0, 0],
  [1, 0, 0, 1, 0],
  [1, 0, 0, 0, 1],
  [1, 0, 0, 0, 0],
  [0, 0, 0, 0, 1],
];
const scores = [100, 85, 80, 65, 60, 45, 40, 35, 20, 15];
const choices = [
  { id: "c-a", key: "A", value: "Ribosome" },
  { id: "c-b", key: "B", value: "Mitochondrion" },
  { id: "c-c", key: "C", value: "Golgi apparatus" },
  { id: "c-d", key: "D", value: "Lysosome" },
];
const questions = [0, 1, 2, 3, 4].map((index) => ({
  id: `q${index + 1}`,
  question_text: `Question ${index + 1}`,
  question_type: "Multiple Choice",
  choices,
  correct_answer: "c-b",
  correct_answers: ["c-b"],
  manual_grading: false,
  points: 1,
}));
questions.push({ id: "q-essay", question_text: "Explain osmosis.", question_type: "Essay", manual_grading: true, points: 5 });

const attempts = scores.map((score, index) => ({
  id: `a${index + 1}`,
  student_id: `s${index + 1}`,
  score,
  started_at: "2026-10-01T08:00:00Z",
  submitted_at: `2026-10-01T08:${String(20 + index * 2).padStart(2, "0")}:00Z`,
}));
// Wrong answers: upper students who miss pick C; lower students pick A, except one blank answer.
const answers = attempts.flatMap((attempt, studentIndex) => matrix[studentIndex].map((correct, itemIndex) => {
  if (studentIndex === 9 && itemIndex === 1) return null;
  return {
    attempt_id: attempt.id,
    question_id: `q${itemIndex + 1}`,
    is_correct: Boolean(correct),
    answer: correct ? "c-b" : studentIndex < 3 ? "c-c" : "c-a",
  };
}).filter(Boolean));

const result = analyzeExam({ questions, attempts, answers, passingScore: 60 });
assert.equal(result.attemptCount, 10);
assert.equal(result.groupSize, 3);
assert.equal(result.items.length, 5, "Manually graded questions are excluded.");
assert.deepEqual(result.items.map((item) => item.number), [1, 2, 3, 4, 5]);

const expected = [
  { p: 0.9, upper: 1, lower: 2 / 3, d: 1 / 3, flag: "Good" },
  { p: 0.5, upper: 1, lower: 0, d: 1, flag: "Good" },
  { p: 0.4, upper: 1, lower: 0, d: 1, flag: "Good" },
  { p: 0.4, upper: 2 / 3, lower: 0, d: 2 / 3, flag: "Good" },
  { p: 0.5, upper: 2 / 3, lower: 2 / 3, d: 0, flag: "Weak" },
];
result.items.forEach((item, index) => {
  close(item.p, expected[index].p, `p for item ${index + 1}`);
  close(item.upperP, expected[index].upper, `upper p for item ${index + 1}`);
  close(item.lowerP, expected[index].lower, `lower p for item ${index + 1}`);
  close(item.d, expected[index].d, `D for item ${index + 1}`);
  assert.equal(item.flag, expected[index].flag, `flag for item ${index + 1}`);
});

// KR-20 by hand: k = 5, sum(pq) = 1.07, population variance of totals = 1.61 -> 1.25 * (1 - 1.07 / 1.61) = 0.419.
close(result.kr20, 0.4193, "KR-20");
close(kr20([[1, 1], [0, 0], [1, 0], [0, 1]]), 0, "KR-20 of two unrelated items");
assert.equal(kr20([[1, 1], [1, 1]]), null, "KR-20 needs score variance.");
assert.equal(kr20([[1], [0]]), null, "KR-20 needs at least two items.");

// Distractors: upper students who missed item 3 chose C, lower students chose A; one blank answer is counted.
const item2 = result.items[1];
assert.deepEqual(item2.options.map((option) => option.key), ["A", "B", "C", "D", "No answer"]);
assert.equal(item2.options.find((option) => option.key === "B").isKey, true);
assert.equal(item2.options.find((option) => option.key === "No answer").total, 1);
const item4 = result.items[3];
close(item4.options.find((option) => option.key === "C").upperShare, 1 / 3, "upper share choosing C on item 4");
close(item4.options.find((option) => option.key === "A").lowerShare, 1, "lower share choosing A on item 4");
assert.equal(item4.keyOutdrawn, null, "The key still leads among top students.");

// A wrong option that top students prefer over the key is reported.
const trap = analyzeExam({
  questions: [questions[0]],
  attempts,
  answers: attempts.map((attempt, index) => ({
    attempt_id: attempt.id,
    question_id: "q1",
    is_correct: index >= 3 && index % 2 === 0,
    answer: index < 3 ? "c-c" : index % 2 === 0 ? "c-b" : "c-a",
  })),
  passingScore: 60,
});
assert.equal(trap.items[0].keyOutdrawn?.key, "C");
assert.equal(trap.items[0].flag, "Revise", "Negative discrimination means revise.");

// Flags follow the documented thresholds and need enough attempts.
assert.equal(classifyItem({ p: 0.95, d: 0.3, attempts: 30 }), "Too easy");
assert.equal(classifyItem({ p: 0.2, d: 0.3, attempts: 30 }), "Too hard");
assert.equal(classifyItem({ p: 0.6, d: -0.1, attempts: 30 }), "Revise");
assert.equal(classifyItem({ p: 0.6, d: 0.1, attempts: 30 }), "Weak");
assert.equal(classifyItem({ p: 0.6, d: 0.35, attempts: 30 }), "Good");
assert.equal(classifyItem({ p: 0.6, d: -0.4, attempts: MIN_ATTEMPTS_FOR_FLAGS - 1 }), "Need more attempts");
assert.equal(MIN_ATTEMPTS_FOR_FLAGS, 10);

// Score summary.
const summary = summarizeScores(attempts, 60);
close(summary.mean, 54.5, "mean score");
close(summary.median, 52.5, "median score");
assert.equal(summary.highest, 100);
assert.equal(summary.lowest, 15);
close(summary.passRate, 0.5, "pass rate");
assert.equal(summary.passed, 5);
assert.deepEqual(summary.bins.map((bin) => bin.count), [0, 1, 1, 1, 2, 0, 2, 0, 2, 1]);
assert.equal(summary.bins.at(-1).label, "90–100");
close(summary.averageMinutes, 29, "average minutes");
assert.equal(DEFAULT_PASSING_SCORE, 60);
assert.equal(summarizeScores([{ earned_points: 6, max_points: 8 }], 60).mean, 75, "Scores fall back to earned / max points.");
assert.equal(summarizeScores([], 60).mean, null);

// Quality counts and recommendations.
assert.deepEqual(result.quality, { good: 4, review: 1, revise: 0, pending: 0 });
assert.ok(result.recommendations.some((item) => /Question 5/.test(item.title)), "Weak items are recommended for review.");
assert.ok(result.recommendations.some((item) => /reliability/i.test(item.title)), "Low KR-20 is explained.");
assert.ok(trap.recommendations.some((item) => /answer key/i.test(item.title)));
assert.equal(analyzeExam({ questions, attempts: [], answers: [], passingScore: 60 }).items.every((item) => item.flag === "Need more attempts"), true);

// The Analytics tab is wired into Professor Scores and needs no database change.
const scoresPage = readFileSync("src/pages/professor/ProfessorScores.jsx", "utf8");
assert.match(scoresPage, /setTab\("analytics"\)/);
assert.match(scoresPage, /<ExamAnalytics[\s\S]*passingScore=/);
assert.match(scoresPage, /passing_score/);
const panel = readFileSync("src/components/exam/ExamAnalytics.jsx", "utf8");
assert.match(panel, /analyzeExam\(/);
assert.match(panel, /Item analysis/);
assert.match(panel, /KR-20/);

console.log("Item analysis checks passed.");
