import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const editor = readFileSync("src/pages/professor/ProfessorCreateExam.jsx", "utf8");
const list = readFileSync("src/pages/professor/ProfessorExams.jsx", "utf8");
const cluster = readFileSync("src/context/ClusterContext.jsx", "utf8");
const review = readFileSync("supabase/functions/review-exam/index.ts", "utf8");
const migration = readFileSync("supabase/migrations/20261010142803_multi_course_exam_groups.sql", "utf8");
const styles = readFileSync("src/styles.css", "utf8");

for (const value of ["courseIds", "selectedStudentsByCourse", "Search courses", "Students for course",
  "Shared across", "publish_exam_group", "save_exam_group", "p_request_key: publishKeyRef.current",
  "window.confirm(`Apply these shared changes"])
  assert.ok(editor.includes(value), `Professor editor must retain ${value}`);

assert.match(editor, /selectedCourseIds\.length === 1[\s\S]*saveAssignmentsForExam/, "Draft autosave must not create multiple exam records.");
assert.match(editor, /missingAssignmentCourse[\s\S]*Select at least one eligible student in every selected course/, "Each selected course must have its own assignments.");
assert.match(editor, /disabled=\{Boolean\(groupId\)\}[\s\S]*Selected Students/, "Existing group assignment mode must not appear editable.");
assert.match(editor, /groupHasReviewHistory[\s\S]*Review required/, "An edited reviewed group must route back through approval.");
assert.match(editor, /\.order\("sort_order"/, "Grouped questions must load in authored order.");
assert.match(list, /transition_exam_group[\s\S]*submit_review[\s\S]*publish[\s\S]*unpublish/, "Group lifecycle must use one RPC.");
assert.match(list, /Shared across \{exam\.sharedCourseCount\} courses/, "Cards and tables must identify shared exams.");
assert.match(list, /Boolean\(exam\.groupId\)[\s\S]*Delete/, "Individual grouped-member deletion must be unavailable.");
assert.match(cluster, /exam_publish_group_members[\s\S]*membersByGroup[\s\S]*liveExamRows = liveExamRows\.filter/, "Cluster review must show one representative.");
assert.match(review, /groupMember[\s\S]*review_exam_group/, "Group review must use its transactional RPC.");

for (const value of ["exam_publish_groups", "exam_publish_group_members", "request_payload", "request_digest",
  "exam_private.group_write_context", "guard_group_member_write", "publish_exam_group", "save_exam_group",
  "transition_exam_group", "review_exam_group", "student_can_take_exam", "order by q.sort_order nulls last, q.id"])
  assert.ok(migration.includes(value), `Migration must define ${value}`);

const grants = readFileSync("supabase/migrations/20261020120000_harden_exam_group_grants.sql", "utf8");
const groupTables = String.raw`public\.exam_publish_groups,\s*public\.exam_publish_group_members`;
assert.match(grants, new RegExp(String.raw`revoke all on table ${groupTables} from public, anon;`), "Group tables must revoke all client access from PUBLIC and anon.");
assert.match(grants, new RegExp(String.raw`revoke insert, update, delete, truncate, references, trigger\s+on table ${groupTables} from authenticated;`), "Authenticated clients must not write group tables directly.");
assert.match(grants, new RegExp(String.raw`grant select on table ${groupTables} to authenticated;`), "Authenticated clients keep RLS-filtered reads.");
assert.doesNotMatch(grants, /(?:create|drop|alter) policy|disable row level security/i, "Grant hardening must not change RLS policies.");

const resubmit = readFileSync("supabase/migrations/20261020150000_allow_rejected_group_resubmission.sql", "utf8");
assert.match(resubmit, /p_action = 'submit_review' and \(v_archived or v_status not in \('Unpublished', 'Rejected'\)\)/, "Rejected shared exams must be resubmittable for review.");
assert.match(resubmit, /p_action = 'publish' and \(v_archived or v_status <> 'Unpublished'\)/, "Rejected shared exams must still not publish directly.");
assert.match(resubmit, /if v_group\.revision <> p_expected_revision then[\s\S]*Group members diverged/, "Resubmission must keep revision and divergence checks.");
assert.match(list, /clusterStatus === "rejected" \? "Resubmit for Approval"[\s\S]*transitionGroupAction\(exam, "submit_review"\)/, "Resubmit for Approval must use the group submit_review transition.");

assert.match(styles, /\.professor-course-picker-options[\s\S]*max-height: 260px/, "Course picker should remain compact on narrow screens.");
assert.match(styles, /\.professor-shared-label/, "Shared labels need visible styling.");
