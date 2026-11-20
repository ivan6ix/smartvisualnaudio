// A shared exam is stored as one exam per course. The professor's list shows it once: the newest copy stands for
// the group, its Course column names every course, and "Shared across N courses" stays under the title. Group
// actions (publish, unpublish, archive, submit for review) already apply to every copy through the group RPCs.
export function collapseSharedExams(exams) {
  const seen = new Set();
  const out = [];
  for (const exam of exams) {
    if (!exam.groupId) {
      out.push(exam);
      continue;
    }
    if (seen.has(exam.groupId)) continue;
    seen.add(exam.groupId);
    const courses = exam.sharedCourses?.length ? exam.sharedCourses : [exam.course];
    out.push({ ...exam, course: courses.join(", "), courseMeta: courses.length > 1 ? `${courses.length} courses` : exam.courseMeta });
  }
  return out;
}
