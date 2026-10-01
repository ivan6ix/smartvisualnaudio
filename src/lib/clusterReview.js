import {
  allowsPartialMatch,
  getCorrectAnswers,
  getQuestionConfig,
  normalizeChoiceItems,
  normalizeQuestionForEditing,
} from "./examQuestionTypes.js";

const EMPTY_TEXT = "Not configured";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = "") {
  return String(value ?? "").trim() || fallback;
}

function normalizeStatus(status) {
  const value = String(status || "").toLowerCase();
  if (["pending review", "pending approval", "pending", "submitted"].includes(value)) return "Pending Review";
  if (["approved", "cluster approved"].includes(value)) return "Approved";
  if (value === "rejected") return "Rejected";
  if (["published", "active"].includes(value)) return "Published";
  return text(status, "Draft");
}

function resolveChoiceLabel(answer, choices) {
  const key = String(answer ?? "");
  const normalizedKey = key.trim().toLowerCase();
  const choice = choices.find((item) => (
    String(item.id).toLowerCase() === normalizedKey ||
    String(item.key).toLowerCase() === normalizedKey ||
    String(item.value).toLowerCase() === normalizedKey
  ));
  return choice?.value || key;
}

function resolveChoiceAnswers(question, choices) {
  return asArray(getCorrectAnswers(question))
    .flatMap((answer) => Array.isArray(answer) ? answer : [answer])
    .map((answer) => resolveChoiceLabel(answer, choices))
    .map((answer) => text(answer))
    .filter(Boolean);
}

function normalizeQuestionConfig(question) {
  const source = question || {};
  const config = source.questionConfig && typeof source.questionConfig === "object"
    ? source.questionConfig
    : getQuestionConfig(source);
  return config && typeof config === "object" ? config : {};
}

export function normalizeClusterQuestion(question = {}) {
  const source = question && typeof question === "object" ? question : {};
  const config = normalizeQuestionConfig(source);
  const type = text(source.questionType || source.question_type || source.type, "Question");
  const choices = normalizeChoiceItems(source.choices || config.choices || []);
  const editing = normalizeQuestionForEditing({
    ...source,
    question_type: type,
    question_text: source.questionText || source.question_text || source.title || "",
    question_config: config,
    choices,
  });
  const correctAnswers = resolveChoiceAnswers(source, choices);

  return {
    ...source,
    id: text(source.id, `question-${text(source.questionText || source.question_text || source.title, "item").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`),
    questionType: type,
    questionText: text(source.questionText || source.question_text || source.title),
    choices,
    correctAnswer: text(source.correctAnswer || source.correct_answer || correctAnswers.join(", ")),
    correctAnswers,
    points: Number(source.points || 0) || 0,
    questionConfig: config,
    matchingLeftItems: editing.matchingLeftItems,
    matchingRightItems: editing.matchingRightItems,
    matchingConnections: editing.matchingConnections,
    listItems: asArray(editing.listItems || config.orderItems),
    partialMatch: allowsPartialMatch(type, config),
    manualGrading: Boolean(source.manualGrading ?? source.manual_grading ?? editing.manualGrading),
  };
}

export function normalizeClusterExam(exam = {}) {
  const source = exam && typeof exam === "object" ? exam : {};
  const questions = asArray(source.questions).map(normalizeClusterQuestion);

  return {
    ...source,
    id: text(source.id, `exam-${text(source.examTitle || source.title || source.exam_title, "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`),
    examTitle: text(source.examTitle || source.exam_title || source.title, "Untitled exam"),
    description: text(source.description),
    course: text(source.course),
    professorName: text(source.professorName || source.professor_name, "Professor"),
    professorId: text(source.professorId || source.professor_id || source.created_by),
    timeLimit: Number(source.timeLimit || source.time_limit || source.duration || 0) || 0,
    passingScore: Number(source.passingScore || source.passing_score || 0) || 0,
    examType: text(source.examType || source.exam_type, "Exam"),
    questions,
    questionsCount: Number(source.questionsCount || source.questions_count || questions.length) || questions.length,
    status: normalizeStatus(source.status),
    createdAt: text(source.createdAt || source.created_at),
    submittedAt: text(source.submittedAt || source.submitted_at),
    approvedAt: text(source.approvedAt || source.approved_at),
    rejectedAt: text(source.rejectedAt || source.rejected_at),
    rejectionReason: text(source.rejectionReason || source.rejection_reason),
    reviewNotes: text(source.reviewNotes || source.review_notes),
  };
}

