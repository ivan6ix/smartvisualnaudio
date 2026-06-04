import { useEffect, useMemo, useState } from "react";
import { FiBookOpen, FiChevronDown, FiDownload, FiEye, FiFileText, FiFolder, FiUpload, FiUsers, FiX } from "react-icons/fi";
import { NavLink, Navigate, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { studentCourses, studentGrades, studentMembers } from "../../data/studentData";
import useLocalStorageState from "../../hooks/useLocalStorageState";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

function mapLiveCourse(course) {
  if (!course) return null;
  return {
    id: course.id,
    name: course.course_code || course.name || "Course",
    section: course.course_code && course.section ? `${course.course_code} - ${course.section}` : course.section || "No section",
    courseName: course.course_name || course.courseName || course.name || "Course",
  };
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function formatDurationLabel(duration) {
  return Number(duration) > 0 ? `${duration} min` : "No timer";
}

function isPastDeadline(value) {
  if (!value) return false;
  const deadline = new Date(value);
  return !Number.isNaN(deadline.getTime()) && deadline.getTime() < Date.now();
}

function mapAttempt(attempt) {
  const exam = attempt.exams || {};
  const rawType = exam.exam_type || "Exam";
  const normalizedType = rawType.toLowerCase();
  const type = normalizedType.includes("activity") ? "activity" : normalizedType.includes("quiz") ? "quiz" : "exam";
  return {
    id: attempt.id,
    examId: exam.id,
    title: exam.exam_title || exam.title || "Untitled assessment",
    type,
    label: rawType,
    period: exam.description || "No period",
    score: attempt.score,
    submittedAt: attempt.submitted_at || attempt.created_at || new Date().toISOString(),
    duration: exam.time_limit || exam.duration || 0,
    completed: true,
    source: "attempt",
  };
}

function mapAssessment(exam, attemptByExam = {}) {
  const rawType = exam.exam_type || "Exam";
  const normalizedType = rawType.toLowerCase();
  const type = normalizedType.includes("activity") ? "activity" : normalizedType.includes("quiz") ? "quiz" : "exam";
  const attempt = attemptByExam[exam.id];
  return {
    id: exam.id,
    examId: exam.id,
    title: exam.exam_title || exam.title || "Untitled assessment",
    type,
    label: rawType,
    period: exam.description || "No period",
    status: exam.status || "Published",
    score: attempt?.score,
    submittedAt: attempt?.submittedAt || exam.created_at,
    duration: exam.time_limit || exam.duration || 0,
    completed: Boolean(attempt),
    source: "assessment",
  };
}

function mapMember(enrollment) {
  const profile = enrollment.profiles || {};
  const name = profile.full_name || profile.email || "Unnamed student";
  return {
    id: enrollment.student_id,
    initials: name.slice(0, 1).toUpperCase(),
    name,
    studentNumber: profile.student_number || "No student ID",
  };
}

function mapModule(module) {
  return {
    id: module.id,
    title: module.title,
    type: "module",
    label: "Module",
    period: module.period || module.description || "No period",
    fileName: module.file_name || "",
    filePath: module.file_path || "",
    fileSize: module.file_size || 0,
    mimeType: module.mime_type || "",
    fileUrl: module.signedUrl || "",
    submittedAt: module.created_at,
    archived: Boolean(module.archived),
    score: null,
  };
}

function isMissingModulesTable(error) {
  return error?.code === "42P01" || error?.code === "PGRST205" || error?.message?.includes("course_modules");
}

function isMissingPeriodsTable(error) {
  return error?.code === "42P01" || error?.code === "PGRST205" || error?.message?.includes("course_periods");
}

function isMissingPermitsTable(error) {
  return error?.code === "42P01" || error?.code === "PGRST205" || error?.message?.includes("course_permit");
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "";
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function sanitizePathName(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function canPreview(item) {
  const name = item.fileName?.toLowerCase() || "";
  return item.mimeType?.startsWith("image/") || item.mimeType === "application/pdf" || name.endsWith(".pdf") || name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg");
}

function mapPermitFile(file) {
  return {
    id: file.id,
    type: "permit",
    title: file.file_name,
    fileName: file.file_name,
    filePath: file.file_path,
    fileSize: file.file_size || 0,
    mimeType: file.mime_type || "",
    fileUrl: file.signedUrl || "",
    submittedAt: file.created_at,
  };
}

function StudentMaterialFolder({
  folder,
  isOpen,
  latestPermitRequest,
  onPreview,
  onStart,
  onToggle,
  onUploadPermit,
  uploadingPermit,
}) {
  const permitExpired = Boolean(latestPermitRequest) && isPastDeadline(latestPermitRequest.deadline);
  const permitUploadLocked = !latestPermitRequest || permitExpired || uploadingPermit;

  return (
    <article className={`student-material-folder ${folder.tone} ${isOpen ? "open" : ""}`}>
      <button className="student-material-folder-toggle" onClick={onToggle} type="button">
        <FiFolder />
        <div>
          <strong>{folder.name}</strong>
          <span>{folder.description}</span>
        </div>
        <div className="student-material-folder-tools">
          <Badge tone={folder.items.length ? "blue" : "neutral"}>{folder.items.length}</Badge>
          <FiChevronDown className="student-material-chevron" />
        </div>
      </button>

      {isOpen ? (
        folder.id === "permits" ? (
          <div className="student-material-items student-material-dropdown">
            <section className="student-permit-request-box">
              <FiUpload />
              <div>
                <strong>{latestPermitRequest ? permitExpired ? "Permit request is closed" : "Permit request is open" : "No active permit request"}</strong>
                <span>
                  {latestPermitRequest
                    ? permitExpired
                      ? `Deadline passed: ${formatDate(latestPermitRequest.deadline)}`
                      : `Deadline: ${formatDate(latestPermitRequest.deadline)}`
                    : "Your professor has not requested permit submission yet."}
                </span>
              </div>
              <label className={`student-permit-upload ${permitUploadLocked ? "disabled" : ""}`}>
                <FiUpload />
                {uploadingPermit ? "Uploading..." : permitExpired ? "Closed" : "Upload Permit"}
                <input
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png"
                  disabled={permitUploadLocked}
                  onChange={onUploadPermit}
                  type="file"
                />
              </label>
            </section>
            {folder.items.map((item) => (
              <section key={item.id}>
                <FiFileText />
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.fileName} {item.fileSize ? `- ${formatFileSize(item.fileSize)}` : ""} - Submitted {formatDate(item.submittedAt)}</span>
                </div>
                <div className="student-material-file-actions">
                  {item.fileUrl && canPreview(item) ? (
                    <button onClick={() => onPreview(item)} type="button"><FiEye /> Preview</button>
                  ) : null}
                  {item.fileUrl ? (
                    <a href={item.fileUrl} rel="noreferrer" target="_blank"><FiDownload /> Open</a>
                  ) : null}
                </div>
              </section>
            ))}
            {!folder.items.length ? <div className="student-material-empty">No permit files submitted yet.</div> : null}
          </div>
        ) : folder.items.length ? (
          <div className="student-material-items student-material-dropdown">
            {folder.items.map((item) => (
              <section key={item.id}>
                <FiFileText />
                <div>
                  <strong>{item.title}</strong>
                  <span>
                    {item.type === "module"
                      ? `${item.fileName || item.period} ${item.fileSize ? `- ${formatFileSize(item.fileSize)}` : ""} - Added ${formatDate(item.submittedAt)}`
                      : item.completed
                        ? `${item.period} - Submitted ${formatDate(item.submittedAt)} - ${item.score === null || item.score === undefined ? "Pending score" : `${Number(item.score).toFixed(1)}%`}`
                        : `${item.period} - ${formatDurationLabel(item.duration)} - ${item.status}`}
                  </span>
                </div>
                <div className="student-material-file-actions">
                  {item.fileUrl && canPreview(item) ? (
                    <button onClick={() => onPreview(item)} type="button"><FiEye /> Preview</button>
                  ) : null}
                  {item.fileUrl ? (
                    <a href={item.fileUrl} rel="noreferrer" target="_blank"><FiDownload /> Open</a>
                  ) : null}
                  {item.source === "assessment" && !item.completed ? (
                    <button onClick={() => onStart(item)} type="button">Start</button>
                  ) : null}
                </div>
              </section>
            ))}
          </div>
        ) : <div className="student-material-empty">{folder.description}</div>
      ) : null}
    </article>
  );
}

function StudentPeriodFolder({
  folders,
  isOpen,
  latestPermitRequest,
  onPreview,
  onStart,
  onToggleFolder,
  onTogglePeriod,
  onUploadPermit,
  openFolders,
  period,
  uploadingPermit,
}) {
  return (
    <article className={`student-period-folder ${isOpen ? "open" : ""}`}>
      <button className="student-period-folder-main" onClick={onTogglePeriod} type="button">
        <FiFolder />
        <div>
          <strong>{period.name}</strong>
          <span>Quizzes, exams, activities, modules, and permits for this period.</span>
        </div>
        <Badge tone="blue">{folders.reduce((total, folder) => total + folder.items.length, 0)}</Badge>
        <FiChevronDown className="student-material-chevron" />
      </button>

      {isOpen ? (
        <div className="student-period-folder-body">
          <div className="student-material-list student-period-material-list">
            {folders.map((folder) => (
              <StudentMaterialFolder
                folder={folder}
                isOpen={!!openFolders[`${period.id}-${folder.id}`]}
                key={folder.id}
                latestPermitRequest={latestPermitRequest}
                onPreview={onPreview}
                onStart={onStart}
                onToggle={() => onToggleFolder(period.id, folder.id)}
                onUploadPermit={(event) => onUploadPermit(event, period.name)}
                uploadingPermit={uploadingPermit}
              />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

export default function StudentCourse() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { courseId, tab = "materials" } = useParams();
  const [joinedCourses] = useLocalStorageState("smartproctor.student.courses", studentCourses);
  const courses = [...studentCourses, ...joinedCourses.filter((course) => !studentCourses.some((item) => item.id === course.id))];
  const [liveCourse, setLiveCourse] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [members, setMembers] = useState(studentMembers);
  const [modules, setModules] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [permitRequests, setPermitRequests] = useState([]);
  const [permitFiles, setPermitFiles] = useState([]);
  const [uploadingPermit, setUploadingPermit] = useState(false);
  const [openPeriods, setOpenPeriods] = useState({});
  const [openFolders, setOpenFolders] = useState({});
  const [previewModule, setPreviewModule] = useState(null);
  const course = liveCourse || courses.find((item) => item.id === courseId);
  const grades = hasSupabaseConfig ? attempts.map((attempt) => ({
    id: attempt.id,
    period: attempt.period,
    title: `${attempt.title} - ${attempt.label}`,
    score: Number(attempt.score || 0),
  })) : studentGrades.filter((grade) => grade.courseId === courseId);
  const average = grades.length ? grades.reduce((total, grade) => total + grade.score, 0) / grades.length : 0;
  const materialAssessments = hasSupabaseConfig ? assessments : attempts;
  const quizItems = useMemo(() => materialAssessments.filter((item) => item.type === "quiz"), [materialAssessments]);
  const examItems = useMemo(() => materialAssessments.filter((item) => item.type === "exam"), [materialAssessments]);
  const activityItems = useMemo(() => materialAssessments.filter((item) => item.type === "activity"), [materialAssessments]);
  const latestPermitRequest = permitRequests[0];
  const materialPeriods = useMemo(() => {
    const names = new Set(periods.map((period) => period.name).filter(Boolean));
    materialAssessments.forEach((item) => names.add(item.period || "No period"));
    modules.forEach((module) => names.add(module.period || "No period"));
    permitRequests.forEach((request) => {
      if (request.period) names.add(request.period);
    });

    const savedNames = new Set(periods.map((period) => period.name));
    const generatedPeriods = [...names]
      .filter((name) => !savedNames.has(name))
      .map((name) => ({ id: `period-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "default"}`, name, generated: true }));

    return [...periods, ...generatedPeriods];
  }, [materialAssessments, modules, periods, permitRequests]);
  const foldersByPeriod = useMemo(() => {
    const byPeriod = {};
    materialPeriods.forEach((period) => {
      const periodName = period.name;
      byPeriod[period.id] = [
        { id: "quizzes", name: "Quizzes", description: "Available quizzes will appear here.", tone: "blue", items: quizItems.filter((item) => item.period === periodName) },
        { id: "exams", name: "Exams", description: "Available exams will appear here.", tone: "red", items: examItems.filter((item) => item.period === periodName) },
        { id: "activities", name: "Activities", description: "Available activities will appear here.", tone: "green", items: activityItems.filter((item) => item.period === periodName) },
        { id: "modules", name: "Modules", description: "Module reviewers from your professor will appear here.", tone: "purple", items: modules.filter((item) => item.period === periodName) },
        { id: "permits", name: "Permit", description: "Permit requests and your submitted permit files will appear here.", tone: "amber", items: permitFiles },
      ];
    });
    return byPeriod;
  }, [activityItems, examItems, materialPeriods, modules, permitFiles, quizItems]);

  useEffect(() => {
    if (!hasSupabaseConfig || !user?.id || !courseId) return;

    async function loadCourseDetails() {
      const [{ data: enrollmentRows, error: enrollmentError }, { data: attemptRows, error: attemptError }, { data: assessmentRows, error: assessmentError }, { data: memberRows, error: memberError }, { data: moduleRows, error: moduleError }, { data: periodRows, error: periodError }, { data: permitRequestRows, error: permitRequestError }, { data: permitFileRows, error: permitFileError }] = await Promise.all([
        supabase
          .from("course_enrollments")
          .select("course_id, courses(id, course_name, course_code, section)")
          .eq("student_id", user.id)
          .eq("course_id", courseId)
          .maybeSingle(),
        supabase
          .from("exam_attempts")
          .select("id, score, submitted_at, exams!inner(id, title, exam_title, exam_type, description, duration, time_limit, course_id)")
          .eq("student_id", user.id)
          .eq("exams.course_id", courseId)
          .order("submitted_at", { ascending: false }),
        supabase
          .from("exams")
          .select("id, title, exam_title, exam_type, description, duration, time_limit, status, created_at")
          .eq("course_id", courseId)
          .in("status", ["Published", "published", "Active", "active"])
          .order("created_at", { ascending: false }),
        supabase
          .from("course_enrollments")
          .select("student_id, profiles:student_id(full_name, student_number, email)")
          .eq("course_id", courseId)
          .order("joined_at", { ascending: true }),
        supabase
          .from("course_modules")
          .select("*")
          .eq("course_id", courseId)
          .order("created_at", { ascending: false }),
        supabase
          .from("course_periods")
          .select("id, name, created_at")
          .eq("course_id", courseId)
          .order("created_at", { ascending: true }),
        supabase
          .from("course_permit_requests")
          .select("*")
          .eq("course_id", courseId)
          .order("created_at", { ascending: false }),
        supabase
          .from("course_permit_files")
          .select("*")
          .eq("course_id", courseId)
          .eq("student_id", user.id)
          .order("created_at", { ascending: false }),
      ]);

      if (enrollmentError) {
        toast.error(enrollmentError.message);
      } else {
        setLiveCourse(mapLiveCourse(enrollmentRows?.courses));
      }

      if (attemptError?.message?.includes("submitted_at")) {
        const { data: fallbackAttemptRows, error: fallbackAttemptError } = await supabase
          .from("exam_attempts")
          .select("id, score, exams!inner(id, title, exam_title, exam_type, description, duration, time_limit, course_id)")
          .eq("student_id", user.id)
          .eq("exams.course_id", courseId);

        if (fallbackAttemptError) {
          toast.error(fallbackAttemptError.message);
        } else {
          const mappedAttempts = (fallbackAttemptRows || []).map(mapAttempt);
          setAttempts(mappedAttempts);
          const attemptByExam = mappedAttempts.reduce((items, attempt) => ({ ...items, [attempt.examId]: attempt }), {});
          setAssessments((assessmentRows || []).map((assessment) => mapAssessment(assessment, attemptByExam)));
        }
      } else if (attemptError) {
        toast.error(attemptError.message);
      } else {
        const mappedAttempts = (attemptRows || []).map(mapAttempt);
        setAttempts(mappedAttempts);
        const attemptByExam = mappedAttempts.reduce((items, attempt) => ({ ...items, [attempt.examId]: attempt }), {});
        setAssessments((assessmentRows || []).map((assessment) => mapAssessment(assessment, attemptByExam)));
      }

      if (assessmentError) {
        toast.error(assessmentError.message);
        setAssessments([]);
      }

      if (memberError) {
        toast.error(memberError.message);
      } else {
        setMembers((memberRows || []).map(mapMember));
      }

      if (moduleError && !isMissingModulesTable(moduleError)) {
        toast.error(moduleError.message);
      } else {
        const modulesWithUrls = await Promise.all((moduleRows || []).map(async (module) => {
          if (!module.file_path) return module;
          const { data: signed } = await supabase.storage.from("course-modules").createSignedUrl(module.file_path, 60 * 60);
          return { ...module, signedUrl: signed?.signedUrl || "" };
        }));
        setModules(modulesWithUrls.map(mapModule).filter((module) => !module.archived));
      }

      if (periodError && !isMissingPeriodsTable(periodError)) {
        toast.error(periodError.message);
      } else {
        setPeriods((periodRows || []).map((period) => ({
          id: period.id,
          name: period.name,
          createdAt: period.created_at,
        })));
      }

      if (permitRequestError && !isMissingPermitsTable(permitRequestError)) {
        toast.error(permitRequestError.message);
      } else {
        setPermitRequests(permitRequestRows || []);
      }

      if (permitFileError && !isMissingPermitsTable(permitFileError)) {
        toast.error(permitFileError.message);
      } else {
        const permitsWithUrls = await Promise.all((permitFileRows || []).map(async (file) => {
          const { data: signed } = await supabase.storage.from("course-permits").createSignedUrl(file.file_path, 60 * 60);
          return { ...file, signedUrl: signed?.signedUrl || "" };
        }));
        setPermitFiles(permitsWithUrls.map(mapPermitFile));
      }
    }

    loadCourseDetails();
  }, [courseId, user?.id]);

  if (!course) return <Navigate to="/student" replace />;

  function togglePeriod(periodId) {
    setOpenPeriods((current) => ({ ...current, [periodId]: !current[periodId] }));
  }

  function toggleFolder(periodId, folderId) {
    const key = `${periodId}-${folderId}`;
    setOpenFolders((current) => ({ ...current, [key]: !current[key] }));
  }

  function openPeriodPermitFolder(periodName) {
    const targetPeriod = materialPeriods.find((item) => item.name === periodName);
    if (!targetPeriod) return;
    setOpenPeriods((current) => ({ ...current, [targetPeriod.id]: true }));
    setOpenFolders((current) => ({ ...current, [`${targetPeriod.id}-permits`]: true }));
  }

  async function uploadPermitFile(event, periodName = "") {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!latestPermitRequest) {
      toast.error("No permit request is active for this course.");
      return;
    }
    if (isPastDeadline(latestPermitRequest.deadline)) {
      toast.error("Permit submission deadline has passed.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Permit file must be 10MB or smaller.");
      return;
    }

    setUploadingPermit(true);
    try {
      const path = `${user.id}/${courseId}/${latestPermitRequest.id}/${crypto.randomUUID()}-${sanitizePathName(file.name)}`;
      const { error: uploadError } = await supabase.storage.from("course-permits").upload(path, file, { upsert: false });
      if (uploadError) throw uploadError;

      const { data, error } = await supabase
        .from("course_permit_files")
        .insert({
          request_id: latestPermitRequest.id,
          course_id: courseId,
          student_id: user.id,
          file_name: file.name,
          file_path: path,
          file_size: file.size,
          mime_type: file.type || "application/octet-stream",
        })
        .select("*")
        .single();
      if (error) throw error;

      const { data: signed } = await supabase.storage.from("course-permits").createSignedUrl(path, 60 * 60);
      setPermitFiles((current) => [mapPermitFile({ ...data, signedUrl: signed?.signedUrl || "" }), ...current]);
      openPeriodPermitFolder(periodName);
      toast.success("Permit uploaded.");
    } catch (error) {
      toast.error(isMissingPermitsTable(error) ? "Run the permit tables SQL first." : error.message);
    } finally {
      setUploadingPermit(false);
    }
  }

  return (
    <section className="student-page">
      <div className="student-course-heading">
        <h1>{course.name}</h1>
        <p>{course.section}</p>
      </div>

      <div className="student-course-layout">
        <aside className="student-course-menu">
          <NavLink to={`/student/courses/${course.id}/materials`}><FiBookOpen /> Materials</NavLink>
          <NavLink to={`/student/courses/${course.id}/grades`}><FiFolder /> Grades</NavLink>
          <NavLink to={`/student/courses/${course.id}/members`}><FiUsers /> Members</NavLink>
        </aside>

        {tab === "materials" ? (
          <section className="student-card student-course-panel">
            <h2>Materials</h2>
            <p>Period folders from your professor will show quizzes, exams, activities, modules, and permits here.</p>
            <div className="student-period-list">
              {materialPeriods.length ? materialPeriods.map((period) => (
                <StudentPeriodFolder
                  folders={foldersByPeriod[period.id] || []}
                  isOpen={!!openPeriods[period.id]}
                  key={period.id}
                  latestPermitRequest={latestPermitRequest}
                  onPreview={setPreviewModule}
                  onStart={(item) => navigate(`/student/exams/${item.examId}`)}
                  onToggleFolder={toggleFolder}
                  onTogglePeriod={() => togglePeriod(period.id)}
                  onUploadPermit={uploadPermitFile}
                  openFolders={openFolders}
                  period={period}
                  uploadingPermit={uploadingPermit}
                />
              )) : (
                <div className="student-period-empty">
                  No period folders yet.
                </div>
              )}
            </div>
          </section>
        ) : null}

        {tab === "grades" ? (
          <section className="student-card student-course-panel">
            <div className="student-card-title">
              <div>
                <h2>Course Grades</h2>
                <p>Exams and scores for this course.</p>
              </div>
              <span className="student-grade-pill">Course Grade: {average.toFixed(1)}%</span>
            </div>
            <div className="student-course-grade-list">
              {grades.map((grade) => (
                <article className="student-grade-row" key={grade.id}>
                  <div>
                    <strong>{grade.period}</strong>
                    <span>{grade.title}</span>
                  </div>
                  <b>{grade.score}%</b>
                  <div className="student-progress"><span style={{ width: `${grade.score}%` }} /></div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {tab === "members" ? (
          <section className="student-card student-course-panel">
            <h2>Members</h2>
            <p>Students enrolled in this course.</p>
            <div className="student-member-list">
              {members.map((member) => (
                <article key={member.id}>
                  <i>{member.initials}</i>
                  <div>
                    <strong>{member.name}</strong>
                    <span>{member.studentNumber || member.id}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {previewModule ? (
        <div className="module-preview-backdrop" onClick={() => setPreviewModule(null)} role="presentation">
          <section className="module-preview-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <header>
              <div>
                <h2>{previewModule.title}</h2>
                <p>{previewModule.fileName || previewModule.period}</p>
              </div>
              <button aria-label="Close preview" onClick={() => setPreviewModule(null)} type="button"><FiX /></button>
            </header>
            <div className="module-preview-body">
              {previewModule.mimeType?.startsWith("image/") ? (
                <img alt={previewModule.title} src={previewModule.fileUrl} />
              ) : (
                <iframe src={previewModule.fileUrl} title={previewModule.title} />
              )}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
