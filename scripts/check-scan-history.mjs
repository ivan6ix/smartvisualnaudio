/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { classifyAngleDetections } from "../src/lib/environmentScan.js";
import { flaggedPhotoIndexes, groupScanHistory, scanPhotoPath, scanResult, scanStepRow } from "../src/lib/environmentScanHistory.js";

// Findings say which photos an item was seen in, so the history can outline them.
{
  const frames = [{ predictions: [] }, { predictions: [{ class: "cell phone", confidence: 0.9 }] }, { predictions: [{ class: "cell phone", confidence: 0.7 }] }];
  const result = classifyAngleDetections({ angleId: "sweep", frames });
  assert.deepEqual(result.findings[0].frameIndexes, [1, 2]);
}

// Photos are stored per student, exam, scan and step attempt; the storage rules read the first two folders.
assert.equal(scanPhotoPath({ studentId: "s1", examId: "e1", scanId: "scan", stepId: "step", step: "sweep", index: 0 }), "s1/e1/scan/step/sweep-01.jpg");
{
  const row = scanStepRow({ id: "r", examId: "e1", studentId: "s1", scanId: "scan", step: "desk", outcome: "risk_detected", photoPaths: ["a", "", "c"], findings: [{ label: "Phone detected", reason: "Phone detected (82%).", detected: true, confidence: 0.82, frameIndexes: [2], angle: "desk", severity: "risk" }] });
  assert.deepEqual(row.findings, [{ label: "Phone detected", reason: "Phone detected (82%).", detected: true, confidence: 0.82, frameIndexes: [2] }], "Only what the history shows is kept.");
  assert.deepEqual(row.photo_paths, ["a", "", "c"], "A failed upload keeps its place so findings still point at the right photo.");
  assert.deepEqual([...flaggedPhotoIndexes(row)], [2]);
}

// A scan passes when its latest sweep and desk check are both clear; otherwise the worst latest result shows.
const at = (minute) => `2026-11-04T10:${String(minute).padStart(2, "0")}:00Z`;
assert.equal(scanResult([{ step: "sweep", outcome: "risk_detected", created_at: at(1) }, { step: "sweep", outcome: "clear", created_at: at(2) }, { step: "desk", outcome: "clear", created_at: at(3) }]), "Passed", "A retaken step counts by its latest result.");
assert.equal(scanResult([{ step: "sweep", outcome: "clear", created_at: at(1) }, { step: "desk", outcome: "risk_detected", created_at: at(2) }]), "Blocked");
assert.equal(scanResult([{ step: "sweep", outcome: "rescan_required", created_at: at(1) }]), "Retake");
assert.equal(scanResult([{ step: "sweep", outcome: "clear", created_at: at(1) }]), "Incomplete", "A desk check that never ran is not a pass.");

// History: newest exam first, each exam's scans in the order they happened.
{
  const rows = [
    { id: "1", exam_id: "midterm", scan_id: "a", step: "sweep", outcome: "risk_detected", created_at: at(10) },
    { id: "2", exam_id: "midterm", scan_id: "b", step: "sweep", outcome: "clear", created_at: at(20) },
    { id: "3", exam_id: "midterm", scan_id: "b", step: "desk", outcome: "clear", created_at: at(21) },
    { id: "4", exam_id: "prelim", scan_id: "c", step: "sweep", outcome: "clear", created_at: at(5) },
  ];
  const history = groupScanHistory(rows);
  assert.deepEqual(history.map((item) => item.examId), ["midterm", "prelim"]);
  assert.equal(history[0].count, 2);
  assert.deepEqual(history[0].scans.map((scan) => scan.result), ["Blocked", "Passed"]);
  assert.equal(history[0].latestResult, "Passed");
  assert.equal(history[0].lastScanAt, at(21));
}

// Database: private photos; students add only their own for exams they may take; nobody edits or deletes.
const migration = readFileSync("supabase/migrations/20261104120000_environment_scan_history.sql", "utf8");
assert.match(migration, /create table if not exists public\.environment_scan_steps/);
assert.match(migration, /alter table public\.environment_scan_steps enable row level security;/);
assert.match(migration, /for insert to authenticated\s+with check \(student_id = \(select auth\.uid\(\)\) and public\.student_can_take_exam\(exam_id\)\);/);
assert.match(migration, /"environment_scan_steps_professor_read"[\s\S]*?using \(public\.professor_owns_exam\(exam_id\)\);/);
assert.match(migration, /grant select, insert on public\.environment_scan_steps to authenticated;/);
assert.doesNotMatch(migration, /for (update|delete|all)\b/i, "Saved scans cannot be edited or deleted from the app.");
assert.match(migration, /values \('environment-scans', 'environment-scans', false, 1048576, array\['image\/jpeg'\]\)/, "Photos are private, JPEG only, at most 1 MB.");
assert.match(migration, /"environment_scans_student_upload"[\s\S]*?\(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text[\s\S]*?public\.student_can_take_exam/);
assert.match(migration, /"environment_scans_professor_read"[\s\S]*?public\.professor_owns_exam/);

// Student page: every checked step is saved in the background, and the notice says photos are saved.
const exam = readFileSync("src/pages/student/StudentExamTake.jsx", "utf8");
assert.match(exam, /dispatchScan\(\{ type: "analysis_resolved"[^\n]*\n\s+saveScanHistory\(angleId, frames, result\);/);
assert.match(exam, /saveScanStep\(\{[\s\S]*?\}\)\.catch\(/, "A failed save never blocks the student.");
assert.doesNotMatch(exam, /not saved by the exam system/);
assert.match(exam, /The photos and results of each scan are saved, and only you, this exam&apos;s professor, and the school&apos;s Admin and Dean can view them\./);
assert.doesNotMatch(readFileSync("src/pages/Legal.jsx", "utf8"), /Environment-scan photos are not saved/);

// Professor page: the View Activities window switches to the scan history, which follows its filters.
const monitoring = readFileSync("src/pages/professor/ProfessorMonitoring.jsx", "utf8");
assert.match(monitoring, /Environment scan history/);
assert.match(monitoring, /<EnvironmentScanHistory exams=\{monitoringExams\} filters=\{activityFilters\} studentId=\{selectedStudent\.id\} \/>/);
const history = readFileSync("src/components/professor/EnvironmentScanHistory.jsx", "utf8");
assert.match(history, /createSignedUrls\(stored, SCAN_PHOTO_LINK_SECONDS\)/, "Photos open through short-lived private links.");
assert.match(history, /View environment scan/);
assert.match(history, /fetchAllRows\(/, "Every saved step is read, not the first 1000.");

console.log("Scan history checks passed.");
