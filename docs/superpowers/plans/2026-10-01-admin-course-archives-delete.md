# Admin Course Archives Permanent Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe Admin-only permanent deletion for archived courses while preserving reversible archive behavior.

**Architecture:** Keep archive/restore on `admin_set_course_archived`; add one SECURITY DEFINER RPC for transactional DB deletion; add one Edge Function for authenticated orchestration and exact Storage API cleanup.

**Tech Stack:** React, Supabase Edge Functions, Postgres PL/pgSQL, Node assertion scripts.

**Spec:** `docs/superpowers/specs/2026-10-01-admin-course-archives-delete-design.md`

## Global Constraints

- Use `archived`, not `is_archived`.
- Do not delete existing hosted courses during implementation/testing.
- No service role in frontend.
- No arbitrary storage deletion; enforce bucket allowlist and exact paths.
- Do not change global FK cascade behavior.
- Accounts, profiles, and programs must survive.

## Review Focus

- Active courses cannot show Delete Permanently.
- RPC rejects non-Admin and active/non-archived courses.
- Storage cleanup cannot touch `profile-pictures`.
- Logs/notifications cleanup uses structured entity fields only.
- Partial storage failure reports DB success plus cleanup warning.

---

### Task 1: UI Guardrails

**Files:** `src/pages/Courses.jsx`, `src/styles.css`, `scripts/check-course-archive-delete-ui.mjs`

- [ ] Add failing static test for Archives location, confirmations, DELETE guard, duplicate delete guard, and Edge Function call.
- [ ] Implement UI state and modals.
- [ ] Verify static test passes.

### Task 2: RPC Migration

**Files:** `supabase/migrations/*_admin_course_permanent_delete.sql`, `scripts/check-course-permanent-delete-sql.mjs`

- [ ] Add failing static SQL safety test.
- [ ] Create migration with `supabase migration new`.
- [ ] Implement Admin-only archived-only transactional RPC and grants.
- [ ] Verify static SQL test passes.

### Task 3: Edge Function

**Files:** `supabase/functions/admin-delete-course/index.ts`, `scripts/check-course-delete-edge-function.mjs`

- [ ] Add failing static Edge Function security test.
- [ ] Implement user-scoped RPC call and privileged exact Storage API cleanup.
- [ ] Verify static Edge Function test passes.

### Task 4: Hosted Verification And Finish

- [ ] Verify linked project and migration alignment.
- [ ] Apply only the new migration.
- [ ] Run hosted safe verification, `supabase db lint --linked`, `npm.cmd test`, `npm.cmd run lint`, `npm.cmd run build`, `git diff --check`.
- [ ] Commit and push `main`.
