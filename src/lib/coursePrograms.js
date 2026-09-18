export const YEAR_LEVEL_OPTIONS = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
export const SEMESTER_OPTIONS = ["1st Semester", "2nd Semester", "Summer"];

export function getProgramCode(course = {}) {
  return course.programs?.program_code || course.programCode || "";
}

export function getProgramName(course = {}) {
  return course.programs?.program_name || course.programName || "";
}

export function formatProgramOption(program) {
  if (!program) return "";
  return `${program.program_code}${program.program_name ? ` - ${program.program_name}` : ""}`;
}

export function formatProgramLabel(course = {}) {
  const code = getProgramCode(course);
  return code || "Program not assigned";
}

export function formatCourseMeta(course = {}) {
  return [
    formatProgramLabel(course),
    course.year_level || course.yearLevel,
    course.section ? `Section ${course.section}` : "",
  ].filter(Boolean).join(" • ");
}

export function formatCourseTerm(course = {}) {
  return [
    course.semester,
    course.academic_year || course.academicYear ? `A.Y. ${course.academic_year || course.academicYear}` : "",
  ].filter(Boolean).join(" • ");
}
