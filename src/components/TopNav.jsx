import MessageMenu from "./MessageMenu";
import NotificationBell from "./NotificationBell";
import PortalNav from "./PortalNav";
import { useState } from "react";
import { FiUserCheck } from "react-icons/fi";
import { NavLink, useNavigate } from "react-router-dom";
import ProfileMenu from "./ProfileMenu";
import { useAuth } from "../context/AuthContext";
import useMessagePreview from "../hooks/useMessagePreview";
import MessageModal from "./MessageModal";

export default function TopNav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [messageTargetId, setMessageTargetId] = useState("");
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
          <MessageMenu className="message-menu" conversations={conversations} onOpenMessages={openMessages} unreadCount={unreadCount} />
          <NotificationBell user={user} emptyText="No password reset requests yet." />
          <ProfileMenu icon={FiUserCheck} logout={logout} user={user} />
        </div>
      </header>
      {messagesOpen ? <MessageModal initialConversationId={messageTargetId} onClose={() => setMessagesOpen(false)} /> : null}
    </>
  );
}
