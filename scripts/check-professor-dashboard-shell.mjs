import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const layout = readFileSync("src/pages/professor/ProfessorLayout.jsx", "utf8");
const dashboard = readFileSync("src/pages/professor/ProfessorDashboard.jsx", "utf8");
const ongoing = readFileSync("src/pages/professor/ProfessorOngoingExams.jsx", "utf8");
const styles = readFileSync("src/styles.css", "utf8");

assert.match(layout, /className="admin-app-shell professor-app-shell"/, "Professor layout should use the shared sidebar shell language.");
assert.match(layout, /className="admin-sidebar professor-sidebar"/, "Professor sidebar should reuse the Admin sidebar structure.");
assert.match(layout, /Dashboard[\s\S]*\/professor[\s\S]*Courses[\s\S]*\/professor\/courses[\s\S]*Exams[\s\S]*\/professor\/exams[\s\S]*Scores[\s\S]*\/professor\/scores[\s\S]*Monitoring[\s\S]*\/professor\/monitoring[\s\S]*Settings[\s\S]*\/professor\/profile/, "Professor sidebar routes must stay wired to existing pages.");

const themeIndex = layout.indexOf("professor-theme-button");
const messagesIndex = layout.indexOf("admin-message-menu");
const notificationsIndex = layout.indexOf("<NotificationBell");
const profileIndex = layout.indexOf("<ProfileMenu");
assert.ok(themeIndex > -1 && messagesIndex > themeIndex && notificationsIndex > messagesIndex && profileIndex > notificationsIndex, "Professor topbar order must be Theme, Messages, Notifications, Profile.");

assert.match(layout, /<ProfessorViolationAlerts user=\{user\} \/>/, "Portal-wide Professor live violation alerts must stay mounted once.");
assert.equal((layout.match(/ProfessorViolationAlerts/g) || []).length, 2, "Professor live violation alerts should not be duplicated.");
assert.equal((ongoing.match(/channel\("professor-ongoing-exams"\)/g) || []).length, 1, "Ongoing Exams realtime subscription must not be duplicated.");

assert.match(dashboard, /className="professor-dashboard-page"/, "Professor Dashboard should expose the redesigned page container.");
assert.match(dashboard, /className="professor-kpi-card"/, "Professor KPIs should use boxed dashboard cards.");
assert.match(dashboard, /<ProfessorOngoingExams \/>/, "Ongoing Exams must remain on the Professor Dashboard.");
assert.match(dashboard, /DASHBOARD_VIOLATION_ANALYTICS_LIMIT = 100/, "Professor Dashboard violation analytics should keep the optimized 100-row cap.");
assert.doesNotMatch(dashboard, /\.limit\(500\)/, "Professor Dashboard must not restore 500-row violation loading.");
assert.doesNotMatch(dashboard, /<span>Professor Workspace<\/span>/, "Professor Dashboard should not duplicate the topbar workspace context.");
assert.doesNotMatch(dashboard, /fill="#06b6d4"/, "Professor analytics chart should not use the old bright cyan fill.");
assert.match(dashboard, /fill="var\(--primary\)"/, "Professor analytics chart should use the professional primary accent.");

assert.match(ongoing, /className="professor-ongoing-footer"/, "Ongoing Exams sound note should be integrated inside the panel footer.");
assert.doesNotMatch(ongoing, /<\/Card>\s*<small className="professor-ongoing-note">/, "Ongoing Exams sound note should not float outside the panel.");

assert.match(styles, /\.professor-dashboard-page \.professor-kpi-card\s*\{[\s\S]*border:\s*1px solid/, "Professor KPI cards need a visible boxed outline.");
assert.match(styles, /html\[data-theme="dark"\] \.professor-dashboard-page \.professor-kpi-card[\s\S]*border-color:\s*rgba\(226,\s*232,\s*240,\s*0\.58\)/, "Dark Professor KPI cards need a visible light outline.");
assert.match(styles, /\.professor-dashboard-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1\.5fr\) minmax\(280px,\s*0\.8fr\)/, "Professor Dashboard should keep a balanced dashboard grid.");
assert.match(styles, /\.professor-dashboard-page \.professor-kpi-card\s*\{[\s\S]*min-height:\s*104px/, "Professor KPI cards should be compact but still boxed.");
assert.match(styles, /\.professor-dashboard-page \.professor-scroll-surface\s*::-webkit-scrollbar-thumb/, "Professor dashboard scrollbars should be scoped and neutral.");
assert.match(styles, /\.professor-topbar-actions \.professor-theme-button\s*\{[\s\S]*border-color:\s*var\(--app-line\)/, "Professor theme control should match neighboring topbar controls.");
