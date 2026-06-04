import { useEffect, useMemo, useState } from "react";
import { FiCalendar, FiDownload, FiEye, FiFileText, FiFolder, FiSend, FiUsers, FiX } from "react-icons/fi";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Badge, Button } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "";
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function canPreview(file) {
  const name = file.fileName?.toLowerCase() || "";
  return file.mimeType?.startsWith("image/") || file.mimeType === "application/pdf" || name.endsWith(".pdf") || name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg");
}

function mapCourse(course) {
  return {
    id: course.id,
    courseName: course.course_name || "Course",
    courseCode: course.course_code || "Course",
    section: course.section || "No section",
  };
}

function mapMember(enrollment) {
  const profile = enrollment.profiles || {};
  const name = profile.full_name || profile.email || "Unnamed student";
  return {
    id: enrollment.student_id,
    initials: name.slice(0, 1).toUpperCase(),
    name,
    email: profile.email || "",
    studentNumber: profile.student_number || "No student ID",
  };
}

function mapPermitFile(file) {
  return {
    id: file.id,
    requestId: file.request_id,
    courseId: file.course_id,
    studentId: file.student_id,
    fileName: file.file_name,
    filePath: file.file_path,
    fileSize: file.file_size,
    mimeType: file.mime_type,
    fileUrl: file.signedUrl || "",
    createdAt: file.created_at,
  };
}

