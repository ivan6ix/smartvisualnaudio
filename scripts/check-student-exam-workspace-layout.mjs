import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("src/App.jsx", "utf8");
const exam = readFileSync("src/pages/student/StudentExamTake.jsx", "utf8");
const styles = readFileSync("src/styles.css", "utf8");

assert.match(app, /<Route path="exams\/:examId" element=\{<StudentExamTake \/>\}/, "Take Exam route should remain nested in the Student shell.");

assert.match(exam, /className="student-exam-workspace"[\s\S]*className="student-exam-question-list"[\s\S]*<aside className="student-proctor-dock"/, "Questionnaire and monitoring rail must share one workspace.");
assert.match(exam, /<video autoPlay muted playsInline ref=\{proctorVideoRef\} \/>/, "Camera stream must remain mounted once through the existing ref.");
assert.equal((exam.match(/<AudioMonitoringTimeline/g) || []).length, 1, "Audio monitoring must remain mounted once.");
assert.equal((exam.match(/Time Remaining/g) || []).length, 1, "Only one visual Time Remaining timer should render.");
assert.match(exam, /Live Alerts[\s\S]*Time Remaining[\s\S]*Interruptions[\s\S]*Violations/, "Monitoring rail order must be alerts, timer, interruptions, violations after camera/audio.");
assert.match(exam, /handleSubmit\("manual"\)/, "Submit Exam action must remain wired.");
assert.match(exam, /beginAuthorizedFilePicker\(question\.id\)/, "File picker recovery authorization must remain wired.");
assert.match(exam, /question\.question_type === "Matching Type"[\s\S]*connectMatchingAnswer/, "Matching interaction must remain wired.");
assert.match(exam, /removeMatchingAnswer\(question\.id, matchedLeft\)/, "Matching must support removing an existing connection without mouse precision.");
assert.match(exam, /question\.question_type === "Drag and Drop"[\s\S]*toggleDragDropAnswer/, "Drag and Drop interaction must remain wired.");
assert.match(exam, /moveOrderingAnswer\(question\.id, itemIndex, itemIndex - 1\)/, "Ordering must expose a non-drag Move Up fallback.");
assert.match(exam, /moveOrderingAnswer\(question\.id, itemIndex, itemIndex \+ 1\)/, "Ordering must expose a non-drag Move Down fallback.");
assert.match(exam, /switchEnvironmentCamera/, "Environment scan must support front/rear camera switching where the browser allows it.");
assert.match(exam, /Use Photo/, "Environment scan must expose a Use Photo action after a successful capture flow.");
assert.match(exam, /Front View[\s\S]*Left Side[\s\S]*Right Side[\s\S]*Upper Surroundings[\s\S]*Desk View/, "Environment scan must expose the required responsive scan checkpoints.");

assert.match(styles, /\.student-exam-workspace\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(280px,\s*320px\)/, "Desktop workspace must use separate questionnaire and monitoring columns.");
assert.match(styles, /\.student-exam-question-list\s*\{[\s\S]*min-width:\s*0/, "Questionnaire column must be allowed to shrink without horizontal overflow.");
const proctorDockRule = styles.match(/\.student-proctor-dock\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body || "";
assert.match(proctorDockRule, /position:\s*sticky/, "Desktop monitoring rail should be sticky.");
assert.match(proctorDockRule, /max-height:\s*calc\(100dvh - 104px\)/, "Desktop monitoring rail should stay within the viewport.");
assert.match(proctorDockRule, /overflow-y:\s*auto/, "Desktop monitoring rail should scroll internally when needed.");
assert.doesNotMatch(proctorDockRule, /position:\s*fixed/, "Desktop monitoring rail must not be a fixed overlay.");
assert.doesNotMatch(styles, /\.student-exam-take-page\.with-proctor-dock\s*\{[\s\S]{0,160}padding-right:\s*min\(348px,\s*24vw\)/, "Desktop layout must not rely on padding-right to avoid overlay.");
assert.match(styles, /@media screen and \(max-width: 900px\)[\s\S]*\.student-proctor-dock\s*\{[\s\S]*position:\s*fixed/, "Existing mobile proctor dock behavior must remain available.");
assert.match(styles, /\.student-order-controls\s*\{[\s\S]*min-height:\s*44px/, "Ordering fallback controls must keep touch-friendly targets.");
