# Multi-Course Exam Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Publish and edit one shared questionnaire across owned course sections while preserving independent student records.

**Architecture:** Add a group and member mapping around existing per-course exams. Transactional RPCs own group creation, content changes, lifecycle, and review. Legacy single-course RPCs remain available for ungrouped exams.

**Tech Stack:** React, Vite, Supabase/Postgres PL/pgSQL, Edge Function, Node and SQL tests.

**Spec:** docs/superpowers/specs/2026-10-10-multi-course-exam-publishing-design.md

## Global Constraints

- Preserve legacy exam IDs, RLS, grading, monitoring, and review behavior.
- Keep content and common settings identical; assignments and student records per exam.
- Never apply production migrations or push dependent code until approved and migration verified.
- Reject whole operations for archived, attempted, stale, unauthorized, or divergent members.

## Review Focus

- Same request key with changed payload must conflict, not replay (Task 1).
- Student assignment to a course without enrollment must fail atomically (Task 1).
- A start session without a submitted attempt must protect questions (Task 2).
- Direct single-member writes must fail for grouped exams (Task 2).
- Cluster decision must update and log every group member (Task 3).

---

### Task 1: Schema and atomic publishing

**Files:** Create timestamped migration under supabase/migrations via Supabase CLI; create supabase/local/multi-course-exam-runtime-tests.sql.

**Interface:** publish_exam_group(p_source_exam_id uuid, p_exam jsonb, p_questions jsonb, p_course_ids uuid[], p_assignments jsonb, p_request_key text) returns jsonb with group_id, revision, and exam IDs.

- [ ] Write SQL tests for one/three courses, independent exam and question IDs, content equality, per-course selected students, Entire Course, invalid and unauthorized courses, idempotency digest conflict, and transaction rollback.
- [ ] Run locally and observe expected feature-absent failures.
- [ ] Add group/member tables, canonical request payload and digest, constraints, RLS, grants, question sort_order, and transactional publish RPC. Strip draftSnapshot before any member becomes student-readable.
- [ ] Rerun SQL tests and confirm pass.

### Task 2: Shared editing and lifecycle

**Files:** Extend migration and SQL tests; modify existing exam RPC/guard definitions only where grouped members need protection.

**Interfaces:** save_exam_group(p_group_id uuid, p_exam jsonb, p_questions jsonb, p_assignments jsonb, p_expected_revision bigint) returns jsonb; transition_exam_group(p_group_id uuid, p_action text, p_expected_revision bigint) returns jsonb; get_exam_group(p_exam_id uuid) returns jsonb.

- [ ] Write SQL tests for propagation, stable IDs, stale revision, divergent member, archived member, starts/attempts, rollback, status actions, direct member write rejection, and legacy behavior.
- [ ] Observe red tests locally.
- [ ] Implement ordered locks, revision check, identical content writes in sort_order, attempt protection, group lifecycle and group-only guards. Update the student question RPC and professor/cluster readers to use sort_order nulls last, id; legacy rows retain ID ordering.
- [ ] Rerun SQL and existing exam safety tests.

### Task 3: Cluster review

**Files:** Extend migration and SQL tests; modify supabase/functions/review-exam/index.ts and src/context/ClusterContext.jsx.

**Interface:** review_exam_group(p_exam_id uuid, p_action text, p_remarks text) returns jsonb; validates Cluster Professor and records each member decision transactionally.

- [ ] Write tests for group approve/reject, review logs, concurrency, archived-member failure, and legacy review.
- [ ] Observe red tests locally.
- [ ] Route grouped Edge Function review to RPC and present one representative in the queue.
- [ ] Rerun SQL and UI review checks.

### Task 4: Professor Create/Edit Exam

**Files:** Modify src/pages/professor/ProfessorCreateExam.jsx and src/styles.css; add focused UI tests/checks.

- [ ] Add failing UI checks for searchable multi-select, chips/count, per-course assignments, draft recovery, shared banner, confirmation, and narrow widths.
- [ ] Implement picker, one-row draft autosave, per-course assignments, group publish/edit calls, retry key and expected revision.
- [ ] Run focused and existing Create Exam checks.

### Task 5: Professor Exams and release gate

**Files:** Modify src/pages/professor/ProfessorExams.jsx and relevant styles/checks.

- [ ] Add failing checks for shared label/course list, one Edit Shared Exam action, group lifecycle actions, and legacy cards/table preferences.
- [ ] Implement group-aware display and actions; rerun checks.
- [ ] Run npm test, npm run lint, npm run build, git diff --check, local SQL tests, and responsive browser checks.
- [ ] Review diff, commit only feature files, and stop before production migration or deployment. Report verification gaps and required release order.

## Local Implementation Checkpoint

The additive migration, group RPCs, Professor editor/list integration, Cluster review path, and focused checks are implemented on `codex/multi-course-exams`. Rollback-only SQL fixtures exercise course authorization, assignment isolation, draft adoption, idempotent replay/conflict, synchronized edits, lifecycle and review decisions, audit rows, stale revisions, attempt protection, RLS, and legacy exams. `npm test`, lint, and build pass locally.

Browser-width and Safari verification remain pending because this checkout has no Playwright dependency or authenticated test session. The local Supabase instance had older missing prerequisite migrations; those repository migrations and the new schema/functions were applied locally in parts for the runtime checks without resetting data. A clean, in-order migration replay remains a separate release check. The production migration, push, and deployment remain explicitly blocked pending user approval, with migration application required before deploying code that invokes the new RPCs.
