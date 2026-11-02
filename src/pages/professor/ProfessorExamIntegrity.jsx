import DeanExamIntegrity from "../dean/DeanExamIntegrity";

// The dean's Exam Integrity page with the Violation Analytics filters, limited by row-level security to the
// professor's own exams.
export default function ProfessorExamIntegrity() {
  return <DeanExamIntegrity scope="professor" />;
}
