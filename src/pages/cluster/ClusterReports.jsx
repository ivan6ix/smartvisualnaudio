import { useMemo, useState } from "react";
import { FiFileText } from "react-icons/fi";
import { toast } from "sonner";
import { Button, Card, Field, PageHeader, SelectField, Table } from "../../components/ui";
import { useCluster } from "../../context/ClusterContext";

function pdfSafe(value) {
  return String(value ?? "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function truncate(value, length) {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function pdfText(x, y, size, text, bold = false) {
  return `BT /F${bold ? "2" : "1"} ${size} Tf ${x} ${y} Td (${pdfSafe(text)}) Tj ET`;
}

function makeReportPdf({ filters, reportType, rows }) {
  const pages = [];
  let content = [];
  let y = 742;

  function addPage() {
    if (content.length) pages.push(content.join("\n"));
    content = [
      pdfText(40, 760, 18, "Smart Proctoring System", true),
      pdfText(40, 738, 13, reportType, true),
      pdfText(40, 718, 9, `Generated: ${new Date().toLocaleString()}`),
      pdfText(40, 704, 9, `Course: ${filters.course}   Professor: ${filters.professor}   Status: ${filters.status}   Date: ${filters.date || "All Dates"}`),
      "0.82 0.82 0.82 RG 40 688 m 572 688 l S",
      pdfText(40, 672, 8, "Exam Title", true),
      pdfText(180, 672, 8, "Professor", true),
      pdfText(310, 672, 8, "Course", true),
      pdfText(430, 672, 8, "Status", true),
      pdfText(515, 672, 8, "Submitted", true),
      "0.82 0.82 0.82 RG 40 662 m 572 662 l S",
    ];
    y = 646;
  }

  addPage();
  if (!rows.length) {
    content.push(pdfText(238, y, 10, "No records found."));
  } else {
    rows.forEach((row) => {
      if (y < 58) addPage();
      content.push(pdfText(40, y, 8, truncate(row.examTitle, 28)));
      content.push(pdfText(180, y, 8, truncate(row.professorName, 24)));
      content.push(pdfText(310, y, 8, truncate(row.course, 23)));
      content.push(pdfText(430, y, 8, truncate(row.status, 16)));
      content.push(pdfText(515, y, 8, truncate(row.submittedAt, 12)));
      y -= 18;
    });
  }
  pages.push(content.join("\n"));

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${5 + (index * 2)} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];

  pages.forEach((page, index) => {
    const pageObjectNumber = 5 + (index * 2);
    const contentObjectNumber = pageObjectNumber + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`);
    objects.push(`<< /Length ${page.length} >>\nstream\n${page}\nendstream`);
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new window.Blob([pdf], { type: "application/pdf" });
}

function downloadBlob(blob, fileName) {
  const url = window.URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.URL.revokeObjectURL(url);
}

export default function ClusterReports() {
  const { exams, setReportsGenerated } = useCluster();
  const [reportType, setReportType] = useState("Exam Approval Report");
  const [date, setDate] = useState("");
  const [course, setCourse] = useState("All Courses");
  const [professor, setProfessor] = useState("All Professors");
  const [status, setStatus] = useState("All Statuses");
  const courses = useMemo(() => ["All Courses", ...new Set(exams.map((exam) => exam.course).filter(Boolean))], [exams]);
  const professors = useMemo(() => ["All Professors", ...new Set(exams.map((exam) => exam.professorName).filter(Boolean))], [exams]);
  const statuses = useMemo(() => ["All Statuses", ...new Set(exams.map((exam) => exam.status).filter(Boolean))], [exams]);
  const rows = useMemo(() => exams.filter((exam) => (
    (course === "All Courses" || exam.course === course)
    && (professor === "All Professors" || exam.professorName === professor)
    && (status === "All Statuses" || exam.status === status)
    && (!date || exam.submittedAt === date || exam.approvedAt === date || exam.rejectedAt === date)
  )), [course, date, exams, professor, status]);

  function exportReport() {
    const blob = makeReportPdf({
      filters: { course, date, professor, status },
      reportType,
      rows,
    });
    downloadBlob(blob, `${reportType.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "cluster-report"}.pdf`);
    setReportsGenerated((count) => count + 1);
    toast.success("Report PDF ready to download");
  }

  return (
    <>
      <PageHeader title="Reports" subtitle="Generate cluster review reports with date, course, professor, and status filters." />
      <div className="cluster-report-actions">
        <Button onClick={exportReport}><FiFileText /> Generate Report</Button>
      </div>
      <Card>
        <div className="cluster-filters">
          <SelectField label="Report Type" value={reportType} onChange={(event) => setReportType(event.target.value)}>
            <option>Exam Approval Report</option><option>Rejected Exam Report</option><option>Monthly Review Report</option><option>Professor Submission Report</option><option>Cluster Review Summary</option>
          </SelectField>
          <Field label="Date range" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <SelectField label="Course" value={course} onChange={(event) => setCourse(event.target.value)}>{courses.map((item) => <option key={item}>{item}</option>)}</SelectField>
          <SelectField label="Professor" value={professor} onChange={(event) => setProfessor(event.target.value)}>{professors.map((item) => <option key={item}>{item}</option>)}</SelectField>
          <SelectField label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>{statuses.map((item) => <option key={item}>{item}</option>)}</SelectField>
        </div>
      </Card>
      <Card>
        <h2>{reportType}</h2>
        <Table columns={[
          { key: "examTitle", label: "Exam Title" },
          { key: "professorName", label: "Professor Name" },
          { key: "course", label: "Course" },
          { key: "status", label: "Status" },
          { key: "submittedAt", label: "Submitted" },
        ]} rows={rows} />
      </Card>
    </>
  );
}
