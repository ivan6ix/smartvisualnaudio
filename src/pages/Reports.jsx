import { useEffect, useMemo, useState } from "react";
import { FiActivity, FiBookOpen, FiFileText, FiPrinter, FiShield, FiUsers } from "react-icons/fi";
import { Button, Card, PageHeader, SearchBox, SelectField, Table } from "../components/ui";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

const tabs = ["Overview", "All Users", "Students", "Violations", "Courses", "Exams", "Professors", "Deans", "Exam Attempts", "Grades", "System Logs"];
const violationTypes = ["MULTIPLE_FACE", "NO_FACE", "BACKGROUND_VOICE", "LOUD_NOISE_DETECTED", "AUDIO_DETECTED", "LOUD_AUDIO", "TAB_SWITCH", "COPY_ATTEMPT", "FULLSCREEN_EXIT", "LOOKING_AWAY", "PHONE_DETECTED", "GADGET_DETECTED"];

const emptyStats = {
  students: 0,
  professors: 0,
  deans: 0,
  courses: 0,
  exams: 0,
  violations: 0,
};

const emptyReportData = {
  profiles: [],
  courses: [],
  exams: [],
  violations: [],
  attempts: [],
  logs: [],
};

async function countRows(query) {
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function safeCount(query) {
  try {
    return await countRows(query);
  } catch {
    return 0;
  }
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

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function getRowsFromResponse(response) {
  return response.error ? [] : response.data || [];
}

export default function Reports() {
  const [tab, setTab] = useState("Overview");
  const [search, setSearch] = useState("");
  const [violationFilter, setViolationFilter] = useState("All Violations");
  const [stats, setStats] = useState(emptyStats);
  const [reportData, setReportData] = useState(emptyReportData);

  useEffect(() => {
    if (!hasSupabaseConfig) return;

    async function loadReports() {
      const [students, professors, deans, courses, exams, violations] = await Promise.all([
        safeCount(supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "Student")),
        safeCount(supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "Professor")),
        safeCount(supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "Dean")),
        safeCount(supabase.from("courses").select("id", { count: "exact", head: true }).eq("archived", false)),
        safeCount(supabase.from("exams").select("id", { count: "exact", head: true })),
        safeCount(supabase.from("violations").select("id", { count: "exact", head: true })),
      ]);

      setStats({ students, professors, deans, courses, exams, violations });

      const [profilesResponse, coursesResponse, examsResponse, violationsResponse, attemptsResponse, logsResponse] = await Promise.all([
        supabase.from("profiles").select("id, role, full_name, email, employee_number, student_number, status, created_at").order("created_at", { ascending: false }).limit(1000),
        supabase.from("courses").select("id, course_name, course_code, section, joining_code, professor_id, archived, created_at").order("created_at", { ascending: false }).limit(1000),
        supabase.from("exams").select("id, title, exam_title, course_id, course, duration, time_limit, status, created_at").order("created_at", { ascending: false }).limit(1000),
        supabase.from("violations").select("id, student_id, exam_id, violation_type, severity, created_at").order("created_at", { ascending: false }).limit(1000),
        supabase.from("exam_attempts").select("id, exam_id, student_id, score, submitted_at").order("submitted_at", { ascending: false }).limit(1000),
        supabase.from("logs").select("id, action, description, created_at").order("created_at", { ascending: false }).limit(1000),
      ]);

      setReportData({
        profiles: getRowsFromResponse(profilesResponse),
        courses: getRowsFromResponse(coursesResponse),
        exams: getRowsFromResponse(examsResponse),
        violations: getRowsFromResponse(violationsResponse),
        attempts: getRowsFromResponse(attemptsResponse),
        logs: getRowsFromResponse(logsResponse),
      });
    }

    loadReports();

    const channel = supabase
      .channel("reports-center-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => void loadReports())
      .on("postgres_changes", { event: "*", schema: "public", table: "courses" }, () => void loadReports())
      .on("postgres_changes", { event: "*", schema: "public", table: "exams" }, () => void loadReports())
      .on("postgres_changes", { event: "*", schema: "public", table: "violations" }, () => void loadReports())
      .on("postgres_changes", { event: "*", schema: "public", table: "exam_attempts" }, () => void loadReports())
      .on("postgres_changes", { event: "*", schema: "public", table: "logs" }, () => void loadReports())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const rowsByTab = useMemo(() => {
    const profilesById = new Map(reportData.profiles.map((profile) => [profile.id, profile]));
    const coursesById = new Map(reportData.courses.map((course) => [course.id, course]));
    const examsById = new Map(reportData.exams.map((exam) => [exam.id, exam]));

    const profileRows = reportData.profiles.map((profile) => ({
      id: profile.id,
      name: profile.full_name || "Unnamed user",
      email: profile.email || "-",
      role: profile.role || "-",
      status: profile.status || "-",
      number: profile.student_number || profile.employee_number || "-",
      createdAt: formatDate(profile.created_at),
    }));

    const courseRows = reportData.courses.map((course) => {
      const professor = profilesById.get(course.professor_id);
      return {
        id: course.id,
        course: course.course_name || "-",
        code: course.course_code || "-",
        section: course.section || "-",
        professor: professor?.full_name || "Unassigned",
        joiningCode: course.joining_code || "-",
        status: course.archived ? "Archived" : "Active",
      };
    });

    const examRows = reportData.exams.map((exam) => {
      const course = coursesById.get(exam.course_id);
      return {
        id: exam.id,
        exam: exam.exam_title || exam.title || "Untitled exam",
        course: course?.course_name || exam.course || "Unassigned course",
        duration: `${exam.time_limit || exam.duration || 0} minutes`,
        status: exam.status || "-",
        createdAt: formatDate(exam.created_at),
      };
    });

    const violationRows = reportData.violations
      .filter((violation) => violationFilter === "All Violations" || violation.violation_type === violationFilter)
      .map((violation) => {
        const student = profilesById.get(violation.student_id);
        const exam = examsById.get(violation.exam_id);
        const course = exam ? coursesById.get(exam.course_id) : null;
        const { date, time } = formatDateTime(violation.created_at);

        return {
          id: violation.id,
          student: student?.full_name || "Unknown student",
          course: course?.course_code || course?.course_name || exam?.course || "-",
          exam: exam?.exam_title || exam?.title || "Unknown exam",
          violationType: violation.violation_type || "-",
          date,
          time,
          severity: violation.severity || "-",
        };
      });

    const attemptRows = reportData.attempts.map((attempt) => {
      const student = profilesById.get(attempt.student_id);
      const exam = examsById.get(attempt.exam_id);
      const course = exam ? coursesById.get(exam.course_id) : null;

      return {
        id: attempt.id,
        student: student?.full_name || "Unknown student",
        course: course?.course_code || course?.course_name || exam?.course || "-",
        exam: exam?.exam_title || exam?.title || "Unknown exam",
        score: attempt.score === null || attempt.score === undefined ? "Pending" : `${attempt.score}%`,
        submittedAt: formatDate(attempt.submitted_at),
      };
    });

    const logRows = reportData.logs.map((log) => ({
      id: log.id,
      action: log.action || "-",
      description: log.description || "-",
      createdAt: formatDate(log.created_at),
    }));

    return {
      Overview: violationRows,
      "All Users": profileRows,
      Students: profileRows.filter((profile) => profile.role === "Student"),
      Violations: violationRows,
      Courses: courseRows,
      Exams: examRows,
      Professors: profileRows.filter((profile) => profile.role === "Professor"),
      Deans: profileRows.filter((profile) => profile.role === "Dean"),
      "Exam Attempts": attemptRows,
      Grades: attemptRows,
      "System Logs": logRows,
    };
  }, [reportData, violationFilter]);

  const columnsByTab = {
    Overview: [
      { key: "student", label: "Student" },
      { key: "course", label: "Course" },
      { key: "exam", label: "Exam" },
      { key: "violationType", label: "Violation Type" },
      { key: "date", label: "Date" },
      { key: "time", label: "Time" },
      { key: "severity", label: "Severity" },
    ],
    "All Users": [
      { key: "name", label: "Name" },
      { key: "email", label: "Email" },
      { key: "role", label: "Role" },
      { key: "number", label: "ID Number" },
      { key: "status", label: "Status" },
      { key: "createdAt", label: "Created" },
    ],
    Students: [
      { key: "name", label: "Student" },
      { key: "email", label: "Email" },
      { key: "number", label: "Student Number" },
      { key: "status", label: "Status" },
      { key: "createdAt", label: "Created" },
    ],
    Violations: [
      { key: "student", label: "Student" },
      { key: "course", label: "Course" },
      { key: "exam", label: "Exam" },
      { key: "violationType", label: "Violation Type" },
      { key: "date", label: "Date" },
      { key: "time", label: "Time" },
      { key: "severity", label: "Severity" },
    ],
    Courses: [
      { key: "course", label: "Course" },
      { key: "code", label: "Code" },
      { key: "section", label: "Section" },
      { key: "professor", label: "Professor" },
      { key: "joiningCode", label: "Joining Code" },
      { key: "status", label: "Status" },
    ],
    Exams: [
      { key: "exam", label: "Exam" },
      { key: "course", label: "Course" },
      { key: "duration", label: "Duration" },
      { key: "status", label: "Status" },
      { key: "createdAt", label: "Created" },
    ],
    Professors: [
      { key: "name", label: "Professor" },
      { key: "email", label: "Email" },
      { key: "number", label: "Employee Number" },
      { key: "status", label: "Status" },
      { key: "createdAt", label: "Created" },
    ],
    Deans: [
      { key: "name", label: "Dean" },
      { key: "email", label: "Email" },
      { key: "number", label: "Employee Number" },
      { key: "status", label: "Status" },
      { key: "createdAt", label: "Created" },
    ],
    "Exam Attempts": [
      { key: "student", label: "Student" },
      { key: "course", label: "Course" },
      { key: "exam", label: "Exam" },
      { key: "score", label: "Score" },
      { key: "submittedAt", label: "Submitted" },
    ],
    Grades: [
      { key: "student", label: "Student" },
      { key: "course", label: "Course" },
      { key: "exam", label: "Exam" },
      { key: "score", label: "Grade" },
      { key: "submittedAt", label: "Submitted" },
    ],
    "System Logs": [
      { key: "action", label: "Action" },
      { key: "description", label: "Description" },
      { key: "createdAt", label: "Date" },
    ],
  };

  const currentRows = rowsByTab[tab] || [];
  const filteredRows = currentRows.filter((row) => Object.values(row).join(" ").toLowerCase().includes(search.toLowerCase()));
  const reportStats = [
    ["Students", stats.students, FiUsers],
    ["Professors", stats.professors, FiUsers],
    ["Deans", stats.deans, FiShield],
    ["Courses", stats.courses, FiBookOpen],
    ["Exams", stats.exams, FiFileText],
    ["Violations", stats.violations, FiActivity],
  ];

  return (
    <section className="admin-dashboard-page admin-section-page">
      <div className="admin-section-hero">
        <div>
          <span><FiPrinter /> Reports Intelligence</span>
          <h1>Reports Center</h1>
          <p>Search, filter, review, and print operational reports from users, courses, exams, violations, attempts, grades, and logs.</p>
        </div>
        <strong>{filteredRows.length}</strong>
      </div>
      <PageHeader title="Reports Center" subtitle="Search, filter, review, and print operational reports." actions={<Button variant="light" onClick={() => window.print()}><FiPrinter /> Print / Save as PDF</Button>} />
      <div className="admin-stats-grid">
        {reportStats.map(([label, value, Icon]) => (
          <article className="admin-stat-card" key={label}>
            <Icon />
            <div>
              <strong>{value.toLocaleString()}</strong>
              <span>{label}</span>
            </div>
          </article>
        ))}
      </div>
      <div className="toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Search reports" />
        <SelectField label="Violation Filter" value={violationFilter} onChange={(event) => setViolationFilter(event.target.value)}>
          <option>All Violations</option>
          {violationTypes.map((type) => <option key={type}>{type}</option>)}
        </SelectField>
      </div>
      <div className="tabs">{tabs.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</div>
      <Card className="admin-panel admin-activity-panel">
        <h2>{tab === "Overview" ? "Violations Report" : tab}</h2>
        <Table columns={columnsByTab[tab] || columnsByTab.Overview} rows={filteredRows} />
      </Card>
    </section>
  );
}
