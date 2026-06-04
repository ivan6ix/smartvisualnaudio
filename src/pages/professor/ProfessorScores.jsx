import { useEffect, useMemo, useState } from "react";
import { FiClock } from "react-icons/fi";
import { toast } from "sonner";
import { Badge, Button, Card, PageHeader, SearchBox, SelectField } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { professorCourses, professorExams } from "../../data/professorData";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function mapCourse(course) {
  return {
    id: course.id,
    courseName: course.course_name || course.courseName,
    courseCode: course.course_code || course.courseCode,
    section: course.section,
  };
}

function scoreTone(score) {
  if (score === null || score === undefined) return "neutral";
  if (Number(score) >= 75) return "success";
  if (Number(score) >= 60) return "warn";
  return "danger";
}

function formatAnswer(value) {
  if (value === null || value === undefined) return "-";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") {
    if (value.fileName) return value.fileName;
    return Object.entries(value).map(([key, item]) => `${key}: ${item}`).join(", ");
  }
  return String(value);
}

function computeManualAttemptTotals(rows = []) {
  const earned = rows.reduce((total, item) => {
    if (item.earned_points !== null && item.earned_points !== undefined) return total + Number(item.earned_points || 0);
    return total + (item.is_correct ? Number(item.exam_questions?.points || item.max_points || 0) : 0);
  }, 0);
  const max = rows.reduce((total, item) => total + Number(item.max_points || item.exam_questions?.points || 0), 0);
  const remainingManual = rows.some((item) => item.needs_manual_grading);
  const score = max ? Number(((earned / max) * 100).toFixed(2)) : 0;

  return { earned, max, remainingManual, score };
}

function buildDemoScores() {
  return professorCourses.flatMap((course) => professorExams
    .filter((exam) => exam.course === course.courseName && exam.section === course.section)
    .slice(0, 2)
    .map((exam, index) => ({
      id: `${course.id}-${exam.id}-${index}`,
      courseId: course.id,
      courseCode: course.courseCode,
      courseName: course.courseName,
      section: course.section,
      examId: exam.id,
      period: exam.period || "Prelim",
      type: exam.type || "Exam",
      student: index ? "Arvin Cole" : "Lia Mendoza",
      studentId: index ? "demo-student-2" : "demo-student-1",
      studentNumber: index ? "S-0002" : "S-0001",
      exam: exam.title,
      score: exam.attempts ? 88 - index * 9 : null,
      attempts: exam.attempts ? 1 : 0,
      takenAt: exam.attempts ? "Demo timestamp" : "-",
      submittedAt: exam.attempts ? "Demo timestamp" : "-",
    })));
}

