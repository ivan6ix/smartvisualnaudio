import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("src/App.jsx", "utf8");
const courses = readFileSync("src/pages/professor/ProfessorCourses.jsx", "utf8");
const detail = readFileSync("src/pages/professor/ProfessorCourseDetail.jsx", "utf8");
const listView = readFileSync("src/lib/listView.js", "utf8");
const dashboard = readFileSync("src/pages/professor/ProfessorDashboard.jsx", "utf8");
const styles = readFileSync("src/styles.css", "utf8");

assert.match(app, /<Route path="courses" element=\{<ProfessorCourses \/>\}/, "Professor Courses route must remain available.");
assert.match(courses, /useListViewPreference\(\{ role: "professor", page: "courses", defaultView: "cards" \}\)/, "Professor Courses view preference must remain role/page scoped.");
assert.match(listView, /CARD_PAGE_SIZE = 12/, "Cards must keep 12 records per page.");
assert.match(listView, /TABLE_PAGE_SIZE = 20/, "Tables must keep 20 records per page.");

assert.match(courses, /className="professor-courses-page"/, "Courses page should expose the redesigned page container.");
assert.match(courses, /className="professor-courses-toolbar"/, "Courses controls should live in a clean toolbar.");
assert.match(courses, /className="professor-course-record-card/, "Cards view should render boxed course record cards.");
assert.match(courses, /className="professor-course-record-header"/, "Course cards need a structured header.");
assert.match(courses, /className="professor-course-record-body"/, "Course cards need a structured metadata body.");
assert.match(courses, /className="professor-course-record-action"/, "Single course open action should remain a direct compact action.");
assert.match(courses, /<ResponsiveTable density=\{courseView\.tableDensity\} className="professor-courses-table-card"/, "Table view should remain a real responsive table.");
assert.match(courses, /<colgroup>[\s\S]*<col style=\{\{ width: "26%" \}\}/, "Course table should define balanced proportional columns.");
assert.match(courses, /onClick=\{\(\) => openCourse\(course\)\}/, "Course open behavior must stay wired to openCourse.");

assert.match(detail, /professor-course-detail-page/, "Course detail route must remain implemented.");
assert.match(detail, /Materials[\s\S]*Exams[\s\S]*Members/, "Materials, Exams, and Members tabs must remain available.");

assert.match(styles, /\.professor-courses-page \.professor-course-record-card\s*\{[\s\S]*border:\s*1px solid rgba\(15,\s*23,\s*42,\s*0\.48\)/, "Light course cards need a visible dark-neutral outline.");
assert.match(styles, /html\[data-theme="dark"\] \.professor-courses-page \.professor-course-record-card[\s\S]*border-color:\s*rgba\(226,\s*232,\s*240,\s*0\.58\)/, "Dark course cards need a visible light outline.");
assert.match(styles, /\.professor-courses-page \.professor-course-record-header\s*\{[\s\S]*border-bottom:\s*1px solid/, "Course card headers need a divider.");
assert.match(styles, /\.professor-courses-page \.professor-courses-table-card\s*\{[\s\S]*overflow-x:\s*auto/, "Course table should use local horizontal scrolling.");
assert.match(styles, /\.professor-course-detail-page \.professor-course-panel\s*\{[\s\S]*border-radius:\s*8px/, "Course detail panels should follow the 8px boxed language.");

assert.match(dashboard, /className="professor-dashboard-page"/, "Professor Dashboard should remain on the approved redesigned container.");
