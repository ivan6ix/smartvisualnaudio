# Smart Proctoring System - Project Context

This file is the handoff guide for future Codex sessions. It summarizes the current React/Supabase project, the live workflows, database expectations, recent changes, known bugs, and coding rules.

## Project Overview

Smart Proctoring System is a web-based academic course, exam, and proctoring platform.

The app supports these portals:

- Admin Portal: account management, dashboards, reports, courses, messages, notifications.
- Professor Portal: course management, period folders, modules, quizzes, exams, activities, permits, scores, monitoring.
- Cluster Professor Portal: exam approval/rejection before publishing.
- Student Portal: registration, course joining, course materials, exam taking, permits, resources, grades, messages.
- Dean Portal: view-only oversight of courses, reports, and integrity analytics.

The app is a Vite React SPA backed by Supabase Auth, Postgres, Storage, Row Level Security, and Edge Functions. Some demo/local fallback paths still exist, but the intended direction is live Supabase behavior.

## Tech Stack

- Frontend: React 18, Vite, JavaScript/JSX only.
- Routing: `react-router-dom`.
- Forms: controlled React state; `react-hook-form` is available.
- UI: custom components in `src/components/ui.jsx`.
- Icons: `react-icons/fi`.
- Charts: `recharts`.
- Toasts: `sonner`.
- Backend/BaaS: Supabase Auth, Postgres, Storage, RLS, Edge Functions.
- Proctoring/AI: MediaPipe Tasks Vision, TensorFlow.js, COCO-SSD, Roboflow Inference SDK.
- Local proxy: Express server in `server/roboflow-proxy.js`.
- Build/lint: Vite and ESLint.

Important scripts:

```bash
npm run dev
npm run roboflow-proxy
npm run lint
npm run build
```

## Folder Structure

```text
.
├── index.html
├── package.json
├── vite.config.js
├── eslint.config.js
├── tailwind.config.js
├── postcss.config.js
├── server/
│   └── roboflow-proxy.js
├── supabase/
│   ├── schema.sql
│   └── functions/
│       ├── create-account/
│       ├── environment-scan/
│       ├── review-exam/
│       └── send-password-reset/
└── src/
    ├── App.jsx
    ├── main.jsx
    ├── styles.css
    ├── components/
    │   ├── exam/
    │   │   └── AudioMonitoringTimeline.jsx
    │   ├── AccountSettingsModal.jsx
    │   ├── LiveMessages.jsx
    │   ├── MessageModal.jsx
    │   ├── TopNav.jsx
    │   └── ui.jsx
    ├── context/
    │   ├── AuthContext.jsx
    │   └── ClusterContext.jsx
    ├── data/
    ├── hooks/
    │   ├── useAdminNotifications.js
    │   ├── useLiveAudioMonitoring.js
    │   ├── useLocalStorageState.js
    │   └── useMessagePreview.js
    ├── lib/
    │   ├── examQuestionTypes.js
    │   └── supabase.js
    ├── routes/
    │   └── ProtectedRoute.jsx
    ├── services/
    │   └── audioViolationService.js
    └── pages/
        ├── admin/
        ├── cluster/
        ├── dean/
        ├── professor/
        └── student/
```

## Main Routes

Routes are defined in `src/App.jsx`.

Public/auth:

- `/login`
- `/register`
- `/forgot-password`
- `/reset-password`

Admin:

- `/`
- `/create-account`
- `/professors`
- `/deans`
- `/cluster-professors`
- `/courses`
- `/accounts`
- `/messages`
- `/notifications`
- `/security`
- `/reports`

Professor:

- `/professor`
- `/professor/courses`
- `/professor/courses/:courseId/:tab`
- `/professor/courses/:courseId/permits`
- `/professor/exams`
- `/professor/exams/create`
- `/professor/monitoring`
- `/professor/scores`
- `/professor/messages`
- `/professor/profile`

Student:

- `/student`
- `/student/resources`
- `/student/grades`
- `/student/messages`
- `/student/exams/:examId`
- `/student/courses/:courseId/:tab`

Cluster Professor:

