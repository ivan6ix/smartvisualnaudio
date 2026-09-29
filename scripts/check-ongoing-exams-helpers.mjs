import assert from "node:assert/strict";
import {
  classifyOngoingStudent,
  getOngoingExamPhase,
  getNextOngoingTransitionDelay,
  paginateOngoingRows,
  sortOngoingRows,
  summarizeOngoingExams,
} from "../src/lib/ongoingExams.js";

const now = new Date("2026-09-28T10:00:00Z").getTime();

const baseStudent = { studentId: "student-a", name: "Ana Cruz", attempts: [], start: null, answeredCount: 0, questionCount: 4, violationCount: 0 };

assert.equal(getOngoingExamPhase({ id: "exam-active", status: "Published", exam_settings: { startsAt: "2026-09-28T09:00:00Z", deadline: "2026-09-28T11:00:00Z" } }, new Set(), now), "active");
assert.equal(getOngoingExamPhase({ id: "exam-upcoming", status: "Published", exam_settings: { startsAt: "2026-09-28T11:00:00Z", deadline: "2026-09-28T12:00:00Z" } }, new Set(), now), "upcoming");
assert.equal(getOngoingExamPhase({ id: "exam-finished", status: "Published", exam_settings: { startsAt: "2026-09-28T08:00:00Z", deadline: "2026-09-28T09:00:00Z" } }, new Set(), now), "finished");
assert.equal(getOngoingExamPhase({ id: "exam-draft", status: "Draft", exam_settings: { startsAt: "2026-09-28T09:00:00Z", deadline: "2026-09-28T11:00:00Z" } }, new Set(), now), "hidden");

assert.equal(classifyOngoingStudent(baseStudent).status, "Not Started");
assert.equal(classifyOngoingStudent({ ...baseStudent, start: { started_at: "2026-09-28T09:55:00Z", interruption_count: 0 } }).status, "In Progress");
assert.equal(classifyOngoingStudent({ ...baseStudent, start: { started_at: "2026-09-28T09:55:00Z", interruption_count: 4, interruption_limit: 3 } }).status, "Interrupted");
assert.equal(classifyOngoingStudent({ ...baseStudent, attempts: [{ attemptNumber: 1, status: "Submitted", submitted_at: "2026-09-28T09:58:00Z" }] }).status, "Submitted");
assert.equal(classifyOngoingStudent({ ...baseStudent, attempts: [{ attemptNumber: 1, status: "Submitted", submission_reason: "violation_limit" }] }).status, "Auto-Submitted");
assert.equal(classifyOngoingStudent({ ...baseStudent, attempts: [{ attemptNumber: 1, status: "Submitted" }], start: { started_at: "2026-09-28T09:59:00Z" } }).status, "In Progress");

const exams = [
  {
    id: "exam-a",
    phase: "active",
    students: [
      { studentId: "student-a", status: "Not Started", violationCount: 0 },
      { studentId: "student-b", status: "Interrupted", violationCount: 2 },
      { studentId: "student-c", status: "Submitted", violationCount: 3 },
      { studentId: "student-c", status: "Submitted", violationCount: 3 },
    ],
  },
];

assert.deepEqual(summarizeOngoingExams(exams), {
  activeExams: 1,
  assigned: 3,
  notStarted: 1,
  inProgress: 1,
  submitted: 1,
  violations: 2,
});

const rows = [
  { studentName: "Cara", status: "Submitted", attemptNumber: 2, answeredCount: 3, questionCount: 4, violationCount: 1 },
  { studentName: "Ana", status: "Not Started", attemptNumber: 0, answeredCount: 0, questionCount: 4, violationCount: 0 },
  { studentName: "Ben", status: "In Progress", attemptNumber: 1, answeredCount: 2, questionCount: 4, violationCount: 3 },
];

assert.deepEqual(sortOngoingRows(rows, "student", "asc").map((row) => row.studentName), ["Ana", "Ben", "Cara"]);
assert.deepEqual(sortOngoingRows(rows, "violations", "desc").map((row) => row.studentName), ["Ben", "Cara", "Ana"]);
assert.deepEqual(paginateOngoingRows(Array.from({ length: 21 }, (_, index) => ({ id: index })), 2, 20).map((row) => row.id), [20]);

assert.equal(getNextOngoingTransitionDelay([
  { startsAt: "2026-09-28T10:00:05Z", deadline: "2026-09-28T10:00:10Z" },
  { startsAt: "2026-09-28T11:00:00Z", deadline: "2026-09-28T12:00:00Z" },
], now), 5000);
