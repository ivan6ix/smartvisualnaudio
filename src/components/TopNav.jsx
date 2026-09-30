import NotificationBell from "./NotificationBell";
import PortalNav from "./PortalNav";
import { useState } from "react";
import { FiLogOut, FiMessageCircle, FiShield, FiUserCheck } from "react-icons/fi";
import { NavLink, useNavigate } from "react-router-dom";
import ProfileAvatar from "./ProfileAvatar";
import { useAuth } from "../context/AuthContext";
import useMessagePreview from "../hooks/useMessagePreview";
import MessageModal from "./MessageModal";

export default function TopNav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [messageTargetId, setMessageTargetId] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const { conversations, unreadCount } = useMessagePreview(user);
  const links = [
    ["Dashboard", "/"],
    ["Create Account", "/create-account"],
    ["Courses", "/courses"],
    ["Accounts", "/accounts"],
    ["Reports", "/reports"],
    ["Logs", "/admin/logs"],
  ];

  function openMessages(conversationId = "") {
    setMessageTargetId(conversationId);
    setMessagesOpen(true);
  }

  return (
    <>
      <header className="top-nav">
        <button className="brand" onClick={() => navigate("/")}>
          <strong>Smart Proctoring</strong>
          <span>{user?.role || "Admin"} Portal</span>
        </button>
        <PortalNav>
          {links.map(([label, to]) => <NavLink key={to} to={to}>{label}</NavLink>)}
        </PortalNav>
        <div className="nav-tools">
          <div className="message-menu">
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
          <NotificationBell user={user} emptyText="No password reset requests yet." />
          <div className={`profile-menu ${profileOpen ? "open" : ""}`}>
            <button aria-label="Open profile menu" onClick={() => setProfileOpen((open) => !open)} type="button">
              <ProfileAvatar name={user?.fullName} src={user?.avatarUrl} />
            </button>
            <div>
              <button onClick={() => { navigate("/profile"); setProfileOpen(false); }} type="button"><FiUserCheck /> Profile Settings</button>
              <button onClick={() => { navigate("/security"); setProfileOpen(false); }} type="button"><FiShield /> Security & Privacy</button>
              <button onClick={logout}><FiLogOut /> Logout</button>
            </div>
          </div>
        </div>
      </header>
      {messagesOpen ? <MessageModal initialConversationId={messageTargetId} onClose={() => setMessagesOpen(false)} /> : null}
    </>
  );
}