- `/cluster`
- `/cluster/pending`
- `/cluster/approved`
- `/cluster/rejected`
- `/cluster/exams/:id`
- `/cluster/history`
- `/cluster/reports`
- `/cluster/messages`
- `/cluster/notifications`
- `/cluster/profile`

Dean:

- `/dean`
- `/dean/integrity`
- `/dean/courses`
- `/dean/reports`
- `/dean/profile`

## User Roles

Roles are stored in `public.profiles.role` using enum `public.user_role`.

- Admin: creates Professor, Dean, and Cluster Professor accounts; manages accounts, courses, reports, dashboards, messages, and notifications.
- Professor: manages assigned courses; creates periods, materials, quizzes, exams, activities, modules, permit requests; submits exams for cluster review; publishes approved exams; monitors violations and scores.
- Cluster Professor: reviews submitted exams and approves/rejects them. Rejected exams should be editable and resubmittable by professors.
- Student: registers with email confirmation, joins courses, views materials, takes published exams, uploads permits/resources, checks grades/messages.
- Dean: view-only oversight. Dean must not create, edit, assign, archive, approve, or reject records.

## Database Schema

Canonical schema is `supabase/schema.sql`. Apply it in Supabase SQL Editor after changes. If the app reports missing tables, missing columns, or schema cache errors, run the latest SQL and refresh/reload Supabase schema cache.

Important enums:

- `public.user_role`: `Admin`, `Professor`, `Dean`, `Cluster Professor`, `Student`
- `public.account_status`: `Active`, `Pending`, `Deactivated`
- `public.violation_type`: includes `MULTIPLE_FACE`, `NO_FACE`, `BACKGROUND_VOICE`, `TAB_SWITCH`, `COPY_ATTEMPT`, `FULLSCREEN_EXIT`, `LOOKING_AWAY`, `PHONE_DETECTED`, `GADGET_DETECTED`, `LOUD_NOISE_DETECTED`
- `public.violation_severity`: `Low`, `Medium`, `High`

Core tables:

- `profiles`: Supabase Auth profile mirror. Important fields include `id`, `role`, `full_name`, `email`, `employee_number`, `student_number`, `status`, `created_at`.
- `cluster_professors`: retained table from earlier design.
- `courses`: course catalog and professor ownership. Includes `course_name`, `course_code`, `section`, `joining_code`, `professor_id`, `archived`.
- `course_enrollments`: student-course joins, unique `(course_id, student_id)`.
- `messages`: direct messages.
- `notifications`: per-user notifications.
- `logs`: system/account activity logs.

Exam tables:

- `exams`: all quizzes, exams, and activities. Important fields include `course_id`, `title`, `description`, `professor_id`, `created_by`, `exam_type`, `semester`, `exam_settings`, `duration`, `status`, `submitted_at`, `approved_at`, `rejected_at`.
- `exam_questions`: stores question content and grading metadata. Supports `question_type`, `choices`, `correct_answer`, `correct_answers`, `question_config`, `manual_grading`, `points`.
- `exam_attempts`: student submissions. Expected fields include `score`, `earned_points`, `max_points`, `status`, `violations`, `started_at`, `submitted_at`.
- `exam_attempt_answers`: per-question answers. Expected fields include `answer`, `file_url`, `earned_points`, `max_points`, `is_correct`, `manual_grading`, grader metadata.
- `exam_reviews`: cluster review decision and remarks.
- `exam_approval_logs`: approval audit trail.
- `exam_rejection_logs`: rejection audit trail and reason.

Course material tables:

- `course_periods`: professor-created period folders such as Prelim, Midterm, Finals.
- `course_modules`: uploaded module files, with `period`, `file_path`, `file_size`, `mime_type`, `archived`.
- `course_permit_requests`: professor permit request with deadline.
- `course_permit_files`: student permit submissions.

Proctoring tables:

- `violations`: stores exam proctoring violations. Expected fields now include `exam_id`, `student_id`, `professor_id`, `course_id`, `violation_type`, `severity`, `description`, `screenshot_url`, `evidence_url`, `evidence_type`, `audio_level`, `created_at`.

