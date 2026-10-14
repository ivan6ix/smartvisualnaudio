# Claude Handoff

Smart Proctoring Through Audio & Visual Monitoring is a React/Vite university proctoring system backed by Supabase Auth, PostgreSQL/RLS, Storage, Realtime channels, and Edge Functions. It supports five roles: Admin, Professor, Cluster Professor, Student, and Dean.

Before changing behavior, inspect the existing implementation and migrations for the exact workflow being touched. Many features are enforced jointly by React pages, Supabase RLS, RPCs, triggers, and Edge Functions; do not rely on old docs alone.

## Quick Map

- App entry: `src/main.jsx`, `src/App.jsx`
- Auth/session: `src/context/AuthContext.jsx`, `src/routes/ProtectedRoute.jsx`, `src/lib/supabase.js`
- Shared shell/UI: `src/components/`, `src/styles.css`, `src/context/ThemeContext.jsx`
- Professor exam lifecycle: `src/pages/professor/ProfessorCreateExam.jsx`, `src/pages/professor/ProfessorExams.jsx`, `src/pages/professor/ProfessorScores.jsx`
- Student exam taking/monitoring: `src/pages/student/StudentExamTake.jsx`, `src/hooks/useLiveAudioMonitoring.js`, `src/services/audioViolationService.js`
- Cluster review: `src/context/ClusterContext.jsx`, `src/pages/cluster/`, `supabase/functions/review-exam/index.ts`
- Dean reporting: `src/pages/dean/`, `src/pages/Reports.jsx`
- Database baseline and migrations: `supabase/schema.sql`, `supabase/migrations/`
- Edge Functions: `supabase/functions/create-account`, `send-password-reset`, `review-exam`, `environment-scan`, `admin-delete-course`

## Development Commands

- Install: `npm.cmd install`
- Dev server: `npm.cmd run dev`
- Roboflow proxy: `npm.cmd run roboflow-proxy`
- Tests/check scripts: `npm.cmd test`
- Lint: `npm.cmd run lint`
- Build: `npm.cmd run build`

## Rules

- Do not put service-role, Brevo, Roboflow private, or other secret keys in frontend `VITE_` variables.
- Do not apply migrations, touch production data, deploy, or force-push without explicit approval.
- Treat `supabase/schema.sql` as a baseline and `supabase/migrations/` as the source of newer feature work; verify live schema separately before production decisions.
- Preserve unrelated uncommitted changes. This checkout may include in-progress multi-course exam work.

Detailed handoff docs are in `docs/handoff/`:

- `SYSTEM_OVERVIEW.md`
- `FILE_MAP.md`
- `DATABASE_AND_SECURITY.md`
- `FEATURE_WORKFLOWS.md`
- `AUDIT_FINDINGS.md`
- `CURRENT_STATUS_AND_ROADMAP.md`
- `DEVELOPMENT_RUNBOOK.md`
