import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("src/App.jsx", "utf8");
const layout = readFileSync("src/pages/dean/DeanLayout.jsx", "utf8");
const reports = readFileSync("src/pages/Reports.jsx", "utf8");
const dashboard = readFileSync("src/pages/dean/DeanDashboard.jsx", "utf8");
const integrity = readFileSync("src/pages/dean/DeanExamIntegrity.jsx", "utf8");
const courses = readFileSync("src/pages/Courses.jsx", "utf8");
const styles = readFileSync("src/styles.css", "utf8");

assert.match(app, /<Route path="reports" element=\{<Reports \/>\} \/>/, "Dean Reports route must remain available.");
assert.match(layout, /dean-topbar-actions[\s\S]*dean-theme-button[\s\S]*dean-message-menu[\s\S]*<NotificationBell user=\{user\} \/>[\s\S]*dean-profile-menu/, "Approved Dean shell topbar order must stay intact.");

assert.match(reports, /const isDean = user\?\.role === "Dean"/, "Reports must scope the Dean redesign by role.");
assert.match(reports, /className=\{`admin-dashboard-page admin-section-page reports-page\$\{isDean \? " dean-reports-page" : ""\}`\}/, "Dean Reports should use a scoped page class.");
assert.match(reports, /<h1>Reports<\/h1>[\s\S]*Review and generate examination integrity and monitoring reports/, "Dean Reports should use one compact page heading.");
assert.match(reports, /Reports Center/, "Shared Admin Reports heading should remain available outside Dean mode.");

