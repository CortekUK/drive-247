// push-bonzah-submission — send an onboarding submission to Bonzah's External API.
//
// Replaces the manual step where we email the form to Brandon. It does NOT
// replace the whole round trip: their API is write-only, so activation and the
// credentials still come back by hand. send-bonzah-form-to-brandon is therefore
// KEPT, not deleted, and remains authoritative until this has been proven
// against a real key.
//
// DEFAULTS TO DRY RUN. A live push has to be asked for explicitly. Two things
// are missing that only Bonzah can supply — an API key and a per-tenant partner
// id — and in both cases this refuses LOUDLY rather than appearing to succeed.
// A silent skip on a compliance submission is the worst possible failure: it
// looks exactly like success right up until an operator cannot insure a car.
//
// THREE ENDPOINTS, IN ORDER
//   1. POST /partners/:id/documents     — uploads, returns the *DocId values
//   2. POST /partners/:id/fleet/parse   — parses the vehicle schedule file
//   3. PUT  /partners/:id/submission    — the form itself
// Documents go FIRST because three of their required fields ARE document
// references: pushing the submission before the uploads would transmit a form
// that is incomplete by construction.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  mapSubmissionToBonzah,
  putSubmission,
  postDocument,
  parseFleetFile,
  applyDocumentsToPayload,
  BONZAH_DOC_CATEGORY_MAP,
  bonzahExternalKey,
  sha256Hex,
  BONZAH_EXTERNAL_BASE,
  type DocumentUploadInput,
  type DocumentUploadResult,
} from "../_shared/bonzah-external.ts";

const DOC_BUCKET = "bonzah-onboarding-files";
/** A live push is refused if an identical payload already landed within this window. */
const DUPLICATE_WINDOW_HOURS = 24;

interface StoredDoc {
  path: string;
  category: string;
  fileName: string;
}

/**
 * Documents referenced by the submission itself.
 *
 * `bonzah_onboarding_submissions.file_urls` is a jsonb map of
 * `{ category: [{ path, name, ... }] }`, populated on 8 of the 9 live
 * submissions and keyed with exactly the categories Bonzah's DocId fields
 * correspond to.
 *
 * Preferred over scanning the bucket because it is scoped to THIS submission.
 * The bucket is laid out per TENANT, so a tenant with two submissions would
 * have the newer one's files attached to the older — silently sending an
 * underwriter the wrong insurance policy.
 */
function documentsFromSubmission(fileUrls: unknown): StoredDoc[] {
  if (!fileUrls || typeof fileUrls !== "object") return [];
  const out: StoredDoc[] = [];

  for (const [category, refs] of Object.entries(fileUrls as Record<string, unknown>)) {
    if (!BONZAH_DOC_CATEGORY_MAP[category]) continue;
    if (!Array.isArray(refs) || refs.length === 0) continue;

    // One DocId per field in their contract, so take the last uploaded rather
    // than picking arbitrarily and making the push non-deterministic.
    const ref = refs[refs.length - 1] as { path?: string; name?: string };
    if (!ref?.path) continue;
    out.push({
      path: ref.path,
      category,
      fileName: ref.name ?? ref.path.split("/").pop() ?? "document",
    });
  }

  return out;
}

/**
 * List a tenant's uploaded onboarding documents.
 *
 * They live at `{tenant_id}/draft/{category}/{filename}` in a PRIVATE bucket —
 * 55 files across 13 tenants. The submission JSON never references them, which
 * is why documents looked sourceless; the source is the bucket.
 *
 * Where a tenant uploaded several files in one category (8 have multiple driver
 * licences), the NEWEST is used: their contract has one DocId per field, and
 * picking arbitrarily would make the push non-deterministic.
 */
