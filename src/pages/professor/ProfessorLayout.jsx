import MessageMenu from "../../components/MessageMenu";
import NotificationBell from "../../components/NotificationBell";
import { useCallback, useEffect, useRef, useState } from "react";
import { FiAlertTriangle, FiBookOpen, FiClipboard, FiFileText, FiMenu, FiMonitor, FiMoon, FiPrinter, FiSettings, FiShield, FiSun, FiTrendingUp, FiUser, FiX } from "react-icons/fi";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import MessageModal from "../../components/MessageModal";
import ProfileAvatar from "../../components/ProfileAvatar";
import ProfileMenu from "../../components/ProfileMenu";
import { PageSkeleton } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import useMessagePreview from "../../hooks/useMessagePreview";
import { addViolationAlert, describeViolationPlace, formatViolationType, playViolationAlertSound, removeViolationAlert, VIOLATION_ALERT_DURATION_MS } from "../../lib/violationAlerts";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

const professorNavigation = [
  { label: "Dashboard", to: "/professor", icon: FiClipboard, end: true },
  { label: "Courses", to: "/professor/courses", icon: FiBookOpen },
  { label: "Exams", to: "/professor/exams", icon: FiFileText },
  { label: "Scores", to: "/professor/scores", icon: FiUser },
  { label: "Monitoring", to: "/professor/monitoring", icon: FiMonitor },
  { label: "Analytics", to: "/professor/analytics", icon: FiTrendingUp },
  { label: "Exam Integrity", to: "/professor/integrity", icon: FiShield },
  { label: "Reports", to: "/professor/reports", icon: FiPrinter },
];

const professorUtilityNavigation = [
  { label: "Settings", to: "/professor/profile", icon: FiSettings },
];

