import NotificationBell from "../../components/NotificationBell";
import { useEffect, useState } from "react";
import { FiBookOpen, FiClipboard, FiFileText, FiMenu, FiMessageCircle, FiMoon, FiSun, FiUser, FiX } from "react-icons/fi";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import MessageModal from "../../components/MessageModal";
import ProfileAvatar from "../../components/ProfileAvatar";
import ProfileMenu from "../../components/ProfileMenu";
import { PageSkeleton } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import useMessagePreview from "../../hooks/useMessagePreview";

const studentNavigation = [
  { label: "Dashboard", to: "/student", icon: FiClipboard, end: true },
  { label: "Resources", to: "/student/resources", icon: FiBookOpen },
  { label: "Grades", to: "/student/grades", icon: FiFileText },
];

const studentUtilityNavigation = [
  { label: "Profile", to: "/student/profile", icon: FiUser },
];

function getCurrentPage(pathname) {
  const links = [...studentNavigation, ...studentUtilityNavigation]
    .filter((item) => item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`))
    .sort((first, second) => second.to.length - first.to.length);
  if (/^\/student\/courses\//.test(pathname)) return "Courses";
  return links[0]?.label || "Student Portal";
}

function StudentSidebar({ onBrand, onNavigate, user }) {
  return (
    <aside className="admin-sidebar student-sidebar" aria-label="Student navigation">
      <button className="admin-sidebar-brand student-sidebar-brand" onClick={onBrand} type="button">
        <span><FiBookOpen /></span>
        <div>
          <strong>Smart Proctoring</strong>
          <small>Student Portal</small>
        </div>
      </button>
      <nav>
        {studentNavigation.map(({ end, icon: Icon, label, to }) => (
          <NavLink end={end} key={to} onClick={onNavigate} to={to}>
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <nav className="student-sidebar-utility" aria-label="Student utilities">
        {studentUtilityNavigation.map(({ icon: Icon, label, to }) => (
          <NavLink key={to} onClick={onNavigate} to={to}>
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="admin-sidebar-profile student-sidebar-profile">
        <ProfileAvatar name={user?.fullName} src={user?.avatarUrl} />
        <div>
          <strong>{user?.fullName || "Student User"}</strong>
          <span>{user?.role || "Student"}</span>
        </div>
      </div>
    </aside>
  );
}

export default function StudentLayout() {
  const { user, logout, loading, hasLoggedInThisSession } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [messageTargetId, setMessageTargetId] = useState("");
  const { conversations, unreadCount } = useMessagePreview(user);
  const isTakingExam = location.pathname.startsWith("/student/exams/");
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
  if (user.role !== "Student") return <Navigate to="/" replace />;

  if (isTakingExam) {
    return (
      <main className="student-exam-shell">
        <Outlet />
      </main>
    );
  }

  return (
    <div className="student-app-shell">
      <StudentSidebar onBrand={() => navigate("/student")} onNavigate={() => {}} user={user} />
      <div className={`admin-drawer student-drawer ${drawerOpen ? "open" : ""}`}>
        <StudentSidebar onBrand={() => { navigate("/student"); setDrawerOpen(false); }} onNavigate={() => setDrawerOpen(false)} user={user} />
      </div>
      {drawerOpen ? <button aria-label="Close student navigation" className="admin-drawer-backdrop student-drawer-backdrop" onClick={() => setDrawerOpen(false)} type="button" /> : null}
      <div className="student-shell-main">
        <header className="admin-topbar student-topbar">
          <button aria-label="Open student navigation" className="admin-menu-button student-menu-button" onClick={() => setDrawerOpen(true)} type="button"><FiMenu /></button>
          <div className="admin-topbar-title student-topbar-title">
            <strong>{currentPage}</strong>
          </div>
          <div className="admin-topbar-actions student-topbar-actions">
            <button aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} className="admin-icon-button student-theme-button" onClick={toggleTheme} title="Theme" type="button">{theme === "dark" ? <FiSun /> : <FiMoon />}</button>
            <div className="message-menu admin-message-menu student-message-menu">
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
            <NotificationBell user={user} />
            <ProfileMenu className="profile-menu admin-profile-menu student-profile-menu" logout={logout} user={user} />
          </div>
        </header>
        <main className="student-shell">
          <Outlet />
        </main>
      </div>
      {messagesOpen ? <MessageModal initialConversationId={messageTargetId} onClose={() => setMessagesOpen(false)} /> : null}
      {drawerOpen ? <button aria-label="Close student navigation" className="admin-drawer-close student-drawer-close" onClick={() => setDrawerOpen(false)} type="button"><FiX /></button> : null}
    </div>
  );
}
