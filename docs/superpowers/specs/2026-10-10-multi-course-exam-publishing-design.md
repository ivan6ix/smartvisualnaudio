# Multi-Course Exam Publishing with Synchronized Editing

## Goal

Allow an authorized professor to publish one questionnaire to multiple owned course sections in one atomic action and edit the shared questionnaire consistently while preserving independent course records and historical student submissions.

## Scope

The change covers the Professor Create/Edit Exam flow, Professor Exams management view, additive Supabase schema and RPCs, and focused SQL/UI regression checks. Existing single-course exams remain unchanged and are not automatically grouped.

## Existing Constraints

- public.exams keeps one course_id per exam.
- public.exam_questions belongs to one exam and contains questionnaire content.
- Attempts, answers, violations, monitoring, assignments, scores, and reports are scoped to individual exam IDs.
- save_exam currently writes one exam and its questions transactionally.
- Direct Publish and Cluster Professor review are existing status paths and remain authoritative.

## Data Model

Add public.exam_publish_groups with id, created_by, source_exam_id, request_key, content_revision, timestamps, and unique (created_by, request_key).

Add public.exam_publish_group_members with group_id, exam_id, course_id, timestamp, unique (group_id, course_id), and primary key exam_id.

Legacy exams have no membership rows and continue through existing single-exam RPCs. Group members retain separate exam IDs and all existing course-scoped records.

## Server-Side Contracts

### publish_exam_group(p_exam jsonb, p_questions jsonb, p_course_ids uuid[], p_request_key text) returns jsonb

Run transactionally. Require an active authenticated Professor; validate a non-empty duplicate-free course list; lock and verify every course is active and owned by auth.uid(); validate the existing exam and question rules; reuse a matching request key; create one group, one exam per course, and one independent question set per exam; preserve Direct Publish or Pending Review status rules; and return the group and member exam IDs. Any failure rolls back the complete operation.

### save_exam_group(p_group_id uuid, p_exam jsonb, p_questions jsonb, p_expected_revision bigint) returns jsonb

Run transactionally. Require ownership of every member; lock the group and exams in stable order; reject stale revisions; detect attempts; allow only permitted metadata changes when attempts exist; reject question, answer, choice, correct-answer, point-value, or scoring-setting changes when attempts exist; otherwise replace every member questionnaire with the same validated payload while retaining exam and course IDs; preserve or renew approval state; and increment the revision once. No historical student record is updated.

## RLS and Permissions

Both functions use fixed search_path = public, revoke public and anonymous execution, grant execution only to authenticated users, and enforce professor ownership internally. Group metadata policies are additive and do not weaken existing RLS.

## UI Behavior

The Create/Edit Exam page gets a searchable multi-select showing course name, code, and section, removable selected chips, selected count, and a publish guard requiring at least one course. Draft recovery retains selections without creating duplicate exam rows. Multi-course Publish calls publish_exam_group once and disables duplicate submission. Group edit shows "Shared across N courses", lists the members, and requires confirmation before a group-wide save. Legacy single-course editing stays on the existing path.

Professor Exams shows "Shared across N courses", exposes the course list from the existing action surface, and offers one "Edit Shared Exam" action while preserving status sections, filters, pagination, list preferences, archive safeguards, and approval actions.

## Compatibility

Existing save_exam, Direct Publish, Draft, Pending Review, Unpublished, Published, Cluster review, scheduling, assignments, grading, monitoring, archive/delete safeguards, and student access remain intact. Legacy exams are not automatically converted to groups.

## Verification

Add focused checks for one-course compatibility, three-course atomic publishing, identical questionnaire content, unauthorized and duplicate course rejection, request-key idempotency, draft retention, group edit propagation, stale revision rejection, rollback, attempt protection, independent student records, RLS authorization, Cluster review preservation, legacy compatibility, and responsive course selection at 320px, 390px, 768px, and desktop widths.

Run npm test, npm run lint, npm run build, git diff --check, and local Supabase migration/runtime tests. Do not apply the migration to production without explicit approval.

## Deployment Gate

Review and apply the migration to the target Supabase environment before deploying frontend code that calls the new RPCs. Production deployment remains blocked until the migration is explicitly approved and verified.
