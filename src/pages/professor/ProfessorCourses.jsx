import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FiBookOpen, FiFileText, FiUsers } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ListCardGrid, ListPagination, ListViewToolbar, ResponsiveTable } from "../../components/ListViewControls";
import { Badge, Card } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import useListViewPreference from "../../hooks/useListViewPreference";
import { professorCourses, professorExams } from "../../data/professorData";
import { formatCourseMeta, formatCourseTerm } from "../../lib/coursePrograms";
import { getListPageSlice } from "../../lib/listView";
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
  const [coursePage, setCoursePage] = useState(1);
  const courseView = useListViewPreference({ role: "professor", page: "courses", defaultView: "cards" });

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
  const coursePageData = getListPageSlice(courses, coursePage, courseView.pageSize);

  function openCourse(course) {
    setSelectedCourseId(course.id);
    navigate(`/professor/courses/${course.id}/materials`);
  }

  return (
    <section className="professor-courses-page">
      <header className="professor-courses-page-header">
        <h1>Courses</h1>
        <p>View your assigned courses and the exams created for each course.</p>
      </header>

      <div className="professor-stats-grid professor-courses-stats">
        <Card className="professor-kpi-card">
          <FiBookOpen aria-hidden="true" />
          <div><span>My Courses</span><strong>{courses.length}</strong></div>
        </Card>
        <Card className="professor-kpi-card">
          <FiFileText aria-hidden="true" />
          <div><span>Course Exams</span><strong>{exams.length}</strong></div>
        </Card>
        <Card className="professor-kpi-card">
          <FiFileText aria-hidden="true" />
          <div><span>Published Exams</span><strong>{exams.filter((exam) => ["Published", "published", "Active"].includes(exam.status)).length}</strong></div>
        </Card>
        <Card className="professor-kpi-card">
          <FiUsers aria-hidden="true" />
          <div><span>Enrolled Students</span><strong>{totalStudents}</strong></div>
        </Card>
      </div>

      <Card className="professor-courses-panel">
        <div className="professor-courses-header">
          <div>
            <h2>My Courses</h2>
            <p>Open a course to manage materials, exams, and members.</p>
          </div>
          <span>{courses.length} {courses.length === 1 ? "course" : "courses"}</span>
        </div>
        <div className="professor-courses-toolbar">
          <div className="professor-courses-toolbar-summary">
            <strong>{coursePageData.rows.length}</strong>
            <span>shown on this page</span>
          </div>
          <ListViewToolbar
            controls={{
              cardDensity: courseView.cardDensity,
              onCardDensity: courseView.setCardDensity,
              onTableDensity: courseView.setTableDensity,
              onView: (nextView) => setCoursePage(courseView.switchViewPreservingPage(nextView, coursePageData.page, courses.length)),
              tableDensity: courseView.tableDensity,
              view: courseView.view,
            }}
          />
        </div>

        {courseView.view === "cards" ? (
          <ListCardGrid density={courseView.cardDensity}>
            {coursePageData.rows.map((course) => (
              <article className="professor-course-record-card" key={course.id}>
                <header className="professor-course-record-header">
                  <div>
                    <strong className="professor-course-code">{course.courseCode}</strong>
                    <span>{course.courseName}</span>
                  </div>
                  <FiBookOpen aria-hidden="true" />
                </header>
                <dl className="professor-course-record-body">
                  <div>
                    <dt>Program</dt>
                    <dd>{formatCourseMeta(course) || "Program not assigned"}</dd>
                  </div>
                  <div>
                    <dt>Term</dt>
                    <dd>{formatCourseTerm(course) || (course.section ? `Section ${course.section}` : "Section not assigned")}</dd>
                  </div>
                  <div>
                    <dt>Students</dt>
                    <dd>{course.students} student{Number(course.students) === 1 ? "" : "s"}</dd>
                  </div>
                  <div>
                    <dt>Joining Code</dt>
                    <dd>{course.joiningCode || "No code"}</dd>
                  </div>
                </dl>
                <button className="professor-course-record-action" onClick={() => openCourse(course)} type="button">Open</button>
              </article>
            ))}
          </ListCardGrid>
        ) : (
          <ResponsiveTable density={courseView.tableDensity} className="professor-courses-table-card">
            <table className="professor-courses-table">
              <colgroup>
                <col style={{ width: "26%" }} />
                <col style={{ width: "24%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "8%" }} />
              </colgroup>
              <thead><tr><th>Course</th><th>Program</th><th>Term</th><th>Students</th><th>Code</th><th>Action</th></tr></thead>
              <tbody>
                {coursePageData.rows.map((course) => (
                  <tr key={course.id}>
                    <td><strong>{course.courseCode}</strong><span>{course.courseName}</span></td>
                    <td>{formatCourseMeta(course) || "-"}</td>
                    <td>{formatCourseTerm(course) || "-"}</td>
                    <td>{course.students}</td>
                    <td>{course.joiningCode || "No code"}</td>
                    <td><button className="professor-score-link-button" onClick={() => openCourse(course)} type="button">Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        )}
        {!courses.length ? (
          <div className="professor-courses-empty">
            <strong>No assigned courses found.</strong>
            <span>Your assigned courses will appear here.</span>
          </div>
        ) : null}
        <ListPagination count={courses.length} page={coursePageData.page} pageSize={courseView.pageSize} onPage={setCoursePage} />
      </Card>

      <Card className="professor-courses-panel professor-course-exams-panel">
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
    </section>
  );
}
