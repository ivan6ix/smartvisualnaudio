import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

export default function useNotificationPreference() {
 const { user } = useAuth();
 const key = 'smartvisualnaudio.notification-preview.' + (user?.id || 'guest');
 const read = useCallback(() => { try { return window.localStorage.getItem(key) !== 'hidden'; } catch { return true; } }, [key]);
 const [showPreview, setShowPreview] = useState(read);
 const [loading, setLoading] = useState(false);
 const [saving, setSaving] = useState(false);

 useEffect(() => {
  const sync = () => setShowPreview(read());
  window.addEventListener('notification-preference', sync);
  window.addEventListener('storage', sync);
  return () => { window.removeEventListener('notification-preference', sync); window.removeEventListener('storage', sync); };
 }, [read]);

 useEffect(() => {
  if (!hasSupabaseConfig || !user?.id) return;
  let active = true;
  async function loadPreference() {
   setLoading(true);
   const { data, error } = await supabase
    .from("notification_preferences")
    .select("show_message_previews")
    .eq("user_id", user.id)
    .maybeSingle();
   if (!active) return;
   if (error) {
    setLoading(false);
    toast.error(error.message);
    return;
   }
   if (data) {
    setShowPreview(data.show_message_previews);
    try { window.localStorage.setItem(key, data.show_message_previews ? 'shown' : 'hidden'); } catch { /* ignore storage */ }
    setLoading(false);
    return;
   }
   const localValue = read();
   setShowPreview(localValue);
   const upsert = await supabase
    .from("notification_preferences")
    .upsert({ user_id: user.id, show_message_previews: localValue }, { onConflict: "user_id" });
   if (active && upsert.error) toast.error(upsert.error.message);
   if (active) setLoading(false);
  }
  loadPreference();
  return () => { active = false; };
 }, [key, read, user?.id]);

 async function change(value) {
  setShowPreview(value);
  try { window.localStorage.setItem(key, value ? 'shown' : 'hidden'); } catch { return; }
  window.dispatchEvent(new window.Event('notification-preference'));
  if (!hasSupabaseConfig || !user?.id) return;
  setSaving(true);
  const { error } = await supabase
   .from("notification_preferences")
   .upsert({ user_id: user.id, show_message_previews: value }, { onConflict: "user_id" });
  if (error) toast.error(error.message);
  setSaving(false);
 }
 return [showPreview, change, { loading, saving }];
}
