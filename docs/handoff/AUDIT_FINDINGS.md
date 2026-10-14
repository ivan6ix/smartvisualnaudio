# Audit Findings

## P0 Critical

No confirmed P0 issue was found from repository-only review. Live Supabase schema/data and production environment variables were not inspected.

## P1 High

### P1: Frontend Roboflow API Key Exposure Risk

- Affected feature: Student monitoring/environment scan.
- Evidence: `.env.example` defines `VITE_ROBOFLOW_API_KEY`; `src/pages/student/StudentExamTake.jsx` reads `import.meta.env.VITE_ROBOFLOW_API_KEY` for direct Roboflow calls.
- Risk: Any real private key configured as `VITE_ROBOFLOW_API_KEY` is bundled into browser JavaScript.
- Recommended fix: Remove direct private-key frontend use for production. Use `server/roboflow-proxy.js`, `VITE_ROBOFLOW_ENV_SCAN_ENDPOINT`, or an authenticated Edge Function with server-side `ROBOFLOW_API_KEY`.
- Status: Confirmed configuration/code risk; production exposure depends on deployed env values.

### P1: Live Database Security Cannot Be Assumed From Baseline Schema

- Affected feature: Database/RLS.
- Evidence: `supabase/schema.sql` contains broad `profiles_read_authenticated` and `exams_read_authenticated`; later migrations such as `20260922103000_security_rls_hardening.sql` harden exam access.
- Risk: If a hosted database was initialized from baseline only or migrations are partially applied, authenticated users may have broader read access than intended.
- Recommended fix: Verify hosted applied migrations, inspect `pg_policies`, and run Supabase advisors before production use.
- Status: Requires live verification.

## P2 Moderate

### P2: Auth Metadata Fallback Can Confuse Authorization Reasoning

- Affected feature: Auth/session and route decisions.
- Evidence: `src/context/AuthContext.jsx` maps role/status from `profiles` when loaded, but falls back to `authUser.user_metadata` or cached previous user if profile loading fails.
- Risk: Client-side UI may route/render based on stale or user-editable metadata when profile lookup fails. Server RLS/RPCs still need to be the source of truth.
- Recommended fix: Keep server-side role checks authoritative. Consider forcing logout or limited safe state when profile loading fails in production.
- Status: Confirmed behavior.

### P2: Multi-Course Exam Work Exists In Working Tree But Live Application Status Is Unknown

- Affected feature: Multi-course exam publishing and synchronized editing.
- Evidence: Migration `20261010142803_multi_course_exam_groups.sql`, source check `scripts/check-multi-course-exams.mjs`, and frontend changes are present; `git status` shows these files are uncommitted or modified.
- Risk: Documentation or future work may assume the feature is deployed when it may only exist locally.
- Recommended fix: Before release or continuation, confirm migration list, run local SQL fixture, run `npm.cmd test`, lint, build, then commit/review as one feature branch.
- Status: Confirmed repository state; live status unverified.

### P2: Limited End-To-End Test Coverage

- Affected feature: Whole app, especially exam taking and monitoring.
- Evidence: `package.json` test script runs source/helper checks, not a browser E2E suite or live database integration suite.
- Risk: Complex flows involving media permissions, Storage uploads, realtime, RPC transactions, and Edge Functions can regress without detection.
- Recommended fix: Add Playwright smoke tests for role routing and critical workflows, and run SQL fixtures against local Supabase before releases.
- Status: Confirmed test shape.

## P3 Minor

### P3: Large Monolithic Student Exam Component

- Affected feature: Student exam taking and monitoring.
- Evidence: `src/pages/student/StudentExamTake.jsx` contains exam loading, scan logic, media detection, violation persistence, file upload, interruption handling, rendering, and submission.
- Risk: Harder maintenance and higher regression risk.
- Recommended fix: Extract carefully only when changing behavior for a feature or bug; do not refactor gratuitously.
- Status: Confirmed maintainability concern.

### P3: Documentation Was Split Across Historical Context Files

- Affected feature: Developer onboarding.
- Evidence: Existing docs include `README.md`, `PROJECT_CONTEXT.md`, `IMPLEMENTATION_REPORT.md`, `THEME_AUDIT.md`, and `docs/superpowers/*`.
- Risk: Future agents may follow stale plans unless they check implementation.
- Recommended fix: Use this `docs/handoff/` set and `CLAUDE.md` as the entry point; keep detailed docs updated when features land.
- Status: Confirmed.
