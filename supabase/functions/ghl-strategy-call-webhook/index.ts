import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  normalizeGhlBookingEvent,
  OFFICIAL_GHL_ED25519_PUBLIC_KEY,
  sanitizeProviderUrl,
  verifyWebhookAuthenticity,
  type NormalizedGhlBookingEvent,
  type WebhookMode,
} from "./core.ts";

const MAX_BODY_BYTES = 64 * 1024;

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function allowedUrlHosts(): string[] {
  return (Deno.env.get("GHL_STRATEGY_CALL_ALLOWED_URL_HOSTS") ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => /^[a-z0-9.-]+$/.test(host));
}

function configuredIds(name: string): string[] {
  return (Deno.env.get(name) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

async function hydrateContactEmail(
  event: NormalizedGhlBookingEvent
): Promise<NormalizedGhlBookingEvent> {
  if (event.normalizedEmail || !event.externalContactId) return event;
  const token = Deno.env.get("GHL_PRIVATE_INTEGRATION_TOKEN");
  if (!token) return event;
  try {
    const result = await fetch(
      `https://services.leadconnectorhq.com/contacts/${encodeURIComponent(event.externalContactId)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Version: "2021-07-28",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(5_000),
      }
    );
    if (!result.ok) return event;
    const body = await result.json();
    const contact = body?.contact ?? body;
    const email = typeof contact?.email === "string"
      ? contact.email.trim().toLowerCase()
      : "";
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      (contact?.locationId && event.locationId && contact.locationId !== event.locationId)
    ) {
      return event;
    }
    return { ...event, normalizedEmail: email };
  } catch {
    return event;
  }
}

type DbClient = ReturnType<typeof createClient>;
type ResolvedBookingEvent = NormalizedGhlBookingEvent & {
  startsAt: string;
  endsAt: string;
};
type Link = {
  sessionId: string | null;
  contactRequestId: string;
  storedStartsAt?: string;
  storedEndsAt?: string;
};

async function resolveBookingLink(
  supabase: DbClient,
  event: NormalizedGhlBookingEvent
): Promise<Link | null> {
  const { data: existing, error: existingError } = await supabase
    .from("strategy_call_bookings")
    .select("session_id, contact_request_id, scheduled_start_at, scheduled_end_at")
    .eq("provider", "ghl")
    .eq("external_booking_id", event.externalBookingId)
    .maybeSingle();
  if (existingError) throw new Error("booking_lookup_failed");
  if (existing?.contact_request_id) {
    return {
      sessionId: existing.session_id ?? null,
      contactRequestId: existing.contact_request_id,
      storedStartsAt: existing.scheduled_start_at,
      storedEndsAt: existing.scheduled_end_at,
    };
  }

  if (event.sessionId) {
    const { data: session, error: sessionError } = await supabase
      .from("strategy_call_sessions")
      .select("id, contact_request_id")
      .eq("id", event.sessionId)
      .gt("expires_at", new Date().toISOString())
      .neq("status", "expired")
      .maybeSingle();
    if (sessionError) throw new Error("session_lookup_failed");
    if (session?.contact_request_id) {
      return { sessionId: session.id, contactRequestId: session.contact_request_id };
    }
  }

  if (!event.normalizedEmail) return null;
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: contacts, error: contactsError } = await supabase
    .from("contact_requests")
    .select("id")
    .eq("email", event.normalizedEmail)
    .eq("source", "strategy-call")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(3);
  if (contactsError) throw new Error("contact_lookup_failed");
  const contactIds = (contacts ?? []).map((contact) => contact.id);
  if (contactIds.length === 0) return null;

  const { data: sessions, error: sessionsError } = await supabase
    .from("strategy_call_sessions")
    .select("id, contact_request_id")
    .in("contact_request_id", contactIds)
    .gt("expires_at", new Date().toISOString())
    .in("status", ["qualified", "calendar_opened"]);
  if (sessionsError) throw new Error("session_match_failed");
  if (!sessions || sessions.length === 0) return null;

  const sessionIds = sessions.map((session) => session.id);
  const { data: alreadyBooked, error: bookedError } = await supabase
    .from("strategy_call_bookings")
    .select("session_id")
    .in("session_id", sessionIds);
  if (bookedError) throw new Error("booking_match_failed");
  const bookedSessionIds = new Set(
    (alreadyBooked ?? []).map((booking) => booking.session_id).filter(Boolean)
  );
  const candidates = sessions.filter(
    (session) => !bookedSessionIds.has(session.id)
  );

  // Never guess when repeated qualifier submissions make email matching
  // ambiguous. Operations can inspect the redacted `unmatched` ledger row.
  if (candidates.length !== 1) return null;
  return {
    sessionId: candidates[0].id,
    contactRequestId: candidates[0].contact_request_id,
  };
}

async function claimDelivery(
  supabase: DbClient,
  event: NormalizedGhlBookingEvent
): Promise<{ id: string; duplicate: boolean; busy: boolean } | null> {
  const { data, error } = await supabase
    .from("strategy_call_webhook_events")
    .insert({
      provider: "ghl",
      provider_event_id: event.providerEventId,
      external_booking_id: event.externalBookingId,
      event_type: event.eventType,
      provider_occurred_at: event.occurredAt,
      processing_status: "processing",
    })
    .select("id")
    .single();
  if (!error && data) return { id: data.id, duplicate: false, busy: false };
  if (error?.code !== "23505") return null;

  const { data: prior } = await supabase
    .from("strategy_call_webhook_events")
    .select("id, processing_status, attempt_count, updated_at")
    .eq("provider", "ghl")
    .eq("provider_event_id", event.providerEventId)
    .maybeSingle();
  if (!prior) return null;
  if (["processed", "ignored"].includes(prior.processing_status)) {
    return { id: prior.id, duplicate: true, busy: false };
  }
  if (
    prior.processing_status === "processing" &&
    Date.now() - new Date(prior.updated_at).getTime() < 2 * 60 * 1000
  ) {
    return { id: prior.id, duplicate: false, busy: true };
  }

  const { data: retryClaim, error: retryError } = await supabase
    .from("strategy_call_webhook_events")
    .update({
      processing_status: "processing",
      failure_code: null,
      attempt_count: prior.attempt_count + 1,
    })
    .eq("id", prior.id)
    .eq("processing_status", prior.processing_status)
    .eq("updated_at", prior.updated_at)
    .select("id")
    .maybeSingle();
  if (retryError) return null;
  return retryClaim
    ? { id: prior.id, duplicate: false, busy: false }
    : { id: prior.id, duplicate: false, busy: true };
}

async function markDelivery(
  supabase: DbClient,
  id: string,
  status: "processed" | "ignored" | "unmatched" | "failed",
  bookingId: string | null,
  failureCode?: string
) {
  const { error } = await supabase
    .from("strategy_call_webhook_events")
    .update({
      processing_status: status,
      booking_id: bookingId,
      failure_code: failureCode ?? null,
      processed_at: status === "failed" || status === "unmatched"
        ? null
        : new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error("delivery_state_failed");
}

function emailCallStatus(eventType: NormalizedGhlBookingEvent["eventType"]): string {
  if (eventType === "cancelled") return "cancelled";
  if (eventType === "completed") return "attended";
  if (eventType === "no_show") return "noshow";
  return "scheduled";
}

async function queueEmail(
  supabase: DbClient,
  values: {
    bookingId: string;
    contactRequestId: string;
    emailType: string;
    scheduledAt: string;
    callTime: string;
    callStatus: string;
    idempotencyKey: string;
  }
): Promise<string | null> {
  const { data, error } = await supabase
    .from("strategy_call_emails")
    .upsert(
      {
        booking_id: values.bookingId,
        contact_request_id: values.contactRequestId,
        email_type: values.emailType,
        scheduled_at: values.scheduledAt,
        call_time: values.callTime,
        call_status: values.callStatus,
        idempotency_key: values.idempotencyKey,
        delivery_status: "pending",
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true }
    )
    .select("id");
  if (error) throw new Error("email_queue_failed");
  if (data && data[0]?.id) return data[0].id;

  const { data: existing, error: existingError } = await supabase
    .from("strategy_call_emails")
    .select("id, delivery_status")
    .eq("idempotency_key", values.idempotencyKey)
    .maybeSingle();
  if (existingError) throw new Error("email_queue_lookup_failed");
  if (existing?.id && existing.delivery_status === "suppressed") {
    const { error: reactivateError } = await supabase
      .from("strategy_call_emails")
      .update({
        scheduled_at: values.scheduledAt,
        call_time: values.callTime,
        call_status: values.callStatus,
        delivery_status: "pending",
        suppressed_at: null,
        last_error: null,
      })
      .eq("id", existing.id)
      .eq("delivery_status", "suppressed");
    if (reactivateError) throw new Error("email_queue_reactivation_failed");
  }
  return existing?.id ?? null;
}

async function syncEmailLifecycle(
  supabase: DbClient,
  event: ResolvedBookingEvent,
  bookingId: string,
  contactRequestId: string
): Promise<string | null> {
  const now = new Date();
  const callStatus = emailCallStatus(event.eventType);
  const { error: lifecycleUpdateError } = await supabase
    .from("strategy_call_emails")
    .update({ call_time: event.startsAt, call_status: callStatus })
    .eq("booking_id", bookingId);
  if (lifecycleUpdateError) throw new Error("email_lifecycle_update_failed");

  if (event.eventType === "cancelled") {
    const { error: suppressError } = await supabase
      .from("strategy_call_emails")
      .update({
        delivery_status: "suppressed",
        suppressed_at: now.toISOString(),
      })
      .eq("booking_id", bookingId)
      .in("email_type", ["reminder_24h", "reminder_1h"])
      .in("delivery_status", ["pending", "failed", "sending"]);
    if (suppressError) throw new Error("email_reminder_suppression_failed");
    return null;
  }

  if (event.eventType === "scheduled" || event.eventType === "rescheduled") {
    const { error: suppressError } = await supabase
      .from("strategy_call_emails")
      .update({
        delivery_status: "suppressed",
        suppressed_at: now.toISOString(),
      })
      .eq("booking_id", bookingId)
      .in("email_type", ["reminder_24h", "reminder_1h"])
      .in("delivery_status", ["pending", "failed", "sending"]);
    if (suppressError) throw new Error("email_reminder_reschedule_failed");

    const start = new Date(event.startsAt);
    const reminders = [
      { type: "reminder_24h", offsetMs: 24 * 60 * 60 * 1000 },
      { type: "reminder_1h", offsetMs: 60 * 60 * 1000 },
    ];
    for (const reminder of reminders) {
      const scheduledAt = new Date(start.getTime() - reminder.offsetMs);
      if (scheduledAt.getTime() <= now.getTime()) continue;
      await queueEmail(supabase, {
        bookingId,
        contactRequestId,
        emailType: reminder.type,
        scheduledAt: scheduledAt.toISOString(),
        callTime: event.startsAt,
        callStatus,
        idempotencyKey: `${bookingId}:${reminder.type}:${event.startsAt}`,
      });
    }

    // This is intentionally reconciled for both a newly applied event and an
    // exact same-event retry. If booking persistence committed but the first
    // queue attempt failed, the retry repairs the lifecycle; the key prevents
    // duplicate confirmation sends.
    return queueEmail(supabase, {
      bookingId,
      contactRequestId,
      emailType: "confirmation",
      scheduledAt: now.toISOString(),
      callTime: event.startsAt,
      callStatus,
      idempotencyKey: `${bookingId}:confirmation`,
    });
  }

  const { error: suppressError } = await supabase
    .from("strategy_call_emails")
    .update({
      delivery_status: "suppressed",
      suppressed_at: now.toISOString(),
    })
    .eq("booking_id", bookingId)
    .in("email_type", ["reminder_24h", "reminder_1h"])
    .in("delivery_status", ["pending", "failed", "sending"]);
  if (suppressError) throw new Error("email_reminder_completion_failed");

  const followupType =
    event.eventType === "completed" ? "followup_attended" : "followup_noshow";
  await queueEmail(supabase, {
    bookingId,
    contactRequestId,
    emailType: followupType,
    scheduledAt: now.toISOString(),
    callTime: event.startsAt,
    callStatus,
    idempotencyKey: `${bookingId}:${followupType}`,
  });
  return null;
}

async function requestImmediateEmail(emailId: string): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return;
  try {
    await fetch(`${supabaseUrl}/functions/v1/send-strategy-call-email`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email_id: emailId }),
    });
  } catch {
    // The durable pending row is picked up by the dispatcher on its next tick.
  }
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (declaredLength > MAX_BODY_BYTES) return response({ error: "Payload too large" }, 413);
  // content-length is absent on HTTP/2 and chunked uploads, so the header above is only a hint:
  // this endpoint is unauthenticated, so count bytes as they arrive and abort before an
  // oversized body is ever fully buffered.
  const chunks: Uint8Array[] = [];
  let bodyLength = 0;
  const reader = request.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    bodyLength += value.byteLength;
    if (bodyLength > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return response({ error: "Payload too large" }, 413);
    }
    chunks.push(value);
  }
  const bodyBytes = new Uint8Array(bodyLength);
  let bodyOffset = 0;
  for (const chunk of chunks) {
    bodyBytes.set(chunk, bodyOffset);
    bodyOffset += chunk.byteLength;
  }
  // Decoded once over the assembled bytes: decoding chunk by chunk would corrupt a multi-byte
  // character split across a chunk boundary and break Ed25519 verification of the raw body.
  const rawBody = new TextDecoder().decode(bodyBytes);
  if (!rawBody) return response({ error: "Invalid payload" }, 400);

  const configuredMode =
    Deno.env.get("GHL_STRATEGY_CALL_WEBHOOK_MODE") ?? "marketplace";
  if (!["marketplace", "workflow_shared_secret"].includes(configuredMode)) {
    console.error("strategy_call_webhook_config_error", { requestId });
    return response({ error: "Webhook unavailable" }, 500);
  }
  const mode = configuredMode as WebhookMode;
  const configuredPublicKey = Deno.env.get("GHL_ED25519_PUBLIC_KEY")
    ?.trim()
    .replace(/\\n/g, "\n");
  if (
    configuredPublicKey &&
    !/^-----BEGIN PUBLIC KEY-----\s+[A-Za-z0-9+/=\s]+\s+-----END PUBLIC KEY-----$/.test(
      configuredPublicKey
    )
  ) {
    console.error("strategy_call_webhook_public_key_invalid", { requestId });
    return response({ error: "Webhook unavailable" }, 500);
  }
  const authentic = await verifyWebhookAuthenticity({
    rawBody,
    headers: request.headers,
    mode,
    publicKeyPem: configuredPublicKey || OFFICIAL_GHL_ED25519_PUBLIC_KEY,
    workflowSecret: Deno.env.get("GHL_STRATEGY_CALL_WORKFLOW_SECRET"),
  });
  if (!authentic) {
    console.warn("strategy_call_webhook_rejected", { requestId, mode });
    return response({ error: "Unauthorized" }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return response({ error: "Malformed JSON" }, 400);
  }

  const bodyHash = await sha256(rawBody);
  const fallbackEventId =
    request.headers.get("x-ghl-webhook-id")?.slice(0, 255) || bodyHash;
  let event = normalizeGhlBookingEvent(payload, fallbackEventId);
  if (!event) return response({ error: "Unmappable appointment event" }, 422);

  const allowedLocations = configuredIds("GHL_STRATEGY_CALL_ALLOWED_LOCATION_IDS");
  const allowedCalendars = configuredIds("GHL_STRATEGY_CALL_ALLOWED_CALENDAR_IDS");
  if (allowedLocations.length === 0 || allowedCalendars.length === 0) {
    console.error("strategy_call_webhook_allowlist_missing", { requestId });
    return response({ error: "Webhook unavailable" }, 500);
  }
  if (
    !event.locationId ||
    !event.externalCalendarId ||
    !allowedLocations.includes(event.locationId) ||
    !allowedCalendars.includes(event.externalCalendarId)
  ) {
    console.warn("strategy_call_webhook_scope_rejected", { requestId });
    return response({ error: "Webhook scope rejected" }, 403);
  }
  event = await hydrateContactEmail(event);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return response({ error: "Webhook unavailable" }, 500);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const delivery = await claimDelivery(supabase, event);
  if (!delivery) return response({ error: "Retry later" }, 500);
  if (delivery.duplicate) return response({ accepted: true, duplicate: true });
  if (delivery.busy) return response({ error: "Delivery already processing" }, 503);

  const externalBookingHash = (await sha256(event.externalBookingId)).slice(0, 16);
  try {
    const link = await resolveBookingLink(supabase, event);
    if (!link) {
      await markDelivery(supabase, delivery.id, "unmatched", null, "booking_unmatched");
      console.warn("strategy_call_webhook_unmatched", {
        requestId,
        eventType: event.eventType,
        externalBookingHash,
      });
      return response({ error: "Booking could not be matched" }, 422);
    }

    const startsAt = event.startsAt ?? link.storedStartsAt;
    const endsAt = event.endsAt ?? link.storedEndsAt;
    if (
      !startsAt ||
      !endsAt ||
      new Date(endsAt).getTime() <= new Date(startsAt).getTime()
    ) {
      await markDelivery(
        supabase,
        delivery.id,
        "unmatched",
        null,
        "booking_interval_missing"
      );
      return response({ error: "Booking interval unavailable" }, 422);
    }
    const resolvedEvent: ResolvedBookingEvent = { ...event, startsAt, endsAt };

    const hosts = allowedUrlHosts();
    const { data: appliedRows, error: applyError } = await supabase.rpc(
      "apply_strategy_call_booking_event",
      {
        p_session_id: link.sessionId,
        p_contact_request_id: link.contactRequestId,
        p_external_booking_id: resolvedEvent.externalBookingId,
        p_external_calendar_id: resolvedEvent.externalCalendarId ?? null,
        p_external_contact_id: resolvedEvent.externalContactId ?? null,
        p_status: resolvedEvent.eventType,
        p_scheduled_start_at: resolvedEvent.startsAt,
        p_scheduled_end_at: resolvedEvent.endsAt,
        p_booking_timezone: resolvedEvent.timezone ?? null,
        p_reschedule_url: sanitizeProviderUrl(resolvedEvent.rescheduleUrl, hosts) ?? null,
        p_cancel_url: sanitizeProviderUrl(resolvedEvent.cancelUrl, hosts) ?? null,
        p_meeting_url: sanitizeProviderUrl(resolvedEvent.meetingUrl, hosts) ?? null,
        p_provider_event_at: resolvedEvent.occurredAt,
        p_provider_event_id: resolvedEvent.providerEventId,
      }
    );
    const applied = appliedRows?.[0];
    if (applyError || !applied?.booking_id) throw new Error("booking_apply_failed");

    if (!applied.event_applied && applied.event_disposition !== "same") {
      await markDelivery(supabase, delivery.id, "ignored", applied.booking_id);
      return response({ accepted: true, ignored: "older_event" });
    }

    const effectiveEvent = {
      ...resolvedEvent,
      eventType: applied.booking_status as NormalizedGhlBookingEvent["eventType"],
    };
    const shouldSyncLifecycle =
      applied.schedule_changed ||
      ["cancelled", "completed", "no_show"].includes(applied.booking_status);
    const immediateEmailId = shouldSyncLifecycle
      ? await syncEmailLifecycle(
          supabase,
          effectiveEvent,
          applied.booking_id,
          link.contactRequestId
        )
      : null;
    await markDelivery(supabase, delivery.id, "processed", applied.booking_id);
    if (immediateEmailId) await requestImmediateEmail(immediateEmailId);

    console.log("strategy_call_webhook_processed", {
      requestId,
      eventType: event.eventType,
      externalBookingHash,
      elapsedMs: Date.now() - startedAt,
    });
    return response({ accepted: true });
  } catch (error) {
    try {
      await markDelivery(supabase, delivery.id, "failed", null, "persistence_failed");
    } catch {
      // The 500 response still asks GHL to retry; do not log provider payload.
    }
    console.error("strategy_call_webhook_failed", {
      requestId,
      eventType: event.eventType,
      externalBookingHash,
      errorName: error instanceof Error ? error.name : "unknown",
      elapsedMs: Date.now() - startedAt,
    });
    return response({ error: "Retry later" }, 500);
  }
});
