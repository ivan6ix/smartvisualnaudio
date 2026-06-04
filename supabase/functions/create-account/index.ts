import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const allowedRoles = new Set(["Professor", "Dean", "Cluster Professor"]);
const adminRoles = new Set(["Admin", "Dean"]);

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
      .select("role")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (callerError || !caller || !adminRoles.has(caller.role)) {
      return json({ error: "Only admin or dean accounts can manage accounts." }, 403);
    }

    const body = await req.json();
    const action = body.action || "create";

    if (action === "create") {
      const role = String(body.role || "");
      const fullName = String(body.fullName || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const employeeNumber = String(body.employeeNumber || "").trim();
      const password = String(body.password || "123456");

      if (!allowedRoles.has(role)) return json({ error: "Invalid account role." }, 400);
      if (!fullName || !email || !employeeNumber) return json({ error: "Full name, email, and employee number are required." }, 400);
      if (password.length < 6) return json({ error: "Password must be at least 6 characters." }, 400);

      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          role,
          status: "Active",
          full_name: fullName,
          employee_number: employeeNumber,
        },
      });

      if (error) return json({ error: error.message }, 400);
      if (!data.user) return json({ error: "Account was not created." }, 500);

      const { data: profile, error: profileError } = await adminClient
        .from("profiles")
        .upsert({
          id: data.user.id,
          role,
          full_name: fullName,
          email,
          employee_number: employeeNumber,
          status: "Active",
        })
        .select("id, role, full_name, email, employee_number, status, created_at")
        .single();

      if (profileError) return json({ error: profileError.message }, 400);

      if (role === "Cluster Professor") {
        await adminClient.from("cluster_professors").upsert({
          id: data.user.id,
          full_name: fullName,
          email,
          role,
          account_status: "Active",
        });
      }

      return json({ profile });
    }

    if (action === "update-status") {
      const userId = String(body.userId || "");
      const status = String(body.status || "");
      if (!userId || !["Active", "Deactivated"].includes(status)) return json({ error: "Invalid status update." }, 400);

      const { data: currentUser, error: currentUserError } = await adminClient.auth.admin.getUserById(userId);
      if (currentUserError || !currentUser.user) return json({ error: currentUserError?.message || "User not found." }, 404);

      const metadata = { ...(currentUser.user.user_metadata || {}), status };
      const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(userId, { user_metadata: metadata });
      if (authUpdateError) return json({ error: authUpdateError.message }, 400);

      const { data: profile, error: profileError } = await adminClient
        .from("profiles")
        .update({ status })
        .eq("id", userId)
        .select("id, role, full_name, email, employee_number, status, created_at")
        .single();

      if (profileError) return json({ error: profileError.message }, 400);
      return json({ profile });
    }

    if (action === "reset-password") {
      const userId = String(body.userId || "");
      const password = String(body.password || "123456");
      if (!userId) return json({ error: "User ID is required." }, 400);
      if (password.length < 6) return json({ error: "Password must be at least 6 characters." }, 400);

      const { error } = await adminClient.auth.admin.updateUserById(userId, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Unsupported action." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected server error." }, 500);
  }
});
