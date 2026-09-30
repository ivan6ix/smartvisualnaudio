import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasSupabaseConfig, supabase } from "../lib/supabase";
import {
  NOTIFICATION_HISTORY_PAGE_SIZE,
  NOTIFICATION_RECENT_LIMIT,
  buildNotificationRange,
  isInternalNotificationPath,
  mergeRealtimeNotification,
  normalizeNotificationType,
  sortNotifications,
} from "../lib/notifications";

const NOTIFICATION_SELECT = "id, title, message, type, is_read, created_at, entity_type, entity_id, action_path";

function mapNotification(notification) {
  const actionPath = isInternalNotificationPath(notification.action_path) ? notification.action_path : null;
  return {
    id: notification.id,
    title: notification.title,
    message: notification.message,
    type: notification.type,
    typeLabel: normalizeNotificationType(notification.type),
    isRead: notification.is_read,
    createdAt: notification.created_at,
    entityType: notification.entity_type,
    entityId: notification.entity_id,
    actionPath,
  };
}

export default function useNotifications(user, { page = 1, includeHistory = false } = {}) {
  const queryClient = useQueryClient();
  const userId = user?.id;
  const recentKey = useMemo(() => ["notifications", "recent", userId], [userId]);
  const countKey = useMemo(() => ["notifications", "unread-count", userId], [userId]);
  const historyKey = useMemo(() => ["notifications", "history", userId, page], [userId, page]);

  const recentQuery = useQuery({
    queryKey: recentKey,
    enabled: hasSupabaseConfig && Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select(NOTIFICATION_SELECT)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(NOTIFICATION_RECENT_LIMIT);
      if (error) throw error;
      return (data || []).map(mapNotification);
    },
  });

  const countQuery = useQuery({
    queryKey: countKey,
    enabled: hasSupabaseConfig && Boolean(userId),
    queryFn: async () => {
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_read", false);
      if (error) throw error;
      return count || 0;
    },
  });

  const historyQuery = useQuery({
    queryKey: historyKey,
    enabled: hasSupabaseConfig && Boolean(userId) && includeHistory,
    queryFn: async () => {
      const { from, to } = buildNotificationRange(page);
      const { data, error, count } = await supabase
        .from("notifications")
        .select(NOTIFICATION_SELECT, { count: "exact" })
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) throw error;
      return { notifications: (data || []).map(mapNotification), total: count || 0 };
    },
    placeholderData: (previous) => previous,
  });

  const notifications = recentQuery.data || [];
  const unreadCount = countQuery.data ?? notifications.filter((notification) => !notification.isRead).length;
  const historyNotifications = historyQuery.data?.notifications || [];
  const historyTotal = historyQuery.data?.total || 0;
  const historyPageCount = Math.max(1, Math.ceil(historyTotal / NOTIFICATION_HISTORY_PAGE_SIZE));

  useEffect(() => {
    if (!hasSupabaseConfig || !userId) return undefined;

    const channel = supabase
      .channel(`notifications-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (payload) => {
        const next = mapNotification(payload.new);
        queryClient.setQueryData(recentKey, (current = []) => mergeRealtimeNotification(current, next));
        queryClient.invalidateQueries({ queryKey: countKey });
        queryClient.invalidateQueries({ queryKey: ["notifications", "history", userId] });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (payload) => {
        const next = mapNotification(payload.new);
        queryClient.setQueryData(recentKey, (current = []) => sortNotifications(current.map((notification) => notification.id === next.id ? next : notification)).slice(0, NOTIFICATION_RECENT_LIMIT));
        queryClient.invalidateQueries({ queryKey: countKey });
        queryClient.invalidateQueries({ queryKey: ["notifications", "history", userId] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [countKey, queryClient, recentKey, userId]);

  useEffect(() => {
    if (recentQuery.error) toast.error(recentQuery.error.message);
  }, [recentQuery.error]);

  useEffect(() => {
    if (historyQuery.error) toast.error(historyQuery.error.message);
  }, [historyQuery.error]);

  async function markNotificationRead(notificationId) {
    if (!hasSupabaseConfig || !userId || !notificationId) return false;

    const { error } = await supabase.rpc("mark_notification_read", { p_notification_id: notificationId });
    if (error) {
      toast.error(error.message);
      return false;
    }

    queryClient.setQueryData(recentKey, (current = []) => current.map((notification) => notification.id === notificationId ? { ...notification, isRead: true } : notification));
    queryClient.setQueriesData({ queryKey: ["notifications", "history", userId] }, (current) => current?.notifications
      ? { ...current, notifications: current.notifications.map((notification) => notification.id === notificationId ? { ...notification, isRead: true } : notification) }
      : current);
    queryClient.invalidateQueries({ queryKey: countKey });
    return true;
  }

  async function markAllRead() {
    if (!hasSupabaseConfig || !userId) return 0;

    const { data, error } = await supabase.rpc("mark_all_notifications_read");
    if (error) {
      toast.error(error.message);
      return 0;
    }

    queryClient.setQueryData(recentKey, (current = []) => current.map((notification) => ({ ...notification, isRead: true })));
    queryClient.setQueriesData({ queryKey: ["notifications", "history", userId] }, (current) => current?.notifications
      ? { ...current, notifications: current.notifications.map((notification) => ({ ...notification, isRead: true })) }
      : current);
    queryClient.setQueryData(countKey, 0);
    queryClient.invalidateQueries({ queryKey: countKey });
    return data || 0;
  }

  return {
    notifications,
    unreadCount,
    markNotificationRead,
    markAllRead,
    historyNotifications,
    historyTotal,
    historyPageCount,
    historyLoading: historyQuery.isLoading,
    recentLoading: recentQuery.isLoading,
  };
}
