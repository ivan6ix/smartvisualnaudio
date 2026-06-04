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
      return json({ error: "Missing Brevo or Supabase function secrets." }, 500);
    }

    const { email } = await req.json();
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail) return json({ error: "Email is required." }, 400);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email: normalizedEmail,
      options: { redirectTo: `${siteUrl.replace(/\/$/, "")}/forgot-password` },
    });

    if (error) return json({ error: error.message }, 400);

    const actionLink = data.properties?.action_link;
    if (!actionLink) return json({ error: "Password reset link was not generated." }, 500);

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
      const message = await brevoResponse.text();
      return json({ error: message || "Brevo email sending failed." }, 500);
    }

    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected server error." }, 500);
  }
});
