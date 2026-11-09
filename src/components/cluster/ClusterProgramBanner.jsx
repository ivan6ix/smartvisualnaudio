import { useEffect, useState } from "react";
import { FiAlertTriangle, FiBookOpen } from "react-icons/fi";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

// Shows the program a Cluster Professor reviews, or a note that the Admin has not assigned one yet
// (until then no exams appear in their review lists).
export default function ClusterProgramBanner({ userId }) {
  const [state, setState] = useState({ loaded: false, program: null });

  useEffect(() => {
    if (!hasSupabaseConfig || !userId) return undefined;
    let cancelled = false;
    async function load() {
      const { data: row } = await supabase.from("cluster_professors").select("program_id").eq("id", userId).maybeSingle();
      let program = null;
      if (row?.program_id) {
        const { data } = await supabase.from("programs").select("program_code, program_name").eq("id", row.program_id).maybeSingle();
        program = data || null;
      }
      if (!cancelled) setState({ loaded: true, program });
    }
    void load();
    return () => { cancelled = true; };
  }, [userId]);

  if (!hasSupabaseConfig || !state.loaded) return null;
  if (!state.program) {
    return (
      <div className="cluster-program-banner is-missing" role="status">
        <FiAlertTriangle aria-hidden="true" />
        <span><strong>No program assigned yet.</strong> Ask the Admin to assign the program you review. Until then, no exams appear for review.</span>
      </div>
    );
  }
  return (
    <div className="cluster-program-banner" role="status">
      <FiBookOpen aria-hidden="true" />
      <span>Reviewing exams for <strong>{state.program.program_code}</strong> - {state.program.program_name}</span>
    </div>
  );
}
