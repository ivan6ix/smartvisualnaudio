# Current Status And Roadmap

## Implemented From Repository Evidence

- Role-based React routes for Admin, Professor, Cluster Professor, Student, and Dean.
- Supabase Auth integration with profile-backed role mapping and demo-mode fallback when Supabase env is absent.
- Admin account/course/log/report pages and account Edge Function.
- Professor course/material/permit/exam/monitoring/score pages.
- Cluster Professor review pages and review Edge Function.
- Student dashboard, courses, resources, grades, messaging, exam taking, local recovery, monitoring, uploads, and submission.
- Dean dashboard, courses, reports, and integrity views.
- Notifications, messaging, profile settings, theme preferences, security/password/session UI.
- SQL migrations for exam lifecycle, scoring, selected-student assignments, reopen requests, notifications, audit logs, archive/delete safeguards, and multi-course exam groups.
- Script-based regression checks in `scripts/`.

## Partially Implemented Or Needs Verification

- Multi-course exam publishing is implemented in the working tree, but live migration/application status is unverified.
- SQL runtime fixtures exist, but this audit did not run a local Supabase database.
- Production Storage and RLS state cannot be confirmed without inspecting the hosted project.
- Monitoring integrations support multiple paths; production behavior depends on environment variables and proxy/endpoint deployment.

## Multi-Course Exam Publishing Status

Repository-confirmed:

- Publish-group tables exist in migration: `exam_publish_groups`, `exam_publish_group_members`.
- Membership relationship uses `group_id`, `exam_id`, `course_id`, unique member/course constraints, and restricted deletes.
- Multi-course publish RPC exists: `publish_exam_group`.
- Synchronized edit RPC exists: `save_exam_group`.
- Revision/idempotency protection exists through `request_key`, `request_payload`, `request_digest`, `revision`, advisory lock, and expected revision checks.
- Group lifecycle RPC exists: `transition_exam_group`.
- Cluster group review RPC exists: `review_exam_group`.
- Frontend integration exists in `ProfessorCreateExam.jsx`, `ProfessorExams.jsx`, `ClusterContext.jsx`, and `review-exam` Edge Function.
- Local SQL fixture exists: `supabase/local/multi-course-exam-runtime-tests.sql`.
- Source-level check exists: `scripts/check-multi-course-exams.mjs`.

Not confirmed:

- Hosted Supabase migration application.
- Local SQL fixture result in this audit.
- End-to-end browser behavior with real Supabase data.
- Commit/release state: current `git status` shows multi-course files as uncommitted/modified.

## Recommended Priorities

1. Stabilize and verify multi-course exam publishing in a local Supabase environment.
2. Remove production dependence on any frontend `VITE_ROBOFLOW_API_KEY`; use proxy/Edge Function only.
3. Verify hosted RLS policies, Storage policies, and applied migrations before deployment.
4. Add browser smoke tests for login/routing, professor exam publish, student exam start/submit, cluster review, and professor grading.
5. Reduce risk in `StudentExamTake.jsx` only when touching related behavior; extract tested helpers gradually.

## Work Requiring Approval

- Applying or rolling back Supabase migrations.
- Querying or modifying production data.
- Deploying Edge Functions or Vercel.
- Permanent deletion workflows.
- Force-pushes or history rewrites.
- Any change that alters exam status transitions, scoring, RLS, or monitoring evidence retention.
