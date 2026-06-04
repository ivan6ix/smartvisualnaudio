import { useEffect, useState } from "react";
import { FiBell, FiChevronDown, FiLogOut, FiMessageCircle, FiShield, FiUser } from "react-icons/fi";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import AccountSettingsModal from "../../components/AccountSettingsModal";
import MessageModal from "../../components/MessageModal";
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
    createdAt: notification.created_at,
  };
}

export default function StudentLayout() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [settingsModal, setSettingsModal] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const { conversations, unreadCount } = useMessagePreview(user);
  const unreadNotifications = notifications.filter((notification) => !notification.isRead).length;
  const isTakingExam = location.pathname.startsWith("/student/exams/");

  useEffect(() => {
    if (!hasSupabaseConfig || !user?.id) return undefined;

    async function loadNotifications() {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, message, type, is_read, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);

      if (!error) setNotifications((data || []).map(mapNotification));
    }

    loadNotifications();

    const channel = supabase
      .channel(`student-notifications-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, (payload) => {
        setNotifications((current) => [mapNotification(payload.new), ...current].slice(0, 20));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  if (loading) return <main className="center-screen">Loading...</main>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "Student") return <Navigate to="/" replace />;

  return (
    <>
      {!isTakingExam ? (
        <header className="cluster-topbar student-topbar">
          <button className="brand cluster-brand" onClick={() => navigate("/student")}>
            <strong>Smart Proctoring</strong>
            <span>Student Portal</span>
          </button>
          <nav>
            <NavLink end to="/student">Courses</NavLink>
            <NavLink to="/student/resources">Resources</NavLink>
            <NavLink to="/student/grades">Grades</NavLink>
          </nav>
          <div className="cluster-tools">
            <div className="message-menu cluster-message-menu">
              <button onClick={() => setMessagesOpen(true)} title="Messages" type="button">
                <FiMessageCircle />
                {unreadCount ? <span>{unreadCount}</span> : null}
              </button>
              <div className="message-menu-panel">
                <strong>Messages</strong>
                {conversations.length ? conversations.map((message) => (
                  <article key={message.id} onClick={() => setMessagesOpen(true)}>
                    <div>
                      <b>{message.name}</b>
                      <small>{message.role}</small>
                    </div>
                    <p>{message.lastMessage}</p>
                    {message.unread ? <span>{message.unread}</span> : null}
                  </article>
                )) : <p className="message-menu-empty">No live messages yet.</p>}
              </div>
            </div>
            <div className="notification-menu cluster-notification-menu">
              <button title="Notifications" type="button">
                <FiBell />
                {unreadNotifications ? <span>{unreadNotifications}</span> : null}
              </button>
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
              <button onClick={() => setProfileOpen((open) => !open)} title="Profile" type="button"><FiUser /><FiChevronDown /></button>
              <div>
                <button onClick={() => { setSettingsModal("profile"); setProfileOpen(false); }} type="button"><FiUser /> Profile Settings</button>
                <button onClick={() => { setSettingsModal("security"); setProfileOpen(false); }} type="button"><FiShield /> Security & Privacy</button>
                <button onClick={logout}><FiLogOut /> Logout</button>
              </div>
            </div>
          </div>
        </header>
      ) : null}
      <main className="student-shell">
        <Outlet />
      </main>
      {messagesOpen ? <MessageModal onClose={() => setMessagesOpen(false)} /> : null}
      {settingsModal ? <AccountSettingsModal mode={settingsModal} onClose={() => setSettingsModal(null)} /> : null}
    </>
  );
}
