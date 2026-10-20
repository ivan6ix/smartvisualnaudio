import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canGradeManually, needsGradingPath } from "../src/lib/manualGrading.js";

// Grading control visibility.
const essay = { question_type: "Essay", manual_grading: false };
const choice = { question_type: "Multiple Choice", manual_grading: false };
assert.equal(canGradeManually(essay, { needs_manual_grading: true }), true, "A pending answer stays gradeable when its question flag is false.");
assert.equal(canGradeManually(essay, { needs_manual_grading: false, graded_at: "2026-10-20" }), true, "A graded manual-type answer stays regradeable.");
assert.equal(canGradeManually({ question_type: "File Upload", manual_grading: false }, { needs_manual_grading: false }), true, "File Upload answers are gradeable.");
assert.equal(canGradeManually({ ...choice, manual_grading: true }, { needs_manual_grading: false }), true, "Flagged questions keep their grading control.");
assert.equal(canGradeManually(choice, { needs_manual_grading: false }), false, "Auto-graded answers are not opened for manual grading.");
assert.equal(canGradeManually(choice, { needs_manual_grading: true }), true, "Any answer the server left pending can be graded.");
assert.equal(canGradeManually(essay, null), false, "Missing answers have no grading control.");
assert.equal(canGradeManually(essay, undefined), false, "Missing answers have no grading control.");
assert.equal(needsGradingPath("exam-1"), "/professor/scores/exam-1?tab=questions&filter=Needs%20Grading", "Needs Grading opens By Question with its filter.");

const scores = readFileSync("src/pages/professor/ProfessorScores.jsx", "utf8");
assert.match(scores, /import \{ canGradeManually, needsGradingPath \} from "\.\.\/\.\.\/lib\/manualGrading";/, "Scores must use the shared grading helpers.");
assert.equal((scores.match(/canGradeManually\(question, (?:answer|row\.answer)\) \? <GradeControl/g) || []).length, 2, "Both grading views must use canGradeManually.");
assert.doesNotMatch(scores, /&& question\.manual_grading \? <GradeControl/, "Grading must not depend only on the question flag.");

// Accurate pending counts from answers, and a Needs Grading deep link in both views.
assert.match(scores, /pendingAnswers: examAttempts\.reduce\(\(total, attempt\) => total \+ \(answersByAttempt\[attempt\.id\] \|\| \[\]\)\.filter\(\(answer\) => answer\.needs_manual_grading\)\.length, 0\)/, "Pending count must count only pending answers.");
assert.equal((scores.match(/exam\.pendingAnswers > 0 \? <Link className="professor-score-action professor-score-needs-grading" to=\{needsGradingPath\(exam\.id\)\}>Needs Grading \(\{exam\.pendingAnswers\}\)<\/Link>/g) || []).length, 2, "Table and card views must both offer Needs Grading.");
assert.match(scores, /if \(requestedTab === "questions"\) setTab\("questions"\);[\s\S]*\.includes\(requestedFilter\)\) setAnswerFilter\(requestedFilter\);/, "Exam view must honor the tab and filter deep link.");

// Existing grading call and rules stay in place.
assert.match(scores, /supabase\.rpc\("grade_exam_attempt_answer", \{ p_answer_id: answer\.id, p_earned_points: value \}\)/, "Grading must keep using grade_exam_attempt_answer.");
assert.match(scores, /graded\.reduce\(\(best, attempt\) => Number\(attempt\.score \|\| 0\) > Number\(best\.score \|\| 0\) \? attempt : best/, "Highest-attempt selection must be unchanged.");

const styles = readFileSync("src/styles.css", "utf8");
assert.match(styles, /\.professor-score-action\.professor-score-needs-grading \{[\s\S]*color: var\(--app-text\);/, "Needs Grading styling must use theme text color.");
