import assert from "node:assert/strict";
import {
  buildQuestionStorage,
  connectMatchingItems,
  createChoiceItem,
  gradeAnswer,
  normalizeChoiceItems,
  normalizeQuestionForEditing,
  sanitizeQuestionForStudent,
} from "../src/lib/examQuestionTypes.js";

const legacyChoices = normalizeChoiceItems(["Alpha", { key: "B", value: "Beta" }]);
assert.deepEqual(legacyChoices.map((choice) => choice.key), ["A", "B"]);
assert.ok(legacyChoices.every((choice) => choice.id && choice.value));
assert.equal(legacyChoices[0].value, "Alpha");
assert.equal(legacyChoices[1].value, "Beta");

const first = createChoiceItem("Alpha", "A");
const second = createChoiceItem("Beta", "B");
assert.notEqual(first.id, second.id);
assert.equal(first.key, "A");

const edited = normalizeQuestionForEditing({
  id: "q1",
  question_text: "Pick many",
  question_type: "Multiple Select",
  choices: [first, second],
  correct_answers: [first.id, second.id],
  question_config: { partialMatch: true },
  points: 5,
});
assert.deepEqual(edited.correctAnswers, [first.id, second.id]);

const stored = buildQuestionStorage({
  ...edited,
  type: "Multiple Choice",
  correctAnswer: first.id,
  choices: [first, second],
});
assert.equal(stored.correctAnswer, first.id);
assert.deepEqual(stored.correctAnswers, [first.id]);
assert.equal(stored.config.choices[0].id, first.id);

const matchQuestion = normalizeQuestionForEditing({
  id: "q2",
  question_text: "Match",
  question_type: "Matching Type",
  question_config: {
    pairs: [
      { left: "HTTP", right: "Protocol" },
      { left: "CPU", right: "Processor" },
    ],
    partialMatch: true,
  },
  points: 4,
});
assert.equal(matchQuestion.matchingLeftItems.length, 2);
assert.equal(matchQuestion.matchingRightItems.length, 2);

const firstLeft = matchQuestion.matchingLeftItems[0].id;
const secondLeft = matchQuestion.matchingLeftItems[1].id;
const firstRight = matchQuestion.matchingRightItems[0].id;
const secondRight = matchQuestion.matchingRightItems[1].id;
const oneConnection = connectMatchingItems([], firstLeft, firstRight);
const reconnected = connectMatchingItems([...oneConnection, { leftId: secondLeft, rightId: secondRight }], firstLeft, secondRight);
assert.deepEqual(reconnected, [{ leftId: firstLeft, rightId: secondRight }]);

const sanitizedMatch = sanitizeQuestionForStudent(buildQuestionStorage(matchQuestion));
assert.ok(!("matchingConnections" in sanitizedMatch.config));
assert.equal(sanitizedMatch.config.matchingLeftItems.length, 2);
assert.equal(sanitizedMatch.config.matchingRightItems.length, 2);

const dragChoices = [createChoiceItem("Alpha", "A"), createChoiceItem("Gamma", "B"), createChoiceItem("Delta", "C")];
const dragQuestion = buildQuestionStorage({
  id: "q3",
  title: "Select correct",
  type: "Drag and Drop",
  choices: dragChoices,
  correctAnswers: [dragChoices[0].id, dragChoices[2].id],
  points: 6,
});
assert.equal(gradeAnswer(dragQuestion, [dragChoices[2].id, dragChoices[0].id]).earnedPoints, 6);
assert.equal(gradeAnswer(dragQuestion, [dragChoices[0].id]).earnedPoints, 0);
assert.equal(gradeAnswer(dragQuestion, [dragChoices[0].id, dragChoices[1].id, dragChoices[2].id]).earnedPoints, 0);
assert.equal(gradeAnswer(dragQuestion, [dragChoices[1].id]).earnedPoints, 0);
assert.ok(!("correctAnswers" in sanitizeQuestionForStudent(dragQuestion).config));
