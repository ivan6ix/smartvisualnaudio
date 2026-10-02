import NotificationBell from "../../components/NotificationBell";
import { useEffect, useState } from "react";
import { FiBell, FiCheckCircle, FiFileText, FiInbox, FiMenu, FiMessageCircle, FiMoon, FiShield, FiSun, FiUser, FiX, FiXCircle } from "react-icons/fi";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import MessageModal from "../../components/MessageModal";
import ProfileAvatar from "../../components/ProfileAvatar";
import ProfileMenu from "../../components/ProfileMenu";
import { PageSkeleton } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import useMessagePreview from "../../hooks/useMessagePreview";

const clusterNavigation = [
  { label: "Review Overview", to: "/cluster", icon: FiShield, end: true },
  { label: "Pending Exams", to: "/cluster/pending", icon: FiInbox },
  { label: "Approved Exams", to: "/cluster/approved", icon: FiCheckCircle },
  { label: "Rejected Exams", to: "/cluster/rejected", icon: FiXCircle },
  { label: "Review History", to: "/cluster/history", icon: FiFileText },
  { label: "Reports", to: "/cluster/reports", icon: FiFileText },
  { label: "Messages", to: "/cluster/messages", icon: FiMessageCircle },
  { label: "Notifications", to: "/cluster/notifications", icon: FiBell },
];

const clusterUtilityNavigation = [
  { label: "Profile", to: "/cluster/profile", icon: FiUser },
];

function getCurrentPage(pathname) {
  if (pathname.startsWith("/cluster/exams/")) return "Exam Review";
  if (pathname === "/cluster/security") return "Security & Privacy";
  const links = [...clusterNavigation, ...clusterUtilityNavigation]
    .filter((item) => item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`))
    .sort((first, second) => second.to.length - first.to.length);
  return links[0]?.label || "Cluster Professor Workspace";
}

function ClusterSidebar({ onBrand, onNavigate, user }) {
  return (
    <aside className="admin-sidebar cluster-sidebar" aria-label="Cluster Professor navigation">
      <button className="admin-sidebar-brand cluster-sidebar-brand" onClick={onBrand} type="button">
        <span><FiShield /></span>
        <div>
          <strong>Smart Proctoring</strong>
          <small>Cluster Professor Portal</small>
        </div>
      </button>
      <nav>
        {clusterNavigation.map(({ end, icon: Icon, label, to }) => (
          <NavLink end={end} key={to} onClick={onNavigate} to={to}>
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <nav className="cluster-sidebar-utility" aria-label="Cluster Professor utilities">
        {clusterUtilityNavigation.map(({ icon: Icon, label, to }) => (
          <NavLink key={to} onClick={onNavigate} to={to}>
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="admin-sidebar-profile cluster-sidebar-profile">
        <ProfileAvatar name={user?.fullName} src={user?.avatarUrl} />
        <div>
          <strong>{user?.fullName || "Cluster Professor"}</strong>
          <span>{user?.role || "Cluster Professor"}</span>
        </div>
      </div>
    </aside>
  );
}

export default function ClusterLayout() {
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
  if (user.role !== "Cluster Professor") return <Navigate to="/" replace />;

  return (
    <div className="admin-app-shell cluster-app-shell" data-role="Cluster Professor">
      <ClusterSidebar onBrand={() => navigate("/cluster")} onNavigate={() => {}} user={user} />
      <div className={`admin-drawer cluster-drawer ${drawerOpen ? "open" : ""}`}>
        <ClusterSidebar onBrand={() => { navigate("/cluster"); setDrawerOpen(false); }} onNavigate={() => setDrawerOpen(false)} user={user} />
      </div>
      {drawerOpen ? <button aria-label="Close cluster professor navigation" className="admin-drawer-backdrop cluster-drawer-backdrop" onClick={() => setDrawerOpen(false)} type="button" /> : null}
      <div className="admin-shell-main cluster-shell-main">
        <header className="admin-topbar cluster-admin-topbar">
          <button aria-label="Open cluster professor navigation" className="admin-menu-button cluster-menu-button" onClick={() => setDrawerOpen(true)} type="button"><FiMenu /></button>
          <div className="admin-topbar-title cluster-topbar-title">
            <strong>{currentPage}</strong>
          </div>
          <div className="admin-topbar-actions cluster-topbar-actions">
            <button aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} className="admin-icon-button cluster-theme-button" onClick={toggleTheme} title="Theme" type="button">{theme === "dark" ? <FiSun /> : <FiMoon />}</button>
            <div className="message-menu admin-message-menu cluster-message-menu">
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
            <ProfileMenu className="profile-menu admin-profile-menu cluster-profile-menu" logout={logout} user={user} />
          </div>
        </header>
        <main className="admin-main-content cluster-shell cluster-role-shell">
          <Outlet />
        </main>
      </div>
      {messagesOpen ? <MessageModal initialConversationId={messageTargetId} onClose={() => setMessagesOpen(false)} /> : null}
      {drawerOpen ? <button aria-label="Close cluster professor navigation" className="admin-drawer-close cluster-drawer-close" onClick={() => setDrawerOpen(false)} type="button"><FiX /></button> : null}
    </div>
  );
}
