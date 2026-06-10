import { useEffect, useMemo, useState } from "react";
import { FiClock, FiDownload, FiX } from "react-icons/fi";
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
  const { exams, filterOptions, reviews, approveExam, rejectExam } = useCluster();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [course, setCourse] = useState("All Courses");
  const [professor, setProfessor] = useState("All Professors");
  const [date, setDate] = useState("");
  const [statusFilter, setStatusFilter] = useState(status);
  const [loadingActionId, setLoadingActionId] = useState("");
  const [historyExam, setHistoryExam] = useState(null);
  const courses = useMemo(() => ["All Courses", ...new Set([...(filterOptions?.courses || []), ...exams.map((exam) => exam.course)].filter(Boolean))], [exams, filterOptions]);
  const professors = useMemo(() => ["All Professors", ...new Set([...(filterOptions?.professors || []), ...exams.map((exam) => exam.professorName)].filter(Boolean))], [exams, filterOptions]);

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

  function downloadFeedback(exam) {
    const feedback = [
      `Exam: ${exam.examTitle}`,
      `Professor: ${exam.professorName}`,
      `Course: ${exam.course}`,
      `Rejected Date: ${exam.rejectedAt || "N/A"}`,
      "",
      "Feedback:",
      exam.rejectionReason || exam.reviewNotes || "No feedback recorded.",
    ].join("\n");
    const blob = new globalThis.Blob([feedback], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = globalThis.URL.createObjectURL(blob);
    link.download = `${exam.examTitle || "exam"}-feedback.txt`.replace(/[^\w.-]+/g, "-");
    link.click();
    globalThis.URL.revokeObjectURL(link.href);
  }

  const historyEntries = useMemo(() => {
    if (!historyExam) return [];

    const relatedReviews = reviews
      .filter((review) => review.examId === historyExam.id)
      .sort((a, b) => String(a.reviewDate || "").localeCompare(String(b.reviewDate || "")));

    if (relatedReviews.length) {
      return relatedReviews.map((review, index) => ({
        id: review.id,
        attempt: index + 1,
        date: review.reviewDate || "No date",
        decision: review.decision || "Revision Needed",
        remarks: review.remarks || "No remarks recorded.",
      }));
    }

    if (historyExam.rejectedAt || historyExam.rejectionReason || historyExam.reviewNotes) {
      return [{
        id: `${historyExam.id}-rejected`,
        attempt: 1,
        date: historyExam.rejectedAt || historyExam.submittedAt || "No date",
        decision: "Rejected",
        remarks: historyExam.rejectionReason || historyExam.reviewNotes || "No remarks recorded.",
      }];
    }

    return [];
  }, [historyExam, reviews]);

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
            <Button variant="light" onClick={() => downloadFeedback(row)}><FiDownload /> Download Feedback</Button>
            <Button variant="light" onClick={() => setHistoryExam(row)}><FiClock /> Resubmission History</Button>
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
      {historyExam ? (
        <div className="cluster-history-backdrop" onClick={() => setHistoryExam(null)} role="presentation">
          <section aria-labelledby="cluster-resubmission-title" aria-modal="true" className="cluster-resubmission-modal" onClick={(event) => event.stopPropagation()} role="dialog">
            <header className="cluster-resubmission-header">
              <div>
                <span>Resubmission History</span>
                <h2 id="cluster-resubmission-title">{historyExam.examTitle}</h2>
              </div>
              <button aria-label="Close resubmission history" onClick={() => setHistoryExam(null)} type="button"><FiX /></button>
            </header>
            <div className="cluster-resubmission-summary">
              <span><b>Professor</b>{historyExam.professorName}</span>
              <span><b>Course</b>{historyExam.course}</span>
              <span><b>Latest status</b><StatusBadge status={historyExam.status} /></span>
            </div>
            <div className="cluster-resubmission-timeline">
              {historyEntries.map((entry) => (
                <article key={entry.id}>
                  <i>{entry.attempt}</i>
                  <div>
                    <div>
                      <strong>Attempt {entry.attempt}</strong>
                      <StatusBadge status={entry.decision} />
                    </div>
                    <time>{entry.date}</time>
                    <p>{entry.remarks}</p>
                  </div>
                </article>
              ))}
              {!historyEntries.length ? <p className="cluster-resubmission-empty">No resubmission or review history recorded yet.</p> : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
