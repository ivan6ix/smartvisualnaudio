import { useEffect, useState } from "react";
import { FiArrowRight, FiPlus, FiX } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Badge, Card, PageHeader } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { studentCourses } from "../../data/studentData";
import useLocalStorageState from "../../hooks/useLocalStorageState";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

function examTone(status) {
  if (status === "Published" || status === "Active") return "success";
  if (status === "Scheduled") return "blue";
  return "neutral";
}

function getAttemptLimit(settings) {
  const value = String(settings?.attemptLimit || settings?.attempts || "Unlimited").toLowerCase();
  if (value.includes("unlimited")) return Infinity;
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : Infinity;
}

function formatDurationLabel(duration) {
  return Number(duration) > 0 ? `${duration} min` : "No timer";
}

export default function StudentDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [courses, setCourses] = useLocalStorageState("smartproctor.student.courses", studentCourses);
  const [availableExams, setAvailableExams] = useState([]);
  const [joinOpen, setJoinOpen] = useState(false);
  const [courseCode, setCourseCode] = useState("");

  function mapLiveCourse(course) {
    if (!course) return null;
    return {
      id: course.id,
      name: course.course_code,
      section: `${course.course_code} - ${course.section}`,
      courseName: course.course_name,
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
      duration: exam.time_limit || exam.duration || 0,
      status: exam.status || "Published",
      attemptLimit: getAttemptLimit(exam.exam_settings),
      attemptsTaken: exam.attemptsTaken || 0,
    };
  }

  useEffect(() => {
    if (!hasSupabaseConfig || !user?.id) return;

    async function loadEnrollments() {
      const { data, error } = await supabase
        .from("course_enrollments")
        .select("course_id, courses(id, course_name, course_code, section, joining_code)")
        .eq("student_id", user.id)
        .order("joined_at", { ascending: false });

      if (error) {
        toast.error(error.message);
        return;
      }

      const liveCourses = (data || []).map((enrollment) => mapLiveCourse(enrollment.courses)).filter(Boolean);
      setCourses(liveCourses);

      const courseIds = liveCourses.map((course) => course.id);
      if (!courseIds.length) {
        setAvailableExams([]);
        return;
      }

      const { data: examRows, error: examsError } = await supabase
        .from("exams")
        .select("id, title, exam_title, course_id, course, duration, time_limit, status, exam_settings, courses(course_name, course_code, section)")
        .in("course_id", courseIds)
        .in("status", ["Published", "Active", "Scheduled"])
        .order("created_at", { ascending: false });

      if (examsError) {
        toast.error(examsError.message);
        return;
      }

      const examIds = (examRows || []).map((exam) => exam.id);
      let attemptsByExam = {};

      if (examIds.length) {
        const { data: attemptRows, error: attemptsError } = await supabase
          .from("exam_attempts")
          .select("exam_id")
          .eq("student_id", user.id)
          .in("exam_id", examIds);

        if (attemptsError) {
          toast.error(attemptsError.message);
          return;
        }

        attemptsByExam = (attemptRows || []).reduce((items, attempt) => ({
          ...items,
          [attempt.exam_id]: (items[attempt.exam_id] || 0) + 1,
        }), {});
      }

      const visibleExams = (examRows || [])
        .map((exam) => ({ ...exam, attemptsTaken: attemptsByExam[exam.id] || 0 }))
        .filter((exam) => {
          const attemptLimit = getAttemptLimit(exam.exam_settings);
          const attemptsTaken = attemptsByExam[exam.id] || 0;
          return attemptsTaken === 0 && (!Number.isFinite(attemptLimit) || attemptsTaken < attemptLimit);
        });

      setAvailableExams(visibleExams.map(mapLiveExam));
    }

    loadEnrollments();
  }, [setCourses, user?.id]);

  async function handleJoinCourse(event) {
    event.preventDefault();
    const code = courseCode.trim();
    if (!code) return;

    const normalizedCode = code.toUpperCase();

    if (hasSupabaseConfig && user?.id) {
      const { data: course, error: courseError } = await supabase
        .from("courses")
        .select("id, course_name, course_code, section, joining_code, archived")
        .eq("joining_code", normalizedCode)
        .eq("archived", false)
        .maybeSingle();

      if (courseError) {
        toast.error(courseError.message);
        return;
      }
      if (!course) {
        toast.error("Course code not found");
        return;
      }

      const { error: joinError } = await supabase
        .from("course_enrollments")
        .insert({ course_id: course.id, student_id: user.id });

      if (joinError && joinError.code !== "23505") {
        toast.error(joinError.message);
        return;
      }

      setCourses((current) => {
        if (current.some((item) => item.id === course.id)) return current;
        return [mapLiveCourse(course), ...current];
      });
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
    <>
      <PageHeader
        title="Student Dashboard"
        subtitle="View joined courses, available exams, resources, and grades."
        actions={<button className="student-primary-button" onClick={() => setJoinOpen(true)} type="button"><FiPlus /> Join Course</button>}
      />

      <div className="professor-dashboard-grid student-dashboard-overview">
        <Card>
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
                </div>
                <i><FiArrowRight /></i>
              </button>
            ))}
            {!courses.length ? <div className="student-empty-box">No joined courses yet.</div> : null}
          </div>
        </Card>

        <Card className="student-exams-card">
          <div className="student-card-title">
            <h2>Available Exams</h2>
            <span>{availableExams.length}</span>
          </div>
          <div className="student-exam-list">
            {availableExams.map((exam) => (
              <article key={exam.id}>
                <div>
                  <strong>{exam.title}</strong>
                  <small>{exam.course}{exam.section ? ` - ${exam.section}` : ""}</small>
                </div>
                <div>
                  <span>{formatDurationLabel(exam.duration)}</span>
                  <Badge tone={examTone(exam.status)}>{exam.status}</Badge>
                  <button className="student-start-exam" onClick={() => navigate(`/student/exams/${exam.id}`)} type="button">Start</button>
                </div>
              </article>
            ))}
            {!availableExams.length ? <div className="student-empty-box">No available exams yet.</div> : null}
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
    </>
  );
}
