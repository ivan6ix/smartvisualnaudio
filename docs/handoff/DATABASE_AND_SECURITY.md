# Database And Security

## Verification Scope

This audit confirmed database details from repository files only: `supabase/schema.sql`, `supabase/migrations/`, `supabase/local/`, and frontend/Edge Function call sites. The live hosted Supabase schema, applied migration list, data, advisors, and bucket configuration were not queried during this handoff.

## Core Tables

- Identity and roles: `profiles`, `cluster_professors`.
- Academic structure: `programs`, `courses`, `course_enrollments`, `course_periods`.
- Course content and permits: `course_modules`, `course_permit_requests`, `course_permit_files`, `student_resource_folders`, `student_resource_files`.
- Communication: `messages`, `notifications`, `notification_preferences`, `logs`.
- Exams: `exams`, `exam_questions`, `exam_reviews`, `exam_approval_logs`, `exam_rejection_logs`.
- Attempts and grading: `exam_attempts`, `exam_start_sessions`, `exam_attempt_answers`, `exam_attempt_reopen_requests`.
- Access control: `exam_student_assignments`, `exam_student_access_exceptions`.
- Monitoring: `violations`.
- Multi-course exams: `exam_publish_groups`, `exam_publish_group_members`, private helper table `exam_private.group_write_context`.

## Storage Buckets

Repository SQL defines or references:

- `profile-pictures`: public profile photo reads, owner writes.
- `exam-submissions`: student uploads, owner/professor reads.
- `proctor-snapshots`: student uploads, owner/professor/admin/dean reads.
- `audio-violations`: student uploads, owner/professor/admin/dean reads.
- `course-modules`: professor uploads, professor/student reads by course relationship.
- `course-permits`: student uploads, student/professor reads.
- `student-resources`: owner-managed private student files.

## Authentication And Role Source

The frontend authenticates with Supabase Auth and maps users through `profiles` in `AuthContext.jsx`. If profile loading fails, it can reuse cached user data or fall back to `authUser.user_metadata`. Treat `profiles.role` and server-side checks as authoritative; do not build new authorization on user-editable metadata.

Role layouts enforce client-side route checks, but security must remain in RLS/RPC/Edge Functions. Existing RPCs commonly verify `auth.uid()` and role from `profiles`.

## Important RPCs And Callers

- `save_exam`: `ProfessorCreateExam.jsx`; creates/updates draft and exam content.
- `publish_exam`: `ProfessorCreateExam.jsx`, `ProfessorExams.jsx`; publishes a single exam.
- `save_exam_assignments`: `ProfessorCreateExam.jsx`; selected-student access.
- `authorize_exam_start`, `get_student_exam_questions`, `submit_exam_attempt`: `StudentExamTake.jsx`.
- `grade_exam_attempt_answer`: `ProfessorScores.jsx`.
- `request_exam_attempt_reopen`: `StudentCourse.jsx`.
- `review_exam_attempt_reopen_request`: `ProfessorScores.jsx`.
- `create_notification`, `mark_notification_read`, `mark_all_notifications_read`: notification hooks and role workflows.
- `set_exam_archived`, `delete_archived_exam`: `ProfessorExams.jsx`.
- `grant_exam_student_exception`: `ProfessorExams.jsx`.
- `get_professor_ongoing_exams`: `ProfessorOngoingExams.jsx`.
- `admin_permanently_delete_course`: `admin-delete-course` Edge Function.
- Multi-course: `publish_exam_group`, `get_exam_group`, `save_exam_group`, `transition_exam_group`, `review_exam_group`.

## Edge Function Boundaries

- `create-account` uses service role server-side after verifying the caller with anon/user client and `profiles.role = Admin`.
- `send-password-reset` uses service role server-side and writes reset logs.
- `review-exam` validates the caller as Cluster Professor, then reviews single or grouped exams.
- `environment-scan` validates a Supabase user token before calling configured detection logic.
- `admin-delete-course` calls `admin_permanently_delete_course` and removes storage objects from the returned manifest.

## Confirmed Security Concerns

- `VITE_ROBOFLOW_API_KEY` is present in `.env.example` and read in `StudentExamTake.jsx`. Any real key assigned to a `VITE_` variable is bundled into the browser. Use the proxy or Edge Function path for private keys.
- `supabase/schema.sql` still contains broad baseline policies like `profiles_read_authenticated` and `exams_read_authenticated`. Later migrations include hardening, so verify the applied hosted schema before relying on baseline policy text.
- `AuthContext.jsx` uses `authUser.user_metadata` as fallback when the profile cannot be loaded. This keeps the app usable but should not be treated as authorization truth.
- Many functions are `SECURITY DEFINER`. Several include role checks and `set search_path`, but any new or modified definer function must explicitly validate `auth.uid()`/role and revoke public/anon execute where appropriate.

## Production Checklist

- Confirm applied migrations with Supabase CLI/MCP before release decisions.
- Run Supabase advisors on schema changes.
- Confirm every exposed `public` table has RLS enabled and scoped policies.
- Confirm Edge Function secrets exist only as Supabase/Vercel server-side secrets.
- Confirm Storage bucket policies match actual file path conventions.
- Do not expose service-role, Brevo, or Roboflow private keys through frontend variables.
