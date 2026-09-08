# Theme consistency audit

The existing ThemeProvider still controls `data-theme` / `data-appearance` and persisted appearance. `src/styles.css` owns the palette; Tailwind semantic utilities and chart settings reference those same variables. No routes, data access, calculations, or layout dimensions were changed.

Source coverage:

- Admin: dashboard, professors/dean creation (People), courses, accounts, reports/log views, notifications, messages, profile/security and settings.
- Professor: dashboard, courses and detail tabs (materials/exams/members), permits, exams/create/share, monitoring, scores/analytics, messages, profile and settings.
- Student: dashboard/available/completed exams, courses and tabs, exam-taking/environment checks, resources, grades, messages, profile and settings.
- Dean: dashboard, integrity, shared courses/reports/profile, notification menus and messaging/settings modals. Approvals, exam review, history and separate notification pages exist under the Cluster portal; these were included in the stylesheet audit. No nonexistent Dean routes were added.
- Shared: navigation, cards, buttons, forms/search/selects, tables, modal content (including avatar cropping), messages, badges, loading/empty states, charts and scrollbars. Toasts now receive the active theme.

Underlying neutral surface, border and text declarations now reference tokens instead of requiring more Light Mode overrides. Informational badges inherit readable text; generic badge rules exclude semantic statuses. Chart grid/tooltip/cursor colors use CSS tokens. Auth forms use semantic Tailwind colors and tokenized autofill styling.

Intentional colors retained: success/warning/error and approval statuses, chart series and material category colors, branding/illustration colors, camera/image preview backgrounds, modal backdrops and shadows. Dark scrollbar rules were preserved; Light Mode retains the requested global gray scrollbar palette.

Validation: production build; 130 Chromium computed-style assertions across five layout shells in both themes (`node scripts/check-theme.mjs`, optional browser executable argument); unchanged layout/sizing declarations checked against the starting stylesheet. The browser check uses local component fixtures, not authenticated routes. Full authenticated visual interaction coverage remains unverified. Existing ESLint errors in AccountSettingsModal, LiveMessages and ProfessorCreateExam and unused imports in role layouts are unrelated to this refactor.
