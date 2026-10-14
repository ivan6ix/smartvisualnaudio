# System Overview

## Purpose

This repository implements a smart proctoring system for university exams. It combines role-specific dashboards, exam creation and approval, student exam taking, camera/audio monitoring, violation evidence, grading, messaging, notifications, course materials, and administrative reporting.

## Stack

- Frontend: React 18, Vite 5, React Router, React Query, Sonner, Recharts, Lucide/React Icons, custom CSS/Tailwind pipeline.
- Backend: Supabase Auth, PostgreSQL, RLS policies, RPC functions, triggers, Storage, Realtime, Edge Functions.
- Monitoring: browser camera/microphone APIs, MediaPipe, TensorFlow COCO-SSD, optional Roboflow endpoint/proxy, Supabase Storage for snapshots/audio evidence.
- Deployment: Vercel SPA rewrite in `vercel.json`; Supabase Edge Functions under `supabase/functions/`.

## Application Entry Points

- `src/main.jsx` mounts the React app and providers.
- `src/App.jsx` declares all routes and lazy page imports.
- `src/lib/supabase.js` creates the Supabase client from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- `src/context/AuthContext.jsx` owns session loading, profile mapping, demo-mode fallback, registration, login, logout, reset password, and cached user state.

## Role Architecture

- Admin uses root routes protected by `ProtectedRoute` and rendered inside `src/components/AppShell.jsx`.
- Professor uses `/professor/*` and `src/pages/professor/ProfessorLayout.jsx`.
- Cluster Professor uses `/cluster/*`, `src/pages/cluster/ClusterLayout.jsx`, and `src/context/ClusterContext.jsx`.
- Student uses `/student/*` and `src/pages/student/StudentLayout.jsx`.
- Dean uses `/dean/*` and `src/pages/dean/DeanLayout.jsx`.

Each role layout checks `hasLoggedInThisSession`, `user`, and exact role before rendering. Admin routes are grouped under `ProtectedRoute roles={["Admin"]}`.

## Main Modules

- Accounts and administration: `src/pages/People.jsx`, `src/pages/Accounts.jsx`, `src/pages/AdminLogs.jsx`, `src/pages/Courses.jsx`.
- Courses/materials: `src/pages/professor/ProfessorCourses.jsx`, `ProfessorCourseDetail.jsx`, `ProfessorCoursePermits.jsx`, `src/pages/student/StudentCourse.jsx`, `StudentResources.jsx`.
- Exam authoring and lifecycle: `ProfessorCreateExam.jsx`, `ProfessorExams.jsx`, `src/lib/examValidation.js`, `examAssignments.js`, `examQuestionTypes.js`, `examCompatibility.js`.
- Exam taking and monitoring: `StudentExamTake.jsx`, `src/hooks/useLiveAudioMonitoring.js`, `src/services/audioViolationService.js`.
- Grading/reopen requests: `ProfessorScores.jsx`, `StudentGrades.jsx`, `StudentCourse.jsx`, migrations for scoring and reopen requests.
- Review workflow: `ClusterContext.jsx`, cluster pages, `supabase/functions/review-exam/index.ts`.
- Notifications/messages: `src/hooks/useNotifications.js`, `useNotificationPreference.js`, `useMessagePreview.js`, `src/components/NotificationBell.jsx`, `MessageModal.jsx`, `LiveMessages.jsx`.
- Theme/profile/security settings: `ProfileSettings.jsx`, `SecurityPrivacy.jsx`, `ThemeContext.jsx`, `ThemeSettings.jsx`, `ActiveSessions.jsx`.

## Integrations

- Supabase Edge Functions:
  - `create-account`: admin account create/update/password actions.
  - `send-password-reset`: Brevo-backed password reset email with Supabase fallback in the client.
  - `review-exam`: cluster review, including grouped exam review support.
  - `environment-scan`: authenticated scan endpoint wrapper.
  - `admin-delete-course`: admin permanent course deletion plus storage cleanup manifest processing.
- Local Roboflow proxy: `server/roboflow-proxy.js`.
- Vercel: `vercel.json` rewrites all app paths to `index.html` and caches `/assets/*`.

## Verification Surface

The project has many script-based regression checks in `scripts/` and an aggregate `npm.cmd test`. It also has SQL runtime fixtures under `supabase/local/` and one SQL test under `supabase/tests/`. These are not a full browser or database test suite, but they protect important helper, UI-source, and migration invariants.