export default function ProfessorScores() {
  const { user } = useAuth();
  const [courses, setCourses] = useState(() => hasSupabaseConfig ? [] : professorCourses.map(mapCourse));
  const [scores, setScores] = useState(() => hasSupabaseConfig ? [] : buildDemoScores());
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("All Courses");
  const [sectionFilter, setSectionFilter] = useState("All Sections");
  const [periodFilter, setPeriodFilter] = useState("All Periods");
  const [typeFilter, setTypeFilter] = useState("All Types");
  const [examFilter, setExamFilter] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualFilters, setManualFilters] = useState({ course: "All Courses", section: "All Sections", exam: "All Exams" });
  const [manualAttempt, setManualAttempt] = useState(null);
  const [manualAnswers, setManualAnswers] = useState([]);
  const [manualScores, setManualScores] = useState({});
  const [manualEditMode, setManualEditMode] = useState({});

  useEffect(() => {
    if (!hasSupabaseConfig || !user?.id) return;

    async function loadScores() {
      const { data: courseRows, error: coursesError } = await supabase
        .from("courses")
        .select("id, course_name, course_code, section")
        .eq("professor_id", user.id)
        .eq("archived", false)
        .order("created_at", { ascending: false });

      if (coursesError) {
        toast.error(coursesError.message);
        return;
      }

      const liveCourses = (courseRows || []).map(mapCourse);
      setCourses(liveCourses);

      const courseIds = liveCourses.map((course) => course.id);
      if (!courseIds.length) {
        setScores([]);
        return;
      }

      let examRows = [];
      let examsError = null;
      const examResult = await supabase
        .from("exams")
        .select("id, title, exam_title, course_id, description, semester, exam_type")
        .in("course_id", courseIds)
        .or(`professor_id.eq.${user.id},created_by.eq.${user.id}`);

      if (examResult.error?.message?.includes("semester")) {
        const fallbackExamResult = await supabase
          .from("exams")
          .select("id, title, exam_title, course_id, description, exam_type")
          .in("course_id", courseIds)
          .or(`professor_id.eq.${user.id},created_by.eq.${user.id}`);
        examRows = fallbackExamResult.data || [];
        examsError = fallbackExamResult.error;
      } else {
        examRows = examResult.data || [];
        examsError = examResult.error;
      }

      if (examsError) {
        toast.error(examsError.message);
        return;
      }

      const liveExams = examRows;
      const examIds = liveExams.map((exam) => exam.id);
      if (!examIds.length) {
        setScores([]);
        return;
      }

      const courseById = new Map(liveCourses.map((course) => [course.id, course]));
      const examById = new Map(liveExams.map((exam) => [exam.id, exam]));

      let attemptRows = [];
      let attemptsError = null;
      const attemptResult = await supabase
        .from("exam_attempts")
        .select("id, exam_id, score, earned_points, max_points, status, submitted_at, started_at, student_id, profiles:student_id(full_name, student_number, email)")
        .in("exam_id", examIds)
        .order("submitted_at", { ascending: false });

      if (attemptResult.error?.message?.includes("status")) {
        const fallbackAttemptResult = await supabase
          .from("exam_attempts")
          .select("id, exam_id, score, earned_points, max_points, submitted_at, started_at, student_id, profiles:student_id(full_name, student_number, email)")
          .in("exam_id", examIds)
          .order("submitted_at", { ascending: false });
        attemptRows = fallbackAttemptResult.data || [];
        attemptsError = fallbackAttemptResult.error;
      } else {
        attemptRows = attemptResult.data || [];
        attemptsError = attemptResult.error;
      }

      if (attemptsError) {
        toast.error(attemptsError.message);
        return;
      }

      const attemptsByStudentExam = (attemptRows || []).reduce((items, attempt) => {
        const key = `${attempt.student_id}-${attempt.exam_id}`;
        items[key] = (items[key] || 0) + 1;
        return items;
      }, {});

      const attemptIds = (attemptRows || []).map((attempt) => attempt.id);
      let pendingManualAttemptIds = new Set();
      let totalsByAttemptId = new Map();
      if (attemptIds.length) {
        const { data: answerRows } = await supabase
          .from("exam_attempt_answers")
          .select("attempt_id, earned_points, max_points, is_correct, needs_manual_grading, exam_questions(points)")
          .in("attempt_id", attemptIds);
        pendingManualAttemptIds = new Set((answerRows || []).filter((answer) => answer.needs_manual_grading).map((answer) => answer.attempt_id));
        totalsByAttemptId = (answerRows || []).reduce((items, answer) => {
          const current = items.get(answer.attempt_id) || { earned: 0, max: 0 };
          const maxPoints = Number(answer.max_points || answer.exam_questions?.points || 0);
          const earnedPoints = answer.earned_points !== null && answer.earned_points !== undefined
            ? Number(answer.earned_points || 0)
            : answer.is_correct ? maxPoints : 0;
          items.set(answer.attempt_id, {
            earned: current.earned + earnedPoints,
            max: current.max + maxPoints,
          });
          return items;
        }, new Map());
      }

      setScores((attemptRows || []).map((attempt) => {
        const exam = examById.get(attempt.exam_id) || {};
        const course = courseById.get(exam.course_id) || {};
        const hasPendingManual = pendingManualAttemptIds.has(attempt.id);
        const answerTotals = totalsByAttemptId.get(attempt.id);
        const earnedPoints = answerTotals ? answerTotals.earned : attempt.earned_points;
        const maxPoints = answerTotals ? answerTotals.max : attempt.max_points;
        const score = answerTotals?.max ? Number(((answerTotals.earned / answerTotals.max) * 100).toFixed(2)) : attempt.score;
        return {
          id: attempt.id,
          courseId: exam.course_id,
          courseCode: course.courseCode || "Course",
          courseName: course.courseName || "Course",
          section: course.section || "No section",
          examId: attempt.exam_id,
          exam: exam.exam_title || exam.title || "Unknown exam",
          period: exam.description || "No period",
          semester: exam.semester || "No semester",
          type: exam.exam_type || "Exam",
          studentId: attempt.student_id,
          student: attempt.profiles?.full_name || attempt.profiles?.email || "Unknown student",
          studentNumber: attempt.profiles?.student_number || "No student ID",
          score,
          status: hasPendingManual ? "Pending Manual Grading" : answerTotals ? "Manually Graded" : attempt.status || (attempt.score === null || attempt.score === undefined ? "Pending Manual Grading" : "Submitted"),
          maxPoints,
          points: earnedPoints !== null && earnedPoints !== undefined && maxPoints !== null && maxPoints !== undefined
            ? `${earnedPoints}/${maxPoints}`
            : "-",
          attempts: attemptsByStudentExam[`${attempt.student_id}-${attempt.exam_id}`] || 1,
          takenAt: formatDateTime(attempt.started_at || attempt.submitted_at),
          submittedAt: formatDateTime(attempt.submitted_at),
        };
      }));
    }

    loadScores();
  }, [user?.id]);

  const courseOptions = useMemo(() => ["All Courses", ...new Set(courses.map((course) => course.courseCode).filter(Boolean))], [courses]);
  const sectionOptions = useMemo(() => ["All Sections", ...new Set(courses
    .filter((course) => courseFilter === "All Courses" || course.courseCode === courseFilter)
    .map((course) => course.section)
    .filter(Boolean))], [courseFilter, courses]);
  const filteredByCourseSection = useMemo(() => scores.filter((score) => {
    const matchesCourse = courseFilter === "All Courses" || score.courseCode === courseFilter;
    const matchesSection = sectionFilter === "All Sections" || score.section === sectionFilter;
    return matchesCourse && matchesSection;
  }), [courseFilter, scores, sectionFilter]);
  const periodOptions = useMemo(() => ["All Periods", ...new Set(filteredByCourseSection.map((score) => score.period).filter(Boolean))], [filteredByCourseSection]);
  const typeOptions = useMemo(() => ["All Types", ...new Set(filteredByCourseSection.map((score) => score.type).filter(Boolean))], [filteredByCourseSection]);
  const examOptions = useMemo(() => {
    const options = filteredByCourseSection
      .filter((score) => periodFilter === "All Periods" || score.period === periodFilter)
      .filter((score) => typeFilter === "All Types" || score.type === typeFilter)
      .reduce((items, score) => items.some((item) => item.id === score.examId) ? items : [...items, { id: score.examId, title: score.exam }], []);
    return options.sort((first, second) => first.title.localeCompare(second.title));
  }, [filteredByCourseSection, periodFilter, typeFilter]);
  const normalizedSearch = search.trim().toLowerCase();
  const selectedScores = useMemo(() => scores.filter((score) => {
    const matchesCourse = courseFilter === "All Courses" || score.courseCode === courseFilter;
    const matchesSection = sectionFilter === "All Sections" || score.section === sectionFilter;
    const matchesPeriod = periodFilter === "All Periods" || score.period === periodFilter;
    const matchesType = typeFilter === "All Types" || score.type === typeFilter;
    const matchesExam = !examFilter || score.examId === examFilter;
    const matchesSearch = !normalizedSearch || `${score.student} ${score.studentNumber} ${score.exam} ${score.courseCode} ${score.section} ${score.period} ${score.type}`.toLowerCase().includes(normalizedSearch);
    return matchesCourse && matchesSection && matchesPeriod && matchesType && matchesExam && matchesSearch;
  }), [courseFilter, examFilter, normalizedSearch, periodFilter, scores, sectionFilter, typeFilter]);
  const gradedScores = useMemo(() => selectedScores.filter((score) => score.score !== null && score.score !== undefined), [selectedScores]);
  const average = gradedScores.length ? gradedScores.reduce((total, row) => total + Number(row.score || 0), 0) / gradedScores.length : 0;
  const pendingManualRows = useMemo(() => scores.filter((score) => score.status === "Pending Manual Grading"), [scores]);
  const manualCourseOptions = useMemo(() => ["All Courses", ...new Set(pendingManualRows.map((row) => row.courseCode).filter(Boolean))], [pendingManualRows]);
  const manualSectionOptions = useMemo(() => ["All Sections", ...new Set(pendingManualRows
    .filter((row) => manualFilters.course === "All Courses" || row.courseCode === manualFilters.course)
    .map((row) => row.section)
    .filter(Boolean))], [manualFilters.course, pendingManualRows]);
  const manualExamOptions = useMemo(() => ["All Exams", ...new Set(pendingManualRows
    .filter((row) => manualFilters.course === "All Courses" || row.courseCode === manualFilters.course)
    .filter((row) => manualFilters.section === "All Sections" || row.section === manualFilters.section)
    .map((row) => row.exam)
    .filter(Boolean))], [manualFilters.course, manualFilters.section, pendingManualRows]);
  const filteredManualRows = useMemo(() => pendingManualRows.filter((row) => {
    const matchesCourse = manualFilters.course === "All Courses" || row.courseCode === manualFilters.course;
    const matchesSection = manualFilters.section === "All Sections" || row.section === manualFilters.section;
    const matchesExam = manualFilters.exam === "All Exams" || row.exam === manualFilters.exam;
    return matchesCourse && matchesSection && matchesExam;
  }), [manualFilters, pendingManualRows]);

  useEffect(() => {
    if (sectionFilter !== "All Sections" && !sectionOptions.includes(sectionFilter)) setSectionFilter("All Sections");
  }, [sectionFilter, sectionOptions]);

  useEffect(() => {
    if (periodFilter !== "All Periods" && !periodOptions.includes(periodFilter)) setPeriodFilter("All Periods");
  }, [periodFilter, periodOptions]);

  useEffect(() => {
    if (typeFilter !== "All Types" && !typeOptions.includes(typeFilter)) setTypeFilter("All Types");
  }, [typeFilter, typeOptions]);

  useEffect(() => {
    if (examFilter && !examOptions.some((exam) => exam.id === examFilter)) setExamFilter("");
  }, [examFilter, examOptions]);

  async function openManualAttempt(scoreRow) {
    setManualAttempt(scoreRow);
    setManualAnswers([]);
    setManualEditMode({});
    if (!hasSupabaseConfig) return;

    const [{ data: questionRows, error: questionError }, { data: initialAnswerRows, error: answerError }] = await Promise.all([
      supabase
        .from("exam_questions")
        .select("id, question_text, question_type, points")
        .eq("exam_id", scoreRow.examId)
        .order("id", { ascending: true }),
      supabase
        .from("exam_attempt_answers")
        .select("id, answer, file_url, earned_points, max_points, is_correct, needs_manual_grading, question_id")
        .eq("attempt_id", scoreRow.id),
    ]);

    if (questionError) {
      toast.error(questionError.message);
      return;
    }

    if (answerError) {
      toast.error(answerError.message);
      return;
    }

    let answerRows = initialAnswerRows || [];
    let effectiveAttempt = scoreRow;

    if (!answerRows.length) {
      toast.error("No saved answers found for this attempt. The student may need to resubmit after answer storage is fixed.");
      const { data: attemptRows, error: attemptsError } = await supabase
        .from("exam_attempts")
        .select("id, submitted_at, started_at")
        .eq("exam_id", scoreRow.examId)
        .eq("student_id", scoreRow.studentId)
        .order("submitted_at", { ascending: false });

      if (!attemptsError && attemptRows?.length) {
        const attemptIds = attemptRows.map((attempt) => attempt.id);
        const { data: fallbackAnswers, error: fallbackError } = await supabase
          .from("exam_attempt_answers")
          .select("id, attempt_id, answer, file_url, earned_points, max_points, is_correct, needs_manual_grading, question_id")
          .in("attempt_id", attemptIds);

        if (!fallbackError && fallbackAnswers?.length) {
          const attemptWithAnswers = attemptRows.find((attempt) => fallbackAnswers.some((answer) => answer.attempt_id === attempt.id));
          if (attemptWithAnswers) {
            effectiveAttempt = { ...scoreRow, id: attemptWithAnswers.id };
            answerRows = fallbackAnswers.filter((answer) => answer.attempt_id === attemptWithAnswers.id);
            setManualAttempt(effectiveAttempt);
          }
        }
      }
    }

    const answersByQuestion = new Map((answerRows || []).map((answer) => [answer.question_id, answer]));
    setManualAnswers((questionRows || []).map((question) => {
      const answer = answersByQuestion.get(question.id);
      return {
        id: answer?.id || `missing-${question.id}`,
        attempt_id: effectiveAttempt.id,
        question_id: question.id,
        answer: answer?.answer ?? null,
        file_url: answer?.file_url || null,
        earned_points: answer?.earned_points ?? null,
        max_points: answer?.max_points ?? question.points,
        is_correct: answer?.is_correct ?? null,
        needs_manual_grading: answer?.needs_manual_grading ?? true,
        missingAnswerRow: !answer,
        exam_questions: question,
      };
    }));
  }

  async function ensureAttemptAnswer(answerRow, value, maxPoints) {
    if (!answerRow.missingAnswerRow) return answerRow.id;

    const { data, error } = await supabase
      .from("exam_attempt_answers")
      .insert({
        attempt_id: answerRow.attempt_id,
        question_id: answerRow.question_id,
        answer: "No submitted answer",
        earned_points: value,
        max_points: maxPoints,
        is_correct: value >= maxPoints,
        needs_manual_grading: false,
        graded_at: new Date().toISOString(),
        graded_by: user.id,
      })
      .select("id")
      .single();

    if (error) {
      toast.error(error.message);
      return null;
    }

    return data.id;
  }

  async function saveManualAnswer(answerRow) {
    const maxPoints = Number(answerRow.exam_questions?.points || answerRow.max_points || 0);
    const rawValue = manualScores[answerRow.id] ?? answerRow.earned_points;
    const value = Number(rawValue);
    if (Number.isNaN(value) || value < 0 || value > maxPoints) {
      toast.error(`Enter a score from 0 to ${maxPoints}.`);
      return;
    }

    if (!hasSupabaseConfig) {
      toast.success("Manual score saved");
      return;
    }

    const answerId = await ensureAttemptAnswer(answerRow, value, maxPoints);
    if (!answerId) return;

    let savedAnswerResult = await supabase
      .from("exam_attempt_answers")
      .update({
        earned_points: value,
        max_points: maxPoints,
        is_correct: value >= maxPoints,
        needs_manual_grading: false,
        graded_at: new Date().toISOString(),
        graded_by: user.id,
      })
      .eq("id", answerId)
      .select("id, earned_points, max_points, is_correct, needs_manual_grading")
      .maybeSingle();

    if (savedAnswerResult.error?.message?.includes("earned_points") || savedAnswerResult.error?.message?.includes("max_points")) {
      savedAnswerResult = await supabase
        .from("exam_attempt_answers")
        .update({
          is_correct: value >= maxPoints,
          needs_manual_grading: false,
          graded_at: new Date().toISOString(),
          graded_by: user.id,
        })
        .eq("id", answerId)
        .select("id, is_correct, needs_manual_grading")
        .maybeSingle();
    }

    if (savedAnswerResult.error) {
      toast.error(savedAnswerResult.error.message);
      return;
    }

    if (!savedAnswerResult.data) {
      toast.error("Grade was not saved. Check the exam_attempt_answers update policy in Supabase.");
      return;
    }

    const savedAnswer = savedAnswerResult.data;
    const nextManualAnswers = manualAnswers.map((item) => item.id === answerRow.id ? {
      ...item,
      id: answerId,
      earned_points: savedAnswer.earned_points ?? value,
      max_points: savedAnswer.max_points ?? maxPoints,
      is_correct: value >= maxPoints,
      needs_manual_grading: false,
      missingAnswerRow: false,
    } : item);

    let savedAnswerRows = [];
    let savedAnswersError = null;
    const savedAnswersResult = await supabase
      .from("exam_attempt_answers")
      .select("earned_points, max_points, is_correct, needs_manual_grading, exam_questions(points)")
      .eq("attempt_id", manualAttempt.id);
    savedAnswerRows = savedAnswersResult.data || [];
    savedAnswersError = savedAnswersResult.error;

    if (savedAnswersError?.message?.includes("earned_points") || savedAnswersError?.message?.includes("max_points")) {
      const fallbackSavedAnswersResult = await supabase
        .from("exam_attempt_answers")
        .select("is_correct, needs_manual_grading, exam_questions(points)")
        .eq("attempt_id", manualAttempt.id);
      savedAnswerRows = fallbackSavedAnswersResult.data || [];
      savedAnswersError = fallbackSavedAnswersResult.error;
    }

    if (savedAnswersError) {
      toast.error(savedAnswersError.message);
      return;
    }

    const totals = computeManualAttemptTotals(savedAnswerRows.length ? savedAnswerRows : nextManualAnswers);

    const attemptPayload = {
      score: totals.score,
      earned_points: totals.earned,
      max_points: totals.max,
      status: totals.remainingManual ? "Pending Manual Grading" : "Manually Graded",
    };

    let attemptUpdateResult = await supabase
      .from("exam_attempts")
      .update(attemptPayload)
      .eq("id", manualAttempt.id)
      .select("id, score, earned_points, max_points, status")
      .maybeSingle();

    if (attemptUpdateResult.error?.message?.includes("status") || attemptUpdateResult.error?.message?.includes("earned_points") || attemptUpdateResult.error?.message?.includes("max_points")) {
      const fallbackPayload = { ...attemptPayload };
      if (attemptUpdateResult.error.message.includes("status")) delete fallbackPayload.status;
      if (attemptUpdateResult.error.message.includes("earned_points")) delete fallbackPayload.earned_points;
      if (attemptUpdateResult.error.message.includes("max_points")) delete fallbackPayload.max_points;
      attemptUpdateResult = await supabase
        .from("exam_attempts")
        .update(fallbackPayload)
        .eq("id", manualAttempt.id)
        .select("id, score")
        .maybeSingle();
    }

    if (attemptUpdateResult.error?.message?.includes("status") || attemptUpdateResult.error?.message?.includes("earned_points") || attemptUpdateResult.error?.message?.includes("max_points")) {
      attemptUpdateResult = await supabase
        .from("exam_attempts")
        .update({ score: totals.score })
        .eq("id", manualAttempt.id)
        .select("id, score")
        .maybeSingle();
    }

    if (attemptUpdateResult.error) {
      toast.error(attemptUpdateResult.error.message);
      return;
    }

    setManualAnswers(nextManualAnswers);
    setManualEditMode((current) => ({ ...current, [answerRow.id]: false, [answerId]: false }));
    setScores((current) => current.map((item) => item.id === manualAttempt.id || (item.studentId === manualAttempt.studentId && item.examId === manualAttempt.examId) ? {
      ...item,
      score: totals.score,
      earnedPoints: totals.earned,
      maxPoints: totals.max,
      points: `${totals.earned}/${totals.max}`,
      status: totals.remainingManual ? "Pending Manual Grading" : "Manually Graded",
    } : item));
    toast.success("Manual answer graded");
  }

  return (
    <section className="professor-scores-page">
      <PageHeader title="Scores" subtitle="View submitted exam scores, attempts, and timestamps by course." />

      <Card>
        <div className="professor-courses-header">
          <div>
            <h2>Scores Filter</h2>
            <p>Select course, section, period, type, and exam to view student scores.</p>
          </div>
          <div className="professor-score-header-actions">
            <Button variant="light" onClick={() => setManualOpen(true)}>View Pending Manual Grading</Button>
            <span>{selectedScores.length} shown</span>
          </div>
        </div>

        <div className="professor-score-filters">
          <SearchBox value={search} onChange={setSearch} placeholder="Search students, exams, or section" />
          <SelectField label="Course" value={courseFilter} onChange={(event) => { setCourseFilter(event.target.value); setExamFilter(""); }}>
            {courseOptions.map((course) => <option key={course}>{course}</option>)}
          </SelectField>
          <SelectField label="Section" value={sectionFilter} onChange={(event) => { setSectionFilter(event.target.value); setExamFilter(""); }}>
            {sectionOptions.map((section) => <option key={section}>{section}</option>)}
          </SelectField>
          <SelectField label="Period" value={periodFilter} onChange={(event) => { setPeriodFilter(event.target.value); setExamFilter(""); }}>
            {periodOptions.map((period) => <option key={period}>{period}</option>)}
          </SelectField>
          <SelectField label="Type" value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setExamFilter(""); }}>
            {typeOptions.map((type) => <option key={type}>{type}</option>)}
          </SelectField>
          <SelectField label="Exam" value={examFilter} onChange={(event) => setExamFilter(event.target.value)}>
            <option value="">Select Exam</option>
            {examOptions.map((exam) => <option key={exam.id} value={exam.id}>{exam.title}</option>)}
          </SelectField>
        </div>

        <div className="professor-score-summary">
          <Badge tone={scoreTone(average)}>{average.toFixed(1)}% avg</Badge>
          <Badge tone="neutral">{selectedScores.length} student scores</Badge>
        </div>

        <div className="professor-score-table-wrap">
          <table className="professor-score-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Student ID</th>
                <th>Course</th>
                <th>Section</th>
                <th>Exam</th>
                <th>Type</th>
                <th>Period</th>
                <th>Score</th>
                <th>Points</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Taken At</th>
                <th>Submitted At</th>
              </tr>
            </thead>
            <tbody>
              {selectedScores.map((score) => (
                <tr key={score.id}>
                  <td>{score.student}</td>
                  <td>{score.studentNumber}</td>
                  <td>{score.courseCode}</td>
                  <td>{score.section}</td>
                  <td>{score.exam}</td>
                  <td>{score.type}</td>
                  <td>{score.period}</td>
                  <td><Badge tone={scoreTone(score.score)}>{score.score === null || score.score === undefined ? "Pending" : `${Number(score.score).toFixed(1)}%`}</Badge></td>
                  <td>{score.points}</td>
                  <td>{score.status}</td>
                  <td>{score.attempts}</td>
                  <td><FiClock /> {score.takenAt}</td>
                  <td>{score.submittedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!selectedScores.length ? <div className="professor-exams-empty">No submitted scores match your filters.</div> : null}
        </div>
      </Card>

      {manualOpen ? (
        <div className="professor-monitoring-backdrop" onClick={() => { setManualOpen(false); setManualAttempt(null); }} role="presentation">
          <section className="professor-manual-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="professor-share-header">
              <div>
                <h2>Pending Manual Grading</h2>
                <p>Open an attempt to review manual grading questions.</p>
              </div>
              <button aria-label="Close manual grading" onClick={() => { setManualOpen(false); setManualAttempt(null); }} type="button">x</button>
            </div>

            <div className="professor-score-filters">
              <SelectField label="Course" value={manualFilters.course} onChange={(event) => setManualFilters((current) => ({ ...current, course: event.target.value, section: "All Sections", exam: "All Exams" }))}>
                {manualCourseOptions.map((course) => <option key={course}>{course}</option>)}
              </SelectField>
              <SelectField label="Section" value={manualFilters.section} onChange={(event) => setManualFilters((current) => ({ ...current, section: event.target.value, exam: "All Exams" }))}>
                {manualSectionOptions.map((section) => <option key={section}>{section}</option>)}
              </SelectField>
              <SelectField label="Exam" value={manualFilters.exam} onChange={(event) => setManualFilters((current) => ({ ...current, exam: event.target.value }))}>
                {manualExamOptions.map((exam) => <option key={exam}>{exam}</option>)}
              </SelectField>
            </div>

            {!manualAttempt ? (
              <div className="professor-manual-list">
                {filteredManualRows.map((row) => (
                  <article key={row.id}>
                    <div>
                      <strong>{row.student}</strong>
                      <span>{row.studentNumber}</span>
                      <small>{row.exam} - {row.courseCode} - {row.section} - {row.type} - {row.period}</small>
                    </div>
                    <Button variant="light" onClick={() => openManualAttempt(row)}>View Answer</Button>
                  </article>
                ))}
                {!filteredManualRows.length ? <div className="professor-exams-empty">No pending manual grading found.</div> : null}
              </div>
            ) : (
              <div className="professor-manual-detail">
                <Button variant="light" onClick={() => setManualAttempt(null)}>Back</Button>
                <div>
                  <h3>{manualAttempt.exam}</h3>
                  <p>{manualAttempt.student} - {manualAttempt.studentNumber}</p>
                </div>
                {manualAnswers.map((answer) => {
                  const question = answer.exam_questions || {};
                  const maxPoints = Number(question.points || answer.max_points || 0);
                  const currentPoints = answer.earned_points ?? "";
                  const canEditScore = answer.needs_manual_grading || answer.missingAnswerRow || manualEditMode[answer.id];
                  return (
                    <article key={answer.id}>
                      <div>
                        <span>{question.question_type} - {maxPoints} point{maxPoints === 1 ? "" : "s"}</span>
                        <strong>{question.question_text}</strong>
                        {answer.missingAnswerRow ? <em className="professor-missing-answer">No saved answer row for this question.</em> : null}
                        <div className="professor-manual-answer-box">
                          <small>Student Answer</small>
                          <p>{formatAnswer(answer.answer)}</p>
                        </div>
                        {answer.file_url ? <a href={answer.file_url} rel="noreferrer" target="_blank">Open uploaded file</a> : null}
                      </div>
                      <div className="professor-manual-grade">
                        <input disabled={!canEditScore} min="0" max={maxPoints} onChange={(event) => setManualScores((current) => ({ ...current, [answer.id]: event.target.value }))} placeholder={`0-${maxPoints}`} type="number" value={manualScores[answer.id] ?? currentPoints} />
                        <button disabled={!canEditScore} onClick={() => saveManualAnswer(answer)} type="button">Save</button>
                        <button className="secondary" onClick={() => setManualEditMode((current) => ({ ...current, [answer.id]: true }))} type="button">Edit</button>
                      </div>
                    </article>
                  );
                })}
                {!manualAnswers.length ? <div className="professor-exams-empty">No answers found for this attempt.</div> : null}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
