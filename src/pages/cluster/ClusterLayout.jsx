import NotificationBell from "../../components/NotificationBell";
import PortalNav from "../../components/PortalNav";
import { useState } from "react";
import { FiLogOut, FiMessageCircle, FiShield, FiUser } from "react-icons/fi";
import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import MessageModal from "../../components/MessageModal";
import ProfileAvatar from "../../components/ProfileAvatar";
import { PageSkeleton } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import useMessagePreview from "../../hooks/useMessagePreview";

export default function ClusterLayout() {
  const { user, logout, loading, hasLoggedInThisSession } = useAuth();
  const navigate = useNavigate();
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [messageTargetId, setMessageTargetId] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const { conversations, unreadCount } = useMessagePreview(user);

  function openMessages(conversationId = "") {
    setMessageTargetId(conversationId);
    setMessagesOpen(true);
  }

  if (loading) return <PageSkeleton />;
  if (!hasLoggedInThisSession || !user) return <Navigate to="/login" replace />;
  if (user.role !== "Cluster Professor") return <Navigate to="/" replace />;

  const links = [
    ["Dashboard", "/cluster"],
    ["Pending Exams", "/cluster/pending"],
    ["Approved Exams", "/cluster/approved"],
    ["Rejected Exams", "/cluster/rejected"],
    ["Review History", "/cluster/history"],
    ["Reports", "/cluster/reports"],
  ];

  return (
    <>
      <header className="cluster-topbar cluster-role-topbar">
        <button className="brand cluster-brand" onClick={() => navigate("/cluster")}>
          <strong>Smart Proctoring</strong>
          <span>Cluster Professor Portal</span>
        </button>
        <PortalNav>{links.map(([label, to]) => <NavLink key={to} end={to === "/cluster"} to={to}>{label}</NavLink>)}</PortalNav>
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
          <NotificationBell user={user} />
          <div className={`cluster-profile-menu ${profileOpen ? "open" : ""}`}>
            <button aria-label="Open profile menu" onClick={() => setProfileOpen((open) => !open)} title="Profile" type="button">
              <ProfileAvatar name={user?.fullName} src={user?.avatarUrl} />
            </button>
            <div>
              <button onClick={() => { navigate("/cluster/profile"); setProfileOpen(false); }} type="button"><FiUser /> Profile Settings</button>
              <button onClick={() => { navigate("/cluster/security"); setProfileOpen(false); }} type="button"><FiShield /> Security & Privacy</button>
              <button onClick={logout}><FiLogOut /> Logout</button>
            </div>
          </div>
        </div>
      </header>
      <main className="cluster-shell cluster-role-shell">
        <Outlet />
      </main>
      {messagesOpen ? <MessageModal initialConversationId={messageTargetId} onClose={() => setMessagesOpen(false)} /> : null}
    </>
  );
}
