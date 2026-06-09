import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const requiredAngles = new Set(["left", "center", "right"]);
const minimumFramesPerAngle = 3;
const minimumPanProgress = 100;
const suspiciousLabels = [
  "phone",
  "cell phone",
  "mobile phone",
  "book",
  "notebook",
  "paper",
  "notes",
  "tablet",
  "laptop",
  "monitor",
  "screen",
  "headphones",
  "earbuds",
  "calculator",
];

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeLabel(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function isSuspiciousPrediction(prediction: Record<string, unknown>) {
  const label = normalizeLabel(prediction.class || prediction.label || prediction.name);
  const confidence = Number(prediction.confidence || prediction.score || 0);
  return confidence >= 0.45 && suspiciousLabels.some((item) => label.includes(item));
}

async function callExternalDetector(frame: { angle: string; image: string }) {
  const endpoint = Deno.env.get("ENV_SCAN_DETECTOR_ENDPOINT");
  const apiKey = Deno.env.get("ENV_SCAN_DETECTOR_API_KEY");

  if (!endpoint) return [];

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ image: frame.image, angle: frame.angle }),
  });

  if (!response.ok) {
    throw new Error(`Detector request failed for ${frame.angle} scan.`);
  }

  const result = await response.json();
  const predictions = Array.isArray(result.predictions) ? result.predictions : Array.isArray(result.objects) ? result.objects : [];
  return predictions
    .filter((prediction: Record<string, unknown>) => isSuspiciousPrediction(prediction))
    .map((prediction: Record<string, unknown>) => ({
      angle: frame.angle,
      label: prediction.class || prediction.label || prediction.name || "Suspicious item",
      confidence: Number(prediction.confidence || prediction.score || 0),
    }));
}

function normalizeFrameBatch(frame: Record<string, unknown>) {
  if (Array.isArray(frame.images)) return frame.images.filter(Boolean).map(String);
  if (frame.image) return [String(frame.image)];
  return [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !anonKey) {
      return json({ error: "Missing Supabase function environment variables." }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) {
      return json({ error: "Unauthorized request." }, 401);
    }

    const body = await req.json();
    const frames = Array.isArray(body.frames) ? body.frames : [];

    if (frames.length !== 3) {
      return json({ error: "Environment scan requires left, center, and right frames." }, 400);
    }

    const missingAngles = [...requiredAngles].filter((angle) => {
      const frame = frames.find((item) => item.angle === angle);
      return !frame || normalizeFrameBatch(frame).length < minimumFramesPerAngle;
    });

    if (missingAngles.length) {
      return json({ error: `Incomplete live scan for: ${missingAngles.join(", ")}.` }, 400);
    }

    const lowMovementAngles = ["left", "right"].filter((angle) => {
      const frame = frames.find((item) => item.angle === angle);
      return Number(frame?.movementScore || 0) < minimumPanProgress;
    });

    if (lowMovementAngles.length) {
      return json({
        passed: false,
        findings: lowMovementAngles.map((angle) => ({
          angle,
          label: `${angle} scan movement too low`,
          confidence: 1,
        })),
      });
    }

    if (Deno.env.get("ENV_SCAN_FORCE_FINDINGS") === "true") {
      return json({
        passed: false,
        findings: [{ angle: "center", label: "Demo suspicious item", confidence: 0.92 }],
      });
    }

    const sampledFrames = frames.flatMap((frame) => {
      const images = normalizeFrameBatch(frame);
      const first = images[0];
      const middle = images[Math.floor(images.length / 2)];
      const last = images[images.length - 1];
      return [...new Set([first, middle, last].filter(Boolean))].map((image) => ({ angle: frame.angle, image }));
    });

    const detectorFindings = (await Promise.all(sampledFrames.map(callExternalDetector))).flat();

    return json({
      passed: detectorFindings.length === 0,
      findings: detectorFindings,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected scan error." }, 500);
  }
});
