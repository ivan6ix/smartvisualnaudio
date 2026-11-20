import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const allowedRoles = new Set(["Professor", "Dean", "Cluster Professor"]);
// Only active Admins manage accounts. Deans have no account pages, and letting them reset any password
// let a Dean take over an Admin account.
const adminRoles = new Set(["Admin"]);
// About 100 years: Supabase Auth has no permanent ban, so a deactivated account is banned until reactivated.
const DEACTIVATED_BAN_DURATION = "876000h";

async function writeAudit(
  adminClient: ReturnType<typeof createClient>,
  event: {
    userId: string;
    actorRole: string;
    eventType: string;
    action: string;
    description: string;
    entityType: string;
    entityId?: string;
    targetUserId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await adminClient.from("logs").insert({
    user_id: event.userId,
    actor_role: event.actorRole,
    event_type: event.eventType,
    action: event.action,
    description: event.description,
    entity_type: event.entityType,
    entity_id: event.entityId || null,
    target_user_id: event.targetUserId || null,
    metadata: event.metadata || {},
  });
}

// Every staff account belongs to one program (profiles.program_id); a Cluster Professor also reviews the exams of
// that program (cluster_professors.program_id). Returns the active program, or an error message.
async function findActiveProgram(adminClient: ReturnType<typeof createClient>, programId: string) {
  const { data: program, error } = await adminClient
    .from("programs")
    .select("id, program_code, is_active")
    .eq("id", programId)
    .maybeSingle();
  if (error || !program) return { program: null, error: "Choose a program for this account." };
  if (!program.is_active) return { program: null, error: `${program.program_code} is inactive. Choose an active program.` };
  return { program, error: "" };
}

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
      .select("role, status")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (callerError || !caller || !adminRoles.has(caller.role) || caller.status !== "Active") {
      return json({ error: "Only active admin accounts can manage accounts." }, 403);
    }

    const body = await req.json();
    const action = body.action || "create";

    if (action === "create") {
      const role = String(body.role || "");
      const fullName = String(body.fullName || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "123456");

      if (!allowedRoles.has(role)) return json({ error: "Invalid account role." }, 400);
      if (!fullName || !email) return json({ error: "Full name and email are required." }, 400);
      if (password.length < 6) return json({ error: "Password must be at least 6 characters." }, 400);

      // The program may be given now (the Create Account form requires it) or later with assign-program
      // (bulk-created accounts without a program column). A Cluster Professor without one sees no exams to review.
      const programId = String(body.programId || "").trim();
      let program: { id: string; program_code: string } | null = null;
      if (programId) {
        const found = await findActiveProgram(adminClient, programId);
        if (found.error) return json({ error: found.error }, 400);
        program = found.program;
      }

      // Emails are unique. Check first, because a clash inside Auth only reports "Database error creating new user".
      const { data: sameEmail } = await adminClient
        .from("profiles")
        .select("full_name")
        .eq("email", email)
        .limit(1)
        .maybeSingle();
      if (sameEmail) {
        return json({ error: `The email ${email} is already used by ${sameEmail.full_name}. Enter a different email.` }, 409);
      }

      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          role,
          status: "Active",
          full_name: fullName,
          // The Admin chose this password, so the user must replace it at first sign-in.
          must_change_password: true,
        },
      });

      if (error) {
        const message = /database error/i.test(error.message)
          ? "The account could not be created. The email may already be in use."
          : error.message;
        return json({ error: message }, 400);
      }
      if (!data.user) return json({ error: "Account was not created." }, 500);

      const { data: profile, error: profileError } = await adminClient
        .from("profiles")
        .upsert({
          id: data.user.id,
          role,
          full_name: fullName,
          email,
          status: "Active",
          program_id: program?.id || null,
        })
        .select("id, role, full_name, email, status, program_id, created_at")
        .single();

      if (profileError) return json({ error: profileError.message }, 400);

      if (role === "Cluster Professor") {
        await adminClient.from("cluster_professors").upsert({
          id: data.user.id,
          full_name: fullName,
          email,
          role,
          account_status: "Active",
          program_id: program?.id || null,
        });
      }

      await writeAudit(adminClient, {
        userId: authData.user.id,
        actorRole: caller.role,
        eventType: "account.created",
        action: "Account Created",
        description: "An admin created an account.",
        entityType: "account",
        entityId: data.user.id,
        targetUserId: data.user.id,
        metadata: { role, status: "Active", ...(program ? { program: program.program_code } : {}) },
      });

      return json({ profile });
    }

    if (action === "assign-program") {
      const userId = String(body.userId || "");
      const programId = String(body.programId || "").trim();
      if (!userId || !programId) return json({ error: "Choose an account and a program." }, 400);

      const { data: target, error: targetError } = await adminClient
        .from("profiles")
        .select("id, role, full_name, email, status, program_id")
        .eq("id", userId)
        .maybeSingle();
      if (targetError || !target) return json({ error: "Account not found." }, 404);
      if (!allowedRoles.has(target.role)) return json({ error: "Only Professor, Dean, and Cluster Professor accounts are assigned a program." }, 400);

      const found = await findActiveProgram(adminClient, programId);
      if (found.error || !found.program) return json({ error: found.error }, 400);

      const { error: profileUpdateError } = await adminClient.from("profiles").update({ program_id: found.program.id }).eq("id", userId);
      if (profileUpdateError) return json({ error: profileUpdateError.message }, 400);

      // A Cluster Professor's review program is kept in cluster_professors as well, which the review rules use.
      if (target.role === "Cluster Professor") {
        const { error: assignError } = await adminClient.from("cluster_professors").upsert({
          id: target.id,
          full_name: target.full_name,
          email: target.email,
          role: target.role,
          account_status: target.status,
          program_id: found.program.id,
        });
        if (assignError) return json({ error: assignError.message }, 400);
      }

      await writeAudit(adminClient, {
        userId: authData.user.id,
        actorRole: caller.role,
        eventType: "account.program_assigned",
        action: "Program Assigned",
        description: target.role === "Cluster Professor" ? "An admin assigned a Cluster Professor's review program." : `An admin assigned a ${target.role}'s program.`,
        entityType: "account",
        entityId: userId,
        targetUserId: userId,
        metadata: { program: found.program.program_code, previous_program_id: target.program_id || null },
      });
      return json({ userId, programId: found.program.id });
    }

    if (action === "update-status") {
      const userId = String(body.userId || "");
      const status = String(body.status || "");
      if (!userId || !["Active", "Deactivated"].includes(status)) return json({ error: "Invalid status update." }, 400);

      const { data: currentUser, error: currentUserError } = await adminClient.auth.admin.getUserById(userId);
      if (currentUserError || !currentUser.user) return json({ error: currentUserError?.message || "User not found." }, 404);

      const metadata = { ...(currentUser.user.user_metadata || {}), status };
      // A deactivated account is banned in Supabase Auth so it cannot sign in; reactivation lifts the ban.
      const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(userId, {
        user_metadata: metadata,
        ban_duration: status === "Deactivated" ? DEACTIVATED_BAN_DURATION : "none",
      });
      if (authUpdateError) return json({ error: authUpdateError.message }, 400);

      const { data: profile, error: profileError } = await adminClient
        .from("profiles")
        .update({ status })
        .eq("id", userId)
        .select("id, role, full_name, email, status, program_id, created_at")
        .single();

      if (profileError) return json({ error: profileError.message }, 400);
      await writeAudit(adminClient, {
        userId: authData.user.id,
        actorRole: caller.role,
        eventType: status === "Active" ? "account.activated" : "account.deactivated",
        action: status === "Active" ? "Account Activated" : "Account Deactivated",
        description: status === "Active" ? "An admin activated an account." : "An admin deactivated an account.",
        entityType: "account",
        entityId: userId,
        targetUserId: userId,
        metadata: { status },
      });
      return json({ profile });
    }

    if (action === "reset-password") {
      const userId = String(body.userId || "");
      const password = String(body.password || "123456");
      if (!userId) return json({ error: "User ID is required." }, 400);
      if (password.length < 6) return json({ error: "Password must be at least 6 characters." }, 400);

      const { data: currentUser, error: currentUserError } = await adminClient.auth.admin.getUserById(userId);
      if (currentUserError || !currentUser.user) return json({ error: currentUserError?.message || "User not found." }, 404);

      // The Admin knows the reset password, so the user must replace it at their next sign-in.
      const metadata = { ...(currentUser.user.user_metadata || {}), must_change_password: true };
      const { error } = await adminClient.auth.admin.updateUserById(userId, { password, user_metadata: metadata });
      if (error) return json({ error: error.message }, 400);
      await writeAudit(adminClient, {
        userId: authData.user.id,
        actorRole: caller.role,
        eventType: "account.password_reset_admin",
        action: "Password Reset By Admin",
        description: "An admin reset an account password.",
        entityType: "account",
        entityId: userId,
        targetUserId: userId,
      });
      return json({ ok: true });
    }

    return json({ error: "Unsupported action." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected server error." }, 500);
  }
});
