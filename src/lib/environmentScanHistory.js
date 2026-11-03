// Saved environment-scan history: each checked scan step (room sweep or desk check) is stored with its result and
// photos, and professors review them per exam from Monitoring. The pure helpers below run in check scripts; the
// save function runs in the browser.

export const SCAN_HISTORY_BUCKET = "environment-scans";
export const SCAN_HISTORY_TABLE = "environment_scan_steps";
export const SCAN_PHOTO_MAX_WIDTH = 640;
export const SCAN_PHOTO_QUALITY = 0.8;
export const SCAN_PHOTO_LINK_SECONDS = 60 * 60;

export const SCAN_OUTCOME_LABELS = {
  clear: "Passed",
  risk_detected: "Blocked",
  rescan_required: "Retake",
  technical_error: "Technical error",
};
export const SCAN_STEP_LABELS = { sweep: "Room sweep", desk: "Desk check" };

// <student>/<exam>/<scan>/<step attempt>/<step>-01.jpg; the storage rules read the first two folders.
export function scanPhotoPath({ studentId, examId, scanId, stepId, step, index }) {
  return `${studentId}/${examId}/${scanId}/${stepId}/${step}-${String(index + 1).padStart(2, "0")}.jpg`;
}

// Only what the history screen shows is kept from each finding.
export function scanStepRow({ id, examId, studentId, scanId, step, outcome, findings = [], photoPaths = [] }) {
  return {
    id,
    exam_id: examId,
    student_id: studentId,
    scan_id: scanId,
    step,
    outcome,
    findings: findings.map((finding) => ({
      label: finding.label || "",
      reason: finding.reason || "",
      detected: Boolean(finding.detected),
      confidence: Number.isFinite(Number(finding.confidence)) ? Number(finding.confidence) : null,
      frameIndexes: Array.isArray(finding.frameIndexes) ? finding.frameIndexes : [],
    })),
    photo_paths: photoPaths,
  };
}

function time(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

// A scan passes once its latest room sweep and latest desk check are both clear; otherwise it shows the worst
// latest step result (Blocked, then Retake, then Technical error), or Incomplete when a step was never checked.
export function scanResult(steps) {
  const latest = {};
  for (const step of [...steps].sort((left, right) => time(left.created_at) - time(right.created_at))) latest[step.step] = step.outcome;
  if (latest.sweep === "clear" && latest.desk === "clear") return "Passed";
  const outcomes = Object.values(latest);
  if (outcomes.includes("risk_detected")) return "Blocked";
  if (outcomes.includes("rescan_required")) return "Retake";
  if (outcomes.includes("technical_error")) return "Technical error";
  return "Incomplete";
}

// One entry per exam (newest scan first), each with its scans in the order they happened.
export function groupScanHistory(rows) {
  const exams = new Map();
  for (const row of rows) {
    const exam = exams.get(row.exam_id) || { examId: row.exam_id, scans: new Map() };
    const scan = exam.scans.get(row.scan_id) || { scanId: row.scan_id, steps: [] };
    scan.steps.push(row);
    exam.scans.set(row.scan_id, scan);
    exams.set(row.exam_id, exam);
  }
  return [...exams.values()]
    .map((exam) => {
      const scans = [...exam.scans.values()]
        .map((scan) => {
          const steps = scan.steps.sort((left, right) => time(left.created_at) - time(right.created_at));
          return { scanId: scan.scanId, steps, startedAt: steps[0].created_at, result: scanResult(steps) };
        })
        .sort((left, right) => time(left.startedAt) - time(right.startedAt));
      const last = scans[scans.length - 1];
      return { examId: exam.examId, scans, count: scans.length, lastScanAt: last.steps[last.steps.length - 1].created_at, latestResult: last.result };
    })
    .sort((left, right) => time(right.lastScanAt) - time(left.lastScanAt));
}

// Photos where a finding was seen, so the history screen can outline them.
export function flaggedPhotoIndexes(step) {
  return new Set((step.findings || []).flatMap((finding) => finding.frameIndexes || []));
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A scan photo could not be read."));
    image.src = source;
  });
}

// Scan photos are stored at most 640px wide (the room sweep already is; desk photos are full camera size).
async function toStoredPhoto(dataUrl) {
  const image = await loadImage(dataUrl);
  const scale = Math.min(1, SCAN_PHOTO_MAX_WIDTH / (image.naturalWidth || SCAN_PHOTO_MAX_WIDTH));
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("A scan photo could not be saved."))), "image/jpeg", SCAN_PHOTO_QUALITY);
  });
}

// Uploads one checked step's photos, then records the step. A photo that fails to upload is recorded as "" so the
// others keep their position (findings point at photos by position); the caller never waits on this, so saving
// never holds up the student.
export async function saveScanStep({ supabase, examId, studentId, scanId, step, outcome, findings, frames }) {
  const stepId = window.crypto.randomUUID();
  const uploads = await Promise.all((frames || []).map(async (frame, index) => {
    if (!frame?.image) return null;
    const path = scanPhotoPath({ studentId, examId, scanId, stepId, step, index });
    try {
      const { error } = await supabase.storage.from(SCAN_HISTORY_BUCKET).upload(path, await toStoredPhoto(frame.image), { contentType: "image/jpeg", upsert: false });
      return error ? null : path;
    } catch {
      return null;
    }
  }));
  const row = scanStepRow({ id: stepId, examId, studentId, scanId, step, outcome, findings, photoPaths: uploads.map((path) => path || "") });
  const { error } = await supabase.from(SCAN_HISTORY_TABLE).insert(row);
  if (error) throw error;
  return row;
}
