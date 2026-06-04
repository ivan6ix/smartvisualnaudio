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

export default function DeanExamIntegrity() {
  const [violations, setViolations] = useState([]);
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("All Severities");

  useEffect(() => {
    if (!hasSupabaseConfig) return undefined;

    async function signedUrl(bucket, path) {
      if (!path) return null;
      const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);
      return data?.signedUrl || null;
    }

    async function loadViolations() {
      const { data, error } = await supabase
        .from("violations")
        .select("id, student_id, exam_id, violation_type, severity, screenshot_url, evidence_url, evidence_type, audio_level, created_at")
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

      const rows = await Promise.all((data || []).map(async (violation) => {
        const { date, time } = formatDateTime(violation.created_at);
        const profile = profilesById.get(violation.student_id);
        const exam = examsById.get(violation.exam_id);
        const evidencePath = violation.evidence_url || violation.screenshot_url;
        const isAudio = violation.evidence_type === "audio" || /\.(webm|mp3|wav|m4a|ogg)$/i.test(evidencePath || "");
        const screenshotUrl = isAudio ? null : await signedUrl("proctor-snapshots", evidencePath);
        const audioUrl = isAudio ? await signedUrl("audio-violations", evidencePath) : null;

        return {
          id: violation.id,
          student: profile?.full_name || profile?.email || "Unknown student",
          studentNumber: profile?.student_number || "-",
          exam: exam?.title || "Unknown exam",
          violationType: violationLabels[violation.violation_type] || violation.violation_type || "Monitoring alert",
          description: violation.audio_level ? `Audio level: ${violation.audio_level}%` : "-",
          severity: violation.severity || "Low",
          date,
          time,
          screenshotUrl,
          audioUrl,
        };
      }));

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
    return matchesSeverity && matchesSearch;
  }), [search, severity, violations]);

  const highCount = violations.filter((violation) => violation.severity === "High").length;
  const snapshotCount = violations.filter((violation) => violation.screenshotUrl || violation.audioUrl).length;
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
      render: (row) => {
        if (row.audioUrl) return <audio className="dean-integrity-audio" controls src={row.audioUrl}>Audio evidence</audio>;
        if (row.screenshotUrl) return <a className="dean-integrity-link" href={row.screenshotUrl} rel="noreferrer" target="_blank">View</a>;
        return "-";
      },
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
          </SelectField>
        </div>
        <Table columns={columns} rows={filteredViolations} />
      </Card>
    </>
  );
}