async function listTenantDocuments(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
): Promise<StoredDoc[]> {
  const out: StoredDoc[] = [];

  for (const category of Object.keys(BONZAH_DOC_CATEGORY_MAP)) {
    const prefix = `${tenantId}/draft/${category}`;
    const { data, error } = await supabase.storage.from(DOC_BUCKET).list(prefix, {
      limit: 100,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (error || !data?.length) continue;

    const newest = data.find((f) => f.name && !f.name.endsWith("/"));
    if (newest) {
      out.push({ path: `${prefix}/${newest.name}`, category, fileName: newest.name });
    }
  }

  return out;
}

/** Download one document's bytes. Never logged — these are licences and policies. */
async function downloadDoc(
  supabase: ReturnType<typeof createClient>,
  doc: StoredDoc,
): Promise<DocumentUploadInput | null> {
  const { data, error } = await supabase.storage.from(DOC_BUCKET).download(doc.path);
  if (error || !data) return null;
  return {
    category: doc.category,
    fileName: doc.fileName,
    contentType: data.type || "application/octet-stream",
    bytes: new Uint8Array(await data.arrayBuffer()),
  };
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let pushId: string | null = null;

  try {
    // ── super admin only ───────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const anon = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    const { data: { user }, error: userErr } = await anon.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userErr || !user) return errorResponse("Unauthorized", 401);

    const { data: appUser } = await supabase
      .from("app_users").select("id, is_active, is_super_admin")
      .eq("auth_user_id", user.id).maybeSingle();
    if (!appUser?.is_active || appUser?.is_super_admin !== true) {
      return errorResponse("Only super admins can push a submission to Bonzah", 403);
    }

    const body = await req.json().catch(() => ({}));
    const submissionId = body?.submissionId;
    // Live has to be asked for. Anything other than an explicit true is a dry run.
    const live = body?.live === true;
    // Documents are included by default; skipping is opt-in and recorded.
    const includeDocuments = body?.includeDocuments !== false;
    if (!submissionId) return errorResponse("submissionId is required", 400);

    const { data: sub } = await supabase
      .from("bonzah_onboarding_submissions")
      .select("id, tenant_id, status, data, file_urls")
      .eq("id", submissionId)
      .maybeSingle();
    if (!sub) return errorResponse("Submission not found", 404);

    const { data: tenant } = await supabase
      .from("tenants").select("id, company_name, bonzah_partner_id")
      .eq("id", sub.tenant_id).maybeSingle();
    if (!tenant) return errorResponse("Tenant not found", 404);

    const mapped = mapSubmissionToBonzah((sub.data ?? {}) as Record<string, unknown>);

    // Documents the tenant has actually uploaded, and which required field each
    // would fill. Listed for a dry run too — "which of the three required
    // document fields can this operator actually satisfy" is the single most
    // useful thing a gap report can answer.
    // file_urls first (submission-scoped); the bucket scan is the fallback for
    // the one live submission that carries no file_urls map.
    let storedDocs: StoredDoc[] = [];
    if (includeDocuments) {
      storedDocs = documentsFromSubmission((sub as { file_urls?: unknown }).file_urls);
      if (storedDocs.length === 0) {
        storedDocs = await listTenantDocuments(supabase, tenant.id);
      }
    }
    const docPlan = storedDocs.map((d) => ({
      category: d.category,
      fileName: d.fileName,
      field: BONZAH_DOC_CATEGORY_MAP[d.category]?.field,
      requiredByBonzah: BONZAH_DOC_CATEGORY_MAP[d.category]?.required ?? false,
    }));

    const serialised = JSON.stringify({ step: 6, data: mapped.payload });
    const hash = await sha256Hex(serialised);

    // ── duplicate protection ───────────────────────────────────────────────
    // Their API offers no idempotency key that we know of, so two pushes for one
    // submission create two submissions at Bonzah and an underwriter sees the
    // operator twice. Guard on (submission, identical payload, recent success).
    // Scoped to LIVE pushes: repeating a dry run is free and is how the gap
    // report is meant to be used.
    if (live) {
      const since = new Date(Date.now() - DUPLICATE_WINDOW_HOURS * 3600_000).toISOString();
      const { data: priorRows } = await supabase
        .from("bonzah_api_pushes")
        .select("id, created_at")
        .eq("submission_id", sub.id)
        .eq("mode", "live")
        .eq("status", "success")
        .eq("payload_sha256", hash)
        .gte("created_at", since)
        .limit(1);

      const prior = priorRows?.[0];
      if (prior && body?.force !== true) {
        return jsonResponse({
          error: `This exact submission was already delivered to Bonzah at ${prior.created_at}. Their API has no idempotency key, so pushing again creates a second submission for the same operator. Pass force:true if you intend that.`,
          code: "duplicate_push",
          priorPushId: prior.id,
          priorPushedAt: prior.created_at,
          payloadSha256: hash,
        }, 409);
      }
    }

    // Open the ledger row before anything can fail, so a push that dies halfway
    // still leaves a trace. The payload itself is NEVER stored — it carries bank
    // account and routing numbers, EIN and a date of birth, and an audit table
    // that quietly becomes a second copy of that is worse than no audit.
    const { data: pushRow } = await supabase
      .from("bonzah_api_pushes")
      .insert({
        tenant_id: tenant.id,
        submission_id: sub.id,
        partner_id: tenant.bonzah_partner_id ?? null,
        mode: live ? "live" : "dry_run",
        status: "pending",
        payload_sha256: hash,
        payload_field_count: mapped.fieldCount,
        requested_by: appUser.id,
      })
      .select("id")
      .single();
    pushId = pushRow?.id ?? null;

    const finish = async (patch: Record<string, unknown>) => {
      if (!pushId) return;
      await supabase.from("bonzah_api_pushes")
        .update({ ...patch, finished_at: new Date().toISOString() })
        .eq("id", pushId);
    };

    // ── DRY RUN: show exactly what would go, create nothing at Bonzah ───────
    if (!live) {
      // Model what the documents WOULD fill, so the gap report is not three
      // fields more pessimistic than reality for a tenant who has uploaded them.
      const wouldFill = docPlan.map((d) => d.field).filter(Boolean) as string[];
      const missingAfterDocs = mapped.missingRequired.filter((f) => !wouldFill.includes(f));

      await finish({
        status: "success",
        validation_errors: [
          ...missingAfterDocs.map((f) => ({ field: f, reason: "required by Bonzah, not filled" })),
          ...mapped.warnings,
        ],
      });
      return jsonResponse({
        mode: "dry_run",
        pushId,
        endpoint: `${BONZAH_EXTERNAL_BASE}/partners/${tenant.bonzah_partner_id ?? "<PARTNER_ID_NOT_SET>"}/submission`,
        partnerIdConfigured: !!tenant.bonzah_partner_id,
        apiKeyConfigured: !!bonzahExternalKey(),
        payloadSha256: hash,
        fieldCount: mapped.fieldCount,
        // The point of a dry run: what would go wrong BEFORE anything is sent.
        // Their server takes `data` as an opaque object, so a bad enum or a
        // missing required field does not bounce — it stalls in underwriting.
        missingRequired: missingAfterDocs,
        missingRequiredIgnoringDocuments: mapped.missingRequired,
        // Why each gap exists and who can close it — "missing" alone sends the
        // reader hunting through the form for a field that does not exist.
        gapReasons: mapped.gapReasons.filter((g) => missingAfterDocs.includes(g.field)),
        warnings: mapped.warnings,
        documents: docPlan,
        documentsWouldFill: wouldFill,
        // Safe to return to a super admin who can already read the submission,
        // and it is the point of a dry run. Card number, expiry and CVC are not
        // in here at all — Bonzah marks them optional, so they are never sent.
        payload: mapped.payload,
      });
    }

    // ── LIVE: both prerequisites must be present. Refuse loudly. ────────────
    const apiKey = bonzahExternalKey();
    if (!apiKey) {
      await finish({ status: "blocked", error_code: "missing_api_key" });
      return jsonResponse({
        error: "BONZAH_EXTERNAL_API_KEY is not configured. Ask Bonzah for the External API key and set it as a Supabase secret before pushing live.",
        code: "missing_api_key",
        pushId,
      }, 409);
    }
    if (!tenant.bonzah_partner_id) {
      await finish({ status: "blocked", error_code: "missing_partner_id" });
      return jsonResponse({
        error: `No Bonzah partner id is set for ${tenant.company_name}. Bonzah issues these out of band — their API has no endpoint to create or look one up.`,
        code: "missing_partner_id",
        pushId,
      }, 409);
    }

    // ── documents first: three required fields ARE document references ─────
    const uploads: DocumentUploadResult[] = [];
    let fleetSchedule: unknown;
    let fleetParseError: string | undefined;

    for (const doc of storedDocs) {
      const loaded = await downloadDoc(supabase, doc);
      if (!loaded) {
        uploads.push({
          category: doc.category,
          fileName: doc.fileName,
          field: BONZAH_DOC_CATEGORY_MAP[doc.category]?.field,
          ok: false,
          errorCode: "storage_download_failed",
          errorMessage: "Could not read the file from storage",
        });
        continue;
      }

      // The vehicle schedule does double duty: it uploads as a document AND
      // feeds their stateless parser, which is the only way to fill the
      // required structural field `fleet.vehicleSchedule`.
      if (doc.category === "vehicle_schedule_file") {
        const parsed = await parseFleetFile(tenant.bonzah_partner_id, apiKey, loaded);
        if (parsed.ok) fleetSchedule = parsed.schedule;
        else fleetParseError = parsed.errorMessage ?? parsed.errorCode;
      }

      uploads.push(await postDocument(tenant.bonzah_partner_id, apiKey, loaded));
    }

    applyDocumentsToPayload(mapped.payload, uploads, fleetSchedule);

    // Recompute completeness AFTER the uploads — that is the whole point of
    // doing them first.
    const stillMissing = mapped.missingRequired.filter((f) => {
      const filled = uploads.some((u) => u.ok && u.field === f);
      if (filled) return false;
      if (f === "fleet.vehicleSchedule" && fleetSchedule !== undefined) return false;
      return true;
    });

    const failedRequiredDocs = uploads.filter(
      (u) => !u.ok && BONZAH_DOC_CATEGORY_MAP[u.category]?.required,
    );

    // ── partial failure is a real state and must not read as success ───────
    // A required document that did not upload leaves a required field empty. The
    // submission is not "mostly delivered"; it is incomplete, and it is the
    // operator who carries the consequence of an incomplete declaration.
    if (failedRequiredDocs.length > 0 && body?.force !== true) {
      await finish({
        status: "failed",
        error_code: "required_document_failed",
        error_message: failedRequiredDocs.map((d) => `${d.category}: ${d.errorCode}`).join("; "),
        validation_errors: [
          ...failedRequiredDocs.map((d) => ({ field: d.field ?? d.category, reason: d.errorMessage ?? "upload failed" })),
        ],
      });
      return jsonResponse({
        error: `${failedRequiredDocs.length} document(s) Bonzah requires failed to upload. The submission was NOT sent — an incomplete declaration is worse than a late one.`,
        code: "required_document_failed",
        documents: uploads,
        fleetParseError,
        pushId,
      }, 502);
    }

    // A live push is BLOCKED by its own validation. The previous version
    // computed missingRequired and warnings, wrote them to the ledger, and then
    // transmitted regardless — so every gap and every bad enum would have gone
    // to an underwriter the moment a key existed. An incomplete insurance
    // submission is not a smaller version of a complete one; it is a different
    // thing, and it is the operator who carries the consequence.
    //
    // force:true exists for the case where Bonzah has told us a gap is
    // acceptable. It is recorded on the ledger so that decision has a name
    // against it.
    if (stillMissing.length > 0 && body?.force !== true) {
      await finish({
        status: "blocked",
        error_code: "incomplete_submission",
        validation_errors: [
          ...stillMissing.map((f) => ({ field: f, reason: "required by Bonzah, not filled" })),
          ...mapped.warnings,
        ],
      });
      return jsonResponse({
        error: `${stillMissing.length} field(s) Bonzah requires are not filled. Resolve them with the operator, or pass force:true if Bonzah has confirmed the gap is acceptable.`,
        code: "incomplete_submission",
        missingRequired: stillMissing,
        warnings: mapped.warnings,
        documents: uploads,
        pushId,
      }, 409);
    }

    // The payload changed once DocIds were merged in, so the hash on the ledger
    // must describe what was actually transmitted, not what was mapped.
    const finalHash = await sha256Hex(JSON.stringify({ step: 6, data: mapped.payload }));
    const result = await putSubmission(tenant.bonzah_partner_id, apiKey, mapped.payload);

    if (!result.ok) {
      await finish({
        status: "failed",
        http_status: result.httpStatus ?? null,
        error_code: result.errorCode ?? null,
        error_message: result.errorMessage ?? null,
        payload_sha256: finalHash,
      });
      return jsonResponse({
        error: result.errorMessage ?? "Bonzah rejected the submission",
        code: result.errorCode,
        httpStatus: result.httpStatus,
        // Documents may already be at Bonzah. Say so rather than letting a retry
        // silently duplicate them.
        documentsUploaded: uploads.filter((u) => u.ok).length,
        documents: uploads,
        pushId,
      }, 502);
    }

    await finish({ status: "success", http_status: result.httpStatus ?? null, payload_sha256: finalHash });

    // Deliberately does NOT advance submission status. Their API cannot tell us
    // the submission was accepted for underwriting, only that the write landed —
    // moving the status here would claim knowledge we do not have.
    return jsonResponse({
      mode: "live",
      pushId,
      httpStatus: result.httpStatus,
      fieldCount: mapped.fieldCount,
      payloadSha256: finalHash,
      documents: uploads,
      documentsUploaded: uploads.filter((u) => u.ok).length,
      fleetVehiclesParsed: Array.isArray(fleetSchedule) ? fleetSchedule.length : undefined,
      fleetParseError,
      note: "Delivered to Bonzah. Activation and API credentials still come back manually — their API is write-only.",
    });
  } catch (err) {
    console.error("[push-bonzah-submission] failed:", err);
    if (pushId) {
      await supabase.from("bonzah_api_pushes").update({
        status: "failed",
        error_code: "unhandled",
        error_message: (err as { message?: string })?.message ?? "unhandled",
        finished_at: new Date().toISOString(),
      }).eq("id", pushId);
    }
    return errorResponse((err as { message?: string })?.message ?? "Push failed", 500);
  }
});
