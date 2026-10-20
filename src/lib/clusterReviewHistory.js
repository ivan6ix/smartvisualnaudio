// Shapes rows from get_cluster_review_history(): one entry per review decision,
// with a shared exam's per-course rows collapsed into a single entry.

function courseText(row) {
  const count = Number(row.shared_course_count || 1);
  return row.group_id && count > 1 ? `${row.course_label} (Shared across ${count} courses)` : row.course_label;
}

export function collapseReviewHistory(rows = []) {
  const seen = new Set();
  const entries = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = row.group_id ? `${row.group_id}|${row.decision}|${row.review_date}|${row.remarks}` : row.review_id;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      id: row.review_id,
      examId: row.exam_id,
      groupId: row.group_id || "",
      examTitle: row.exam_title,
      professorName: row.professor_name,
      course: courseText(row),
      reviewDate: row.review_date,
      decision: row.decision,
      remarks: row.remarks || "",
    });
  }
  return entries;
}

export function currentApprovals(rows = []) {
  const seen = new Set();
  const approvals = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row.currently_approved) continue;
    const key = row.group_id || row.exam_id;
    if (seen.has(key)) continue;
    seen.add(key);
    approvals.push({
      id: row.exam_id,
      groupId: row.group_id || "",
      sharedCourseCount: row.group_id ? Number(row.shared_course_count || 1) : 0,
      examTitle: row.exam_title,
      professorName: row.professor_name,
      course: courseText(row),
      approvedAt: row.approved_at,
      examStatus: row.exam_status,
    });
  }
  return approvals;
}
