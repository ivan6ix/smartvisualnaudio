export async function writeAccountAuditLog({ supabase, user, eventType, action, description, metadata = {} }) {
  if (!supabase || !user?.id) return;
  const { error } = await supabase.rpc("write_self_account_audit_log", {
    p_event_type: eventType,
    p_action: action,
    p_description: description,
    p_metadata: metadata,
  });
  if (error && import.meta.env.DEV) window.console.warn("Audit log write failed", error);
}
