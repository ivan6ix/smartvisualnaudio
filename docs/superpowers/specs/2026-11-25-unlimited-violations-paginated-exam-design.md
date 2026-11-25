# Unlimited violations, paginated exam, and per-question review

Date: 2026-11-25. Size: project. Status: awaiting approval.

## Why

Panelist recommendation. Today an exam auto-submits at 5 violations, which punishes students for things that are
often not cheating (a loud room, a camera glitch). Instead, the exam should never end because of violations; every
violation should say **which question** the student was on ("Loud audio detected · Number 5"), and the professor
decides afterwards whether it was cheating. If it was, the professor lowers the points of that question.

## Goals

1. No violation limit: violations never lock or auto-submit an exam. Number of exam **attempts** is unchanged.
2. The exam is taken **one question per page** with free navigation, so the question on screen is exactly the
   question a violation belongs to.
3. Every violation recorded during an exam stores the question it happened on (id and number).
4. Professors see the question number wherever violations are listed, and on the attempt review page can lower
   (or set) the points of a flagged question with a short note recording why.

## Non-goals

- No change to the **interruption limit** (technical disconnects/recoveries, separate from violations; it can still
  auto-submit as today).
- No change to how violations are detected, their types, severities, evidence snapshots or audio levels.
- No change to the existing "Randomize question order per student" option; no forward-only navigation, no time
  limit per question.
- No automatic penalties: the system never deducts points by itself.
- No change to how existing (old) attempts that were auto-submitted at 5 violations are stored or displayed.

## Anti-goals

- A violation must never be attached to the wrong question.
- Moving between questions must never lose an answer.
- The student must not be told that a professor might deduct points in a way that reads as an accusation; the
  message stays neutral ("recorded for your professor's review").

## Decided with Ivan

- "Unlimited" means unlimited **violations**; attempts stay as configured.
- Deduction is **per question** (Approach A): the professor overrides that question's points.
- The exam becomes **paginated, one question per page**, with **free navigation** (numbered buttons, Previous/Next,
  answers editable until submit).
- Students **see the professor's adjustment note** on their grades page.
- The question number is stored in **new columns on `violations`** (Approach A for storage), via a hosted migration,
  and the same migration adds a note to the override.
