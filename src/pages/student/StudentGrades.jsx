import { useCallback, useEffect, useMemo, useState } from "react";
import { FiChevronUp } from "react-icons/fi";
import { toast } from "sonner";
import { useAuth } from "../../context/AuthContext";
import { studentCourses, studentGrades } from "../../data/studentData";
import useLocalStorageState from "../../hooks/useLocalStorageState";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

function getAcademicYear(value = new Date()) {
  const date = new Date(value);
  const year = Number.isNaN(date.getTime()) ? new Date().getFullYear() : date.getFullYear();
  const month = Number.isNaN(date.getTime()) ? new Date().getMonth() : date.getMonth();
  return month >= 6 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

function clampScore(score) {
  const value = Number(score || 0);
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function computeAttemptGradeFromAnswers(rows = []) {
  const hasSavedPoints = rows.some((row) => row.earned_points !== null && row.earned_points !== undefined);
  const hasGradedAnswers = rows.some((row) => row.needs_manual_grading === false || row.is_correct === true);
  const max = rows.reduce((total, row) => total + Number(row.max_points || row.questionPoints || row.exam_questions?.points || 0), 0);

  if (!hasSavedPoints && !hasGradedAnswers) {
    return max ? { score: null, earned: null, max, pending: true } : null;
  }

  const earned = rows.reduce((total, row) => {
    if (row.earned_points !== null && row.earned_points !== undefined) return total + Number(row.earned_points || 0);
    const maxPoints = Number(row.max_points || row.questionPoints || row.exam_questions?.points || 0);
    return total + (row.is_correct ? maxPoints : 0);
  }, 0);
  const pending = rows.some((row) => row.needs_manual_grading);
  return max ? { score: (earned / max) * 100, earned, max, pending } : null;
}

function mapCourse(course) {
  if (!course) return null;
  return {
    id: course.id,
    name: course.course_code || course.name || "Course",
    section: course.course_code && course.section ? `${course.course_code} - ${course.section}` : course.section || course.courseName || "No section",
    courseName: course.course_name || course.courseName || course.name || "Course",
  };
}

function mapAttempt(attempt, gradeOverrides = {}) {
  const exam = attempt.exams || {};
  const course = exam.courses || {};
  const submittedAt = attempt.submitted_at || attempt.created_at || new Date().toISOString();
  const override = gradeOverrides[attempt.id] || {};
  const hasOverride = Object.prototype.hasOwnProperty.call(gradeOverrides, attempt.id);
  const attemptPendingManual = String(attempt.status || "").toLowerCase().includes("pending manual");
  const score = override.score === null || override.score === undefined
    ? clampScore(attempt.score)
    : clampScore(override.score);
  const maxPoints = override.max ?? attempt.max_points ?? null;
  const earnedPoints = override.earned ?? attempt.earned_points ?? null;
  const isPending = hasOverride ? override.pending : attemptPendingManual || (attempt.score === null && maxPoints);

  return {
    id: attempt.id,
    courseId: exam.course_id || course.id,
    period: exam.exam_type || "Prelim",
    title: `${exam.exam_title || exam.title || "Untitled assessment"} - ${exam.exam_type || "Exam"}`,
    score,
    scoreLabel: isPending && maxPoints ? `--/${maxPoints}` : earnedPoints !== null && earnedPoints !== undefined && maxPoints ? `${earnedPoints}/${maxPoints}` : `${score.toFixed(1)}%`,
    pendingManual: Boolean(isPending),
    academicYear: getAcademicYear(submittedAt),
    submittedAt,
  };
}

function groupByPeriod(grades) {
  return grades.reduce((items, grade) => {
    const period = grade.period || "Ungraded";
    items[period] = [...(items[period] || []), grade];
    return items;
  }, {});
}

export default function StudentGrades() {
  const { user } = useAuth();
  const [joinedCourses] = useLocalStorageState("smartproctor.student.courses", studentCourses);
  const [courses, setCourses] = useState(() => joinedCourses.map(mapCourse).filter(Boolean));
  const [grades, setGrades] = useState(() => studentGrades.map((grade) => ({ ...grade, academicYear: "2025-2026" })));
  const [openCourseId, setOpenCourseId] = useState(courses[0]?.id || "");

  const loadGrades = useCallback(async () => {
    if (!hasSupabaseConfig || !user?.id) return;

    const { data: enrollmentRows, error: enrollmentError } = await supabase
      .from("course_enrollments")
      .select("course_id, courses(id, course_name, course_code, section)")
      .eq("student_id", user.id)
      .order("joined_at", { ascending: false });

    if (enrollmentError) {
      toast.error(enrollmentError.message);
      return;
    }

    const liveCourses = (enrollmentRows || []).map((row) => mapCourse(row.courses)).filter(Boolean);
    setCourses(liveCourses);
    setOpenCourseId((current) => current || liveCourses[0]?.id || "");

    let attemptRows = [];
    let attemptsError = null;
    const attemptResult = await supabase
      .from("exam_attempts")
      .select("id, score, earned_points, max_points, status, submitted_at, exams(id, title, exam_title, exam_type, course_id, courses(id, course_name, course_code, section))")
      .eq("student_id", user.id)
      .order("submitted_at", { ascending: false });

    if (attemptResult.error?.message?.includes("submitted_at") || attemptResult.error?.message?.includes("earned_points") || attemptResult.error?.message?.includes("max_points")) {
      const fallbackAttemptResult = await supabase
        .from("exam_attempts")
        .select("id, score, exams(id, title, exam_title, exam_type, course_id, courses(id, course_name, course_code, section))")
        .eq("student_id", user.id);
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

    const attemptIds = (attemptRows || []).map((attempt) => attempt.id);
    const examIds = [...new Set((attemptRows || []).map((attempt) => attempt.exams?.id).filter(Boolean))];
    let gradeOverrides = {};
    if (attemptIds.length) {
      let answerRows = [];
      let answersError = null;
      const answersResult = await supabase
        .from("exam_attempt_answers")
        .select("attempt_id, question_id, earned_points, max_points, is_correct, needs_manual_grading")
        .in("attempt_id", attemptIds);

      if (answersResult.error?.message?.includes("earned_points") || answersResult.error?.message?.includes("max_points") || answersResult.error?.message?.includes("needs_manual_grading")) {
        const fallbackAnswersResult = await supabase
          .from("exam_attempt_answers")
          .select("attempt_id, question_id, is_correct")
          .in("attempt_id", attemptIds);
        answerRows = fallbackAnswersResult.data || [];
        answersError = fallbackAnswersResult.error;
      } else {
        answerRows = answersResult.data || [];
        answersError = answersResult.error;
      }

      if (answersError) {
        toast.error(answersError.message);
        return;
      }

      let questionPointsById = new Map();
      if (examIds.length) {
        const { data: questionRows, error: questionError } = await supabase
          .from("exam_questions")
          .select("id, points")
          .in("exam_id", examIds);
        if (questionError) {
          toast.error(questionError.message);
          return;
        }
        questionPointsById = new Map((questionRows || []).map((question) => [question.id, question.points]));
      }

      const answerRowsWithPoints = answerRows.map((answer) => ({
        ...answer,
        questionPoints: questionPointsById.get(answer.question_id),
      }));

      gradeOverrides = answerRowsWithPoints.reduce((items, row) => {
        const rows = answerRowsWithPoints.filter((answer) => answer.attempt_id === row.attempt_id);
        const grade = computeAttemptGradeFromAnswers(rows);
        return grade === null ? items : { ...items, [row.attempt_id]: grade };
      }, {});
    }

    setGrades((attemptRows || []).map((attempt) => mapAttempt(attempt, gradeOverrides)));
  }, [user?.id]);

  useEffect(() => {
    void loadGrades();
  }, [loadGrades]);

  useEffect(() => {
    if (!hasSupabaseConfig || !user?.id) return undefined;

    const channel = supabase
      .channel(`student-grades-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "exam_attempts" }, () => void loadGrades())
      .on("postgres_changes", { event: "*", schema: "public", table: "exam_attempt_answers" }, () => void loadGrades())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadGrades, user?.id]);


  const visibleCourses = useMemo(() => {
    return courses.map((course) => {
      const courseGrades = grades.filter((grade) => grade.courseId === course.id);
      const gradedOnly = courseGrades.filter((grade) => !grade.pendingManual);
      const average = gradedOnly.length ? gradedOnly.reduce((total, grade) => total + grade.score, 0) / gradedOnly.length : 0;

      return {
        ...course,
        grades: courseGrades,
        periods: groupByPeriod(courseGrades),
        average,
      };
    });
  }, [courses, grades]);

  return (
    <section className="student-page student-grades-page">
      <div className="student-page-header">
        <div>
          <h1>My Grades</h1>
          <p>View your current and past course grades.</p>
        </div>
      </div>

      <div className="student-grade-course-list">
        {visibleCourses.map((course) => {
          const isOpen = openCourseId === course.id;

          return (
            <section className="student-card student-grade-course" key={course.id}>
              <button className="student-grade-course-toggle" onClick={() => setOpenCourseId(isOpen ? "" : course.id)} type="button">
                <div>
                  <h2>{course.name}</h2>
                  <p>{course.section}</p>
                </div>
                <div>
                  <strong>{course.average.toFixed(1)}%</strong>
                  <FiChevronUp className={isOpen ? "" : "collapsed"} />
                </div>
              </button>

              {isOpen ? (
                <div className="student-grade-body">
                  <h3>Academic Records</h3>
                  {Object.entries(course.periods).map(([period, periodGrades]) => (
                    <div className="student-grade-period" key={period}>
                      {periodGrades.map((grade) => (
                        <article className="student-grade-row" key={grade.id}>
                          <div>
                            <strong>{period}</strong>
                            <span>{grade.title}</span>
                          </div>
                          <b>{grade.scoreLabel}</b>
                          <div className="student-progress"><span style={{ width: `${grade.score}%` }} /></div>
                        </article>
                      ))}
                    </div>
                  ))}
                  {!course.grades.length ? <div className="student-empty-box">No grades recorded for this course yet.</div> : null}
                  <footer>
                    <span>Course Grade:</span>
                    <strong>{course.average.toFixed(1)}%</strong>
                  </footer>
                </div>
              ) : null}
            </section>
          );
        })}
        {!visibleCourses.length ? <div className="student-empty-box">No joined courses found.</div> : null}
      </div>
    </section>
  );
}
