import { createContext, useCallback, useContext, useEffect } from "react";
import { toast } from "sonner";
import { useAuth } from "./AuthContext";
import { clusterExams, clusterMessages, clusterNotifications } from "../data/clusterData";
import useLocalStorageState from "../hooks/useLocalStorageState";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

const ClusterContext = createContext(null);

function today() {
  return new Date().toISOString().slice(0, 10);
}

const initialProfessorExams = [
  { id: "pe-1", clusterExamId: "", title: "12", course: "FRE - 3H", type: "Quiz", period: "Prelim", duration: "12 mins", status: "published", clusterStatus: "approved" },
  { id: "pe-2", clusterExamId: "", title: "321", course: "FRE - 3H", type: "Quiz", period: "Midterm", duration: "21 mins", status: "published", clusterStatus: "approved" },
  { id: "pe-3", clusterExamId: "EX-1001", title: "12", course: "FRE - 3H", type: "Quiz", period: "Prelim", duration: "12 mins", status: "pending", clusterStatus: "pending" },
  { id: "pe-4", clusterExamId: "", title: "d", course: "FRE - 3H", type: "Quiz", period: "Prelim", duration: "12 mins", status: "unpublished", clusterStatus: "approved" },
  { id: "pe-5", clusterExamId: "", title: "das", course: "FRE - 3H", type: "Exam", period: "Prelim", duration: "21 mins", status: "unpublished", clusterStatus: "not submitted" },
  { id: "pe-6", clusterExamId: "", title: "qe", course: "FRE - 3H", type: "Exam", period: "Prelim", duration: "12 mins", status: "unpublished", clusterStatus: "not submitted" },
  { id: "pe-7", clusterExamId: "", title: "Analysis", course: "FRE - 3H", type: "Exam", period: "Prelim", duration: "13 mins", status: "published", clusterStatus: "approved" },
];