Storage buckets:

- `exam-submissions`: private, 10MB, PDF/DOC/DOCX/JPG/PNG.
- `proctor-snapshots`: private, 5MB, JPG/PNG.
- `course-modules`: private, 25MB, PDF/DOC/DOCX/PPT/PPTX/JPG/PNG.
- `course-permits`: private, 10MB, PDF/DOC/DOCX/JPG/PNG.
- `audio-violations`: private, stores loud-noise audio evidence.

Important RLS notes:

- Students need insert access on their own `exam_attempts`.
- Students need insert access on their own `exam_attempt_answers`.
- Professors need read access to attempts, answers, violations, snapshots, and audio evidence for their own exams/courses.
- Admin, Dean, and Cluster Professor read policies support dashboards/reports.
- If errors appear such as `new row violates row-level security policy for table "exam_attempts"`, check the insert policy first.

## Authentication and Email

Auth is centralized in `src/context/AuthContext.jsx`.

- Login uses `supabase.auth.signInWithPassword` when Supabase env vars exist.
- Registration uses `supabase.auth.signUp`.
- Student registration metadata includes `full_name`, `student_number`, `role: Student`, and `status: Pending`.
- Admin account creation uses Edge Function `create-account`.
- Never expose service role keys in frontend `VITE_` variables.

Password reset now uses Brevo through Edge Function `send-password-reset`.

- `AuthContext.resetPassword` invokes `send-password-reset`.
- If the Edge Function fails, it falls back to Supabase `resetPasswordForEmail`.
- `ForgotPassword.jsx` handles sending reset links and updating passwords on `/forgot-password`.
- Reset callback parsing supports recovery hash tokens and PKCE `code`.
- Supabase Auth URL settings must allow `http://localhost:5173/forgot-password`.

Brevo/Supabase Edge Function secrets:

```bash
npx supabase@latest secrets set BREVO_API_KEY=...
npx supabase@latest secrets set BREVO_SENDER_EMAIL=ivancaburnay65@gmail.com
npx supabase@latest secrets set BREVO_SENDER_NAME="Smart Proctoring System"
npx supabase@latest secrets set SITE_URL=http://localhost:5173
```

Use a Brevo API key beginning with `xkeysib-`, not an SMTP key beginning with `xsmtpsib-`. If a real API key appears in chat or source, rotate/revoke it.

## Completed Features

Global:

- Shared top navigation per role portal.
- Profile dropdown and account/security modal flow.
- Live messaging modal and message previews.
- Bubble chat UI with sender styling, responsive width, date separators, and press/hold timestamp reveal.

Admin:

- Live dashboard cards for professors, students, courses, active exams, violations, and dean accounts.
- Live reports and account management.
- Admin can create Professor, Dean, and Cluster Professor accounts through Edge Function.
- Messaging and notifications pages are wired.

Professor:

- Live dashboard cards for courses, exams, published exams, and alerts.
- Live course cards and course detail pages.
- Period folders for materials.
- Quizzes, Exams, Activities, Modules, and Permit sections inside period folders.
- Module upload, preview/open, archive, restore.
- Permit request flow with student notifications and professor review page.
- Exams page with published, pending approval, and unpublished sections.
- Share modal for other courses/sections/students.
- Submit for Approval and Publish flow.
- Rejected exams can be edited and resubmitted.
- Create/Edit Exam supports multiple question types and exam settings.
- Scores page uses live courses and attempts.
- Monitoring Center lists violations, snapshots, and audio evidence when schema supports it.

Cluster Professor:

- Dashboard live cards for pending, approved, rejected, total reviews, reports, and messages.
- Recent activity is live.
- Approve/reject/review actions are wired.
- Approval logs and notifications should be created.
- Rejection logs/review remarks should allow professor edit/resubmit.

Student:

