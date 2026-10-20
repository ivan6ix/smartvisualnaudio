import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { collapseReviewHistory, currentApprovals } from "../src/lib/clusterReviewHistory.js";

const row = (over) => ({
  review_id: over.review_id, exam_id: over.exam_id, group_id: over.group_id || null, shared_course_count: over.group_id ? 2 : 1,
  exam_title: over.exam_title || "Exam", course_label: over.course_label || "C1 - A", professor_name: "Prof",
  decision: over.decision, remarks: over.remarks || "", review_date: over.review_date,
  exam_status: over.exam_status || "Unpublished", approved_at: over.approved_at || null, currently_approved: Boolean(over.currently_approved),
});

const rows = [
  // Shared exam: approval and earlier rejection, one row per member course.
  row({ review_id: "r1", exam_id: "gA", group_id: "g", decision: "Approved", review_date: "2026-10-20T06:00:00Z", remarks: "Approved for publishing.", approved_at: "2026-10-20T06:00:00Z", currently_approved: true }),
  row({ review_id: "r2", exam_id: "gB", group_id: "g", course_label: "C2 - B", decision: "Approved", review_date: "2026-10-20T06:00:00Z", remarks: "Approved for publishing.", approved_at: "2026-10-20T06:00:00Z", currently_approved: true }),
  row({ review_id: "r3", exam_id: "gA", group_id: "g", decision: "Rejected", review_date: "2026-10-20T05:00:00Z", remarks: "Clarify." }),
  row({ review_id: "r4", exam_id: "gB", group_id: "g", course_label: "C2 - B", decision: "Rejected", review_date: "2026-10-20T05:00:00Z", remarks: "Clarify." }),
  // Single exam: approved earlier, later rejected (outdated approval must not count).
  row({ review_id: "r5", exam_id: "s1", decision: "Rejected", review_date: "2026-10-20T04:00:00Z", remarks: "Fix key." }),
  row({ review_id: "r6", exam_id: "s1", decision: "Approved", review_date: "2026-10-20T03:00:00Z", currently_approved: false }),
  // Single exam currently approved and published.
  row({ review_id: "r7", exam_id: "s2", decision: "Approved", review_date: "2026-10-20T02:00:00Z", exam_status: "Published", approved_at: "2026-10-20T02:00:00Z", currently_approved: true }),
];

const history = collapseReviewHistory(rows);
assert.equal(history.length, 5, "Shared exam decisions collapse to one entry each; single-exam rows stay separate.");
assert.deepEqual(history.map((entry) => `${entry.examId}:${entry.decision}:${entry.remarks}`), [
  "gA:Approved:Approved for publishing.", "gA:Rejected:Clarify.", "s1:Rejected:Fix key.", "s1:Approved:", "s2:Approved:",
], "Full history (approvals and rejections) is preserved in order.");
assert.equal(history[0].course, "C1 - A (Shared across 2 courses)", "Shared entries name the shared course count.");

const approvals = currentApprovals(rows);
assert.deepEqual(approvals.map((approval) => approval.id), ["gA", "s2"], "Only current approvals count, one per shared exam.");
assert.equal(approvals.length, 2, "Dashboard approved count is accurate.");
assert.deepEqual(currentApprovals([]), [], "Empty history yields no approvals.");
assert.deepEqual(collapseReviewHistory(undefined), [], "Missing data is handled.");

const migration = readFileSync("supabase/migrations/20261020170000_cluster_review_history_lookup.sql", "utf8");
assert.match(migration, /language plpgsql stable security definer set search_path = ''/, "Lookup must be a stable security definer with an empty search path.");
const lookupBody = migration.slice(migration.indexOf("as $$"), migration.indexOf("end;\n$$;"));
for (const match of lookupBody.matchAll(/\b(?:from|join)\s+([\w.]+)/gi)) {
  assert.ok(match[1].startsWith("public."), `Lookup table reference ${match[1]} must be schema-qualified.`);
}
assert.match(migration, /p\.id = auth\.uid\(\) and p\.role = 'Cluster Professor' and p\.status = 'Active'[\s\S]*errcode = '42501'/, "Lookup must require an active Cluster Professor.");
assert.match(migration, /where r\.cluster_professor_id = auth\.uid\(\)/, "Lookup must return only the caller's own reviews.");
assert.match(migration, /revoke all on function public\.get_cluster_review_history\(\) from public, anon;\s*grant execute on function public\.get_cluster_review_history\(\) to authenticated;/, "Execution must be revoked from PUBLIC and anon.");
assert.doesNotMatch(migration, /exam_questions|correct_answer|exam_attempts|student|policy/i, "Lookup must not touch questions, answers, students, or policies.");

const context = readFileSync("src/context/ClusterContext.jsx", "utf8");
assert.match(context, /supabase\.rpc\("get_cluster_review_history"\)/, "Cluster context must load history through the lookup.");
assert.match(context, /setReviews\(collapseReviewHistory\(history\)/, "Review History must use the collapsed lookup rows.");
assert.match(context, /currentApprovals\(history\)\.filter\(\(approval\) => !visibleIds\.has\(approval\.id\)\)[\s\S]*historyOnly: true/, "Approved list must add current approvals without duplicating visible exams.");
const dashboard = readFileSync("src/pages/cluster/ClusterDashboard.jsx", "utf8");
assert.match(dashboard, /: currentApprovals\(historyRows\)\.length/, "Dashboard approved count must use current approvals.");
const list = readFileSync("src/pages/cluster/ClusterExamList.jsx", "utf8");
assert.doesNotMatch(list, /Prof\. Nolan Lim/, "Approved By must not be a hard-coded name.");
assert.match(list, /row\.historyOnly \? \[\] : \[\{ label: "View"/, "History-only approvals must not open the review page.");
assert.match(readFileSync("src/pages/cluster/ClusterExamReview.jsx", "utf8"), /if \(!exam \|\| exam\.historyOnly\) return <Navigate/, "Review page must refuse history-only exams.");
