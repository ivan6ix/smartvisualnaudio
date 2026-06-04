import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Field, PageHeader, SearchBox, SelectField, Table } from "../../components/ui";
import { useCluster } from "../../context/ClusterContext";
import { StatusBadge } from "./helpers";

const titles = {
  "Pending Review": "Pending Exams",
  Approved: "Approved Exams",
  Rejected: "Rejected Exams",
};

export default function ClusterExamList({ status }) {
  const { exams, approveExam, rejectExam } = useCluster();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [course, setCourse] = useState("All Courses");
  const [professor, setProfessor] = useState("All Professors");
  const [date, setDate] = useState("");
  const [statusFilter, setStatusFilter] = useState(status);
  const [loadingActionId, setLoadingActionId] = useState("");
  const courses = ["All Courses", ...new Set(exams.map((exam) => exam.course))];
  const professors = ["All Professors", ...new Set(exams.map((exam) => exam.professorName))];

  useEffect(() => {
    setStatusFilter(status);
  }, [status]);

  async function handleApprove(examId) {
    setLoadingActionId(examId);
    await approveExam(examId);
    setLoadingActionId("");
  }

  async function handleReject(examId) {
    setLoadingActionId(examId);
    await rejectExam(examId, "Incorrect answer key");
    setLoadingActionId("");
  }

  const filtered = useMemo(() => exams.filter((exam) => {
    const matchesStatus = statusFilter === "All Statuses" || exam.status === statusFilter;
    const matchesSearch = `${exam.id} ${exam.examTitle} ${exam.professorName} ${exam.course}`.toLowerCase().includes(search.toLowerCase());
    const matchesCourse = course === "All Courses" || exam.course === course;
    const matchesProfessor = professor === "All Professors" || exam.professorName === professor;
    const matchesDate = !date || exam.submittedAt === date || exam.approvedAt === date || exam.rejectedAt === date;
    return matchesStatus && matchesSearch && matchesCourse && matchesProfessor && matchesDate;
  }), [exams, search, course, professor, date, statusFilter]);

  const columns = status === "Approved" ? [
    { key: "examTitle", label: "Exam Title" },
    { key: "professorName", label: "Professor Name" },
    { key: "course", label: "Course" },
    { key: "approvedAt", label: "Approved Date" },
    { key: "approvedBy", label: "Approved By", render: () => "Prof. Nolan Lim" },
    { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
  ] : status === "Rejected" ? [
    { key: "examTitle", label: "Exam Title" },
    { key: "professorName", label: "Professor Name" },
    { key: "course", label: "Course" },
    { key: "rejectedAt", label: "Rejected Date" },
    { key: "rejectionReason", label: "Reason" },
    { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
  ] : [
    { key: "id", label: "Exam ID" },
    { key: "examTitle", label: "Exam Title" },
    { key: "professorName", label: "Professor Name" },
    { key: "course", label: "Course" },
    { key: "questionsCount", label: "Questions Count" },
    { key: "timeLimit", label: "Duration", render: (row) => `${row.timeLimit} min` },
    { key: "passingScore", label: "Passing Score", render: (row) => `${row.passingScore}%` },
    { key: "submittedAt", label: "Submission Date" },
    { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <>
      <PageHeader title={titles[status]} subtitle="Use filters to find examinations by course, professor, date, and status." />
      <div className="cluster-filters">
        <SearchBox value={search} onChange={setSearch} placeholder="Search exam" />
        <SelectField label="Course" value={course} onChange={(event) => setCourse(event.target.value)}>{courses.map((item) => <option key={item}>{item}</option>)}</SelectField>
        <SelectField label="Professor" value={professor} onChange={(event) => setProfessor(event.target.value)}>{professors.map((item) => <option key={item}>{item}</option>)}</SelectField>
        <Field label="Date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        <SelectField label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option>{status}</option>
          <option>All Statuses</option>
          <option>Draft</option>
          <option>Pending Review</option>
          <option>Approved</option>
          <option>Rejected</option>
          <option>Published</option>
        </SelectField>
      </div>
      <Card>
        <Table columns={columns} rows={filtered} renderActions={(row) => status === "Approved" ? (
          <>
            <Button variant="light" onClick={() => navigate(`/cluster/exams/${row.id}`)}>View</Button>
            <Button variant="light">Download Review</Button>
            <Button variant="light">Generate Report</Button>
          </>
        ) : status === "Rejected" ? (
          <>
            <Button variant="light" onClick={() => navigate(`/cluster/exams/${row.id}`)}>View</Button>
            <Button variant="light">Download Feedback</Button>
            <Button variant="light">Resubmission History</Button>
          </>
        ) : (
          <>
            <Button variant="light" onClick={() => navigate(`/cluster/exams/${row.id}`)}>View Exam</Button>
            <Button variant="light" onClick={() => navigate(`/cluster/exams/${row.id}`)}>Review Exam</Button>
            <Button disabled={loadingActionId === row.id} variant="light" onClick={() => handleApprove(row.id)}>{loadingActionId === row.id ? "Saving..." : "Approve"}</Button>
            <Button disabled={loadingActionId === row.id} variant="light" onClick={() => handleReject(row.id)}>Reject</Button>
            <Button variant="light" onClick={() => navigate(`/cluster/exams/${row.id}`)}>Send Feedback</Button>
          </>
        )} />
      </Card>
    </>
  );
}
