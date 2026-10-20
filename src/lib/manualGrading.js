import { AUTO_GRADED_TYPES } from "./examQuestionTypes.js";

// The server marks non-auto-graded types for manual grading even if the question flag is off,
// so any pending answer, flagged question, or manual question type keeps its grading control.
export function canGradeManually(question, answer) {
  return Boolean(answer) && (Boolean(answer.needs_manual_grading) || Boolean(question?.manual_grading) || !AUTO_GRADED_TYPES.has(question?.question_type));
}

export function needsGradingPath(examId) {
  return `/professor/scores/${examId}?tab=questions&filter=${encodeURIComponent("Needs Grading")}`;
}
