import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getStrategyCallAdminClient } from "@/lib/strategy-call/supabase-admin";
import { resolveStrategyCallSessionToken } from "@/lib/strategy-call/session";
import {
  resolveStrategyCallPepper,
  STRATEGY_CALL_SESSION_COOKIE,
} from "@/lib/strategy-call/session-token";
import { CONTENT_VERSION } from "@/lib/strategy-call/confirmation-content";

/** Hard cap on the request body, in bytes — not UTF-16 code units. */
const MAX_BODY_BYTES = 4096;

/** Every code the player can emit. See getMediaErrorCode + playWithSound. */
const ERROR_CODES = new Set([
  "aborted",
  "network",
  "decode",
  "source_not_supported",
  "unknown",
  "offline",
  "playback_blocked",
]);

export const dynamic = "force-dynamic";

const EVENT_NAMES = new Set([
  "confirmation_viewed",
  "booking_summary_loaded",
  "booking_summary_missing",
  "video_started",
  "video_progress",
  "video_completed",
  "video_error",
  "all_videos_completed",
  "reschedule_clicked",
]);
const VIDEO_EVENTS = new Set([
  "video_started",
  "video_progress",
  "video_completed",
  "video_error",
]);
const VIDEO_SLUGS = new Set([
  "marketplace-control",
  "system-walkthrough",
  "faqs",
  "who-its-for",
]);
const PROGRESS_THRESHOLDS = new Set([25, 50, 75, 90, 100]);
const ALLOWED_KEYS = new Set([
  "eventName",
  "contentVersion",
  "videoSlug",
  "progressPercent",
  "positionSeconds",
  "eventId",
  "errorCode",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ValidEvent = {
  eventName: string;
  contentVersion: string;
  videoSlug: string | null;
  progressPercent: number | null;
  positionSeconds: number | null;
  eventId: string;
  metadata: Record<string, string>;
};

function json(data: unknown, status: number) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function parseEvent(value: unknown): ValidEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !ALLOWED_KEYS.has(key))) return null;

  const eventName = body.eventName;
  const contentVersion = body.contentVersion;
  const eventId = body.eventId;
  if (typeof eventName !== "string" || !EVENT_NAMES.has(eventName)) return null;
  // Pin to the deployed constant rather than a shape check. A 64-character
  // free-text field on an authenticated endpoint is an arbitrary-string sink,
  // and this table is documented as carrying no lead PII. Anything else is
  // either a stale tab or a hand-crafted request; neither should be stored.
  if (typeof contentVersion !== "string" || contentVersion !== CONTENT_VERSION) {
    return null;
  }
  if (typeof eventId !== "string" || !UUID_PATTERN.test(eventId)) return null;

  const isVideoEvent = VIDEO_EVENTS.has(eventName);
  const videoSlug = body.videoSlug;
  if (
    isVideoEvent &&
    (typeof videoSlug !== "string" || !VIDEO_SLUGS.has(videoSlug))
  ) {
    return null;
  }
  if (!isVideoEvent && videoSlug !== undefined) return null;

  const progressPercent = body.progressPercent;
  if (
    progressPercent !== undefined &&
    (typeof progressPercent !== "number" ||
      !Number.isInteger(progressPercent) ||
      !PROGRESS_THRESHOLDS.has(progressPercent))
  ) {
    return null;
  }
  if (eventName === "video_progress" && progressPercent === undefined) return null;
  if (
    !["video_progress", "video_completed"].includes(eventName) &&
    progressPercent !== undefined
  ) {
    return null;
  }
  if (
    eventName === "video_completed" &&
    progressPercent !== undefined &&
    ![90, 100].includes(progressPercent as number)
  ) {
    return null;
  }

  const positionSeconds = body.positionSeconds;
  if (
    positionSeconds !== undefined &&
    (typeof positionSeconds !== "number" ||
      !Number.isInteger(positionSeconds) ||
      positionSeconds < 0 ||
      positionSeconds > 86_400)
  ) {
    return null;
  }
  if (!isVideoEvent && positionSeconds !== undefined) return null;

  const errorCode = body.errorCode;
  if (
    errorCode !== undefined &&
    (eventName !== "video_error" ||
      typeof errorCode !== "string" ||
      // Allow-list, not a shape check — this value lands in `metadata`, and a
      // 64-char free-text field there is the same PII sink as contentVersion.
      !ERROR_CODES.has(errorCode))
  ) {
    return null;
  }

  return {
    eventName,
    contentVersion,
    videoSlug: typeof videoSlug === "string" ? videoSlug : null,
    progressPercent:
      typeof progressPercent === "number" ? progressPercent : null,
    positionSeconds: typeof positionSeconds === "number" ? positionSeconds : null,
    eventId,
    metadata: typeof errorCode === "string" ? { error_code: errorCode } : {},
  };
}

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (declaredLength > MAX_BODY_BYTES) return json({ error: "Invalid event" }, 413);

  // The header above is only a hint: it is absent on HTTP/2 and chunked
  // uploads, where Number("0") sails past the check and the old code then
  // buffered the whole body before measuring it. Count bytes as they arrive
  // and stop at the cap instead.
  //
  // The old measurement was wrong twice over: String.length counts UTF-16 code
  // units, so ~2k emoji (8 KB on the wire) passed a 4 KB limit.
  const chunks: Uint8Array[] = [];
  let bodyLength = 0;
  const reader = request.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    bodyLength += value.byteLength;
    if (bodyLength > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return json({ error: "Invalid event" }, 413);
    }
    chunks.push(value);
  }
  const bodyBytes = new Uint8Array(bodyLength);
  let bodyOffset = 0;
  for (const chunk of chunks) {
    bodyBytes.set(chunk, bodyOffset);
    bodyOffset += chunk.byteLength;
  }
  // Decode once over the assembled bytes — decoding chunk by chunk would
  // corrupt any multi-byte character split across a chunk boundary.
  const rawBody = new TextDecoder().decode(bodyBytes);
  if (rawBody.length === 0) {
    return json({ error: "Invalid event" }, 400);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid event" }, 400);
  }
  const event = parseEvent(parsed);
  if (!event) return json({ error: "Invalid event" }, 400);

  const session = await resolveStrategyCallSessionToken(
    request.cookies.get(STRATEGY_CALL_SESSION_COOKIE)?.value,
    { touch: false }
  );
  // Analytics is non-critical. Direct/expired visitors still get the public
  // education page, but cannot write unattributed rows into the reporting table.
  if (!session) return json({ accepted: false }, 202);

  const pepper = resolveStrategyCallPepper();
  if (!pepper) return json({ accepted: false }, 202);

  const dateBucket = new Date().toISOString().slice(0, 10);
  const rateLimitKey = createHmac("sha256", pepper)
    .update(`${session.id}:${clientIp(request)}:${dateBucket}`)
    .digest("hex");
  const supabase = getStrategyCallAdminClient();

  const { data: booking } = await supabase
    .from("strategy_call_bookings")
    .select("id")
    .eq("session_id", session.id)
    .order("last_provider_event_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const dedupeKey = `${session.id}:${event.eventId}`;
  const { data, error } = await supabase.rpc(
    "record_strategy_call_funnel_event",
    {
      p_session_id: session.id,
      p_booking_id: booking?.id ?? null,
      p_event_name: event.eventName,
      p_content_version: event.contentVersion,
      p_video_slug: event.videoSlug,
      p_progress_percent: event.progressPercent,
      p_position_seconds: event.positionSeconds,
      p_dedupe_key: dedupeKey,
      p_rate_limit_key: rateLimitKey,
      p_metadata: event.metadata,
    }
  );
  if (error) return json({ accepted: false }, 202);
  if (data === "rate_limited") return json({ error: "Too many events" }, 429);
  if (data === "duplicate") return json({ duplicate: true }, 200);
  return json({ accepted: true }, 202);
}