- Dashboard design matches professor/cluster style.
- Join Course modal is live.
- Notifications are live.
- Available exams show published exams from joined courses.
- Course materials mirror professor materials by period.
- Student permit upload flow works when professor has an active request.
- Resources page supports folders, uploads, previews, share/move/copy, archive/restore/delete, search.
- Student exam-taking page supports optional proctoring based on professor settings.
- Student grades are live from joined courses and submitted attempts.
- Completed exams remain visible in course materials with score/status and cannot be retaken.

Dean:

- Separate topbar-only layout.
- View-only dashboard, courses, reports, and exam integrity.
- No create/edit/assign/archive/approve/reject actions.

## Exam Settings Workflow

Professor exam settings are optional and should be saved exactly as selected:

- `requireEnvironmentScan`: if checked, student must complete environment scan before entering exam. If unchecked, student can start immediately.
- `liveCameraMonitoring`: if checked, camera is required and live camera monitoring runs. If unchecked, no camera requirement and no live camera dock.
- `liveAudioMonitoring`: if checked, microphone is required and live audio monitoring runs. If unchecked, no mic requirement and no audio monitoring UI.
- `captureSnapshots`: if checked, violations capture/upload snapshots. If unchecked, violations are recorded without snapshot upload.

Important implementation notes:

- `ProfessorCreateExam.jsx` saves `exam_settings`.
- `StudentExamTake.jsx` normalizes camelCase and snake_case setting names.
- `DEFAULT_EXAM_SETTINGS` is all false except randomization fields.
- If `exam_settings` is missing in Supabase, saving/loading should show a schema error instead of silently ignoring settings.

## Environment Scan

Environment scan no longer requires exact 180-degree motion.

Current validation goal:

- Capture center/front view.
- Capture left side.
- Capture right side.
- Analyze captured frames through Roboflow.
- Pass only if Roboflow succeeds and no forbidden gadget is detected.

Forbidden gadget labels:

- `phone`
- `tablet`
- `laptop`

Current behavior:

- Uses checkpoints: `CENTER_CAPTURED`, `LEFT_CAPTURED`, `RIGHT_CAPTURED`.
- Accepted scan orders include center-left-center-right, left-center-right, right-center-left.
- UI must not mention 180 degrees, rotation degrees, or angle validation.
- Progress uses real captured unique frames, not exact physical angle.
- Repeated same spot should not increase progress.
- Slow movement, small pauses, minor hand shake, and minor frame drops should be accepted.
- Minimum scan duration: 5 seconds.
- Maximum scan duration: 20 seconds.

Important constants in `StudentExamTake.jsx`:

- `CHECKPOINT_FRAMES_REQUIRED = 3`
- `MIN_UNIQUE_SCENE_DISTANCE = 26`
- `MIN_UNIQUE_VIEW_INTERVAL_MS = 650`
- `MIN_SCAN_DURATION_MS = 5000`
- `MAX_SCAN_DURATION_MS = 20000`

Roboflow environment scan endpoint resolution:

- Preferred: `VITE_ROBOFLOW_ENV_SCAN_ENDPOINT`
- Fallback: derive `/api/environment-scan` from `VITE_ROBOFLOW_PROXY_URL`

## Live Camera Proctoring

Implemented in `src/pages/student/StudentExamTake.jsx`.

Current detections:

- No face.
- Multiple faces.
- Looking away.
- Looking down/head down.
- Eye gaze down.
- Eye gaze left.
- Eye gaze right.
- Phone/tablet/laptop/gadget detected through Roboflow image polling/WebRTC workflow.

Notes:

- Gadget detection should alert immediately on detection, not wait 5 seconds.
- Cooldowns prevent repeated spam.
- Snapshots are uploaded only when `captureSnapshots` is enabled.
- Eye gaze thresholds should stay moderate; looking down/head-down sensitivity was intentionally increased.

Important current thresholds:

- `LOOKING_DOWN_LIMIT_MS = 1500`
- `EYE_GAZE_LIMIT_MS = 3000`
- Eye gaze horizontal threshold around `0.18`
- Eye gaze down threshold around `0.2`

## Live Audio Monitoring

Implemented files:

- `src/hooks/useLiveAudioMonitoring.js`
- `src/components/exam/AudioMonitoringTimeline.jsx`
- `src/services/audioViolationService.js`