export default function ProfessorCoursePermits() {
  const { user } = useAuth();
  const { courseId } = useParams();
  const navigate = useNavigate();
  const [course, setCourse] = useState(null);
  const [members, setMembers] = useState([]);
  const [permitFiles, setPermitFiles] = useState([]);
  const [requests, setRequests] = useState([]);
  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [deadline, setDeadline] = useState("");
  const [folderSearch, setFolderSearch] = useState("");
  const [folderStatusFilter, setFolderStatusFilter] = useState("All Students");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [requesting, setRequesting] = useState(false);

  const filesByStudent = useMemo(() => permitFiles.reduce((items, file) => ({
    ...items,
    [file.studentId]: [...(items[file.studentId] || []), file],
  }), {}), [permitFiles]);
  const submittedStudentIds = useMemo(() => new Set(permitFiles.map((file) => file.studentId)), [permitFiles]);
  const filteredMembers = useMemo(() => {
    const normalizedSearch = folderSearch.trim().toLowerCase();
    return members.filter((member) => {
      const fileCount = filesByStudent[member.id]?.length || 0;
      const matchesSearch = !normalizedSearch || `${member.name} ${member.studentNumber} ${member.email}`.toLowerCase().includes(normalizedSearch);
      const matchesStatus = folderStatusFilter === "All Students"
        || (folderStatusFilter === "With Permit Files" && fileCount > 0)
        || (folderStatusFilter === "No Permit Files" && fileCount === 0);
      return matchesSearch && matchesStatus;
    });
  }, [filesByStudent, folderSearch, folderStatusFilter, members]);
  const selectedStudent = members.find((member) => member.id === selectedStudentId) || filteredMembers[0] || members[0];
  const selectedFiles = selectedStudent ? filesByStudent[selectedStudent.id] || [] : [];
  const latestRequest = requests[0];

  useEffect(() => {
    if (!hasSupabaseConfig || !user?.id || !courseId) {
      setLoading(false);
      return;
    }

    async function loadPermitPage() {
      setLoading(true);
      const [{ data: courseRow, error: courseError }, { data: memberRows, error: memberError }, { data: requestRows, error: requestError }, { data: fileRows, error: fileError }] = await Promise.all([
        supabase
          .from("courses")
          .select("id, course_name, course_code, section")
          .eq("id", courseId)
          .eq("professor_id", user.id)
          .maybeSingle(),
        supabase
          .from("course_enrollments")
          .select("student_id, profiles:student_id(full_name, student_number, email)")
          .eq("course_id", courseId)
          .order("joined_at", { ascending: true }),
        supabase
          .from("course_permit_requests")
          .select("*")
          .eq("course_id", courseId)
          .order("created_at", { ascending: false }),
        supabase
          .from("course_permit_files")
          .select("*")
          .eq("course_id", courseId)
          .order("created_at", { ascending: false }),
      ]);

      if (courseError) toast.error(courseError.message);
      if (!courseRow) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setCourse(mapCourse(courseRow));

      if (memberError) toast.error(memberError.message);
      else setMembers((memberRows || []).map(mapMember));

      if (requestError) toast.error(requestError.message);
      else setRequests(requestRows || []);

      if (fileError) {
        toast.error(fileError.message);
      } else {
        const filesWithUrls = await Promise.all((fileRows || []).map(async (file) => {
          const { data: signed } = await supabase.storage.from("course-permits").createSignedUrl(file.file_path, 60 * 60);
          return { ...file, signedUrl: signed?.signedUrl || "" };
        }));
        setPermitFiles(filesWithUrls.map(mapPermitFile));
      }

      setLoading(false);
    }

    loadPermitPage();
  }, [courseId, user?.id]);

  useEffect(() => {
    if (!selectedStudentId && members.length) setSelectedStudentId(members[0].id);
  }, [members, selectedStudentId]);

  if (notFound) return <Navigate to="/professor/courses" replace />;

  async function requestPermit(event) {
    event.preventDefault();
    if (!deadline) {
      toast.error("Select a deadline.");
      return;
    }

    if (!hasSupabaseConfig || !user?.id) {
      setRequestOpen(false);
      toast.success("Permit request created locally.");
      return;
    }

    setRequesting(true);
    try {
      const { data, error } = await supabase
        .from("course_permit_requests")
        .insert({
          course_id: courseId,
          professor_id: user.id,
          deadline: new Date(deadline).toISOString(),
        })
        .select("*")
        .single();
      if (error) throw error;

      if (members.length) {
        const notifications = members.map((member) => ({
          user_id: member.id,
          title: "Permit Requested",
          message: `${course.courseCode} requires permit submission until ${formatDate(data.deadline)}.`,
          type: "permit_request",
        }));
        const { error: notificationError } = await supabase.from("notifications").insert(notifications);
        if (notificationError) toast.error(`Permit request saved, but notification failed: ${notificationError.message}`);
      }

      setRequests((current) => [data, ...current]);
      setDeadline("");
      setRequestOpen(false);
      toast.success("Permit request sent to students.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setRequesting(false);
    }
  }

  return (
    <section className="professor-permit-page">
      <div className="professor-course-detail-heading">
        <Button variant="light" onClick={() => navigate(`/professor/courses/${courseId}/materials`)}>Back to Materials</Button>
        <div>
          <h1>Permit Submissions</h1>
          <p>{course ? `${course.courseCode} - ${course.section}` : "Loading course permits..."}</p>
        </div>
      </div>

      <div className="professor-permit-toolbar">
        <article>
          <FiFolder />
          <strong>{submittedStudentIds.size}/{members.length}</strong>
          <span>Student folders with permit files</span>
        </article>
        <article>
          <FiUsers />
          <strong>{submittedStudentIds.size}/{members.length}</strong>
          <span>Students submitted</span>
        </article>
        <article>
          <FiCalendar />
          <strong>{latestRequest ? formatDate(latestRequest.deadline) : "No deadline"}</strong>
          <span>Latest permit deadline</span>
        </article>
        <Button onClick={() => setRequestOpen(true)}><FiSend /> Request Permit</Button>
      </div>

      <div className="professor-permit-layout">
        <section className="professor-permit-folders">
          <div className="professor-course-panel-title">
            <div>
              <h2>Student Folders</h2>
              <p>Open a student folder to review submitted permit files.</p>
            </div>
            <Badge tone="blue">{submittedStudentIds.size}/{members.length}</Badge>
          </div>

          <div className="professor-permit-folder-filters">
            <input
              aria-label="Search student folders"
              onChange={(event) => setFolderSearch(event.target.value)}
              placeholder="Search name, student ID, or email"
              type="search"
              value={folderSearch}
            />
            <select
              aria-label="Filter student folders"
              onChange={(event) => setFolderStatusFilter(event.target.value)}
              value={folderStatusFilter}
            >
              <option>All Students</option>
              <option>With Permit Files</option>
              <option>No Permit Files</option>
            </select>
          </div>

          <div className="professor-permit-folder-grid">
            {filteredMembers.map((member) => {
              const fileCount = filesByStudent[member.id]?.length || 0;
              return (
                <button className={selectedStudent?.id === member.id ? "active" : ""} key={member.id} onClick={() => setSelectedStudentId(member.id)} type="button">
                  <FiFolder />
                  <div>
                    <strong>{member.name}</strong>
                    <span>{member.studentNumber}</span>
                  </div>
                  <Badge tone={fileCount ? "success" : "neutral"}>{fileCount}</Badge>
                </button>
              );
            })}
            {!members.length && !loading ? <div className="professor-exams-empty">No enrolled students yet.</div> : null}
            {members.length && !filteredMembers.length ? <div className="professor-exams-empty">No student folders match your filters.</div> : null}
          </div>
        </section>

        <section className="professor-permit-files">
          <div className="professor-course-panel-title">
            <div>
              <h2>{selectedStudent?.name || "Permit Files"}</h2>
              <p>{selectedStudent ? selectedStudent.studentNumber : "Select a student folder."}</p>
            </div>
            <Badge tone={selectedFiles.length ? "blue" : "neutral"}>{selectedFiles.length}</Badge>
          </div>

          <div className="professor-permit-file-list">
            {selectedFiles.map((file) => (
              <article key={file.id}>
                <FiFileText />
                <div>
                  <strong>{file.fileName}</strong>
                  <span>{formatFileSize(file.fileSize)} - Submitted {formatDate(file.createdAt)}</span>
                </div>
                {file.fileUrl && canPreview(file) ? <button onClick={() => setPreviewFile(file)} type="button"><FiEye /> Preview</button> : null}
                {file.fileUrl ? <a href={file.fileUrl} rel="noreferrer" target="_blank"><FiDownload /> Open</a> : null}
              </article>
            ))}
            {!selectedFiles.length ? <div className="professor-exams-empty">No permit files submitted by this student.</div> : null}
          </div>
        </section>
      </div>

      {requestOpen ? (
        <div className="module-preview-backdrop" onClick={() => setRequestOpen(false)} role="presentation">
          <section className="permit-request-modal" onClick={(modalEvent) => modalEvent.stopPropagation()} role="dialog" aria-modal="true">
            <header>
              <div>
                <h2>Request Permit</h2>
                <p>Set the deadline for this course permit submission.</p>
              </div>
              <button aria-label="Close permit request" onClick={() => setRequestOpen(false)} type="button"><FiX /></button>
            </header>
            <form onSubmit={requestPermit}>
              <label>
                Deadline
                <input onChange={(inputEvent) => setDeadline(inputEvent.target.value)} required type="datetime-local" value={deadline} />
              </label>
              <Button disabled={requesting}><FiSend /> {requesting ? "Sending..." : "Send Request"}</Button>
            </form>
          </section>
        </div>
      ) : null}

      {previewFile ? (
        <div className="module-preview-backdrop" onClick={() => setPreviewFile(null)} role="presentation">
          <section className="module-preview-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <header>
              <div>
                <h2>{previewFile.fileName}</h2>
                <p>Permit file preview</p>
              </div>
              <button aria-label="Close preview" onClick={() => setPreviewFile(null)} type="button"><FiX /></button>
            </header>
            <div className="module-preview-body">
              {previewFile.mimeType?.startsWith("image/") ? <img alt={previewFile.fileName} src={previewFile.fileUrl} /> : <iframe src={previewFile.fileUrl} title={previewFile.fileName} />}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
