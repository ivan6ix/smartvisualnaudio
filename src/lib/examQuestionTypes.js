export const QUESTION_TYPES = [
  "Multiple Choice",
  "Picture Choice",
  "Multiple Select",
  "Identification",
  "Fill in the Blank",
  "Matching Type",
  "Ordering / Sequencing",
  "Drag and Drop",
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
  "Drag and Drop",
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

function hashText(value) {
  let hash = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function stableLegacyId(prefix, value, index) {
  return `${prefix}-${index + 1}-${hashText(value)}`;
}

function makeId(prefix = "item") {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createChoiceItem(value = "", key = "") {
  return {
    id: makeId("choice"),
    key: key || "",
    value,
  };
}

export function normalizeChoiceItems(choices = []) {
  return (Array.isArray(choices) ? choices : []).map((choice, index) => {
    const fallbackKey = String.fromCharCode(65 + index);
    if (choice && typeof choice === "object") {
      const value = String(choice.value ?? choice.label ?? choice.text ?? "");
      const key = String(choice.key ?? fallbackKey);
      return {
        ...choice,
        id: String(choice.id || stableLegacyId("choice", `${key}:${value}`, index)),
        key,
        value,
      };
    }
    const value = String(choice ?? "");
    return {
      id: stableLegacyId("choice", `${fallbackKey}:${value}`, index),
      key: fallbackKey,
      value,
    };
  });
}

function normalizeMatchingItems(items = [], prefix) {
  return (Array.isArray(items) ? items : []).map((item, index) => {
    if (item && typeof item === "object") {
      const text = String(item.text ?? item.value ?? item.label ?? "");
      return {
        ...item,
        id: String(item.id || stableLegacyId(prefix, text, index)),
        text,
      };
    }
    const text = String(item ?? "");
    return {
      id: stableLegacyId(prefix, text, index),
      text,
    };
  });
}

function normalizeMatchingFromConfig(config = {}) {
  const legacyPairs = Array.isArray(config.pairs) ? config.pairs : [];
  const leftItems = normalizeMatchingItems(config.matchingLeftItems || legacyPairs.map((pair) => ({ text: pair.left })), "match-left");
  const rightItems = normalizeMatchingItems(config.matchingRightItems || legacyPairs.map((pair) => ({ text: pair.right })), "match-right");
  const rightByText = new Map(rightItems.map((item) => [normalizeAnswer(item.text), item.id]));
  const connections = Array.isArray(config.matchingConnections)
    ? config.matchingConnections
      .map((connection) => ({ leftId: String(connection.leftId || ""), rightId: String(connection.rightId || "") }))
      .filter((connection) => connection.leftId && connection.rightId)
    : legacyPairs
      .map((pair, index) => ({
        leftId: leftItems[index]?.id,
        rightId: rightByText.get(normalizeAnswer(pair.right)) || rightItems[index]?.id,
      }))
      .filter((connection) => connection.leftId && connection.rightId);
  return { leftItems, rightItems, connections };
}

export function connectMatchingItems(connections = [], leftId, rightId) {
  if (!leftId || !rightId) return connections;
  return [
    ...connections.filter((connection) => connection.leftId !== leftId && connection.rightId !== rightId),
    { leftId, rightId },
  ];
}

export function getQuestionConfig(question) {
  return safeJsonParse(question.question_config, question.question_config || {});
}

export function supportsPartialMatch(type) {
  return ["Multiple Select", "Matching Type", "Ordering / Sequencing", "Enumeration"].includes(type);
}

export function allowsPartialMatch(type, config = {}) {
  if (!supportsPartialMatch(type)) return false;
  if (typeof config.partialMatch === "boolean") return config.partialMatch;
  return type === "Matching Type" || type === "Ordering / Sequencing" || type === "Enumeration";
}

export function getCorrectAnswers(question) {
  const direct = safeJsonParse(question.correct_answers ?? question.correctAnswers, null);
  if (Array.isArray(direct)) return direct;
  if (direct && typeof direct === "object") return direct;

  const legacy = safeJsonParse(question.correct_answer ?? question.correctAnswer, null);
  if (Array.isArray(legacy)) return legacy;
  if (legacy && typeof legacy === "object") return legacy;
  return question.correct_answer || question.correctAnswer ? [question.correct_answer || question.correctAnswer] : [];
}

export function normalizeQuestionForEditing(question = {}) {
  const config = getQuestionConfig(question);
  const type = question.type || question.question_type || "";
  const choices = normalizeChoiceItems(question.choices || config.choices || []);
  const choiceIdByLegacyKey = new Map(choices.map((choice) => [String(choice.key), choice.id]));
  const correctAnswers = getCorrectAnswers(question).map((answer) => choiceIdByLegacyKey.get(String(answer)) || String(answer));
  const matching = normalizeMatchingFromConfig(config);
  return {
    id: question.id || "",
    title: question.title || question.question_text || "",
    type,
    choices,
    correctAnswer: choiceIdByLegacyKey.get(String(question.correctAnswer ?? question.correct_answer ?? "")) || String(question.correctAnswer ?? question.correct_answer ?? correctAnswers[0] ?? ""),
    correctAnswers,
    matchingLeftItems: matching.leftItems,
    matchingRightItems: matching.rightItems,
    matchingConnections: matching.connections,
    pairs: matching.leftItems.map((left, index) => ({ left: left.text, right: matching.rightItems[index]?.text || "" })),
    listItems: config.orderItems || [],
    questionImageDataUrl: config.questionImage || "",
    questionImageName: config.questionImageName || "",
    points: String(question.points || 1),
    partialMatch: allowsPartialMatch(type, config),
    config,
    manualGrading: Boolean(question.manualGrading ?? question.manual_grading),
  };
}

export function buildQuestionStorage(question = {}) {
  const type = question.type || question.question_type || "";
  const choices = normalizeChoiceItems(question.choices || []);
  const correctAnswers = type === "Multiple Choice" || type === "Picture Choice" || type === "True or False" || type === "Identification" || type === "Fill in the Blank"
    ? [String(question.correctAnswer || question.correct_answer || "").trim()].filter(Boolean)
    : (question.correctAnswers || question.correct_answers || []).map(String).filter(Boolean);
  const matchingLeftItems = normalizeMatchingItems(question.matchingLeftItems || [], "match-left");
  const matchingRightItems = normalizeMatchingItems(question.matchingRightItems || [], "match-right");
  const matchingConnections = (question.matchingConnections || [])
    .map((connection) => ({ leftId: String(connection.leftId || ""), rightId: String(connection.rightId || "") }))
    .filter((connection) => connection.leftId && connection.rightId);
  const leftById = new Map(matchingLeftItems.map((item) => [item.id, item.text]));
  const rightById = new Map(matchingRightItems.map((item) => [item.id, item.text]));
  const config = {
    ...(question.config || {}),
    choices: ["Multiple Choice", "Picture Choice", "Multiple Select", "Drag and Drop"].includes(type) ? choices : [],
    pairs: type === "Matching Type"
      ? matchingConnections.map((connection) => ({ left: leftById.get(connection.leftId) || "", right: rightById.get(connection.rightId) || "" }))
      : [],
    matchingLeftItems: type === "Matching Type" ? matchingLeftItems : [],
    matchingRightItems: type === "Matching Type" ? matchingRightItems : [],
    matchingConnections: type === "Matching Type" ? matchingConnections : [],
    orderItems: type === "Ordering / Sequencing" ? (question.listItems || question.config?.orderItems || []) : [],
    questionImage: type === "Picture Choice" ? question.questionImageDataUrl || question.config?.questionImage || "" : "",
    questionImageName: type === "Picture Choice" ? question.questionImageName || question.config?.questionImageName || "" : "",
    manualGrading: !AUTO_GRADED_TYPES.has(type),
    ...(supportsPartialMatch(type) ? { partialMatch: Boolean(question.partialMatch) } : {}),
  };

  return {
    id: question.id || makeId("question"),
    title: String(question.title || question.question_text || "").trim(),
    type,
    choices: ["Multiple Choice", "Picture Choice", "Multiple Select", "Drag and Drop"].includes(type) ? choices : [],
    correctAnswer: type === "Matching Type" ? JSON.stringify(config.pairs) : correctAnswers.join(", "),
    correctAnswers,
    config,
    points: question.points || 1,
    manualGrading: !AUTO_GRADED_TYPES.has(type),
  };
}

export function sanitizeQuestionForStudent(question = {}) {
  const config = { ...(question.config || question.question_config || {}) };
  delete config.correctAnswer;
  delete config.correctAnswers;
  delete config.acceptedAnswers;
  delete config.answerKey;
  delete config.matchingConnections;
  if (question.type === "Matching Type" || question.question_type === "Matching Type") {
    config.matchingLeftItems = normalizeMatchingItems(config.matchingLeftItems || [], "match-left");
    config.matchingRightItems = normalizeMatchingItems(config.matchingRightItems || [], "match-right");
    config.pairs = config.matchingLeftItems.map((item) => ({ id: item.id, text: item.text }));
    config.matchChoices = config.matchingRightItems.map((item) => ({ id: item.id, text: item.text }));
  }
  return {
    ...question,
    config,
    question_config: config,
  };
}

export function gradeAnswer(question, answer) {
  const type = question.question_type || question.type;
  const points = Number(question.points || 0);
  const correct = getCorrectAnswers(question);
  const config = getQuestionConfig(question);
  const choices = normalizeChoiceItems(question.choices || config.choices || []);
  const choiceIdByKey = new Map(choices.map((choice) => [normalizeAnswer(choice.key), choice.id]));
  const normalizeChoiceAnswer = (value) => normalizeAnswer(choiceIdByKey.get(normalizeAnswer(value)) || value);

  if (!AUTO_GRADED_TYPES.has(type)) {
    return { earnedPoints: null, maxPoints: points, manual: true, isCorrect: false };
  }

  if (type === "Multiple Choice" || type === "Picture Choice" || type === "True or False") {
    const isCorrect = normalizeChoiceAnswer(answer) === normalizeChoiceAnswer(correct[0]);
    return { earnedPoints: isCorrect ? points : 0, maxPoints: points, manual: false, isCorrect };
  }

  if (type === "Multiple Select") {
    const selected = Array.isArray(answer) ? [...new Set(answer.map(normalizeChoiceAnswer).filter(Boolean))].sort() : [];
    const expected = [...new Set(correct.map(normalizeChoiceAnswer).filter(Boolean))].sort();
    const isCorrect = selected.length === expected.length && selected.every((item, index) => item === expected[index]);
    if (!allowsPartialMatch(type, config)) return { earnedPoints: isCorrect ? points : 0, maxPoints: points, manual: false, isCorrect };
    const correctSelected = selected.filter((item) => expected.includes(item)).length;
    const incorrectSelected = selected.filter((item) => !expected.includes(item)).length;
    const ratio = expected.length ? Math.max(0, Math.min(1, (correctSelected - incorrectSelected) / expected.length)) : 0;
    return { earnedPoints: Math.round(points * ratio * 100) / 100, maxPoints: points, manual: false, isCorrect };
  }

  if (type === "Identification" || type === "Fill in the Blank") {
    const accepted = correct.map(normalizeAnswer);
    const isCorrect = accepted.includes(normalizeAnswer(answer));
    return { earnedPoints: isCorrect ? points : 0, maxPoints: points, manual: false, isCorrect };
  }

  if (type === "Matching Type") {
    const matching = normalizeMatchingFromConfig(config);
    if (matching.connections.length) {
      const submitted = answer && typeof answer === "object" ? answer : {};
      const correctCount = matching.connections.filter((connection) => submitted[connection.leftId] === connection.rightId).length;
      const isCorrect = matching.connections.length > 0 && correctCount === matching.connections.length;
      const earnedPoints = allowsPartialMatch(type, config) && matching.connections.length ? (correctCount / matching.connections.length) * points : isCorrect ? points : 0;
      return { earnedPoints, maxPoints: points, manual: false, isCorrect: earnedPoints === points };
    }
    const pairs = Array.isArray(config.pairs) ? config.pairs : [];
    const submitted = answer && typeof answer === "object" ? answer : {};
    const correctCount = pairs.filter((pair) => normalizeAnswer(submitted[pair.left]) === normalizeAnswer(pair.right)).length;
    const isCorrect = pairs.length > 0 && correctCount === pairs.length;
    const earnedPoints = allowsPartialMatch(type, config) && pairs.length ? (correctCount / pairs.length) * points : isCorrect ? points : 0;
    return { earnedPoints, maxPoints: points, manual: false, isCorrect: earnedPoints === points };
  }

  if (type === "Ordering / Sequencing") {
    const expected = Array.isArray(correct) ? correct.map(normalizeAnswer) : [];
    const submitted = Array.isArray(answer) ? answer.map(normalizeAnswer) : [];
    const correctCount = expected.filter((item, index) => item === submitted[index]).length;
    const isCorrect = expected.length > 0 && submitted.length === expected.length && correctCount === expected.length;
    const earnedPoints = allowsPartialMatch(type, config) && expected.length ? (correctCount / expected.length) * points : isCorrect ? points : 0;
    return { earnedPoints, maxPoints: points, manual: false, isCorrect: earnedPoints === points };
  }

  if (type === "Drag and Drop") {
    const selected = Array.isArray(answer) ? [...new Set(answer.map(String).filter(Boolean))].sort() : [];
    const expected = [...new Set(correct.map(String).filter(Boolean))].sort();
    const isCorrect = expected.length > 0 && selected.length === expected.length && selected.every((item, index) => item === expected[index]);
    return { earnedPoints: isCorrect ? points : 0, maxPoints: points, manual: false, isCorrect };
  }

  if (type === "Enumeration") {
    const expected = correct.map(normalizeAnswer);
    const submitted = Array.isArray(answer) ? answer.map(normalizeAnswer).filter(Boolean) : [];
    const uniqueSubmitted = [...new Set(submitted)];
    const correctCount = uniqueSubmitted.filter((item) => expected.includes(item)).length;
    const isCorrect = expected.length > 0 && correctCount === expected.length && uniqueSubmitted.length === expected.length;
    const earnedPoints = allowsPartialMatch(type, config) && expected.length ? (correctCount / expected.length) * points : isCorrect ? points : 0;
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
