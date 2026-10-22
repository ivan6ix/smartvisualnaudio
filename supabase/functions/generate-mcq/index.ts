import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  GENERATION_LIMITS,
  createFakeQuestions,
  shuffleChoices,
  validateGeneratedQuestions,
  validateGenerationRequest,
} from "./mcq.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LIMIT_RESPONSES: Record<string, [string, number]> = {
  duplicate: ["This request was already received. Try again.", 409],
  in_flight: ["Another set of questions is still being generated. Wait for it to finish.", 409],
  window_limit: ["Too many generation requests. Wait a few minutes and try again.", 429],
  daily_limit: ["You reached today's question generation limit. Try again tomorrow.", 429],
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function readLimit(name: string, fallback: number) {
  const value = Number(Deno.env.get(name));
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

// The edge runtime only returns a response once the request body is consumed; a cancelled body leaves the
// caller waiting for the gateway timeout. Oversized bodies are therefore discarded up to this size so the
// caller gets a 413, and only larger ones are cancelled.
const DISCARD_LIMIT_BYTES = 8 * 1024 * 1024;

async function discardBody(reader: ReadableStreamDefaultReader<Uint8Array>, alreadyRead: number) {
  let total = alreadyRead;
  while (total <= DISCARD_LIMIT_BYTES) {
    const { done, value } = await reader.read();
    if (done) return;
    total += value.byteLength;
  }
  await reader.cancel();
}

// Returns the body text, or null when it is larger than maxBytes.
async function readBodyText(req: Request, maxBytes: number) {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await discardBody(reader, total);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

// Only counts and timings are logged; PDF text and generated content never are.
function logOutcome(fields: Record<string, unknown>) {
  console.info(JSON.stringify({ event: "generate-mcq", ...fields }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }
  if (Number(req.headers.get("Content-Length") || 0) > DISCARD_LIMIT_BYTES) {
    await req.body?.cancel();
    return json({ error: "The PDF text is too large. Choose a smaller page range." }, 413);
  }

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
    .select("id, role, status")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (callerError || !caller || caller.role !== "Professor" || caller.status !== "Active") {
    return json({ error: "Only active professor accounts can generate questions." }, 403);
  }

  const rawBody = await readBodyText(req, GENERATION_LIMITS.maxBodyBytes);
  if (rawBody === null) {
    return json({ error: "The PDF text is too large. Choose a smaller page range." }, 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const { request, error: requestError } = validateGenerationRequest(body);
  if (!request) {
    return json({ error: requestError }, 400);
  }

  const { data: claim, error: claimError } = await adminClient.rpc("claim_ai_question_generation", {
    p_user_id: caller.id,
    p_request_key: request.requestKey,
    p_question_count: request.count,
    p_difficulty: request.difficulty,
    p_page_count: request.pages.length,
    p_char_count: request.pages.reduce((total: number, page: { text: string }) => total + page.text.length, 0),
    p_window_minutes: readLimit("MCQ_RATE_WINDOW_MINUTES", 10),
    p_window_limit: readLimit("MCQ_RATE_WINDOW_LIMIT", 15),
    p_daily_limit: readLimit("MCQ_RATE_DAILY_LIMIT", 60),
    p_in_flight_minutes: 3,
  });
  if (claimError || !claim) {
    return json({ error: "Questions could not be generated. Try again." }, 500);
  }
  if (!claim.ok) {
    const [message, status] = LIMIT_RESPONSES[claim.reason] || ["Questions could not be generated. Try again.", 500];
    logOutcome({ userId: caller.id, status: claim.reason });
    return json({ error: message, reason: claim.reason }, status);
  }

  const requestId = claim.id;
  const startedAt = Date.now();
  async function finish(fields: Record<string, unknown>) {
    await adminClient
      .from("ai_question_generation_requests")
      .update({ ...fields, completed_at: new Date().toISOString() })
      .eq("id", requestId);
  }

  // Sample mode builds questions from the text without calling an AI provider (local testing only).
  const sampleMode = Deno.env.get("MCQ_FORCE_FAKE") === "true";
  try {
    if (!sampleMode) {
      await finish({ status: "failed", error_code: "not_configured" });
      logOutcome({ userId: caller.id, requestId, status: "not_configured" });
      return json({ error: "AI question generation is not available yet." }, 503);
    }

    const generated = createFakeQuestions(request);
    const { questions: checked, rejected } = validateGeneratedQuestions(generated, request);
    const shuffled = checked.map((item) => shuffleChoices(item));
    const returnedCount = shuffled.length;

    await finish({ status: "succeeded", returned_count: returnedCount, model: "sample" });
    logOutcome({ userId: caller.id, requestId, status: "succeeded", requestedCount: request.count, returnedCount, rejected, ms: Date.now() - startedAt });
    return json({ questions: shuffled, requested: request.count, rejected, sample: true });
  } catch {
    await finish({ status: "failed", error_code: "internal" });
    logOutcome({ userId: caller.id, requestId, status: "failed" });
    return json({ error: "Questions could not be generated. Try again." }, 500);
  }
});
