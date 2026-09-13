import { useQuery } from "@tanstack/react-query";
import { Table } from "./ui";
import { useAuth } from "../context/AuthContext";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

function formatLogDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} · ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export default function PersonalActivityLogs() {
  const { user } = useAuth();
  const logsQuery = useQuery({
    queryKey: ["personal-activity-logs", user?.id],
    enabled: hasSupabaseConfig && Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logs")
        .select("id, action, description, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []).map((log) => ({
        id: log.id,
        action: log.action,
        description: log.description,
        createdAt: formatLogDate(log.created_at),
      }));
    },
  });

  if (!hasSupabaseConfig) {
    return <div className="empty-state">No activity logs yet.</div>;
  }

  if (logsQuery.isLoading) {
    return <div className="empty-state">Loading activity logs...</div>;
  }

  if (logsQuery.isError) {
    return <div className="empty-state">Unable to load activity logs.</div>;
  }

  return (
    <Table
      columns={[
        { key: "action", label: "Action" },
        { key: "description", label: "Description" },
        { key: "createdAt", label: "Date" },
      ]}
      emptyTitle="No activity logs yet."
      rows={logsQuery.data || []}
    />
  );
}
