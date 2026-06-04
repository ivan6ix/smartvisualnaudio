import { Card, PageHeader, Table } from "../../components/ui";
import { professorCourses, professorExams, professorAlerts } from "../../data/professorData";

export default function ProfessorPlaceholder({ title }) {
  const rows = title === "Courses"
    ? professorCourses
    : title === "Monitoring Center"
      ? professorAlerts
      : professorExams;
  const columns = title === "Courses" ? [
    { key: "courseName", label: "Course" },
    { key: "courseCode", label: "Code" },
    { key: "section", label: "Section" },
    { key: "students", label: "Students" },
  ] : title === "Monitoring Center" ? [
    { key: "exam", label: "Exam" },
    { key: "student", label: "Student" },
    { key: "activity", label: "Suspicious Activity" },
    { key: "severity", label: "Severity" },
    { key: "time", label: "Time" },
  ] : [
    { key: "title", label: title === "Scores" ? "Assessment" : "Exam" },
    { key: "course", label: "Course" },
    { key: "section", label: "Section" },
    { key: "status", label: "Status" },
    { key: "attempts", label: title === "Scores" ? "Submitted Scores" : "Attempts" },
  ];

  return (
    <>
      <PageHeader title={title} subtitle={`Professor ${title.toLowerCase()} workspace.`} />
      <Card className="professor-page-card">
        <Table columns={columns} rows={rows} />
      </Card>
    </>
  );
}
