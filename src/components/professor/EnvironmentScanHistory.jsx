import { useEffect, useMemo, useState } from "react";
import { FiArrowLeft, FiCamera } from "react-icons/fi";
import { Badge, Button } from "../ui";
import { fetchAllRows } from "../../lib/fetchAllRows";
import {
  SCAN_HISTORY_BUCKET,
  SCAN_HISTORY_TABLE,
  SCAN_OUTCOME_LABELS,
  SCAN_PHOTO_LINK_SECONDS,
  SCAN_STEP_LABELS,
  flaggedPhotoIndexes,
  groupScanHistory,
} from "../../lib/environmentScanHistory";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

const RESULT_TONES = { Passed: "success", Blocked: "danger", Retake: "warn", "Technical error": "warn", Incomplete: "neutral" };
const OUTCOME_TONES = { clear: "success", risk_detected: "danger", rescan_required: "warn", technical_error: "warn" };

function formatWhen(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function examLabel(exam) {
  const course = Array.isArray(exam?.courses) ? exam.courses[0] : exam?.courses;
  return {
    title: exam?.exam_title || exam?.title || "Unknown exam",
    course: course ? `${course.course_code} - ${course.section}` : exam?.course || "",
  };
}

// One checked step's photos, opened through short-lived private links. Photos where an item was found are outlined.
function StepPhotos({ step }) {
  const [links, setLinks] = useState(null);
  const paths = step.photo_paths || [];
  const pathsKey = paths.join("|");
  const flagged = flaggedPhotoIndexes(step);

  useEffect(() => {
    let active = true;
    const stored = pathsKey.split("|").filter(Boolean);
    if (!stored.length) {
      setLinks({});
      return undefined;
    }
    supabase.storage.from(SCAN_HISTORY_BUCKET).createSignedUrls(stored, SCAN_PHOTO_LINK_SECONDS).then(({ data, error }) => {
      if (!active) return;
      setLinks(error ? {} : Object.fromEntries((data || []).filter((item) => item.signedUrl).map((item) => [item.path, item.signedUrl])));
    });
    return () => {
      active = false;
    };
  }, [pathsKey]);

  if (!paths.length) return <p className="scan-history-note">No photos were saved for this step.</p>;
  return (
    <div className="scan-history-photos">
      {paths.map((path, index) => {
        const url = links?.[path];
        const label = `${SCAN_STEP_LABELS[step.step] || "Photo"} ${index + 1}`;
        return (
          <figure className={flagged.has(index) ? "is-flagged" : ""} key={`${step.id}-${index}`}>
            {url ? (
              <a href={url} rel="noreferrer" target="_blank" title="Open full size">
                <img alt={label} decoding="async" loading="lazy" src={url} />
              </a>
            ) : (
              <div className="scan-history-photo-placeholder">{links ? "Not available" : "Loading..."}</div>
            )}
            <figcaption>{flagged.has(index) ? `${index + 1} · item found` : index + 1}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}

// Monitoring > View Activities > Environment scan history: the student's exams with saved scans, then one exam's
// scans in order with every checked step and its photos.
export default function EnvironmentScanHistory({ studentId, exams, filters }) {
  const [state, setState] = useState({ loading: hasSupabaseConfig, error: "", rows: [] });
  const [openExamId, setOpenExamId] = useState("");
  const examById = useMemo(() => new Map(exams.map((exam) => [exam.id, exam])), [exams]);

  useEffect(() => {
    if (!hasSupabaseConfig || !studentId) return undefined;
    let active = true;
    setState({ loading: true, error: "", rows: [] });
    setOpenExamId("");
    // The database only returns scans of this professor's own exams.
    fetchAllRows((options) => supabase
      .from(SCAN_HISTORY_TABLE)
      .select("id, exam_id, scan_id, step, outcome, findings, photo_paths, created_at", options)
      .eq("student_id", studentId)
      .order("created_at")
      .order("id")).then(({ data, error }) => {
      if (active) setState({ loading: false, error: error?.message || "", rows: data || [] });
    });
    return () => {
      active = false;
    };
  }, [studentId]);

  const history = useMemo(() => groupScanHistory(state.rows).filter(({ examId }) => {
    const exam = examById.get(examId);
    if (!exam) return false;
    return (filters.course === "All Courses" || exam.course_id === filters.course)
      && (filters.period === "All Periods" || (exam.description || "No period") === filters.period)
      && (filters.exam === "All Exams" || exam.id === filters.exam);
  }), [examById, filters, state.rows]);
  const openExam = history.find((item) => item.examId === openExamId);

  if (state.loading) return <div className="professor-exams-empty">Loading environment scans...</div>;
  if (state.error) return <div className="professor-exams-empty">Unable to load environment scans. {state.error}</div>;

  if (openExam) {
    const { title, course } = examLabel(examById.get(openExam.examId));
    return (
      <div className="scan-history">
        <div className="scan-history-heading">
          <div>
            <strong>{title}</strong>
            <span>{course} · {openExam.count} scan{openExam.count === 1 ? "" : "s"}</span>
          </div>
          <Button variant="light" onClick={() => setOpenExamId("")}><FiArrowLeft /> Back to exams</Button>
        </div>
        {openExam.scans.map((scan, scanIndex) => (
          <section className="scan-history-scan" key={scan.scanId}>
            <h3>
              Scan {scanIndex + 1} · {formatWhen(scan.startedAt)}
              <Badge tone={RESULT_TONES[scan.result] || "neutral"}>{scan.result}</Badge>
            </h3>
            {scan.steps.map((step) => (
              <div className="scan-history-step" key={step.id}>
                <p>
                  <strong>{SCAN_STEP_LABELS[step.step] || step.step}</strong> · {formatWhen(step.created_at)}{" "}
                  <Badge tone={OUTCOME_TONES[step.outcome] || "neutral"}>{SCAN_OUTCOME_LABELS[step.outcome] || step.outcome}</Badge>
                </p>
                {(step.findings || []).length ? (
                  <ul>{step.findings.map((finding, index) => <li key={index}>{finding.reason || finding.label}</li>)}</ul>
                ) : null}
                <StepPhotos step={step} />
              </div>
            ))}
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="scan-history">
      {history.length ? (
        <div className="scan-history-exams">
          <div className="scan-history-row scan-history-row-head">
            <span>Exam</span><span>Scans</span><span>Last scan</span><span>Result</span><span />
          </div>
          {history.map((item) => {
            const { title, course } = examLabel(examById.get(item.examId));
            return (
              <div className="scan-history-row" key={item.examId}>
                <span><strong>{title}</strong><small>{course}</small></span>
                <span>{item.count}</span>
                <span>{formatWhen(item.lastScanAt)}</span>
                <span><Badge tone={RESULT_TONES[item.latestResult] || "neutral"}>{item.latestResult}</Badge></span>
                <span><Button variant="light" className="scan-history-view" onClick={() => setOpenExamId(item.examId)} title="View environment scan"><FiCamera /> View scan</Button></span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="professor-exams-empty">No environment scans saved for the selected filters. Scans are saved from now on, so earlier exams have none.</div>
      )}
    </div>
  );
}
