import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("src/App.jsx", "utf8");
const layout = readFileSync("src/pages/cluster/ClusterLayout.jsx", "utf8");
const dashboard = readFileSync("src/pages/cluster/ClusterDashboard.jsx", "utf8");
const examList = readFileSync("src/pages/cluster/ClusterExamList.jsx", "utf8");
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
assert.match(dashboard, /import \{ RowActionMenu \} from "\.\.\/\.\.\/components\/ui"/, "Cluster Recent Activity should reuse the shared RowActionMenu.");
assert.match(dashboard, /const \[openActionMenuId, setOpenActionMenuId\] = useState\(""\)/, "Cluster Recent Activity should allow only one shared row action menu open at a time.");
assert.match(dashboard, /<RowActionMenu[\s\S]*label=\{`Actions for \$\{row\.examTitle \|\| "exam"\}`\}[\s\S]*menuId=\{`cluster-review-actions-\$\{row\.id\}`\}/, "Each Recent Activity row should expose one accessible kebab trigger.");
assert.match(dashboard, /actions=\{\[[\s\S]*label: "Review"[\s\S]*onClick: \(\) => navigate\(`\/cluster\/exams\/\$\{row\.id\}`\)[\s\S]*row\.status === "Pending Review" \? \{[\s\S]*label: loadingActionId === row\.id \? "Saving\.\.\." : "Approve Exam"[\s\S]*onClick: \(\) => handleApprove\(row\.id\)[\s\S]*row\.status === "Pending Review" \? \{[\s\S]*danger: true[\s\S]*label: "Reject"[\s\S]*onClick: \(\) => handleReject\(row\.id\)/, "Pending Review menu should preserve Review, Approve Exam, and Reject handlers.");
assert.doesNotMatch(dashboard, /<div className="cluster-row-actions">[\s\S]*<Button disabled=\{loadingActionId === row\.id\} variant="light" onClick=\{\(\) => handleApprove\(row\.id\)\}/, "Recent Activity should not render the old inline approve/review/reject button group.");
assert.match(styles, /\.cluster-row-actions\s*\{[\s\S]*justify-content:\s*center/, "Cluster Recent Activity actions column should center the kebab trigger.");
assert.match(styles, /\.cluster-review-table th:nth-child\(6\)\s*\{\s*width:\s*8%;\s*\}/, "Cluster Recent Activity Actions column should be compact after moving actions into the menu.");

assert.match(examList, /export default function ClusterExamList\(\{ status \}\)/, "Cluster exam list route component must remain status-driven.");
assert.match(examList, /const \{ exams, filterOptions, reviews, approveExam, rejectExam \} = useCluster\(\)/, "Cluster exam list must keep its existing data source and handlers.");
assert.match(examList, /setStatusFilter\(status\)/, "Pending/Approved/Rejected route status filter must remain driven by route props.");
assert.match(examList, /exam\.status === statusFilter/, "Existing pending-status filtering must remain exact.");
assert.match(examList, /matchesSearch = `\$\{exam\.id\} \$\{exam\.examTitle\} \$\{exam\.professorName\} \$\{exam\.course\}`/, "Existing search fields must be preserved.");
assert.match(examList, /matchesCourse[\s\S]*matchesProfessor[\s\S]*matchesDate/, "Existing Course, Professor, and Date filters must be preserved.");
assert.match(examList, /useListViewPreference\(\{ role: "cluster", page: "exam-review", defaultView: "table" \}\)/, "Cards/Table preference must remain table-first and cluster-scoped.");
assert.match(examList, /getListPageSlice\(filtered, page, TABLE_PAGE_SIZE\)/, "Cluster exam queue pagination must stay table-sized and ignore stale card-view preferences.");
assert.match(examList, /import \{ Button, Field, RowActionMenu, SearchBox, SelectField, Table \} from "\.\.\/\.\.\/components\/ui"/, "Pending Exams should reuse the shared RowActionMenu for multiple row actions.");
assert.match(examList, /const \[openActionMenuId, setOpenActionMenuId\] = useState\(""\)/, "Pending Exams should allow only one row action menu open at a time.");
assert.doesNotMatch(examList, /RecordCardList|ListViewToolbar|listView\.view|switchViewPreservingPage|setCardDensity|cardDensity/, "ClusterExamList should be table-only with no Cards/Table selector or card branch.");
assert.match(examList, /function TableDensityControls\(\{ tableDensity, onTableDensity \}\)/, "ClusterExamList should keep scoped table density controls.");
assert.match(examList, /className="cluster-exam-list-page"/, "Pending Exams should use the scoped redesigned page wrapper.");
assert.match(examList, /<header className="cluster-exam-list-header">[\s\S]*<h1>\{titles\[status\]\}<\/h1>/, "Pending Exams should use the compact cluster page header.");
assert.match(examList, /className="cluster-exam-list-toolbar"/, "Pending Exams filters should live in a boxed toolbar.");
assert.match(examList, /className="cluster-exam-list-panel"/, "Pending Exams records should live in a boxed panel.");
assert.match(examList, /className="cluster-exam-table-scroll"/, "Pending Exams table should use local horizontal overflow.");
assert.match(examList, /<Table className=\{`cluster-exam-list-table list-table-\$\{listView\.tableDensity\}`\} columns=\{columns\} rows=\{pageData\.rows\} renderActions=\{renderActions\}/, "Pending Exams table path must keep existing columns and actions.");
assert.match(examList, /emptyTitle="No exams are currently awaiting review\."/,
  "Pending Exams table should show a concise empty state.");
assert.match(examList, /label=\{`Actions for \$\{row\.examTitle \|\| "exam"\}`\}[\s\S]*menuId=\{`cluster-exam-actions-\$\{status\}-\$\{row\.id\}`\}/, "Each Pending Exams record should expose one accessible kebab trigger.");
assert.match(examList, /status === "Approved" \? \([\s\S]*>View<[\s\S]*>Download Review<[\s\S]*>Generate Report</, "Approved actions must be preserved.");
assert.match(examList, /status === "Rejected" \? \([\s\S]*>View<[\s\S]*Download Feedback[\s\S]*Resubmission History/, "Rejected actions must be preserved.");
assert.match(examList, /label: "View Exam"[\s\S]*label: "Review Exam"[\s\S]*label: loadingActionId === row\.id \? "Saving\.\.\." : "Approve"[\s\S]*label: "Reject"[\s\S]*label: "Send Feedback"/, "Pending Review actions must be preserved.");
assert.match(styles, /\.cluster-exam-list-page\s*\{[\s\S]*display:\s*grid/, "Pending Exams should have scoped page styling.");
assert.match(styles, /\.cluster-exam-list-panel\s*\{[\s\S]*border-radius:\s*8px/, "Pending Exams records panel should use boxed system styling.");
assert.match(styles, /\.cluster-exam-table-scroll\s*\{[\s\S]*overflow:\s*auto/, "Pending Exams table should keep local overflow.");
assert.match(styles, /\.cluster-exam-list-table\s*\{[\s\S]*min-width:\s*0;[\s\S]*width:\s*100%/, "Cluster exam queue table should use available desktop width without an oversized min-width.");
assert.match(styles, /\.cluster-exam-list-table thead th\s*\{[\s\S]*overflow-wrap:\s*normal;[\s\S]*word-break:\s*normal/, "Cluster exam queue headers should not break character-by-character.");
assert.match(styles, /\.cluster-exam-list-table \.badge\s*\{[\s\S]*white-space:\s*nowrap/, "Cluster exam queue status badges should stay readable.");
assert.match(styles, /\.cluster-exam-list-table \.actions-heading[\s\S]*white-space:\s*nowrap/, "Cluster exam queue Actions header should stay on one line.");
assert.match(styles, /@media \(max-width: 1024px\)[\s\S]*\.cluster-exam-list-table\s*\{[\s\S]*min-width:\s*1040px/, "Cluster exam queue should keep local narrow-screen overflow safety.");

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
