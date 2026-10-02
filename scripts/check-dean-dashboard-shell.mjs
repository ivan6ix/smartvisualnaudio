import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("src/App.jsx", "utf8");
const layout = readFileSync("src/pages/dean/DeanLayout.jsx", "utf8");
const dashboard = readFileSync("src/pages/dean/DeanDashboard.jsx", "utf8");
const integrity = readFileSync("src/pages/dean/DeanExamIntegrity.jsx", "utf8");
const styles = readFileSync("src/styles.css", "utf8");

assert.match(app, /<Route path="\/dean" element=\{<DeanLayout \/>\}/, "Dean shell route must remain available.");
["<Route index element={<DeanDashboard />} />", 'path="integrity"', 'path="courses"', 'path="reports"', 'path="notifications"', 'path="profile"', 'path="security"'].forEach((token) => {
  assert.ok(app.includes(token), `Dean nested route missing: ${token}`);
});

assert.match(layout, /className="admin-app-shell dean-app-shell"/, "Dean shell should use the shared app shell.");
assert.match(layout, /Smart Proctoring[\s\S]*Dean Portal/, "Dean sidebar branding should remain present.");
assert.match(layout, /deanNavigation = \[[\s\S]*Dashboard[\s\S]*Exam Integrity[\s\S]*Courses[\s\S]*Reports[\s\S]*Notifications/, "Dean navigation must expose actual Dean routes.");
assert.match(layout, /deanUtilityNavigation = \[[\s\S]*Profile/, "Dean profile utility route must remain reachable.");
assert.match(layout, /useTheme\(\)/, "Dean shell must use the shared theme context.");
assert.match(layout, /dean-topbar-actions[\s\S]*dean-theme-button[\s\S]*dean-message-menu[\s\S]*<NotificationBell user=\{user\} \/>[\s\S]*dean-profile-menu/, "Topbar order must be Theme, Messages, Notifications, Profile.");
assert.match(layout, /useMessagePreview\(user\)/, "Dean message preview must remain wired.");
assert.match(layout, /<MessageModal initialConversationId=\{messageTargetId\}/, "Dean MessageModal integration must remain wired.");
assert.match(layout, /<ProfileMenu className="profile-menu admin-profile-menu dean-profile-menu"/, "Dean profile menu must reuse the shared ProfileMenu.");

assert.match(dashboard, /className="dean-dashboard-page"/, "Dean Dashboard page container must remain present.");
assert.match(dashboard, /Overview of examination activity, integrity monitoring, and oversight records/, "Dean Dashboard should keep oversight-focused header copy.");
assert.match(dashboard, /countRows\(supabase\.from\("profiles"\)[\s\S]*eq\("role", "Student"\)/, "Student count KPI must use existing profile count query.");
assert.match(dashboard, /countRows\(supabase\.from\("courses"\)[\s\S]*eq\("archived", false\)/, "Course count KPI must use existing course count query.");
assert.match(dashboard, /countRows\(supabase\.from\("exams"\)[\s\S]*in\("status", \["Active", "Published"\]\)/, "Active Exams KPI must use existing exam status query.");
assert.match(dashboard, /countRows\(supabase\.from\("violations"\)[\s\S]*gte\("created_at", today\)/, "Violations Today KPI must use existing bounded date query.");
assert.match(dashboard, /select\("id, student_id, exam_id, violation_type, severity, description, created_at"\)[\s\S]*limit\(500\)/, "Dean dashboard violation preview must remain capped and avoid eager evidence fields.");
assert.match(dashboard, /SearchBox[\s\S]*SelectField[\s\S]*ListViewToolbar[\s\S]*Table/, "Search, filters, list controls, and table presentation must remain wired.");
assert.match(dashboard, /RecordCardList/, "Existing card-view option must remain wired.");
assert.doesNotMatch(dashboard, /createSignedUrl|signedUrl|evidence_url|storage_path/, "Dean Dashboard must not eagerly load or expose evidence.");
assert.match(integrity, /createSignedUrl[\s\S]*loadEvidence/, "Full Exam Integrity page should keep on-demand evidence behavior.");

assert.match(styles, /\.dean-sidebar,\s*html\[data-theme="light"\] \.dean-sidebar\s*\{[\s\S]*background:\s*#0f172a/, "Dean sidebar should remain dark navy in Light Mode.");
assert.match(styles, /html\[data-theme="dark"\] \.dean-sidebar[\s\S]*background:\s*#0b1220/, "Dean sidebar should remain dark in Dark Mode.");
assert.match(styles, /\.dean-kpi-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(160px,\s*1fr\)\)/, "Dean KPI grid should use available dashboard width.");
assert.match(styles, /\.dean-kpi-card\s*\{[\s\S]*border-radius:\s*8px/, "Dean KPI cards should use boxed system styling.");
assert.match(styles, /\.dean-dashboard-panel\s*\{[\s\S]*border-radius:\s*8px/, "Dean dashboard panels should use boxed system styling.");
assert.match(styles, /@media \(max-width: 1100px\)[\s\S]*\.dean-dashboard-filters/, "Dean dashboard filters should retain responsive behavior.");
