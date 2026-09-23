import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FiArrowRight, FiPlus, FiX } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Badge, Card, PageHeader } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { studentCourses } from "../../data/studentData";
import useLocalStorageState from "../../hooks/useLocalStorageState";
import { formatCourseMeta } from "../../lib/coursePrograms";
import { countUsedExamAttemptsByExam, getExamAttemptEligibility, getAttemptLimit } from "../../lib/examAttempts";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

function examTone(status) {
  if (status === "Published" || status === "Active") return "success";
  if (status === "Scheduled") return "blue";
  return "neutral";
}

function formatDurationLabel(duration) {
  return Number(duration) > 0 ? `${duration} min` : "No timer";
}

export default function StudentDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [courses, setCourses] = useLocalStorageState("smartproctor.student.courses", studentCourses);
  const [joinOpen, setJoinOpen] = useState(false);
  const [courseCode, setCourseCode] = useState("");

  function mapLiveCourse(course) {
    if (!course) return null;
    return {
      id: course.id,
      name: course.course_code,
      section: `${course.course_code} - ${course.section}`,
      courseName: course.course_name,
      programCode: course.programs?.program_code || "",
      programName: course.programs?.program_name || "",
      yearLevel: course.year_level || "",
      rawSection: course.section || "",
      joiningCode: course.joining_code,
    };
  }

  function mapLiveExam(exam) {
    const course = exam.courses;
    return {
      id: exam.id,
      title: exam.exam_title || exam.title || "Untitled exam",
      course: course?.course_name || exam.course || "Unassigned course",
      section: course?.course_code && course?.section ? `${course.course_code} - ${course.section}` : course?.course_code || "",
      programCode: course?.programs?.program_code || "",
      duration: exam.time_limit || exam.duration || 0,
      status: exam.status || "Published",
      attemptLimit: getAttemptLimit(exam.exam_settings),
      attemptsTaken: exam.attemptsTaken || 0,
    };
  }

  const dashboardQuery = useQuery({
    queryKey: ["student-dashboard", user?.id],
    enabled: hasSupabaseConfig && Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_enrollments")
        .select("course_id, courses(id, course_name, course_code, program_id, year_level, section, semester, academic_year, joining_code, programs(program_code, program_name, is_active))")
        .eq("student_id", user.id)
        .order("joined_at", { ascending: false });

      if (error) {
        throw error;
      }

      const liveCourses = (data || []).map((enrollment) => mapLiveCourse(enrollment.courses)).filter(Boolean);
      const courseIds = liveCourses.map((course) => course.id);
      if (!courseIds.length) {
        return { courses: liveCourses, availableExams: [] };
      }

      const { data: examRows, error: examsError } = await supabase
        .from("exams")
        .select("id, title, exam_title, course_id, course, duration, time_limit, status, exam_settings, courses(course_name, course_code, program_id, year_level, section, programs(program_code, program_name, is_active))")
        .in("course_id", courseIds)
        .in("status", ["Published", "Active", "Scheduled"])
        .order("created_at", { ascending: false });

      if (examsError) {
        throw examsError;
      }

      const examIds = (examRows || []).map((exam) => exam.id);
      let attemptsByExam = {};

      if (examIds.length) {
        const { data: attemptRows, error: attemptsError } = await supabase
          .from("exam_attempts")
          .select("id, exam_id, status, submitted_at")
          .eq("student_id", user.id)
          .in("exam_id", examIds);

        if (attemptsError) {
          throw attemptsError;
        }

        attemptsByExam = countUsedExamAttemptsByExam(attemptRows || []);
      }

      const visibleExams = (examRows || [])
        .map((exam) => ({ ...exam, attemptsTaken: attemptsByExam[exam.id] || 0 }))
        .filter((exam) => {
          const eligibility = getExamAttemptEligibility(exam, attemptsByExam[exam.id] || 0);
          return eligibility.allowed;
        });

      return { courses: liveCourses, availableExams: visibleExams.map(mapLiveExam) };
    },
  });

  const availableExams = dashboardQuery.data?.availableExams || [];
  const examsLoading = hasSupabaseConfig && dashboardQuery.isFetching;

  useEffect(() => {
    if (dashboardQuery.data?.courses) setCourses(dashboardQuery.data.courses);
  }, [dashboardQuery.data, setCourses]);

  useEffect(() => {
    if (dashboardQuery.error) toast.error(dashboardQuery.error.message);
  }, [dashboardQuery.error]);

  async function handleJoinCourse(event) {
    event.preventDefault();
    const code = courseCode.trim();
    if (!code) return;

    const normalizedCode = code.toUpperCase();

    if (hasSupabaseConfig && user?.id) {
      const { data: joinedCourses, error: courseError } = await supabase
        .rpc("join_course_by_code", { p_joining_code: normalizedCode });

      if (courseError) {
        toast.error(courseError.message);
        return;
      }
      const course = Array.isArray(joinedCourses) ? joinedCourses[0] : joinedCourses;
      if (!course) {
        toast.error("Course code not found");
        return;
      }

      setCourses((current) => {
        if (current.some((item) => item.id === course.id)) return current;
        return [mapLiveCourse(course), ...current];
      });
      await queryClient.invalidateQueries({ queryKey: ["student-dashboard", user.id] });
      toast.success("Course joined");
    } else {
      setCourses((current) => [
        ...current,
        {
          id: `joined-${Date.now()}`,
          name: normalizedCode.split("-")[0] || normalizedCode,
          section: normalizedCode,
        },
      ]);
      toast.success("Course joined");
    }

    setCourseCode("");
    setJoinOpen(false);
  }

  return (
    <section className="student-dashboard-page">
      <PageHeader
        title="Student Dashboard"
        subtitle="View joined courses, available exams, resources, and grades."
        actions={<button className="student-primary-button" onClick={() => setJoinOpen(true)} type="button"><FiPlus /> Join Course</button>}
      />

      <div className="professor-dashboard-grid student-dashboard-overview">
        <Card className="student-dashboard-card">
          <div className="student-card-title">
            <h2>My Courses</h2>
            <span>{courses.length} joined</span>
          </div>
          <div className="student-course-grid">
            {courses.map((course) => (
              <button className="student-course-card" key={course.id} onClick={() => navigate(`/student/courses/${course.id}/materials`)} type="button">
                <div>
                  <strong>{course.name}</strong>
                  <span>{course.section}</span>
                  <small>{formatCourseMeta({ ...course, section: course.rawSection || course.section })}</small>
                </div>
                <i><FiArrowRight /></i>
              </button>
            ))}
            {!courses.length ? <div className="student-empty-box">No joined courses yet.</div> : null}
          </div>
        </Card>

        <Card className="student-dashboard-card student-exams-card">
          <div className="student-card-title">
            <h2>Available Exams</h2>
            <span>{availableExams.length}</span>
          </div>
          <div className="student-exam-list">
            {examsLoading ? <div className="student-empty-box">Loading available exams...</div> : null}
            {!examsLoading ? availableExams.map((exam) => (
              <article key={exam.id}>
                <div>
                  <strong>{exam.title}</strong>
                  <small>{exam.course}{exam.section ? ` - ${exam.section}` : ""}{exam.programCode ? ` - ${exam.programCode}` : ""}</small>
                </div>
                <div>
                  <span>{formatDurationLabel(exam.duration)}</span>
                  <Badge tone={examTone(exam.status)}>{exam.status}</Badge>
                  <button className="student-start-exam" onClick={() => navigate(`/student/exams/${exam.id}`)} type="button">Start</button>
                </div>
              </article>
            )) : null}
            {!examsLoading && !availableExams.length ? <div className="student-empty-box">No available exams yet.</div> : null}
          </div>
        </Card>
      </div>

      {joinOpen ? (
        <div className="student-modal-backdrop" onClick={() => setJoinOpen(false)} role="presentation">
          <form className="student-join-modal" onClick={(event) => event.stopPropagation()} onSubmit={handleJoinCourse}>
            <div className="student-share-header">
              <div>
                <h2>Join Course</h2>
                <p>Enter the course code provided by your professor.</p>
              </div>
              <button aria-label="Close join course" onClick={() => setJoinOpen(false)} type="button">
                <FiX />
              </button>
            </div>
            <label className="student-join-field">
              <span>Course Code</span>
              <input autoFocus onChange={(event) => setCourseCode(event.target.value)} placeholder="Enter course code" value={courseCode} />
            </label>
            <button className="student-primary-button" type="submit">Join Course</button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
