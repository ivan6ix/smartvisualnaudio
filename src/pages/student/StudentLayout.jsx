import NotificationBell from "../../components/NotificationBell";
import PortalNav from "../../components/PortalNav";
import { useState } from "react";
import { FiMessageCircle } from "react-icons/fi";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import MessageModal from "../../components/MessageModal";
import ProfileMenu from "../../components/ProfileMenu";
import { PageSkeleton } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import useMessagePreview from "../../hooks/useMessagePreview";

export default function StudentLayout() {
  const { user, logout, loading, hasLoggedInThisSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [messageTargetId, setMessageTargetId] = useState("");
  const { conversations, unreadCount } = useMessagePreview(user);
  const isTakingExam = location.pathname.startsWith("/student/exams/");

  function openMessages(conversationId = "") {
    setMessageTargetId(conversationId);
    setMessagesOpen(true);
  }

  if (loading) return <PageSkeleton />;
  if (!hasLoggedInThisSession || !user) return <Navigate to="/login" replace />;
  if (user.role !== "Student") return <Navigate to="/" replace />;

  return (
    <>
      {!isTakingExam ? (
        <header className="cluster-topbar student-topbar">
          <button className="brand cluster-brand" onClick={() => navigate("/student")}>
            <strong>Smart Proctoring</strong>
            <span>Student Portal</span>
          </button>
          <PortalNav>
            <NavLink end to="/student">Courses</NavLink>
            <NavLink to="/student/resources">Resources</NavLink>
            <NavLink to="/student/grades">Grades</NavLink>
          </PortalNav>
          <div className="cluster-tools">
            <div className="message-menu cluster-message-menu">
              <button onClick={() => openMessages()} title="Messages" type="button">
                <FiMessageCircle />
                {unreadCount ? <span>{unreadCount}</span> : null}
              </button>
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
            <ProfileMenu className="cluster-profile-menu" logout={logout} user={user} />
          </div>
        </header>
      ) : null}
      <main className="student-shell">
        <Outlet />
      </main>
      {messagesOpen ? <MessageModal initialConversationId={messageTargetId} onClose={() => setMessagesOpen(false)} /> : null}
    </>
  );
}