export function normalizeClusterExams(value) {
  return asArray(value).map(normalizeClusterExam);
}

export function normalizeClusterReview(review = {}) {
  const source = review && typeof review === "object" ? review : {};
  return {
    ...source,
    id: text(source.id, `review-${text(source.examId || source.exam_id, "item")}`),
    examId: text(source.examId || source.exam_id),
    examTitle: text(source.examTitle || source.exam_title, "Exam"),
    professorName: text(source.professorName || source.professor_name, "Professor"),
    course: text(source.course, "Course"),
    reviewDate: text(source.reviewDate || source.review_date),
    decision: text(source.decision, "Revision Needed"),
    remarks: text(source.remarks),
  };
}

export function normalizeClusterReviews(value) {
  return asArray(value).map(normalizeClusterReview);
}

export function normalizeClusterMessage(message = {}) {
  const source = message && typeof message === "object" ? message : {};
  return {
    ...source,
    id: text(source.id, `message-${text(source.name || source.email, "item")}`),
    name: text(source.name, "Conversation"),
    role: text(source.role),
    unread: Number(source.unread || 0) || 0,
    lastMessage: text(source.lastMessage || source.last_message),
    messages: asArray(source.messages).map((item, index) => ({
      ...item,
      id: text(item?.id, `message-item-${index + 1}`),
      from: text(item?.from, "Sender"),
      text: text(item?.text),
      time: text(item?.time),
    })),
  };
}

export function normalizeClusterMessages(value) {
  return asArray(value).map(normalizeClusterMessage);
}

export function normalizeClusterNotifications(value) {
  return asArray(value).map((notification, index) => {
    const source = notification && typeof notification === "object" ? notification : {};
    return {
      ...source,
      id: text(source.id, `notification-${index + 1}`),
      title: text(source.title, "Notification"),
      message: text(source.message),
      type: text(source.type, "Exam"),
      isRead: Boolean(source.isRead ?? source.is_read),
      createdAt: text(source.createdAt || source.created_at),
    };
  });
}

export function buildClusterQuestionReview(question = {}) {
  const normalized = normalizeClusterQuestion(question);
  const leftById = new Map(normalized.matchingLeftItems.map((item) => [item.id, item.text]));
  const rightById = new Map(normalized.matchingRightItems.map((item) => [item.id, item.text]));
  const matchedRightIds = new Set(normalized.matchingConnections.map((connection) => connection.rightId));
  const matchingPairs = normalized.matchingConnections.map((connection) => ({
    left: leftById.get(connection.leftId) || EMPTY_TEXT,
    right: rightById.get(connection.rightId) || EMPTY_TEXT,
  }));
  const configuredAnswers = normalized.correctAnswers.length ? normalized.correctAnswers : resolveChoiceAnswers(normalized, normalized.choices);
  const configAnswers = asArray(normalized.questionConfig.correctAnswers || normalized.questionConfig.answerKey || normalized.questionConfig.acceptedAnswers)
    .map((answer) => resolveChoiceLabel(answer, normalized.choices))
    .filter(Boolean);
  const correctAnswers = configuredAnswers.length ? configuredAnswers : configAnswers;

  return {
    ...normalized,
    type: normalized.questionType,
    choices: normalized.choices,
    correctAnswers,
    partialMatch: normalized.partialMatch,
    matchingPairs,
    matchingDistractors: normalized.matchingRightItems
      .filter((item) => !matchedRightIds.has(item.id))
      .map((item) => item.text)
      .filter(Boolean),
    sequence: correctAnswers.length ? correctAnswers : asArray(normalized.questionConfig.orderItems || normalized.listItems).map(String).filter(Boolean),
  };
}
