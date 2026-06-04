import { useEffect, useState } from "react";
import { toast } from "sonner";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

function mapNotification(notification) {
  return {
    id: notification.id,
    title: notification.title,
    message: notification.message,
    type: notification.type,
    isRead: notification.is_read,
    createdAt: notification.created_at,
  };
}

export default function useAdminNotifications(user) {
  const [notifications, setNotifications] = useState([]);
  const unreadCount = notifications.filter((notification) => !notification.isRead).length;

  useEffect(() => {
    if (!hasSupabaseConfig || !user?.id) return undefined;

    async function loadNotifications() {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, message, type, is_read, created_at")
        .eq("user_id", user.id)
        .eq("type", "Password Reset")
        .order("created_at", { ascending: false })
        .limit(30);

      if (error) {
        toast.error(error.message);
        return;
      }

      setNotifications((data || []).map(mapNotification));
    }

    loadNotifications();

    const channel = supabase
      .channel(`admin-password-reset-notifications-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, (payload) => {
        if (payload.new?.type !== "Password Reset") return;
        setNotifications((current) => [mapNotification(payload.new), ...current]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, (payload) => {
        if (payload.new?.type !== "Password Reset") return;
        setNotifications((current) => current.map((notification) => notification.id === payload.new.id ? mapNotification(payload.new) : notification));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  async function markAllRead() {
    if (!hasSupabaseConfig || !user?.id) {
      setNotifications((current) => current.map((notification) => ({ ...notification, isRead: true })));
      return;
    }

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", user.id)
      .eq("type", "Password Reset")
      .eq("is_read", false);

    if (error) {
      toast.error(error.message);
      return;
    }

    setNotifications((current) => current.map((notification) => ({ ...notification, isRead: true })));
  }

  return { notifications, unreadCount, markAllRead };
}
