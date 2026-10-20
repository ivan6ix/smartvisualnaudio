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

### save_exam_group(p_group_id uuid, p_exam jsonb, p_questions jsonb, p_assignments jsonb, p_expected_revision bigint) returns jsonb

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

## Approved Clarifications (2026-10-10)

This section refines the contracts above and controls implementation where earlier wording is less specific.

### Shared and Course-Specific State

Shared across every member: questionnaire order and content (including choices, answer keys, question configuration, manual-grading flag, and points); title, exam type, period, semester, duration, description, instructions, schedule, attempt limit, randomization, scan, monitoring, and snapshot settings. A group revision covers this shared state. Question IDs remain distinct per exam because attempt answers reference those IDs; equality compares questionnaire content and order, not IDs.

Course-specific: exam ID, course ID/display, student assignment rows, access exceptions, enrollments, attempts, answers, scores, monitoring sessions, violations, notifications, reports, and audit history. The assignment mode is chosen for the group, but each member has independent selected-student IDs. For Selected Students, the request provides a course-ID-to-student-IDs map. The server validates each student as active and enrolled in that destination course, requires at least one eligible student per destination, and writes assignments only for that member. An Entire Course group creates no selected-student assignments. Share-to-Specific-Student remains per member and is never copied.

### Draft and Idempotency

One draft exam row is the editor's source. Its draftSnapshot stores selected course IDs and per-course student selections; autosave updates that row only. Publishing accepts its ID, checks that it is an owned editable draft, and adopts it as one member instead of creating a duplicate. A canonical request digest covers normalized shared payload, ordered question content, sorted distinct course IDs, assignment mode, and sorted per-course student IDs. The group row adds request_payload jsonb and request_digest text. The unique (created_by, request_key) row stores the canonical payload and its digest; equality of request_payload, not digest alone, decides replay versus conflict. A retry with the same key and digest returns the stored result; a changed digest returns a conflict. Locks and the unique constraint make concurrent retries safe. The client retains the key across network retries and rotates it only after a user edit.

### Lifecycle and Review

All group members have one lifecycle status. Publish, Unpublish, Archive/Restore, Draft-to-Unpublished, and Submit for Review operate through one group RPC that locks and validates every member before changing any. A member with an unexpected status or archive state makes the whole operation fail; no member is skipped. A rejected review blocks direct Publish as existing rules require. Direct Publish remains available where Cluster review is optional. A group review is presented once using a representative exam; the existing review Edge Function must call a group-aware transactional RPC for approve/reject, recording the decision for every member. Any content edit after approval clears approval group-wide and requires fresh review before publishing when the existing workflow requires it. Student notifications are emitted per member to that course's authorized students.

Legacy status RPCs and direct client status/content updates must reject grouped members. Per-member assignment changes remain allowed only when they preserve the group assignment mode and pass that member course eligibility and started-student locks; the group edit RPC accepts a per-course assignment map. Group-only guards must prevent direct edits to grouped exam rows, question rows, and assignment mode outside group RPCs, while leaving legacy exams unchanged. Group operations must preserve existing audit and deletion safeguards; individual permanent deletion of a grouped member is blocked, and any future group deletion needs an explicit separate design.

### Starts, Attempts, and Archived Members

If any member has an exam_start_session or exam_attempt, reject questionnaire or scoring changes for the entire group. The existing question guard still applies. Only lifecycle/archive fields already allowed by the current guard may change after starts or attempts; do not introduce a broader metadata exemption. If any member is archived, shared editing fails with a clear error until the group is restored. Never skip archived or attempted members. A stale group revision or divergent member content/status fails before any write. No historical student row is rewritten.

### Verification Additions

SQL runtime tests must cover per-course Selected Students validation and isolation, Entire Course visibility, exception isolation, idempotency digest conflict, duplicate and mixed-owner courses, retries, archived-member failure, attempted-member content rejection, group status/review transitions, direct single-member mutation rejection, transaction rollback, and legacy exam compatibility. UI tests must cover course-specific assignment selection, selected count and chips, confirmation, conflict/error messages, group badges/actions, and narrow-screen overflow.

### Question Order and Draft Privacy

The current readers order exam questions by UUID. Cloned member questions have distinct UUIDs, so identical list content does not guarantee identical display order. Add a nullable sort_order integer to exam_questions, populate it for grouped questions, and update the student question RPC plus professor/cluster readers to order by sort_order nulls last, id. Legacy rows retain their current ID order. Compare group content in sort_order order.

Do not expose per-course student selections in a published exam_settings.draftSnapshot. Keep them only in the owned draft while unpublished, then remove draftSnapshot from every published group member inside the publish transaction. An explicit professor-only draft store is preferable if the existing read policy exposes draft rows beyond the owner. Test that students cannot read assignment maps or answer keys through the new group metadata.
