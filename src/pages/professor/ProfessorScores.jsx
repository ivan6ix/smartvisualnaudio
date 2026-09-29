import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ListPagination, ListViewToolbar, RecordCardList } from "../../components/ListViewControls";
import { Badge, Button, Card, PageHeader, SearchBox, SelectField } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import useListViewPreference from "../../hooks/useListViewPreference";
import { professorCourses, professorExams } from "../../data/professorData";
import { getListPageSlice } from "../../lib/listView";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

const PAGE_SIZE = 20;
const ATTEMPT_HISTORY_PAGE_SIZE = 20;
const PARTIAL_MATCH_TYPES = new Set(["Multiple Select", "Matching Type", "Ordering / Sequencing", "Enumeration"]);

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function formatPoints(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

function scoreTone(score) {
  if (score === null || score === undefined) return "neutral";
  if (Number(score) >= 75) return "success";
  if (Number(score) >= 60) return "warn";
  return "danger";
}

function statusTone(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("reject") || normalized.includes("expired")) return "danger";
  if (normalized.includes("pending") || normalized.includes("needs") || normalized.includes("reopened")) return "warn";
  return "success";
}

function CompactBadge({ children, tone = "neutral" }) {
  return <span className={`badge badge-${tone} professor-score-status-badge`}>{children}</span>;
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function formatAnswer(value, fileUrl = "") {
  if (value === null || value === undefined) return "No answer";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "No answer";
  if (typeof value === "object") {
    if (value.fileName) return value.fileName;
    if (value.path) return "Submitted file";
    return Object.entries(value).map(([key, item]) => `${key}: ${item}`).join(", ") || "No answer";
  }
  if (fileUrl) return fileUrl;
  return String(value || "No answer");
}

function shortText(value, limit = 96) {
  const text = String(value || "");
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function safeConfig(question) {
  if (!question?.question_config) return {};
  if (typeof question.question_config === "object") return question.question_config;
  try {
    return JSON.parse(question.question_config);
  } catch {
    return {};
  }
}

function allowsPartialMatch(question) {
  if (!PARTIAL_MATCH_TYPES.has(question?.question_type)) return false;
  const config = safeConfig(question);
  if (typeof config.partialMatch === "boolean") return config.partialMatch;
  return question.question_type !== "Multiple Select";
}

function partialMatchLabel(question) {
  if (!PARTIAL_MATCH_TYPES.has(question?.question_type)) return "";
  return allowsPartialMatch(question) ? "Partial Match: On" : "Partial Match: Off";
}

function getSubmittedFile(answer) {
  const value = answer?.answer;
  const path = answer?.file_url || (value && typeof value === "object" ? value.path : "");
  if (!path) return null;
  const storedName = value && typeof value === "object" ? value.fileName : "";
  const fallbackName = path.split("/").pop()?.replace(/^\d+-/, "") || "Submitted file";
  return { path, name: storedName || fallbackName };
}

function getCorrectAnswerLabel(question) {
  if (!question) return "-";
  const config = safeConfig(question);
  if (question.question_type === "Matching Type" && Array.isArray(config.pairs)) return config.pairs.map((pair) => `${pair.left} -> ${pair.right}`).join("; ");
  if (question.question_type === "Ordering / Sequencing" && Array.isArray(config.orderItems)) return config.orderItems.join(", ");
  const answers = Array.isArray(question.correct_answers) ? question.correct_answers : [];
  if (answers.length) return typeof answers[0] === "object" ? answers.map((item) => JSON.stringify(item)).join("; ") : answers.join(", ");
  return question.correct_answer || "-";
}

function paginate(rows, page) {
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  return { rows: rows.slice(start, start + PAGE_SIZE), page: safePage, totalPages, start };
}

function attemptSortValue(attempt) {
  const explicit = Number(attempt?.attempt_number);
  if (Number.isFinite(explicit)) return explicit;
  const submitted = new Date(attempt?.submitted_at || attempt?.started_at || 0).getTime();
  return Number.isFinite(submitted) ? submitted : 0;
}

function sortAttemptsByNumber(attempts) {
  return [...attempts].sort((a, b) => {
    const first = attemptSortValue(a);
    const second = attemptSortValue(b);
    if (first !== second) return first - second;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}

function Pagination({ count, page, onPage }) {
  if (count <= PAGE_SIZE) return null;
  const totalPages = Math.ceil(count / PAGE_SIZE);
  return (
    <div className="professor-score-pagination">
      <span>Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(count, page * PAGE_SIZE)} of {count}</span>
      <button disabled={page <= 1} onClick={() => onPage(page - 1)} type="button">Previous</button>
      {Array.from({ length: Math.min(totalPages, 7) }, (_, index) => index + 1).map((item) => (
        <button className={item === page ? "active" : ""} key={item} onClick={() => onPage(item)} type="button">{item}</button>
      ))}
      <button disabled={page >= totalPages} onClick={() => onPage(page + 1)} type="button">Next</button>
    </div>
  );
}

function buildDemoData() {
  const courses = professorCourses.map((course) => ({ id: course.id, courseName: course.courseName, courseCode: course.courseCode, section: course.section }));
  const exams = professorExams.slice(0, 5).map((exam, index) => ({
    id: exam.id,
    course_id: courses[index % Math.max(courses.length, 1)]?.id,
    title: exam.title,
    exam_title: exam.title,
    exam_type: exam.type || "Exam",
    status: "Published",
    description: exam.period || "Prelim",
  }));
  return { courses, exams, attempts: [], answers: [], questions: [] };
}

function isPublishedExam(exam) {
  return exam?.status === "Published";
}

function isDeadlinePassed(exam) {
  const deadline = exam?.exam_settings?.deadline;
  if (!deadline) return false;
  const time = new Date(deadline).getTime();
  return Number.isFinite(time) && time <= Date.now();
}

export default function ProfessorScores() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { examId, attemptId, questionId } = useParams();
  const [data, setData] = useState(() => hasSupabaseConfig ? { courses: [], exams: [], attempts: [], answers: [], questions: [], reopenRequests: [], assignments: [], exceptions: [], enrollments: [], starts: [] } : { ...buildDemoData(), reopenRequests: [], assignments: [], exceptions: [], enrollments: [], starts: [] });
  const [loading, setLoading] = useState(hasSupabaseConfig);
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("All Courses");
  const [sectionFilter, setSectionFilter] = useState("All Sections");
  const [typeFilter, setTypeFilter] = useState("All Types");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sort, setSort] = useState("Name");
  const [tab, setTab] = useState("students");
  const [expandedStudents, setExpandedStudents] = useState({});
  const [attemptHistoryPages, setAttemptHistoryPages] = useState({});
  const [answerFilter, setAnswerFilter] = useState("All");
  const [page, setPage] = useState(1);
  const [gradeInputs, setGradeInputs] = useState({});
  const listView = useListViewPreference({ role: "professor", page: "scores", defaultView: "table" });

  const loadData = useCallback(async () => {
    if (!hasSupabaseConfig || !user?.id) return;
    setLoading(true);
    try {
      const { data: courseRows, error: coursesError } = await supabase
        .from("courses")
        .select("id, course_name, course_code, section")
        .eq("professor_id", user.id)
        .eq("archived", false)
        .order("created_at", { ascending: false });
      if (coursesError) throw coursesError;

      const courses = (courseRows || []).map((course) => ({ id: course.id, courseName: course.course_name, courseCode: course.course_code, section: course.section }));
      const courseIds = courses.map((course) => course.id);
      if (!courseIds.length) {
        setData({ courses, exams: [], attempts: [], answers: [], questions: [], reopenRequests: [], assignments: [], exceptions: [], enrollments: [], starts: [] });
        return;
      }

      const { data: examRows, error: examsError } = await supabase
        .from("exams")
        .select("id, title, exam_title, course_id, description, semester, exam_type, status, exam_settings, assignment_mode, questions_count, created_at")
        .in("course_id", courseIds)
        .or(`professor_id.eq.${user.id},created_by.eq.${user.id}`)
        .order("created_at", { ascending: false });
      if (examsError) throw examsError;

      const publishedExams = (examRows || []).filter(isPublishedExam);
      const examIds = publishedExams.map((exam) => exam.id);
      if (!examIds.length) {
        setData({ courses, exams: [], attempts: [], answers: [], questions: [], reopenRequests: [], assignments: [], exceptions: [], enrollments: [], starts: [] });
        return;
      }

      const [{ data: attemptRows, error: attemptsError }, { data: questionRows, error: questionsError }, { data: enrollmentRows, error: enrollmentsError }, { data: assignmentRows, error: assignmentsError }, { data: exceptionRows, error: exceptionsError }, { data: startRows, error: startsError }] = await Promise.all([
        supabase
          .from("exam_attempts")
          .select("id, exam_id, score, earned_points, max_points, status, submitted_at, started_at, student_id, profiles:student_id(full_name, student_number, email)")
          .in("exam_id", examIds)
          .order("submitted_at", { ascending: false })
          .limit(5000),
        supabase
          .from("exam_questions")
          .select("id, exam_id, question_text, question_type, choices, correct_answer, correct_answers, question_config, manual_grading, points")
          .in("exam_id", examIds)
          .order("id", { ascending: true }),
        supabase
          .from("course_enrollments")
          .select("course_id, student_id, profiles:student_id(full_name, student_number, email)")
          .in("course_id", courseIds)
          .limit(10000),
        supabase
          .from("exam_student_assignments")
          .select("exam_id, student_id, profiles:student_id(full_name, student_number, email)")
          .in("exam_id", examIds)
          .limit(10000),
        supabase
          .from("exam_student_access_exceptions")
          .select("exam_id, student_id, profiles:student_id(full_name, student_number, email)")
          .in("exam_id", examIds)
          .limit(10000),
        supabase
          .from("exam_start_sessions")
          .select("exam_id, student_id, started_at")
          .in("exam_id", examIds)
          .limit(10000),
      ]);
      if (attemptsError) throw attemptsError;
      if (questionsError) throw questionsError;
      if (enrollmentsError) throw enrollmentsError;
      if (assignmentsError && !["42P01", "PGRST205"].includes(assignmentsError.code)) throw assignmentsError;
      if (exceptionsError && !["42P01", "PGRST205"].includes(exceptionsError.code)) throw exceptionsError;
      if (startsError) throw startsError;

      const attemptIds = (attemptRows || []).map((attempt) => attempt.id);
      let answerRows = [];
      let reopenRows = [];
      if (attemptIds.length) {
        const [{ data: answers, error: answersError }, { data: requests, error: requestsError }] = await Promise.all([
          supabase
            .from("exam_attempt_answers")
            .select("id, attempt_id, question_id, answer, file_url, earned_points, max_points, is_correct, needs_manual_grading, graded_at")
            .in("attempt_id", attemptIds)
            .limit(20000),
          supabase
            .from("exam_attempt_reopen_requests")
            .select("id, attempt_id, exam_id, student_id, reason, status, reviewed_at, reopened_started_at, original_submitted_at, original_score, original_earned_points, original_max_points, original_status, created_at")
            .in("attempt_id", attemptIds)
            .limit(5000),
        ]);
        if (answersError) throw answersError;
        if (requestsError) throw requestsError;
        answerRows = answers || [];
        reopenRows = requests || [];
      }

      setData({ courses, exams: publishedExams, attempts: attemptRows || [], answers: answerRows, questions: questionRows || [], reopenRequests: reopenRows, assignments: assignmentRows || [], exceptions: exceptionRows || [], enrollments: enrollmentRows || [], starts: startRows || [] });
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setPage(1);
  }, [answerFilter, courseFilter, examId, questionId, search, sectionFilter, sort, statusFilter, tab, typeFilter]);

  const courseById = useMemo(() => new Map(data.courses.map((course) => [course.id, course])), [data.courses]);
  const examById = useMemo(() => new Map(data.exams.map((exam) => [exam.id, exam])), [data.exams]);
  const questionById = useMemo(() => new Map(data.questions.map((question) => [question.id, question])), [data.questions]);
  const answersByAttempt = useMemo(() => data.answers.reduce((items, answer) => {
    (items[answer.attempt_id] ||= []).push(answer);
    return items;
  }, {}), [data.answers]);
  const reopenByAttempt = useMemo(() => data.reopenRequests.reduce((items, request) => {
    items[request.attempt_id] = request;
    return items;
  }, {}), [data.reopenRequests]);

  const attempts = useMemo(() => data.attempts.map((attempt) => {
    const exam = examById.get(attempt.exam_id) || {};
    const course = courseById.get(exam.course_id) || {};
    const answers = answersByAttempt[attempt.id] || [];
    const pending = answers.some((answer) => answer.needs_manual_grading) || String(attempt.status || "").toLowerCase().includes("pending manual");
    return {
      ...attempt,
      exam,
      course,
      answers,
      studentName: attempt.profiles?.full_name || attempt.profiles?.email || "Unknown student",
      studentNumber: attempt.profiles?.student_number || "No student ID",
      section: course.section || "No section",
      pendingManual: pending,
      reopenRequest: reopenByAttempt[attempt.id] || null,
      displayStatus: attempt.status === "Reopened" ? "Reopened" : pending ? "Needs Grading" : attempt.status || "Submitted",
    };
  }), [answersByAttempt, courseById, examById, reopenByAttempt, data.attempts]);

  const examSummaries = useMemo(() => data.exams.map((exam) => {
    const course = courseById.get(exam.course_id) || {};
    const examAttempts = attempts.filter((attempt) => attempt.exam_id === exam.id);
    const assignedPopulation = exam.assignment_mode === "selected_students"
      ? data.assignments.filter((assignment) => assignment.exam_id === exam.id).length
      : data.enrollments.filter((enrollment) => enrollment.course_id === exam.course_id).length;
    const totalPoints = data.questions.filter((question) => question.exam_id === exam.id).reduce((total, question) => total + Number(question.points || 0), 0);
    return {
      ...exam,
      course,
      attempts: examAttempts,
      students: assignedPopulation || new Set(examAttempts.map((attempt) => attempt.student_id)).size,
      pending: examAttempts.filter((attempt) => attempt.pendingManual).length,
      totalPoints,
    };
  }), [attempts, courseById, data.assignments, data.enrollments, data.exams, data.questions]);

  const selectedExam = examId ? examSummaries.find((exam) => exam.id === examId) : null;
  const examQuestions = useMemo(() => data.questions.filter((question) => question.exam_id === examId), [data.questions, examId]);
  const examAttempts = useMemo(() => attempts.filter((attempt) => attempt.exam_id === examId), [attempts, examId]);
  const selectedAttempt = attemptId ? attempts.find((attempt) => attempt.id === attemptId) : null;
  const selectedQuestion = questionId ? questionById.get(questionId) : null;
  const selectedQuestionIndex = selectedQuestion ? examQuestions.findIndex((question) => question.id === selectedQuestion.id) : -1;
  const startsByExamStudent = useMemo(() => data.starts.reduce((items, start) => {
    items[`${start.exam_id}:${start.student_id}`] = start;
    return items;
  }, {}), [data.starts]);

  const students = useMemo(() => {
    const groups = new Map();
    if (selectedExam) {
      const population = selectedExam.assignment_mode === "selected_students"
        ? data.assignments.filter((assignment) => assignment.exam_id === selectedExam.id)
        : data.enrollments.filter((enrollment) => enrollment.course_id === selectedExam.course_id).map((enrollment) => ({ ...enrollment, exam_id: selectedExam.id }));
      population.forEach((row) => {
        const profile = row.profiles || {};
        groups.set(row.student_id, {
          studentId: row.student_id,
          studentName: profile.full_name || profile.email || "Unknown student",
          studentNumber: profile.student_number || "No student ID",
          section: selectedExam.course?.section || "No section",
          attempts: [],
          accessType: "Assigned",
        });
      });
      data.exceptions.filter((row) => row.exam_id === selectedExam.id).forEach((row) => {
        if (groups.has(row.student_id)) return;
        const profile = row.profiles || {};
        groups.set(row.student_id, {
          studentId: row.student_id,
          studentName: profile.full_name || profile.email || "Unknown student",
          studentNumber: profile.student_number || "No student ID",
          section: selectedExam.course?.section || "No section",
          attempts: [],
          accessType: "Special Access",
        });
      });
    }
    examAttempts.forEach((attempt) => {
      const current = groups.get(attempt.student_id) || { studentId: attempt.student_id, studentName: attempt.studentName, studentNumber: attempt.studentNumber, section: attempt.section, attempts: [] };
      current.attempts.push(attempt);
      groups.set(attempt.student_id, current);
    });
    return Array.from(groups.values()).map((student) => {
      const ordered = sortAttemptsByNumber(student.attempts);
      const graded = ordered.filter((attempt) => attempt.status !== "Reopened" && !attempt.pendingManual && attempt.score !== null && attempt.score !== undefined);
      const finalAttempt = graded.length ? graded.reduce((best, attempt) => Number(attempt.score || 0) > Number(best.score || 0) ? attempt : best, graded[0]) : ordered[ordered.length - 1];
      const hasStarted = selectedExam && startsByExamStudent[`${selectedExam.id}:${student.studentId}`];
      return {
        ...student,
        attempts: ordered.map((attempt, index) => ({ ...attempt, attemptNumber: Number(attempt.attempt_number) || index + 1 })),
        finalAttempt,
        status: ordered.length
          ? ordered.some((attempt) => attempt.reopenRequest?.status === "Pending") ? "Reopen Requested" : ordered.some((attempt) => attempt.status === "Reopened") ? "Reopened" : ordered.some((attempt) => attempt.pendingManual) && !graded.length ? "Needs Grading" : "Submitted"
          : hasStarted ? "In Progress" : "Not Started",
      };
    });
  }, [data.assignments, data.enrollments, data.exceptions, examAttempts, selectedExam, startsByExamStudent]);

  const filteredStudents = useMemo(() => {
    const term = normalizeText(search);
    const rows = students
      .filter((student) => !term || normalizeText(`${student.studentName} ${student.studentNumber} ${student.section}`).includes(term))
      .filter((student) => statusFilter === "All" || student.status === statusFilter)
      .filter((student) => sectionFilter === "All Sections" || student.section === sectionFilter);
    return [...rows].sort((a, b) => {
      if (sort === "Score") return Number(b.finalAttempt?.score ?? -1) - Number(a.finalAttempt?.score ?? -1);
      if (sort === "Status") return a.status.localeCompare(b.status) || a.studentName.localeCompare(b.studentName);
      return a.studentName.localeCompare(b.studentName);
    });
  }, [search, sectionFilter, sort, statusFilter, students]);

  const questionSummaries = useMemo(() => examQuestions.map((question, index) => {
    const answers = data.answers.filter((answer) => {
      const attempt = attempts.find((item) => item.id === answer.attempt_id);
      return answer.question_id === question.id && attempt?.exam_id === examId;
    });
    const pending = answers.filter((answer) => answer.needs_manual_grading).length;
    return { ...question, number: index + 1, answered: answers.filter((answer) => formatAnswer(answer.answer, answer.file_url) !== "No answer").length, pending, status: pending ? "Needs Grading" : "Complete", manual: Boolean(question.manual_grading) };
  }), [attempts, data.answers, examId, examQuestions]);

  const filteredQuestions = useMemo(() => questionSummaries.filter((question) => {
    if (answerFilter === "Needs Grading") return question.pending > 0;
    if (answerFilter === "Complete") return question.pending === 0;
    if (answerFilter === "Auto-Graded") return !question.manual;
    if (answerFilter === "Manual") return question.manual;
    return true;
  }), [answerFilter, questionSummaries]);

  const questionAnswers = useMemo(() => {
    if (!selectedQuestion) return [];
    return sortAttemptsByNumber(examAttempts).map((attempt, index) => {
      const answer = (answersByAttempt[attempt.id] || []).find((item) => item.question_id === selectedQuestion.id);
      return { id: answer?.id || `missing-${attempt.id}`, attempt, attemptNumber: index + 1, answer, missing: !answer };
    });
  }, [answersByAttempt, examAttempts, selectedQuestion]);

  const filteredQuestionAnswers = useMemo(() => {
    const term = normalizeText(search);
    return questionAnswers
      .filter((row) => !term || normalizeText(`${row.attempt.studentName} ${row.attempt.studentNumber} ${formatAnswer(row.answer?.answer, row.answer?.file_url)}`).includes(term))
      .filter((row) => {
        if (answerFilter === "Pending") return row.answer?.needs_manual_grading;
        if (answerFilter === "Graded") return row.answer && !row.answer.needs_manual_grading;
        if (answerFilter === "No Answer") return row.missing || formatAnswer(row.answer?.answer, row.answer?.file_url) === "No answer";
        return true;
      });
  }, [answerFilter, questionAnswers, search]);

  async function saveManualGrade(answer) {
    const question = questionById.get(answer.question_id);
    const maxPoints = Number(answer.max_points ?? question?.points ?? 0);
    const value = Number(gradeInputs[answer.id] ?? answer.earned_points ?? "");
    if (!Number.isFinite(value) || value < 0 || value > maxPoints) {
      toast.error(`Enter a score from 0 to ${formatPoints(maxPoints)}.`);
      return;
    }
    if (!hasSupabaseConfig) {
      toast.success("Manual score saved.");
      return;
    }
    const { error } = await supabase.rpc("grade_exam_attempt_answer", { p_answer_id: answer.id, p_earned_points: value });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Manual answer graded.");
    await loadData();
  }

  async function reviewReopenRequest(request, decision) {
    if (!request?.id) return;
    const { error } = await supabase.rpc("review_exam_attempt_reopen_request", {
      p_request_id: request.id,
      p_decision: decision,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(decision === "Approved" ? "Attempt reopened." : "Reopening request rejected.");
    await loadData();
  }

  async function openSubmittedFile(answer) {
    const file = getSubmittedFile(answer);
    if (!file?.path) {
      toast.error("Submission not found.");
      return;
    }
    if (!hasSupabaseConfig) {
      toast.error("Secure file access requires Supabase.");
      return;
    }
    const { data: signed, error } = await supabase.storage.from("exam-submissions").createSignedUrl(file.path, 60 * 10);
    if (error || !signed?.signedUrl) {
      toast.error(error?.message || "Unable to generate secure file link.");
      return;
    }
    window.open(signed.signedUrl, "_blank", "noopener,noreferrer");
  }

  if (loading) return <section className="professor-scores-page"><PageHeader title="Scores" subtitle="Loading exam results..." /></section>;

  if (attemptId) {
    return (
      <AttemptView
        attempt={selectedAttempt}
        exam={selectedAttempt ? examById.get(selectedAttempt.exam_id) : null}
        questions={selectedAttempt ? data.questions.filter((question) => question.exam_id === selectedAttempt.exam_id) : []}
        answers={selectedAttempt ? answersByAttempt[selectedAttempt.id] || [] : []}
        gradeInputs={gradeInputs}
        onGradeInput={setGradeInputs}
        onSaveGrade={saveManualGrade}
        onOpenFile={openSubmittedFile}
        onReviewReopen={reviewReopenRequest}
        onBack={() => navigate(`/professor/scores/${selectedAttempt?.exam_id || examId || ""}`)}
      />
    );
  }

  if (questionId) {
    return (
      <QuestionReviewView
        exam={selectedExam}
        question={selectedQuestion}
        questionIndex={selectedQuestionIndex}
        questions={examQuestions}
        rows={filteredQuestionAnswers}
        search={search}
        setSearch={setSearch}
        filter={answerFilter}
        setFilter={setAnswerFilter}
        page={page}
        setPage={setPage}
        gradeInputs={gradeInputs}
        onGradeInput={setGradeInputs}
        onSaveGrade={saveManualGrade}
        onOpenFile={openSubmittedFile}
      />
    );
  }

  if (examId) {
    const sections = ["All Sections", ...new Set(students.map((student) => student.section).filter(Boolean))];
    const pageData = paginate(tab === "students" ? filteredStudents : filteredQuestions, page);
    return (
      <section className="professor-scores-page">
        <PageHeader
          title={selectedExam?.exam_title || selectedExam?.title || "Exam Results"}
          subtitle={`${selectedExam?.exam_type || "Exam"} | ${formatPoints(selectedExam?.totalPoints)} pts | ${students.length} student${students.length === 1 ? "" : "s"} | ${selectedExam?.pending || 0} pending`}
          actions={<Button variant="light" onClick={() => navigate("/professor/scores")}>Back to Scores</Button>}
        />
        <Card>
          <div className="professor-score-tabs">
            <button className={tab === "students" ? "active" : ""} onClick={() => setTab("students")} type="button">Students</button>
            <button className={tab === "questions" ? "active" : ""} onClick={() => setTab("questions")} type="button">By Question</button>
          </div>
          {tab === "students" ? (
            <>
              <div className="professor-score-filters compact">
                <SearchBox value={search} onChange={setSearch} placeholder="Search student" />
                <SelectField label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  {["All", "Submitted", "In Progress", "Not Started", "Needs Grading", "Reopen Requested", "Reopened"].map((item) => <option key={item}>{item}</option>)}
                </SelectField>
                <SelectField label="Section" value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)}>
                  {sections.map((item) => <option key={item}>{item}</option>)}
                </SelectField>
                <SelectField label="Sort" value={sort} onChange={(event) => setSort(event.target.value)}>
                  {["Name", "Score", "Status"].map((item) => <option key={item}>{item}</option>)}
                </SelectField>
              </div>
              <StudentsTable
                rows={pageData.rows}
                expandedStudents={expandedStudents}
                setExpandedStudents={setExpandedStudents}
                attemptHistoryPages={attemptHistoryPages}
                setAttemptHistoryPages={setAttemptHistoryPages}
                onReviewReopen={reviewReopenRequest}
              />
              <Pagination count={filteredStudents.length} page={pageData.page} onPage={setPage} />
            </>
          ) : (
            <>
              <div className="professor-score-filters compact">
                <SelectField label="Question Filter" value={answerFilter} onChange={(event) => setAnswerFilter(event.target.value)}>
                  {["All", "Needs Grading", "Complete", "Auto-Graded", "Manual"].map((item) => <option key={item}>{item}</option>)}
                </SelectField>
              </div>
              <QuestionsTable rows={pageData.rows} examId={examId} />
              <Pagination count={filteredQuestions.length} page={pageData.page} onPage={setPage} />
            </>
          )}
        </Card>
      </section>
    );
  }

  const filteredExams = examSummaries
    .filter(isPublishedExam)
    .filter((exam) => courseFilter === "All Courses" || exam.course?.courseCode === courseFilter)
    .filter((exam) => sectionFilter === "All Sections" || exam.course?.section === sectionFilter)
    .filter((exam) => typeFilter === "All Types" || exam.exam_type === typeFilter)
    .filter((exam) => !search.trim() || normalizeText(`${exam.exam_title} ${exam.title} ${exam.exam_type} ${exam.course?.courseCode} ${exam.course?.section}`).includes(normalizeText(search)));
  const examPage = getListPageSlice(filteredExams, page, listView.pageSize);
  const courseOptions = ["All Courses", ...new Set(data.courses.map((course) => course.courseCode).filter(Boolean))];
  const sectionOptions = ["All Sections", ...new Set(data.courses.filter((course) => courseFilter === "All Courses" || course.courseCode === courseFilter).map((course) => course.section).filter(Boolean))];
  const typeOptions = ["All Types", ...new Set(data.exams.map((exam) => exam.exam_type || "Exam").filter(Boolean))];

  return (
    <section className="professor-scores-page">
      <PageHeader title="Scores" subtitle="Open an exam or task to review students, attempts, questions, and manual grading." />
      <Card>
        <div className="professor-score-filters">
          <SearchBox value={search} onChange={setSearch} placeholder="Search exams or sections" />
          <SelectField label="Course" value={courseFilter} onChange={(event) => { setCourseFilter(event.target.value); setSectionFilter("All Sections"); }}>
            {courseOptions.map((item) => <option key={item}>{item}</option>)}
          </SelectField>
          <SelectField label="Section" value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)}>
            {sectionOptions.map((item) => <option key={item}>{item}</option>)}
          </SelectField>
          <SelectField label="Type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            {typeOptions.map((item) => <option key={item}>{item}</option>)}
          </SelectField>
        </div>
        <ListViewToolbar
          controls={{
            cardDensity: listView.cardDensity,
            onCardDensity: listView.setCardDensity,
            onTableDensity: listView.setTableDensity,
            onView: (nextView) => setPage(listView.switchViewPreservingPage(nextView, examPage.page, filteredExams.length)),
            tableDensity: listView.tableDensity,
            view: listView.view,
          }}
        />
        <ExamList rows={examPage.rows} view={listView.view} density={listView.viewDensity} />
        <ListPagination count={filteredExams.length} page={examPage.page} pageSize={listView.pageSize} onPage={setPage} />
      </Card>
    </section>
  );
}

