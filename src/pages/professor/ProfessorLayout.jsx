import NotificationPreview from "../../components/NotificationPreview";
import useAdminNotifications from "../../hooks/useAdminNotifications";
import PortalNav from "../../components/PortalNav";
import { useState } from "react";
import { FiBell, FiLogOut, FiMessageCircle, FiShield, FiUser } from "react-icons/fi";
import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import MessageModal from "../../components/MessageModal";
import ProfileAvatar from "../../components/ProfileAvatar";
import { PageSkeleton } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import useMessagePreview from "../../hooks/useMessagePreview";

export default function ProfessorLayout() {
  const { user, logout, loading, hasLoggedInThisSession } = useAuth();
  const navigate = useNavigate();
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [messageTargetId, setMessageTargetId] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const { conversations, unreadCount } = useMessagePreview(user);
  const { notifications, unreadCount: unreadNotifications, markAllRead } = useAdminNotifications(user);

  function openMessages(conversationId = "") {
    setMessageTargetId(conversationId);
    setMessagesOpen(true);
  }

  if (loading) return <PageSkeleton />;
  if (!hasLoggedInThisSession || !user) return <Navigate to="/login" replace />;
  if (user.role !== "Professor") return <Navigate to="/" replace />;

  const links = [
    ["Dashboard", "/professor"],
    ["Courses", "/professor/courses"],
    ["Exams", "/professor/exams"],
    ["Monitoring Center", "/professor/monitoring"],
    ["Scores", "/professor/scores"],
  ];

  return (
    <>
      <header className="cluster-topbar professor-topbar">
        <button className="brand cluster-brand" onClick={() => navigate("/professor")}>
          <strong>Smart Proctoring</strong>
          <span>Professor Portal</span>
        </button>
        <PortalNav>{links.map(([label, to]) => <NavLink key={to} end={to === "/professor"} to={to}>{label}</NavLink>)}</PortalNav>
        <div className="cluster-tools">
          <div className="message-menu cluster-message-menu">
            <button onClick={() => openMessages()} title="Messages" type="button"><FiMessageCircle />{unreadCount ? <span>{unreadCount}</span> : null}</button>
            <div className="message-menu-panel">
              <strong>Messages</strong>
              {conversations.length ? conversations.map((message) => (
                <article key={message.id} onClick={() => openMessages(message.id)}>
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
            <button title="Notifications" type="button"><FiBell />{unreadNotifications ? <span>{unreadNotifications}</span> : null}</button>
            <div className="notification-menu-panel">
              <strong>Notifications</strong><button type="button" onClick={markAllRead}>Mark All as Read</button>
              {notifications.map((notification) => (
                <article key={notification.id}>
                  <div>
                    <b>{notification.title}</b>
                    <small>{notification.type}</small>
                  </div>
                  <NotificationPreview>{notification.message}</NotificationPreview>
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
              <button onClick={() => { navigate("/professor/profile"); setProfileOpen(false); }} type="button"><FiUser /> Profile Settings</button>
              <button onClick={() => { navigate("/professor/security"); setProfileOpen(false); }} type="button"><FiShield /> Security & Privacy</button>
              <button onClick={logout}><FiLogOut /> Logout</button>
            </div>
          </div>
        </div>
      </header>
      <main className="cluster-shell professor-shell">
        <Outlet />
      </main>
      {messagesOpen ? <MessageModal initialConversationId={messageTargetId} onClose={() => setMessagesOpen(false)} /> : null}
    </>
  );
}
