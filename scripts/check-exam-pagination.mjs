/* global console */
// Helpers behind the paginated exam: question index clamping and the unanswered-question confirmation.
import assert from "node:assert/strict";
import fs from "node:fs";
import { clampQuestionIndex, isQuestionAnswered, unansweredNumbers, unansweredConfirmMessage } from "../src/lib/examPagination.js";

assert.equal(clampQuestionIndex(7, 5), 4);
assert.equal(clampQuestionIndex(-2, 5), 0);
assert.equal(clampQuestionIndex("x", 5), 0);
assert.equal(clampQuestionIndex(3, 0), 0);
const qs = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
assert.equal(isQuestionAnswered(qs[1], {}, { b: { name: "work.pdf" } }), true, "A file counts as an answer.");
assert.deepEqual(unansweredNumbers(qs, { a: "A", c: "  " }, { b: { name: "x.pdf" } }), [3, 4]);
assert.equal(unansweredConfirmMessage([3]), "Question 3 is unanswered. Submit anyway?");
assert.equal(unansweredConfirmMessage([3, 9]), "Questions 3 and 9 are unanswered. Submit anyway?");
assert.equal(unansweredConfirmMessage([3, 9, 14]), "Questions 3, 9 and 14 are unanswered. Submit anyway?");
assert.equal(unansweredConfirmMessage([]), "");

const page = fs.readFileSync("src/pages/student/StudentExamTake.jsx", "utf8");
assert.match(page, /function goToQuestion\(index\)[\s\S]*?clampQuestionIndex\([\s\S]*?currentQuestionRef\.current = [\s\S]*?setCurrentIndex\(/, "The ref changes in the same call as the page.");
assert.doesNotMatch(page, /\{questions\.map\(renderQuestion\)\}/, "Only one question is shown at a time.");
assert.match(page, /renderQuestion\(questions\[currentIndex\], currentIndex\)/);
assert.match(page, /aria-current=\{index === currentIndex \? "step" : undefined\}/);
assert.match(page, /className="exam-question-navigator"/);
assert.match(page, /Previous/); assert.match(page, /Next/);
assert.match(page, /unansweredConfirmMessage\(unansweredNumbers\(/, "Submitting warns about unanswered questions.");
assert.match(page, /answers: answersRef\.current, violations: violationsRef\.current,[^}]*currentIndex: currentIndexRef\.current/, "The page is saved with the progress.");

console.log("Exam pagination checks passed.");
