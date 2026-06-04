import { useEffect, useState } from "react";
import { FiActivity, FiBookOpen, FiFileText, FiUsers } from "react-icons/fi";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, PageHeader, StatCard } from "../../components/ui";
import { violationChart } from "../../data/mockData";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

const defaultStats = {
  students: 0,
  courses: 0,
  activeExams: 0,
  violationsToday: 0,
};

const violationLabels = {
  MULTIPLE_FACE: "Multiple Face",
  NO_FACE: "No Face",
  BACKGROUND_VOICE: "Background Voice",
  TAB_SWITCH: "Tab Switch",
  COPY_ATTEMPT: "Copy Attempt",
  FULLSCREEN_EXIT: "Fullscreen Exit",
  LOOKING_AWAY: "Looking Away",
  PHONE_DETECTED: "Cellphone Detected",
  GADGET_DETECTED: "Spare Gadget Detected",
};

async function countRows(query) {
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

export default function DeanDashboard() {
  const [stats, setStats] = useState(defaultStats);
  const [violationData, setViolationData] = useState(violationChart);

  useEffect(() => {
    if (!hasSupabaseConfig) return;

    async function loadDeanDashboard() {
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowIso = tomorrow.toISOString().slice(0, 10);

      try {
        const [students, courses, activeExams, violationsToday, violationsResponse] = await Promise.all([
          countRows(supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "Student")),
          countRows(supabase.from("courses").select("id", { count: "exact", head: true }).eq("archived", false)),
          countRows(supabase.from("exams").select("id", { count: "exact", head: true }).in("status", ["Active", "Published"])),
          countRows(supabase.from("violations").select("id", { count: "exact", head: true }).gte("created_at", today).lt("created_at", tomorrowIso)),
          supabase.from("violations").select("violation_type").limit(500),
        ]);

        setStats({ students, courses, activeExams, violationsToday });

        if (!violationsResponse.error) {
          const counts = (violationsResponse.data || []).reduce((items, row) => {
            items[row.violation_type] = (items[row.violation_type] || 0) + 1;
            return items;
          }, {});
          setViolationData(Object.entries(violationLabels).map(([key, name]) => ({ name, count: counts[key] || 0 })));
        }
      } catch {
        setStats(defaultStats);
      }
    }

    loadDeanDashboard();
  }, []);

  const cards = [
    ["Total Students", stats.students, FiUsers],
    ["Total Courses", stats.courses, FiBookOpen],
    ["Active Exams", stats.activeExams, FiFileText],
    ["Violations Today", stats.violationsToday, FiActivity],
  ];

  return (
    <>
      <PageHeader title="Dean Dashboard" subtitle="Monitor students, courses, exams, and proctoring violations." />
      <div className="stats-grid dean-stats-grid">
        {cards.map(([label, value, icon]) => <StatCard key={label} label={label} value={value} icon={icon} />)}
      </div>
      <Card>
        <h2>Violation Analytics</h2>
        <div className="chart-box">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={violationData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#111111" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </>
  );
}
