# Interactive Exam Questions Design

## Goal

Enhance exam question authoring and taking so dynamic choices, visual matching, and a new Drag and Drop question type use stable IDs, preserve legacy data, and keep server scoring authoritative.

## Core Requirements

- Existing exams and question rows continue to render, submit, and grade without manual migration.
- New Multiple Choice, Picture Choice, Multiple Select, Matching Type, and Drag and Drop items use stable logical IDs rather than indexes, positions, or coordinates.
- Student question payloads never expose correct answers, matching answer keys, or drag/drop correct IDs.
- Existing Multiple Select and Matching Type partial-match behavior remains unchanged.
- Drag and Drop is a new exact-set, auto-graded type. Order in the answer area does not matter.
- Create, draft save/resume, edit, publish, submit for review, cluster review, student take, submit, and score flows must use the same structures.

## Data Model

No new columns are required. Use the existing `choices`, `correct_answer`, `correct_answers`, and `question_config` fields.

Choice-like options normalize to `{ id, key, value }`. Legacy rows with `{ key, value }` or strings receive deterministic IDs derived from stable existing content. New rows generate IDs once when the item is created and preserve them through draft/save/edit.

Matching stores public left/right item lists and a private answer key:

- Public editor/student config: `matchingLeftItems`, `matchingRightItems`
- Private answer config in stored question config: `matchingConnections` as `{ leftId, rightId }[]`
- Legacy `pairs` remains supported and is normalized to stable item IDs.

Drag and Drop stores choices in `choices` and correct IDs in `correct_answers`. Student answers submit an array of selected choice IDs.

## UI Design

Professor editor:

- Choice questions support add/remove beyond four choices. Multiple Choice and Picture Choice allow exactly one correct choice. Multiple Select allows multiple correct choices and keeps partial-match controls.
- Matching editor has independent left and right lists, add/remove buttons, and one-to-one visual dot connections. Reconnecting replaces the previous left/right relationship cleanly. Right-side distractors may remain unconnected.
- Drag and Drop editor has dynamic available choices and lets the professor mark one or more correct choices.

Student UI:

- Multiple Choice/Select submits stable IDs.
- Matching shows left and right items without professor connections. Desktop supports pointer drag from dot to dot; touch/mobile supports tap-left then tap-right. Lines are presentation only; answers store `{ [leftId]: rightId }`.
- Drag and Drop uses pointer/tap controls to move choices between Available Choices and Answer Area. Answers submit selected choice IDs.

## Backend Design

Create a forward Supabase migration that updates:

- `sanitize_student_question_config` to strip answer keys and expose only public matching/drag configuration.
- `grade_exam_answer` to normalize legacy/new choices, preserve partial-match semantics, and add Drag and Drop exact-set grading.
- `get_student_exam_questions` only if required by sanitizer/output needs.

The migration must not weaken RLS, grants, or auth. Server-side `submit_exam_attempt` remains authoritative through `grade_exam_answer`.

## Verification

Add focused Node helper tests for normalization, grading parity, sanitizer expectations, dynamic choice behavior, matching one-to-one connections, randomization identity preservation, and Drag and Drop exact-set scoring.

Run hosted Supabase project/migration checks, apply only the new forward migration, run safe runtime SQL checks with temporary test data only, run `supabase db lint --linked`, then run `npm.cmd test`, `npm.cmd run lint`, `npm.cmd run build`, and `git diff --check`.
