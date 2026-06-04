import { useEffect, useMemo, useState } from "react";
import { FiSearch, FiSend } from "react-icons/fi";
import { toast } from "sonner";
import { Button, Card, Field, PageHeader, SearchBox } from "./ui";
import { useAuth } from "../context/AuthContext";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

function formatTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatMessageDate(value) {
  if (!value) return "";
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
}

function isSameMessageDay(first, second) {
  if (!first || !second) return false;
  return new Date(first).toDateString() === new Date(second).toDateString();
}

function mapProfile(profile) {
  return {
    id: profile.id,
    name: profile.full_name,
    role: profile.role,
    email: profile.email,
  };
}

const fallbackUsers = [
  { id: "demo-admin", name: "Admin User", role: "Admin", email: "admin@university.edu" },
  { id: "demo-professor", name: "Dr. Maria Santos", role: "Professor", email: "professor@university.edu" },
  { id: "demo-cluster", name: "Prof. Nolan Lim", role: "Cluster Professor", email: "cluster@university.edu" },
  { id: "demo-student", name: "Ivan Caburnay", role: "Student", email: "student@university.edu" },
];

export default function LiveMessages({ composeOpen = false, onComposeClose, subtitle = "Send and receive messages across system users." }) {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [recipientLookup, setRecipientLookup] = useState("");
  const [revealedMessageId, setRevealedMessageId] = useState("");
  const selectedUser = users.find((item) => item.id === selectedId);

  useEffect(() => {
    if (!user?.id) return;

    async function loadMessages() {
      if (!hasSupabaseConfig) {
        const demoUsers = fallbackUsers.filter((item) => item.id !== user.id && item.email !== user.email);
        setUsers(demoUsers);
        return;
      }

      const [{ data: profileRows, error: profileError }, { data: messageRows, error: messageError }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, email, role")
          .neq("id", user.id)
          .order("full_name", { ascending: true }),
        supabase
          .from("messages")
          .select("id, sender_id, receiver_id, message, is_read, created_at")
          .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
          .order("created_at", { ascending: true }),
      ]);

      if (profileError) {
        toast.error(profileError.message);
        return;
      }
      if (messageError) {
        toast.error(messageError.message);
        return;
      }

      const mappedUsers = (profileRows || []).map(mapProfile);
      const participantIds = new Set((messageRows || []).flatMap((message) => [message.sender_id, message.receiver_id]).filter((id) => id !== user.id));
      setUsers(mappedUsers);
      setMessages(messageRows || []);
      setSelectedId((current) => current || [...participantIds][0] || "");
    }

    loadMessages();
  }, [user?.email, user?.id]);

  useEffect(() => {
    if (!hasSupabaseConfig || !user?.id) return undefined;

    const channel = supabase
      .channel(`messages-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const row = payload.new;
        if (row.sender_id !== user.id && row.receiver_id !== user.id) return;
        setMessages((current) => current.some((item) => item.id === row.id) ? current : [...current, row]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const conversationUsers = useMemo(() => {
    const participantIds = new Set(messages.flatMap((message) => [message.sender_id, message.receiver_id]).filter((id) => id !== user?.id));
    return users.filter((item) => participantIds.has(item.id) || item.id === selectedId);
  }, [messages, selectedId, user?.id, users]);

  const filteredUsers = useMemo(() => conversationUsers.filter((item) => {
    const haystack = `${item.name} ${item.role} ${item.email}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  }), [conversationUsers, search]);

  const conversation = useMemo(() => {
    if (!selectedUser || !user?.id) return [];
    return messages.filter((message) => (
      (message.sender_id === user.id && message.receiver_id === selectedUser.id)
      || (message.sender_id === selectedUser.id && message.receiver_id === user.id)
    ));
  }, [messages, selectedUser, user?.id]);

  function getLastMessage(profile) {
    const last = [...messages].reverse().find((message) => (
      message.sender_id === profile.id || message.receiver_id === profile.id
    ));
    return last?.message || "No messages yet.";
  }

  function getUnreadCount(profile) {
    return messages.filter((message) => message.sender_id === profile.id && message.receiver_id === user?.id && !message.is_read).length;
  }

  async function submit(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !selectedUser || !user?.id) return;

    if (!hasSupabaseConfig) {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        sender_id: user.id,
        receiver_id: selectedUser.id,
        message: text,
        is_read: false,
        created_at: new Date().toISOString(),
      }]);
      setDraft("");
      return;
    }

    const { data, error } = await supabase
      .from("messages")
      .insert({ sender_id: user.id, receiver_id: selectedUser.id, message: text })
      .select("id, sender_id, receiver_id, message, is_read, created_at")
      .single();

    if (error) {
      toast.error(error.message);
      return;
    }

    setMessages((current) => [...current, data]);
    setDraft("");
  }

  function findRecipient(event) {
    event.preventDefault();
    const query = recipientLookup.trim().toLowerCase();
    if (!query) return;

    const match = users.find((item) => item.email.toLowerCase() === query || item.name.toLowerCase() === query);
    if (!match) {
      toast.error("User not found. Enter the exact email or full name.");
      return;
    }

    setSelectedId(match.id);
    setSearch("");
    setRecipientLookup("");
    onComposeClose?.();
  }

  return (
    <>
      <PageHeader title="Messages" subtitle={subtitle} />
      {composeOpen ? (
        <Card className="new-message-panel">
          <form onSubmit={findRecipient}>
            <Field
              label="Recipient email or full name"
              onChange={(event) => setRecipientLookup(event.target.value)}
              placeholder="example@university.edu"
              value={recipientLookup}
            />
            <Button><FiSearch /> Find User</Button>
          </form>
        </Card>
      ) : null}
      <div className="messages-layout">
        <Card>
          <SearchBox value={search} onChange={setSearch} placeholder="Search conversations" />
          <div className="conversation-list">
            {filteredUsers.map((item) => {
              const unread = getUnreadCount(item);
              return (
                <button key={item.id} className={item.id === selectedUser?.id ? "active" : ""} onClick={() => setSelectedId(item.id)} type="button">
                  <strong>{item.name}</strong>
                  <small>{item.role}</small>
                  <span>{getLastMessage(item)}</span>
                  {unread ? <b>{unread} unread</b> : null}
                </button>
              );
            })}
            {!filteredUsers.length ? <div className="empty-state">No conversations yet. Use New Message if you know the user&apos;s email or full name.</div> : null}
          </div>
        </Card>
        <Card className="chat-card">
          <PageHeader title={selectedUser?.name || "Select a user"} subtitle={selectedUser?.role || "Choose a conversation"} />
          <div className="message-history">
            {conversation.map((message, index) => {
              const isMine = message.sender_id === user?.id;
              const nextMessage = conversation[index + 1];
              const shouldShowDate = nextMessage && !isSameMessageDay(message.created_at, nextMessage.created_at);
              return (
                <div className="message-entry" key={message.id}>
                  <div
                    className={`message-row ${isMine ? "mine" : ""} ${revealedMessageId === message.id ? "reveal" : ""}`}
                    onPointerCancel={() => setRevealedMessageId("")}
                    onPointerDown={() => setRevealedMessageId(message.id)}
                    onPointerLeave={() => setRevealedMessageId("")}
                    onPointerUp={() => setRevealedMessageId("")}
                  >
                    <div className={isMine ? "bubble mine" : "bubble"}>
                      <p>{message.message}</p>
                    </div>
                    <time>{formatTime(message.created_at)}</time>
                  </div>
                  {shouldShowDate ? <div className="message-date-separator">{formatMessageDate(nextMessage.created_at)}</div> : null}
                </div>
              );
            })}
            {!conversation.length ? <div className="empty-state">No messages yet.</div> : null}
          </div>
          <form className="reply-box" onSubmit={submit}>
            <Field disabled={!selectedUser} label="Message" value={draft} onChange={(event) => setDraft(event.target.value)} />
            <Button disabled={!selectedUser || !draft.trim()}><FiSend /> Send</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
