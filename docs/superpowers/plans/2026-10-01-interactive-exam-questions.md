# Interactive Exam Questions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build stable-ID dynamic choices, visual matching, and exact-set Drag and Drop across professor authoring, student taking, and server scoring.

**Architecture:** Add focused normalization/scoring helpers in `src/lib/examQuestionTypes.js`, wire professor and student pages to those helpers, and ship one forward Supabase migration for sanitizer/scoring parity. Keep existing JSON columns and legacy formats.

**Tech Stack:** React 18, Vite, Node assertion scripts, Supabase Postgres PL/pgSQL.

**Spec:** `docs/superpowers/specs/2026-10-01-interactive-exam-questions-design.md`

## Global Constraints

- No answer keys in student RPC payloads.
- No service-role secrets in frontend.
- No applied migration edits.
- No destructive production test data.
- Preserve existing Partial Match semantics.
- Stable IDs must survive draft save, refresh, edit, randomization, and submission.

## Review Focus

- Legacy `choices` arrays with strings or `{ key, value }` objects normalize without changing visible labels.
- Removing a correct choice clears invalid correct-answer references.
- Matching right-side distractors do not block publish/review.
- Student randomization never changes answer identity.
- Drag and Drop exact-set grading treats different order as correct and missing/extra/wrong selections as zero.

---

### Task 1: Stable Question Helpers

**Files:**
- Modify: `src/lib/examQuestionTypes.js`
- Test: `scripts/check-interactive-question-helpers.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `normalizeChoiceItems`, `createChoiceItem`, `normalizeQuestionForEditing`, `buildQuestionStorage`, `sanitizeQuestionForStudent`, `connectMatchingItems`, `gradeAnswer`

- [ ] Write failing helper tests for legacy choice normalization, dynamic add/remove IDs, matching one-to-one reconnect, drag/drop exact-set scoring, and sanitizer privacy.
- [ ] Run `node scripts/check-interactive-question-helpers.mjs` and verify RED.
- [ ] Implement helper functions in `src/lib/examQuestionTypes.js`.
- [ ] Run the helper test and verify GREEN.

### Task 2: Professor Editor

**Files:**
- Modify: `src/pages/professor/ProfessorCreateExam.jsx`
- Modify: `src/pages/professor/ProfessorExams.jsx`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: Saved questions using stable IDs and valid storage config.

- [ ] Add tests/static checks for `Drag and Drop`, dynamic add/remove buttons, and stable-ID helper usage.
- [ ] Wire question drafts through `normalizeQuestionForEditing`.
- [ ] Add dynamic choice add/remove controls.
- [ ] Replace matching pair editor with independent left/right lists and connection controls.
- [ ] Add Drag and Drop editor and validation.
- [ ] Ensure stored payloads use `buildQuestionStorage`.

### Task 3: Student Interactions

**Files:**
- Modify: `src/pages/student/StudentExamTake.jsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: normalized public question config and stable answer IDs.
- Produces: submitted answers using IDs only.

- [ ] Add tests/static checks for no answer-key rendering, matching pointer/tap handlers, drag/drop answer arrays, and randomization by ID.
- [ ] Normalize questions after RPC load.
- [ ] Render Matching Type with left/right item IDs, pointer drag, tap fallback, one-to-one reconnect, and responsive SVG lines.
- [ ] Render Drag and Drop with pointer/tap movement between available and answer area.
- [ ] Keep proctoring listeners untouched.

### Task 4: Supabase Migration

**Files:**
- Create: `supabase/migrations/<timestamp>_interactive_question_types.sql`
- Test/Verify: hosted-safe SQL checks.

**Interfaces:**
- Produces: updated `sanitize_student_question_config`, `grade_exam_answer`, and grants.

- [ ] Verify linked project `bclpbgjpkunphiisbdym` and migration alignment.
- [ ] Create migration with `supabase migration new interactive_question_types`.
- [ ] Update sanitizer to strip answer keys and expose only public config.
- [ ] Update grading for stable IDs, legacy fallback, Matching partial match, and Drag and Drop exact-set.
- [ ] Run safe hosted runtime checks with temporary inserted test data only.
- [ ] Run `supabase db lint --linked`.

### Task 5: Final Verification

**Files:**
- Review all changed files.

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: committed and pushed `main`.

- [ ] Run `npm.cmd test`.
- [ ] Run `npm.cmd run lint`.
- [ ] Run `npm.cmd run build`.
- [ ] Run `git diff` and `git diff --check`.
- [ ] Stage only related files.
- [ ] Commit `feat: enhance interactive exam questions`.
- [ ] Push `main`.
