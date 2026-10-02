import { useEffect, useMemo, useRef, useState } from "react";
import { FiActivity, FiAlertTriangle, FiCamera, FiShield } from "react-icons/fi";
import { toast } from "sonner";
import { ListPagination, ListViewToolbar, RecordCardList } from "../../components/ListViewControls";
import { Badge, Card, EmptyState, SearchBox, SelectField, Table } from "../../components/ui";
import useListViewPreference from "../../hooks/useListViewPreference";
import { getListPageSlice } from "../../lib/listView";
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
  const signingRef = useRef(false);

  if (!row.evidencePath || !row.evidenceBucket) return "-";

  async function loadEvidence() {
    if (signedUrl || loading || signingRef.current) return;
    const pendingWindow = row.evidenceKind === "audio" ? null : window.open("", "_blank");
    if (pendingWindow) pendingWindow.opener = null;
    signingRef.current = true;
    setLoading(true);
    setErrorMessage("");
    const { data, error } = await supabase.storage.from(row.evidenceBucket).createSignedUrl(row.evidencePath, 60 * 60);
    signingRef.current = false;
    setLoading(false);
    if (error) {
      pendingWindow?.close();
      setErrorMessage(error.message);
      toast.error(error.message);
      return;
    }
    const nextUrl = data?.signedUrl || "";
    if (!nextUrl) {
      pendingWindow?.close();
      setErrorMessage("Evidence URL could not be generated.");
      toast.error("Evidence URL could not be generated.");
      return;
    }
    setSignedUrl(nextUrl);
    if (pendingWindow) pendingWindow.location.href = nextUrl;
  }

  if (signedUrl && row.evidenceKind === "audio") {
    return <audio className="dean-integrity-audio" controls src={signedUrl}>Audio evidence</audio>;
  }

  if (signedUrl) {
    return <a className="dean-integrity-link" href={signedUrl} rel="noreferrer" target="_blank">View</a>;
  }

  return (
    <button className="dean-integrity-link" disabled={loading} onClick={loadEvidence} type="button">
      {loading ? "Loading..." : errorMessage ? "Retry" : row.evidenceKind === "audio" ? "Load audio" : "View"}
    </button>
  );
}

export default function DeanExamIntegrity() {
  const [violations, setViolations] = useState([]);
  const [loading, setLoading] = useState(Boolean(hasSupabaseConfig));
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [severity, setSeverity] = useState("All Severities");
  const [page, setPage] = useState(1);
  const listView = useListViewPreference({ role: "dean", page: "exam-integrity", defaultView: "table" });

  useEffect(() => {
    if (!hasSupabaseConfig) {
      setLoading(false);
      return undefined;
    }

    async function loadViolations() {
      setLoading(true);
      setLoadError("");
      const { data, error } = await supabase
        .from("violations")
        .select("id, student_id, exam_id, violation_type, description, severity, screenshot_url, evidence_url, evidence_type, audio_level, created_at")
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) {
        setLoadError(error.message);
        setLoading(false);
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
      setLoading(false);
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
    { key: "student", label: "Student", width: "18%", className: "dean-integrity-primary" },
    { key: "studentNumber", label: "Student ID", width: "10%" },
    { key: "exam", label: "Exam", width: "20%", className: "dean-integrity-primary" },
    { key: "violationType", label: "Violation", width: "18%", className: "dean-integrity-primary" },
    { key: "severity", label: "Severity", width: "10%", render: (row) => <Badge tone={severityTone(row.severity)}>{row.severity}</Badge> },
    { key: "date", label: "Date", width: "10%" },
    { key: "time", label: "Time", width: "8%" },
    {
      key: "snapshot",
      label: "Evidence",
      width: "10%",
      render: (row) => <EvidenceCell row={row} />,
    },
  ];
  const pageData = getListPageSlice(filteredViolations, page, listView.pageSize);

  return (
    <section className="dean-integrity-page">
      <header className="dean-dashboard-header dean-integrity-header">
        <h1>Exam Integrity</h1>
        <p>Review examination integrity records and recorded monitoring events.</p>
      </header>

      <div className="dean-kpi-grid dean-integrity-kpi-grid">
        {[
          ["Total Alerts", violations.length, FiActivity],
          ["High Severity", highCount, FiAlertTriangle],
          ["Exams With Alerts", examCount, FiShield],
          ["Evidence Records", snapshotCount, FiCamera],
        ].map(([label, value, Icon]) => (
          <Card className="dean-kpi-card" key={label}>
            <div>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
            <Icon aria-hidden="true" />
          </Card>
        ))}
      </div>

      <Card className="dean-dashboard-panel dean-integrity-controls">
        <div className="dean-integrity-search-row">
          <SearchBox value={search} onChange={setSearch} placeholder="Search student, exam, or violation" />
        </div>
        <div className="dean-integrity-filter-row">
          <SelectField label="Severity Filter" value={severity} onChange={(event) => setSeverity(event.target.value)}>
            <option>All Severities</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </SelectField>
          <SelectField label="Violation Type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option>All</option>
            {[...new Set(violations.map((item) => item.violationType))].filter(Boolean).map((type) => <option key={type}>{type}</option>)}
          </SelectField>
        </div>
      </Card>

      <Card className="dean-dashboard-panel dean-integrity-records-panel">
        <div className="dean-dashboard-section-header">
          <div>
            <h2>Integrity Records</h2>
            <p>Showing the latest capped monitoring records with evidence available on request.</p>
          </div>
          <span>{filteredViolations.length} records</span>
        </div>
        <ListViewToolbar
          controls={{
            cardDensity: listView.cardDensity,
            onCardDensity: listView.setCardDensity,
            onTableDensity: listView.setTableDensity,
            onView: (nextView) => setPage(listView.switchViewPreservingPage(nextView, pageData.page, filteredViolations.length)),
            tableDensity: listView.tableDensity,
            view: listView.view,
          }}
        />
        {loadError ? (
          <div className="dean-integrity-state dean-integrity-error" role="alert">
            <strong>Unable to load integrity records.</strong>
            <span>{loadError}</span>
          </div>
        ) : loading ? (
          <div className="dean-integrity-state" aria-busy="true">
            <strong>Loading integrity records...</strong>
            <span>Fetching the latest monitoring metadata.</span>
          </div>
        ) : (
          <div className="dean-integrity-table-scroll">
          {listView.view === "cards" ? (
            <RecordCardList
              columns={columns}
              density={listView.cardDensity}
              empty={<EmptyState title="No integrity records match the current filters." description="Adjust search or filters to review records." />}
              rows={pageData.rows}
              titleKey="student"
            />
          ) : (
            <Table
              className={`dean-integrity-table list-table-${listView.tableDensity}`}
              columns={columns}
              emptyDescription="Adjust search or filters to review records."
              emptyTitle="No integrity records match the current filters."
              rows={pageData.rows}
            />
          )}
          </div>
        )}
        {!loadError && !loading ? (
          <ListPagination count={filteredViolations.length} page={pageData.page} pageSize={listView.pageSize} onPage={setPage} />
        ) : null}
      </Card>
    </section>
  );
}
