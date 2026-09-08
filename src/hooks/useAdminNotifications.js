import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["admin-notifications", user?.id], [user?.id]);
  const notificationsQuery = useQuery({
    queryKey,
    enabled: hasSupabaseConfig && Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, message, type, is_read, created_at")
        .eq("user_id", user.id)
        .eq("type", "Password Reset")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data || []).map(mapNotification);
    },
  });
  const notifications = notificationsQuery.data || [];
  const unreadCount = notifications.filter((notification) => !notification.isRead).length;

  useEffect(() => {
    if (!hasSupabaseConfig || !user?.id) return undefined;

    const channel = supabase
      .channel(`admin-password-reset-notifications-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, (payload) => {
        if (payload.new?.type !== "Password Reset") return;
        queryClient.setQueryData(queryKey, (current = []) => [mapNotification(payload.new), ...current]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, (payload) => {
        if (payload.new?.type !== "Password Reset") return;
        queryClient.setQueryData(queryKey, (current = []) => current.map((notification) => notification.id === payload.new.id ? mapNotification(payload.new) : notification));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, queryKey, user?.id]);

  useEffect(() => {
    if (notificationsQuery.error) toast.error(notificationsQuery.error.message);
  }, [notificationsQuery.error]);

  async function markAllRead() {
    if (!hasSupabaseConfig || !user?.id) {
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

    queryClient.setQueryData(queryKey, (current = []) => current.map((notification) => ({ ...notification, isRead: true })));
  }

  return { notifications, unreadCount, markAllRead };
}
