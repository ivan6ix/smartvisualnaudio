import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_BUCKETS = new Set([
  "course-modules",
  "course-permits",
  "exam-submissions",
  "proctor-snapshots",
  "audio-violations",
]);
const FORBIDDEN_BUCKETS = new Set(["profile-pictures"]);

type StorageManifestEntry = {
  bucket?: string;
  path?: string;
  source?: string;
};

type NormalizedStorageRef = {
  bucket: string;
  path: string;
  source: string;
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeError(message: string, status = 400) {
  const knownMessages = [
    "Course must be archived before permanent deletion.",
    "You are not authorized to permanently delete courses.",
    "Course was not found.",
    "Course could not be permanently deleted.",
  ];
  const safeMessage = knownMessages.includes(message) ? message : "Course could not be permanently deleted.";
  return json({ error: safeMessage }, status);
}

function extractStoragePathFromUrl(raw: string, expectedBucket: string) {
  try {
    const url = new URL(raw);
    const marker = "/storage/v1/object/";
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const objectPart = url.pathname.slice(markerIndex + marker.length);
    const withoutAccessMode = objectPart.replace(/^(public|sign|authenticated)\//, "");
    const [bucket, ...pathParts] = withoutAccessMode.split("/");
    if (bucket !== expectedBucket) return null;
    const path = decodeURIComponent(pathParts.join("/"));
    return path || null;
  } catch {
    return null;
  }
}

export function normalizeStorageReference(entry: StorageManifestEntry): NormalizedStorageRef | null {
  const bucket = String(entry.bucket || "").trim();
  const rawPath = String(entry.path || "").trim();
  const source = String(entry.source || "");

  if (!bucket || !rawPath) return null;
  if (FORBIDDEN_BUCKETS.has(bucket) || !ALLOWED_BUCKETS.has(bucket)) return null;
  if (rawPath.startsWith("data:") || rawPath.startsWith("blob:")) return null;

  const path = /^https?:\/\//i.test(rawPath)
    ? extractStoragePathFromUrl(rawPath, bucket)
    : rawPath.replace(/^\/+/, "");

  if (!path || path.includes("..") || path.startsWith("/") || path.endsWith("/")) return null;

  return { bucket, path, source };
}

async function cleanupStorage(adminClient: ReturnType<typeof createClient>, manifest: StorageManifestEntry[]) {
  const normalized = manifest
    .map(normalizeStorageReference)
    .filter((entry): entry is NormalizedStorageRef => Boolean(entry));
  const deduped = Array.from(new Map(normalized.map((entry) => [`${entry.bucket}/${entry.path}`, entry])).values());
  const unresolved = manifest.length - deduped.length;
  const failed: Array<{ bucket: string; path: string; error: string }> = [];
  let deletedCount = 0;

  for (const bucket of ALLOWED_BUCKETS) {
    const paths = deduped.filter((entry) => entry.bucket === bucket).map((entry) => entry.path);
    if (!paths.length) continue;
    for (let index = 0; index < paths.length; index += 1000) {
      const chunk = paths.slice(index, index + 1000);
      const { error } = await adminClient.storage.from(bucket).remove(chunk);
      if (error) {
        failed.push(...chunk.map((path) => ({ bucket, path, error: error.message })));
      } else {
        deletedCount += chunk.length;
      }
    }
  }

  return {
    storage_cleanup_complete: failed.length === 0 && unresolved === 0,
    deleted_storage_count: deletedCount,
    failed_storage_count: failed.length,
    unresolved_storage_count: unresolved,
    failed_storage: failed.slice(0, 25),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
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

    const body = await req.json().catch(() => ({}));
    const courseId = String(body.courseId || body.course_id || "");
    if (!courseId) return json({ error: "Course was not found." }, 400);

    const { data: rpcResult, error: rpcError } = await userClient.rpc("admin_permanently_delete_course", { p_course_id: courseId });
    if (rpcError) {
      const status = rpcError.message?.includes("authorized") ? 403 : rpcError.message?.includes("archived") ? 409 : 400;
      return safeError(rpcError.message || "Course could not be permanently deleted.", status);
    }

    const manifest = Array.isArray(rpcResult?.storage_manifest) ? rpcResult.storage_manifest as StorageManifestEntry[] : [];
    const storageResult = await cleanupStorage(adminClient, manifest);

    return json({
      ...rpcResult,
      ...storageResult,
      warning: storageResult.storage_cleanup_complete ? null : "Course permanently deleted, but some stored files require cleanup.",
    });
  } catch {
    return json({ error: "Course could not be permanently deleted." }, 500);
  }
});
