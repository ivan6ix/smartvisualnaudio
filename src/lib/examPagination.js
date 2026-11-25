import { hasProvidedAnswer } from "./examViolationLimit.js";

export function clampQuestionIndex(index, total) {
  const max = Math.max(Number(total) - 1, 0) || 0;
  const value = Math.trunc(Number(index));
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), max);
}

export function isQuestionAnswered(question, answers, files) {
  return hasProvidedAnswer(answers?.[question.id]) || Boolean(files?.[question.id]);
}

// 1-based numbers, as the student sees them on screen.
export function unansweredNumbers(questions, answers, files) {
  const numbers = [];
  questions.forEach((question, index) => {
    if (!isQuestionAnswered(question, answers, files)) numbers.push(index + 1);
  });
  return numbers;
}

export function unansweredConfirmMessage(numbers) {
  if (!numbers.length) return "";
  if (numbers.length === 1) return `Question ${numbers[0]} is unanswered. Submit anyway?`;
  const head = numbers.slice(0, -1).join(", ");
  return `Questions ${head} and ${numbers[numbers.length - 1]} are unanswered. Submit anyway?`;
}
