import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("src/App.jsx", "utf8");
const exams = readFileSync("src/pages/professor/ProfessorExams.jsx", "utf8");
const courses = readFileSync("src/pages/professor/ProfessorCourses.jsx", "utf8");
const dashboard = readFileSync("src/pages/professor/ProfessorDashboard.jsx", "utf8");
const listView = readFileSync("src/lib/listView.js", "utf8");
const styles = readFileSync("src/styles.css", "utf8");

assert.match(app, /<Route path="exams" element=\{<ProfessorExams \/>\}/, "Professor Exams route must remain available.");
assert.match(exams, /useListViewPreference\(\{ role: "professor", page: "exams", defaultView: "table" \}\)/, "Professor Exams must preserve the table default and role/page scoped preference.");
assert.match(listView, /CARD_PAGE_SIZE = 12/, "Cards must keep 12 records per page.");
assert.match(listView, /TABLE_PAGE_SIZE = 20/, "Tables must keep 20 records per page.");

assert.match(exams, /className="professor-exams-page"/, "Exams page container must remain available.");
assert.match(exams, /className="professor-exams-page-header"/, "Exams page should use the redesigned page header.");
assert.match(exams, /className="professor-exams-summary-grid"/, "Exams page should expose status KPI cards.");
assert.match(exams, /className="professor-exams-toolbar"/, "Exams Cards/Table controls should sit in a clean toolbar.");
assert.match(exams, /renderDraftsSection\(\)/, "Drafts section must remain rendered.");
assert.match(exams, /renderExamSection\("published", "Published Exams"/, "Published section must remain rendered.");
assert.match(exams, /renderExamSection\("pending", "Pending for Approval"/, "Pending approval section must remain rendered.");
assert.match(exams, /renderExamSection\("unpublished", "Unpublished Exams"/, "Unpublished section must remain rendered.");

assert.match(exams, /className="professor-exam-record-card"/, "Card view should render boxed exam record cards.");
assert.match(exams, /className="professor-exam-record-header"/, "Exam cards need a structured header.");
assert.match(exams, /className="professor-exam-record-body"/, "Exam cards need a structured metadata body.");
assert.match(exams, /className=\{`professor-status-pill \$\{exam\.status\}/, "Status badges must remain wired to actual exam status.");
assert.match(exams, /<RowActionMenu[\s\S]*menuId=\{`\$\{prefix\}-\$\{exam\.id\}`\}/, "Exam records should keep stable portal kebab action menus.");
assert.match(exams, /<ResponsiveTable density=\{listView\.tableDensity\} className="professor-exams-table-card"/, "Table view should remain a real responsive table.");
assert.match(exams, /<colgroup>[\s\S]*<col style=\{\{ width: "30%" \}\}/, "Exam table should define balanced proportional columns.");

assert.match(exams, /setArchiveModalOpen\(true\)/, "Archived Exams entry must remain wired.");
assert.match(exams, /className="professor-share-modal professor-archive-modal"/, "Archived Exams must remain a modal.");
assert.match(exams, /handleDeleteArchivedExam/, "Archived permanent delete flow must remain present.");
assert.match(exams, /delete_archived_exam/, "Permanent delete safeguard RPC must remain the deletion boundary.");
assert.match(exams, /navigate\("\/professor\/exams\/create"/, "Create Exam navigation must remain wired.");
assert.match(exams, /navigate\(`\/professor\/exams\/create\?editId=\$\{exam\.id\}`\)/, "Edit and resume navigation must remain wired.");
assert.match(exams, /handlePublish\(exam\)/, "Publish action must remain wired.");
assert.match(exams, /handleSubmitForApproval\(exam\)/, "Submit for Approval action must remain wired.");
assert.match(exams, /setShareExam\(exam\)/, "Share action must remain wired.");

assert.match(styles, /\.professor-exams-page \.professor-exam-record-card\s*\{[\s\S]*border:\s*1px solid rgba\(15,\s*23,\s*42,\s*0\.48\)/, "Light exam cards need a visible dark-neutral outline.");
assert.match(styles, /html\[data-theme="dark"\] \.professor-exams-page \.professor-exam-record-card[\s\S]*border-color:\s*rgba\(226,\s*232,\s*240,\s*0\.58\)/, "Dark exam cards need a visible light outline.");
assert.match(styles, /\.professor-exams-page \.professor-exams-table-card\s*\{[\s\S]*overflow-x:\s*auto/, "Exam table should use local horizontal scrolling.");
assert.match(styles, /\.professor-exams-page \.professor-exams-section\s*\{[\s\S]*border-radius:\s*8px/, "Exam sections should follow the approved 8px boxed language.");

assert.match(dashboard, /className="professor-dashboard-page"/, "Professor Dashboard should remain on the approved redesigned container.");
assert.match(courses, /className="professor-courses-page"/, "Professor Courses should remain on the approved redesigned container.");
assert.match(courses, /courses\.length === 1 \? "course" : "courses"/, "Professor Courses count badge should pluralize safely.");
