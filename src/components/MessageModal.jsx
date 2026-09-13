import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiEdit3, FiMinus, FiSend, FiX } from "react-icons/fi";
import { toast } from "sonner";
import ProfileAvatar from "./ProfileAvatar";
import { Button, Field, SearchBox } from "./ui";
import { useAuth } from "../context/AuthContext";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function mapProfile(profile) {
  return {
    id: profile.id,
    name: profile.full_name || profile.email || "Unknown user",
    role: profile.role || "User",
    email: profile.email || "",
    avatarUrl: profile.avatar_url || "",
  };
}

const fallbackUsers = [
  { id: "demo-admin", name: "Admin User", role: "Admin", email: "admin@university.edu" },
  { id: "demo-professor", name: "Dr. Maria Santos", role: "Professor", email: "professor@university.edu" },
  { id: "demo-cluster", name: "Prof. Nolan Lim", role: "Cluster Professor", email: "cluster@university.edu" },
  { id: "demo-student", name: "Ivan Caburnay", role: "Student", email: "student@university.edu" },
];

export default function MessageModal({ initialConversationId = "", onClose }) {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [panelSearch, setPanelSearch] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [findSearch, setFindSearch] = useState("");
  const [activeId, setActiveId] = useState(initialConversationId);
  const [panelVisible, setPanelVisible] = useState(!initialConversationId);
  const [minimized, setMinimized] = useState(false);
  const [draft, setDraft] = useState("");
  const historyRef = useRef(null);

  const profileById = useMemo(() => new Map(users.map((item) => [item.id, item])), [users]);
  const activeUser = activeId ? profileById.get(activeId) : null;

  useEffect(() => {
    if (initialConversationId) {
      setActiveId(initialConversationId);
      setPanelVisible(false);
      setMinimized(false);
    }
  }, [initialConversationId]);

  useEffect(() => {
    if (!user?.id) return;

    async function loadMessages() {
      if (!hasSupabaseConfig) {
        setUsers(fallbackUsers.filter((item) => item.id !== user.id && item.email !== user.email));
        return;
      }

      const [{ data: messageRows, error: messageError }, { data: profileRows, error: profileError }] = await Promise.all([
        supabase
          .from("messages")
          .select("id, sender_id, receiver_id, message, is_read, created_at")
          .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
          .order("created_at", { ascending: true })
          .limit(500),
        supabase
          .from("profiles")
          .select("id, full_name, email, role, avatar_url")
          .neq("id", user.id)
          .order("full_name", { ascending: true })
          .limit(500),
      ]);

      if (messageError) { toast.error(messageError.message); return; }
      if (profileError) { toast.error(profileError.message); return; }
      setMessages(messageRows || []);
      setUsers((profileRows || []).map(mapProfile));
    }

    loadMessages();
  }, [user?.email, user?.id]);

  useEffect(() => {
    if (!hasSupabaseConfig || !user?.id) return undefined;

    const channel = supabase
      .channel(`message-widget-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const row = payload.new;
        if (row.sender_id !== user.id && row.receiver_id !== user.id) return;
        setMessages((current) => current.some((item) => item.id === row.id) ? current : [...current, row]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => {
        const row = payload.new;
        if (row.sender_id !== user.id && row.receiver_id !== user.id) return;
        setMessages((current) => current.map((item) => item.id === row.id ? row : item));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const conversations = useMemo(() => {
    const byUser = new Map();
    messages.forEach((message) => {
      const otherId = message.sender_id === user?.id ? message.receiver_id : message.sender_id;
      const profile = profileById.get(otherId);
      if (!profile) return;
      const current = byUser.get(otherId);
      const unread = message.sender_id === otherId && message.receiver_id === user?.id && !message.is_read ? 1 : 0;
      byUser.set(otherId, {
        ...profile,
        lastMessage: message.message,
        lastAt: message.created_at,
        unread: (current?.unread || 0) + unread,
      });
    });
    return [...byUser.values()].sort((first, second) => new Date(second.lastAt) - new Date(first.lastAt));
  }, [messages, profileById, user?.id]);

  const filteredConversations = useMemo(() => {
    const query = panelSearch.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter((item) => `${item.name} ${item.role} ${item.email} ${item.lastMessage}`.toLowerCase().includes(query));
  }, [conversations, panelSearch]);

  const foundUsers = useMemo(() => {
    const query = findSearch.trim().toLowerCase();
    if (!query) return [];
    const conversationIds = new Set(conversations.map((item) => item.id));
    return users
      .filter((item) => !conversationIds.has(item.id))
      .filter((item) => `${item.name} ${item.role} ${item.email}`.toLowerCase().includes(query))
      .slice(0, 8);
  }, [conversations, findSearch, users]);

  const activeConversation = useMemo(() => {
    if (!activeUser || !user?.id) return [];
    return messages.filter((message) => (
      (message.sender_id === user.id && message.receiver_id === activeUser.id)
      || (message.sender_id === activeUser.id && message.receiver_id === user.id)
    )).sort((first, second) => new Date(first.created_at) - new Date(second.created_at));
  }, [activeUser, messages, user?.id]);

  const markConversationRead = useCallback((profileId) => {
    if (!user?.id) return;
    setMessages((current) => current.map((message) => (
      message.sender_id === profileId && message.receiver_id === user.id ? { ...message, is_read: true } : message
    )));
    window.dispatchEvent(new window.CustomEvent("smartvisualnaudio:messages-read", {
      detail: { senderId: profileId, receiverId: user.id },
    }));
    if (!hasSupabaseConfig) return;
    void supabase.from("messages").update({ is_read: true }).eq("sender_id", profileId).eq("receiver_id", user.id).eq("is_read", false);
  }, [user?.id]);

  useEffect(() => {
    if (!activeId) return;
    markConversationRead(activeId);
  }, [activeId, markConversationRead]);

  useEffect(() => {
    const node = historyRef.current;
    if (!node || minimized) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [activeConversation.length, activeId, minimized]);

  function openChat(profileId) {
    setActiveId(profileId);
    setPanelVisible(false);
    setMinimized(false);
    setPanelSearch("");
    setFindSearch("");
    setFindOpen(false);
  }

  async function submit(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !activeUser || !user?.id) return;
    if (text.length > 4000) { toast.error("Messages must be 4000 characters or fewer."); return; }

    if (!hasSupabaseConfig) {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        sender_id: user.id,
        receiver_id: activeUser.id,
        message: text,
        is_read: false,
        created_at: new Date().toISOString(),
      }]);
      setDraft("");
      return;
    }

    const { data, error } = await supabase
      .from("messages")
      .insert({ sender_id: user.id, receiver_id: activeUser.id, message: text })
      .select("id, sender_id, receiver_id, message, is_read, created_at")
      .single();

    if (error) { toast.error(error.message); return; }
    setMessages((current) => current.some((item) => item.id === data.id) ? current : [...current, data]);
    setDraft("");
  }

  return (
    <>
      {panelVisible ? <div className="message-panel-backdrop" onClick={() => activeId ? setPanelVisible(false) : onClose()} role="presentation">
        <section className="message-panel" onClick={(event) => event.stopPropagation()}>
          <header>
            <div>
              <h2>Messages</h2>
              <p>Recent conversations and user search.</p>
            </div>
            <button aria-label="Close messages" onClick={() => activeId ? setPanelVisible(false) : onClose()} type="button"><FiX /></button>
          </header>

          <SearchBox value={panelSearch} onChange={setPanelSearch} placeholder="Search conversations..." />
          <button className="message-find-toggle" onClick={() => setFindOpen((open) => !open)} type="button">
            <FiEdit3 /> Find User
          </button>

          {findOpen ? (
            <div className="message-find-panel">
              <SearchBox value={findSearch} onChange={setFindSearch} placeholder="Search users..." />
              <div className="message-user-results">
                {foundUsers.map((item) => (
                  <button key={item.id} onClick={() => openChat(item.id)} type="button">
                    <ProfileAvatar name={item.name} src={item.avatarUrl} />
                    <span><strong>{item.name}</strong><small>{item.role}</small></span>
                  </button>
                ))}
                {findSearch && !foundUsers.length ? <p>No users found.</p> : null}
              </div>
            </div>
          ) : null}

          <div className="message-panel-section-title">Recent Conversations</div>
          <div className="message-conversation-panel-list">
            {filteredConversations.map((item) => (
              <button key={item.id} onClick={() => openChat(item.id)} type="button">
                <ProfileAvatar name={item.name} src={item.avatarUrl} />
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.lastMessage}</small>
                </span>
                <em>{formatTime(item.lastAt)}</em>
                {item.unread ? <b>{item.unread}</b> : null}
              </button>
            ))}
            {!filteredConversations.length ? <div className="message-panel-empty">No conversations yet.</div> : null}
          </div>
        </section>
      </div> : null}

      {activeUser ? (
        <section className={`floating-chat-box ${minimized ? "minimized" : ""}`}>
          <header onClick={() => minimized && setMinimized(false)}>
            <ProfileAvatar name={activeUser.name} src={activeUser.avatarUrl} />
            <div>
              <strong>{activeUser.name}</strong>
              <span>{activeUser.role}</span>
            </div>
            <button aria-label="Minimize chat" onClick={(event) => { event.stopPropagation(); setMinimized(true); }} type="button"><FiMinus /></button>
            <button aria-label="Close chat" onClick={(event) => { event.stopPropagation(); setActiveId(""); onClose(); }} type="button"><FiX /></button>
          </header>
          {!minimized ? (
            <>
              <div className="floating-chat-history" ref={historyRef}>
                {activeConversation.map((message) => {
                  const isMine = message.sender_id === user?.id;
                  return (
                    <div className={`floating-chat-row ${isMine ? "mine" : ""}`} key={message.id}>
                      <p>{message.message}</p>
                      <time>{formatTime(message.created_at)}</time>
                    </div>
                  );
                })}
                {!activeConversation.length ? <div className="message-panel-empty">No messages yet.</div> : null}
              </div>
              <form className="floating-chat-reply" onSubmit={submit}>
                <Field
                  aria-label="Type a message"
                  maxLength={4000}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Type a message..."
                  value={draft}
                />
                <Button disabled={!draft.trim()}><FiSend /> Send</Button>
              </form>
            </>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
