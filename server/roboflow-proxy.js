/* global console, fetch, process, URL */
import express from "express";
import { existsSync, readFileSync } from "fs";
import { InferenceHTTPClient, WorkflowError } from "@roboflow/inference-sdk";

function loadLocalEnv() {
  if (!existsSync(".env")) return;
  const lines = readFileSync(".env", "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) return;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
    process.env[key] ??= value;
  });
}

loadLocalEnv();

const app = express();
const port = Number(process.env.ROBOFLOW_PROXY_PORT || 3001);
const allowedOrigin = process.env.ROBOFLOW_PROXY_ORIGIN || "http://localhost:5173";
const roboflowGadgetLabels = new Set([
  "cell phone",
  "mobile phone",
  "phone",
  "smartphone",
  "cellphone",
  "tablet",
  "laptop",
]);

app.use(express.json({ limit: "10mb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  return next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

function normalizePrediction(value) {
  const label = String(value?.class || value?.label || value?.name || value?.class_name || "").toLowerCase();
  const confidence = Number(value?.confidence ?? value?.score ?? value?.probability ?? 0);
  return { ...value, label, confidence };
}

function collectPredictions(value, items = []) {
  if (!value) return items;
  if (Array.isArray(value)) {
    value.forEach((item) => collectPredictions(item, items));
    return items;
  }
  if (typeof value !== "object") return items;

  const prediction = normalizePrediction(value);
  if (prediction.label && Number.isFinite(prediction.confidence)) {
    items.push(prediction);
  }

  Object.entries(value).forEach(([key, nested]) => {
    if (key === "image" || key === "output_image" || key === "annotated_image") return;
    collectPredictions(nested, items);
  });
  return items;
}

function formatFinding(prediction, angle) {
  const percent = Math.round(prediction.confidence * 100);
  const labelMap = {
    "cell phone": "Phone detected",
    "mobile phone": "Phone detected",
    phone: "Phone detected",
    smartphone: "Phone detected",
    cellphone: "Phone detected",
    tablet: "Tablet detected",
    laptop: "Laptop detected",
  };

  return {
    angle,
    class: prediction.label,
    name: prediction.label,
    label: `${labelMap[prediction.label] || "Spare gadget detected"} by Roboflow`,
    detected: true,
    confidence: prediction.confidence,
    instruction: `Remove the detected item from your exam area and scan again. Confidence: ${percent}%.`,
  };
}

function getRoboflowImageEndpoint() {
  if (process.env.ROBOFLOW_ENV_INFER_URL) return process.env.ROBOFLOW_ENV_INFER_URL;
  const modelId = process.env.ROBOFLOW_ENV_MODEL_ID;
  const modelVersion = process.env.ROBOFLOW_ENV_MODEL_VERSION;
  const apiBase = process.env.ROBOFLOW_ENV_API_BASE || "https://detect.roboflow.com";
  if (!modelId || !modelVersion) return null;
  return `${apiBase.replace(/\/$/, "")}/${modelId}/${modelVersion}`;
}

async function runRoboflowImageDetection(image) {
  const endpoint = getRoboflowImageEndpoint();
  const apiKey = process.env.ROBOFLOW_API_KEY;
  const confidence = Number(process.env.ROBOFLOW_ENV_CONFIDENCE || 0.7);

  if (!apiKey) throw new Error("ROBOFLOW_API_KEY is not configured.");
  if (!endpoint) throw new Error("ROBOFLOW_ENV_MODEL_ID and ROBOFLOW_ENV_MODEL_VERSION are required.");

  const url = new URL(endpoint);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("confidence", String(Math.round(confidence * 100)));

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: image,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Roboflow image detection failed.");
  }

  return response.json();
}

app.post("/api/environment-scan", async (req, res) => {
  try {
    const { frames = [] } = req.body || {};
    const confidence = Number(process.env.ROBOFLOW_ENV_CONFIDENCE || 0.7);
    const detectedLabels = new Set();

    if (!Array.isArray(frames) || !frames.length) {
      return res.status(400).json({ error: "frames are required." });
    }

    const findings = [];
    for (const frameGroup of frames) {
      const images = Array.isArray(frameGroup?.images) ? frameGroup.images : [];
      for (const image of images) {
        const result = await runRoboflowImageDetection(image);
        const detectedPredictions = collectPredictions(result).filter((prediction) => (
          roboflowGadgetLabels.has(prediction.label)
          && prediction.confidence >= confidence
        ));

        detectedPredictions.forEach((prediction) => {
          if (detectedLabels.has(prediction.label)) return;
          detectedLabels.add(prediction.label);
          findings.push(formatFinding(prediction, frameGroup.angle || "environment scan"));
        });
      }
    }

    return res.json({ passed: findings.length === 0, findings });
  } catch (error) {
    console.error("[RoboflowProxy] environment-scan", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Roboflow environment scan failed.",
    });
  }
});

app.post("/api/init-webrtc", async (req, res) => {
  try {
    if (!process.env.ROBOFLOW_API_KEY) {
      return res.status(500).json({ error: "ROBOFLOW_API_KEY is not configured." });
    }

    const { offer, wrtcParams } = req.body || {};
    if (!offer || !wrtcParams?.workspaceName || !wrtcParams?.workflowId) {
      return res.status(400).json({ error: "offer, workspaceName, and workflowId are required." });
    }

    const client = InferenceHTTPClient.init({
      apiKey: process.env.ROBOFLOW_API_KEY,
    });

    const answer = await client.initializeWebrtcWorker({
      offer,
      workspaceName: wrtcParams.workspaceName,
      workflowId: wrtcParams.workflowId,
      config: {
        streamOutputNames: wrtcParams.streamOutputNames || [],
        dataOutputNames: wrtcParams.dataOutputNames || [],
        workflowsParameters: wrtcParams.workflowsParameters || {},
        requestedPlan: wrtcParams.requestedPlan || "free",
        requestedRegion: wrtcParams.requestedRegion || "us",
        realtimeProcessing: wrtcParams.realtimeProcessing ?? true,
      },
    });

    return res.json(answer);
  } catch (error) {
    console.error("[RoboflowProxy] init-webrtc", error);
    if (error instanceof WorkflowError) {
      return res.status(error.statusCode || 500).json(error.errorData || { message: error.message });
    }

    return res.status(500).json({
      error: error instanceof Error ? error.message : "Roboflow WebRTC initialization failed.",
    });
  }
});

app.listen(port, () => {
  console.log(`Roboflow proxy running on :${port}`);
});
