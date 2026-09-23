# Hosted Security Release Runbook

This runbook is for the coordinated hosted security release. Do not use `supabase db push --linked` for this repository state.

## Phase A - Pre-Deployment

1. READ ONLY: Verify Supabase project backup/PITR availability in the Supabase dashboard. Do not assume it exists.
2. READ ONLY: Run `hosted-security-precheck.sql` in the hosted Supabase SQL Editor.
3. READ ONLY: Confirm the final consolidated result has `deployment_readiness / blocking_conditions / PASS`.
4. READ ONLY: Run `hosted-security-backup-capture.sql` in the hosted Supabase SQL Editor.
5. LOCAL ONLY: Save the backup-capture output outside the database release files. This output is required to build a real rollback.
6. LOCAL ONLY: Confirm the frontend artifact to deploy includes the security-compatible files:
   - `src/pages/student/StudentExamTake.jsx`
   - `src/pages/student/StudentDashboard.jsx`
   - `src/services/audioViolationService.js`
   - `src/pages/professor/ProfessorCreateExam.jsx`
   - `src/pages/professor/ProfessorExams.jsx`
   - `src/pages/professor/ProfessorCoursePermits.jsx`
   - `src/context/ClusterContext.jsx`
7. LOCAL ONLY: Put the application into a short maintenance window. The old frontend and hardened database are not fully compatible, and the new frontend requires RPCs created by the database package.

## Phase B - Database Security Deployment

1. HOSTED MUTATION: In the hosted Supabase SQL Editor, run `hosted-security-deployment.sql` once.
2. HOSTED MUTATION: If the SQL editor reports any error, stop. Do not run partial follow-up SQL unless the error has been reviewed.
3. READ ONLY: Immediately run `hosted-security-postcheck.sql`.
4. READ ONLY: Confirm required functions, triggers, index, RLS state, narrowed policies, removed permissive policies, and grants match the expected state.

## Phase C - Frontend Deployment

1. FRONTEND DEPLOYMENT: Deploy the frontend release that includes the security-compatible files listed in Phase A.
2. FRONTEND DEPLOYMENT: Do not deploy unrelated unfinished feature work with this release.
3. FRONTEND DEPLOYMENT: Keep maintenance mode active until post-deployment checks and smoke tests pass.

## Phase D - Post-Deployment Verification

1. READ ONLY: Re-run `hosted-security-postcheck.sql` after frontend deployment.
2. READ ONLY: Confirm no `REQUIRED_MISSING`, failed presence checks, or removed-policy regressions appear.
3. FRONTEND DEPLOYMENT: Perform legitimate application smoke tests with dedicated/test accounts where possible.

Student smoke tests:
- Login.
- Dashboard loads.
- Join course where appropriate.
- Available exam loads.
- Sanitized exam questions load.
- Exam start works.
- Submit attempt works.
- Grades/history still load.

Professor smoke tests:
- Login.
- Courses load.
- Create/save exam.
- Direct publish.
- Submit for review.
- Exam sharing notification.
- Grading pages load.

Cluster Professor smoke tests:
- Login.
- Review workflow loads.
- Legitimate review action works.
- Unrestricted direct exam mutation remains unavailable.

Dean/Admin smoke tests:
- Dashboards/audit views load.
- Expected reports/history remain accessible.

Proctoring smoke tests:
- Legitimate violation insertion works.
- Audio violation metadata works.
- Screenshot/evidence flow remains intact where configured.

## Phase E - Rollback/Recovery If Needed

1. LOCAL ONLY: Use the saved output from `hosted-security-backup-capture.sql` to build a reviewed rollback SQL file.
2. LOCAL ONLY: Do not use `hosted-security-rollback.sql` as-is; it intentionally aborts until actual hosted definitions are pasted in.
3. HOSTED MUTATION: If rollback is approved, run only the reviewed rollback SQL.
4. FRONTEND DEPLOYMENT: Redeploy the previous frontend only if the rollback restores the old database security surface expected by that frontend.
5. READ ONLY: Re-run precheck/postcheck-style verification after rollback.

## Release Order

Use a short maintenance window:

1. READ ONLY: hosted precheck.
2. READ ONLY: hosted backup-capture.
3. HOSTED MUTATION: database security deployment.
4. READ ONLY: hosted postcheck.
5. FRONTEND DEPLOYMENT: security-compatible frontend.
6. READ ONLY/FRONTEND: postcheck plus smoke tests.
7. Reopen the application.
