// Who reviews a professor's exam: the active Cluster Professors assigned to the program(s) of its course(s).
// A shared exam whose courses are in several programs can be reviewed by the clusters of any of them.

export async function getReviewTargets(supabase, { examId = null, courseIds = [] } = {}) {
  const { data, error } = await supabase.rpc("get_review_targets", {
    p_exam_id: examId || null,
    p_course_ids: courseIds.length ? courseIds : null,
  });
  if (error) throw error;
  return { programs: data?.programs || [], clusters: data?.clusters || [] };
}

// A message when nobody can review the exam yet, or "" when it can be submitted.
export function reviewTargetsProblem({ programs = [], clusters = [] } = {}) {
  if (!programs.length) {
    return "This exam's course has no program yet, so no Cluster Professor can review it. Ask the Admin to set the course's program, or publish directly.";
  }
  if (!clusters.length) {
    return `No Cluster Professor is assigned to ${programs.join(", ")} yet. Ask the Admin to assign one, or publish directly.`;
  }
  return "";
}

// Sends the "waiting for review" notification to each assigned Cluster Professor. Returns the first error, if any.
export async function notifyReviewClusters(supabase, { clusters, examId, examTitle }) {
  const results = await Promise.all(clusters.map((cluster) => supabase.rpc("create_notification", {
    p_workflow: "exam_review_request",
    p_recipient_id: cluster.id,
    p_title: "New exam submitted for review",
    p_message: `${examTitle} is waiting for cluster review.`,
    p_type: "Exam",
    p_context_id: examId,
    p_entity_type: "exam",
    p_entity_id: examId,
    p_action_path: `/cluster/exams/${examId}`,
  })));
  return results.find((result) => result.error)?.error || null;
}
