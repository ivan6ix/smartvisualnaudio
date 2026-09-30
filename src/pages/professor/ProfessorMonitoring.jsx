import { useEffect, useMemo, useState } from "react";
import { FiActivity, FiBookOpen, FiUser, FiUsers, FiX } from "react-icons/fi";
import { toast } from "sonner";
import { ListPagination, ListViewToolbar, ResponsiveTable } from "../../components/ListViewControls";
import { Badge, Button, Card, PageHeader, SearchBox, StatCard } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { professorAlerts } from "../../data/professorData";
import useListViewPreference from "../../hooks/useListViewPreference";
import { getListPageSlice } from "../../lib/listView";
import {
  MONITORING_INITIAL_VIOLATION_LIMIT,
  getViolationEvidenceState,
  shouldRequestLazyEvidence,
} from "../../lib/professorMonitoring";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

const violationLabels = {
  MULTIPLE_FACE: "Multiple face detected",
  NO_FACE: "No face detected",
  BACKGROUND_VOICE: "Background voice detected",
  LOUD_NOISE_DETECTED: "Loud Noise Detected",
  AUDIO_DETECTED: "Audio detected",
  LOUD_AUDIO: "Loud audio detected",
  TAB_SWITCH: "Tab switch attempt",
  COPY_ATTEMPT: "Copy attempt detected",
  FULLSCREEN_EXIT: "Fullscreen exit detected",
  LOOKING_AWAY: "Looking away repeatedly",
  PHONE_DETECTED: "Cellphone detected",
  GADGET_DETECTED: "Spare gadget detected",
};

function severityTone(severity) {
  if (severity === "High") return "danger";
  if (severity === "Medium") return "warn";
  return "neutral";
}

function formatDateTime(value) {
  if (!value) return { date: "-", time: "-" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "-", time: "-" };
  return {
    date: date.toLocaleDateString(),
    time: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
}

function fallbackStudents() {
  const names = [...new Set(professorAlerts.map((alert) => alert.student))];
  return names.map((name, index) => ({
    id: `demo-student-${index}`,
    name,
    studentNumber: `S-${String(index + 1).padStart(4, "0")}`,
    section: "Demo Section",
  }));
}

function firstRow(value) {
  return Array.isArray(value) ? value[0] : value;
}

function parseCourseLabel(value) {
  const text = String(value || "").trim();
  if (!text) return {};
  const parts = text.split(/\s+(?:-|–|\|)\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      courseCode: parts[0],
      section: parts.slice(1).join(" - "),
    };
  }
  return { courseCode: text };
}

async function findNearestAudioEvidence(violation) {
  if (!violation.student_id || !violation.exam_id) return null;
  const folder = `${violation.student_id}/${violation.exam_id}`;
  const { data, error } = await supabase.storage.from("audio-violations").list(folder, {
    limit: 100,
    sortBy: { column: "created_at", order: "desc" },
  });
  if (error || !data?.length) return null;

  const violationTime = new Date(violation.created_at).getTime();
  const files = data
    .filter((file) => file.name?.endsWith(".webm"))
    .map((file) => ({
      path: `${folder}/${file.name}`,
      distance: Math.abs(new Date(file.created_at || file.updated_at || file.name).getTime() - violationTime),
    }))
    .filter((file) => Number.isFinite(file.distance))
    .sort((first, second) => first.distance - second.distance);

  return files[0]?.distance <= 5 * 60 * 1000 ? files[0].path : files[0]?.path || null;
}

