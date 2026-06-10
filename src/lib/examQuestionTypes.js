export const QUESTION_TYPES = [
  "Multiple Choice",
  "Picture Choice",
  "Multiple Select",
  "Identification",
  "Fill in the Blank",
  "Matching Type",
  "Ordering / Sequencing",
  "Enumeration",
  "True or False",
  "Essay",
  "File Upload",
];

export const AUTO_GRADED_TYPES = new Set([
  "Multiple Choice",
  "Picture Choice",
  "Multiple Select",
  "Identification",
  "Fill in the Blank",
  "Matching Type",
  "Ordering / Sequencing",
  "Enumeration",
  "True or False",
]);

export const FILE_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;
export const FILE_UPLOAD_ACCEPT = ".pdf,.doc,.docx,.jpg,.jpeg,.png";
export const FILE_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
]);

export function normalizeAnswer(value) {
  return String(value || "").trim().toLowerCase();
}

export function safeJsonParse(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function getQuestionConfig(question) {
  return safeJsonParse(question.question_config, question.question_config || {});
}

export function getCorrectAnswers(question) {
  const direct = safeJsonParse(question.correct_answers, null);
  if (Array.isArray(direct)) return direct;
  if (direct && typeof direct === "object") return direct;

  const legacy = safeJsonParse(question.correct_answer, null);
  if (Array.isArray(legacy)) return legacy;
  if (legacy && typeof legacy === "object") return legacy;
  return question.correct_answer ? [question.correct_answer] : [];
}

export function gradeAnswer(question, answer) {
  const type = question.question_type;
  const points = Number(question.points || 0);
  const correct = getCorrectAnswers(question);
  const config = getQuestionConfig(question);

  if (!AUTO_GRADED_TYPES.has(type)) {
    return { earnedPoints: null, maxPoints: points, manual: true, isCorrect: false };
  }

  if (type === "Multiple Choice" || type === "Picture Choice" || type === "True or False") {
    const isCorrect = normalizeAnswer(answer) === normalizeAnswer(correct[0]);
    return { earnedPoints: isCorrect ? points : 0, maxPoints: points, manual: false, isCorrect };
  }

  if (type === "Multiple Select") {
    const selected = Array.isArray(answer) ? answer.map(normalizeAnswer).sort() : [];
    const expected = correct.map(normalizeAnswer).sort();
    const isCorrect = selected.length === expected.length && selected.every((item, index) => item === expected[index]);
    return { earnedPoints: isCorrect ? points : 0, maxPoints: points, manual: false, isCorrect };
  }

  if (type === "Identification" || type === "Fill in the Blank") {
    const accepted = correct.map(normalizeAnswer);
    const isCorrect = accepted.includes(normalizeAnswer(answer));
    return { earnedPoints: isCorrect ? points : 0, maxPoints: points, manual: false, isCorrect };
  }

  if (type === "Matching Type") {
    const pairs = Array.isArray(config.pairs) ? config.pairs : [];
    const submitted = answer && typeof answer === "object" ? answer : {};
    const correctCount = pairs.filter((pair) => normalizeAnswer(submitted[pair.left]) === normalizeAnswer(pair.right)).length;
    const earnedPoints = pairs.length ? (correctCount / pairs.length) * points : 0;
    return { earnedPoints, maxPoints: points, manual: false, isCorrect: earnedPoints === points };
  }

  if (type === "Ordering / Sequencing") {
    const expected = Array.isArray(correct) ? correct.map(normalizeAnswer) : [];
    const submitted = Array.isArray(answer) ? answer.map(normalizeAnswer) : [];
    const correctCount = expected.filter((item, index) => item === submitted[index]).length;
    const earnedPoints = expected.length ? (correctCount / expected.length) * points : 0;
    return { earnedPoints, maxPoints: points, manual: false, isCorrect: earnedPoints === points };
  }

  if (type === "Enumeration") {
    const expected = correct.map(normalizeAnswer);
    const submitted = Array.isArray(answer) ? answer.map(normalizeAnswer).filter(Boolean) : [];
    const uniqueSubmitted = [...new Set(submitted)];
    const correctCount = uniqueSubmitted.filter((item) => expected.includes(item)).length;
    const earnedPoints = expected.length ? (correctCount / expected.length) * points : 0;
    return { earnedPoints, maxPoints: points, manual: false, isCorrect: earnedPoints === points };
  }

  return { earnedPoints: 0, maxPoints: points, manual: false, isCorrect: false };
}

export function computeAttemptScore(questions, answersByQuestionId) {
  const results = questions.map((question) => {
    const answer = answersByQuestionId[question.id];
    return { questionId: question.id, ...gradeAnswer(question, answer) };
  });
  const hasManual = results.some((result) => result.manual);
  const earned = results.reduce((total, result) => total + Number(result.earnedPoints || 0), 0);
  const max = results.reduce((total, result) => total + Number(result.maxPoints || 0), 0);
  const percentage = max ? (earned / max) * 100 : 0;

  return { results, earned, max, percentage, hasManual };
}
