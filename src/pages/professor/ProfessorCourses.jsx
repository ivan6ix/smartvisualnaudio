import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FiBookOpen, FiFileText, FiUsers } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Badge, Card, PageHeader, StatCard } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { professorCourses, professorExams } from "../../data/professorData";
import { formatCourseMeta, formatCourseTerm } from "../../lib/coursePrograms";
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
    programCode: course.programs?.program_code || course.programCode || "",
    programName: course.programs?.program_name || course.programName || "",
    yearLevel: course.year_level || course.yearLevel || "",
    section: course.section,
    semester: course.semester || "",
    academicYear: course.academic_year || course.academicYear || "",
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
  const demoCourses = useMemo(() => professorCourses.map((course) => mapCourse(course)), []);
  const demoExams = useMemo(() => professorExams.map((exam) => ({
    ...mapExam(exam),
    courseId: professorCourses.find((course) => course.courseName === exam.course && course.section === exam.section)?.id,
  })), []);
  const [selectedCourseId, setSelectedCourseId] = useState(demoCourses[0]?.id || "");

  const coursesQuery = useQuery({
    queryKey: ["professor-courses", user?.id],
    enabled: hasSupabaseConfig && Boolean(user?.id),
    queryFn: async () => {
      const { data: courseRows, error: coursesError } = await supabase
        .from("courses")
        .select("id, course_name, course_code, program_id, year_level, section, semester, academic_year, joining_code, archived, programs(program_code, program_name, is_active)")
        .eq("professor_id", user.id)
        .eq("archived", false)
        .order("created_at", { ascending: false });

      if (coursesError) {
        throw coursesError;
      }

      const courseIds = (courseRows || []).map((course) => course.id);
      let enrollmentCounts = {};
      let uniqueStudentCount = 0;

      if (courseIds.length) {
        const { data: enrollmentRows, error: enrollmentsError } = await supabase
          .from("course_enrollments")
          .select("course_id, student_id")
          .in("course_id", courseIds);

        if (enrollmentsError) {
          throw enrollmentsError;
        } else {
          const studentsByCourse = {};
          const uniqueStudents = new Set();

          (enrollmentRows || []).forEach((enrollment) => {
            if (!enrollment.course_id || !enrollment.student_id) return;
            if (!studentsByCourse[enrollment.course_id]) studentsByCourse[enrollment.course_id] = new Set();
            studentsByCourse[enrollment.course_id].add(enrollment.student_id);
            uniqueStudents.add(enrollment.student_id);
          });

          enrollmentCounts = Object.fromEntries(
            Object.entries(studentsByCourse).map(([courseId, students]) => [courseId, students.size]),
          );
          uniqueStudentCount = uniqueStudents.size;
        }
      }

      const liveCourses = (courseRows || []).map((course) => mapCourse(course, enrollmentCounts));

      if (!courseIds.length) {
        return { courses: liveCourses, exams: [], uniqueStudentCount };
      }

      const { data: examRows, error: examsError } = await supabase
        .from("exams")
        .select("id, title, exam_title, exam_type, course_id, duration, time_limit, status, created_at")
        .in("course_id", courseIds)
        .or(`professor_id.eq.${user.id},created_by.eq.${user.id}`)
        .order("created_at", { ascending: false });

      if (examsError) {
        throw examsError;
      }

      return { courses: liveCourses, exams: (examRows || []).map(mapExam), uniqueStudentCount };
    },
  });

  const courses = useMemo(() => hasSupabaseConfig ? coursesQuery.data?.courses || [] : demoCourses, [coursesQuery.data, demoCourses]);
  const exams = useMemo(() => hasSupabaseConfig ? coursesQuery.data?.exams || [] : demoExams, [coursesQuery.data, demoExams]);
  const uniqueEnrolledStudents = hasSupabaseConfig ? coursesQuery.data?.uniqueStudentCount ?? null : null;

  useEffect(() => {
    setSelectedCourseId((current) => current && courses.some((course) => course.id === current) ? current : courses[0]?.id || "");
  }, [courses]);

  useEffect(() => {
    if (coursesQuery.error) toast.error(coursesQuery.error.message);
  }, [coursesQuery.error]);

  const selectedCourse = courses.find((course) => course.id === selectedCourseId);
  const selectedExams = useMemo(() => exams.filter((exam) => exam.courseId === selectedCourseId), [exams, selectedCourseId]);
  const totalStudents = uniqueEnrolledStudents ?? courses.reduce((total, course) => total + Number(course.students || 0), 0);

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
                <strong className="professor-course-code">{course.courseCode}</strong>
                <span>{course.courseName}</span>
                <small>{formatCourseMeta(course)}</small>
                <small>{formatCourseTerm(course) || `${course.students} students`}</small>
                {formatCourseTerm(course) ? <small>{course.students} students</small> : null}
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
