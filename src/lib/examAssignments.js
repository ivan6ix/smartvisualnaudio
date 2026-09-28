export const ASSIGNMENT_MODES = {
  ENTIRE_COURSE: "entire_course",
  SELECTED_STUDENTS: "selected_students",
};

export function normalizeAssignmentMode(value) {
  return value === ASSIGNMENT_MODES.SELECTED_STUDENTS
    ? ASSIGNMENT_MODES.SELECTED_STUDENTS
    : ASSIGNMENT_MODES.ENTIRE_COURSE;
}

export function filterAssignmentStudents(students = [], search = "", section = "All Sections") {
  const term = String(search || "").trim().toLowerCase();
  return students.filter((student) => {
    const haystack = [
      student.name,
      student.studentName,
      student.studentNumber,
      student.email,
      student.section,
    ].filter(Boolean).join(" ").toLowerCase();
    const matchesSearch = !term || haystack.includes(term);
    const matchesSection = section === "All Sections" || student.section === section;
    return matchesSearch && matchesSection;
  });
}

export function getSelectableFilteredStudentIds(students = []) {
  return students.filter((student) => !student.locked).map((student) => student.id);
}

export function toggleFilteredStudentSelection({ selectedIds, filteredStudents, checked }) {
  const next = new Set(selectedIds);
  getSelectableFilteredStudentIds(filteredStudents).forEach((id) => {
    if (checked) next.add(id);
    else next.delete(id);
  });
  return next;
}
