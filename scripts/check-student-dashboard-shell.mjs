import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";

const app = readFileSync("src/App.jsx", "utf8");
const layout = readFileSync("src/pages/student/StudentLayout.jsx", "utf8");
const dashboard = readFileSync("src/pages/student/StudentDashboard.jsx", "utf8");
const takeExam = readFileSync("src/pages/student/StudentExamTake.jsx", "utf8");
const styles = readFileSync("src/styles.css", "utf8");
const portalStyles = readFileSync("src/student-portal.css", "utf8");
const grades = readFileSync("src/pages/student/StudentGrades.jsx", "utf8");
const main = readFileSync("src/main.jsx", "utf8");

assert.match(main, /import "\.\/styles.css";\s*import "\.\/student-portal.css";/, "Student presentation overrides must load after the shared styles.");
const unscopedRules = [];
postcss.parse(portalStyles).walkRules((rule) => {
  if (rule.selectors.some((selector) => !selector.startsWith(".student-app-shell"))) unscopedRules.push(rule.selector);
});
assert.deepEqual(unscopedRules, [], "Student visual rules must be scoped to the normal shell, excluding Exam Taking and other roles.");
const stackedTableRules = [];
postcss.parse(styles + portalStyles).walkRules((rule) => {
  if (/\.student-available-exams-table\s+td[^,]*::before/.test(rule.selector)) stackedTableRules.push(rule.selector);
  if (!rule.selectors.some((selector) => /\.student-(?:available-exams|grades)-table(?:\s+(?:thead|tbody|tr|th|td)(?::nth-child\([^)]*\))?)*$/.test(selector))) return;
  rule.walkDecls("display", ({ value }) => {
    if (["none", "block", "grid", "flex"].includes(value)) stackedTableRules.push(rule.selector);
  });
});
assert.deepEqual(stackedTableRules, [], "Student Table mode must preserve native headers and cells at every viewport.");
assert.match(portalStyles, /\.student-app-shell \.list-table-wrap\s*\{[^}]*overflow-x: auto/, "Only the bounded table wrapper should own horizontal scrolling.");
assert.match(grades, /\[openCourseId, setOpenCourseId\] = useState\(null\)/, "Grades must remain collapsed by default.");
assert.match(grades, /aria-expanded=\{isOpen\}/, "Grade accordions must expose their expanded state.");

assert.match(app, /<Route path="\/student" element=\{<StudentLayout \/>\}/, "Student shell route must remain available.");
assert.match(app, /<Route index element=\{<StudentDashboard \/>\}/, "Student Dashboard index route must remain available.");
assert.match(app, /<Route path="exams\/:examId" element=\{<StudentExamTake \/>\}/, "Take Exam route must remain nested and available.");

