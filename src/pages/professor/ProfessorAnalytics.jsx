import DeanAnalytics from "../dean/DeanAnalytics";

// The dean's Analytics page, limited by row-level security to the professor's own sections.
export default function ProfessorAnalytics() {
  return <DeanAnalytics scope="professor" />;
}
