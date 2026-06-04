import { useMemo, useState } from "react";
import { Button, Card, Field, PageHeader, SelectField, Table } from "../../components/ui";
import { useCluster } from "../../context/ClusterContext";

export default function ClusterHistory() {
  const { reviews } = useCluster();
  const [decision, setDecision] = useState("All Decisions");
  const [professor, setProfessor] = useState("All Professors");
  const [course, setCourse] = useState("All Courses");
  const [date, setDate] = useState("");
  const professors = ["All Professors", ...new Set(reviews.map((item) => item.professorName))];
  const courses = ["All Courses", ...new Set(reviews.map((item) => item.course))];

  const rows = useMemo(() => reviews.filter((review) => {
    return (decision === "All Decisions" || review.decision === decision)
      && (professor === "All Professors" || review.professorName === professor)
      && (course === "All Courses" || review.course === course)
      && (!date || review.reviewDate === date);
  }), [reviews, decision, professor, course, date]);

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
        ]} rows={rows} renderActions={() => <Button variant="light">View</Button>} />
      </Card>
    </>
  );
}
