# Unlimited Violations, Paginated Exam and Per-Question Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exams never end because of violations, are taken one question per page with free navigation, every violation records its question, and professors can adjust a flagged question's points with a note that students see.

**Architecture:** Pure helpers (`src/lib/examPagination.js`, `src/lib/violationQuestions.js`) carry the logic and are tested by Node check scripts. `StudentExamTake.jsx` keeps one `currentIndex` (state + ref) that pagination, saved progress and violation recording all read. A hosted migration adds `violations.question_id/question_number`, `exam_attempt_answers.grading_note`, and `adjust_exam_attempt_answer()`; ProfessorScores and StudentGrades use them.

**Tech Stack:** React 18 + Vite, Supabase (Postgres, RLS, plpgsql), Node `assert` check scripts (`npm test`), esbuild-based component harness in `scripts/check-exam-violation-limit.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-25-unlimited-violations-paginated-exam-design.md`

## Global Constraints

- No violation lock or auto-submit; the **interruption limit** (`EXAM_INTERRUPTION_LIMIT`, `interruption_limit`) is untouched.
- The database keeps accepting `submission_reason = 'violation_limit'`; `src/lib/ongoingExams.js` keeps showing old ones as "Auto-Submitted".
- Student toast text: `` `${label} on question ${screenNumber}. It is recorded for your professor's review.` `` (label = the violation's message, e.g. "Loud audio detected").
- Professor-facing number = position in the professor's order (`sort_order`, 1-based). Student-facing number = `currentIndex + 1`. Display format: `"<label> · Q<n>"`; null number → label only in lists, "—" in a number column.
- Unanswered confirmation: `"Question 3 is unanswered. Submit anyway?"` / `"Questions 3 and 9 are unanswered. Submit anyway?"` / `"Questions 3, 9 and 14 are unanswered. Submit anyway?"`.
- Override: points 0..`max_points` rounded to 2 decimals; note required, trimmed, 1–300 characters. Student grades line: `Adjusted by your professor: <note>`.
- Hosted migration only as a controlled package via `npx supabase db query --linked -f <file>` with precheck and postcheck, never `supabase db push --linked`, only with Ivan's OK; migration goes live **before** the frontend push.
- No commits, pushes or deploys without Ivan's OK. Never stage CLAUDE.md, docs/handoff/, planning/, output/, .claude/, .playwright-mcp/, supabase/.temp/cli-latest, supabase/local/hosted-reopen-*.sql, reports/, research_notes/.
- Tests: `$env:NODE_OPTIONS='--require "C:/Users/Ivan/AppData/Local/Temp/claude/250e54c1f3a19f93/3d471d1b-024e-4008-be4b-181b6d080b68/scratchpad/lf-preload.cjs"'; npm test`. New check scripts start with `/* global console */` and are added to the `test` script in `package.json`.

## Review Focus

1. A violation detected right as the student clicks Next — it belongs to the question on screen at detection time, so the ref must change in the same call that changes the page. → Task 3 source check `currentQuestionRef.current = ` inside `goToQuestion` before `setCurrentIndex`.
2. Refresh or recovery mid-exam after the professor removed questions — the saved index must be clamped, never point past the end. → Task 1 test `clampQuestionIndex`.
3. Randomized exam: the stored number must be the professor's number even when the student saw it elsewhere. → Task 1 test `professorQuestionNumbers` with unsorted `sort_order`.
4. Reopened attempt: first-session violations stay on it; the previous attempt's violations do not leak in. → Task 1 test `violationsForAttempt`.
5. A file-upload question answered only by a file counts as answered in the navigator and the unanswered warning. → Task 1 test `unansweredNumbers` with a `files` map.

---

### Task 1: Pure helpers for pagination and violation questions

**Files:**
- Create: `src/lib/examPagination.js`, `src/lib/violationQuestions.js`, `scripts/check-exam-pagination.mjs`, `scripts/check-violation-questions.mjs`
- Modify: `package.json` (add both checks to `test`)

**Interfaces — Produces:**
- `examPagination.js`:
  - `clampQuestionIndex(index: unknown, total: number): number` — integer in `[0, max(total-1, 0)]`; non-finite → 0.
  - `isQuestionAnswered(question, answers: object, files: object): boolean` — `hasProvidedAnswer(answers[question.id])` (from `examViolationLimit.js`) or a truthy `files[question.id]`.
  - `unansweredNumbers(questions, answers, files): number[]` — 1-based screen numbers.
  - `unansweredConfirmMessage(numbers: number[]): string` — exact copy in Global Constraints; `""` for none.
- `violationQuestions.js`:
  - `professorQuestionNumbers(questions: {id, sort_order}[]): Map<id, number>` — sort by `Number(sort_order)` (null last), ties by original index.
  - `formatViolationQuestion(label: string, questionNumber: number|null): string` — `"Loud audio detected · Q5"` or `label`.
  - `violationNotice(label: string, screenNumber: number|null): string` — toast copy; without a number: `` `${label}. It is recorded for your professor's review.` ``.
  - `violationsForAttempt(violations, attempt, studentAttempts): violation[]` — same `exam_id`/`student_id`; `created_at` > the latest `submitted_at` among that student's other attempts of the exam submitted before `attempt.submitted_at` (none → no lower bound) and ≤ `attempt.submitted_at` (missing → no upper bound).

- [ ] **Step 1: Write `scripts/check-exam-pagination.mjs`**

```js
import { clampQuestionIndex, isQuestionAnswered, unansweredNumbers, unansweredConfirmMessage } from "../src/lib/examPagination.js";
assert.equal(clampQuestionIndex(7, 5), 4); assert.equal(clampQuestionIndex(-2, 5), 0);
assert.equal(clampQuestionIndex("x", 5), 0); assert.equal(clampQuestionIndex(3, 0), 0);
const qs = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
assert.equal(isQuestionAnswered(qs[1], {}, { b: { name: "work.pdf" } }), true, "A file counts as an answer.");
assert.deepEqual(unansweredNumbers(qs, { a: "A", c: "  " }, { b: { name: "x.pdf" } }), [3, 4]);
assert.equal(unansweredConfirmMessage([3]), "Question 3 is unanswered. Submit anyway?");
assert.equal(unansweredConfirmMessage([3, 9]), "Questions 3 and 9 are unanswered. Submit anyway?");
assert.equal(unansweredConfirmMessage([3, 9, 14]), "Questions 3, 9 and 14 are unanswered. Submit anyway?");
assert.equal(unansweredConfirmMessage([]), "");
```

- [ ] **Step 2: Write `scripts/check-violation-questions.mjs` (helper part)**

```js
import { formatViolationQuestion, professorQuestionNumbers, violationNotice, violationsForAttempt } from "../src/lib/violationQuestions.js";
const numbers = professorQuestionNumbers([{ id: "q3", sort_order: 3 }, { id: "q1", sort_order: 1 }, { id: "qn", sort_order: null }, { id: "q2", sort_order: 2 }]);
assert.deepEqual([...numbers], [["q1", 1], ["q2", 2], ["q3", 3], ["qn", 4]]);
assert.equal(formatViolationQuestion("Loud audio detected", 5), "Loud audio detected · Q5");
assert.equal(formatViolationQuestion("Loud audio detected", null), "Loud audio detected");
assert.equal(violationNotice("Loud audio detected", 2), "Loud audio detected on question 2. It is recorded for your professor's review.");
const v = (id, at) => ({ id, exam_id: "e", student_id: "s", created_at: at });
const all = [v("old", "2026-01-01T09:00:00Z"), v("first-session", "2026-01-02T09:00:00Z"), v("after-reopen", "2026-01-03T09:00:00Z"), v("later", "2026-01-05T09:00:00Z")];
const first = { id: "a1", exam_id: "e", student_id: "s", submitted_at: "2026-01-01T10:00:00Z" };
const reopened = { id: "a2", exam_id: "e", student_id: "s", submitted_at: "2026-01-03T10:00:00Z" };
assert.deepEqual(violationsForAttempt(all, reopened, [first, reopened]).map((x) => x.id), ["first-session", "after-reopen"]);
assert.deepEqual(violationsForAttempt(all, first, [first, reopened]).map((x) => x.id), ["old"]);
```

- [ ] **Step 3: Add both scripts to `package.json` `test` and run them**

Run: `node scripts/check-exam-pagination.mjs; node scripts/check-violation-questions.mjs`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement the two modules per Interfaces.**

- [ ] **Step 5: Run both scripts**

Expected: each prints its "passed" line.

- [ ] **Step 6: Commit (only with Ivan's OK)** — `feat: helpers for paginated exams and violation questions`

---

### Task 2: Remove the violation limit

**Files:**
- Modify: `src/lib/examViolationLimit.js`, `src/pages/student/StudentExamTake.jsx`, `src/services/audioViolationService.js`, `src/components/landing/content.js`
- Test: `scripts/check-exam-violation-limit.mjs` (rewrite its limit assertions; keep the harness), `scripts/check-violation-questions.mjs` (append source checks)

**Interfaces:**
- Consumes: `violationNotice` (Task 1).
- Produces: `examViolationLimit.js` no longer exports `EXAM_VIOLATION_LIMIT` or `violationWarning`; `acceptRecordedViolation` returns `false` always (callers such as the audio service treat it as "not locked").

- [ ] **Step 1: Rewrite the harness assertions in `check-exam-violation-limit.mjs`**

Remove `violationLimitReachedRef` from the `expose` list. Replace the 5-violation scenario with: accept 8 violations, then assert `h.rows.attempts.length === 0` (no auto-submit) and that the exam is still answerable (`api.setAnswer('q6','A')` changes `answersRef`); then a manual `handleSubmit('manual')` submits once with all 8 violations in the snapshot. Keep the existing timer/manual double-submit and offline-answers assertions. Add source checks:

```js
assert.doesNotMatch(original, /EXAM_VIOLATION_LIMIT|violationLimitReachedRef|"violation_limit"/, "No violation limit remains on the exam page.");
assert.doesNotMatch(fs.readFileSync('src/services/audioViolationService.js', 'utf8'), /violation limit|limitReached/);
assert.doesNotMatch(fs.readFileSync('src/components/landing/content.js', 'utf8'), /violation limit/);
assert.equal(policy.EXAM_VIOLATION_LIMIT, undefined);
```

- [ ] **Step 2: Run it**

Run: `node scripts/check-exam-violation-limit.mjs`
Expected: FAIL on the no-auto-submit assertion.

- [ ] **Step 3: Implement**
- `examViolationLimit.js`: delete `EXAM_VIOLATION_LIMIT` and `violationWarning`; keep the rest.
- `StudentExamTake.jsx`: delete `violationLimitReachedRef` and every condition on it; delete the `violation_limit` submit path, the limit-reached screen and its "Retry Submission" button, the `submissionReason: "violation_limit"` snapshot mapping and the `restoredViolations.length >= EXAM_VIOLATION_LIMIT` restore branch; `acceptRecordedViolation` shows `toast.warning(violationNotice(...))` (screen number wired in Task 4; pass `null` here) and returns `false`. Header subtitle `` `Violations: ${violations.length}` ``; proctor stat shows the count only, no "urgent" class, title "Violations recorded for your professor's review."
- `audioViolationService.js`: remove the `limitReached` description override.
- `content.js` FAQ "What happens when an event is flagged?": replace the last sentence with "Flags never end an examination on their own; each one is recorded with the question the student was on, for the professor to review."

- [ ] **Step 4: Run it and the related checks**

Run: `node scripts/check-exam-violation-limit.mjs; node scripts/check-ongoing-exams-helpers.mjs; node scripts/check-live-object-monitor.mjs`
Expected: all print "passed".

- [ ] **Step 5: Commit (only with Ivan's OK)** — `feat: violations no longer lock or submit an exam`

---

### Task 3: Paginated exam with free navigation

**Files:**
- Modify: `src/pages/student/StudentExamTake.jsx`, `src/styles.css`
- Test: `scripts/check-exam-pagination.mjs` (append source checks)

**Interfaces:**
- Consumes: Task 1 `clampQuestionIndex`, `isQuestionAnswered`, `unansweredNumbers`, `unansweredConfirmMessage`.
- Produces (inside StudentExamTake): `const [currentIndex, setCurrentIndex] = useState(0)`, `currentQuestionRef` (`useRef(null)`, holds `{ questionId, screenNumber }`), `goToQuestion(index: number): void`. Saved progress meta gains `currentIndex`.

- [ ] **Step 1: Append failing source checks**

```js
const page = fs.readFileSync("src/pages/student/StudentExamTake.jsx", "utf8");
assert.match(page, /function goToQuestion\(index\)[\s\S]*?clampQuestionIndex\([\s\S]*?currentQuestionRef\.current = [\s\S]*?setCurrentIndex\(/, "The ref changes in the same call as the page.");
assert.doesNotMatch(page, /\{questions\.map\(renderQuestion\)\}/, "Only one question is shown at a time.");
assert.match(page, /renderQuestion\(questions\[currentIndex\], currentIndex\)/);
assert.match(page, /aria-current=\{index === currentIndex \? "step" : undefined\}/);
assert.match(page, /className="exam-question-navigator"/);
assert.match(page, /Previous/); assert.match(page, /Next/);
assert.match(page, /unansweredConfirmMessage\(unansweredNumbers\(/, "Submitting warns about unanswered questions.");
assert.match(page, /answers: answersRef\.current, violations: violationsRef\.current,[^}]*currentIndex: currentIndexRef\.current/, "The page is saved with the progress.");
```

- [ ] **Step 2: Run it** — Expected: FAIL at `goToQuestion`.

- [ ] **Step 3: Implement**
- State/refs as in Interfaces (plus `currentIndexRef` mirroring the state for saving). `goToQuestion` clamps, sets `currentQuestionRef.current = { questionId: questions[i]?.id, screenNumber: i + 1 }`, sets state, then focuses the question heading (`id="exam-question-heading"`, `tabIndex={-1}`) on the next frame. Keep the ref in sync when `questions` first loads (index 0) and on restore.
- Restore: when saved progress is applied, `goToQuestion(clampQuestionIndex(saved.currentIndex, questions.length))`.
- Render: heading "Question {currentIndex + 1} of {questions.length}", `renderQuestion(questions[currentIndex], currentIndex)`, then a navigator `<nav className="exam-question-navigator" aria-label="Questions">` of buttons (label = number; `aria-label` "Question N, answered|unanswered"; class `is-answered` from `isQuestionAnswered`; `aria-current` as asserted), then Previous (disabled on first) and Next; on the last question a "Submit Exam" button (same handler as the header one) replaces Next.
- `handleSubmit("manual")`: if `unansweredNumbers(...)` is non-empty, `window.confirm(unansweredConfirmMessage(numbers))`; cancel returns without submitting. Timer and interruption submissions never ask.
- CSS: navigator wraps (`display:flex; flex-wrap:wrap; gap`), buttons ≥ 36px, answered = filled accent, current = outline; no horizontal scroll at 375px.

- [ ] **Step 4: Run `node scripts/check-exam-pagination.mjs; node scripts/check-exam-violation-limit.mjs; node scripts/check-exam-start-fullscreen-order.mjs`** — Expected: all "passed" (harness still drives answers and submission).

- [ ] **Step 5: Commit (only with Ivan's OK)** — `feat: one question per page with free navigation`

---

### Task 4: Record the question on every violation (+ migration)

**Files:**
- Create: `supabase/migrations/20261125120000_violation_questions_and_answer_adjustment.sql`
- Modify: `src/pages/student/StudentExamTake.jsx`, `src/hooks/useLiveAudioMonitoring.js`, `src/services/audioViolationService.js`
- Test: `scripts/check-violation-questions.mjs` (append)

**Interfaces:**
- Consumes: Task 1 `professorQuestionNumbers`, `violationNotice`; Task 3 `currentQuestionRef`.
- Produces:
  - DB: `violations.question_id uuid` (FK `exam_questions(id)` on delete set null), `violations.question_number integer` (null or > 0), index `violations_attempt_question_idx (exam_id, student_id, question_id)`; `exam_attempt_answers.grading_note text` (null or ≤ 300 chars); `public.adjust_exam_attempt_answer(p_answer_id uuid, p_earned_points numeric, p_note text) returns jsonb`.
  - Client: `getViolationQuestion(): { question_id, question_number, screenNumber } | null` in StudentExamTake, using `professorQuestionNumbers(questionRows)` computed from the **unshuffled** rows.
  - `useLiveAudioMonitoring({ ..., getQuestionContext })` → `uploadAudioViolation({ ..., questionContext })`; payloads include `question_id`, `question_number`.

- [ ] **Step 1: Append failing checks**

```js
const sql = fs.readFileSync("supabase/migrations/20261125120000_violation_questions_and_answer_adjustment.sql", "utf8");
assert.match(sql, /add column if not exists question_id uuid references public\.exam_questions\(id\) on delete set null/);
assert.match(sql, /question_number integer check \(question_number is null or question_number > 0\)/);
assert.match(sql, /grading_note text\s+check \(grading_note is null or char_length\(grading_note\) <= 300\)/);
assert.match(sql, /function public\.adjust_exam_attempt_answer\(p_answer_id uuid, p_earned_points numeric, p_note text\)/);
assert.match(sql, /role = 'Professor'[\s\S]*?status = 'Active'/);
assert.match(sql, /professor_id is distinct from auth\.uid\(\) and exam_row\.created_by is distinct from auth\.uid\(\)/);
assert.match(sql, /char_length\(clean_note\) not between 1 and 300|clean_note = ''|length\(clean_note\) = 0/);
assert.match(sql, /grading_note = clean_note/); assert.match(sql, /recalculate_exam_attempt_score\(/);
assert.match(sql, /grant execute on function public\.adjust_exam_attempt_answer\(uuid, numeric, text\) to authenticated/);
assert.match(sql, /revoke all on function public\.adjust_exam_attempt_answer\(uuid, numeric, text\) from public/);
const take = fs.readFileSync("src/pages/student/StudentExamTake.jsx", "utf8");
assert.match(take, /async function persistViolation[\s\S]*?const question = getViolationQuestion\(\);[\s\S]*?await /, "The question is captured before the first await.");
assert.match(take, /question_id: question\?\.question_id \?\? null,\s*question_number: question\?\.question_number \?\? null/);
assert.match(take, /professorQuestionNumbers\(/);
assert.match(take, /getQuestionContext: getViolationQuestion/);
const audio = fs.readFileSync("src/services/audioViolationService.js", "utf8");
assert.match(audio, /question_id: questionContext\?\.question_id \?\? null/);
```

- [ ] **Step 2: Run it** — Expected: FAIL (migration file missing).

- [ ] **Step 3: Implement**
- Migration: the spec's two `alter table` blocks + index, and `adjust_exam_attempt_answer` modelled on `grade_exam_attempt_answer` in `20260926130000_scoring_foundation.sql` (same professor/ownership checks, `for update` locks, max-points check, `round(…, 2)`), plus `clean_note := btrim(coalesce(p_note, ''))` rejected when empty or > 300 with `'A note of 1 to 300 characters is required.'`; update sets `earned_points, is_correct, needs_manual_grading = false, graded_at = now(), graded_by = auth.uid(), grading_note = clean_note`; returns `recalculate_exam_attempt_score(...) || jsonb_build_object('answer_id', …, 'earned_points', …, 'grading_note', clean_note)`; revoke from public/anon, grant to authenticated. Also write `scratchpad/golive/violation-questions-precheck.sql` (columns/function absent, count of violations) and `…-postcheck.sql` (columns, constraint, index, function and grants present) — scratchpad, not the repo.
- StudentExamTake: keep the unshuffled `questionRows` numbers in a memo `professorNumbers`; `getViolationQuestion()` reads `currentQuestionRef.current` and returns `{ question_id, question_number: professorNumbers.get(id) ?? null, screenNumber }` or `null`. In `persistViolation`, call it on the first line, add the two columns to `payload` (the column-missing fallback insert also drops them), and attach `questionNumber`/`screenNumber` to the in-memory violation; `acceptRecordedViolation`'s toast uses `violationNotice(label, violation.screenNumber ?? null)`.
- Audio: the hook accepts `getQuestionContext`, captures `questionContext = getQuestionContext?.()` when the trigger fires, passes it to `uploadAudioViolation({ ..., questionContext })` (which adds `question_id`/`question_number` to all four payload variants), and includes `questionNumber: questionContext?.question_number ?? null, screenNumber: questionContext?.screenNumber ?? null` in the violation object it hands to `onViolation`, so the student toast shows the right number.

- [ ] **Step 4: Run `node scripts/check-violation-questions.mjs; node scripts/check-exam-violation-limit.mjs`** and, if the local stack is running, apply the migration there (`npx supabase db reset` in `C:\Users\Ivan\sp-mc-test2` after copying the file) and call the function once as a professor and once as a student. If Docker is not running, say so in the ledger — the SQL is then verified only by the hosted precheck/postcheck in Task 6.
Expected: checks "passed".

- [ ] **Step 5: Commit (only with Ivan's OK)** — `feat: violations record their question; answer adjustment function`

---

### Task 5: Professor review, adjustment, student note and "· Q5" lists

**Files:**
- Modify: `src/pages/professor/ProfessorScores.jsx`, `src/pages/student/StudentGrades.jsx`, `src/pages/professor/ProfessorMonitoring.jsx`, `src/pages/professor/ProfessorOngoingExams.jsx`, `src/pages/dean/DeanExamIntegrity.jsx`, `src/lib/integrityRisk.js` (or wherever `violationLabel` formats Exam Integrity rows), `src/styles.css`
- Test: `scripts/check-violation-questions.mjs` (append)

**Interfaces:**
- Consumes: Task 1 `formatViolationQuestion`, `violationsForAttempt`, `professorQuestionNumbers`; Task 4 DB columns and RPC.
- Produces: ProfessorScores `saveAdjustment(answer, question)`; `AttemptView` props gain `violations`, `adjustInputs`, `onAdjustInput`, `onSaveAdjustment`.

- [ ] **Step 1: Append failing checks**

```js
const scores = fs.readFileSync("src/pages/professor/ProfessorScores.jsx", "utf8");
assert.match(scores, /select\("id, exam_id, student_id, violation_type, severity, description, screenshot_url, evidence_url, question_id, question_number, created_at", options\)/);
assert.match(scores, /violationsForAttempt\(/);
assert.match(scores, /supabase\.rpc\("adjust_exam_attempt_answer", \{ p_answer_id: answer\.id, p_earned_points: value, p_note: note \}\)/);
assert.match(scores, /A note of 1 to 300 characters is required\./, "The note is required before calling the server.");
assert.match(scores, /Adjust points/); assert.match(scores, /Not tied to a question/);
assert.match(scores, /grading_note/);
const grades = fs.readFileSync("src/pages/student/StudentGrades.jsx", "utf8");
assert.match(grades, /grading_note/); assert.match(grades, /Adjusted by your professor: /);
for (const file of ["src/pages/professor/ProfessorMonitoring.jsx", "src/pages/professor/ProfessorOngoingExams.jsx", "src/pages/dean/DeanExamIntegrity.jsx"]) {
  const source = fs.readFileSync(file, "utf8");
  assert.match(source, /question_number/, `${file} reads the question number.`);
  assert.match(source, /formatViolationQuestion\(/, `${file} shows "· Q5".`);
}
```

- [ ] **Step 2: Run it** — Expected: FAIL at the Scores select.

- [ ] **Step 3: Implement**
- ProfessorScores: widen the violations select as asserted; answers select adds `grading_note` (extend the existing missing-column fallback to include `grading_note`). In `AttemptView`, compute this attempt's violations with `violationsForAttempt(violations, attempt, attemptsOfThatStudent)`, group by `question_id`; each question row shows badges `formatViolationQuestion(label, null)` + time + an "Evidence" link when `evidence_url || screenshot_url`. A question with ≥1 violation and an answer row gets **Adjust points**: number input (0..max), note input (maxLength 300, placeholder "Reason, e.g. Cheating – loud audio", prefilled `Question ${n}: ` where n is the row number), Save → `saveAdjustment` validates (copy above) then calls the RPC and reloads. An answer with `grading_note` shows "Adjusted: x / max — <note>". No answer row → "No answer to adjust". Violations with no question go in a list under the table titled "Not tied to a question". Existing manual grading unchanged.
- StudentGrades: answers select adds `grading_note` (add to its fallback list); under each attempt's score, one line per answer with a note: `Adjusted by your professor: ${note}`.
- Monitoring / OngoingExams / DeanExamIntegrity / Exam Integrity: add `question_number` to violation selects (main select only where a fallback select exists) and render the label through `formatViolationQuestion(label, violation.question_number)`. Report exports that print one row per violation (`src/lib/professorReports.js`, if it does) use the same formatter.

- [ ] **Step 4: Full verification**

Run: `npm test` (NODE_OPTIONS as above); `npx eslint` on every changed file; `npm run build`
Expected: test exit 0, eslint silent, build "built in".

- [ ] **Step 5: Look at it** — demo mode (`VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite --port 5199`, demo student/professor): take an exam page through Previous/Next/navigator, refresh mid-exam (same question returns), trigger a manual violation where the page allows, submit with an unanswered question (confirmation text); check the navigator at 375px. Screenshot for Ivan. Professor adjust UI can only be seen with real data — note it for the live smoke test.

- [ ] **Step 6: Commit (only with Ivan's OK)** — `feat: per-question violation review and point adjustment`

---

### Task 6: Go live (only when Ivan says so)

- [ ] **Step 1:** `npx supabase db query --linked -f scratchpad/golive/violation-questions-precheck.sql` — expected: columns and function absent.
- [ ] **Step 2:** `npx supabase db query --linked -f supabase/migrations/20261125120000_violation_questions_and_answer_adjustment.sql`.
- [ ] **Step 3:** postcheck file — expected: both columns, check constraints, index, function and its grants present; violation count unchanged.
- [ ] **Step 4:** `git push origin HEAD:main`; wait until the live StudentExamTake chunk contains `exam-question-navigator`.
- [ ] **Step 5:** Ask Ivan for a live smoke test: test student takes a 3-question exam, triggers a violation on question 2, submits; professor sees "· Q2", adjusts with a note; student sees "Adjusted by your professor: …".
