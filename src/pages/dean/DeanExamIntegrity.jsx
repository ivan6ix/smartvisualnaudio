import { useEffect, useMemo, useState } from "react";
import { FiActivity, FiAlertTriangle, FiCamera, FiShield } from "react-icons/fi";
import { toast } from "sonner";
import { Badge, Card, PageHeader, SearchBox, SelectField, StatCard, Table } from "../../components/ui";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

const violationLabels = {
  MULTIPLE_FACE: "Multiple face detected",
  NO_FACE: "No face detected",
  BACKGROUND_VOICE: "Background voice detected",
  LOUD_NOISE_DETECTED: "Background voice detected",
  AUDIO_DETECTED: "Background voice detected",
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

function EvidenceCell({ row }) {
  const [signedUrl, setSignedUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  if (!row.evidencePath || !row.evidenceBucket) return "-";

  async function loadEvidence() {
    if (signedUrl || loading) return;
    setLoading(true);
    setErrorMessage("");
    const { data, error } = await supabase.storage.from(row.evidenceBucket).createSignedUrl(row.evidencePath, 60 * 60);
    setLoading(false);
    if (error) {
      setErrorMessage(error.message);
      toast.error(error.message);
      return;
    }
    setSignedUrl(data?.signedUrl || "");
  }

  if (signedUrl && row.evidenceKind === "audio") {
    return <audio className="dean-integrity-audio" controls src={signedUrl}>Audio evidence</audio>;
  }

  if (signedUrl) {
    return <a className="dean-integrity-link" href={signedUrl} rel="noreferrer" target="_blank">View</a>;
  }

  return (
    <button className="dean-integrity-link" onClick={loadEvidence} type="button">
      {loading ? "Loading..." : errorMessage ? "Retry" : row.evidenceKind === "audio" ? "Load audio" : "View"}
    </button>
  );
}

export default function DeanExamIntegrity() {
  const [violations, setViolations] = useState([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [severity, setSeverity] = useState("All Severities");

  useEffect(() => {
    if (!hasSupabaseConfig) return undefined;

    async function loadViolations() {
      const { data, error } = await supabase
        .from("violations")
        .select("id, student_id, exam_id, violation_type, description, severity, screenshot_url, evidence_url, evidence_type, audio_level, created_at")
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) {
        toast.error(error.message);
        return;
      }

      const studentIds = [...new Set((data || []).map((row) => row.student_id).filter(Boolean))];
      const examIds = [...new Set((data || []).map((row) => row.exam_id).filter(Boolean))];

      const [profilesResponse, examsResponse] = await Promise.all([
        studentIds.length
          ? supabase.from("profiles").select("id, full_name, student_number, email").in("id", studentIds)
          : Promise.resolve({ data: [] }),
        examIds.length
          ? supabase.from("exams").select("id, title").in("id", examIds)
          : Promise.resolve({ data: [] }),
      ]);

      const profilesById = new Map((profilesResponse.data || []).map((profile) => [profile.id, profile]));
      const examsById = new Map((examsResponse.data || []).map((exam) => [exam.id, exam]));

      const rows = (data || []).map((violation) => {
        const { date, time } = formatDateTime(violation.created_at);
        const profile = profilesById.get(violation.student_id);
        const exam = examsById.get(violation.exam_id);
        const evidencePath = violation.evidence_url || violation.screenshot_url;
        const isAudio = violation.evidence_type === "audio" || /\.(webm|mp3|wav|m4a|ogg)$/i.test(evidencePath || "");

        return {
          id: violation.id,
          student: profile?.full_name || profile?.email || "Unknown student",
          studentNumber: profile?.student_number || "-",
          exam: exam?.title || "Unknown exam",
          violationType: violationLabels[violation.violation_type] || violation.violation_type || "Monitoring alert",
          description: violation.description || (violation.audio_level ? `Audio level: ${violation.audio_level}%` : "-"),
          severity: violation.severity || "Low",
          date,
          time,
          evidencePath,
          evidenceBucket: evidencePath ? (isAudio ? "audio-violations" : "proctor-snapshots") : "",
          evidenceKind: isAudio ? "audio" : "snapshot",
          hasEvidence: Boolean(evidencePath),
        };
      });

      setViolations(rows);
    }

    loadViolations();

    const channel = supabase
      .channel("dean-exam-integrity")
      .on("postgres_changes", { event: "*", schema: "public", table: "violations" }, () => {
        loadViolations();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filteredViolations = useMemo(() => violations.filter((violation) => {
    const matchesSeverity = severity === "All Severities" || violation.severity === severity;
    const matchesSearch = `${violation.student} ${violation.studentNumber} ${violation.exam} ${violation.violationType}`.toLowerCase().includes(search.toLowerCase());
    return matchesSeverity && matchesSearch && (typeFilter === "All" || violation.violationType === typeFilter);
  }), [search, severity, violations, typeFilter]);

  const highCount = violations.filter((violation) => violation.severity === "High").length;
  const snapshotCount = violations.filter((violation) => violation.hasEvidence).length;
  const examCount = new Set(violations.map((violation) => violation.exam)).size;

  const columns = [
    { key: "student", label: "Student" },
    { key: "studentNumber", label: "Student ID" },
    { key: "exam", label: "Exam" },
    { key: "violationType", label: "Violation" },
    { key: "severity", label: "Severity", render: (row) => <Badge tone={severityTone(row.severity)}>{row.severity}</Badge> },
    { key: "date", label: "Date" },
    { key: "time", label: "Time" },
    {
      key: "snapshot",
      label: "Evidence",
      render: (row) => <EvidenceCell row={row} />,
    },
  ];

  return (
    <>
      <PageHeader title="Exam Integrity" subtitle="Monitor live proctoring violations and review submitted alert evidence." />
      <div className="stats-grid dean-stats-grid">
        <StatCard label="Total Alerts" value={violations.length} icon={FiActivity} />
        <StatCard label="High Severity" value={highCount} icon={FiAlertTriangle} />
        <StatCard label="Exams With Alerts" value={examCount} icon={FiShield} />
        <StatCard label="Snapshots" value={snapshotCount} icon={FiCamera} />
      </div>
      <Card>
        <div className="toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Search student, exam, or violation" />
          <SelectField label="Severity Filter" value={severity} onChange={(event) => setSeverity(event.target.value)}>
            <option>All Severities</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </SelectField><SelectField label="Violation Type" value={typeFilter} onChange={event => setTypeFilter(event.target.value)}><option>All</option>{[...new Set(violations.map(item => item.violationType))].filter(Boolean).map(type => <option key={type}>{type}</option>)}</SelectField>
        </div>
        <div className="dean-integrity-table-scroll">
          <Table columns={columns} rows={filteredViolations} />
        </div>
      </Card>
    </>
  );
}
