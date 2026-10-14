# Feature Workflows

## Exam Lifecycle

```text
Professor creates draft
  -> save_exam / local recovery snapshot
  -> optional selected-student assignments
  -> Unpublished or direct Published or Pending Review
  -> optional Cluster Professor review
  -> Student starts authorized exam
  -> environment scan and live monitoring
  -> submit_exam_attempt
  -> automatic/manual grading
  -> Professor reviews scores, evidence, reopen requests
  -> Dean reviews integrity/reporting pages
```

## Create/Edit Exam

Main file: `src/pages/professor/ProfessorCreateExam.jsx`.

The page loads professor-owned active courses, optional course periods, existing exam data for edit, questions, group metadata, start sessions/attempts, enrolled students, and selected assignments. Draft recovery uses local storage plus backend draft sync through `save_exam`. Questions support interactive types via `src/lib/examQuestionTypes.js`.

Single-course save/publish uses `save_exam`, `save_exam_assignments`, and `publish_exam`. Multi-course save/publish uses `save_exam_group` and `publish_exam_group` when group or multiple course selections are active.

## Professor Exam Management

Main file: `src/pages/professor/ProfessorExams.jsx`.

The page lists professor exams, group membership, reviews, course/enrollment context, lifecycle actions, archive/restore, permanent delete for archived exams, duplicate-to-course, and share-to-specific-student access. Grouped exams use `get_exam_group` and `transition_exam_group` for synchronized lifecycle actions.

## Cluster Review

Main files: `src/context/ClusterContext.jsx`, `src/pages/cluster/ClusterExamList.jsx`, `ClusterExamReview.jsx`, `supabase/functions/review-exam/index.ts`.

Cluster Professor views pending/approved/rejected exams. For grouped exams, the context collapses group members to one representative and the Edge Function calls `review_exam_group`, applying approval/rejection across all members after validating group consistency.

## Student Exam Taking

Main file: `src/pages/student/StudentExamTake.jsx`.

The student flow authorizes the exam, loads sanitized questions, starts a session, runs environment scan, starts camera/audio monitoring, records violations, persists local progress, uploads submitted files, and calls `submit_exam_attempt`. The page also manages fullscreen/interruption recovery and local recovery state.

Monitoring support:

- `src/hooks/useLiveAudioMonitoring.js` detects sustained loud audio and calls `uploadAudioViolation`.
- `src/services/audioViolationService.js` inserts `violations`, uploads clips to `audio-violations`, and updates rows with evidence metadata.
- `StudentExamTake.jsx` uploads snapshots to `proctor-snapshots` and can use local/Roboflow/endpoint detection paths.

## Grading And Reopen Requests

Professor grading lives in `src/pages/professor/ProfessorScores.jsx`. It loads exams, attempts, questions, enrollments, assignments, exceptions, start sessions, answers, and reopen requests. Manual grading calls `grade_exam_attempt_answer`. Reopen decisions call `review_exam_attempt_reopen_request`.

Student grade and reopen visibility lives in `src/pages/student/StudentGrades.jsx` and `src/pages/student/StudentCourse.jsx`. Reopen requests use `request_exam_attempt_reopen`.

## Dean Integrity Review

Dean pages are `src/pages/dean/DeanDashboard.jsx`, `DeanExamIntegrity.jsx`, shared `src/pages/Courses.jsx`, and `src/pages/Reports.jsx`. Dean reporting reads aggregate profiles/courses/exams/violations/attempts. Existing checks intentionally prevent eager evidence signing in Dean dashboard/reports.

## Shared Workflows

- Notifications: `useNotifications.js`, `NotificationBell.jsx`, `NotificationHistory.jsx`, `create_notification`, `mark_notification_read`, `mark_all_notifications_read`.
- Messaging: `MessageModal.jsx`, `LiveMessages.jsx`, role message pages, `messages` table and realtime channels.
- Profile/theme: `ProfileSettings.jsx`, `ThemeContext.jsx`, `ThemeSettings.jsx`, `profile-pictures` bucket.
- Security settings: `SecurityPrivacy.jsx`, `ActiveSessions.jsx`, `settingsSecurity.js`.

## Multi-Course Exam Publishing

Implemented repository pieces:

- Tables: `exam_publish_groups`, `exam_publish_group_members`.
- RPCs: `publish_exam_group`, `get_exam_group`, `save_exam_group`, `transition_exam_group`, `review_exam_group`.
- Guard: grouped member writes are blocked outside group actions through `guard_group_member_write` and `exam_private.group_write_context`.
- Frontend: `ProfessorCreateExam.jsx`, `ProfessorExams.jsx`, `ClusterContext.jsx`.
- Edge Function: `review-exam` detects group membership and calls `review_exam_group`.
- Checks: `scripts/check-multi-course-exams.mjs`, `supabase/local/multi-course-exam-runtime-tests.sql`.

Live deployment status is not confirmed in this audit.
