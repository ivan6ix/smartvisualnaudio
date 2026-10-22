import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Must match SCAN_ANGLES in src/lib/environmentScan.js. The browser sends one angle per request.
const scanAngles = new Set(["front", "left", "right", "upper", "desk"]);
const maximumImagesPerAngle = 5;
// Must match SCAN_REQUEST_CONFIDENCE in src/lib/environmentScan.js: predictions are returned down to
// this level and the browser applies the shared detection rules.
const scanRequestConfidence = 0.3;
// Legacy summary only; the browser classifies the per-frame predictions returned in `frames`.
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

class DetectorUnavailableError extends Error {
  constructor() {
    super("No environment detector is configured (ENV_SCAN_DETECTOR_ENDPOINT or ROBOFLOW_API_KEY with ROBOFLOW_ENV_MODEL_ID/ROBOFLOW_ENV_MODEL_VERSION).");
  }
}

// Roboflow hosted inference, called server-side so its private key stays in function secrets.
function getRoboflowUrl() {
  const apiKey = Deno.env.get("ROBOFLOW_API_KEY");
  const modelId = Deno.env.get("ROBOFLOW_ENV_MODEL_ID");
  const modelVersion = Deno.env.get("ROBOFLOW_ENV_MODEL_VERSION");
  if (!apiKey || !modelId || !modelVersion) return null;
  const apiBase = (Deno.env.get("ROBOFLOW_ENV_API_BASE") || "https://detect.roboflow.com").replace(/\/$/, "");
  const url = new URL(`${apiBase}/${modelId}/${modelVersion}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("confidence", String(Math.round(scanRequestConfidence * 100)));
  return url;
}

function buildDetectorRequest(frame: { angle: string; image: string }) {
  const endpoint = Deno.env.get("ENV_SCAN_DETECTOR_ENDPOINT");
  if (endpoint) {
    const apiKey = Deno.env.get("ENV_SCAN_DETECTOR_API_KEY");
    return {
      url: endpoint,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ image: frame.image, angle: frame.angle }),
      },
    };
  }
  const roboflowUrl = getRoboflowUrl();
  if (roboflowUrl) {
    return {
      url: roboflowUrl,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: frame.image.replace(/^data:[^,]*,/, ""),
      },
    };
  }
  // Without a detector nothing was checked; report it as an error so the scan cannot pass unchecked.
  throw new DetectorUnavailableError();
}

async function callExternalDetector(frame: { angle: string; image: string; frameIndex: number }) {
  const request = buildDetectorRequest(frame);

  let response: Response;
  try {
    response = await fetch(request.url, request.init);
  } catch {
    // Fetch errors include the request URL, which can carry the detector key; never return them.
    throw new Error(`Detector request failed for ${frame.angle} scan.`);
  }

  if (!response.ok) {
    throw new Error(`Detector request failed for ${frame.angle} scan.`);
  }

  const result = await response.json();
  const predictions = Array.isArray(result.predictions) ? result.predictions : Array.isArray(result.objects) ? result.objects : null;
  if (!predictions) throw new Error(`Detector returned an unexpected response for ${frame.angle} scan.`);
  return { angle: frame.angle, frameIndex: frame.frameIndex, image: result.image, predictions };
}

function toLegacyFindings(frame: { angle: string; predictions: Record<string, unknown>[] }) {
  return frame.predictions
    .filter((prediction) => isSuspiciousPrediction(prediction))
    .map((prediction) => ({
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

    // Each request carries one or more of the five scan angles; completeness is tracked per angle
    // in the browser, so a partial request is valid and never reported as an incomplete scan.
    const invalidFrame = !frames.length || frames.length > scanAngles.size || frames.some((frame) => (
      !scanAngles.has(String(frame?.angle)) || !normalizeFrameBatch(frame).length || normalizeFrameBatch(frame).length > maximumImagesPerAngle
    ));
    if (invalidFrame) {
      return json({ error: "Environment scan frames must name a scan angle and include 1-5 images." }, 400);
    }

    if (Deno.env.get("ENV_SCAN_FORCE_FINDINGS") === "true") {
      return json({
        passed: false,
        findings: [{ angle: String(frames[0].angle), label: "Demo suspicious item", confidence: 0.92 }],
        frames: [{ angle: String(frames[0].angle), frameIndex: 0, predictions: [{ class: "cell phone", confidence: 0.92 }] }],
      });
    }

    let frameIndex = 0;
    const sampledFrames = frames.flatMap((frame) => normalizeFrameBatch(frame)
      .map((image) => ({ angle: String(frame.angle), image, frameIndex: frameIndex++ })));

    const detectorFrames = await Promise.all(sampledFrames.map(callExternalDetector));
    const detectorFindings = detectorFrames.flatMap(toLegacyFindings);

    return json({
      passed: detectorFindings.length === 0,
      findings: detectorFindings,
      frames: detectorFrames,
    });
  } catch (error) {
    if (error instanceof DetectorUnavailableError) return json({ error: error.message }, 503);
    return json({ error: error instanceof Error ? error.message : "Unexpected scan error." }, 500);
  }
});
