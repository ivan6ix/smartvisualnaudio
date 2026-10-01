import NotificationBell from "./NotificationBell";
import ProfileMenu from "./ProfileMenu";
import MessageModal from "./MessageModal";
import { useEffect, useState } from "react";
import { FiBookOpen, FiClipboard, FiFileText, FiList, FiMenu, FiMessageCircle, FiMoon, FiShield, FiSun, FiUser, FiUserPlus, FiUsers, FiX } from "react-icons/fi";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import useMessagePreview from "../hooks/useMessagePreview";
import ProfileAvatar from "./ProfileAvatar";

const adminNavigation = [
  { label: "Dashboard", to: "/", icon: FiClipboard, end: true },
  { label: "Create Account", to: "/create-account", icon: FiUserPlus },
  { label: "Courses", to: "/courses", icon: FiBookOpen },
  { label: "Accounts", to: "/accounts", icon: FiUsers },
  { label: "Reports", to: "/reports", icon: FiFileText },
  { label: "Logs", to: "/admin/logs", icon: FiList },
];

function AppSidebar({ onBrand, onNavigate, user }) {
  return (
    <aside className="admin-sidebar" aria-label="Admin navigation">
      <button className="admin-sidebar-brand" onClick={onBrand} type="button">
        <span><FiShield /></span>
        <div>
          <strong>Smart Proctoring</strong>
          <small>Admin Portal</small>
        </div>
      </button>
      <nav>
        {adminNavigation.map(({ end, icon: Icon, label, to }) => (
          <NavLink end={end} key={to} onClick={onNavigate} to={to}>
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="admin-sidebar-profile">
        <ProfileAvatar name={user?.fullName} src={user?.avatarUrl} />
        <div>
          <strong>{user?.fullName || "Admin User"}</strong>
          <span>{user?.role || "Administrator"}</span>
        </div>
      </div>
    </aside>
  );
}

export default function AppShell({ role = "Admin" }) {
  const { logout, user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [messageTargetId, setMessageTargetId] = useState("");
  const { conversations, unreadCount } = useMessagePreview(user);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  function openMessages(conversationId = "") {
    setMessageTargetId(conversationId);
    setMessagesOpen(true);
  }

  return (
    <div className="admin-app-shell" data-role={role}>
      <AppSidebar onBrand={() => navigate("/")} onNavigate={() => {}} user={user} />
      <div className={`admin-drawer ${drawerOpen ? "open" : ""}`}>
        <AppSidebar onBrand={() => { navigate("/"); setDrawerOpen(false); }} onNavigate={() => setDrawerOpen(false)} user={user} />
      </div>
      {drawerOpen ? <button aria-label="Close admin navigation" className="admin-drawer-backdrop" onClick={() => setDrawerOpen(false)} type="button" /> : null}
      <div className="admin-shell-main">
        <header className="admin-topbar">
          <button aria-label="Open admin navigation" className="admin-menu-button" onClick={() => setDrawerOpen(true)} type="button"><FiMenu /></button>
          <div className="admin-topbar-title">
            <span>Admin Workspace</span>
            <strong>{adminNavigation.find((item) => item.to === location.pathname)?.label || "System Overview"}</strong>
          </div>
          <div className="admin-topbar-actions">
            <button aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} className="admin-icon-button" onClick={toggleTheme} title="Theme" type="button">{theme === "dark" ? <FiSun /> : <FiMoon />}</button>
            <div className="message-menu admin-message-menu">
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
            <ProfileMenu className="profile-menu admin-profile-menu" icon={FiUser} logout={logout} user={user} />
          </div>
        </header>
        <main className="admin-main-content">
          <Outlet />
        </main>
      </div>
      {messagesOpen ? <MessageModal initialConversationId={messageTargetId} onClose={() => setMessagesOpen(false)} /> : null}
      {drawerOpen ? <button aria-label="Close admin navigation" className="admin-drawer-close" onClick={() => setDrawerOpen(false)} type="button"><FiX /></button> : null}
    </div>
  );
}