- Correction found by the builder check: professors **can** turn on "Randomize question order per student", so a
  student's on-screen number can differ from the professor's. Ruling (Claude's call, see §3): the stored and
  professor-facing number is the **professor's numbering**; the student's toast uses the number on the student's
  screen; badges attach by `question_id`, which is always exact.

## Approaches considered

Deduction:
- **A. Override the flagged question's points with a note (chosen).** Tied to the question the violation names.
- B. A separate deduction on the whole attempt. More flexible, not tied to a question.

Finding the current question:
- **Paginated exam (chosen).** Exact: the question on screen is the current question.
- Scrolling page with last-interacted / most-visible question. No layout change, but guesses when two questions are
  half visible.

Storing the question:
- **A. `violations.question_id` + `violations.question_number` columns (chosen).** Links a violation to an answer,
  so the override can sit next to it.
- B. Number written only into the description text. No migration, but cannot be linked to an answer.

## Design

### 1. Remove the violation limit (student exam page)

Files: `src/lib/examViolationLimit.js`, `src/pages/student/StudentExamTake.jsx`.

- Remove `EXAM_VIOLATION_LIMIT` behaviour: no lock, no auto-submit, no "violation_limit" submission, no limit-reached
  screen ("Retry Submission" for `violation_limit`), and detectors no longer stop after 5 (every check that reads
  `violationLimitReachedRef` drops that condition).
- Counters show the count only: header subtitle "Violations: 7", proctor stat "7" (no "/ 5"); the "urgent" style is
  dropped (no limit to approach).
- Each new violation shows a neutral toast: "Loud audio detected on question 5. It is recorded for your professor's
  review." (type label + question number).
- `violationWarning` is replaced by that message builder; `mergeAttemptViolations`, `violationKey` and
  `createIncidentTracker` stay.
- The database keeps accepting `submission_reason = 'violation_limit'` so old attempts still read correctly; new
  attempts never use it.

### 2. Paginated exam with free navigation

File: `src/pages/student/StudentExamTake.jsx` (+ styles in `src/styles.css`).

```
 Question 5 of 20                                  Violations: 2
 ┌───────────────────────────────────────────────────────────┐
 │  (the existing question rendering, one question)            │
 └───────────────────────────────────────────────────────────┘
 [1][2][3][4][■5][6][7] ... [20]     answered = filled, current = outlined
        [ ◀ Previous ]   [ Next ▶ ]      (on the last question: [ Submit Exam ])
```

- One question per page, rendered by the existing `renderQuestion`; all question types keep working (multiple
  choice, true/false, identification, matching, essay, file upload, etc.).
- State `currentIndex` (0-based). Previous/Next move by one; a numbered navigator jumps anywhere. Buttons show
  answered (filled) vs unanswered and the current question (outlined). Violations are **not** shown on the navigator
  (the student is not shown which question was flagged).
- Answers are kept exactly as today (same state, same autosave/local progress). `currentIndex` is added to the saved
  progress so a refresh or recovery returns to the same question.
- The header "Submit Exam" button stays available on every page (as today). Submitting with unanswered questions
  first shows a confirmation listing their numbers ("Questions 3, 9 and 14 are unanswered. Submit anyway?").
- The last question also shows a "Submit Exam" button in place of Next.
- Keyboard: navigator buttons are real buttons with `aria-current` on the current one and `aria-label`
  "Question N, answered/unanswered". Moving to a question moves focus to the question heading.
- Narrow screens: the navigator wraps onto several rows; no horizontal page scroll.

### 3. Store the question on each violation

Migration (hosted, with precheck/postcheck, Ivan's OK required):

```sql
alter table public.violations
  add column if not exists question_id uuid references public.exam_questions(id) on delete set null,
  add column if not exists question_number integer check (question_number is null or question_number > 0);
create index if not exists violations_attempt_question_idx on public.violations (exam_id, student_id, question_id);
```

- `persistViolation` adds `question_id` (the question on screen) and `question_number`, captured **at the moment the
  violation is detected** (the same moment its timestamp is taken), not when the insert finishes.
- `question_number` is the question's position in the **professor's order** (rank by `sort_order`, 1-based, the
  same numbering the professor's attempt review shows), not the student's page index. On exams with "Randomize
  question order per student" the two differ; the student's toast uses the student's on-screen number
  (`currentIndex + 1`), everything professor-facing uses `question_number`. Without randomization they are equal.
- If a violation happens with no question on screen (should not occur once the exam is shown), both are null.
- The in-memory violation objects (and the attempt's violation list saved with the submission) also carry
  `questionNumber`, so student-side lists and the submission snapshot agree with the table.
- Old rows keep null; every display treats null as "—" (not tied to a question).
- The student insert policy (`auth.uid() = student_id`) is unchanged.

### 4. Professor review and per-question override

Migration (same package):

```sql
alter table public.exam_attempt_answers add column if not exists grading_note text
  check (grading_note is null or char_length(grading_note) <= 300);
```

New function `public.adjust_exam_attempt_answer(p_answer_id uuid, p_earned_points numeric, p_note text)`:
- Same authorization as `grade_exam_attempt_answer` (active Professor who owns or created the exam).
- `p_note` required (trimmed, 1–300 characters); points between 0 and the answer's `max_points` (2 decimals).
- Sets `earned_points`, `is_correct = earned_points >= max_points`, `needs_manual_grading = false`, `graded_at`,
  `graded_by`, `grading_note`; recalculates the attempt total with `recalculate_exam_attempt_score`; returns the
  totals like the existing function. Grants mirror the existing function. `grade_exam_attempt_answer` is unchanged.

Professor Scores (`src/pages/professor/ProfessorScores.jsx`), attempt review:
- The violations query also selects `id, question_id, question_number, description, screenshot_url, evidence_url`.
- Each question row shows that question's violations for this attempt as small badges ("Loud audio · 10:42 AM"),
  with evidence links where present.
- A question with at least one violation shows **Adjust points**: points input (0–max) + required note, saved through
  `adjust_exam_attempt_answer`. After saving, the row shows "Adjusted: 0 / 2 — Cheating (loud audio)".
- Existing manual grading for essay/file questions stays as it is.
- Violations with no question are listed under the attempt as "Not tied to a question".
- Which violations belong to an attempt (violations have no attempt column): those of the same exam and student
  created after the student's previous submitted attempt of that exam (or any time, for the first attempt) and up
  to this attempt's `submitted_at`. This keeps violations from the first session of a reopened attempt on that
  attempt.
- Reopen: resubmitting a reopened attempt replaces its answers (existing behaviour), so an earlier adjustment and
  note are replaced with the new answers' grading. The professor reviews the new submission again; earlier
  violations are still listed. (Claude's call: a deduction on answers that no longer exist should not carry over.)
- An unanswered question still has an answer row (null answer, 0 points) for new attempts, so it can be adjusted
  like any other; only old data can lack a row, in which case the row shows "No answer to adjust".

Student grades (`src/pages/student/StudentGrades.jsx`), decided with Ivan: **students see the note**. Where the
student's per-question points are shown, an adjusted question shows the new points and "Adjusted by your
professor: <note>". The note is readable through the existing owner-read policy on `exam_attempt_answers`, so no
extra access rule is needed. During the exam itself the student only sees the neutral "recorded for your
professor's review" message.

Other violation lists show the number next to the type, e.g. "Loud audio detected · Q5": professor Monitoring /
ongoing exams, professor Exam Integrity, Dean Exam Integrity, and violation exports in reports where violation rows
are listed. Null shows "—".

### 5. Tests and checks

- `src/lib/examViolationLimit.js` (renamed or kept) pure helpers tested: the new toast message, no limit constant
  used for locking.
- Pagination logic extracted into a small pure module (e.g. `src/lib/examPagination.js`: clamp index, unanswered
  numbers, answered state per question) with check-script tests.
- Source checks: StudentExamTake no longer auto-submits on violations; `persistViolation` sends `question_id` and
  `question_number`; the migration adds the columns and function with the stated limits; ProfessorScores calls
  `adjust_exam_attempt_answer` and requires a note.
- Existing checks that assert the 5-violation behaviour are updated to the new behaviour.

## Constraints

- Hosted migration only as a controlled package (`npx supabase db query --linked -f` with precheck and postcheck),
  never `supabase db push --linked`, and only with Ivan's approval.
- Release order: migration first, then the frontend (the new frontend writes the new columns).
- No commits, pushes or deploys without Ivan's OK. Tests run on the local stack only.

## Left to the builder

- Exact styling of the navigator and the badges; wording of labels other than those quoted above.
- Whether the pagination helpers live in a new file or an existing lib file.
- How the attempt review lays out badges and the adjust control within the existing table.

## Known pre-existing issue (out of scope)

- Students have an update policy on their own violation rows (`violations_student_update_own`), so a student could
  in principle edit a violation's type or question number. Worth tightening separately.

## Paper impact

Remove the 5-violation auto-submit from the text (requirements, scope, test cases), describe the paginated exam,
the question number on violations, and the professor's per-question adjustment; retake Figures 2.11 and 2.12.