Current behavior:

- Runs only when `liveAudioMonitoring` is enabled.
- Requires microphone access only when enabled.
- Uses Web Audio API RMS level analysis.
- Keeps a rolling local audio buffer.
- Uploads audio evidence only after sustained loud noise.
- Sends professor notification after a loud-noise violation.
- Falls back to `BACKGROUND_VOICE` if `LOUD_NOISE_DETECTED` enum is missing.

Important thresholds:

- Quiet: below `15`
- Moderate: `35`
- Loud: `65`
- Loud violation duration: `1500ms`
- Pre-event audio buffer: `10s`
- Loud-noise cooldown: `30000ms`

Expected Supabase support:

- `audio-violations` storage bucket.
- `violations.evidence_url`
- `violations.evidence_type`
- `violations.audio_level`
- `violations.description`
- `violations.professor_id`
- `violations.course_id`
- `violation_type` enum includes `LOUD_NOISE_DETECTED`

## Roboflow Proxy

File: `server/roboflow-proxy.js`

Endpoints:

- `GET /api/health`
- `POST /api/environment-scan`
- `POST /api/init-webrtc`

Server-only env vars:

```env
ROBOFLOW_API_KEY=
ROBOFLOW_PROXY_PORT=
ROBOFLOW_PROXY_ORIGIN=
ROBOFLOW_ENV_MODEL_ID=
ROBOFLOW_ENV_MODEL_VERSION=
ROBOFLOW_ENV_CONFIDENCE=
ROBOFLOW_ENV_API_BASE=
ROBOFLOW_ENV_INFER_URL=
```

Frontend-safe env vars:

```env
VITE_ROBOFLOW_PROXY_URL=
VITE_ROBOFLOW_ENV_SCAN_ENDPOINT=
VITE_ROBOFLOW_WORKSPACE=
VITE_ROBOFLOW_WORKFLOW_ID=
VITE_ROBOFLOW_STREAM_OUTPUTS=
VITE_ROBOFLOW_DATA_OUTPUTS=
VITE_ROBOFLOW_PLAN=
VITE_ROBOFLOW_REGION=
```

If the app shows `Proxy request failed (500): Internal error`, check the proxy console logs for `[RoboflowProxy]`.

## Important Workflows

Admin account creation:

1. Admin fills Create Account page.
2. Frontend invokes `create-account`.
3. Edge Function uses service role key server-side.
4. Profile is inserted/updated in Supabase.

Professor creates and publishes exam:

1. Professor selects course, exam type, period, semester, duration, deadline, status.
2. Professor selects exam settings.
3. Professor adds questions.
4. Draft exam is saved with `exam_settings`.
5. Professor submits for approval.
6. Cluster Professor approves or rejects.
7. Approved exam can be published.
8. Published exam appears to enrolled students.

Student takes exam:

1. Student opens published exam.
2. Existing submitted attempt is checked.
3. If already submitted, exam stays visible in materials but cannot be retaken.
4. If `requireEnvironmentScan` is true, scan must pass before start.
5. If camera/audio settings are true, browser permissions are requested.
6. Questions are answered and submitted.
7. Attempt and attempt answers are inserted.
8. Auto-graded scores are computed; manual questions remain pending.
9. Grades update in Student Grades and course materials.

Password reset:

1. User enters email on Forgot Password.
2. Frontend invokes `send-password-reset`.
3. Edge Function creates Supabase recovery link and sends it through Brevo.
4. User opens email link.
5. `/forgot-password` exchanges session tokens/code.
6. User sets new password.

## Known Bugs and Risks

- Workspace may not be a git repository; do not rely on git history/status.
- `supabase/schema.sql` is still a large source-of-truth SQL file. Some parts are not fully idempotent, especially enum creation. Convert to migrations when possible.
- Supabase schema cache errors are common after schema edits. Refresh schema cache/reload app after applying SQL.
- Common missing schema errors:
  - `Could not find the 'started_at' column of 'exam_attempts' in the schema cache`
  - `Could not find the table 'exam_attempt_answers' in the schema cache`
  - `column violations.evidence_url does not exist`
  - missing `exam_settings`
