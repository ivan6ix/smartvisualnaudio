import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const professor = readFileSync("src/pages/professor/ProfessorCreateExam.jsx", "utf8");
const student = readFileSync("src/pages/student/StudentExamTake.jsx", "utf8");

assert.match(professor, /Drag and Drop/);
assert.match(professor, /Add Choice/);
assert.match(professor, /Add Left/);
assert.match(professor, /Add Right/);
assert.match(professor, /connectMatchingItems/);
assert.match(professor, /buildQuestionStorage/);
assert.match(professor, /normalizeQuestionForEditing/);

assert.match(student, /question\.question_type === "Drag and Drop"/);
assert.match(student, /student-dragdrop-board/);
assert.match(student, /toggleDragDropAnswer\(question\.id, choice\.id\)/);
assert.match(student, /connectMatchingAnswer\(question\.id, option\.id\)/);
assert.match(student, /normalizeChoiceItems/);

assert.doesNotMatch(student, /matchingConnections/);
