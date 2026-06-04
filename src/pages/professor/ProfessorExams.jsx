import { useCallback, useEffect, useMemo, useState } from "react";
import { FiEdit2, FiGrid, FiPlus, FiUser, FiUsers, FiX } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useCluster } from "../../context/ClusterContext";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

function normalizeStatus(status) {
  const value = String(status || "Draft").toLowerCase();
  if (["published", "active"].includes(value)) return "published";
  if (["pending review", "pending", "submitted"].includes(value)) return "pending";
  return "unpublished";
}

function getClusterStatus(exam) {
  const status = String(exam.status || "").toLowerCase();
  if (exam.clusterStatus) return exam.clusterStatus;
  if (exam.approved_at || ["approved", "published", "active"].includes(status)) return "approved";
  if (exam.rejected_at || status === "rejected") return "rejected";
  if (["pending review", "pending", "submitted"].includes(status)) return "pending";
  return "not submitted";
}

function getStatusLabel(exam) {
  if (exam.status === "pending") return "pending approval";
  if (exam.status === "unpublished" && exam.clusterStatus === "rejected") return "rejected by cluster";
  if (exam.status === "unpublished" && exam.clusterStatus === "approved") return "approved by cluster";
  if (exam.status === "unpublished" && exam.clusterStatus === "not submitted") return "not submitted";
  return exam.status;
}

function getPublishGateLabel(exam) {
  if (exam.clusterStatus === "rejected") return "Rejected";
  return "Awaiting Approval";
}

function getApprovalActionLabel(exam) {
  if (exam.status === "pending") return "Submitted";
  if (exam.clusterStatus === "approved") return "Cluster Approved";
  return exam.clusterStatus === "rejected" ? "Resubmit for Approval" : "Submit for Approval";
}

const initialSectionFilters = {
  published: { search: "", course: "All Courses", type: "All Types", period: "All Periods" },
  pending: { search: "", course: "All Courses", type: "All Types", period: "All Periods" },
  unpublished: { search: "", course: "All Courses", type: "All Types", period: "All Periods" },
};

function mapExam(row, reviewByExam = {}) {
  const course = row.courses;
  const duration = row.time_limit || row.duration || 0;
  const latestReview = reviewByExam[row.id];
  return {
    id: row.id,
    courseId: row.course_id,
    courseCode: course?.course_code || "",
    section: course?.section || "",
    title: row.exam_title || row.title || "Untitled exam",
    course: course?.course_code && course?.section ? `${course.course_code} - ${course.section}` : row.course || course?.course_name || "Unassigned course",
    type: row.exam_type || "Exam",
    period: row.description || row.period || "Prelim",
    duration: `${duration} min${Number(duration) === 1 ? "" : "s"}`,
    status: normalizeStatus(row.status),
    clusterStatus: getClusterStatus(row),
    rejectionReason: latestReview?.remarks || "",
  };
}

