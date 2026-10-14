# File Map

## Routing

| Area | Routes | Main files |
| --- | --- | --- |
| Public/auth | `/landing`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/privacy`, `/terms`, `/storage` | `src/App.jsx`, `src/pages/Login.jsx`, `Register.jsx`, `ForgotPassword.jsx`, `ResetPassword.jsx`, `Legal.jsx`, `src/components/landing/*` |
| Admin | `/`, `/create-account`, `/professors`, `/deans`, `/cluster-professors`, `/courses`, `/accounts`, `/admin/logs`, `/messages`, `/notifications`, `/profile`, `/security`, `/reports` | `src/routes/ProtectedRoute.jsx`, `src/components/AppShell.jsx`, `src/pages/Dashboard.jsx`, `People.jsx`, `Courses.jsx`, `Accounts.jsx`, `AdminLogs.jsx`, `Messages.jsx`, `Reports.jsx` |
| Professor | `/professor`, `/professor/courses`, `/professor/courses/:courseId/:tab`, `/professor/courses/:courseId/permits`, `/professor/exams`, `/professor/exams/create`, `/professor/monitoring`, `/professor/scores/*` | `src/pages/professor/*` |
| Cluster Professor | `/cluster`, `/cluster/pending`, `/cluster/approved`, `/cluster/rejected`, `/cluster/exams/:id`, `/cluster/history`, `/cluster/reports`, `/cluster/messages`, `/cluster/notifications` | `src/pages/cluster/*`, `src/context/ClusterContext.jsx` |
| Student | `/student`, `/student/resources`, `/student/grades`, `/student/messages`, `/student/notifications`, `/student/exams/:examId`, `/student/courses/:courseId/:tab` | `src/pages/student/*` |
| Dean | `/dean`, `/dean/integrity`, `/dean/courses`, `/dean/reports`, `/dean/notifications` | `src/pages/dean/*`, shared `Courses.jsx`, `Reports.jsx` |

## Feature Navigation

| Feature | Main files | Backend/RPC/storage |
| --- | --- | --- |
| Auth/session | `src/context/AuthContext.jsx`, `src/lib/supabase.js`, `src/routes/ProtectedRoute.jsx` | `profiles`, Supabase Auth, `send-password-reset` Edge Function |
| Account management | `src/pages/People.jsx`, `src/pages/Accounts.jsx` | `create-account` Edge Function, `profiles`, `cluster_professors`, `logs` |
| Course administration | `src/pages/Courses.jsx`, `src/lib/coursePrograms.js`, `src/lib/courseOwnership.js` | `courses`, `programs`, `course_enrollments`, admin course RPCs |
| Course materials | `ProfessorCourseDetail.jsx`, `StudentCourse.jsx` | `course_periods`, `course_modules`, `course-modules` bucket |
| Course permits | `ProfessorCoursePermits.jsx`, `StudentCourse.jsx` | `course_permit_requests`, `course_permit_files`, `course-permits` bucket |
| Exam creation/edit | `ProfessorCreateExam.jsx`, `src/lib/examValidation.js`, `examAssignments.js`, `examQuestionTypes.js` | `save_exam`, `save_exam_assignments`, `publish_exam_group`, `save_exam_group` |
| Professor exam list | `ProfessorExams.jsx` | `exams`, `exam_questions`, `exam_reviews`, `publish_exam`, `transition_exam_group`, `set_exam_archived`, `delete_archived_exam`, `grant_exam_student_exception` |
| Student exam taking | `StudentExamTake.jsx` | `authorize_exam_start`, `get_student_exam_questions`, `submit_exam_attempt`, `exam-submissions`, `proctor-snapshots`, `audio-violations` |
| Monitoring | `ProfessorMonitoring.jsx`, `ProfessorLayout.jsx`, `useLiveAudioMonitoring.js`, `audioViolationService.js` | `violations`, Storage signed URLs, realtime channels |
| Grading | `ProfessorScores.jsx`, `StudentGrades.jsx`, `StudentCourse.jsx` | `exam_attempts`, `exam_attempt_answers`, `grade_exam_attempt_answer`, `request_exam_attempt_reopen`, `review_exam_attempt_reopen_request` |
| Cluster review | `ClusterContext.jsx`, `ClusterExamList.jsx`, `ClusterExamReview.jsx` | `review-exam` Edge Function, `exam_reviews`, `review_exam_group` |
| Dean reporting | `DeanDashboard.jsx`, `DeanExamIntegrity.jsx`, `Reports.jsx` | `profiles`, `courses`, `exams`, `violations`, `exam_attempts` |
| Notifications | `useNotifications.js`, `NotificationBell.jsx`, `NotificationHistory.jsx` | `notifications`, `notification_preferences`, `mark_notification_read`, `mark_all_notifications_read`, `create_notification` |
| Messages | `MessageModal.jsx`, `LiveMessages.jsx`, role message pages | `messages`, realtime channels |
| Theme/profile | `ThemeContext.jsx`, `ProfileSettings.jsx`, `ThemeSettings.jsx` | `profiles`, `profile-pictures` bucket |

## Important SQL Files

- Baseline schema: `supabase/schema.sql`
- Security/RLS hardening: `supabase/migrations/20260922103000_security_rls_hardening.sql`
- Exam lifecycle reconciliation: `20260922093000_reconcile_exam_lifecycle.sql`
- Scoring: `20260926130000_scoring_foundation.sql`, `20260928150000_partial_match_scoring.sql`
- Interruption/reopen/access: `20260926120000_exam_interruption_limit.sql`, `20260928170000_exam_attempt_reopen_requests.sql`, `20260928190000_selected_student_assignments.sql`
- Notifications/audit: `20260929022022_admin_audit_logs.sql`, `20260929023407_audit_exam_lifecycle_triggers.sql`, `20260930132313_feature_9_notifications.sql`
- Multi-course exams: `20261010142803_multi_course_exam_groups.sql`, `supabase/local/multi-course-exam-runtime-tests.sql`

## Relevant Tests/Checks

- Aggregate: `npm.cmd test`
- Multi-course source check: `scripts/check-multi-course-exams.mjs`
- Exam assignment/source checks: `scripts/check-exam-assignment-helpers.mjs`, `check-exam-validation.mjs`, `check-interactive-question-*`
- Monitoring checks: `check-exam-violation-limit.mjs`, `check-monitoring-performance-helpers.mjs`, `check-violation-*`
- SQL fixtures: `supabase/local/*runtime*.sql`, `supabase/tests/latest_attempt_uuid_selection.sql`