assert.match(layout, /className="student-app-shell"/, "Student normal portal should use the redesigned app shell.");
assert.match(layout, /function StudentSidebar/, "Student shell should render a reusable sidebar.");
assert.match(layout, /Smart Proctoring[\s\S]*Student Portal/, "Student sidebar branding should remain present.");
assert.match(layout, /studentNavigation = \[/, "Student navigation should be explicit and inspectable.");
assert.match(layout, /label: "Dashboard"[\s\S]*label: "Resources"[\s\S]*label: "Grades"/, "Actual Student navigation links must remain available.");
assert.match(layout, /aria-label="Open student navigation"/, "Student shell should expose mobile drawer navigation.");
assert.match(layout, /student-topbar-title/, "Student topbar should expose the current page title.");
assert.match(layout, /student-topbar-actions[\s\S]*student-theme-button[\s\S]*student-message-menu[\s\S]*<NotificationBell user=\{user\} \/>[\s\S]*student-profile-menu/, "Topbar order must be Theme, Messages, Notifications, Profile.");
assert.match(layout, /useTheme\(\)/, "Student shell must use the shared theme context.");
assert.match(layout, /useMessagePreview\(user\)/, "Student messages preview must remain mounted.");
assert.match(layout, /<MessageModal initialConversationId=\{messageTargetId\}/, "Student MessageModal integration must remain wired.");
assert.match(layout, /<NotificationBell user=\{user\} \/>/, "Student notifications must use the shared NotificationBell.");
assert.match(layout, /<ProfileMenu className="profile-menu admin-profile-menu student-profile-menu"/, "Student profile menu must use the shared ProfileMenu.");
assert.match(layout, /isTakingExam[\s\S]*student-exam-shell[\s\S]*<Outlet \/>/, "Take Exam should bypass the ordinary Student sidebar/topbar shell.");

assert.match(dashboard, /className="student-dashboard-page"/, "Student Dashboard page container must remain present.");
assert.match(dashboard, /className="student-dashboard-header"/, "Student Dashboard should use a compact page header.");
assert.match(dashboard, /className="student-dashboard-summary-grid"/, "Student Dashboard should render boxed summary cards.");
assert.match(dashboard, /courses\.length/, "Student course count should derive from loaded course data.");
assert.match(dashboard, /availableExams\.length/, "Student available exam count should derive from loaded exam data.");
assert.match(dashboard, /My Courses/, "Dashboard course preview must remain present.");
assert.match(dashboard, /Available Exams/, "Dashboard available exams preview must remain present.");
assert.match(dashboard, /navigate\(`\/student\/courses\/\$\{course\.id\}\/materials`\)/, "Course open action must remain wired.");
assert.match(dashboard, /navigate\(`\/student\/exams\/\$\{exam\.id\}`\)/, "Available exam start action must remain wired.");
assert.match(dashboard, /getExamAttemptEligibility/, "Existing available exam eligibility must remain in use.");
assert.doesNotMatch(dashboard, /exam_attempts[\s\S]*select\("\*"\)/, "Dashboard must not add broad attempt-history fetching.");

assert.match(styles, /\.student-app-shell\s*\{[\s\S]*grid-template-columns:\s*260px minmax\(0,\s*1fr\)/, "Student shell should use a desktop sidebar/content grid.");
assert.match(styles, /html\[data-theme="light"\] \.student-sidebar\s*\{[\s\S]*background:\s*#0f172a/, "Light Student shell should keep a dark navy sidebar.");
assert.match(styles, /\.student-sidebar nav a\s*\{[\s\S]*color:\s*rgba\(226,\s*232,\s*240,\s*0\.84\)/, "Inactive Student sidebar navigation should stay readable on dark navy.");
assert.match(styles, /\.student-sidebar nav a\.active\s*\{[\s\S]*background:\s*#2563eb[\s\S]*color:\s*#fff/, "Active Student sidebar navigation should remain primary blue with white text.");
assert.match(styles, /\.student-sidebar-profile\s*\{[\s\S]*background:\s*rgba\(15,\s*23,\s*42,\s*0\.78\)/, "Student sidebar identity block should use a subtle dark boxed surface.");
assert.match(styles, /\.student-dashboard-page \.student-primary-button[\s\S]*background:\s*#2563eb/, "Student Join Course button should use the system primary blue.");
assert.match(styles, /\.student-dashboard-page \.student-kpi-card\s*\{[\s\S]*border:\s*1px solid rgba\(15,\s*23,\s*42,\s*0\.48\)/, "Light Student KPI cards need visible dark-neutral outlines.");
assert.match(styles, /html\[data-theme="dark"\] \.student-dashboard-page \.student-kpi-card[\s\S]*border-color:\s*rgba\(226,\s*232,\s*240,\s*0\.58\)/, "Dark Student KPI cards need visible light outlines.");
assert.match(styles, /\.student-dashboard-page \.student-dashboard-card\s*\{[\s\S]*border-radius:\s*8px/, "Student dashboard panels should follow the approved boxed style.");
assert.match(styles, /\.student-dashboard-page \.student-dashboard-record-card\s*\{[\s\S]*border:\s*1px solid rgba\(15,\s*23,\s*42,\s*0\.48\)/, "Student dashboard record cards should be real boxed cards.");
assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.student-app-shell/, "Student shell should keep responsive mobile behavior.");

assert.match(takeExam, /student-exam-take-page/, "Take Exam workspace should remain implemented with its existing workspace class.");