export default function ProfessorExams() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { professorExams, publishProfessorExam, submitProfessorExamForApproval } = useCluster();
  const [shareExam, setShareExam] = useState(null);
  const [shareMode, setShareMode] = useState("");
  const [shareCourses, setShareCourses] = useState([]);
  const [shareStudents, setShareStudents] = useState([]);
  const [liveExams, setLiveExams] = useState([]);
  const [loadingActionId, setLoadingActionId] = useState("");
  const [sharingTargetId, setSharingTargetId] = useState("");
  const [sectionFilters, setSectionFilters] = useState(initialSectionFilters);
  const exams = hasSupabaseConfig ? liveExams : professorExams;
  const publishedExams = useMemo(() => exams.filter((exam) => exam.status === "published"), [exams]);
  const pendingExams = useMemo(() => exams.filter((exam) => exam.status === "pending"), [exams]);
  const unpublishedExams = useMemo(() => exams.filter((exam) => exam.status === "unpublished"), [exams]);

  function updateSectionFilter(sectionKey, key, value) {
    setSectionFilters((current) => ({
      ...current,
      [sectionKey]: { ...current[sectionKey], [key]: value },
    }));
  }

  function getFilterOptions(rows, key) {
    return [...new Set(rows.map((row) => row[key]).filter(Boolean))].sort((first, second) => first.localeCompare(second));
  }

  function filterSectionRows(rows, sectionKey) {
    const filters = sectionFilters[sectionKey];
    return rows.filter((exam) => {
      const matchesSearch = `${exam.title} ${exam.course} ${exam.type} ${exam.period} ${exam.duration}`.toLowerCase().includes(filters.search.toLowerCase());
      const matchesCourse = filters.course === "All Courses" || exam.course === filters.course;
      const matchesType = filters.type === "All Types" || exam.type === filters.type;
      const matchesPeriod = filters.period === "All Periods" || exam.period === filters.period;
      return matchesSearch && matchesCourse && matchesType && matchesPeriod;
    });
  }

  const loadExams = useCallback(async function loadExams() {
    if (!hasSupabaseConfig || !user?.id) return;

    const { data, error } = await supabase
      .from("exams")
      .select("id, title, exam_title, course_id, description, course, exam_type, duration, time_limit, status, submitted_at, approved_at, rejected_at, courses(course_name, course_code, section)")
      .or(`professor_id.eq.${user.id},created_by.eq.${user.id}`)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error(error.message);
      return;
    }

    const examRows = data || [];
    const examIds = examRows.map((exam) => exam.id);
    let reviewByExam = {};

    if (examIds.length) {
      const { data: reviewRows, error: reviewError } = await supabase
        .from("exam_reviews")
        .select("exam_id, remarks, decision, review_date")
        .in("exam_id", examIds)
        .eq("decision", "Rejected")
        .order("review_date", { ascending: false });

      if (!reviewError) {
        reviewByExam = (reviewRows || []).reduce((items, review) => (
          items[review.exam_id] ? items : { ...items, [review.exam_id]: review }
        ), {});
      }
    }

    setLiveExams(examRows.map((exam) => mapExam(exam, reviewByExam)));
  }, [user?.id]);

  useEffect(() => {
    loadExams();
  }, [loadExams]);

  useEffect(() => {
    if (!shareExam || !hasSupabaseConfig || !user?.id) return;

    async function loadShareTargets() {
      const { data: courseRows, error: courseError } = await supabase
        .from("courses")
        .select("id, course_name, course_code, section")
        .eq("professor_id", user.id)
        .eq("archived", false)
        .order("course_code", { ascending: true });

      if (courseError) {
        toast.error(courseError.message);
      } else {
        setShareCourses(courseRows || []);
      }

      if (!shareExam.courseId) {
        setShareStudents([]);
        return;
      }

      const { data: studentRows, error: studentError } = await supabase
        .from("course_enrollments")
        .select("student_id, profiles:student_id(full_name, student_number, email)")
        .eq("course_id", shareExam.courseId)
        .order("joined_at", { ascending: true });

      if (studentError) {
        toast.error(studentError.message);
      } else {
        setShareStudents(studentRows || []);
      }
    }

    loadShareTargets();
  }, [shareExam, user?.id]);

  function closeShareModal() {
    setShareExam(null);
    setShareMode("");
    setShareCourses([]);
    setShareStudents([]);
    setSharingTargetId("");
  }

  async function updateExamStatus(exam, payload, successMessage) {
    if (!hasSupabaseConfig) return;
    setLoadingActionId(exam.id);

    try {
      const { error } = await supabase
        .from("exams")
        .update(payload)
        .eq("id", exam.id);

      if (error) throw error;
      toast.success(successMessage);
      await loadExams();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoadingActionId("");
    }
  }

  async function notifyClusterExamSubmitted(exam) {
    const { data: clusterRows, error: clusterError } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "Cluster Professor")
      .eq("status", "Active");

    if (clusterError) throw clusterError;

    const rows = (clusterRows || []).map((profile) => ({
      user_id: profile.id,
      title: "New exam submitted for review",
      message: `${exam.title} is waiting for cluster review.`,
      type: "Exam",
      is_read: false,
    }));

    if (rows.length) {
      const { error } = await supabase.from("notifications").insert(rows);
      if (error) throw error;
    }
  }

  async function handleSubmitForApproval(exam) {
    if (!hasSupabaseConfig) {
      submitProfessorExamForApproval(exam.id);
      return;
    }

    setLoadingActionId(exam.id);
    try {
      const { error } = await supabase
        .from("exams")
        .update({
          status: "Pending Review",
          submitted_at: new Date().toISOString(),
          approved_at: null,
          rejected_at: null,
        })
        .eq("id", exam.id);

      if (error) throw error;
      await notifyClusterExamSubmitted(exam);
      toast.success("Exam submitted to cluster professor");
      await loadExams();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoadingActionId("");
    }
  }

  function handlePublish(exam) {
    if (!hasSupabaseConfig) {
      publishProfessorExam(exam.id);
      return;
    }

    if (exam.clusterStatus !== "approved") {
      toast.error("Cluster approval is required before publishing");
      return;
    }

    updateExamStatus(exam, { status: "Published" }, "Exam published for students");
  }

  function handleUnpublish(exam) {
    updateExamStatus(exam, { status: "Approved" }, "Exam unpublished");
  }

  async function duplicateExamToCourse(targetCourse) {
    if (!shareExam || !targetCourse || !hasSupabaseConfig || !user?.id) return;
    setSharingTargetId(targetCourse.id);

    try {
      const { data: sourceExam, error: examError } = await supabase
        .from("exams")
        .select("title, exam_title, description, semester, exam_type, duration, time_limit, exam_settings, questions_count")
        .eq("id", shareExam.id)
        .maybeSingle();

      if (examError) throw examError;
      if (!sourceExam) throw new Error("Exam not found.");

      const { data: questionRows, error: questionError } = await supabase
        .from("exam_questions")
        .select("question_text, question_type, choices, correct_answer, correct_answers, question_config, manual_grading, points")
        .eq("exam_id", shareExam.id)
        .order("id", { ascending: true });

      if (questionError) throw questionError;

      const duration = sourceExam.time_limit || sourceExam.duration || null;
      const { data: newExam, error: insertError } = await supabase
        .from("exams")
        .insert({
          course_id: targetCourse.id,
          title: sourceExam.title,
          exam_title: sourceExam.exam_title || sourceExam.title,
          description: sourceExam.description,
          semester: sourceExam.semester,
          course: `${targetCourse.course_code} - ${targetCourse.section}`,
          professor_id: user.id,
          created_by: user.id,
          exam_type: sourceExam.exam_type,
          duration,
          time_limit: duration,
          exam_settings: sourceExam.exam_settings || {},
          questions_count: questionRows?.length || sourceExam.questions_count || 0,
          status: "Published",
          approved_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (insertError) throw insertError;

      if (questionRows?.length) {
        const { error: copyQuestionsError } = await supabase.from("exam_questions").insert(questionRows.map((question) => ({
          ...question,
          exam_id: newExam.id,
        })));
        if (copyQuestionsError) throw copyQuestionsError;
      }

      toast.success(`Exam shared to ${targetCourse.course_code} - ${targetCourse.section}`);
      await loadExams();
      closeShareModal();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSharingTargetId("");
    }
  }

  async function shareToStudent(enrollment) {
    if (!shareExam || !enrollment?.student_id || !hasSupabaseConfig) return;
    setSharingTargetId(enrollment.student_id);

    try {
      const { error } = await supabase.from("notifications").insert({
        user_id: enrollment.student_id,
        title: "Exam Shared",
        message: `${shareExam.title} was shared with you for ${shareExam.course}.`,
        type: "Exam",
        is_read: false,
      });

      if (error) throw error;
      toast.success(`Exam shared to ${enrollment.profiles?.full_name || enrollment.profiles?.email || "student"}`);
      closeShareModal();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSharingTargetId("");
    }
  }

  const shareCourseTargets = shareCourses.filter((course) => course.id !== shareExam?.courseId);
  const shareSectionTargets = shareCourseTargets.filter((course) => (
    shareExam?.courseCode ? course.course_code === shareExam.courseCode : true
  ));

  function getSharePanel() {
    if (shareMode === "courses") {
      return {
        title: "Share to Other Courses",
        empty: "No other courses available.",
        rows: shareCourseTargets.map((course) => ({
          id: course.id,
          label: `${course.course_code} - ${course.section}`,
          detail: course.course_name,
          action: () => duplicateExamToCourse(course),
        })),
      };
    }

    if (shareMode === "sections") {
      return {
        title: "Share to Other Section",
        empty: "No other sections available.",
        rows: shareSectionTargets.map((course) => ({
          id: course.id,
          label: `${course.course_code} - ${course.section}`,
          detail: course.course_name,
          action: () => duplicateExamToCourse(course),
        })),
      };
    }

    if (shareMode === "students") {
      return {
        title: "Share to Specific Student",
        empty: "No enrolled students available.",
        rows: shareStudents.map((enrollment) => ({
          id: enrollment.student_id,
          label: enrollment.profiles?.full_name || enrollment.profiles?.email || "Unnamed student",
          detail: enrollment.profiles?.student_number || enrollment.profiles?.email || "",
          action: () => shareToStudent(enrollment),
        })),
      };
    }

    return null;
  }

  function renderExamSection(sectionKey, title, description, rows) {
    const filteredRows = filterSectionRows(rows, sectionKey);
    const filters = sectionFilters[sectionKey];
    const courseOptions = getFilterOptions(rows, "course");
    const typeOptions = getFilterOptions(rows, "type");
    const periodOptions = getFilterOptions(rows, "period");

    return (
      <section className="professor-exams-section">
        <div className="professor-exams-section-header">
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <span>{filteredRows.length}</span>
        </div>

        <div className="professor-exam-section-filters">
          <input
            aria-label={`Search ${title}`}
            onChange={(event) => updateSectionFilter(sectionKey, "search", event.target.value)}
            placeholder="Search title, course, type, or period"
            value={filters.search}
          />
          <select aria-label={`${title} course filter`} onChange={(event) => updateSectionFilter(sectionKey, "course", event.target.value)} value={filters.course}>
            <option>All Courses</option>
            {courseOptions.map((course) => <option key={course}>{course}</option>)}
          </select>
          <select aria-label={`${title} type filter`} onChange={(event) => updateSectionFilter(sectionKey, "type", event.target.value)} value={filters.type}>
            <option>All Types</option>
            {typeOptions.map((type) => <option key={type}>{type}</option>)}
          </select>
          <select aria-label={`${title} period filter`} onChange={(event) => updateSectionFilter(sectionKey, "period", event.target.value)} value={filters.period}>
            <option>All Periods</option>
            {periodOptions.map((period) => <option key={period}>{period}</option>)}
          </select>
        </div>

        <div className="professor-exams-table-card">
          <table className="professor-exams-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Course</th>
                <th>Type</th>
                <th>Period</th>
                <th>Duration</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((exam) => (
                <tr key={exam.id}>
                  <td>
                    <strong>{exam.title}</strong>
                    {exam.clusterStatus === "rejected" && exam.rejectionReason ? (
                      <small className="professor-rejection-note">Reason: {exam.rejectionReason}</small>
                    ) : null}
                  </td>
                  <td>{exam.course}</td>
                  <td>{exam.type}</td>
                  <td>{exam.period}</td>
                  <td>{exam.duration}</td>
                  <td>
                    <div className="professor-status-stack">
                      <span className={`professor-status-pill ${exam.status} ${exam.clusterStatus.replaceAll(" ", "-")}`}>
                        {getStatusLabel(exam)}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="professor-exam-actions">
                      {exam.status === "published" ? <button className="danger" disabled={loadingActionId === exam.id} onClick={() => handleUnpublish(exam)}>Unpublish</button> : null}
                      {exam.status === "unpublished" && exam.clusterStatus === "rejected" ? (
                        <button disabled={loadingActionId === exam.id} onClick={() => navigate(`/professor/exams/create?editId=${exam.id}`)}>
                          <FiEdit2 /> Edit
                        </button>
                      ) : null}
                      {exam.status === "unpublished" && exam.clusterStatus === "approved" ? <button disabled={loadingActionId === exam.id} onClick={() => handlePublish(exam)}>Publish</button> : null}
                      {exam.status === "unpublished" && exam.clusterStatus !== "approved" ? <button className="locked" disabled>{getPublishGateLabel(exam)}</button> : null}
                      {exam.status === "pending" ? <button className="muted">View</button> : null}
                      <button
                        className={exam.status === "pending" || exam.clusterStatus === "approved" ? "approval submitted" : "approval"}
                        disabled={exam.status === "pending" || exam.clusterStatus === "approved" || loadingActionId === exam.id}
                        onClick={() => handleSubmitForApproval(exam)}
                      >
                        {loadingActionId === exam.id ? "Saving..." : getApprovalActionLabel(exam)}
                      </button>
                      <button
                        className={exam.status === "pending" ? "share-disabled" : ""}
                        disabled={exam.status === "pending"}
                        onClick={() => setShareExam(exam)}
                      >
                        Share
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filteredRows.length ? <div className="professor-exams-empty">{rows.length ? "No exams match your filters." : "No exams in this section."}</div> : null}
        </div>
      </section>
    );
  }

  return (
    <section className="professor-exams-page">
      <div className="professor-exams-header">
        <div>
          <h1>Exams</h1>
          <p>Create, publish, unpublish, share, and manage your exams.</p>
        </div>
        <Button className="professor-create-exam" onClick={() => navigate("/professor/exams/create")}><FiPlus /> Create Exam</Button>
      </div>

      {renderExamSection("published", "Published Exams", "Exams currently available to students.", publishedExams)}
      {renderExamSection("pending", "Pending for Approval", "Exams waiting for cluster professor review.", pendingExams)}
      {renderExamSection("unpublished", "Unpublished Exams", "Drafts and hidden exams that are not visible to students.", unpublishedExams)}

      {shareExam ? (
        <div className="professor-share-backdrop" onClick={closeShareModal} role="presentation">
          <section
            aria-labelledby="professor-share-title"
            aria-modal="true"
            className="professor-share-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="professor-share-header">
              <div>
                <h2 id="professor-share-title">{shareMode ? getSharePanel()?.title : "Share Exam"}</h2>
                <p>{shareExam.title} - {shareExam.course}</p>
              </div>
              <button aria-label="Close share options" onClick={closeShareModal} type="button">
                <FiX />
              </button>
            </div>

            {!shareMode ? (
              <div className="professor-share-options">
                <button onClick={() => setShareMode("courses")} type="button">
                  <FiUsers />
                  <span>Share to other courses</span>
                </button>
                <button onClick={() => setShareMode("sections")} type="button">
                  <FiGrid />
                  <span>Share to other section</span>
                </button>
                <button onClick={() => setShareMode("students")} type="button">
                  <FiUser />
                  <span>Share to specific student</span>
                </button>
              </div>
            ) : (
              <div className="professor-share-targets">
                <button className="professor-share-back" onClick={() => setShareMode("")} type="button">Back</button>
                {getSharePanel()?.rows.length ? getSharePanel().rows.map((row) => (
                  <article key={row.id}>
                    <div>
                      <strong>{row.label}</strong>
                      {row.detail ? <span>{row.detail}</span> : null}
                    </div>
                    <button disabled={sharingTargetId === row.id} onClick={row.action} type="button">
                      {sharingTargetId === row.id ? "Sharing..." : "Share"}
                    </button>
                  </article>
                )) : <div className="professor-share-empty">{getSharePanel()?.empty}</div>}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
