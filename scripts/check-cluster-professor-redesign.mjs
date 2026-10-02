import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("src/App.jsx", "utf8");
const layout = readFileSync("src/pages/cluster/ClusterLayout.jsx", "utf8");
const dashboard = readFileSync("src/pages/cluster/ClusterDashboard.jsx", "utf8");
const review = readFileSync("src/pages/cluster/ClusterExamReview.jsx", "utf8");
const notifications = readFileSync("src/hooks/useNotifications.js", "utf8");
const styles = readFileSync("src/styles.css", "utf8");

assert.match(app, /<Route path="\/cluster" element=\{<ClusterLayout \/>\}/, "Cluster shell route must remain available.");
["<Route index element={<ClusterDashboard />} />", 'path="pending"', 'path="approved"', 'path="rejected"', 'path="exams/:id"', 'path="history"', 'path="reports"', 'path="messages"', 'path="notifications"', 'path="profile"', 'path="security"'].forEach((token) => {
  assert.ok(app.includes(token), `Cluster nested route missing: ${token}`);
});

assert.match(layout, /className="admin-app-shell cluster-app-shell"/, "Cluster layout should use the shared sidebar shell.");
assert.match(layout, /Smart Proctoring[\s\S]*Cluster Professor Portal/, "Cluster sidebar branding should remain present.");
assert.match(layout, /clusterNavigation = \[[\s\S]*Review Overview[\s\S]*Pending Exams[\s\S]*Approved Exams[\s\S]*Rejected Exams[\s\S]*Review History[\s\S]*Reports[\s\S]*Messages[\s\S]*Notifications/, "Cluster navigation must expose actual cluster routes.");
assert.match(layout, /clusterUtilityNavigation = \[[\s\S]*Profile/, "Cluster profile utility route must remain reachable.");
assert.match(layout, /useTheme\(\)/, "Cluster shell must use the shared theme context.");
assert.match(layout, /cluster-topbar-actions[\s\S]*cluster-theme-button[\s\S]*cluster-message-menu[\s\S]*<NotificationBell user=\{user\} \/>[\s\S]*cluster-profile-menu/, "Topbar order must be Theme, Messages, Notifications, Profile.");
assert.match(layout, /useMessagePreview\(user\)/, "Cluster message preview must remain wired.");
assert.match(layout, /<MessageModal initialConversationId=\{messageTargetId\}/, "Cluster MessageModal integration must remain wired.");
assert.match(layout, /<ProfileMenu className="profile-menu admin-profile-menu cluster-profile-menu"/, "Cluster profile menu must reuse the shared ProfileMenu.");
assert.equal((layout.match(/<NotificationBell user=\{user\} \/>/g) || []).length, 1, "Cluster shell should mount exactly one NotificationBell.");

assert.match(notifications, /buildNotificationChannelName\(userId, hookOwnerId\)/, "Notifications must keep owner-scoped realtime channel names.");
assert.match(notifications, /filter: `user_id=eq\.\$\{userId\}`/, "Notifications must remain scoped to the active user.");

assert.match(dashboard, /className="cluster-review-page"/, "Cluster landing page container must remain present.");
assert.match(dashboard, /Review submitted examinations, respond to professors, and monitor approval activity\./, "Cluster landing page should keep its review-focused copy.");
assert.match(dashboard, /select\("id, title, exam_title, course, course_id, professor_id, created_by, status, submitted_at, approved_at, rejected_at, created_at, courses/, "Cluster dashboard must keep the existing exam query fields.");
assert.match(dashboard, /\.channel\(`cluster-dashboard-live-\$\{user\.id\}`\)/, "Cluster dashboard realtime channel must remain user keyed.");
assert.match(dashboard, /filter: `receiver_id=eq\.\$\{user\.id\}`/, "Cluster dashboard message realtime filter must remain scoped to the active user.");
assert.match(dashboard, /handleApprove\(row\.id\)/, "Dashboard approve action must remain wired.");
assert.match(dashboard, /navigate\(`\/cluster\/exams\/\$\{row\.id\}`\)/, "Dashboard review action must navigate to the review workflow.");
assert.match(dashboard, /handleReject\(row\.id\)/, "Dashboard reject action must remain wired.");

assert.match(review, /const REVIEW_NOTES_LIMIT = 1000/, "Review notes limit must remain 1000 characters.");
assert.match(review, /<TextArea label="Review Notes"[\s\S]*maxLength=\{REVIEW_NOTES_LIMIT\}/, "Review notes textarea must keep its max length.");
assert.match(review, /saveReview\(exam\.id, notes\)/, "Save Review behavior must remain wired.");
assert.match(review, /setApproveOpen\(true\)/, "Approve confirmation must remain wired.");
assert.match(review, /setRejectOpen\(true\)/, "Reject confirmation must remain wired.");
assert.match(review, /navigate\(-1\)/, "Return behavior must remain wired.");
assert.match(review, /buildClusterQuestionReview\(question\)/, "Question rendering must keep the shared review helper.");

assert.match(styles, /\.cluster-sidebar,\s*html\[data-theme="light"\] \.cluster-sidebar\s*\{[\s\S]*background:\s*#0f172a/, "Cluster sidebar should remain dark navy in Light Mode.");
assert.match(styles, /html\[data-theme="dark"\] \.cluster-sidebar[\s\S]*background:\s*#0b1220/, "Cluster sidebar should remain dark in Dark Mode.");
assert.match(styles, /\.cluster-kpi-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(180px,\s*1fr\)\)/, "Cluster KPI grid should use dashboard width.");
assert.match(styles, /\.cluster-kpi-card,\s*\.cluster-review-panel\s*\{[\s\S]*border-radius:\s*8px/, "Cluster cards and panels should use boxed system styling.");
assert.match(styles, /\.cluster-app-shell \.cluster-review-actions\s*\{[\s\S]*gap:\s*12px;[\s\S]*margin-top:\s*20px/, "Cluster review actions need stable spacing below the notes textarea.");
assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.cluster-review-table/, "Cluster dashboard table should retain responsive overflow behavior.");
