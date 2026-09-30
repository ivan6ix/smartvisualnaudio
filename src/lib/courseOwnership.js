const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCanonicalProfessorId(value) {
  return uuidPattern.test(String(value || ""));
}

export function buildAssignedProfessorLabel(professor = {}) {
  const name = professor.name || professor.full_name || professor.email || "Unnamed professor";
  const details = [professor.employeeNumber || professor.employee_number, professor.email]
    .map((value) => String(value || "").trim())
    .filter((value) => value && value !== name);
  return [name, ...details].join(" - ");
}