assert.match(reports, /safeCount\(supabase\.from\("profiles"\)[\s\S]*eq\("role", "Student"\)/, "Existing student count query must remain.");
assert.match(reports, /safeCount\(supabase\.from\("courses"\)[\s\S]*eq\("archived", false\)/, "Existing active courses count query must remain.");
assert.match(reports, /safeCount\(supabase\.from\("violations"\)[\s\S]*head: true/, "Existing violation count query must remain.");
assert.match(reports, /from\("profiles"\)\.select\("id, role, full_name, email, employee_number, student_number, status, created_at"\)[\s\S]*limit\(1000\)/, "Existing profiles report query must remain capped and intact.");
assert.match(reports, /from\("courses"\)\.select\("id, course_name, course_code, program_id, year_level, section, joining_code, professor_id, archived, created_at, programs\(program_code, program_name, is_active\)"\)[\s\S]*limit\(1000\)/, "Existing courses report query must remain capped and intact.");
assert.match(reports, /from\("exams"\)\.select\("id, title, exam_title, course_id, course, duration, time_limit, status, created_at"\)[\s\S]*limit\(1000\)/, "Existing exams report query must remain capped and intact.");
assert.match(reports, /from\("violations"\)\.select\("id, student_id, exam_id, violation_type, description, severity, created_at"\)[\s\S]*limit\(1000\)/, "Existing violations report query must remain capped, metadata-only, and intact.");
assert.match(reports, /from\("exam_attempts"\)\.select\("id, exam_id, student_id, score, earned_points, max_points, submitted_at"\)[\s\S]*limit\(1000\)/, "Existing attempts report query must remain capped and intact.");
assert.doesNotMatch(reports, /createSignedUrl|screenshot_url|evidence_url|storage\.from/, "Reports must not introduce eager evidence loading or signing.");

assert.match(reports, /SearchBox[\s\S]*placeholder="Search reports"/, "Existing report search must remain.");
assert.match(reports, /SelectField[\s\S]*Violation Filter[\s\S]*violationTypes\.map/, "Existing violation filter must remain.");
assert.match(reports, /const tabs = \["Overview", "All Users", "Students", "Violations", "Courses", "Exams", "Professors", "Deans"\]/, "Existing report tabs must remain.");
assert.match(reports, /ListViewToolbar[\s\S]*onCardDensity[\s\S]*onTableDensity/, "Cards/Table and density controls must remain wired.");
assert.match(reports, /getListPageSlice\(filteredRows, page, listView\.pageSize\)/, "On-screen report pagination must remain wired.");
assert.match(reports, /Records<\/dt><dd>\{filteredRows\.length\.toLocaleString\(\)\}/, "Report count must use the full filtered dataset count.");
assert.match(reports, /window\.print\(\)/, "Print handler must remain the browser print action.");
assert.match(reports, /<h1>Smart Proctoring System<\/h1>[\s\S]*<h2>Dean Reports<\/h2>[\s\S]*<h3>\{reportTitle\}<\/h3>/, "Print-only header must use a formal report document hierarchy.");
assert.match(reports, /reports-print-table-wrap[\s\S]*filteredRows\.map\(\(row\)/, "Violation print table must use full filteredRows, not pageData rows.");
assert.match(reports, /rows=\{pageData\.rows\}/, "On-screen table/card rows should remain paginated.");
assert.match(reports, /Unable to load report data\./, "Report errors must remain distinguishable from empty results.");
assert.match(reports, /Loading reports\.\.\./, "Loading state must remain visible.");
assert.match(reports, /No report records match the current filters\./, "Filtered empty state must remain visible.");
assert.doesNotMatch(reports, /download|jsPDF|new jsPDF|\.save\(/i, "No Download/PDF generator exists or should be added in this phase.");

assert.match(styles, /\.dean-reports-table-scroll\s*\{[\s\S]*max-height:\s*calc\(48px \+ \(52px \* 15\)\)[\s\S]*overflow:\s*auto/, "Dean Reports screen table should use the intended 15-row local scroll containment.");
assert.match(styles, /\.dean-reports-table\s*\{[\s\S]*min-width:\s*1040px/, "Dean Reports table must keep readable local min-width.");
assert.match(styles, /\.dean-reports-panel \.list-record-card\s*\{[\s\S]*border:\s*1px solid rgba\(15,\s*23,\s*42,\s*0\.42\)/, "Dean Reports card view should use true boxed cards.");
assert.match(styles, /html\[data-theme="dark"\] \.dean-reports-panel \.list-record-card[\s\S]*border-color:\s*rgba\(226,\s*232,\s*240,\s*0\.48\)/, "Dean Reports cards must remain readable in dark mode.");
assert.match(styles, /@media print[\s\S]*\.reports-page \.dean-reports-table-scroll\s*\{[\s\S]*max-height:\s*none !important[\s\S]*overflow:\s*visible !important/, "Print CSS must not clip the Dean Reports scroll container.");
assert.match(styles, /@media print[\s\S]*\.reports-page \.admin-violations-report-panel \.dean-reports-table-scroll\s*\{[\s\S]*display:\s*none !important/, "Violation print output must use the full hidden print table instead of the paginated screen table.");
assert.match(styles, /@media print[\s\S]*\.admin-topbar,[\s\S]*\.dean-topbar,[\s\S]*\.admin-menu-button,[\s\S]*\.admin-drawer,[\s\S]*\.dean-sidebar/, "Dean app shell and topbar chrome must be hidden in print.");
assert.match(styles, /@media print[\s\S]*\.dean-kpi-grid,[\s\S]*\.dean-reports-controls,[\s\S]*\.dean-reports-header/, "Dean Reports screen KPI/header/filter controls must be hidden in print.");
assert.match(styles, /@media print[\s\S]*\.tabs,[\s\S]*\.header-actions,[\s\S]*\.list-view-toolbar,[\s\S]*\.list-view-controls/, "Report tabs, print button, view controls, and density controls must be hidden in print.");
assert.match(styles, /reports-print-table-wrap td:nth-child\(4\) \{ width: 15%; \}[\s\S]*reports-print-table-wrap td:nth-child\(5\) \{ width: 30%; \}/, "Print table must reserve more room for Violation and Details columns.");
assert.match(styles, /reports-print-table-wrap th:nth-child\(4\),[\s\S]*reports-print-table-wrap td:nth-child\(5\) \{[\s\S]*overflow-wrap:\s*anywhere;[\s\S]*word-break:\s*break-word;[\s\S]*white-space:\s*normal;/, "Long violation/details values must wrap inside print table cells.");
assert.match(styles, /@media print[\s\S]*\.reports-page \.reports-panel-header p\s*\{[\s\S]*display:\s*none !important/, "Screen-only pagination helper text must be hidden in print.");
assert.match(styles, /@media print[\s\S]*\.reports-print-header h2[\s\S]*font-size:\s*17pt[\s\S]*\.reports-print-header h3/, "Print header should use formal document typography.");
assert.match(styles, /@media print[\s\S]*background:\s*#fff !important[\s\S]*color:\s*#111827 !important/, "Print output must remain readable from light or dark theme.");

assert.match(dashboard, /className="dean-dashboard-page"/, "Dean Dashboard should remain on the approved Phase 1 container.");
assert.match(integrity, /className="dean-integrity-page"/, "Dean Exam Integrity should remain on the approved Phase 2 container.");
assert.match(courses, /dean-courses-page/, "Dean Courses should remain on the approved Phase 3 container.");
assert.doesNotMatch(dashboard, /dean-reports-page/, "Dean Dashboard must not be redesigned by the reports phase.");
assert.doesNotMatch(integrity, /dean-reports-page/, "Dean Exam Integrity must not be redesigned by the reports phase.");
