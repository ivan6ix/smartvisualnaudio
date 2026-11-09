/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { reviewTargetsProblem } from "../src/lib/reviewTargets.js";

const sql = readFileSync("supabase/migrations/20261109120000_cluster_program_assignment.sql", "utf8");
const accountFunction = readFileSync("supabase/functions/create-account/index.ts", "utf8");
const reviewFunction = readFileSync("supabase/functions/review-exam/index.ts", "utf8");
const people = readFileSync("src/pages/People.jsx", "utf8");
const createExam = readFileSync("src/pages/professor/ProfessorCreateExam.jsx", "utf8");
const exams = readFileSync("src/pages/professor/ProfessorExams.jsx", "utf8");
const layout = readFileSync("src/pages/cluster/ClusterLayout.jsx", "utf8");

// Each Cluster Professor has one program; an exam belongs to its course's program and, for shared exams,
// to the programs of every course in the group (any of those programs' clusters may review it).
assert.match(sql, /alter table public\.cluster_professors\s+add column if not exists program_id uuid references public\.programs\(id\)/);
assert.match(sql, /function public\.exam_program_ids\(p_exam_id uuid\)[\s\S]*exam_publish_group_members m2 on m2\.group_id = m\.group_id/);
assert.match(sql, /function public\.cluster_can_review_exam\(p_exam_id uuid\)[\s\S]*where program_id = public\.current_cluster_program_id\(\)/);
assert.match(sql, /where cp\.id = auth\.uid\(\) and p\.role = 'Cluster Professor' and p\.status = 'Active'/, "Only active clusters have a program in effect.");

// Every place a cluster reads review material is limited to its program; an unassigned cluster sees nothing.
for (const policy of ["exams_cluster_review_read", "courses_cluster_read", "exam_questions_audit_read", "exam_approval_logs_reviewer_read", "exam_rejection_logs_reviewer_read", "exam_publish_groups_owner_read", "exam_publish_group_members_owner_read"]) {
  const block = sql.slice(sql.indexOf(`create policy ${policy}`) >= 0 ? sql.indexOf(`create policy ${policy}`) : sql.indexOf(`create policy "${policy}"`));
  assert.ok(block.length < sql.length, `${policy} is redefined.`);
  assert.match(block.slice(0, 600), /cluster_can_(review_exam|see_course|review_group)/, `${policy} checks the cluster's program.`);
}
assert.match(sql, /with check \(auth\.uid\(\) = cluster_professor_id and public\.cluster_can_review_exam\(exam_id\)\)/, "A cluster can record reviews only for its program.");
assert.match(sql, /create trigger guard_cluster_review_program\s+before insert on public\.exam_reviews/, "Shared-exam reviews (run as the owner) are checked too.");

// Review requests go only to clusters of the exam's program(s).
assert.match(sql, /function public\.get_review_targets\(p_exam_id uuid default null, p_course_ids uuid\[\] default null\)/);
assert.match(sql, /p_workflow = 'exam_review_request'[\s\S]*cp\.program_id in \(select public\.exam_program_ids\(p_context_id\)\)/);
assert.doesNotMatch(createExam + exams, /\.eq\("role", "Cluster Professor"\)/, "Professors no longer notify every Cluster Professor.");
assert.match(createExam, /getReviewTargets\(supabase, \{ courseIds: selectedCourseIds \}\)[\s\S]*reviewTargetsProblem\(reviewTargets\)[\s\S]*savingRef\.current = true/, "Create Exam checks reviewers before saving.");
assert.match(exams, /getReviewTargets\(supabase, \{ examId: exam\.id \}\)[\s\S]*if \(exam\.groupId\)/, "Exams checks reviewers before submitting.");

// The professor is told why an exam cannot be submitted for review.
assert.equal(reviewTargetsProblem({ programs: ["BSIT"], clusters: [{ id: "c1" }] }), "");
assert.match(reviewTargetsProblem({ programs: ["BSIT"], clusters: [] }), /No Cluster Professor is assigned to BSIT yet/);
assert.match(reviewTargetsProblem({ programs: ["BSIT", "BSCS"], clusters: [] }), /BSIT, BSCS/);
assert.match(reviewTargetsProblem({ programs: [], clusters: [] }), /course has no program/);

// The review function checks the program as the caller and only reviews pending exams.
assert.match(reviewFunction, /userClient\.rpc\("cluster_can_review_exam", \{ p_exam_id: examId \}\)/);
assert.match(reviewFunction, /This exam is not in your assigned program\./);
assert.match(reviewFunction, /This exam is no longer waiting for review\./);

// The Admin picks the program when creating a Cluster Professor, and can assign or change it later.
assert.match(accountFunction, /if \(action === "assign-program"\)/);
assert.match(accountFunction, /Only Cluster Professors are assigned a program\./);
assert.match(accountFunction, /program_id: program\?\.id \|\| null/);
assert.match(accountFunction, /eventType: "account\.program_assigned"/);
assert.match(people, /label="Program to Review"/);
assert.match(people, /action: "assign-program", userId: assignTarget\.id, programId: assignProgramId/);
assert.match(people, /<Badge tone="warn">Not assigned<\/Badge>/);
assert.match(layout, /<ClusterProgramBanner userId=\{user\.id\} \/>/);

console.log("Cluster program checks passed.");
