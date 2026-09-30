import NotificationBell from "../../components/NotificationBell";
import PortalNav from "../../components/PortalNav";
import { useCallback, useEffect, useRef, useState } from "react";
import { FiAlertTriangle, FiMessageCircle } from "react-icons/fi";
import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import MessageModal from "../../components/MessageModal";
import ProfileMenu from "../../components/ProfileMenu";
import { PageSkeleton } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import useMessagePreview from "../../hooks/useMessagePreview";
import { formatViolationType, MAX_VIOLATION_ALERTS, playViolationAlertSound, VIOLATION_ALERT_DURATION_MS } from "../../lib/violationAlerts";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

export default function ProfessorLayout() {
  const { user, logout, loading, hasLoggedInThisSession } = useAuth();
  const navigate = useNavigate();
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [messageTargetId, setMessageTargetId] = useState("");
  const { conversations, unreadCount } = useMessagePreview(user);

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
          <NotificationBell user={user} />
          <ProfileMenu className="cluster-profile-menu" logout={logout} user={user} />
        </div>
      </header>
      <main className="cluster-shell professor-shell">
        <Outlet />
      </main>
      <ProfessorViolationAlerts user={user} />
      {messagesOpen ? <MessageModal initialConversationId={messageTargetId} onClose={() => setMessagesOpen(false)} /> : null}
    </>
  );
}

function ProfessorViolationAlerts({ user }) {
  const [alerts, setAlerts] = useState([]);
  const scopeRef = useRef({ courseIds: new Set(), examById: new Map() });
  const studentNamesRef = useRef(new Map());
  const timersRef = useRef(new Set());

  const removeAlert = useCallback((id) => {
    setAlerts((current) => current.filter((alert) => alert.id !== id));
  }, []);

  const pushAlert = useCallback((violation, studentName = "Unknown student") => {
    const exam = scopeRef.current.examById.get(violation.exam_id) || {};
    const next = {
      id: `${violation.id || violation.exam_id || violation.student_id || Date.now()}-${Date.now()}`,
      examTitle: exam.exam_title || exam.title || "Exam",
      studentName,
      typeLabel: formatViolationType(violation.violation_type),
    };
    playViolationAlertSound();
    setAlerts((current) => [...current, next].slice(-MAX_VIOLATION_ALERTS));
    const timer = window.setTimeout(() => {
      timersRef.current.delete(timer);
      removeAlert(next.id);
    }, VIOLATION_ALERT_DURATION_MS);
    timersRef.current.add(timer);
  }, [removeAlert]);

  const handleViolation = useCallback(async (payload) => {
    const violation = payload?.new;
    if (!violation) return;
    const { courseIds, examById } = scopeRef.current;
    if (violation.professor_id && violation.professor_id !== user?.id) return;
    const hasExamScope = violation.exam_id && examById.has(violation.exam_id);
    const hasCourseScope = violation.course_id && courseIds.has(violation.course_id);
    if (!hasExamScope && !hasCourseScope) return;

    let studentName = studentNamesRef.current.get(violation.student_id);
    if (!studentName && violation.student_id) {
      const { data } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", violation.student_id)
        .maybeSingle();
      studentName = data?.full_name || data?.email || "Unknown student";
      studentNamesRef.current.set(violation.student_id, studentName);
    }
    pushAlert(violation, studentName);
  }, [pushAlert, user?.id]);

  useEffect(() => {
    if (!hasSupabaseConfig || !user?.id) return undefined;
    let active = true;
    let channel;
    const timers = timersRef.current;

    async function loadScopeAndSubscribe() {
      const { data: courses } = await supabase
        .from("courses")
        .select("id")
        .eq("professor_id", user.id)
        .eq("archived", false);
      if (!active) return;

      const courseIds = new Set((courses || []).map((course) => course.id));
      const examById = new Map();
      const examSelect = "id, title, exam_title, course_id";
      const queries = [
        supabase.from("exams").select(examSelect).or(`professor_id.eq.${user.id},created_by.eq.${user.id}`),
      ];
      if (courseIds.size) queries.push(supabase.from("exams").select(examSelect).in("course_id", [...courseIds]));
      const results = await Promise.all(queries);
      if (!active) return;

      results.flatMap((result) => result.data || []).forEach((exam) => examById.set(exam.id, exam));
      scopeRef.current = { courseIds, examById };
      channel = supabase
        .channel(`professor-violation-alerts-${user.id}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "violations" }, handleViolation)
        .subscribe();
    }

    void loadScopeAndSubscribe();
    return () => {
      active = false;
      if (channel) supabase.removeChannel(channel);
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, [handleViolation, user?.id]);

  if (!alerts.length) return null;
  return (
    <div aria-live="polite" className="professor-violation-alert-stack">
      {alerts.map((alert) => (
        <article className="professor-violation-toast" key={alert.id} role="status">
          <FiAlertTriangle aria-hidden="true" />
          <div>
            <strong>{alert.typeLabel}</strong>
            <span>{alert.studentName} - {alert.examTitle}</span>
          </div>
        </article>
      ))}
    </div>
  );
}
