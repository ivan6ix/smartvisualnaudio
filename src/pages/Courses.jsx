import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FiArchive, FiEdit2, FiPlus, FiRefreshCw, FiTrash2 } from "react-icons/fi";
import { ListPagination, ListViewToolbar, RecordCardList } from "../components/ListViewControls";
import { Badge, Button, Card, EmptyState, Field, PageHeader, SearchBox, SelectField, Table } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import useListViewPreference from "../hooks/useListViewPreference";
import { courses as seedCourses, professors } from "../data/mockData";
import useLocalStorageState from "../hooks/useLocalStorageState";
import { formatCourseTerm, formatProgramOption, SEMESTER_OPTIONS, YEAR_LEVEL_OPTIONS } from "../lib/coursePrograms";
import { buildAssignedProfessorLabel, isCanonicalProfessorId } from "../lib/courseOwnership";
import { getListPageSlice } from "../lib/listView";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

function code() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
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
  const [archiveCandidate, setArchiveCandidate] = useState(null);
  const [restoreCandidate, setRestoreCandidate] = useState(null);
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [archiveActionId, setArchiveActionId] = useState("");
  const [deletingCourseId, setDeletingCourseId] = useState("");
  const [page, setPage] = useState(1);
  const listView = useListViewPreference({ role: isReadOnly ? "dean" : "admin", page: "courses", defaultView: "table" });
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
      setForm((current) => isCanonicalProfessorId(current.professorId) ? current : { ...current, professorId: coursesQuery.data.professors[0].id });
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
      const professorId = isCanonicalProfessorId(form.professorId) ? form.professorId : null;
      const { data, error } = await supabase.rpc("admin_create_course", {
        p_academic_year: form.academicYear.trim() || null,
        p_course_code: form.courseCode,
        p_course_name: form.courseName,
        p_joining_code: form.joiningCode.toUpperCase(),
        p_professor_id: professorId,
        p_program_id: isCanonicalProfessorId(form.programId) ? form.programId : null,
        p_section: form.section,
        p_semester: form.semester || null,
        p_year_level: form.yearLevel || null,
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      setCourses((current) => [{ ...mapCourse(data), professor: selectedProfessor?.name || "Unassigned" }, ...current]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-courses"] }),
        professorId ? queryClient.invalidateQueries({ queryKey: ["professor-courses", professorId] }) : Promise.resolve(),
        professorId ? queryClient.invalidateQueries({ queryKey: ["professor-dashboard", professorId] }) : Promise.resolve(),
      ]);
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
    const { error } = await supabase.rpc("admin_save_program", {
      p_program_code: programCode,
      p_program_id: editingProgramId || null,
      p_program_name: programName,
    });
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
    const { error } = await supabase.rpc("admin_set_program_active", { p_is_active: isActive, p_program_id: program.id });
    if (error) {
      toast.error(error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["admin-courses"] });
    toast.success(isActive ? "Program restored" : "Program deactivated");
  }

  async function setArchived(id, archivedState) {
    setArchiveActionId(id);
    if (hasSupabaseConfig) {
      const { error } = await supabase.rpc("admin_set_course_archived", { p_archived: archivedState, p_course_id: id });
      if (error) {
        toast.error(error.message);
        setArchiveActionId("");
        return;
      }
    }

    setCourses((current) => current.map((course) => course.id === id ? { ...course, archived: archivedState } : course));
    if (hasSupabaseConfig) await queryClient.invalidateQueries({ queryKey: ["admin-courses"] });
    toast.success(archivedState ? "Course archived" : "Course restored");
    setArchiveCandidate(null);
    setRestoreCandidate(null);
    setArchiveActionId("");
  }

  async function permanentlyDeleteCourse() {
    if (!deleteCandidate || deleteConfirmationText !== "DELETE" || deletingCourseId) return;
    setDeletingCourseId(deleteCandidate.id);
    try {
      if (hasSupabaseConfig) {
        const { data, error } = await supabase.functions.invoke("admin-delete-course", {
          body: { courseId: deleteCandidate.id },
        });
        if (error) {
          throw new Error(data?.error || error.message || "Course could not be permanently deleted.");
        }
        if (data?.error) throw new Error(data.error);
        if (data?.storage_cleanup_complete === false) {
          toast.warning(data.warning || "Course permanently deleted, but some stored files require cleanup.");
        } else {
          toast.success("Course permanently deleted.");
        }
      } else {
        toast.success("Course permanently deleted locally.");
      }

      setCourses((current) => current.filter((course) => course.id !== deleteCandidate.id));
      await queryClient.invalidateQueries({ queryKey: ["admin-courses"] });
      setDeleteCandidate(null);
      setDeleteConfirmationText("");
    } catch (error) {
      toast.error(error.message || "Course could not be permanently deleted.");
    } finally {
      setDeletingCourseId("");
    }
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
  const pageData = getListPageSlice(visible, page, listView.pageSize);
  const deleteConfirmed = deleteConfirmationText === "DELETE";
  const deanProfessorCount = new Set(visible.map((course) => course.professor).filter((professor) => professor && professor !== "Unassigned")).size;
  const deanActiveCount = visible.filter((course) => !course.archived).length;
  const deanArchivedCount = visible.filter((course) => course.archived).length;

  const programColumns = [
    { key: "program_code", label: "Program Code", width: "20%", render: (row) => <strong>{row.program_code}</strong> },
    { key: "program_name", label: "Program Name", width: "40%" },
    { key: "status", label: "Status", width: "16%", render: (row) => <Badge tone={row.is_active ? "success" : "neutral"}>{row.is_active ? "Active" : "Inactive"}</Badge> },
  ];

  return (
    <section className={`admin-dashboard-page admin-section-page${isReadOnly ? " dean-courses-page" : ""}`}>
      {isReadOnly ? (
        <header className="dean-dashboard-header dean-courses-header">
          <h1>Courses</h1>
          <p>View and oversee academic courses and their examination activity.</p>
        </header>
      ) : (
        <div className="admin-section-hero">
        <div>
          <span><FiPlus /> Course Operations</span>
          <h1>Courses</h1>
          <p>Create courses, assign professors, generate joining codes, and manage archives.</p>
        </div>
        <strong>{visible.length}</strong>
        </div>
      )}
      {!isReadOnly ? <PageHeader title="Courses" subtitle="Create courses, assign professors, generate joining codes, and manage archives." /> : null}
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
              {professorOptions.map((professor) => <option key={professor.id} value={professor.id}>{buildAssignedProfessorLabel(professor)}</option>)}
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
        <>
          <div className="dean-kpi-grid dean-courses-kpi-grid">
            <Card className="dean-kpi-card">
              <div>
                <span>Total Courses</span>
                <strong>{visible.length}</strong>
              </div>
            </Card>
            <Card className="dean-kpi-card">
              <div>
                <span>Active Courses</span>
                <strong>{deanActiveCount}</strong>
              </div>
            </Card>
            <Card className="dean-kpi-card">
              <div>
                <span>Archived</span>
                <strong>{deanArchivedCount}</strong>
              </div>
            </Card>
            <Card className="dean-kpi-card">
              <div>
                <span>Assigned Professors</span>
                <strong>{deanProfessorCount}</strong>
              </div>
            </Card>
          </div>
          <Card className="dean-dashboard-panel dean-courses-controls">
            <div className="dean-course-search">
              <SearchBox value={search} onChange={setSearch} placeholder="Search course or professor" />
            </div>
          </Card>
        </>
      ) : (
        <SearchBox value={search} onChange={setSearch} placeholder="Search course, professor, section, or joining code" />
      )}
      {!isReadOnly ? (
        <>
      <ListViewToolbar
        controls={{
          cardDensity: listView.cardDensity,
          onCardDensity: listView.setCardDensity,
          onTableDensity: listView.setTableDensity,
          onView: (nextView) => setPage(listView.switchViewPreservingPage(nextView, pageData.page, visible.length)),
          tableDensity: listView.tableDensity,
          view: listView.view,
        }}
      />
      <Card className="admin-panel admin-activity-panel">
        <div className="course-records-header">
          <h2>Course Records</h2>
          <Button variant="light" onClick={() => setShowArchived(true)}><FiArchive /> Archives</Button>
        </div>
        {listView.view === "cards" ? (
          <RecordCardList
            columns={columns}
            density={listView.cardDensity}
            rows={pageData.rows}
            titleKey="courseName"
            renderActions={(row) => <Button disabled={archiveActionId === row.id} variant="light" onClick={() => setArchiveCandidate(row)}><FiArchive /> Archive</Button>}
          />
        ) : (
          <Table className={`courses-table-wrap list-table-${listView.tableDensity}`} columns={columns} rows={pageData.rows} renderActions={Object.assign((row) => <Button disabled={archiveActionId === row.id} variant="light" onClick={() => setArchiveCandidate(row)}><FiArchive /> Archive</Button>, { width: "17%" })} />
        )}
        <ListPagination count={visible.length} page={pageData.page} pageSize={listView.pageSize} onPage={setPage} />
      </Card>
        </>
      ) : (
        <Card className="dean-dashboard-panel dean-courses-records-panel">
          <div className="dean-dashboard-section-header">
            <div>
              <h2>Course Records</h2>
              <p>Read-only course oversight with assigned professor and academic term details.</p>
            </div>
            <span>{visible.length} courses</span>
          </div>
          <ListViewToolbar
            controls={{
              cardDensity: listView.cardDensity,
              onCardDensity: listView.setCardDensity,
              onTableDensity: listView.setTableDensity,
              onView: (nextView) => setPage(listView.switchViewPreservingPage(nextView, pageData.page, visible.length)),
              tableDensity: listView.tableDensity,
              view: listView.view,
            }}
          />
          {coursesQuery.isError ? (
            <div className="dean-courses-state dean-courses-error" role="alert">
              <strong>Unable to load courses.</strong>
              <span>{coursesQuery.error.message}</span>
            </div>
          ) : coursesQuery.isLoading ? (
            <div className="dean-courses-state" aria-busy="true">
              <strong>Loading courses...</strong>
              <span>Fetching the current academic course records.</span>
            </div>
          ) : (
            <div className="dean-courses-table-scroll">
              {listView.view === "cards" ? (
                <RecordCardList
                  columns={columns}
                  density={listView.cardDensity}
                  empty={<EmptyState title="No courses match the current search." description="Adjust the search text to review course records." />}
                  rows={pageData.rows}
                  titleKey="courseName"
                />
              ) : (
                <Table
                  className={`dean-courses-table list-table-${listView.tableDensity}`}
                  columns={columns}
                  emptyDescription="Adjust the search text to review course records."
                  emptyTitle="No courses match the current search."
                  rows={pageData.rows}
                />
              )}
            </div>
          )}
          {!coursesQuery.isError && !coursesQuery.isLoading ? (
            <ListPagination count={visible.length} page={pageData.page} pageSize={listView.pageSize} onPage={setPage} />
          ) : null}
        </Card>
      )}
      {showArchived && !isReadOnly ? (
        <div className="modal-backdrop" onClick={() => setShowArchived(false)}>
          <Card className="modal" onClick={(event) => event.stopPropagation()}>
            <PageHeader title="Archived Courses" actions={<Button variant="light" onClick={() => setShowArchived(false)}>Close</Button>} />
            <Table className="archive-management-table" columns={columns} rows={archived} renderActions={Object.assign((row) => (
              <>
                <Button disabled={archiveActionId === row.id || deletingCourseId === row.id} variant="light" onClick={() => setRestoreCandidate(row)}>Restore</Button>
                <Button disabled={deletingCourseId === row.id} className="danger" variant="light" onClick={() => { setDeleteCandidate(row); setDeleteConfirmationText(""); }}><FiTrash2 /> Delete Permanently</Button>
              </>
            ), { width: "24%" })} />
          </Card>
        </div>
      ) : null}
      {archiveCandidate ? (
        <div className="modal-backdrop">
          <Card className="modal course-confirmation-modal">
            <h2>Archive Course?</h2>
            <p><strong>{archiveCandidate.courseName}</strong> will be moved to Archives. Its existing academic records will be preserved.</p>
            <div className="modal-actions">
              <Button disabled={archiveActionId === archiveCandidate.id} variant="light" onClick={() => setArchiveCandidate(null)}>Cancel</Button>
              <Button disabled={archiveActionId === archiveCandidate.id} onClick={() => setArchived(archiveCandidate.id, true)}>{archiveActionId === archiveCandidate.id ? "Archiving..." : "Archive"}</Button>
            </div>
          </Card>
        </div>
      ) : null}
      {restoreCandidate ? (
        <div className="modal-backdrop">
          <Card className="modal course-confirmation-modal">
            <h2>Restore Course?</h2>
            <p><strong>{restoreCandidate.courseName}</strong> will return to active Course Records.</p>
            <div className="modal-actions">
              <Button disabled={archiveActionId === restoreCandidate.id} variant="light" onClick={() => setRestoreCandidate(null)}>Cancel</Button>
              <Button disabled={archiveActionId === restoreCandidate.id} onClick={() => setArchived(restoreCandidate.id, false)}>{archiveActionId === restoreCandidate.id ? "Restoring..." : "Restore"}</Button>
            </div>
          </Card>
        </div>
      ) : null}
      {deleteCandidate ? (
        <div className="modal-backdrop">
          <Card className="modal course-confirmation-modal">
            <h2>Delete Permanently</h2>
            <p><strong>{deleteCandidate.courseName}</strong> ({deleteCandidate.courseCode}{deleteCandidate.section ? ` - ${deleteCandidate.section}` : ""}) and related academic records will be permanently removed.</p>
            <Field label="Type DELETE to confirm" value={deleteConfirmationText} onChange={(event) => setDeleteConfirmationText(event.target.value)} />
            <div className="modal-actions">
              <Button disabled={deletingCourseId === deleteCandidate.id} variant="light" onClick={() => { setDeleteCandidate(null); setDeleteConfirmationText(""); }}>Cancel</Button>
              <Button className="danger" disabled={!deleteConfirmed || deletingCourseId === deleteCandidate.id} onClick={permanentlyDeleteCourse}>
                {deletingCourseId === deleteCandidate.id ? "Deleting..." : "Delete Permanently"}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </section>
  );
}