export default function ProfessorMonitoring() {
  const { user } = useAuth();
  const [students, setStudents] = useState(() => hasSupabaseConfig ? [] : fallbackStudents());
  const [monitoringCourses, setMonitoringCourses] = useState([]);
  const [monitoringExams, setMonitoringExams] = useState([]);
  const [violations, setViolations] = useState(() => hasSupabaseConfig ? [] : professorAlerts.map((alert, index) => ({
    id: alert.id,
    studentId: fallbackStudents()[index % fallbackStudents().length]?.id,
    exam: alert.exam,
    activity: alert.activity,
    severity: alert.severity,
    date: "Demo",
    time: alert.time,
    courseId: "demo-course",
    courseCode: "Demo Course",
    section: "Demo Section",
    period: "Demo",
    examName: alert.exam,
  })));
  const [evidenceLoadingId, setEvidenceLoadingId] = useState("");
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [studentSearch, setStudentSearch] = useState("");
  const [studentCourseFilter, setStudentCourseFilter] = useState("All Courses");
  const [studentSectionFilter, setStudentSectionFilter] = useState("All Sections");
  const [studentPage, setStudentPage] = useState(1);
  const [activityFilters, setActivityFilters] = useState({
    course: "All Courses",
    period: "All Periods",
    exam: "All Exams",
  });
  const studentListView = useListViewPreference({ role: "professor", page: "monitoring-center", defaultView: "cards" });

  useEffect(() => {
    if (!hasSupabaseConfig || !user?.id) return;

    async function loadMonitoring() {
      const { data: courseRows, error: coursesError } = await supabase
        .from("courses")
        .select("id, course_code, section")
        .eq("professor_id", user.id);

      if (coursesError) {
        toast.error(coursesError.message);
        return;
      }

      const courseIds = (courseRows || []).map((course) => course.id);
      setMonitoringCourses(courseRows || []);
      if (!courseIds.length) {
        setStudents([]);
        setMonitoringExams([]);
        setViolations([]);
        return;
      }

      const [{ data: enrollmentRows, error: enrollmentsError }, { data: examRows, error: examsError }] = await Promise.all([
        supabase
          .from("course_enrollments")
          .select("course_id, student_id, profiles:student_id(full_name, student_number, email)")
          .in("course_id", courseIds),
        supabase
          .from("exams")
          .select("id, title, exam_title, description, course, course_id, courses(course_code, section)")
          .in("course_id", courseIds)
          .or(`professor_id.eq.${user.id},created_by.eq.${user.id}`),
      ]);

      if (enrollmentsError) {
        toast.error(enrollmentsError.message);
        return;
      }
      if (examsError) {
        toast.error(examsError.message);
        return;
      }

      const examById = new Map((examRows || []).map((exam) => [exam.id, exam]));
      const courseById = new Map((courseRows || []).map((course) => [course.id, course]));
      setMonitoringExams(examRows || []);
      const studentById = new Map();
      (enrollmentRows || []).forEach((enrollment) => {
        const profile = enrollment.profiles;
        const course = courseById.get(enrollment.course_id);
        if (!profile) return;

        const courseInfo = course ? {
          id: course.id,
          courseCode: course.course_code || "No course",
          section: course.section || "No section",
        } : {
          id: enrollment.course_id,
          courseCode: "No course",
          section: "No section",
        };

        if (studentById.has(enrollment.student_id)) {
          const existing = studentById.get(enrollment.student_id);
          if (!existing.courses.some((item) => item.id === courseInfo.id)) {
            existing.courses.push(courseInfo);
          }
          return;
        }

        studentById.set(enrollment.student_id, {
          id: enrollment.student_id,
          name: profile.full_name || profile.email || "Unnamed student",
          studentNumber: profile.student_number || "No student ID",
          section: course ? `${course.course_code} - ${course.section}` : "No section",
          courseCode: course?.course_code || "No course",
          courses: [courseInfo],
        });
      });

      const liveStudents = Array.from(studentById.values());
      setStudents(liveStudents);

      const examIds = (examRows || []).map((exam) => exam.id);

      let violationRows = [];
      let violationsError = null;
      const violationSelect = "id, student_id, exam_id, course_id, violation_type, severity, screenshot_url, evidence_url, evidence_type, audio_level, created_at, profiles:student_id(full_name, student_number, email), exams(id, title, exam_title, description, course, course_id, courses(course_code, section))";
      const fallbackViolationSelect = "id, student_id, exam_id, course_id, violation_type, severity, screenshot_url, created_at, profiles:student_id(full_name, student_number, email), exams(id, title, exam_title, description, course, course_id)";
      const violationFilter = examIds.length
        ? `professor_id.eq.${user.id},exam_id.in.(${examIds.join(",")})`
        : `professor_id.eq.${user.id}`;
      const violationsResult = await supabase
        .from("violations")
        .select(violationSelect)
        .or(violationFilter)
        .order("created_at", { ascending: false })
        .limit(MONITORING_INITIAL_VIOLATION_LIMIT);

      if (
        violationsResult.error?.message?.includes("evidence_url")
        || violationsResult.error?.message?.includes("evidence_type")
        || violationsResult.error?.message?.includes("audio_level")
        || violationsResult.error?.message?.includes("courses")
        || violationsResult.error?.message?.includes("professor_id")
      ) {
        const fallbackViolationsResult = await supabase
          .from("violations")
          .select(fallbackViolationSelect)
          .in("exam_id", examIds)
          .order("created_at", { ascending: false })
          .limit(MONITORING_INITIAL_VIOLATION_LIMIT);
        violationRows = fallbackViolationsResult.data || [];
        violationsError = fallbackViolationsResult.error;
      } else {
        violationRows = violationsResult.data || [];
        violationsError = violationsResult.error;
      }

      if (violationsError) {
        toast.error(violationsError.message);
        return;
      }

      (violationRows || []).forEach((violation) => {
        const profile = violation.profiles;
        if (!profile || studentById.has(violation.student_id)) return;
        studentById.set(violation.student_id, {
          id: violation.student_id,
          name: profile.full_name || profile.email || "Unnamed student",
          studentNumber: profile.student_number || "No student ID",
          section: "Recorded violation",
          courseCode: "Recorded violation",
          courses: [],
        });
      });
      setStudents(Array.from(studentById.values()));

      const rowsWithEvidenceState = (violationRows || []).map((violation) => {
        const { date, time } = formatDateTime(violation.created_at);
        const evidenceState = getViolationEvidenceState(violation);
        const exam = { ...(examById.get(violation.exam_id) || {}), ...(violation.exams || {}) };
        const courseId = exam.course_id || violation.course_id || "";
        const course = firstRow(exam.courses) || courseById.get(courseId);
        const enrolledCourse = studentById.get(violation.student_id)?.courses?.find((item) => item.id === courseId)
          || (studentById.get(violation.student_id)?.courses?.length === 1 ? studentById.get(violation.student_id).courses[0] : null);
        const parsedCourse = parseCourseLabel(exam.course);
        const resolvedCourseId = courseId || enrolledCourse?.id || "";
        const examName = exam.exam_title || exam.title || "Unknown exam";
        return {
          id: violation.id,
          studentId: violation.student_id,
          exam: examName,
          examId: violation.exam_id,
          examName,
          courseId: resolvedCourseId,
          courseCode: course?.course_code || enrolledCourse?.courseCode || parsedCourse.courseCode || "Unknown course",
          section: course?.section || enrolledCourse?.section || parsedCourse.section || "Unknown section",
          period: exam.description || "No period",
          activity: violationLabels[violation.violation_type] || violation.violation_type || "Monitoring alert",
          severity: violation.severity || "Low",
          evidencePath: evidenceState.audioPath || violation.screenshot_url || "",
          screenshotUrl: "",
          audioLevel: violation.audio_level,
          audioUrl: evidenceState.audioPath?.startsWith("data:audio/") ? evidenceState.audioPath : "",
          hasAudioEvidence: evidenceState.hasAudioEvidence,
          hasScreenshotEvidence: evidenceState.hasScreenshotEvidence,
          evidenceLoading: false,
          createdAt: violation.created_at,
          date,
          time,
        };
      });
      setViolations(rowsWithEvidenceState);
    }

    loadMonitoring();
    const channel = supabase
      .channel(`professor-monitoring-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "violations" }, () => {
        void loadMonitoring();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const studentsWithCounts = useMemo(() => {
    const counts = new Map();
    for (const violation of violations) counts.set(violation.studentId, (counts.get(violation.studentId) || 0) + 1);
    return students.map(student => ({ ...student, alertCount: counts.get(student.id) || 0 }));
  }, [students, violations]);
  const studentCourseOptions = useMemo(() => [...monitoringCourses]
    .sort((first, second) => String(first.course_code || "").localeCompare(String(second.course_code || ""))), [monitoringCourses]);
  const studentSectionOptions = useMemo(() => [...new Set(monitoringCourses
    .filter((course) => studentCourseFilter === "All Courses" || course.id === studentCourseFilter)
    .map((course) => course.section)
    .filter(Boolean))]
    .sort((first, second) => first.localeCompare(second)), [monitoringCourses, studentCourseFilter]);
  const filteredStudentsWithCounts = useMemo(() => {
    const normalizedSearch = studentSearch.trim().toLowerCase();
    return studentsWithCounts.filter((student) => {
      const courses = student.courses || [];
      const matchesSearch = !normalizedSearch
        || `${student.name} ${student.studentNumber} ${courses.map((course) => `${course.courseCode} ${course.section}`).join(" ")}`.toLowerCase().includes(normalizedSearch);
      const matchesCourse = studentCourseFilter === "All Courses" || courses.some((course) => course.id === studentCourseFilter);
      const matchesSection = studentSectionFilter === "All Sections" || courses.some((course) => (
        course.section === studentSectionFilter
        && (studentCourseFilter === "All Courses" || course.id === studentCourseFilter)
      ));
      return matchesSearch && matchesCourse && matchesSection;
    });
  }, [studentCourseFilter, studentSearch, studentSectionFilter, studentsWithCounts]);
  const studentPageData = getListPageSlice(filteredStudentsWithCounts, studentPage, studentListView.pageSize);
  const selectedViolations = useMemo(() => selectedStudent
    ? violations.filter((violation) => violation.studentId === selectedStudent.id)
    : [], [selectedStudent, violations]);
  const filterOptions = useMemo(() => {
    const selectedCourseIds = new Set((selectedStudent?.courses || []).map((course) => course.id).filter(Boolean));
    const activeCourseIds = activityFilters.course === "All Courses"
      ? selectedCourseIds
      : new Set([activityFilters.course]);
    const relevantExams = monitoringExams.filter((exam) => activeCourseIds.has(exam.course_id));
    const periodNames = [...new Set(relevantExams.map((exam) => exam.description || "No period"))]
      .sort((first, second) => first.localeCompare(second));
    const examOptions = relevantExams
      .filter((exam) => activityFilters.period === "All Periods" || (exam.description || "No period") === activityFilters.period)
      .map((exam) => ({
        id: exam.id,
        title: exam.exam_title || exam.title || "Unknown exam",
      }))
      .sort((first, second) => first.title.localeCompare(second.title));
    return {
      courses: [...(selectedStudent?.courses || [])].sort((first, second) => first.courseCode.localeCompare(second.courseCode)),
      periods: periodNames,
      exams: examOptions,
    };
  }, [activityFilters.course, activityFilters.period, monitoringExams, selectedStudent]);
  const filteredSelectedViolations = useMemo(() => selectedViolations.filter((violation) => (
    (activityFilters.course === "All Courses" || violation.courseId === activityFilters.course)
    && (activityFilters.period === "All Periods" || violation.period === activityFilters.period)
    && (activityFilters.exam === "All Exams" || violation.examId === activityFilters.exam)
  )), [activityFilters, selectedViolations]);

  function openActivities(student) {
    setSelectedStudent(student);
    setActivityFilters({
      course: "All Courses",
      period: "All Periods",
      exam: "All Exams",
    });
  }

  async function loadEvidence(violation) {
    if (!hasSupabaseConfig || !shouldRequestLazyEvidence(violation)) return;
    setEvidenceLoadingId(violation.id);
    setViolations((current) => current.map((item) => item.id === violation.id ? { ...item, evidenceLoading: true } : item));
    try {
      let audioPath = violation.hasAudioEvidence ? violation.evidencePath : "";
      let audioUrl = "";
      let screenshotUrl = "";
      if (audioPath?.startsWith("data:audio/")) {
        audioUrl = audioPath;
      } else if (!audioPath && violation.hasAudioEvidence) {
        audioPath = await findNearestAudioEvidence({
          student_id: violation.studentId,
          exam_id: violation.examId,
          created_at: violation.createdAt,
        });
      }
      if (audioPath && !audioUrl) {
        const { data: signed, error } = await supabase.storage.from("audio-violations").createSignedUrl(audioPath, 60 * 60);
        if (error) throw error;
        audioUrl = signed?.signedUrl || "";
      } else if (violation.hasScreenshotEvidence && violation.evidencePath) {
        const { data: signed, error } = await supabase.storage.from("proctor-snapshots").createSignedUrl(violation.evidencePath, 60 * 60);
        if (error) throw error;
        screenshotUrl = signed?.signedUrl || "";
      }
      setViolations((current) => current.map((item) => item.id === violation.id ? { ...item, audioUrl, screenshotUrl, evidenceLoading: false } : item));
    } catch (error) {
      toast.error(error.message || "Unable to load evidence.");
      setViolations((current) => current.map((item) => item.id === violation.id ? { ...item, evidenceLoading: false } : item));
    } finally {
      setEvidenceLoadingId("");
    }
  }

  return (
    <>
      <PageHeader title="Monitoring Center" subtitle="Review student activity and proctoring alerts across your exams." />

      <div className="professor-stats-grid">
        <StatCard label="Monitored Students" value={students.length} icon={FiUsers} />
        <StatCard label="Total Alerts" value={violations.length} icon={FiActivity} />
        <StatCard label="Courses Covered" value={monitoringCourses.length} icon={FiBookOpen} />
        <StatCard label="Flagged Students" value={studentsWithCounts.filter((student) => student.alertCount > 0).length} icon={FiUser} />
      </div>

      <Card>
        <div className="professor-courses-header">
          <div>
            <h2>Students</h2>
            <p>Select View Activities to inspect alerts and violations.</p>
          </div>
          <span>{filteredStudentsWithCounts.length} students</span>
        </div>
        <ListViewToolbar
          controls={{
            cardDensity: studentListView.cardDensity,
            onCardDensity: studentListView.setCardDensity,
            onTableDensity: studentListView.setTableDensity,
            onView: (nextView) => setStudentPage(studentListView.switchViewPreservingPage(nextView, studentPageData.page, filteredStudentsWithCounts.length)),
            tableDensity: studentListView.tableDensity,
            view: studentListView.view,
          }}
        />

        <div className="professor-monitoring-student-filters">
          <SearchBox value={studentSearch} onChange={(value) => { setStudentSearch(value); setStudentPage(1); }} placeholder="Search students or ID" />
          <select
            aria-label="Filter students by course"
            onChange={(event) => {
              setStudentCourseFilter(event.target.value);
              setStudentSectionFilter("All Sections");
              setStudentPage(1);
            }}
            value={studentCourseFilter}
          >
            <option>All Courses</option>
            {studentCourseOptions.map((course) => <option key={course.id} value={course.id}>{course.course_code}</option>)}
          </select>
          <select
            aria-label="Filter students by section"
            onChange={(event) => { setStudentSectionFilter(event.target.value); setStudentPage(1); }}
            value={studentSectionFilter}
          >
            <option>All Sections</option>
            {studentSectionOptions.map((section) => <option key={section}>{section}</option>)}
          </select>
        </div>

        {studentListView.view === "cards" ? (
          <div className="professor-monitoring-grid">
            {studentPageData.rows.map((student) => (
              <article key={student.id}>
                <div className="professor-monitoring-avatar">{student.name.slice(0, 1).toUpperCase()}</div>
                <div>
                  <strong>{student.name}</strong>
                  <span>{student.studentNumber}</span>
                  <small>{(student.courses || []).map((course) => `${course.courseCode} ${course.section}`).join(" • ") || student.section}</small>
                </div>
                <Badge tone={student.alertCount ? "danger" : "success"}>{student.alertCount} alerts</Badge>
                <Button variant="light" onClick={() => openActivities(student)}>View Activities</Button>
              </article>
            ))}
            {!filteredStudentsWithCounts.length ? <div className="professor-exams-empty">{students.length ? "No students match your filters." : "No enrolled students found for your courses."}</div> : null}
          </div>
        ) : (
          <ResponsiveTable density={studentListView.tableDensity} className="professor-monitoring-table-wrap">
            <table className="professor-score-table compact professor-monitoring-table">
              <thead><tr><th>Student</th><th>Course / Section</th><th>Status</th><th>Violations</th><th>Action</th></tr></thead>
              <tbody>
                {studentPageData.rows.map((student) => (
                  <tr key={student.id}>
                    <td><strong>{student.name}</strong><span>{student.studentNumber}</span></td>
                    <td>{(student.courses || []).map((course) => `${course.courseCode} ${course.section}`).join(" • ") || student.section}</td>
                    <td><Badge tone={student.alertCount ? "danger" : "success"}>{student.alertCount ? "Flagged" : "Clear"}</Badge></td>
                    <td>{student.alertCount}</td>
                    <td><button className="professor-score-link-button" onClick={() => openActivities(student)} type="button">View Activities</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filteredStudentsWithCounts.length ? <div className="professor-exams-empty">{students.length ? "No students match your filters." : "No enrolled students found for your courses."}</div> : null}
          </ResponsiveTable>
        )}
        <ListPagination count={filteredStudentsWithCounts.length} page={studentPageData.page} pageSize={studentListView.pageSize} onPage={setStudentPage} />
      </Card>

      {selectedStudent ? (
        <div className="professor-monitoring-backdrop" onClick={() => setSelectedStudent(null)} role="presentation">
          <section className="professor-monitoring-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="professor-share-header">
              <div>
                <h2>{selectedStudent.name}</h2>
                <p>{selectedStudent.studentNumber}</p>
              </div>
              <div className="professor-monitoring-filters">
                <select
                  aria-label="Filter by course"
                  onChange={(event) => setActivityFilters((current) => ({
                    ...current,
                    course: event.target.value,
                    period: "All Periods",
                    exam: "All Exams",
                  }))}
                  value={activityFilters.course}
                >
                  <option>All Courses</option>
                  {filterOptions.courses.map((course) => (
                    <option key={course.id} value={course.id}>{course.courseCode}</option>
                  ))}
                </select>
                <select
                  aria-label="Filter by period"
                  onChange={(event) => setActivityFilters((current) => ({
                    ...current,
                    period: event.target.value,
                    exam: "All Exams",
                  }))}
                  value={activityFilters.period}
                >
                  <option>All Periods</option>
                  {filterOptions.periods.map((period) => <option key={period}>{period}</option>)}
                </select>
                <select
                  aria-label="Filter by exam"
                  onChange={(event) => setActivityFilters((current) => ({ ...current, exam: event.target.value }))}
                  value={activityFilters.exam}
                >
                  <option>All Exams</option>
                  {filterOptions.exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.title}</option>)}
                </select>
              </div>
              <button aria-label="Close activities" onClick={() => setSelectedStudent(null)} type="button"><FiX /></button>
            </div>

            <div className="professor-monitoring-alert-list">
              {filteredSelectedViolations.map((violation) => (
                <article key={violation.id}>
                  <div>
                    <strong>{violation.activity}</strong>
                    <span>{violation.courseCode} - {violation.section} - {violation.period} - {violation.examName}</span>
                    <small>{violation.date} - {violation.time}</small>
                    {shouldRequestLazyEvidence(violation) ? (
                      <Button variant="light" disabled={evidenceLoadingId === violation.id} onClick={() => loadEvidence(violation)}>
                        {evidenceLoadingId === violation.id ? "Loading evidence..." : "Load evidence"}
                      </Button>
                    ) : null}
                    {violation.screenshotUrl ? (
                      <a href={violation.screenshotUrl} rel="noreferrer" target="_blank">
                        <img alt={`${violation.activity} snapshot`} decoding="async" loading="lazy" src={violation.screenshotUrl} />
                      </a>
                    ) : null}
                    {violation.audioUrl ? (
                      <div className="professor-audio-evidence">
                        <small>Audio level: {violation.audioLevel ?? "-"}%</small>
                        <strong>Play recorded audio</strong>
                        <audio controls src={violation.audioUrl} />
                      </div>
                    ) : null}
                    {violation.hasAudioEvidence && !violation.audioUrl && !shouldRequestLazyEvidence(violation) ? (
                      <div className="professor-audio-evidence missing">
                        <small>No audio recording attached. Check the audio-violations bucket and violation evidence columns.</small>
                      </div>
                    ) : null}
                  </div>
                  <Badge tone={severityTone(violation.severity)}>{violation.severity}</Badge>
                </article>
              ))}
              {!filteredSelectedViolations.length ? <div className="professor-exams-empty">No violations recorded for the selected filters.</div> : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
