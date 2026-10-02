import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("src/App.jsx", "utf8");
const createExam = readFileSync("src/pages/professor/ProfessorCreateExam.jsx", "utf8");
const questionTypes = readFileSync("src/lib/examQuestionTypes.js", "utf8");
const styles = readFileSync("src/styles.css", "utf8");

assert.match(app, /<Route path="exams\/create" element=\{<ProfessorCreateExam \/>\}/, "Professor Create Exam route must remain available.");
assert.match(createExam, /searchParams\.get\("editId"\)/, "Professor Edit Exam must keep using the shared Create Exam component through editId.");

assert.match(createExam, /className="professor-create-exam-page"/, "Create Exam page container must remain present.");
assert.match(createExam, /Create Exam[\s\S]*Build exam details, security settings, deadline, and questions/, "Create Exam header copy must remain present.");
assert.match(createExam, /professor-create-card professor-details-card[\s\S]*Basic Details/, "Basic Details boxed section must exist.");
assert.match(createExam, /professor-field-label[\s\S]*Course[\s\S]*Exam Title[\s\S]*Exam Type[\s\S]*Period[\s\S]*Semester[\s\S]*Duration[\s\S]*Attempts[\s\S]*Start \(local time\)[\s\S]*Deadline \(local time\)/, "Existing Basic Details fields must remain readable and labeled.");
assert.match(createExam, /professor-full-field[\s\S]*Description[\s\S]*1000[\s\S]*Instructions[\s\S]*5000/, "Description and Instructions must remain full-width with character limits.");
assert.match(createExam, /professor-create-card professor-assignment-card[\s\S]*Who can take this exam\?[\s\S]*Entire Course[\s\S]*Selected Students/, "Assignment mode section must remain present.");
assert.match(createExam, /professor-assignment-table-panel[\s\S]*Search students[\s\S]*Filter students by section[\s\S]*Select All[\s\S]*professor-assignment-table/, "Selected-student table/search behavior must remain wired.");
assert.match(createExam, /professor-create-card professor-settings-card[\s\S]*Exam \/ Proctoring Settings[\s\S]*settings\.map/, "Exam/proctoring settings section must remain present.");
assert.match(createExam, /professor-create-card professor-question-builder[\s\S]*Question Builder[\s\S]*Add Question/, "Question Builder section and Add Question action must remain present.");
assert.match(createExam, /professor-create-card professor-added-questions[\s\S]*Added Questions[\s\S]*No questions added yet/, "Added Questions section and empty state must remain present.");
assert.match(createExam, /Save as Draft[\s\S]*Submit for Review[\s\S]*Publish/, "Draft, review, and direct publish actions must remain wired.");
assert.match(createExam, /Publish Exam\?[\s\S]*confirmPublishExam/, "Direct publish confirmation flow must remain wired.");

for (const type of [
  "Multiple Choice",
  "Picture Choice",
  "Multiple Select",
  "Identification",
  "Fill in the Blank",
  "Matching Type",
  "Ordering / Sequencing",
  "Drag and Drop",
  "Enumeration",
  "True or False",
  "Essay",
  "File Upload",
]) {
  assert.match(questionTypes, new RegExp(type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${type} question type must remain available.`);
}

assert.match(createExam, /QUESTION_TYPES\.map/, "Create Exam question-type select must continue using the shared question type list.");
assert.match(createExam, /connectMatchingItems[\s\S]*matchingLeftItems[\s\S]*matchingRightItems[\s\S]*matchingConnections/, "Matching stable-ID editor logic must remain wired.");
assert.match(createExam, /questionDraft\.type === "Drag and Drop"[\s\S]*toggleCorrectChoice/, "Drag and Drop choice/correct-answer behavior must remain wired.");
assert.match(createExam, /addChoice[\s\S]*removeChoice[\s\S]*updateChoice/, "Dynamic choice editing must remain wired.");

assert.doesNotMatch(styles, /\.professor-create[\s\S]{0,1200}transform:\s*scale\(/, "Create Exam styles must not shrink the UI with transform scaling.");
assert.doesNotMatch(styles, /\.professor-create[\s\S]{0,1200}\bzoom\s*:/, "Create Exam styles must not shrink the UI with CSS zoom.");
assert.doesNotMatch(styles, /\.professor-create[\s\S]{0,1200}font-size:\s*(?:7|8|9)px/, "Create Exam styles must not use tiny text to solve layout.");

assert.match(styles, /\.professor-shell \.professor-create-exam-page\s*\{[\s\S]*max-width:\s*1280px/, "Create Exam should use a wider Professor content area.");
assert.match(styles, /\.professor-create-top-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/, "Create Exam top sections should stack as readable boxed sections.");
assert.match(styles, /\.professor-details-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(260px,\s*1fr\)\)/, "Basic Details should use a responsive two-column grid.");
assert.match(styles, /\.professor-field-label\s*\{[\s\S]*font-size:\s*0\.9rem/, "Create Exam field labels should be comfortably readable.");
assert.match(styles, /\.professor-full-field\s*\{[\s\S]*grid-column:\s*1 \/ -1/, "Long-form fields should span the full form width.");
assert.match(styles, /\.professor-create-input\s*\{[\s\S]*min-height:\s*46px/, "Create Exam inputs should keep a readable control height.");
assert.match(styles, /\.professor-settings-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(260px,\s*1fr\)\)/, "Proctoring settings should avoid a cramped single wall.");
assert.match(styles, /\.professor-question-actions button\s*\{[\s\S]*white-space:\s*nowrap/, "Question/action toolbar buttons should not compress labels.");
assert.match(styles, /\.professor-added-empty\s*\{[\s\S]*min-height:\s*96px/, "Added Questions empty state should stay compact.");
assert.match(styles, /html\[data-theme="light"\] \.professor-shell \.professor-create-card[\s\S]*background:\s*var\(--app-surface\)/, "Light mode Create Exam panels must stay theme-aware.");
assert.match(styles, /html\[data-theme="dark"\] \.professor-shell \.professor-create-card[\s\S]*background:\s*var\(--app-surface\)/, "Dark mode Create Exam panels must stay theme-aware.");
assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.professor-details-grid[\s\S]*grid-template-columns:\s*1fr/, "Create Exam must keep mobile single-column behavior.");
