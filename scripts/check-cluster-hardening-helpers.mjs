import assert from "node:assert/strict";
import {
  buildClusterQuestionReview,
  normalizeClusterExam,
  normalizeClusterExams,
  normalizeClusterMessages,
  normalizeClusterQuestion,
  normalizeClusterReviews,
} from "../src/lib/clusterReview.js";

assert.deepEqual(normalizeClusterExams(null), []);
assert.deepEqual(normalizeClusterExams({}), []);
assert.deepEqual(normalizeClusterExams("bad"), []);
assert.deepEqual(normalizeClusterReviews({ bad: "shape" }), []);
assert.deepEqual(normalizeClusterMessages(123), []);

const normalizedExam = normalizeClusterExam({
  id: "exam-1",
  examTitle: "Legacy Exam",
  questions: null,
});
assert.equal(normalizedExam.id, "exam-1");
assert.equal(normalizedExam.examTitle, "Legacy Exam");
assert.deepEqual(normalizedExam.questions, []);

const legacyChoiceQuestion = normalizeClusterQuestion({
  id: "q1",
  questionType: "Multiple Choice",
  questionText: "Pick one",
  choices: ["Alpha", { key: "B", value: "Beta" }],
  correctAnswer: "B",
  points: 3,
});
assert.equal(legacyChoiceQuestion.choices.length, 2);
assert.equal(buildClusterQuestionReview(legacyChoiceQuestion).correctAnswers.join(", "), "Beta");

const stableChoiceQuestion = normalizeClusterQuestion({
  id: "q2",
  question_type: "Multiple Select",
  question_text: "Pick many",
  choices: [
    { id: "c-a", key: "A", value: "Alpha" },
    { id: "c-b", key: "B", value: "Beta" },
    { id: "c-c", key: "C", value: "Gamma" },
  ],
  correct_answers: ["c-a", "c-c"],
  question_config: { partialMatch: true },
  points: 4,
});
const stableReview = buildClusterQuestionReview(stableChoiceQuestion);
assert.deepEqual(stableReview.correctAnswers, ["Alpha", "Gamma"]);
assert.equal(stableReview.partialMatch, true);

const matchingQuestion = normalizeClusterQuestion({
  id: "q3",
  question_type: "Matching Type",
  question_text: "Match them",
  question_config: {
    matchingLeftItems: [
      { id: "l1", text: "Apple" },
      { id: "l2", text: "Dog" },
    ],
    matchingRightItems: [
      { id: "r1", text: "Fruit" },
      { id: "r2", text: "Animal" },
      { id: "r3", text: "Color" },
    ],
    matchingConnections: [
      { leftId: "l1", rightId: "r1" },
      { leftId: "l2", rightId: "r2" },
    ],
  },
  points: 5,
});
const matchingReview = buildClusterQuestionReview(matchingQuestion);
assert.deepEqual(matchingReview.matchingPairs, [
  { left: "Apple", right: "Fruit" },
  { left: "Dog", right: "Animal" },
]);
assert.deepEqual(matchingReview.matchingDistractors, ["Color"]);

const dragQuestion = normalizeClusterQuestion({
  id: "q4",
  question_type: "Drag and Drop",
  question_text: "Select languages",
  choices: [
    { id: "python", value: "Python" },
    { id: "html", value: "HTML" },
    { id: "java", value: "Java" },
  ],
  correct_answers: ["python", "java"],
});
const dragReview = buildClusterQuestionReview(dragQuestion);
assert.deepEqual(dragReview.choices.map((choice) => choice.value), ["Python", "HTML", "Java"]);
assert.deepEqual(dragReview.correctAnswers, ["Python", "Java"]);

const orderingQuestion = normalizeClusterQuestion({
  id: "q5",
  question_type: "Ordering / Sequencing",
  question_text: "Order these",
  correct_answers: ["First", "Second"],
  question_config: { orderItems: ["First", "Second", "Third"] },
});
const orderingReview = buildClusterQuestionReview(orderingQuestion);
assert.deepEqual(orderingReview.sequence, ["First", "Second"]);

const malformedQuestion = normalizeClusterQuestion({
  id: "q6",
  question_type: "Unknown Widget",
  question_text: "Future thing",
  choices: { bad: "shape" },
});
const malformedReview = buildClusterQuestionReview(malformedQuestion);
assert.equal(malformedReview.type, "Unknown Widget");
assert.deepEqual(malformedReview.choices, []);
assert.deepEqual(malformedReview.correctAnswers, []);

assert.equal(
  JSON.stringify(buildClusterQuestionReview({ questionType: "Essay", questionText: "Explain" })).includes("[object Object]"),
  false,
);
