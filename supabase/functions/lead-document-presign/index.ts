/**
 * lead-document-presign — Spec Section 6.2 Document upload.
 *
 * Returns a presigned upload URL for the `lead-documents` bucket so the booking app
 * can upload files BEFORE the lead exists (the apply form uploads docs first, then
 * submits the URLs as part of the application payload).
 *
 * Path scheme: {tenant_id}/pending/{nanoid}-{document_type}.{ext}
 * Once the lead is created in submit-application, lead_documents rows are inserted
 * with these file_urls. A future cleanup job sweeps unclaimed pending/* files older
 * than 24h.
 *
 * Auth: public (verify_jwt = false). The presigned URL itself is the auth — short
 * expiry (5 minutes), specific bucket and path. Tenant slug required so we can
 * scope the path correctly and validate the tenant has lead_management_enabled.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface Payload {
  tenantSlug?: string;
  documentType?: "licence" | "selfie" | "rideshare_proof" | "insurance" | "passport" | "utility_bill" | "other";
  fileName?: string;
  mimeType?: string;
}

const ALLOWED_MIME = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];
const ALLOWED_DOCUMENT_TYPES = [
  "licence",
  "selfie",
  "rideshare_proof",
  "insurance",
  "passport",
  "utility_bill",
  "other",
];

function nanoid(size = 12): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let id = "";
  for (let i = 0; i < size; i++) id += alphabet[bytes[i] % alphabet.length];
  return id;
}

function safeExt(fileName: string, mimeType: string): string {
  const fromName = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "pdf"].includes(fromName)) return fromName === "jpeg" ? "jpg" : fromName;
  if (mimeType === "image/png") return "png";
  if (mimeType === "application/pdf") return "pdf";
  return "jpg";
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json()) as Payload;
    const slug = (req.headers.get("x-tenant-slug") || body.tenantSlug || "").toLowerCase().trim();
    if (!slug) return errorResponse("Tenant could not be determined");
    if (!body.documentType || !ALLOWED_DOCUMENT_TYPES.includes(body.documentType)) {
      return errorResponse("Invalid document type");
    }
    if (!body.fileName) return errorResponse("fileName is required");
    if (!body.mimeType || !ALLOWED_MIME.includes(body.mimeType)) {
      return errorResponse("Unsupported file type (allowed: JPG, PNG, PDF)");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: tenant, error: tErr } = await supabase
      .from("tenants")
      .select("id, lead_management_enabled")
      .eq("slug", slug)
      .maybeSingle();

    if (tErr || !tenant) return errorResponse("Tenant not found", 404);
    if (tenant.lead_management_enabled === false) {
      return errorResponse("Applications are not accepted at this time", 409);
    }

    const ext = safeExt(body.fileName, body.mimeType);
    const objectPath = `${tenant.id}/pending/${nanoid(16)}-${body.documentType}.${ext}`;

    const { data: signed, error: signErr } = await supabase
      .storage
      .from("lead-documents")
      .createSignedUploadUrl(objectPath);

    if (signErr || !signed) {
      console.error("lead-document-presign signed url error:", signErr);
      return errorResponse("Failed to generate upload URL", 500);
    }

    // Public URL (for storing in lead_documents.file_url; service-role + tenant-scoped
    // read policy lets staff fetch via signed read URLs)
    const { data: pub } = supabase.storage.from("lead-documents").getPublicUrl(objectPath);

    return jsonResponse({
      uploadUrl: signed.signedUrl,
      token: signed.token,
      objectPath,
      bucket: "lead-documents",
      publicUrl: pub.publicUrl,
      expiresInSeconds: 300,
    });
  } catch (err) {
    console.error("lead-document-presign error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
