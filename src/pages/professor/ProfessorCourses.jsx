import { useEffect, useMemo, useState } from "react";
import { FiBookOpen, FiFileText, FiUsers } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Badge, Card, PageHeader, StatCard } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { professorCourses, professorExams } from "../../data/professorData";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

function statusTone(status) {
  if (status === "Published" || status === "published" || status === "Active") return "blue";
  if (status === "Draft" || status === "draft") return "neutral";
  if (status === "Pending Review" || status === "pending") return "warn";
  if (status === "Closed" || status === "closed") return "danger";
  return "success";
}

function mapCourse(course, enrollmentCounts = {}) {
  return {
    id: course.id,
    courseName: course.course_name || course.courseName,
    courseCode: course.course_code || course.courseCode,
    section: course.section,
    joiningCode: course.joining_code || course.joiningCode,
    students: enrollmentCounts[course.id] || course.students || 0,
  };
}

function mapExam(exam) {
  return {
    id: exam.id,
    title: exam.exam_title || exam.title || "Untitled exam",
    type: exam.exam_type || exam.type || "Exam",
    status: exam.status || "Draft",
    duration: exam.time_limit || exam.duration || 0,
    createdAt: exam.created_at ? new Date(exam.created_at).toLocaleDateString() : exam.createdAt || "-",
    courseId: exam.course_id || exam.courseId,
  };
}

export default function ProfessorCourses() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [courses, setCourses] = useState(() => hasSupabaseConfig ? [] : professorCourses.map((course) => mapCourse(course)));
  const [exams, setExams] = useState(() => hasSupabaseConfig ? [] : professorExams.map((exam) => ({
    ...mapExam(exam),
    courseId: professorCourses.find((course) => course.courseName === exam.course && course.section === exam.section)?.id,
  })));
  const [selectedCourseId, setSelectedCourseId] = useState(courses[0]?.id || "");

  useEffect(() => {
    if (!hasSupabaseConfig || !user?.id) return;

    async function loadCourses() {
      const { data: courseRows, error: coursesError } = await supabase
        .from("courses")
        .select("id, course_name, course_code, section, joining_code, archived")
        .eq("professor_id", user.id)
        .eq("archived", false)
        .order("created_at", { ascending: false });

      if (coursesError) {
        toast.error(coursesError.message);
        return;
      }

      const courseIds = (courseRows || []).map((course) => course.id);
      let enrollmentCounts = {};

      if (courseIds.length) {
        const { data: enrollmentRows, error: enrollmentsError } = await supabase
          .from("course_enrollments")
          .select("course_id")
          .in("course_id", courseIds);

        if (enrollmentsError) {
          toast.error(enrollmentsError.message);
        } else {
          enrollmentCounts = (enrollmentRows || []).reduce((items, enrollment) => {
            items[enrollment.course_id] = (items[enrollment.course_id] || 0) + 1;
            return items;
          }, {});
        }
      }

      const liveCourses = (courseRows || []).map((course) => mapCourse(course, enrollmentCounts));
      setCourses(liveCourses);
      setSelectedCourseId((current) => current && liveCourses.some((course) => course.id === current) ? current : liveCourses[0]?.id || "");

      if (!courseIds.length) {
        setExams([]);
        return;
      }

      const { data: examRows, error: examsError } = await supabase
        .from("exams")
        .select("id, title, exam_title, exam_type, course_id, duration, time_limit, status, created_at")
        .in("course_id", courseIds)
        .or(`professor_id.eq.${user.id},created_by.eq.${user.id}`)
        .order("created_at", { ascending: false });

      if (examsError) {
        toast.error(examsError.message);
        return;
      }

      setExams((examRows || []).map(mapExam));
    }

    loadCourses();
  }, [user?.id]);

  const selectedCourse = courses.find((course) => course.id === selectedCourseId);
  const selectedExams = useMemo(() => exams.filter((exam) => exam.courseId === selectedCourseId), [exams, selectedCourseId]);
  const totalStudents = courses.reduce((total, course) => total + Number(course.students || 0), 0);

  return (
    <>
      <PageHeader title="Courses" subtitle="View your assigned courses and the exams created for each course." />

      <div className="professor-stats-grid">
        <StatCard label="My Courses" value={courses.length} icon={FiBookOpen} />
        <StatCard label="Course Exams" value={exams.length} icon={FiFileText} />
        <StatCard label="Published Exams" value={exams.filter((exam) => ["Published", "published", "Active"].includes(exam.status)).length} icon={FiFileText} />
        <StatCard label="Enrolled Students" value={totalStudents} icon={FiUsers} />
      </div>

      <Card>
        <div className="professor-courses-header">
          <div>
            <h2>My Courses</h2>
            <p>Select a course card to view exams created for that course.</p>
          </div>
          <span>{courses.length} courses</span>
        </div>

        <div className="professor-course-card-grid">
          {courses.map((course) => (
            <button
              className={selectedCourseId === course.id ? "active" : ""}
              key={course.id}
              onClick={() => {
                setSelectedCourseId(course.id);
                navigate(`/professor/courses/${course.id}/materials`);
              }}
              type="button"
            >
              <FiBookOpen />
              <div>
                <strong>{course.courseCode}</strong>
                <span>{course.courseName}</span>
                <small>{course.section} • {course.students} students</small>
              </div>
              <i>{course.joiningCode || "No code"}</i>
            </button>
          ))}
          {!courses.length ? <div className="professor-exams-empty">No assigned courses found.</div> : null}
        </div>
      </Card>

      <Card>
        <div className="professor-courses-header">
          <div>
            <h2>{selectedCourse ? `${selectedCourse.courseCode} Exams` : "Course Exams"}</h2>
            <p>{selectedCourse ? `${selectedCourse.courseName} - ${selectedCourse.section}` : "Select a course to view exams."}</p>
          </div>
          <span>{selectedExams.length} exams</span>
        </div>

        <div className="professor-course-exam-list">
          {selectedExams.map((exam) => (
            <article key={exam.id}>
              <div>
                <strong>{exam.title}</strong>
                <small>{exam.type} • Created {exam.createdAt}</small>
              </div>
              <div>
                <span>{exam.duration} min</span>
                <Badge tone={statusTone(exam.status)}>{exam.status}</Badge>
              </div>
            </article>
          ))}
          {!selectedExams.length ? <div className="professor-exams-empty">No exams created for this course yet.</div> : null}
        </div>
      </Card>
    </>
  );
}
