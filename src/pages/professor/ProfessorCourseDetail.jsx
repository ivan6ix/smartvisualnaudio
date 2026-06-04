import { useEffect, useMemo, useState } from "react";
import { FiArchive, FiBookOpen, FiChevronDown, FiDownload, FiEye, FiFileText, FiFolder, FiPlus, FiRefreshCw, FiUpload, FiUsers, FiX } from "react-icons/fi";
import { NavLink, Navigate, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Badge, Button } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { professorCourses, professorExams } from "../../data/professorData";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

const examFilterDefaults = {
  search: "",
  period: "All Periods",
  semester: "All Semesters",
  date: "All Dates",
  type: "All Types",
};

const semesterDefaults = ["1st Semester", "2nd Semester", "Summer"];

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString();
}

function normalizeType(type = "Exam") {
  const value = type.toLowerCase();
  if (value.includes("quiz")) return "quiz";
  if (value.includes("activity")) return "activity";
  return "exam";
}

function mapCourse(course) {
  return {
    id: course.id,
    courseName: course.course_name || course.courseName || course.name || "Course",
    courseCode: course.course_code || course.courseCode || course.name || "Course",
    section: course.section || "No section",
    joiningCode: course.joining_code || course.joiningCode || "",
  };
}

function mapExam(exam) {
  return {
    id: exam.id,
    title: exam.exam_title || exam.title || "Untitled assessment",
    type: exam.exam_type || exam.type || "Exam",
    category: normalizeType(exam.exam_type || exam.type),
    period: exam.description || exam.period || "No period",
    semester: exam.semester || "No semester",
    status: exam.status || "Draft",
    duration: exam.time_limit || exam.duration || 0,
    createdAt: exam.created_at || exam.createdAt,
    courseId: exam.course_id || exam.courseId,
  };
}

