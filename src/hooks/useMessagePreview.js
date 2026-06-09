import { useEffect, useMemo, useState } from "react";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

export default function useMessagePreview(user) {
  const [profiles, setProfiles] = useState([]);
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    if (!hasSupabaseConfig || !user?.id) {
      setProfiles([]);
      setMessages([]);
      return undefined;
    }

    let ignore = false;

    async function loadPreview() {
      const { data: messageRows, error: messagesError } = await supabase
        .from("messages")
        .select("id, sender_id, receiver_id, message, is_read, created_at")
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .order("created_at", { ascending: false })
        .limit(40);

      if (messagesError || ignore) return;

      const otherIds = [...new Set((messageRows || []).map((message) => (
        message.sender_id === user.id ? message.receiver_id : message.sender_id
      )))];

      let profileRows = [];
      if (otherIds.length) {
        const { data } = await supabase
          .from("profiles")
          .select("id, full_name, role")
          .in("id", otherIds);
        profileRows = data || [];
      }

      if (!ignore) {
        setMessages(messageRows || []);
        setProfiles(profileRows);
      }
    }

    loadPreview();

    function handleMessagesRead(event) {
      const { senderId, receiverId } = event.detail || {};
      if (receiverId !== user.id) return;
      setMessages((current) => current.map((message) => (
        message.sender_id === senderId && message.receiver_id === receiverId
          ? { ...message, is_read: true }
          : message
      )));
    }

    window.addEventListener("smartvisualnaudio:messages-read", handleMessagesRead);

    const channel = supabase
      .channel(`message-preview-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const row = payload.new;
        if (row.sender_id !== user.id && row.receiver_id !== user.id) return;
        setMessages((current) => current.some((item) => item.id === row.id) ? current : [row, ...current]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => {
        const row = payload.new;
        if (row.sender_id !== user.id && row.receiver_id !== user.id) return;
        setMessages((current) => current.map((item) => item.id === row.id ? row : item));
      })
      .subscribe();

    return () => {
      ignore = true;
      window.removeEventListener("smartvisualnaudio:messages-read", handleMessagesRead);
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

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
