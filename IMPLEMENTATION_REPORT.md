# Targeted implementation report

1. **UI:** Shared responsive portal navigation and theme switch; semantic topbar styling; bounded modal/table sizing; Cluster review backdrop dismissal. Existing normal-modal dismissal retained; critical proctoring dialogs were not made dismissible.
2. **Shared components:** PortalNav, NotificationPreview, SettingsSections, LegalLinks, notification hook, AuthContext, ClusterContext and local-state hook. Existing theme tokens retained.
3. **Cluster Professor:** Exact role remains "Cluster Professor". Review-only permissions preserved. Shared navigation, settings, notification previews/counts and persisted Mark All as Read apply. No exam-authoring rights added.
4. **Registration/policies:** Both unchecked agreements required by form and registration handler. Public project-specific policy pages linked from login/register/settings and marked for institutional review.
5. **Notifications/settings:** All roles use user-scoped notification queries and mutations with exact unread counts. Appearance, Notifications, and Privacy & Security are separated. Preview visibility is saved per user. Password page now calls Supabase instead of displaying a mock success.
6. **Archive/restore:** Existing course/module/student-resource archives retained. Exam archive/restore added using exam_settings.archived; no duplicate archive column. Server start authorization excludes archived exams and courses. Historical attempts/questions/evidence are protected from destructive exam changes.
7. **Exam edit:** Existing Create/Edit form reused for unpublished exams. Existing attempts are checked before loading questions; transactional save and database guards reject changes after starts/attempts. Direct form publication removed; edited content must follow review again. Description/instructions now persist in existing JSON settings while description column retains its existing period meaning.
8. **Scheduling:** Local date/time controls persist UTC startsAt/deadline. Student course controls show Scheduled/Available/Expired. authorize_exam_start checks database time, membership, role, publication and archive state. exam_start_sessions records server-authorized starts without changing the existing submitted-attempt model. Scheduled submissions require that record.
9. **Sessions:** Auth validates against Supabase, checks every 60 seconds, preserves refresh handling and skips redundant profile fetches on refresh. Invalid-session handling clears application query/profile state, remounts user-dependent providers and shows the requested expiration message. User-scoped exam recovery remains available. No inactivity cutoff was added during exams.
10. **Filters/limits:** Added exam Active/Archived/All, account status and Dean violation-type filters; existing course/type/period/monitoring/score/report filters retained. Limits include title 200, description 1000, instructions/question text 5000, choices/answers 2000, messages 4000, course name 160/code 32/section 40, name 120/identifiers 40, file name 255, duration 1?1440 and points >0?1000. Save-handler checks complement selected HTML limits/counters; SQL validates changed content without truncating existing values. This is targeted coverage, not a claim that every input was changed.
11. **Performance/indexes:** Shared notification queries replace duplicated layout fetches; Cluster data loading is limited to its role and notification changes no longer refetch its exam/question graph. Monitoring counts now use a single pass. Refresh events reuse profile data and exam saves invalidate affected cache. Existing performance-indexes.sql already covers notification user/date/unread, exam reviews, attempts and course ownership queries; no redundant secondary indexes added. The new start-session primary key (exam_id, student_id) supports authorization lookup and uniqueness. Live index catalog/EXPLAIN plans were unavailable.
12. **Migration:** supabase/migrations/20260910_exam_safety.sql; non-destructive rollback script in supabase/rollbacks/20260910_exam_safety.sql. RLS remains enabled, save/archive RPCs are invoker-security, and start authorization explicitly checks the authenticated student. Rollback retains start records. Apply only the forward migration; rollback is intentionally outside the migrations directory.
13. **Verified:** Production build; ESLint (zero errors/warnings); 130 existing theme assertions; 50 topbar layout/theme fixture cases; scheduling/input boundary tests; existing exam cutoff, submit guard, recovery, grading and media-cleanup regression checks. Build retains existing large-chunk warnings.
14. **Outstanding:** SQL has been reviewed but not executed: no PostgreSQL runner or connected DB tool was available. Deploy/test the migration in staging before using the new save/archive/start RPCs. Authenticated end-to-end role workflows, actual camera/microphone hardware, and every data-heavy page at every viewport were not verified. Institutional decisions remain: legal contact/retention/provider disclosures and review of policy text; retakes (the existing UI permits one completed submission despite configurable attempt labels); whether any post-start content edits should ever be permitted (currently blocked). No new Cluster Professor authoring permission was assumed.

## Files changed

- src/App.jsx
- src/components/AccountSettingsModal.jsx
- src/components/LiveMessages.jsx
- src/components/TopNav.jsx
- src/context/AuthContext.jsx
- src/context/ClusterContext.jsx
- src/hooks/useAdminNotifications.js
- src/hooks/useLocalStorageState.js
- src/pages/Accounts.jsx
- src/pages/Courses.jsx
- src/pages/Login.jsx
- src/pages/Notifications.jsx
- src/pages/Register.jsx
- src/pages/SecurityPrivacy.jsx
- src/pages/cluster/ClusterExamReview.jsx
- src/pages/cluster/ClusterLayout.jsx
- src/pages/cluster/ClusterProfile.jsx
- src/pages/dean/DeanExamIntegrity.jsx
- src/pages/dean/DeanLayout.jsx
- src/pages/professor/ProfessorCourseDetail.jsx
- src/pages/professor/ProfessorCreateExam.jsx
- src/pages/professor/ProfessorExams.jsx
- src/pages/professor/ProfessorLayout.jsx
- src/pages/professor/ProfessorMonitoring.jsx
- src/pages/student/StudentCourse.jsx
- src/pages/student/StudentExamTake.jsx
- src/pages/student/StudentLayout.jsx
- src/styles.css
- scripts/check-exam-validation.mjs
- scripts/check-portal-layout.mjs
- src/components/LegalLinks.jsx
- src/components/NotificationPreview.jsx
- src/components/PortalNav.jsx
- src/components/SettingsSections.jsx
- src/hooks/useNotificationPreference.js
- src/lib/examValidation.js
- src/pages/Legal.jsx
- supabase/migrations/20260910_exam_safety.sql
- supabase/rollbacks/20260910_exam_safety.sql