function buildClusterExam(exam, clusterExamId) {
  const minutes = Number.parseInt(exam.duration, 10) || 60;

  return {
    id: clusterExamId,
    examTitle: exam.title,
    description: `${exam.type} for ${exam.course}.`,
    course: exam.course,
    professorName: "Dr. Maria Santos",
    professorId: "p-101",
    timeLimit: minutes,
    passingScore: 75,
    examType: exam.type,
    questionsCount: 1,
    status: "Pending Review",
    createdAt: today(),
    submittedAt: today(),
    approvedAt: "",
    rejectedAt: "",
    rejectionReason: "",
    reviewNotes: "",
    sourceProfessorExamId: exam.id,
    questions: [
      {
        id: `${clusterExamId}-q1`,
        questionType: "Multiple Choice",
        questionText: "Sample question for cluster review.",
        choices: ["Option A", "Option B", "Option C", "Option D"],
        correctAnswer: "Option A",
        points: 1,
      },
    ],
  };
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function normalizeClusterStatus(status) {
  const value = String(status || "").toLowerCase();
  if (["pending review", "pending approval", "pending", "submitted"].includes(value)) return "Pending Review";
  if (["approved", "cluster approved"].includes(value)) return "Approved";
  if (value === "rejected") return "Rejected";
  if (["published", "active"].includes(value)) return "Published";
  return status || "Draft";
}

function mapQuestion(question) {
  const choiceItems = Array.isArray(question.choices) ? question.choices : [];
  const choices = choiceItems.map((choice) => typeof choice === "string" ? choice : `${choice.key || ""}${choice.value ? `. ${choice.value}` : ""}`.trim()).filter(Boolean);

  return {
    id: question.id,
    questionType: question.question_type || "Question",
    questionText: question.question_text || "",
    choices,
    correctAnswer: question.correct_answer || (Array.isArray(question.correct_answers) ? question.correct_answers.join(", ") : ""),
    points: question.points || 1,
  };
}

function mapLiveExam(exam, profileMap, questionMap, reviewMap) {
  const course = exam.courses;
  const professor = profileMap.get(exam.professor_id || exam.created_by);
  const reviews = reviewMap.get(exam.id) || [];
  const latestReview = reviews[0];

  return {
    id: exam.id,
    examTitle: exam.exam_title || exam.title || "Untitled exam",
    description: exam.description || exam.course || "",
    course: course?.course_name || exam.course || `${course?.course_code || "Course"} ${course?.section || ""}`.trim(),
    professorName: professor?.full_name || professor?.email || "Professor",
    professorId: exam.professor_id || exam.created_by,
    timeLimit: exam.time_limit || exam.duration || 0,
    passingScore: exam.passing_score || 0,
    examType: exam.exam_type || "Exam",
    questionsCount: exam.questions_count || (questionMap.get(exam.id) || []).length,
    status: normalizeClusterStatus(exam.status),
    createdAt: formatDate(exam.created_at),
    submittedAt: formatDate(exam.submitted_at || exam.created_at),
    approvedAt: formatDate(exam.approved_at),
    rejectedAt: formatDate(exam.rejected_at),
    rejectionReason: latestReview?.decision === "Rejected" ? latestReview.remarks || "" : "",
    reviewNotes: latestReview?.remarks || "",
    questions: questionMap.get(exam.id) || [],
  };
}

function mapNotification(notification) {
  return {
    id: notification.id,
    title: notification.title,
    message: notification.message,
    type: notification.type,
    isRead: Boolean(notification.is_read),
    createdAt: notification.created_at,
  };
}

function updateExamDecisionState(exams, examId, decision, remarks = "") {
  return exams.map((exam) => {
    if (exam.id !== examId) return exam;
    const date = today();

    return {
      ...exam,
      status: decision,
      approvedAt: decision === "Approved" ? date : "",
      rejectedAt: decision === "Rejected" ? date : "",
      rejectionReason: decision === "Rejected" ? remarks : "",
      reviewNotes: remarks || exam.reviewNotes,
    };
  });
}

export function ClusterProvider({ children }) {
  const { user } = useAuth();
  const [exams, setExams] = useLocalStorageState("smartproctor.cluster.exams", clusterExams);
  const [professorExams, setProfessorExams] = useLocalStorageState("smartproctor.professor.exams", initialProfessorExams);
  const [reviews, setReviews] = useLocalStorageState("smartproctor.cluster.reviews", [
    { id: "RV-9001", examId: "EX-1002", examTitle: "Information Assurance Quiz", professorName: "Prof. Daniel Reyes", course: "Information Assurance", reviewDate: "2026-05-30", decision: "Approved", remarks: "Answer key and timing look appropriate." },
    { id: "RV-9002", examId: "EX-1003", examTitle: "Ethics Essay Exam", professorName: "Dr. Elise Tan", course: "Professional Ethics", reviewDate: "2026-05-28", decision: "Rejected", remarks: "Missing instructions and incomplete answer guide." },
  ]);
  const [messages, setMessages] = useLocalStorageState("smartproctor.cluster.messages", clusterMessages);
  const [notifications, setNotifications] = useLocalStorageState("smartproctor.cluster.notifications", clusterNotifications);
  const [reportsGenerated, setReportsGenerated] = useLocalStorageState("smartproctor.cluster.reportsGenerated", 8);

  const loadLiveClusterData = useCallback(async function loadLiveClusterData() {
    if (!hasSupabaseConfig || !user?.id) return;

    const { data: examRows, error: examError } = await supabase
      .from("exams")
      .select("id, title, exam_title, description, course, course_id, professor_id, created_by, time_limit, passing_score, exam_type, questions_count, duration, status, submitted_at, approved_at, rejected_at, created_at, courses(course_name, course_code, section)")
      .order("created_at", { ascending: false })
      .limit(1000);

    if (examError) {
      toast.error(examError.message);
      return;
    }

    const liveExamRows = (examRows || []).filter((exam) => (
      ["Pending Review", "Approved", "Rejected", "Published"].includes(normalizeClusterStatus(exam.status))
    ));
    const examIds = liveExamRows.map((exam) => exam.id);
    const professorIds = [...new Set(liveExamRows.flatMap((exam) => [exam.professor_id, exam.created_by]).filter(Boolean))];

    const [{ data: profileRows, error: profileError }, { data: questionRows, error: questionError }, { data: reviewRows, error: reviewError }, { data: messageRows, error: messageError }, { data: notificationRows, error: notificationError }] = await Promise.all([
      professorIds.length
        ? supabase.from("profiles").select("id, full_name, email").in("id", professorIds)
        : Promise.resolve({ data: [], error: null }),
      examIds.length
        ? supabase.from("exam_questions").select("id, exam_id, question_text, question_type, choices, correct_answer, correct_answers, points").in("exam_id", examIds)
        : Promise.resolve({ data: [], error: null }),
      examIds.length
        ? supabase.from("exam_reviews").select("id, exam_id, decision, remarks, review_date, cluster_professor_id").in("exam_id", examIds).order("review_date", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      supabase.from("messages").select("id, sender_id, receiver_id, message, is_read, created_at").eq("receiver_id", user.id).eq("is_read", false),
      supabase.from("notifications").select("id, title, message, type, is_read, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30),
    ]);

    if (profileError) {
      toast.error(profileError.message);
      return;
    }
    if (questionError) {
      toast.error(questionError.message);
      return;
    }
    if (reviewError) {
      toast.error(reviewError.message);
      return;
    }
    if (messageError) {
      toast.error(messageError.message);
      return;
    }
    if (notificationError) {
      toast.error(notificationError.message);
      return;
    }

    const profileMap = new Map((profileRows || []).map((profile) => [profile.id, profile]));
    const questionMap = (questionRows || []).reduce((items, question) => {
      items.set(question.exam_id, [...(items.get(question.exam_id) || []), mapQuestion(question)]);
      return items;
    }, new Map());
    const reviewMap = (reviewRows || []).reduce((items, review) => {
      items.set(review.exam_id, [...(items.get(review.exam_id) || []), review]);
      return items;
    }, new Map());

    setExams(liveExamRows.map((exam) => mapLiveExam(exam, profileMap, questionMap, reviewMap)));
    setReviews((reviewRows || []).map((review) => {
      const exam = liveExamRows.find((item) => item.id === review.exam_id);
      const mappedExam = exam ? mapLiveExam(exam, profileMap, questionMap, reviewMap) : null;

      return {
        id: review.id,
        examId: review.exam_id,
        examTitle: mappedExam?.examTitle || "Exam",
        professorName: mappedExam?.professorName || "Professor",
        course: mappedExam?.course || "Course",
        reviewDate: formatDate(review.review_date),
        decision: review.decision,
        remarks: review.remarks || "",
      };
    }));
    setMessages([{ id: "live-unread", unread: (messageRows || []).length, lastMessage: "", messages: [] }]);
    setNotifications((notificationRows || []).map(mapNotification));
    setReportsGenerated((reviewRows || []).length);
  }, [setExams, setMessages, setNotifications, setReportsGenerated, setReviews, user?.id]);

  useEffect(() => {
    loadLiveClusterData();
  }, [loadLiveClusterData]);

  useEffect(() => {
    if (!hasSupabaseConfig || !user?.id) return undefined;

    const channel = supabase
      .channel(`cluster-context-live-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "exams" }, () => void loadLiveClusterData())
      .on("postgres_changes", { event: "*", schema: "public", table: "exam_reviews" }, () => void loadLiveClusterData())
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `receiver_id=eq.${user.id}` }, () => void loadLiveClusterData())
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, () => void loadLiveClusterData())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadLiveClusterData, user?.id]);

  function addNotification(title, message, type = "Exam") {
    setNotifications((current) => [{ id: crypto.randomUUID(), title, message, type, isRead: false, createdAt: new Date().toLocaleString() }, ...current]);
  }

  async function notifyClusterProfessors(title, message, type = "Exam") {
    if (!hasSupabaseConfig) {
      addNotification(title, message, type);
      return;
    }

    const { data: clusterRows, error: clusterError } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "Cluster Professor")
      .eq("status", "Active");

    if (clusterError) {
      toast.error(clusterError.message);
      return;
    }

    const rows = (clusterRows || []).map((profile) => ({
      user_id: profile.id,
      title,
      message,
      type,
      is_read: false,
    }));

    if (!rows.length) return;
    const { error } = await supabase.from("notifications").insert(rows);
    if (error) toast.error(error.message);
  }

  async function saveReview(examId, remarks) {
    if (hasSupabaseConfig && user?.id) {
      const { error } = await supabase
        .from("exam_reviews")
        .insert({ exam_id: examId, cluster_professor_id: user.id, decision: "Revision Needed", remarks });

      if (error) {
        toast.error(error.message);
        return;
      }

      await loadLiveClusterData();
      toast.success("Review notes saved");
      return;
    }

    setExams((current) => current.map((exam) => exam.id === examId ? { ...exam, reviewNotes: remarks } : exam));
    toast.success("Review notes saved");
  }

  async function approveExam(examId) {
    if (hasSupabaseConfig && user?.id) {
      const exam = exams.find((item) => item.id === examId);
      const remarks = exam?.reviewNotes || "Approved for publishing.";

      setExams((current) => updateExamDecisionState(current, examId, "Approved", remarks));
      setReviews((items) => [{
        id: `local-${Date.now()}`,
        examId,
        examTitle: exam?.examTitle || "Exam",
        professorName: exam?.professorName || "Professor",
        course: exam?.course || "Course",
        reviewDate: today(),
        decision: "Approved",
        remarks,
      }, ...items]);
      setReportsGenerated((current) => current + 1);

      const { data, error } = await supabase.functions.invoke("review-exam", {
        body: { action: "approve", examId, remarks },
      });

      if (error || data?.error) {
        toast.error(error?.message || data.error);
        await loadLiveClusterData();
        return;
      }

      await loadLiveClusterData();
      toast.success("Exam approved and professor can publish it");
      return;
    }

    setExams((current) => current.map((exam) => {
      if (exam.id !== examId) return exam;
      const updated = { ...exam, status: "Approved", approvedAt: today(), rejectedAt: "", rejectionReason: "" };
      setProfessorExams((items) => items.map((item) => item.clusterExamId === examId ? {
        ...item,
        status: "unpublished",
        clusterStatus: "approved",
      } : item));
      setReviews((items) => [{ id: `RV-${Date.now()}`, examId: exam.id, examTitle: exam.examTitle, professorName: exam.professorName, course: exam.course, reviewDate: today(), decision: "Approved", remarks: exam.reviewNotes || "Approved for publishing." }, ...items]);
      addNotification("Exam approved successfully", `${exam.examTitle} has been approved.`, "Approval");
      toast.success("Exam approved and professor notified");
      return updated;
    }));
  }

  async function rejectExam(examId, reason) {
    if (hasSupabaseConfig && user?.id) {
      const exam = exams.find((item) => item.id === examId);

      setExams((current) => updateExamDecisionState(current, examId, "Rejected", reason));
      setReviews((items) => [{
        id: `local-${Date.now()}`,
        examId,
        examTitle: exam?.examTitle || "Exam",
        professorName: exam?.professorName || "Professor",
        course: exam?.course || "Course",
        reviewDate: today(),
        decision: "Rejected",
        remarks: reason,
      }, ...items]);
      setReportsGenerated((current) => current + 1);

      const { data, error } = await supabase.functions.invoke("review-exam", {
        body: { action: "reject", examId, remarks: reason },
      });

      if (error || data?.error) {
        toast.error(error?.message || data.error);
        await loadLiveClusterData();
        return;
      }

      await loadLiveClusterData();
      toast.success("Exam rejected and feedback was saved");
      return;
    }

    setExams((current) => current.map((exam) => {
      if (exam.id !== examId) return exam;
      const updated = { ...exam, status: "Rejected", rejectedAt: today(), rejectionReason: reason };
      setProfessorExams((items) => items.map((item) => item.clusterExamId === examId ? {
        ...item,
        status: "unpublished",
        clusterStatus: "rejected",
      } : item));
      setReviews((items) => [{ id: `RV-${Date.now()}`, examId: exam.id, examTitle: exam.examTitle, professorName: exam.professorName, course: exam.course, reviewDate: today(), decision: "Rejected", remarks: reason }, ...items]);
      addNotification("Exam rejected successfully", `${exam.examTitle} was rejected with feedback.`, "Rejection");
      toast.success("Exam rejected and professor notified");
      return updated;
    }));
  }

  function submitProfessorExamForApproval(professorExamId) {
    const exam = professorExams.find((item) => item.id === professorExamId);
    if (!exam || exam.status === "pending") return;

    const clusterExamId = exam.clusterExamId || `EX-${Date.now()}`;
    const clusterExam = buildClusterExam(exam, clusterExamId);

    setExams((current) => {
      const exists = current.some((item) => item.id === clusterExamId);
      return exists ? current.map((item) => item.id === clusterExamId ? clusterExam : item) : [clusterExam, ...current];
    });
    setProfessorExams((current) => current.map((item) => item.id === professorExamId ? {
      ...item,
      clusterExamId,
      status: "pending",
      clusterStatus: "pending",
    } : item));
    void notifyClusterProfessors("New exam submitted for review", `${exam.title} is waiting for cluster review.`, "Exam");
    toast.success("Exam submitted to cluster professor");
  }

  function publishProfessorExam(professorExamId) {
    setProfessorExams((current) => current.map((exam) => {
      if (exam.id !== professorExamId) return exam;
      if (exam.clusterStatus !== "approved") {
        toast.error("Cluster approval is required before publishing");
        return exam;
      }
      toast.success("Exam published for students");
      return { ...exam, status: "published" };
    }));
  }

  function sendMessage(conversationId, message) {
    setMessages((current) => current.map((conversation) => conversation.id === conversationId ? {
      ...conversation,
      lastMessage: message,
      messages: [...conversation.messages, { id: crypto.randomUUID(), from: "You", text: message, time: "Now" }],
    } : conversation));
  }

  function markNotification(id) {
    setNotifications((current) => current.map((item) => item.id === id ? { ...item, isRead: true } : item));
  }

  function deleteNotification(id) {
    setNotifications((current) => current.filter((item) => item.id !== id));
  }

  const value = {
    exams,
    professorExams,
    reviews,
    messages,
    notifications,
    reportsGenerated,
    setReportsGenerated,
    refreshClusterData: loadLiveClusterData,
    saveReview,
    approveExam,
    rejectExam,
    submitProfessorExamForApproval,
    publishProfessorExam,
    sendMessage,
    markNotification,
    markAllNotifications: () => setNotifications((current) => current.map((item) => ({ ...item, isRead: true }))),
    deleteNotification,
  };

  return <ClusterContext.Provider value={value}>{children}</ClusterContext.Provider>;
}

export function useCluster() {
  return useContext(ClusterContext);
}
