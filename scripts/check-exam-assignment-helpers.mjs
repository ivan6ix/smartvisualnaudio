import assert from "node:assert/strict";
import {
  filterAssignmentStudents,
  getSelectableFilteredStudentIds,
  toggleFilteredStudentSelection,
} from "../src/lib/examAssignments.js";

const students = [
  { id: "a", name: "Ana Cruz", studentNumber: "S-001", email: "ana@example.com", section: "A" },
  { id: "b", name: "Ben Diaz", studentNumber: "S-002", email: "ben@example.com", section: "B" },
  { id: "c", name: "Cara Lim", studentNumber: "S-003", email: "cara@example.com", section: "A", locked: true },
];

assert.deepEqual(filterAssignmentStudents(students, "ana", "All Sections").map((student) => student.id), ["a"]);
assert.deepEqual(filterAssignmentStudents(students, "s-003", "A").map((student) => student.id), ["c"]);
assert.deepEqual(getSelectableFilteredStudentIds(students), ["a", "b"]);

const selected = new Set(["b", "c"]);
const selectedAfterSelectAll = toggleFilteredStudentSelection({
  selectedIds: selected,
  filteredStudents: filterAssignmentStudents(students, "", "A"),
  checked: true,
});
assert.deepEqual([...selectedAfterSelectAll].sort(), ["a", "b", "c"]);

const selectedAfterClearFiltered = toggleFilteredStudentSelection({
  selectedIds: selectedAfterSelectAll,
  filteredStudents: filterAssignmentStudents(students, "", "A"),
  checked: false,
});
assert.deepEqual([...selectedAfterClearFiltered].sort(), ["b", "c"]);
