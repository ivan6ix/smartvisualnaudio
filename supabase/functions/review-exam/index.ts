import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: "Missing Supabase function environment variables." }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) {
      return json({ error: "Unauthorized request." }, 401);
    }

    const { data: caller, error: callerError } = await adminClient
      .from("profiles")
      .select("id, role, full_name")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (callerError || !caller || caller.role !== "Cluster Professor") {
      return json({ error: "Only cluster professor accounts can review exams." }, 403);
    }

    const body = await req.json();
    const action = String(body.action || "");
    const examId = String(body.examId || "");
    const remarks = String(body.remarks || "").trim();

    if (!examId || !["approve", "reject"].includes(action)) {
      return json({ error: "Invalid review request." }, 400);
    }
    if (action === "reject" && !remarks) {
      return json({ error: "Reason for rejection is required." }, 400);
    }

    const { data: exam, error: examError } = await adminClient
      .from("exams")
      .select("id, title, exam_title, professor_id, created_by")
      .eq("id", examId)
      .maybeSingle();

    if (examError) return json({ error: examError.message }, 400);
    if (!exam) return json({ error: "Exam not found." }, 404);

    const now = new Date().toISOString();
    const decision = action === "approve" ? "Approved" : "Rejected";
    const professorId = exam.professor_id || exam.created_by;
    const examTitle = exam.exam_title || exam.title || "Untitled exam";
    const finalRemarks = remarks || "Approved for publishing.";

    const { data: updatedExam, error: updateError } = await adminClient
      .from("exams")
      .update({
        status: decision,
        approved_at: action === "approve" ? now : null,
        rejected_at: action === "reject" ? now : null,
      })
      .eq("id", examId)
      .select("id, status, approved_at, rejected_at, professor_id, created_by")
      .single();

    if (updateError) return json({ error: updateError.message }, 400);

    const { data: review, error: reviewError } = await adminClient
      .from("exam_reviews")
      .insert({
        exam_id: examId,
        cluster_professor_id: caller.id,
        decision,
        remarks: finalRemarks,
      })
      .select("id, exam_id, decision, remarks, review_date")
      .single();

    if (reviewError) return json({ error: reviewError.message }, 400);

    if (professorId) {
      await adminClient.from("notifications").insert({
        user_id: professorId,
        title: action === "approve" ? "Exam approved" : "Exam rejected",
        message: action === "approve"
          ? `${examTitle} was approved by the cluster professor. You may now publish it for students.`
          : `${examTitle} was rejected by the cluster professor. ${finalRemarks}`,
        type: "Exam Review",
      });
    }

    return json({ exam: updatedExam, review });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected server error." }, 500);
  }
});