function ExamList({ density, rows, view }) {
  const columns = [
    { key: "exam", label: "Exam / Task", render: (exam) => <Link to={`/professor/scores/${exam.id}`}><strong>{exam.exam_title || exam.title}</strong></Link> },
    { key: "type", label: "Type", render: (exam) => exam.exam_type || "Exam" },
    { key: "students", label: "Students" },
    { key: "pending", label: "Pending Grading" },
    { key: "status", label: "Status", render: (exam) => <CompactBadge tone={statusTone(exam.status)}>{exam.status || "Draft"}</CompactBadge> },
  ];
  if (view === "cards") {
    return (
      <RecordCardList
        columns={columns}
        density={density}
        rows={rows}
        titleKey="exam"
        renderActions={(exam) => <Link className="professor-score-action" to={`/professor/scores/${exam.id}`}>View</Link>}
      />
    );
  }
  return (
    <div className="professor-score-table-wrap">
      <table className={`professor-score-table compact list-table-${density}`}>
        <thead><tr><th>Exam / Task</th><th>Type</th><th>Students</th><th>Pending Grading</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          {rows.map((exam) => (
            <tr key={exam.id}>
              <td><Link to={`/professor/scores/${exam.id}`}><strong>{exam.exam_title || exam.title}</strong></Link><span>{exam.course?.courseCode} - {exam.course?.section}</span></td>
              <td>{exam.exam_type || "Exam"}</td>
              <td>{exam.students}</td>
              <td>{exam.pending}</td>
              <td><CompactBadge tone={statusTone(exam.status)}>{exam.status || "Draft"}</CompactBadge></td>
              <td><Link className="professor-score-action" to={`/professor/scores/${exam.id}`}>View</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length ? <div className="professor-exams-empty">No exams match your filters.</div> : null}
    </div>
  );
}

function StudentsTable({ rows, expandedStudents, setExpandedStudents, attemptHistoryPages, setAttemptHistoryPages, onReviewReopen }) {
  function toggleStudent(studentId) {
    const isOpening = !expandedStudents[studentId];
    if (isOpening) setAttemptHistoryPages((pages) => ({ ...pages, [studentId]: 1 }));
    setExpandedStudents((current) => ({ ...current, [studentId]: isOpening }));
  }

  return (
    <div className="professor-score-table-wrap">
      <table className="professor-score-table compact">
        <thead><tr><th>Student</th><th>Section</th><th>Final Score</th><th>Status</th><th>Attempts</th><th>Action</th></tr></thead>
        <tbody>
          {rows.map((student) => {
            const final = student.finalAttempt;
            const isExpanded = Boolean(expandedStudents[student.studentId]);
            return (
              <FragmentRows key={student.studentId}>
                <tr>
                  <td><strong>{student.studentName}</strong><span>{student.studentNumber}</span></td>
                  <td>{student.section}</td>
                  <td>{final?.earned_points !== null && final?.earned_points !== undefined && final?.max_points ? `${formatPoints(final.earned_points)} / ${formatPoints(final.max_points)}` : final?.score !== null && final?.score !== undefined ? `${Number(final.score).toFixed(2)}%` : "-"}</td>
                  <td><CompactBadge tone={statusTone(student.status)}>{student.status}</CompactBadge></td>
                  <td>{student.attempts.length}</td>
                  <td>
                    {!student.attempts.length ? (
                      <span className="professor-score-muted">{student.accessType || "Assigned"}</span>
                    ) : student.attempts.length === 1 ? (
                      <Link className="professor-score-action" to={`/professor/scores/${final.exam_id}/attempt/${final.id}`}>View Attempt</Link>
                    ) : (
                      <button className="professor-score-link-button" onClick={() => toggleStudent(student.studentId)} type="button">See Attempts {isExpanded ? "^" : "v"}</button>
                    )}
                  </td>
                </tr>
                {isExpanded ? (
                  <AttemptHistoryRow
                    attempts={student.attempts}
                    finalAttempt={final}
                    onReviewReopen={onReviewReopen}
                    page={attemptHistoryPages[student.studentId] || 1}
                    setPage={(nextPage) => setAttemptHistoryPages((pages) => ({ ...pages, [student.studentId]: nextPage }))}
                  />
                ) : null}
              </FragmentRows>
            );
          })}
        </tbody>
      </table>
      {!rows.length ? <div className="professor-exams-empty">No student submissions match your filters.</div> : null}
    </div>
  );
}

function FragmentRows({ children }) {
  return children;
}

function AttemptHistoryRow({ attempts, finalAttempt, onReviewReopen, page, setPage }) {
  const totalPages = Math.max(1, Math.ceil(attempts.length / ATTEMPT_HISTORY_PAGE_SIZE));
  const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  const start = (safePage - 1) * ATTEMPT_HISTORY_PAGE_SIZE;
  const visibleAttempts = attempts.slice(start, start + ATTEMPT_HISTORY_PAGE_SIZE);

  return (
    <tr className="professor-attempt-history-row">
      <td colSpan={6}>
        <table>
          <tbody>
            {visibleAttempts.map((attempt) => (
              <tr key={attempt.id}>
                <td>Attempt {attempt.attemptNumber}</td>
                <td>{attempt.earned_points !== null && attempt.earned_points !== undefined && attempt.max_points ? `${formatPoints(attempt.earned_points)} / ${formatPoints(attempt.max_points)}` : attempt.score === null || attempt.score === undefined ? "Pending" : `${Number(attempt.score).toFixed(2)}%`}</td>
                <td>{attempt.displayStatus}</td>
                <td>{attempt.id === finalAttempt?.id && attempt.status !== "Reopened" ? <CompactBadge tone="blue">Highest</CompactBadge> : attempt.reopenRequest ? <CompactBadge tone={statusTone(attempt.reopenRequest.status)}>{attempt.reopenRequest.status} Reopen</CompactBadge> : null}</td>
                <td>
                  <Link className="professor-score-action" to={`/professor/scores/${attempt.exam_id}/attempt/${attempt.id}`}>View</Link>
                  {attempt.reopenRequest?.status === "Pending" ? <ReopenRequestActions attempt={attempt} onReviewReopen={onReviewReopen} /> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {attempts.length > ATTEMPT_HISTORY_PAGE_SIZE ? (
          <div className="professor-attempt-pagination">
            <span>Showing {start + 1}-{Math.min(attempts.length, start + ATTEMPT_HISTORY_PAGE_SIZE)} of {attempts.length} attempts</span>
            <button disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} type="button">Previous</button>
            <span>Page {safePage} of {totalPages}</span>
            <button disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)} type="button">Next</button>
          </div>
        ) : null}
      </td>
    </tr>
  );
}

function ReopenRequestActions({ attempt, onReviewReopen }) {
  const expired = isDeadlinePassed(attempt.exam);
  if (!attempt.reopenRequest) return null;
  if (expired) return <span className="professor-reopen-expired">Deadline passed</span>;
  return (
    <span className="professor-reopen-actions">
      <button onClick={() => onReviewReopen(attempt.reopenRequest, "Approved")} type="button">Approve & Reopen</button>
      <button onClick={() => onReviewReopen(attempt.reopenRequest, "Rejected")} type="button">Reject</button>
    </span>
  );
}

function QuestionsTable({ rows, examId }) {
  return (
    <div className="professor-score-table-wrap">
      <table className="professor-score-table compact">
        <thead><tr><th>#</th><th>Question</th><th>Type</th><th>Points</th><th>Answered</th><th>Pending</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          {rows.map((question) => (
            <tr key={question.id}>
              <td>{question.number}</td>
              <td title={question.question_text}>{shortText(question.question_text)}</td>
              <td>{question.question_type}</td>
              <td>{formatPoints(question.points)}</td>
              <td>{question.answered}</td>
              <td>{question.pending}</td>
              <td><CompactBadge tone={statusTone(question.status)}>{question.status}</CompactBadge></td>
              <td><Link className="professor-score-action" to={`/professor/scores/${examId}/questions/${question.id}`}>{question.pending ? "Grade" : "View"}</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length ? <div className="professor-exams-empty">No questions match your filters.</div> : null}
    </div>
  );
}

function FileAnswerCell({ answer, limit = 80, onOpenFile }) {
  const file = getSubmittedFile(answer);
  if (file) {
    return (
      <span className="professor-file-answer">
        <span title={file.name}>{shortText(file.name, limit)}</span>
        <button onClick={() => onOpenFile(answer)} type="button">Open File</button>
      </span>
    );
  }
  const label = formatAnswer(answer?.answer, answer?.file_url);
  return <span title={label}>{shortText(label, limit)}</span>;
}

function AttemptView({ attempt, exam, questions, answers, gradeInputs, onGradeInput, onSaveGrade, onOpenFile, onReviewReopen, onBack }) {
  if (!attempt) return <section className="professor-scores-page"><PageHeader title="Attempt Not Found" actions={<Button variant="light" onClick={onBack}>Back</Button>} /></section>;
  const answersByQuestion = new Map(answers.map((answer) => [answer.question_id, answer]));
  return (
    <section className="professor-scores-page">
      <PageHeader title="Attempt Details" subtitle={`${attempt.studentName} | ${exam?.exam_title || exam?.title || "Exam"}`} actions={<Button variant="light" onClick={onBack}>Back</Button>} />
      <Card>
        <div className="professor-score-summary left professor-attempt-summary">
          <Badge tone="neutral">{attempt.section}</Badge>
          <Badge tone="neutral">Submitted {formatDateTime(attempt.submitted_at)}</Badge>
          <Badge tone={scoreTone(attempt.score)}>{attempt.score === null || attempt.score === undefined ? "Pending" : `${Number(attempt.score).toFixed(2)}%`}</Badge>
          <Badge tone={statusTone(attempt.displayStatus)}>{attempt.displayStatus}</Badge>
          <Badge tone="blue">{formatPoints(attempt.earned_points)} / {formatPoints(attempt.max_points)} pts</Badge>
        </div>
        {attempt.reopenRequest ? (
          <div className="professor-reopen-review">
            <div>
              <strong>Reopen Request</strong>
              <span>{attempt.reopenRequest.status} - Requested {formatDateTime(attempt.reopenRequest.created_at)}</span>
              <p>{attempt.reopenRequest.reason}</p>
              {isDeadlinePassed(exam) && attempt.reopenRequest.status === "Pending" ? <small>The deadline has passed. This request can no longer be approved.</small> : null}
            </div>
            {attempt.reopenRequest.status === "Pending" ? <ReopenRequestActions attempt={attempt} onReviewReopen={onReviewReopen} /> : null}
          </div>
        ) : null}
      </Card>
      <Card>
        <div className="professor-score-table-wrap">
          <table className="professor-score-table">
            <thead><tr><th>#</th><th>Question</th><th>Type</th><th>Answer</th><th>Correct Answer</th><th>Score</th><th>Status</th><th>Partial Match</th><th>Action</th></tr></thead>
            <tbody>
              {questions.map((question, index) => {
                const answer = answersByQuestion.get(question.id);
                return (
                  <tr key={question.id}>
                    <td>{index + 1}</td>
                    <td title={question.question_text}>{shortText(question.question_text, 80)}</td>
                    <td>{question.question_type}</td>
                    <td><FileAnswerCell answer={answer} onOpenFile={onOpenFile} /></td>
                    <td title={getCorrectAnswerLabel(question)}>{shortText(getCorrectAnswerLabel(question), 80)}</td>
                    <td>{answer?.earned_points === null || answer?.earned_points === undefined ? "-" : formatPoints(answer.earned_points)} / {formatPoints(answer?.max_points ?? question.points)}</td>
                    <td><CompactBadge tone={answer?.needs_manual_grading ? "warn" : "success"}>{answer?.needs_manual_grading ? "Pending" : answer ? "Graded" : "No Answer"}</CompactBadge></td>
                    <td>{allowsPartialMatch(question) ? "Enabled" : "-"}</td>
                    <td>{answer && question.manual_grading ? <GradeControl answer={answer} question={question} gradeInputs={gradeInputs} onGradeInput={onGradeInput} onSaveGrade={onSaveGrade} /> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

function QuestionReviewView({ exam, question, questionIndex, questions, rows, search, setSearch, filter, setFilter, page, setPage, gradeInputs, onGradeInput, onSaveGrade, onOpenFile }) {
  if (!question) return <section className="professor-scores-page"><PageHeader title="Question Not Found" /></section>;
  const pageData = paginate(rows, page);
  const previous = questions[questionIndex - 1];
  const next = questions[questionIndex + 1];
  const pending = rows.filter((row) => row.answer?.needs_manual_grading).length;
  const currentExamId = exam?.id || question.exam_id;
  return (
    <section className="professor-scores-page">
      <PageHeader
        title={`Question ${questionIndex + 1} / ${questions.length}`}
        subtitle={`${exam?.exam_title || exam?.title || "Exam"} | ${question.question_type} | ${formatPoints(question.points)} pts | ${pending} pending`}
        actions={<div className="professor-score-header-actions">{previous ? <Link className="professor-score-action" to={`/professor/scores/${currentExamId}/questions/${previous.id}`}>Previous Question</Link> : null}{next ? <Link className="professor-score-action" to={`/professor/scores/${currentExamId}/questions/${next.id}`}>Next Question</Link> : null}</div>}
      />
      <Card>
        <h2>{question.question_text}</h2>
        {partialMatchLabel(question) ? <p>{partialMatchLabel(question)}</p> : null}
      </Card>
      <Card>
        <div className="professor-score-filters compact">
          <SearchBox value={search} onChange={setSearch} placeholder="Search student or answer" />
          <SelectField label="Status" value={filter} onChange={(event) => setFilter(event.target.value)}>
            {["All", "Pending", "Graded", "No Answer"].map((item) => <option key={item}>{item}</option>)}
          </SelectField>
        </div>
        <div className="professor-score-table-wrap">
          <table className="professor-score-table">
            <thead><tr><th>Student</th><th>Attempt</th><th>Answer</th><th>Score</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {pageData.rows.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.attempt.studentName}</strong><span>{row.attempt.studentNumber}</span></td>
                  <td>Attempt {row.attemptNumber}</td>
                  <td><FileAnswerCell answer={row.answer} limit={120} onOpenFile={onOpenFile} /></td>
                  <td>{row.answer?.earned_points === null || row.answer?.earned_points === undefined ? "-" : formatPoints(row.answer.earned_points)} / {formatPoints(row.answer?.max_points ?? question.points)}</td>
                  <td><CompactBadge tone={row.answer?.needs_manual_grading ? "warn" : row.answer ? "success" : "neutral"}>{row.answer?.needs_manual_grading ? "Pending" : row.answer ? "Graded" : "No Answer"}</CompactBadge></td>
                  <td>{row.answer && question.manual_grading ? <GradeControl answer={row.answer} question={question} gradeInputs={gradeInputs} onGradeInput={onGradeInput} onSaveGrade={onSaveGrade} /> : <Link className="professor-score-action" to={`/professor/scores/${currentExamId}/attempt/${row.attempt.id}`}>View Attempt</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!pageData.rows.length ? <div className="professor-exams-empty">No answers match your filters.</div> : null}
        </div>
        <Pagination count={rows.length} page={pageData.page} onPage={setPage} />
      </Card>
    </section>
  );
}

function GradeControl({ answer, question, gradeInputs, onGradeInput, onSaveGrade }) {
  const maxPoints = Number(answer.max_points ?? question.points ?? 0);
  return (
    <div className="professor-manual-grade inline">
      <input min="0" max={maxPoints} step="0.01" type="number" value={gradeInputs[answer.id] ?? answer.earned_points ?? ""} onChange={(event) => onGradeInput((current) => ({ ...current, [answer.id]: event.target.value }))} />
      <button onClick={() => onSaveGrade(answer)} type="button">Save</button>
    </div>
  );
}