function getCurrentPage(pathname) {
  const links = [...professorNavigation, ...professorUtilityNavigation]
    .filter((item) => item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`))
    .sort((first, second) => second.to.length - first.to.length);
  return links[0]?.label || "Professor Workspace";
}

function ProfessorSidebar({ drawerThemeAction, onBrand, onNavigate, user }) {
  return (
    <aside className="admin-sidebar professor-sidebar" aria-label="Professor navigation">
      <button className="admin-sidebar-brand professor-sidebar-brand" onClick={onBrand} type="button">
        <span><FiBookOpen /></span>
        <div>
          <strong>Smart Proctoring</strong>
          <small>Professor Portal</small>
        </div>
      </button>
      <nav>
        {professorNavigation.map(({ end, icon: Icon, label, to }) => (
          <NavLink end={end} key={to} onClick={onNavigate} to={to}>
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <nav className="professor-sidebar-utility" aria-label="Professor utilities">
        {professorUtilityNavigation.map(({ icon: Icon, label, to }) => (
          <NavLink key={to} onClick={onNavigate} to={to}>
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      {drawerThemeAction ? <div className="admin-sidebar-theme professor-sidebar-theme">{drawerThemeAction}</div> : null}
      <div className="admin-sidebar-profile professor-sidebar-profile">
        <ProfileAvatar name={user?.fullName} src={user?.avatarUrl} />
        <div>
          <strong>{user?.fullName || "Professor User"}</strong>
          <span>{user?.role || "Professor"}</span>
        </div>
      </div>
    </aside>
  );
}

export default function ProfessorLayout() {
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
  if (user.role !== "Professor") return <Navigate to="/" replace />;

  return (
    <div className="admin-app-shell professor-app-shell" data-role="Professor">
      <ProfessorSidebar onBrand={() => navigate("/professor")} onNavigate={() => {}} user={user} />
      <div className={`admin-drawer professor-drawer ${drawerOpen ? "open" : ""}`}>
        <ProfessorSidebar
          drawerThemeAction={<button aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} onClick={toggleTheme} type="button">{theme === "dark" ? <FiSun /> : <FiMoon />}<span>Theme</span></button>}
          onBrand={() => { navigate("/professor"); setDrawerOpen(false); }}
          onNavigate={() => setDrawerOpen(false)}
          user={user}
        />
      </div>
      {drawerOpen ? <button aria-label="Close professor navigation" className="admin-drawer-backdrop professor-drawer-backdrop" onClick={() => setDrawerOpen(false)} type="button" /> : null}
      <div className="admin-shell-main professor-shell-main">
        <header className="admin-topbar professor-topbar">
          <button aria-label="Open professor navigation" className="admin-menu-button professor-menu-button" onClick={() => setDrawerOpen(true)} type="button"><FiMenu /></button>
          <div className="admin-topbar-title professor-topbar-title">
            <strong>{currentPage}</strong>
          </div>
          <div className="admin-topbar-actions professor-topbar-actions">
            <button aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} className="admin-icon-button professor-theme-button" onClick={toggleTheme} title="Theme" type="button">{theme === "dark" ? <FiSun /> : <FiMoon />}</button>
            <MessageMenu className="message-menu admin-message-menu professor-message-menu" conversations={conversations} onOpenMessages={openMessages} unreadCount={unreadCount} />
            <NotificationBell user={user} />
            <ProfileMenu className="profile-menu admin-profile-menu professor-profile-menu" logout={logout} user={user} />
          </div>
        </header>
        <main className="admin-main-content professor-shell">
          <Outlet />
        </main>
      </div>
      <ProfessorViolationAlerts user={user} />
      {messagesOpen ? <MessageModal initialConversationId={messageTargetId} onClose={() => setMessagesOpen(false)} /> : null}
      {drawerOpen ? <button aria-label="Close professor navigation" className="admin-drawer-close professor-drawer-close" onClick={() => setDrawerOpen(false)} type="button"><FiX /></button> : null}
    </div>
  );
}

// Small pop-ups at the bottom right when a student in one of the professor's exams gets a violation.
function ProfessorViolationAlerts({ user }) {
  const navigate = useNavigate();
  const [stack, setStack] = useState({ alerts: [], hiddenCount: 0 });
  const scopeRef = useRef({ courseById: new Map(), courseIds: new Set(), examById: new Map() });
  const studentNamesRef = useRef(new Map());
  const timersRef = useRef(new Set());

  const removeAlert = useCallback((id) => {
    setStack((current) => removeViolationAlert(current, id));
  }, []);

  const viewStudent = useCallback((alert) => {
    removeAlert(alert.id);
    // The dashboard's Ongoing Exams opens this exam with the student searched.
    navigate("/professor", { state: { ongoingExamId: alert.examId, ongoingStudent: alert.studentName } });
  }, [navigate, removeAlert]);

  const pushAlert = useCallback((violation, studentName = "Unknown student") => {
    const { courseById, examById } = scopeRef.current;
    const exam = examById.get(violation.exam_id) || {};
    const course = courseById.get(violation.course_id) || courseById.get(exam.course_id) || {};
    const createdAt = violation.created_at ? new Date(violation.created_at) : new Date();
    const next = {
      id: `${violation.id || violation.exam_id || violation.student_id || Date.now()}-${Date.now()}`,
      examId: violation.exam_id,
      place: describeViolationPlace({ examTitle: exam.exam_title || exam.title, courseCode: course.course_code, section: course.section }),
      studentName,
      time: (Number.isNaN(createdAt.getTime()) ? new Date() : createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
      typeLabel: formatViolationType(violation.violation_type),
    };
    playViolationAlertSound();
    setStack((current) => addViolationAlert(current, next));
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
        .select("id, course_code, section")
        .eq("professor_id", user.id)
        .eq("archived", false);
      if (!active) return;

      const courseIds = new Set((courses || []).map((course) => course.id));
      const courseById = new Map((courses || []).map((course) => [course.id, course]));
      const examById = new Map();
      const examSelect = "id, title, exam_title, course_id";
      const queries = [
        supabase.from("exams").select(examSelect).or(`professor_id.eq.${user.id},created_by.eq.${user.id}`),
      ];
      if (courseIds.size) queries.push(supabase.from("exams").select(examSelect).in("course_id", [...courseIds]));
      const results = await Promise.all(queries);
      if (!active) return;

      results.flatMap((result) => result.data || []).forEach((exam) => examById.set(exam.id, exam));
      scopeRef.current = { courseById, courseIds, examById };
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

  if (!stack.alerts.length) return null;
  return (
    <div aria-live="polite" className="professor-violation-alert-stack">
      {stack.hiddenCount ? <p className="professor-violation-more">+{stack.hiddenCount} more {stack.hiddenCount === 1 ? "violation" : "violations"}</p> : null}
      {stack.alerts.map((alert) => (
        <article className="professor-violation-toast" key={alert.id} role="status">
          <FiAlertTriangle aria-hidden="true" />
          <div>
            <strong>{alert.typeLabel}</strong>
            <span>{alert.studentName} · {alert.place}</span>
            <small>{alert.time}</small>
            {alert.examId ? <button className="professor-violation-view" onClick={() => viewStudent(alert)} type="button">View student</button> : null}
          </div>
          <button aria-label="Dismiss violation alert" className="professor-violation-close" onClick={() => removeAlert(alert.id)} type="button"><FiX /></button>
        </article>
      ))}
    </div>
  );
}