function mapModule(module) {
  return {
    id: module.id,
    title: module.title,
    description: module.description || "Module reviewer",
    period: module.period || "No period",
    fileName: module.file_name || "",
    filePath: module.file_path || "",
    fileSize: module.file_size || 0,
    mimeType: module.mime_type || "",
    fileUrl: module.signedUrl || "",
    createdAt: module.created_at,
    archived: Boolean(module.archived),
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

function mapAttemptStudent(attempt, fallbackMembers = []) {
  const profile = attempt.profiles || {};
  const fallback = fallbackMembers.find((member) => member.id === attempt.student_id) || {};
  const name = profile.full_name || fallback.name || profile.email || "Unnamed student";
  return {
    id: attempt.student_id,
    name,
    studentNumber: profile.student_number || fallback.studentNumber || "No student ID",
    email: profile.email || "",
  };
}

function isMissingModulesTable(error) {
  return error?.code === "42P01" || error?.code === "PGRST205" || error?.message?.includes("course_modules");
}

function isMissingPeriodsTable(error) {
  return error?.code === "42P01" || error?.code === "PGRST205" || error?.message?.includes("course_periods");
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

function getQuestionConfig(question) {
  return question.question_config && typeof question.question_config === "object" ? question.question_config : {};
}

function getChoiceText(choices = [], key) {
  const choice = choices.find((item) => item.key === key);
  return choice ? `${choice.key}. ${choice.value}` : key;
}

function renderQuestionContent(question) {
  const choices = Array.isArray(question.choices) ? question.choices : [];
  const config = getQuestionConfig(question);
  const correctAnswers = Array.isArray(question.correct_answers) ? question.correct_answers : [];

  if (["Multiple Choice", "Multiple Select"].includes(question.question_type)) {
    return (
      <div className="assessment-question-options">
        {choices.map((choice) => {
          const isCorrect = question.question_type === "Multiple Select"
            ? correctAnswers.includes(choice.key)
            : question.correct_answer === choice.key;
          return (
            <span className={isCorrect ? "correct-option" : ""} key={choice.key}>
              {choice.key}. {choice.value}
            </span>
          );
        })}
      </div>
    );
  }

  if (question.question_type === "True or False") {
    return <p className="assessment-question-answer">Correct answer: {question.correct_answer || "-"}</p>;
  }

  if (["Identification", "Fill in the Blank"].includes(question.question_type)) {
    return <p className="assessment-question-answer">Correct answer: {question.correct_answer || "-"}</p>;
  }

  if (question.question_type === "Enumeration") {
    return (
      <div className="assessment-question-options">
        {correctAnswers.map((answer, index) => <span className="correct-option" key={`${answer}-${index}`}>{answer}</span>)}
      </div>
    );
  }

  if (question.question_type === "Matching Type") {
    return (
      <div className="assessment-question-pairs">
        {(config.pairs || []).map((pair, index) => <span key={`${pair.left}-${index}`}>{pair.left} {"->"} {pair.right}</span>)}
      </div>
    );
  }

  if (question.question_type === "Ordering / Sequencing") {
    return (
      <ol className="assessment-question-sequence">
        {(config.orderItems || correctAnswers).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
      </ol>
    );
  }

  if (question.question_type === "File Upload") {
    return <p className="assessment-question-answer">Manual grading required for uploaded files.</p>;
  }

  if (question.question_type === "Essay") {
    return <p className="assessment-question-answer">Essay question. Manual grading may be required.</p>;
  }

  return correctAnswers.length || question.correct_answer ? (
    <p className="assessment-question-answer">
      Correct answer: {correctAnswers.length ? correctAnswers.map((answer) => getChoiceText(choices, answer)).join(", ") : getChoiceText(choices, question.correct_answer)}
    </p>
  ) : null;
}

function MaterialFolder({ folder, isOpen, onArchive, onOpenAssessment, onOpenArchives, onOpenPermit, onPreview, onToggle }) {
  const handleFolderAction = folder.id === "permits" ? onOpenPermit : onToggle;

  return (
    <article className={`professor-material-folder ${folder.tone} ${isOpen ? "open" : ""}`}>
      <div className="professor-material-folder-toggle">
        <button className="professor-material-folder-main" onClick={handleFolderAction} type="button">
          <FiFolder />
          <div>
            <strong>{folder.name}</strong>
            <span>{folder.description}</span>
          </div>
        </button>
        <div className="professor-material-folder-tools">
          {folder.id === "modules" ? (
            <button className="professor-module-archive-view" onClick={onOpenArchives} type="button">
              <FiArchive /> View Archives
            </button>
          ) : null}
          <Badge tone={folder.items.length ? "blue" : "neutral"}>{folder.items.length}</Badge>
          {folder.id === "permits" ? null : (
            <button aria-label={`${isOpen ? "Close" : "Open"} ${folder.name}`} className="professor-material-chevron-button" onClick={onToggle} type="button">
              <FiChevronDown className="professor-material-chevron" />
            </button>
          )}
        </div>
      </div>

      {isOpen ? (
        folder.items.length ? (
          <div className="professor-material-items professor-material-dropdown">
            {folder.items.map((item) => {
              const details = item.fileName
                ? `${item.fileName} - ${formatFileSize(item.fileSize)} - Added ${formatDate(item.createdAt)}`
                : item.description || `${item.period} - ${formatDate(item.createdAt)} - ${item.status}`;

              return (
                <section
                  className={!item.fileName ? "professor-material-assessment-row" : ""}
                  key={item.id}
                  onClick={!item.fileName ? () => onOpenAssessment(item) : undefined}
                  role={!item.fileName ? "button" : undefined}
                  tabIndex={!item.fileName ? 0 : undefined}
                  onKeyDown={!item.fileName ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenAssessment(item);
                    }
                  } : undefined}
                >
                  <FiFileText />
                  <div>
                    <strong>{item.title}</strong>
                    <span>{details}</span>
                  </div>
                  <div className="professor-material-file-actions">
                    {item.fileUrl && canPreview(item) ? (
                      <button onClick={() => onPreview(item)} type="button"><FiEye /> Preview</button>
                    ) : null}
                    {item.fileUrl ? (
                      <a href={item.fileUrl} rel="noreferrer" target="_blank"><FiDownload /> Open</a>
                    ) : null}
                    {folder.id === "modules" ? (
                      <button onClick={() => onArchive(item)} type="button"><FiArchive /> Archive</button>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        ) : <div className="professor-material-empty">{folder.description}</div>
      ) : null}
    </article>
  );
}

function PeriodFolder({
  period,
  folders,
  isOpen,
  openFolders,
  onArchive,
  onCreateAssessment,
  onOpenArchives,
  onOpenAssessment,
  onOpenPermit,
  onPreview,
  onToggleFolder,
  onTogglePeriod,
  onUploadModule,
  savingModule,
}) {
  return (
    <article className={`professor-period-folder ${isOpen ? "open" : ""}`}>
      <button className="professor-period-folder-main" onClick={onTogglePeriod} type="button">
        <FiFolder />
        <div>
          <strong>{period.name}</strong>
          <span>Quizzes, exams, activities, modules, and permits for this period.</span>
        </div>
        <Badge tone="blue">{folders.reduce((total, folder) => total + folder.items.length, 0)}</Badge>
        <FiChevronDown className="professor-material-chevron" />
      </button>

      {isOpen ? (
        <div className="professor-period-folder-body">
          <div className="professor-material-actions professor-period-actions">
            <button onClick={() => onCreateAssessment("Quiz", period.name)} type="button"><FiPlus /> Quiz</button>
            <button onClick={() => onCreateAssessment("Activity", period.name)} type="button"><FiPlus /> Activity</button>
            <button onClick={() => onCreateAssessment("Exam", period.name)} type="button"><FiPlus /> Exam</button>
            <label className="professor-upload-module">
              <FiUpload />
              {savingModule ? "Uploading..." : "Upload Module"}
              <input disabled={savingModule} onChange={(event) => onUploadModule(event, period.name)} type="file" />
            </label>
          </div>

          <div className="professor-material-list professor-period-material-list">
            {folders.map((folder) => (
              <MaterialFolder
                folder={folder}
                isOpen={!!openFolders[`${period.id}-${folder.id}`]}
                key={folder.id}
                onArchive={onArchive}
                onOpenAssessment={onOpenAssessment}
                onOpenArchives={onOpenArchives}
                onOpenPermit={() => onOpenPermit(period.name)}
                onPreview={onPreview}
                onToggle={() => onToggleFolder(period.id, folder.id)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

export default function ProfessorCourseDetail() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { courseId, tab = "materials" } = useParams();
  const [course, setCourse] = useState(() => professorCourses.map(mapCourse).find((item) => item.id === courseId) || null);
  const [exams, setExams] = useState(() => professorExams.map((exam) => ({
    ...mapExam(exam),
    courseId: professorCourses.find((courseItem) => courseItem.courseName === exam.course && courseItem.section === exam.section)?.id,
  })).filter((exam) => exam.courseId === courseId));
  const [members, setMembers] = useState([]);
  const [modules, setModules] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [savingModule, setSavingModule] = useState(false);
  const [savingPeriod, setSavingPeriod] = useState(false);
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [periodName, setPeriodName] = useState("");
  const [openPeriods, setOpenPeriods] = useState({});
  const [openFolders, setOpenFolders] = useState({});
  const [previewModule, setPreviewModule] = useState(null);
  const [moduleArchiveOpen, setModuleArchiveOpen] = useState(false);
  const [assessmentStats, setAssessmentStats] = useState(null);
  const [questionRoster, setQuestionRoster] = useState(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [examFilters, setExamFilters] = useState(examFilterDefaults);

  useEffect(() => {
    if (!hasSupabaseConfig || !user?.id || !courseId) return;

    async function loadCourseDetail() {
      const { data: courseRow, error: courseError } = await supabase
        .from("courses")
        .select("id, course_name, course_code, section, joining_code")
        .eq("id", courseId)
        .eq("professor_id", user.id)
        .maybeSingle();

      if (courseError) {
        toast.error(courseError.message);
        return;
      }

      if (!courseRow) {
        setNotFound(true);
        return;
      }

      setCourse(mapCourse(courseRow));

      let examRows = [];
      let examError = null;
      const examQuery = supabase
        .from("exams")
        .select("id, title, exam_title, exam_type, description, semester, duration, time_limit, status, created_at, course_id")
        .eq("course_id", courseId)
        .or(`professor_id.eq.${user.id},created_by.eq.${user.id}`)
        .order("created_at", { ascending: false });
      const examResult = await examQuery;
      if (examResult.error?.message?.includes("semester")) {
        const fallbackExamResult = await supabase
          .from("exams")
          .select("id, title, exam_title, exam_type, description, duration, time_limit, status, created_at, course_id")
          .eq("course_id", courseId)
          .or(`professor_id.eq.${user.id},created_by.eq.${user.id}`)
          .order("created_at", { ascending: false });
        examRows = fallbackExamResult.data || [];
        examError = fallbackExamResult.error;
      } else {
        examRows = examResult.data || [];
        examError = examResult.error;
      }

      const [{ data: memberRows, error: memberError }, { data: moduleRows, error: moduleError }, { data: periodRows, error: periodError }] = await Promise.all([
        supabase
          .from("course_enrollments")
          .select("student_id, profiles:student_id(full_name, student_number, email)")
          .eq("course_id", courseId)
          .order("joined_at", { ascending: true }),
        supabase
          .from("course_modules")
          .select("*")
          .eq("course_id", courseId)
          .eq("professor_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("course_periods")
          .select("id, name, created_at")
          .eq("course_id", courseId)
          .eq("professor_id", user.id)
          .order("created_at", { ascending: true }),
      ]);

      if (examError) toast.error(examError.message);
      else setExams((examRows || []).map(mapExam));

      if (memberError) toast.error(memberError.message);
      else setMembers((memberRows || []).map(mapMember));

      if (moduleError && !isMissingModulesTable(moduleError)) {
        toast.error(moduleError.message);
      } else {
        const modulesWithUrls = await Promise.all((moduleRows || []).map(async (module) => {
          if (!module.file_path) return module;
          const { data: signed } = await supabase.storage.from("course-modules").createSignedUrl(module.file_path, 60 * 60);
          return { ...module, signedUrl: signed?.signedUrl || "" };
        }));
        setModules(modulesWithUrls.map(mapModule));
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
    }

    loadCourseDetail();
  }, [courseId, user?.id]);

  const quizzes = useMemo(() => exams.filter((exam) => exam.category === "quiz"), [exams]);
  const activities = useMemo(() => exams.filter((exam) => exam.category === "activity"), [exams]);
  const examItems = useMemo(() => exams.filter((exam) => exam.category === "exam"), [exams]);
  const filteredExams = useMemo(() => {
    const normalizedSearch = examFilters.search.trim().toLowerCase();
    return exams.filter((exam) => {
      const createdDate = formatDate(exam.createdAt);
      const matchesSearch = !normalizedSearch || `${exam.title} ${exam.type} ${exam.period} ${exam.semester} ${createdDate} ${exam.status}`.toLowerCase().includes(normalizedSearch);
      const matchesPeriod = examFilters.period === "All Periods" || exam.period === examFilters.period;
      const matchesSemester = examFilters.semester === "All Semesters" || exam.semester === examFilters.semester;
      const matchesDate = examFilters.date === "All Dates" || createdDate === examFilters.date;
      const matchesType = examFilters.type === "All Types" || exam.type === examFilters.type;
      return matchesSearch && matchesPeriod && matchesSemester && matchesDate && matchesType;
    });
  }, [examFilters, exams]);
  const examPeriodOptions = useMemo(() => [...new Set([
    ...periods.map((period) => period.name),
    ...exams.map((exam) => exam.period),
  ].filter(Boolean))], [exams, periods]);
  const examSemesterOptions = useMemo(() => [...new Set([
    ...semesterDefaults,
    ...exams.map((exam) => exam.semester),
  ].filter(Boolean))], [exams]);
  const examDateOptions = useMemo(() => [...new Set(exams.map((exam) => formatDate(exam.createdAt)).filter((date) => date !== "-"))], [exams]);
  const examTypeOptions = useMemo(() => [...new Set(exams.map((exam) => exam.type).filter(Boolean))], [exams]);
  const activeModules = useMemo(() => modules.filter((module) => !module.archived), [modules]);
  const archivedModules = useMemo(() => modules.filter((module) => module.archived), [modules]);
  const materialPeriods = useMemo(() => {
    const names = new Set(periods.map((period) => period.name).filter(Boolean));
    exams.forEach((exam) => names.add(exam.period || "No period"));
    activeModules.forEach((module) => names.add(module.period || "No period"));

    const savedPeriods = periods.filter((period) => names.has(period.name));
    const savedNames = new Set(savedPeriods.map((period) => period.name));
    const generatedPeriods = [...names]
      .filter((name) => !savedNames.has(name))
      .map((name) => ({ id: `period-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "default"}`, name, generated: true }));

    return [...savedPeriods, ...generatedPeriods];
  }, [activeModules, exams, periods]);

  const foldersByPeriod = useMemo(() => {
    const byPeriod = {};
    materialPeriods.forEach((period) => {
      const periodName = period.name;
      byPeriod[period.id] = [
        { id: "quizzes", name: "Quizzes", tone: "blue", description: "Created quizzes will appear here.", items: quizzes.filter((item) => item.period === periodName) },
        { id: "exams", name: "Exams", tone: "red", description: "Created exams will appear here.", items: examItems.filter((item) => item.period === periodName) },
        { id: "activities", name: "Activities", tone: "green", description: "Created activities will appear here.", items: activities.filter((item) => item.period === periodName) },
        { id: "modules", name: "Modules", tone: "purple", description: "Module reviewers will appear here.", items: activeModules.filter((item) => item.period === periodName) },
        { id: "permits", name: "Permit", tone: "amber", description: "Open permit folders and student submissions.", items: [] },
      ];
    });
    return byPeriod;
  }, [activeModules, activities, examItems, materialPeriods, quizzes]);

  if (notFound) return <Navigate to="/professor/courses" replace />;

  function togglePeriod(periodId) {
    setOpenPeriods((current) => ({ ...current, [periodId]: !current[periodId] }));
  }

  function toggleFolder(periodId, folderId) {
    const key = `${periodId}-${folderId}`;
    setOpenFolders((current) => ({ ...current, [key]: !current[key] }));
  }

  function openPeriodModuleFolder(period) {
    const targetPeriod = materialPeriods.find((item) => item.name === period);
    if (!targetPeriod) return;
    setOpenPeriods((current) => ({ ...current, [targetPeriod.id]: true }));
    setOpenFolders((current) => ({ ...current, [`${targetPeriod.id}-modules`]: true }));
  }

  async function createPeriod(event) {
    event.preventDefault();
    const name = periodName.trim();
    if (!name) return;
    if (materialPeriods.some((period) => period.name.toLowerCase() === name.toLowerCase())) {
      toast.error("Period already exists.");
      return;
    }

    setSavingPeriod(true);
    try {
      if (hasSupabaseConfig && user?.id) {
        const { data, error } = await supabase
          .from("course_periods")
          .insert({ course_id: courseId, professor_id: user.id, name })
          .select("id, name, created_at")
          .single();
        if (error) throw error;
        const newPeriod = { id: data.id, name: data.name, createdAt: data.created_at };
        setPeriods((current) => [...current, newPeriod]);
        setOpenPeriods((current) => ({ ...current, [newPeriod.id]: true }));
      } else {
        const newPeriod = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() };
        setPeriods((current) => [...current, newPeriod]);
        setOpenPeriods((current) => ({ ...current, [newPeriod.id]: true }));
      }
      setPeriodName("");
      setPeriodModalOpen(false);
      toast.success("Period folder created.");
    } catch (error) {
      toast.error(isMissingPeriodsTable(error) ? "Run the course_periods SQL first." : error.message);
    } finally {
      setSavingPeriod(false);
    }
  }

  async function uploadModuleFile(event, period = "No period") {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      toast.error("Module file must be 25MB or smaller.");
      return;
    }

    if (!hasSupabaseConfig || !user?.id) {
      setModules((current) => [{
        id: crypto.randomUUID(),
        title: file.name,
        description: "Uploaded module file",
        period,
        fileName: file.name,
        fileSize: file.size,
        createdAt: new Date().toISOString(),
        archived: false,
      }, ...current]);
      openPeriodModuleFolder(period);
      toast.success("Module added locally.");
      return;
    }

    setSavingModule(true);
    try {
      const path = `${user.id}/${courseId}/${crypto.randomUUID()}-${sanitizePathName(file.name)}`;
      const { error: uploadError } = await supabase.storage.from("course-modules").upload(path, file, { upsert: false });
      if (uploadError) throw uploadError;

      const { data, error } = await supabase
        .from("course_modules")
        .insert({
          course_id: courseId,
          professor_id: user.id,
          title: file.name.replace(/\.[^/.]+$/, ""),
          description: "Uploaded module file",
          period,
          file_name: file.name,
          file_path: path,
          file_size: file.size,
          mime_type: file.type || "application/octet-stream",
          archived: false,
        })
        .select("*")
        .single();

      if (error) throw error;

      const { data: signed } = await supabase.storage.from("course-modules").createSignedUrl(path, 60 * 60);
      setModules((current) => [mapModule({ ...data, signedUrl: signed?.signedUrl || "" }), ...current]);
      openPeriodModuleFolder(period);
      toast.success("Module uploaded.");
    } catch (error) {
      toast.error(isMissingModulesTable(error) ? "Run the course_modules SQL first." : error.message);
    } finally {
      setSavingModule(false);
    }
  }

  async function setModuleArchived(module, archived) {
    if (!hasSupabaseConfig) {
      setModules((current) => current.map((item) => item.id === module.id ? { ...item, archived } : item));
      toast.success(archived ? "Module archived." : "Module restored.");
      return;
    }

    try {
      const { data, error } = await supabase
        .from("course_modules")
        .update({ archived })
        .eq("id", module.id)
        .eq("course_id", courseId)
        .eq("professor_id", user.id)
        .select("*")
        .single();
      if (error) throw error;

      let nextModule = data;
      if (data.file_path) {
        const { data: signed } = await supabase.storage.from("course-modules").createSignedUrl(data.file_path, 60 * 60);
        nextModule = { ...data, signedUrl: signed?.signedUrl || "" };
      }

      setModules((current) => current.map((item) => item.id === module.id ? mapModule(nextModule) : item));
      toast.success(archived ? "Module archived." : "Module restored.");
    } catch (error) {
      toast.error(error.message?.includes("archived") ? "Run the course_modules archived column SQL first." : error.message);
    }
  }

  function goCreate(type, period = "") {
    const periodQuery = period ? `&period=${encodeURIComponent(period)}` : "";
    navigate(`/professor/exams/create?courseId=${courseId}&type=${encodeURIComponent(type)}${periodQuery}`);
  }

  async function openAssessmentStats(assessment) {
    setLoadingStats(true);
    setQuestionRoster(null);
    setAssessmentStats({ assessment, questions: [], attemptsCount: 0 });

    if (!hasSupabaseConfig) {
      setLoadingStats(false);
      return;
    }

    try {
      const { data: questionRows, error: questionError } = await supabase
        .from("exam_questions")
        .select("id, question_text, question_type, choices, correct_answer, correct_answers, question_config, manual_grading, points")
        .eq("exam_id", assessment.id)
        .order("id", { ascending: true });

      if (questionError) throw questionError;

      let attemptRows = [];
      const attemptResult = await supabase
        .from("exam_attempts")
        .select("id, student_id, profiles:student_id(full_name, student_number, email)")
        .eq("exam_id", assessment.id);

      if (attemptResult.error?.message?.includes("relationship") || attemptResult.error?.message?.includes("profiles")) {
        const fallbackAttemptResult = await supabase
          .from("exam_attempts")
          .select("id, student_id")
          .eq("exam_id", assessment.id);
        if (fallbackAttemptResult.error) throw fallbackAttemptResult.error;
        attemptRows = fallbackAttemptResult.data || [];
      } else if (attemptResult.error) {
        throw attemptResult.error;
      } else {
        attemptRows = attemptResult.data || [];
      }

      if (attemptRows.length && !attemptRows.some((attempt) => attempt.profiles)) {
        const studentIds = [...new Set(attemptRows.map((attempt) => attempt.student_id).filter(Boolean))];
        if (studentIds.length) {
          const { data: profileRows, error: profileError } = await supabase
            .from("profiles")
            .select("id, full_name, student_number, email")
            .in("id", studentIds);
          if (profileError) throw profileError;
          const profilesById = new Map((profileRows || []).map((profile) => [profile.id, profile]));
          attemptRows = attemptRows.map((attempt) => ({ ...attempt, profiles: profilesById.get(attempt.student_id) || null }));
        }
      }

      const attemptIds = (attemptRows || []).map((attempt) => attempt.id);
      const studentsByAttemptId = new Map((attemptRows || []).map((attempt) => [attempt.id, mapAttemptStudent(attempt, members)]));
      let answerRows = [];
      if (attemptIds.length) {
        const { data, error } = await supabase
          .from("exam_attempt_answers")
          .select("attempt_id, question_id, is_correct, needs_manual_grading")
          .in("attempt_id", attemptIds);
        if (error) throw error;
        answerRows = data || [];
      }

      const attemptsCount = attemptIds.length;
      const questions = (questionRows || []).map((question) => {
        const answersForQuestion = answerRows.filter((answer) => answer.question_id === question.id);
        const answeredAttemptIds = new Set(answersForQuestion.map((answer) => answer.attempt_id));
        const correctStudents = answersForQuestion
          .filter((answer) => answer.is_correct === true)
          .map((answer) => studentsByAttemptId.get(answer.attempt_id))
          .filter(Boolean);
        const pendingStudents = answersForQuestion
          .filter((answer) => answer.needs_manual_grading || answer.is_correct === null)
          .map((answer) => studentsByAttemptId.get(answer.attempt_id))
          .filter(Boolean);
        const incorrectStudents = [
          ...answersForQuestion
            .filter((answer) => answer.is_correct === false)
            .map((answer) => studentsByAttemptId.get(answer.attempt_id))
            .filter(Boolean),
          ...attemptRows
            .filter((attempt) => !answeredAttemptIds.has(attempt.id))
            .map((attempt) => studentsByAttemptId.get(attempt.id))
            .filter(Boolean),
        ];

        return {
          ...question,
          correct: correctStudents.length,
          incorrect: incorrectStudents.length,
          pending: pendingStudents.length,
          answered: answersForQuestion.length,
          correctStudents,
          incorrectStudents,
          pendingStudents,
        };
      });

      setAssessmentStats({ assessment, questions, attemptsCount });
    } catch (error) {
      toast.error(error.message);
      setAssessmentStats(null);
    } finally {
      setLoadingStats(false);
    }
  }

  function openQuestionRoster(question, type) {
    const isCorrect = type === "correct";
    setQuestionRoster({
      title: isCorrect ? "Students with correct answers" : "Students with incorrect answers",
      tone: type,
      questionText: question.question_text,
      students: isCorrect ? question.correctStudents : question.incorrectStudents,
    });
  }

  function handleQuestionRosterClick(event, question, type) {
    event.preventDefault();
    event.stopPropagation();
    openQuestionRoster(question, type);
  }

  return (
    <section className="professor-course-detail-page">
      <div className="professor-course-detail-heading">
        <Button variant="light" onClick={() => navigate("/professor/courses")}>Back to Courses</Button>
        <div>
          <h1>{course?.courseCode || "Course"}</h1>
          <p>{course ? `${course.courseName} - ${course.section}` : "Loading course..."}</p>
        </div>
      </div>

      <div className="professor-course-detail-layout">
        <aside className="professor-course-menu">
          <NavLink to={`/professor/courses/${courseId}/materials`}><FiBookOpen /> Materials</NavLink>
          <NavLink to={`/professor/courses/${courseId}/exams`}><FiFileText /> Exams</NavLink>
          <NavLink to={`/professor/courses/${courseId}/members`}><FiUsers /> Members</NavLink>
        </aside>

        {tab === "materials" ? (
          <div className="professor-materials-area">
            <div className="professor-materials-outside-actions">
              <button onClick={() => setPeriodModalOpen(true)} type="button"><FiPlus /> New Period</button>
            </div>

            <section className="professor-course-panel">
              <div className="professor-course-panel-title">
                <div>
                  <h2>Materials</h2>
                  <p>Create period folders with quizzes, exams, activities, modules, and permit submissions.</p>
                </div>
                <Badge tone="blue">{materialPeriods.length}</Badge>
              </div>

              <div className="professor-period-list">
                {materialPeriods.length ? materialPeriods.map((period) => (
                  <PeriodFolder
                    folders={foldersByPeriod[period.id] || []}
                    isOpen={!!openPeriods[period.id]}
                    key={period.id}
                    onArchive={(module) => setModuleArchived(module, true)}
                    onCreateAssessment={goCreate}
                    onOpenArchives={() => setModuleArchiveOpen(true)}
                    onOpenAssessment={openAssessmentStats}
                    onOpenPermit={() => navigate(`/professor/courses/${courseId}/permits?period=${encodeURIComponent(period.name)}`)}
                    onPreview={setPreviewModule}
                    onToggleFolder={toggleFolder}
                    onTogglePeriod={() => togglePeriod(period.id)}
                    onUploadModule={uploadModuleFile}
                    openFolders={openFolders}
                    period={period}
                    savingModule={savingModule}
                  />
                )) : (
                  <div className="professor-period-empty">
                    No period folders yet. Click New Period to create one.
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : null}

        {tab === "exams" ? (
          <section className="professor-course-panel">
            <div className="professor-course-panel-title">
              <div>
                <h2>Course Exams</h2>
                <p>Quizzes, activities, and exams created for this course.</p>
              </div>
              <Badge tone="blue">{filteredExams.length}</Badge>
            </div>

            <div className="professor-course-exam-filters">
              <input
                aria-label="Search exams"
                onChange={(event) => setExamFilters((current) => ({ ...current, search: event.target.value }))}
                placeholder="Search title, period, semester, date, type, or status"
                type="search"
                value={examFilters.search}
              />
              <select
                aria-label="Filter by period"
                onChange={(event) => setExamFilters((current) => ({ ...current, period: event.target.value }))}
                value={examFilters.period}
              >
                <option>All Periods</option>
                {examPeriodOptions.map((period) => <option key={period}>{period}</option>)}
              </select>
              <select
                aria-label="Filter by semester"
                onChange={(event) => setExamFilters((current) => ({ ...current, semester: event.target.value }))}
                value={examFilters.semester}
              >
                <option>All Semesters</option>
                {examSemesterOptions.map((semester) => <option key={semester}>{semester}</option>)}
              </select>
              <select
                aria-label="Filter by date"
                onChange={(event) => setExamFilters((current) => ({ ...current, date: event.target.value }))}
                value={examFilters.date}
              >
                <option>All Dates</option>
                {examDateOptions.map((date) => <option key={date}>{date}</option>)}
              </select>
              <select
                aria-label="Filter by exam type"
                onChange={(event) => setExamFilters((current) => ({ ...current, type: event.target.value }))}
                value={examFilters.type}
              >
                <option>All Types</option>
                {examTypeOptions.map((type) => <option key={type}>{type}</option>)}
              </select>
              <button onClick={() => setExamFilters(examFilterDefaults)} type="button">Clear</button>
            </div>
            <div className="professor-course-exam-list">
              {filteredExams.map((exam) => (
                <article key={exam.id}>
                  <div>
                    <strong>{exam.title}</strong>
                    <small>{exam.type} - {exam.period} - {exam.semester} - Created {formatDate(exam.createdAt)}</small>
                  </div>
                  <div>
                    <span>{exam.duration} min</span>
                    <Badge tone="neutral">{exam.status}</Badge>
                  </div>
                </article>
              ))}
              {!filteredExams.length ? <div className="professor-exams-empty">No assessments match your filters.</div> : null}
            </div>
          </section>
        ) : null}

        {tab === "members" ? (
          <section className="professor-course-panel">
            <div className="professor-course-panel-title">
              <div>
                <h2>Members</h2>
                <p>Students enrolled in this course.</p>
              </div>
              <Badge tone="blue">{members.length}</Badge>
            </div>
            <div className="student-member-list">
              {members.map((member) => (
                <article key={member.id}>
                  <i>{member.initials}</i>
                  <div>
                    <strong>{member.name}</strong>
                    <span>{member.studentNumber}</span>
                  </div>
                </article>
              ))}
              {!members.length ? <div className="professor-exams-empty">No enrolled students yet.</div> : null}
            </div>
          </section>
        ) : null}
      </div>

      {periodModalOpen ? (
        <div className="module-preview-backdrop" onClick={() => setPeriodModalOpen(false)} role="presentation">
          <section className="professor-period-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <header>
              <div>
                <h2>New Period</h2>
                <p>Create a period folder for this course.</p>
              </div>
              <button aria-label="Close new period" onClick={() => setPeriodModalOpen(false)} type="button"><FiX /></button>
            </header>
            <form onSubmit={createPeriod}>
              <label>
                <span>Period Name</span>
                <input
                  autoFocus
                  onChange={(event) => setPeriodName(event.target.value)}
                  placeholder="Example: Midterm"
                  value={periodName}
                />
              </label>
              <button disabled={savingPeriod} type="submit">{savingPeriod ? "Creating..." : "Create Period"}</button>
            </form>
          </section>
        </div>
      ) : null}

      {previewModule ? (
        <div className="module-preview-backdrop" onClick={() => setPreviewModule(null)} role="presentation">
          <section className="module-preview-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <header>
              <div>
                <h2>{previewModule.title}</h2>
                <p>{previewModule.fileName || previewModule.description}</p>
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

      {moduleArchiveOpen ? (
        <div className="module-preview-backdrop" onClick={() => setModuleArchiveOpen(false)} role="presentation">
          <section className="module-archive-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <header>
              <div>
                <h2>Archived Modules</h2>
                <p>Restore archived module files for {course?.courseCode || "this course"}.</p>
              </div>
              <button aria-label="Close archived modules" onClick={() => setModuleArchiveOpen(false)} type="button"><FiX /></button>
            </header>

            {archivedModules.length ? (
              <div className="module-archive-list">
                {archivedModules.map((module) => (
                  <article key={module.id}>
                    <FiArchive />
                    <div>
                      <strong>{module.title}</strong>
                      <span>{module.fileName || module.description} {module.fileSize ? `- ${formatFileSize(module.fileSize)}` : ""} - Archived</span>
                    </div>
                    {module.fileUrl && canPreview(module) ? (
                      <button onClick={() => setPreviewModule(module)} type="button"><FiEye /> Preview</button>
                    ) : null}
                    <button onClick={() => setModuleArchived(module, false)} type="button"><FiRefreshCw /> Restore</button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="professor-material-empty module-archive-empty">No archived module files.</div>
            )}
          </section>
        </div>
      ) : null}

      {assessmentStats ? (
        <div className="module-preview-backdrop" onClick={() => setAssessmentStats(null)} role="presentation">
          <section className="assessment-stats-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <header>
              <div>
                <h2>{assessmentStats.assessment.title}</h2>
                <p>{assessmentStats.assessment.type} - {assessmentStats.assessment.period} - {assessmentStats.assessment.semester} - {assessmentStats.assessment.status}</p>
              </div>
              <button aria-label="Close assessment preview" onClick={() => setAssessmentStats(null)} type="button"><FiX /></button>
            </header>

            <div className="assessment-stats-summary">
              <article>
                <strong>{assessmentStats.attemptsCount}</strong>
                <span>Total Attempts</span>
              </article>
              <article>
                <strong>{assessmentStats.questions.length}</strong>
                <span>Questions</span>
              </article>
            </div>

            {loadingStats ? (
              <div className="professor-exams-empty">Loading question analytics...</div>
            ) : (
              <div className="assessment-question-stats">
                {assessmentStats.questions.map((question, index) => (
                  <article key={question.id}>
                    <div className="assessment-question-content">
                      <span className="assessment-question-meta">{question.question_type} - {question.points} point{Number(question.points) === 1 ? "" : "s"}</span>
                      <strong>{index + 1}. {question.question_text}</strong>
                      {renderQuestionContent(question)}
                    </div>
                    <div className="assessment-question-counts">
                      <button aria-label={`View students with correct answers for question ${index + 1}`} className="correct" onClick={(event) => handleQuestionRosterClick(event, question, "correct")} type="button">{question.correct} correct</button>
                      <button aria-label={`View students with incorrect answers for question ${index + 1}`} className="incorrect" onClick={(event) => handleQuestionRosterClick(event, question, "incorrect")} type="button">{question.incorrect} incorrect</button>
                      {question.pending ? <span className="pending">{question.pending} pending</span> : null}
                    </div>
                  </article>
                ))}
                {!assessmentStats.questions.length ? <div className="professor-exams-empty">No questions found for this assessment.</div> : null}
              </div>
            )}

            {questionRoster ? (
              <div className="question-roster-backdrop" onClick={() => setQuestionRoster(null)} role="presentation">
                <section className="question-roster-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
                  <header>
                    <div>
                      <h3>{questionRoster.title}</h3>
                      <p>{questionRoster.questionText}</p>
                    </div>
                    <button aria-label="Close student list" onClick={() => setQuestionRoster(null)} type="button"><FiX /></button>
                  </header>
                  <div className="question-roster-list">
                    {questionRoster.students.length ? questionRoster.students.map((student) => (
                      <article key={student.id}>
                        <i>{student.name.slice(0, 1).toUpperCase()}</i>
                        <div>
                          <strong>{student.name}</strong>
                          <span>{student.studentNumber}{student.email ? ` - ${student.email}` : ""}</span>
                        </div>
                      </article>
                    )) : (
                      <div className="professor-exams-empty">No students in this list.</div>
                    )}
                  </div>
                </section>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </section>
  );
}

