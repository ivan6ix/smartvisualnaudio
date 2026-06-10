import { useEffect, useState } from "react";
import { FiBell, FiChevronDown, FiLogOut, FiMessageCircle, FiShield, FiUser } from "react-icons/fi";
import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import AccountSettingsModal from "../../components/AccountSettingsModal";
import MessageModal from "../../components/MessageModal";
import ProfileAvatar from "../../components/ProfileAvatar";
import { PageSkeleton } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import useMessagePreview from "../../hooks/useMessagePreview";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

function mapNotification(notification) {
  return {
    id: notification.id,
    title: notification.title,
    type: notification.type,
    message: notification.message,
    isRead: notification.is_read,
  };
}

export default function DeanLayout() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [messageTargetId, setMessageTargetId] = useState("");
  const [settingsModal, setSettingsModal] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const { conversations, unreadCount } = useMessagePreview(user);
  const unreadNotifications = notifications.filter((item) => !item.isRead).length;

  function openMessages(conversationId = "") {
    setMessageTargetId(conversationId);
    setMessagesOpen(true);
  }

  useEffect(() => {
    if (!hasSupabaseConfig || !user?.id) return undefined;

    async function loadNotifications() {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, message, type, is_read, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) {
        toast.error(error.message);
        return;
      }

      setNotifications((data || []).map(mapNotification));
    }

    loadNotifications();

    const channel = supabase
      .channel(`dean-notifications-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, (payload) => {
        setNotifications((current) => [mapNotification(payload.new), ...current]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  if (loading) return <PageSkeleton />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "Dean") return <Navigate to="/" replace />;

  const links = [
    ["Dashboard", "/dean"],
    ["Exam Integrity", "/dean/integrity"],
    ["Courses", "/dean/courses"],
    ["Reports", "/dean/reports"],
  ];

  return (
    <>
      <header className="cluster-topbar dean-topbar">
        <button className="brand cluster-brand" onClick={() => navigate("/dean")}>
          <strong>Smart Proctoring</strong>
          <span>Dean Portal</span>
        </button>
        <nav>{links.map(([label, to]) => <NavLink key={to} end={to === "/dean"} to={to}>{label}</NavLink>)}</nav>
        <div className="cluster-tools">
          <div className="message-menu cluster-message-menu">
            <button onClick={() => openMessages()} title="Messages" type="button"><FiMessageCircle />{unreadCount ? <span>{unreadCount}</span> : null}</button>
            <div className="message-menu-panel">
              <strong>Messages</strong>
              {conversations.length ? conversations.map((conversation) => (
                <article key={conversation.id} onClick={() => openMessages(conversation.id)}>
                  <div>
                    <b>{conversation.name}</b>
                    <small>{conversation.role}</small>
                  </div>
                  <p>{conversation.lastMessage}</p>
                  {conversation.unread ? <span>{conversation.unread}</span> : null}
                </article>
              )) : <p className="message-menu-empty">No live messages yet.</p>}
            </div>
          </div>
          <div className="notification-menu cluster-notification-menu">
            <button title="Notifications" type="button"><FiBell />{unreadNotifications ? <span>{unreadNotifications}</span> : null}</button>
            <div className="notification-menu-panel">
              <strong>Notifications</strong>
              {notifications.map((notification) => (
                <article key={notification.id}>
                  <div>
                    <b>{notification.title}</b>
                    <small>{notification.type}</small>
                  </div>
                  <p>{notification.message}</p>
                  {!notification.isRead ? <i aria-label="Unread notification" /> : null}
                </article>
              ))}
              {!notifications.length ? <p className="message-menu-empty">No live notifications yet.</p> : null}
            </div>
          </div>
          <div className={`cluster-profile-menu ${profileOpen ? "open" : ""}`}>
            <button aria-label="Open profile menu" onClick={() => setProfileOpen((open) => !open)} title="Profile" type="button">
              <ProfileAvatar name={user?.fullName} src={user?.avatarUrl} />
            </button>
            <div>
              <button onClick={() => { setSettingsModal("profile"); setProfileOpen(false); }} type="button"><FiUser /> Profile Settings</button>
              <button onClick={() => { setSettingsModal("security"); setProfileOpen(false); }} type="button"><FiShield /> Security & Privacy</button>
              <button onClick={logout}><FiLogOut /> Logout</button>
            </div>
          </div>
        </div>
      </header>
      <main className="cluster-shell dean-shell">
        <Outlet />
      </main>
      {messagesOpen ? <MessageModal initialConversationId={messageTargetId} onClose={() => setMessagesOpen(false)} /> : null}
      {settingsModal ? <AccountSettingsModal mode={settingsModal} onClose={() => setSettingsModal(null)} /> : null}
    </>
  );
}
