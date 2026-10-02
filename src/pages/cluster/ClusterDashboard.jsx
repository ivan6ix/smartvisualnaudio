import { useCallback, useEffect, useMemo, useState } from "react";
import { FiCheckCircle, FiFileText, FiInbox, FiMessageCircle, FiXCircle } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { RowActionMenu } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useCluster } from "../../context/ClusterContext";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";
import { StatusBadge } from "./helpers";

function normalizeStatus(status) {
  const value = String(status || "").toLowerCase();
  if (["pending review", "pending approval", "pending", "submitted"].includes(value)) return "Pending Review";
  if (["approved", "cluster approved"].includes(value)) return "Approved";
  if (value === "rejected") return "Rejected";
  if (["published", "active"].includes(value)) return "Published";
  return status || "Draft";
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export default function ClusterDashboard() {
  const { exams, reviews, reportsGenerated, messages, approveExam, rejectExam } = useCluster();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loadingActionId, setLoadingActionId] = useState("");
  const [openActionMenuId, setOpenActionMenuId] = useState("");
  const [liveStats, setLiveStats] = useState(null);
  const [liveRecent, setLiveRecent] = useState([]);

  const loadLiveDashboard = useCallback(async () => {
    if (!hasSupabaseConfig || !user?.id) return;

    try {
      const [{ data: examRows, error: examsError }, { data: reviewRows, error: reviewsError }, { data: messageRows, error: messagesError }] = await Promise.all([
        supabase
          .from("exams")
          .select("id, title, exam_title, course, course_id, professor_id, created_by, status, submitted_at, approved_at, rejected_at, created_at, courses(course_name, course_code, section)")
          .in("status", ["Pending Review", "Pending Approval", "Pending", "Submitted", "Approved", "Rejected", "Published", "Active"])
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("exam_reviews")
          .select("id, exam_id, decision, review_date")
          .order("review_date", { ascending: false })
          .limit(1000),
        supabase
          .from("messages")
          .select("id")
          .eq("receiver_id", user.id)
          .eq("is_read", false),
      ]);

      if (examsError) throw examsError;
      if (reviewsError) throw reviewsError;
      if (messagesError) throw messagesError;

      const professorIds = [...new Set((examRows || []).flatMap((exam) => [exam.professor_id, exam.created_by]).filter(Boolean))];
      const { data: profileRows, error: profilesError } = professorIds.length
        ? await supabase.from("profiles").select("id, full_name, email").in("id", professorIds)
        : { data: [], error: null };

      if (profilesError) throw profilesError;

      const profileById = new Map((profileRows || []).map((profile) => [profile.id, profile]));
      const mappedExams = (examRows || []).map((exam) => {
        const status = normalizeStatus(exam.status);
        const professor = profileById.get(exam.professor_id || exam.created_by);
        const course = exam.courses;

        return {
          id: exam.id,
          examTitle: exam.exam_title || exam.title || "Untitled exam",
          professorName: professor?.full_name || professor?.email || "Professor",
          course: course?.course_name || exam.course || `${course?.course_code || "Course"} ${course?.section || ""}`.trim(),
          submittedAt: formatDate(exam.submitted_at || exam.created_at),
          status,
        };
      });

      setLiveRecent(mappedExams.slice(0, 8));
      setLiveStats({
        pending: mappedExams.filter((exam) => exam.status === "Pending Review").length,
        approved: mappedExams.filter((exam) => exam.status === "Approved" || exam.status === "Published").length,
        rejected: mappedExams.filter((exam) => exam.status === "Rejected").length,
        reviews: (reviewRows || []).length,
        reports: (reviewRows || []).length,
        messages: (messageRows || []).length,
      });
    } catch (error) {
      toast.error(error.message);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadLiveDashboard();
  }, [loadLiveDashboard]);

  useEffect(() => {
    if (!hasSupabaseConfig || !user?.id) return undefined;

    const channel = supabase
      .channel(`cluster-dashboard-live-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "exams" }, () => void loadLiveDashboard())
      .on("postgres_changes", { event: "*", schema: "public", table: "exam_reviews" }, () => void loadLiveDashboard())
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `receiver_id=eq.${user.id}` }, () => void loadLiveDashboard())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadLiveDashboard, user?.id]);

  const dashboardExams = hasSupabaseConfig ? liveRecent : exams;
  const pending = useMemo(() => (hasSupabaseConfig ? dashboardExams : exams).filter((exam) => exam.status === "Pending Review"), [dashboardExams, exams]);
  const approved = useMemo(() => (hasSupabaseConfig ? dashboardExams : exams).filter((exam) => exam.status === "Approved" || exam.status === "Published"), [dashboardExams, exams]);
  const rejected = useMemo(() => (hasSupabaseConfig ? dashboardExams : exams).filter((exam) => exam.status === "Rejected"), [dashboardExams, exams]);

  async function handleApprove(examId) {
    setLoadingActionId(examId);
    await approveExam(examId);
    setLoadingActionId("");
  }

  async function handleReject(examId) {
    setLoadingActionId(examId);
    await rejectExam(examId, "Returned from dashboard: needs correction.");
    setLoadingActionId("");
  }

  const stats = [
    { label: "Pending Exam Reviews", value: liveStats?.pending ?? pending.length, icon: FiInbox },
    { label: "Approved Exams", value: liveStats?.approved ?? approved.length, icon: FiCheckCircle },
    { label: "Rejected Exams", value: liveStats?.rejected ?? rejected.length, icon: FiXCircle },
    { label: "Total Reviews", value: liveStats?.reviews ?? reviews.length, icon: FiFileText },
    { label: "Reports Generated", value: liveStats?.reports ?? reportsGenerated, icon: FiFileText },
    { label: "New Messages", value: liveStats?.messages ?? messages.reduce((sum, item) => sum + item.unread, 0), icon: FiMessageCircle },
  ];

  return (
    <section className="cluster-review-page">
      <header className="cluster-review-header">
        <div>
          <h1>Cluster Professor Dashboard</h1>
          <p>Review submitted examinations, respond to professors, and monitor approval activity.</p>
        </div>
      </header>
      <div className="cluster-kpi-grid">
        {stats.map(({ icon: Icon, label, value }) => (
          <article className="cluster-kpi-card" key={label}>
            <div>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
            <Icon aria-hidden="true" />
          </article>
        ))}
      </div>
      <section className="cluster-review-panel">
        <div className="cluster-panel-title">
          <div>
            <h2>Recent Activity</h2>
            <p>Latest submitted exams and review decisions.</p>
          </div>
        </div>
        <div className="cluster-table-scroll">
          <table className="cluster-review-table">
            <thead>
              <tr>
                <th>Exam Title</th>
                <th>Professor Name</th>
                <th>Course</th>
                <th>Submission Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {dashboardExams.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.examTitle}</strong></td>
                  <td>{row.professorName}</td>
                  <td>{row.course}</td>
                  <td>{row.submittedAt}</td>
                  <td><StatusBadge status={row.status} /></td>
                  <td>
                    <div className="cluster-row-actions">
                      <RowActionMenu
                        actions={[
                          { label: "Review", onClick: () => navigate(`/cluster/exams/${row.id}`) },
                          row.status === "Pending Review" ? { label: loadingActionId === row.id ? "Saving..." : "Approve Exam", disabled: loadingActionId === row.id, onClick: () => handleApprove(row.id) } : null,
                          row.status === "Pending Review" ? { danger: true, label: "Reject", disabled: loadingActionId === row.id, onClick: () => handleReject(row.id) } : null,
                        ]}
                        label={`Actions for ${row.examTitle || "exam"}`}
                        menuId={`cluster-review-actions-${row.id}`}
                        openMenuId={openActionMenuId}
                        rowId={row.id}
                        setOpenMenuId={setOpenActionMenuId}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {!dashboardExams.length ? (
                <tr>
                  <td className="cluster-empty-row" colSpan={6}>No recent review activity yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
