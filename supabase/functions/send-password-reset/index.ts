import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Anyone can call this without signing in, so every handled request gets the same answer: it never says whether
// an email has an account. Real accounts get at most RESETS_PER_HOUR emails an hour (counted from the request logs),
// so the form can't flood an inbox or use up the Brevo quota.
const RESETS_PER_HOUR = 3;
const SENT_MESSAGE = "If that email has an account, a password reset link is on its way.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function htmlTemplate(actionLink: string) {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
      <h2>Reset your password</h2>
      <p>Click the button below to create a new password.</p>
      <p><a href="${actionLink}" style="display:inline-block;background:#111827;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Reset Password</a></p>
      <p>If the button does not work, open this link:</p>
      <p><a href="${actionLink}">${actionLink}</a></p>
    </div>
  `;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const brevoApiKey = Deno.env.get("BREVO_API_KEY");
    const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL");
    const senderName = Deno.env.get("BREVO_SENDER_NAME") || "Smart Proctoring System";
    const siteUrl = Deno.env.get("SITE_URL") || new URL(req.url).origin;

    if (!supabaseUrl || !serviceRoleKey || !brevoApiKey || !senderEmail) {
      console.error("[send-password-reset] Missing Brevo or Supabase function secrets.");
      return json({ error: "Unable to send the reset email right now. Try again later." }, 500);
    }

    const { email } = await req.json().catch(() => ({}));
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail || normalizedEmail.length > 254 || !EMAIL_PATTERN.test(normalizedEmail)) {
      return json({ error: "Enter a valid email address." }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: requester, error: requesterError } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("email", normalizedEmail)
      .maybeSingle();
    if (requesterError) {
      console.error("[send-password-reset] Account lookup failed", requesterError.message);
      return json({ error: "Unable to send the reset email right now. Try again later." }, 500);
    }
    if (!requester?.id) return json({ ok: true, message: SENT_MESSAGE });

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentResets, error: countError } = await adminClient
      .from("logs")
      .select("id", { count: "exact", head: true })
      .eq("target_user_id", requester.id)
      .eq("event_type", "account.password_reset_requested")
      .gte("created_at", since);
    if (countError) {
      console.error("[send-password-reset] Rate limit check failed", countError.message);
      return json({ error: "Unable to send the reset email right now. Try again later." }, 500);
    }
    if ((recentResets || 0) >= RESETS_PER_HOUR) return json({ ok: true, message: SENT_MESSAGE });

    const { data, error } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email: normalizedEmail,
      options: { redirectTo: `${siteUrl.replace(/\/$/, "")}/forgot-password` },
    });

    const actionLink = data?.properties?.action_link;
    if (error || !actionLink) {
      console.error("[send-password-reset] Reset link was not generated", error?.message);
      return json({ error: "Unable to send the reset email right now. Try again later." }, 500);
    }

    const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": brevoApiKey,
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        to: [{ email: normalizedEmail }],
        subject: "Reset your Smart Proctoring password",
        htmlContent: htmlTemplate(actionLink),
      }),
    });

    if (!brevoResponse.ok) {
      // Brevo's error text stays in the function logs; callers only see a generic message.
      console.error("[send-password-reset] Brevo email sending failed", brevoResponse.status, await brevoResponse.text());
      return json({ error: "Unable to send the reset email right now. Try again later." }, 500);
    }

    // This row is also what the hourly limit counts.
    await adminClient.from("logs").insert({
      user_id: requester.id,
      actor_role: requester.role,
      event_type: "account.password_reset_requested",
      action: "Password Reset Request",
      description: "A user requested a password reset.",
      entity_type: "account",
      entity_id: requester.id,
      target_user_id: requester.id,
      metadata: {},
    });

    return json({ ok: true, message: SENT_MESSAGE });
  } catch (error) {
    console.error("[send-password-reset] Unexpected error", error instanceof Error ? error.message : error);
    return json({ error: "Unable to send the reset email right now. Try again later." }, 500);
  }
});
