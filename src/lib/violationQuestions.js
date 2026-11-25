// Question numbers as the professor sees them: by sort_order, unnumbered questions last, ties by original position.
export function professorQuestionNumbers(questions) {
  const order = (question) => {
    const value = Number(question.sort_order);
    return question.sort_order == null || !Number.isFinite(value) ? Infinity : value;
  };
  const sorted = questions
    .map((question, index) => ({ question, index }))
    .sort((a, b) => {
      const x = order(a.question);
      const y = order(b.question);
      if (x === y) return a.index - b.index;
      return x < y ? -1 : 1;
    });
  return new Map(sorted.map(({ question }, position) => [question.id, position + 1]));
}

export function formatViolationQuestion(label, questionNumber) {
  return questionNumber == null ? label : `${label} · Q${questionNumber}`;
}

export function violationNotice(label, screenNumber) {
  // Labels may already end a sentence ("…for the professor."); drop that ending so the notice has one period.
  const text = String(label ?? "").replace(/[\s.!?]+$/, "");
  const place = screenNumber == null ? text : `${text} on question ${screenNumber}`;
  return `${place}. It is recorded for your professor's review.`;
}

// A reopened exam keeps each session's violations apart. Attempts of one exam split the student's violations at
// each attempt's start: an attempt owns the violations from its own started_at, when an earlier attempt exists, up
// to the next attempt's start (its started_at, falling back to its submitted_at; exclusive), with no end when there
// is no later attempt. The end is never this attempt's own submitted_at: that is server time, while
// violations.created_at is the student's clock, so a fast clock would drop the last violations.
export function violationsForAttempt(violations, attempt, studentAttempts) {
  const time = (value) => (value ? new Date(value).getTime() : NaN);
  const startOf = (item) => (item.started_at ? time(item.started_at) : item.submitted_at ? time(item.submitted_at) : NaN);
  const submitted = attempt.submitted_at ? time(attempt.submitted_at) : Infinity;
  let previousSubmitted = -Infinity;
  let end = Infinity;
  for (const other of studentAttempts) {
    if (other.id === attempt.id || other.exam_id !== attempt.exam_id || other.student_id !== attempt.student_id) continue;
    const otherSubmitted = other.submitted_at ? time(other.submitted_at) : Infinity;
    if (otherSubmitted < submitted) {
      if (otherSubmitted > previousSubmitted) previousSubmitted = otherSubmitted;
    } else if (otherSubmitted > submitted) {
      const nextStart = startOf(other);
      if (Number.isFinite(nextStart) && nextStart < end) end = nextStart;
    }
  }
  // After an earlier attempt, the lower bound is this attempt's started_at: the same instant that ends the earlier
  // one, so no violation is listed under two attempts. Without a started_at, it is after the previous submission.
  const ownStart = attempt.started_at ? time(attempt.started_at) : NaN;
  const after = (at) => {
    if (previousSubmitted === -Infinity) return true;
    return Number.isFinite(ownStart) ? at >= ownStart : at > previousSubmitted;
  };
  return violations.filter((violation) => {
    if (violation.exam_id !== attempt.exam_id || violation.student_id !== attempt.student_id) return false;
    const at = new Date(violation.created_at).getTime();
    return after(at) && at < end;
  });
}

// An answer adjustment needs a points value and a reason. An empty points box is not 0 (Number("") is 0, so a
// note-only save would grade a pending essay 0), and the note is 1 to 300 characters once trimmed.
export function validateAnswerAdjustment({ points, note, maxPoints, formatMax = String }) {
  const max = Number(maxPoints ?? 0);
  const raw = points == null ? "" : String(points).trim();
  const value = raw === "" ? NaN : Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > max) return { error: `Enter a score from 0 to ${formatMax(max)}.` };
  const clean = String(note ?? "").trim();
  if (clean.length < 1 || clean.length > 300) return { error: "A note of 1 to 300 characters is required." };
  return { value, note: clean };
}