- RLS can block exam submissions if `exam_attempts` or `exam_attempt_answers` policies are missing.
- Roboflow WebRTC workflow can fail if deployed workflow output names are wrong.
- Laptop browsers usually do not expose useful gyro/orientation data; environment scan relies on visual frame coverage.
- AI proctoring can false-positive for gadgets, face count, looking down, and eye gaze. Tune with real webcam samples.
- File previews depend on signed URLs and browser-supported formats.
- Manual grading for essays/file uploads still needs a stronger professor UI and score recomputation flow.
- Brevo sender is verified, but Gmail/free-mail sender has DKIM/DMARC warnings. Production should use an authenticated domain.
- User has pasted real Brevo keys in chat before; rotate/revoke exposed keys.

## Pending Features

- Production-grade Supabase migrations instead of one large SQL file.
- Fully idempotent enum/table/column creation.
- More complete manual grading:
  - Professor grades essay/file upload answers.
  - Attempt score recomputation after manual grading.
  - Student grade updates after manual grading.
- More test coverage:
  - `src/lib/examQuestionTypes.js`
  - exam submission scoring
  - RLS-sensitive access
  - role navigation
  - proctoring setting combinations
- Pagination/virtualization for large tables and material lists.
- Dean reports/integrity dashboard scaling for large real datasets.
- Production monitoring/error logging.
- Better Roboflow recovery UX if proxy/model is unavailable.

## Key Files

- `src/App.jsx`: route map.
- `src/context/AuthContext.jsx`: login/register/reset/logout.
- `src/lib/supabase.js`: Supabase client and config detection.
- `src/lib/examQuestionTypes.js`: question types and grading.
- `src/pages/professor/ProfessorCreateExam.jsx`: create/edit exam and settings.
- `src/pages/professor/ProfessorExams.jsx`: exam status sections and approval actions.
- `src/pages/professor/ProfessorCourseDetail.jsx`: period materials, modules, permits entry.
- `src/pages/professor/ProfessorCoursePermits.jsx`: permit request/submission review.
- `src/pages/professor/ProfessorMonitoring.jsx`: violations, snapshots, audio evidence.
- `src/pages/student/StudentExamTake.jsx`: exam taking, proctoring, environment scan, submission.
- `src/pages/student/StudentCourse.jsx`: course materials and completed attempt display.
- `src/pages/student/StudentGrades.jsx`: live grades.
- `src/pages/student/StudentResources.jsx`: resources folders/files/archive/copy/search.
- `src/pages/cluster/ClusterDashboard.jsx`: approval dashboard.
- `src/pages/cluster/ClusterExamReview.jsx`: exam review UI.
- `src/hooks/useLiveAudioMonitoring.js`: mic monitoring.
- `src/components/exam/AudioMonitoringTimeline.jsx`: audio monitor UI.
- `src/services/audioViolationService.js`: audio evidence upload and violation insert.
- `server/roboflow-proxy.js`: local Roboflow proxy.
- `supabase/schema.sql`: database, RLS, storage buckets, functions.
- `supabase/functions/send-password-reset/index.ts`: Brevo password reset sender.

## Coding Rules

- Keep frontend files in JavaScript/JSX. Do not convert React files to TypeScript.
- Follow existing custom UI and CSS patterns.
- Use `react-icons/fi` for icons where available.
- Use `sonner` for toasts.
- Prefer live Supabase behavior, but preserve demo/local fallbacks where a page already has them.
- For schema-dependent features, handle missing-table/missing-column errors clearly.
- Keep role permissions aligned with RLS policies.
- Keep changes scoped to the requested feature.
- Do not hardcode real credentials, tokens, or API keys.
- Never put service role, Brevo, or Roboflow private keys in frontend `VITE_` variables.
- Use `apply_patch` for manual code edits.
- Do not revert user changes unless explicitly requested.
- After code changes, run:

```bash
npm run lint
npm run build
```

For documentation-only changes, lint/build is usually not required.
