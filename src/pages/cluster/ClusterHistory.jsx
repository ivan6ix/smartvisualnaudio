import { useEffect, useMemo, useState } from "react";
import { FiX } from "react-icons/fi";
import { Button, Card, Field, PageHeader, SelectField, Table } from "../../components/ui";
import { useCluster } from "../../context/ClusterContext";
import { StatusBadge } from "./helpers";

export default function ClusterHistory() {
  const { reviews } = useCluster();
  const [decision, setDecision] = useState("All Decisions");
  const [professor, setProfessor] = useState("All Professors");
  const [course, setCourse] = useState("All Courses");
  const [date, setDate] = useState("");
  const [selectedReview, setSelectedReview] = useState(null);
  const professors = ["All Professors", ...new Set(reviews.map((item) => item.professorName))];
  const courses = ["All Courses", ...new Set(reviews.map((item) => item.course))];

  const rows = useMemo(() => reviews.filter((review) => {
    return (decision === "All Decisions" || review.decision === decision)
      && (professor === "All Professors" || review.professorName === professor)
      && (course === "All Courses" || review.course === course)
      && (!date || review.reviewDate === date);
  }), [reviews, decision, professor, course, date]);

  useEffect(() => {
    if (!selectedReview) return undefined;

    function closeOnEscape(event) {
      if (event.key === "Escape") closeSelectedReview();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedReview]);

  function closeSelectedReview() {
    setSelectedReview(null);
  }

  return (
    <>
      <PageHeader title="Review History" subtitle="All exam review decisions, remarks, and supporting actions." />
      <div className="cluster-filters">
        <SelectField label="Decision" value={decision} onChange={(event) => setDecision(event.target.value)}><option>All Decisions</option><option>Approved</option><option>Rejected</option><option>Revision Needed</option></SelectField>
        <Field label="Date range" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        <SelectField label="Professor" value={professor} onChange={(event) => setProfessor(event.target.value)}>{professors.map((item) => <option key={item}>{item}</option>)}</SelectField>
        <SelectField label="Course" value={course} onChange={(event) => setCourse(event.target.value)}>{courses.map((item) => <option key={item}>{item}</option>)}</SelectField>
      </div>
      <Card>
        <Table columns={[
          { key: "id", label: "Review ID" },
          { key: "examTitle", label: "Exam Title" },
          { key: "professorName", label: "Professor Name" },
          { key: "course", label: "Course" },
          { key: "reviewDate", label: "Review Date" },
          { key: "decision", label: "Decision" },
          { key: "remarks", label: "Remarks" },
        ]} className="cluster-history-table" rows={rows} renderActions={(row) => <Button variant="light" onClick={() => setSelectedReview(row)}>View</Button>} />
      </Card>
      {selectedReview ? (
        <div className="cluster-history-backdrop" onClick={(event) => { if (event.target === event.currentTarget) closeSelectedReview(); }} role="presentation">
          <section aria-labelledby="cluster-history-review-title" aria-modal="true" className="cluster-resubmission-modal cluster-history-review-modal" onClick={(event) => event.stopPropagation()} role="dialog">
            <header className="cluster-resubmission-header">
              <div>
                <span>Review Details</span>
                <h2 id="cluster-history-review-title">{selectedReview.examTitle || "Historical review"}</h2>
              </div>
              <button aria-label="Close review details" onClick={closeSelectedReview} type="button"><FiX /></button>
            </header>
            <div className="cluster-resubmission-summary">
              <span><b>Review ID</b>{selectedReview.id || "Not recorded"}</span>
              <span><b>Professor</b>{selectedReview.professorName || "Not recorded"}</span>
              <span><b>Decision</b><StatusBadge status={selectedReview.decision || "Revision Needed"} /></span>
            </div>
            <div className="cluster-history-review-details">
              <span><b>Course</b>{selectedReview.course || "Not recorded"}</span>
              <span><b>Review Date</b>{selectedReview.reviewDate || "Not recorded"}</span>
              <span><b>Remarks</b>{selectedReview.remarks || "No remarks recorded."}</span>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
