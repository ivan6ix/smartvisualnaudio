import { useQuery } from "@tanstack/react-query";
import { FiActivity, FiBookOpen, FiFileText, FiUsers } from "react-icons/fi";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, PageHeader, StatCard } from "../../components/ui";
import { useChartTheme } from "../../context/ThemeContext";
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
  const chartTheme = useChartTheme();
  const dashboardQuery = useQuery({
    queryKey: ["dean-dashboard"],
    enabled: hasSupabaseConfig,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowIso = tomorrow.toISOString().slice(0, 10);

      const [students, courses, activeExams, violationsToday, violationsResponse] = await Promise.all([
          countRows(supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "Student")),
          countRows(supabase.from("courses").select("id", { count: "exact", head: true }).eq("archived", false)),
          countRows(supabase.from("exams").select("id", { count: "exact", head: true }).in("status", ["Active", "Published"])),
          countRows(supabase.from("violations").select("id", { count: "exact", head: true }).gte("created_at", today).lt("created_at", tomorrowIso)),
          supabase.from("violations").select("violation_type").limit(500),
      ]);
      if (violationsResponse.error) throw violationsResponse.error;
      const counts = (violationsResponse.data || []).reduce((items, row) => {
        items[row.violation_type] = (items[row.violation_type] || 0) + 1;
        return items;
      }, {});
      return {
        stats: { students, courses, activeExams, violationsToday },
        violationData: Object.entries(violationLabels).map(([key, name]) => ({ name, count: counts[key] || 0 })),
      };
    },
  });
  const stats = hasSupabaseConfig ? dashboardQuery.data?.stats || defaultStats : defaultStats;
  const violationData = hasSupabaseConfig ? dashboardQuery.data?.violationData || violationChart : violationChart;

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
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
              <XAxis axisLine={{ stroke: chartTheme.grid }} tickLine={{ stroke: chartTheme.grid }} dataKey="name" tick={{ fontSize: 11, fill: chartTheme.axis }} />
              <YAxis axisLine={{ stroke: chartTheme.grid }} tickLine={{ stroke: chartTheme.grid }} tick={{ fill: chartTheme.axis }} />
              <Tooltip cursor={{ fill: chartTheme.cursor }} contentStyle={{ background: chartTheme.tooltipBackground, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 14, color: chartTheme.tooltipText }} itemStyle={{ color: chartTheme.tooltipText }} labelStyle={{ color: chartTheme.tooltipText }} />
              <Bar dataKey="count" fill="#06b6d4" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </>
  );
}
