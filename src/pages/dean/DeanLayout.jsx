import NotificationBell from "../../components/NotificationBell";
import { useEffect, useState } from "react";
import { FiBarChart2, FiBell, FiBookOpen, FiFileText, FiMenu, FiMessageCircle, FiMoon, FiShield, FiSun, FiUser, FiX } from "react-icons/fi";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import MessageModal from "../../components/MessageModal";
import ProfileAvatar from "../../components/ProfileAvatar";
import ProfileMenu from "../../components/ProfileMenu";
import { PageSkeleton } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import useMessagePreview from "../../hooks/useMessagePreview";

const deanNavigation = [
  { label: "Dashboard", to: "/dean", icon: FiBarChart2, end: true },
  { label: "Exam Integrity", to: "/dean/integrity", icon: FiShield },
  { label: "Courses", to: "/dean/courses", icon: FiBookOpen },
  { label: "Reports", to: "/dean/reports", icon: FiFileText },
  { label: "Notifications", to: "/dean/notifications", icon: FiBell },
];

const deanUtilityNavigation = [
  { label: "Profile", to: "/dean/profile", icon: FiUser },
];

function getCurrentPage(pathname) {
  const links = [...deanNavigation, ...deanUtilityNavigation]
    .filter((item) => item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`))
    .sort((first, second) => second.to.length - first.to.length);
  if (pathname === "/dean/security") return "Security & Privacy";
  return links[0]?.label || "Dean Workspace";
}

function DeanSidebar({ onBrand, onNavigate, user }) {
  return (
    <aside className="admin-sidebar dean-sidebar" aria-label="Dean navigation">
      <button className="admin-sidebar-brand dean-sidebar-brand" onClick={onBrand} type="button">
        <span><FiShield /></span>
        <div>
          <strong>Smart Proctoring</strong>
          <small>Dean Portal</small>
        </div>
      </button>
      <nav>
        {deanNavigation.map(({ end, icon: Icon, label, to }) => (
          <NavLink end={end} key={to} onClick={onNavigate} to={to}>
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <nav className="dean-sidebar-utility" aria-label="Dean utilities">
        {deanUtilityNavigation.map(({ icon: Icon, label, to }) => (
          <NavLink key={to} onClick={onNavigate} to={to}>
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="admin-sidebar-profile dean-sidebar-profile">
        <ProfileAvatar name={user?.fullName} src={user?.avatarUrl} />
        <div>
          <strong>{user?.fullName || "Dean User"}</strong>
          <span>{user?.role || "Dean"}</span>
        </div>
      </div>
    </aside>
  );
}

export default function DeanLayout() {
  const { user, logout, loading, hasLoggedInThisSession } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [messageTargetId, setMessageTargetId] = useState("");
  const { conversations, unreadCount } = useMessagePreview(user);
  const currentPage = getCurrentPage(location.pathname);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  function openMessages(conversationId = "") {
    setMessageTargetId(conversationId);
    setMessagesOpen(true);
  }

  if (loading) return <PageSkeleton />;
  if (!hasLoggedInThisSession || !user) return <Navigate to="/login" replace />;
  if (user.role !== "Dean") return <Navigate to="/" replace />;

  return (
    <div className="admin-app-shell dean-app-shell" data-role="Dean">
      <DeanSidebar onBrand={() => navigate("/dean")} onNavigate={() => {}} user={user} />
      <div className={`admin-drawer dean-drawer ${drawerOpen ? "open" : ""}`}>
        <DeanSidebar onBrand={() => { navigate("/dean"); setDrawerOpen(false); }} onNavigate={() => setDrawerOpen(false)} user={user} />
      </div>
      {drawerOpen ? <button aria-label="Close dean navigation" className="admin-drawer-backdrop dean-drawer-backdrop" onClick={() => setDrawerOpen(false)} type="button" /> : null}
      <div className="admin-shell-main dean-shell-main">
        <header className="admin-topbar dean-topbar">
          <button aria-label="Open dean navigation" className="admin-menu-button dean-menu-button" onClick={() => setDrawerOpen(true)} type="button"><FiMenu /></button>
          <div className="admin-topbar-title dean-topbar-title">
            <strong>{currentPage}</strong>
          </div>
          <div className="admin-topbar-actions dean-topbar-actions">
            <button aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} className="admin-icon-button dean-theme-button" onClick={toggleTheme} title="Theme" type="button">{theme === "dark" ? <FiSun /> : <FiMoon />}</button>
            <div className="message-menu admin-message-menu dean-message-menu">
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
            <ProfileMenu className="profile-menu admin-profile-menu dean-profile-menu" logout={logout} user={user} />
          </div>
        </header>
        <main className="admin-main-content dean-shell">
          <Outlet />
        </main>
      </div>
      {messagesOpen ? <MessageModal initialConversationId={messageTargetId} onClose={() => setMessagesOpen(false)} /> : null}
      {drawerOpen ? <button aria-label="Close dean navigation" className="admin-drawer-close dean-drawer-close" onClick={() => setDrawerOpen(false)} type="button"><FiX /></button> : null}
    </div>
  );
}
