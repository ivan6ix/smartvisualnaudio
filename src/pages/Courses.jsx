import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FiArchive, FiPlus, FiRefreshCw } from "react-icons/fi";
import { Button, Card, Field, PageHeader, SearchBox, SelectField, Table, Badge } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { courses as seedCourses, professors } from "../data/mockData";
import useLocalStorageState from "../hooks/useLocalStorageState";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

function code() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export default function Courses() {
  const { user } = useAuth();
  const isReadOnly = user?.role === "Dean";
  const [courses, setCourses] = useLocalStorageState("smartproctor.admin.courses", seedCourses);
  const [professorOptions, setProfessorOptions] = useState(hasSupabaseConfig ? [] : professors.filter((professor) => professor.status === "Active"));
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState({ courseName: "", courseCode: "", section: "", professorId: hasSupabaseConfig ? "" : professors[0].id, joiningCode: code() });

  const visible = useMemo(() => courses.filter((course) => {
    const matchesArchive = isReadOnly || !course.archived;
    const matchesSearch = `${course.courseName} ${course.courseCode} ${course.section} ${course.professor} ${course.joiningCode}`.toLowerCase().includes(search.toLowerCase());
    return matchesArchive && matchesSearch;
  }), [courses, isReadOnly, search]);
  const archived = courses.filter((course) => course.archived);

  function mapCourse(row, profilesById = new Map()) {
    const professor = row.profiles || profilesById.get(row.professor_id);
    return {
      id: row.id,
      courseName: row.course_name,
      courseCode: row.course_code,
      section: row.section,
      professor: professor?.full_name || professor?.email || "Unassigned",
      professorId: row.professor_id || "",
      joiningCode: row.joining_code,
      archived: row.archived,
    };
  }

  useEffect(() => {
    if (!hasSupabaseConfig) return;

    async function loadLiveCourses() {
      const [{ data: courseRows, error: coursesError }, { data: professorRows, error: professorsError }] = await Promise.all([
        supabase
          .from("courses")
          .select("id, course_name, course_code, section, joining_code, professor_id, archived, created_at")
          .order("created_at", { ascending: false }),
        supabase
          .from("profiles")
          .select("id, full_name, email, employee_number, status")
          .eq("role", "Professor")
          .eq("status", "Active")
          .order("full_name", { ascending: true }),
      ]);

      if (coursesError) {
        toast.error(coursesError.message);
        return;
      }
      if (professorsError) {
        toast.error(professorsError.message);
      }

      const profilesById = new Map((professorRows || []).map((professor) => [professor.id, professor]));
      const liveProfessors = (professorRows || []).map((professor) => ({
        id: professor.id,
        name: professor.full_name,
        email: professor.email,
        employeeNumber: professor.employee_number,
        status: professor.status,
      }));

      setCourses((courseRows || []).map((course) => mapCourse(course, profilesById)));
      if (liveProfessors.length) {
        setProfessorOptions(liveProfessors);
        setForm((current) => isUuid(current.professorId) ? current : { ...current, professorId: liveProfessors[0].id });
      }
    }

    loadLiveCourses();

    const channel = supabase
      .channel("courses-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "courses" }, () => {
        loadLiveCourses();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [setCourses]);

  async function createCourse(event) {
    event.preventDefault();
    const selectedProfessor = professorOptions.find((professor) => professor.id === form.professorId);
    const nextCourse = {
      id: crypto.randomUUID(),
      ...form,
      professor: selectedProfessor?.name || "Unassigned",
      archived: false,
    };

    if (hasSupabaseConfig) {
      const professorId = isUuid(form.professorId) ? form.professorId : null;
      const { data, error } = await supabase
        .from("courses")
        .insert({
          course_name: form.courseName,
          course_code: form.courseCode,
          section: form.section,
          professor_id: professorId,
          joining_code: form.joiningCode.toUpperCase(),
          archived: false,
        })
        .select("id, course_name, course_code, section, joining_code, professor_id, archived")
        .single();

      if (error) {
        toast.error(error.message);
        return;
      }

      setCourses((current) => [{ ...mapCourse(data), professor: selectedProfessor?.name || "Unassigned" }, ...current]);
    } else {
      setCourses((current) => [nextCourse, ...current]);
    }

    setForm({ courseName: "", courseCode: "", section: "", professorId: professorOptions[0]?.id || "", joiningCode: code() });
    toast.success("Course created and audit logged");
  }

  async function setArchived(id, archivedState) {
    if (hasSupabaseConfig) {
      const { error } = await supabase.from("courses").update({ archived: archivedState }).eq("id", id);
      if (error) {
        toast.error(error.message);
        return;
      }
    }

    setCourses((current) => current.map((course) => course.id === id ? { ...course, archived: archivedState } : course));
    toast.success(archivedState ? "Course archived" : "Course restored");
  }

  const columns = [
    { key: "courseName", label: "Course Name" },
    { key: "courseCode", label: "Course Code" },
    { key: "section", label: "Section" },
    { key: "professor", label: "Professor" },
    ...(isReadOnly ? [{ key: "status", label: "Status", render: (row) => <Badge tone={row.archived ? "neutral" : "success"}>{row.archived ? "Archived" : "Active"}</Badge> }] : []),
    ...(!isReadOnly ? [{ key: "joiningCode", label: "Joining Code", render: (row) => <Badge>{row.joiningCode}</Badge> }] : []),
  ];

  return (
    <section className="admin-dashboard-page admin-section-page">
      <div className="admin-section-hero">
        <div>
          <span><FiPlus /> Course Operations</span>
          <h1>Courses</h1>
          <p>{isReadOnly ? "View courses and assigned professors across the institution." : "Create courses, assign professors, generate joining codes, and manage archives."}</p>
        </div>
        <strong>{visible.length}</strong>
      </div>
      <PageHeader
        title="Courses"
        subtitle={isReadOnly ? "View courses and assigned professors across the institution." : "Create courses, assign professors, generate joining codes, and manage archives."}
        actions={!isReadOnly ? <Button variant="light" onClick={() => setShowArchived(true)}><FiArchive /> Archived Courses</Button> : null}
      />
      {!isReadOnly ? (
        <Card className="admin-panel admin-form-panel">
          <form className="inline-form" onSubmit={createCourse}>
            <Field label="Course Name" value={form.courseName} onChange={(event) => setForm({ ...form, courseName: event.target.value })} required />
            <Field label="Course Code" value={form.courseCode} onChange={(event) => setForm({ ...form, courseCode: event.target.value })} required />
            <Field label="Section" value={form.section} onChange={(event) => setForm({ ...form, section: event.target.value })} required />
            <SelectField label="Assign Professor" value={form.professorId} onChange={(event) => setForm({ ...form, professorId: event.target.value })}>
              {professorOptions.map((professor) => <option key={professor.id} value={professor.id}>{professor.name}</option>)}
            </SelectField>
            <Field label="Joining Code" value={form.joiningCode} onChange={(event) => setForm({ ...form, joiningCode: event.target.value.toUpperCase() })} required />
            <Button type="button" variant="light" onClick={() => setForm({ ...form, joiningCode: code() })}><FiRefreshCw /> Generate</Button>
            <Button><FiPlus /> Add Course</Button>
          </form>
        </Card>
      ) : null}
      {isReadOnly ? (
        <div className="dean-course-search">
          <SearchBox value={search} onChange={setSearch} placeholder="Search course or professor" />
        </div>
      ) : (
        <SearchBox value={search} onChange={setSearch} placeholder="Search course, professor, section, or joining code" />
      )}
      <Card className="admin-panel admin-activity-panel">
        <h2>Course Table</h2>
        <Table columns={columns} rows={visible} renderActions={!isReadOnly ? (row) => <Button variant="light" onClick={() => setArchived(row.id, true)}><FiArchive /> Archive</Button> : null} />
      </Card>
      {showArchived && !isReadOnly ? (
        <div className="modal-backdrop" onClick={() => setShowArchived(false)}>
          <Card className="modal" onClick={(event) => event.stopPropagation()}>
            <PageHeader title="Archived Courses" actions={<Button variant="light" onClick={() => setShowArchived(false)}>Close</Button>} />
            <Table columns={columns} rows={archived} renderActions={(row) => <Button variant="light" onClick={() => setArchived(row.id, false)}>Restore</Button>} />
          </Card>
        </div>
      ) : null}
    </section>
  );
}
