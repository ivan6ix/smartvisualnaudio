import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

export default function useMessagePreview(user) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["message-preview", user?.id], [user?.id]);
  const previewQuery = useQuery({
    queryKey,
    enabled: hasSupabaseConfig && Boolean(user?.id),
    queryFn: async () => {
      const { data: messageRows, error: messagesError } = await supabase
        .from("messages")
        .select("id, sender_id, receiver_id, message, is_read, created_at")
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .order("created_at", { ascending: false })
        .limit(40);
      if (messagesError) throw messagesError;
      const otherIds = [...new Set((messageRows || []).map((message) => (
        message.sender_id === user.id ? message.receiver_id : message.sender_id
      )))];
      if (!otherIds.length) return { messages: messageRows || [], profiles: [] };
      const { data: profileRows, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name, role")
        .in("id", otherIds);
      if (profilesError) throw profilesError;
      return { messages: messageRows || [], profiles: profileRows || [] };
    },
  });
  const profiles = useMemo(() => previewQuery.data?.profiles || [], [previewQuery.data]);
  const messages = useMemo(() => previewQuery.data?.messages || [], [previewQuery.data]);

  useEffect(() => {
    if (!hasSupabaseConfig || !user?.id) return undefined;

    function handleMessagesRead(event) {
      const { senderId, receiverId } = event.detail || {};
      if (receiverId !== user.id) return;
      queryClient.setQueryData(queryKey, (current = { messages: [], profiles: [] }) => ({
        ...current,
        messages: current.messages.map((message) => message.sender_id === senderId && message.receiver_id === receiverId ? { ...message, is_read: true } : message),
      }));
    }

    window.addEventListener("smartvisualnaudio:messages-read", handleMessagesRead);

    const channel = supabase
      .channel(`message-preview-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const row = payload.new;
        if (row.sender_id !== user.id && row.receiver_id !== user.id) return;
        queryClient.setQueryData(queryKey, (current = { messages: [], profiles: [] }) => ({
          ...current,
          messages: current.messages.some((item) => item.id === row.id) ? current.messages : [row, ...current.messages].slice(0, 40),
        }));
        void queryClient.invalidateQueries({ queryKey });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => {
        const row = payload.new;
        if (row.sender_id !== user.id && row.receiver_id !== user.id) return;
        queryClient.setQueryData(queryKey, (current = { messages: [], profiles: [] }) => ({ ...current, messages: current.messages.map((item) => item.id === row.id ? row : item) }));
      })
      .subscribe();

    return () => {
      window.removeEventListener("smartvisualnaudio:messages-read", handleMessagesRead);
      supabase.removeChannel(channel);
    };
  }, [queryClient, queryKey, user?.id]);

  return useMemo(() => {
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const conversations = [];
    const seen = new Set();

    messages.forEach((message) => {
      const otherId = message.sender_id === user?.id ? message.receiver_id : message.sender_id;
      if (seen.has(otherId)) return;
      seen.add(otherId);
      const profile = profileById.get(otherId);
      conversations.push({
        id: otherId,
        name: profile?.full_name || "Unknown user",
        role: profile?.role || "User",
        lastMessage: message.message,
        unread: messages.filter((item) => item.sender_id === otherId && item.receiver_id === user?.id && !item.is_read).length,
      });
    });

    return {
      conversations,
      unreadCount: conversations.reduce((total, item) => total + item.unread, 0),
    };
  }, [messages, profiles, user?.id]);
}
