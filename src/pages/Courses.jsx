import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FiArchive, FiEdit2, FiPlus, FiRefreshCw } from "react-icons/fi";
import { Button, Card, Field, PageHeader, SearchBox, SelectField, Table, Badge } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { courses as seedCourses, professors } from "../data/mockData";
import useLocalStorageState from "../hooks/useLocalStorageState";
import { formatCourseTerm, formatProgramOption, SEMESTER_OPTIONS, YEAR_LEVEL_OPTIONS } from "../lib/coursePrograms";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

function code() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export default function Courses() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isReadOnly = user?.role === "Dean";
  const [courses, setCourses] = useLocalStorageState("smartproctor.admin.courses", seedCourses);
  const [professorOptions, setProfessorOptions] = useState(hasSupabaseConfig ? [] : professors.filter((professor) => professor.status === "Active"));
  const [programs, setPrograms] = useState([]);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [programForm, setProgramForm] = useState({ programCode: "", programName: "" });
  const [editingProgramId, setEditingProgramId] = useState("");
  const [form, setForm] = useState({ courseName: "", courseCode: "", programId: "", yearLevel: "", section: "", semester: "", academicYear: "", professorId: hasSupabaseConfig ? "" : professors[0].id, joiningCode: code() });

  const visible = useMemo(() => courses.filter((course) => {
    const matchesArchive = isReadOnly || !course.archived;
    const matchesSearch = `${course.courseName} ${course.courseCode} ${course.programCode} ${course.programName} ${course.yearLevel} ${course.section} ${course.semester} ${course.academicYear} ${course.professor} ${course.joiningCode}`.toLowerCase().includes(search.toLowerCase());
    return matchesArchive && matchesSearch;
  }), [courses, isReadOnly, search]);
  const archived = courses.filter((course) => course.archived);

  function mapCourse(row, profilesById = new Map()) {
    const professor = row.profiles || profilesById.get(row.professor_id);
    return {
      id: row.id,
      courseName: row.course_name,
      courseCode: row.course_code,
      programId: row.program_id || "",
      programCode: row.programs?.program_code || "",
      programName: row.programs?.program_name || "",
      yearLevel: row.year_level || "",
      section: row.section,
      semester: row.semester || "",
      academicYear: row.academic_year || "",
      professor: professor?.full_name || professor?.email || "Unassigned",
      professorId: row.professor_id || "",
      joiningCode: row.joining_code,
      archived: row.archived,
    };
  }

  const coursesQuery = useQuery({
    queryKey: ["admin-courses"],
    enabled: hasSupabaseConfig,
    queryFn: async () => {
      const [{ data: courseRows, error: coursesError }, { data: professorRows, error: professorsError }, { data: programRows, error: programsError }] = await Promise.all([
        supabase
          .from("courses")
          .select("id, course_name, course_code, program_id, year_level, section, semester, academic_year, joining_code, professor_id, archived, created_at, programs(program_code, program_name, is_active)")
          .order("created_at", { ascending: false }),
        supabase
          .from("profiles")
          .select("id, full_name, email, employee_number, status")
          .eq("role", "Professor")
          .eq("status", "Active")
          .order("full_name", { ascending: true }),
        supabase
          .from("programs")
          .select("id, program_code, program_name, is_active, created_at")
          .order("program_code", { ascending: true }),
      ]);

      if (coursesError) {
        throw coursesError;
      }
      if (professorsError) {
        throw professorsError;
      }
      if (programsError) {
        throw programsError;
      }

      const profilesById = new Map((professorRows || []).map((professor) => [professor.id, professor]));
      const liveProfessors = (professorRows || []).map((professor) => ({
        id: professor.id,
        name: professor.full_name,
        email: professor.email,
        employeeNumber: professor.employee_number,
        status: professor.status,
      }));

      return { courses: (courseRows || []).map((course) => mapCourse(course, profilesById)), professors: liveProfessors, programs: programRows || [] };
    },
  });

  useEffect(() => {
    if (!coursesQuery.data) return;
    setCourses(coursesQuery.data.courses);
    if (coursesQuery.data.professors.length) {
      setProfessorOptions(coursesQuery.data.professors);
      setForm((current) => isUuid(current.professorId) ? current : { ...current, professorId: coursesQuery.data.professors[0].id });
    }
    setPrograms(coursesQuery.data.programs || []);
  }, [coursesQuery.data, setCourses]);

  useEffect(() => {
    if (coursesQuery.error) toast.error(coursesQuery.error.message);
  }, [coursesQuery.error]);

  useEffect(() => {
    if (!hasSupabaseConfig) return undefined;

    const channel = supabase
      .channel("courses-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "courses" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["admin-courses"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "programs" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["admin-courses"] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  async function createCourse(event) {
    event.preventDefault();
    if (!form.courseName.trim() || form.courseName.length > 160 || !form.courseCode.trim() || form.courseCode.length > 32 || !form.section.trim() || form.section.length > 40) { toast.error("Course name (160), code (32), and section (40) are required and must fit their character limits."); return; }
    if (form.academicYear && !/^\d{4}-\d{4}$/.test(form.academicYear.trim())) { toast.error("Academic Year must use YYYY-YYYY format."); return; }
    const selectedProfessor = professorOptions.find((professor) => professor.id === form.professorId);
    const selectedProgram = programs.find((program) => program.id === form.programId);
    const nextCourse = {
      id: crypto.randomUUID(),
      ...form,
      programCode: selectedProgram?.program_code || "",
      programName: selectedProgram?.program_name || "",
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
          program_id: isUuid(form.programId) ? form.programId : null,
          year_level: form.yearLevel || null,
          section: form.section,
          semester: form.semester || null,
          academic_year: form.academicYear.trim() || null,
          professor_id: professorId,
          joining_code: form.joiningCode.toUpperCase(),
          archived: false,
        })
        .select("id, course_name, course_code, program_id, year_level, section, semester, academic_year, joining_code, professor_id, archived, programs(program_code, program_name, is_active)")
        .single();

      if (error) {
        toast.error(error.message);
        return;
      }

      setCourses((current) => [{ ...mapCourse(data), professor: selectedProfessor?.name || "Unassigned" }, ...current]);
      await queryClient.invalidateQueries({ queryKey: ["admin-courses"] });
    } else {
      setCourses((current) => [nextCourse, ...current]);
    }

    setForm({ courseName: "", courseCode: "", programId: "", yearLevel: "", section: "", semester: "", academicYear: "", professorId: professorOptions[0]?.id || "", joiningCode: code() });
    toast.success("Course created and audit logged");
  }

  async function saveProgram(event) {
    event.preventDefault();
    const programCode = programForm.programCode.trim().toUpperCase();
    const programName = programForm.programName.trim();
    if (programCode.length < 2 || programCode.length > 24 || programName.length < 3 || programName.length > 160) {
      toast.error("Program code (2-24) and name (3-160) are required.");
      return;
    }
    const duplicate = programs.some((program) => program.id !== editingProgramId && program.program_code.toUpperCase() === programCode);
    if (duplicate) {
      toast.error("Program code already exists.");
      return;
    }
    const payload = { program_code: programCode, program_name: programName };
    const { error } = editingProgramId
      ? await supabase.from("programs").update(payload).eq("id", editingProgramId)
      : await supabase.from("programs").insert(payload);
    if (error) {
      toast.error(error.message);
      return;
    }
    setProgramForm({ programCode: "", programName: "" });
    setEditingProgramId("");
    await queryClient.invalidateQueries({ queryKey: ["admin-courses"] });
    toast.success(editingProgramId ? "Program updated" : "Program added");
  }

  async function setProgramActive(program, isActive) {
    const { error } = await supabase.from("programs").update({ is_active: isActive }).eq("id", program.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["admin-courses"] });
    toast.success(isActive ? "Program restored" : "Program deactivated");
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
    if (hasSupabaseConfig) await queryClient.invalidateQueries({ queryKey: ["admin-courses"] });
    toast.success(archivedState ? "Course archived" : "Course restored");
  }

  const columns = [
    { key: "courseName", label: "Course Name", width: "13%" },
    { key: "courseCode", label: "Course Code", width: "11%" },
    { key: "program", label: "Program", width: "26%", render: (row) => <span>{row.programCode || "Program not assigned"}{formatCourseTerm(row) ? <small className="table-muted">{formatCourseTerm(row)}</small> : null}</span> },
    { key: "section", label: "Section", width: "8%" },
    { key: "professor", label: "Professor", width: "14%" },
    ...(isReadOnly ? [{ key: "status", label: "Status", width: "12%", render: (row) => <Badge tone={row.archived ? "neutral" : "success"}>{row.archived ? "Archived" : "Active"}</Badge> }] : []),
    ...(!isReadOnly ? [{ key: "joiningCode", label: "Joining Code", width: "11%", render: (row) => <Badge>{row.joiningCode}</Badge> }] : []),
  ];

  const programColumns = [
    { key: "program_code", label: "Program Code", width: "20%", render: (row) => <strong>{row.program_code}</strong> },
    { key: "program_name", label: "Program Name", width: "40%" },
    { key: "status", label: "Status", width: "16%", render: (row) => <Badge tone={row.is_active ? "success" : "neutral"}>{row.is_active ? "Active" : "Inactive"}</Badge> },
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
      {!isReadOnly ? (
        <PageHeader
          title="Courses"
          subtitle="Create courses, assign professors, generate joining codes, and manage archives."
          actions={<Button variant="light" onClick={() => setShowArchived(true)}><FiArchive /> Archived Courses</Button>}
        />
      ) : null}
      {!isReadOnly ? (
        <Card className="admin-panel admin-form-panel">
          <form className="inline-form" onSubmit={createCourse}>
            <Field label="Course Name" value={form.courseName} onChange={(event) => setForm({ ...form, courseName: event.target.value })} required />
            <Field label="Course Code" value={form.courseCode} onChange={(event) => setForm({ ...form, courseCode: event.target.value })} required />
            <SelectField label="Program" value={form.programId} onChange={(event) => setForm({ ...form, programId: event.target.value })}>
              <option value="">Program not assigned</option>
              {programs.filter((program) => program.is_active).map((program) => <option key={program.id} value={program.id}>{formatProgramOption(program)}</option>)}
            </SelectField>
            <SelectField label="Year Level" value={form.yearLevel} onChange={(event) => setForm({ ...form, yearLevel: event.target.value })}>
              <option value="">Not set</option>
              {YEAR_LEVEL_OPTIONS.map((level) => <option key={level}>{level}</option>)}
            </SelectField>
            <Field label="Section" value={form.section} onChange={(event) => setForm({ ...form, section: event.target.value })} required />
            <SelectField label="Semester" value={form.semester} onChange={(event) => setForm({ ...form, semester: event.target.value })}>
              <option value="">Not set</option>
              {SEMESTER_OPTIONS.map((semester) => <option key={semester}>{semester}</option>)}
            </SelectField>
            <Field label="Academic Year" placeholder="2026-2027" value={form.academicYear} onChange={(event) => setForm({ ...form, academicYear: event.target.value })} />
            <SelectField label="Assign Professor" value={form.professorId} onChange={(event) => setForm({ ...form, professorId: event.target.value })}>
              {professorOptions.map((professor) => <option key={professor.id} value={professor.id}>{professor.name}</option>)}
            </SelectField>
            <Field label="Joining Code" value={form.joiningCode} onChange={(event) => setForm({ ...form, joiningCode: event.target.value.toUpperCase() })} required />
            <Button type="button" variant="light" onClick={() => setForm({ ...form, joiningCode: code() })}><FiRefreshCw /> Generate</Button>
            <Button><FiPlus /> Add Course</Button>
          </form>
        </Card>
      ) : null}
      {!isReadOnly && hasSupabaseConfig ? (
        <Card className="admin-panel admin-form-panel">
          <PageHeader title="Academic Programs" subtitle="Manage normalized program labels used by courses." />
          <form className="inline-form program-create-form" onSubmit={saveProgram}>
            <Field label="Program Code" value={programForm.programCode} onChange={(event) => setProgramForm({ ...programForm, programCode: event.target.value.toUpperCase() })} required />
            <Field label="Program Name" value={programForm.programName} onChange={(event) => setProgramForm({ ...programForm, programName: event.target.value })} required />
            <Button>{editingProgramId ? <FiEdit2 /> : <FiPlus />}{editingProgramId ? " Update Program" : " Add Program"}</Button>
            {editingProgramId ? <Button type="button" variant="light" onClick={() => { setEditingProgramId(""); setProgramForm({ programCode: "", programName: "" }); }}>Cancel</Button> : null}
          </form>
          <Table className="programs-table-wrap" columns={programColumns} rows={programs} emptyTitle="No programs found" emptyDescription="Add an academic program to make it available for course creation." renderActions={Object.assign((row) => (
            <>
              <Button variant="light" onClick={() => { setEditingProgramId(row.id); setProgramForm({ programCode: row.program_code, programName: row.program_name }); }}><FiEdit2 /> Edit</Button>
              <Button variant="light" onClick={() => setProgramActive(row, !row.is_active)}>{row.is_active ? "Deactivate" : "Restore"}</Button>
            </>
          ), { width: "24%" })} />
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
        <Table className="courses-table-wrap" columns={columns} rows={visible} renderActions={!isReadOnly ? Object.assign((row) => <Button variant="light" onClick={() => setArchived(row.id, true)}><FiArchive /> Archive</Button>, { width: "17%" }) : null} />
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
