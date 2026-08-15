export type BookingEventType =
  | "scheduled"
  | "rescheduled"
  | "cancelled"
  | "completed"
  | "no_show";

export type NormalizedGhlBookingEvent = {
  providerEventId: string;
  occurredAt: string;
  eventType: BookingEventType;
  externalBookingId: string;
  locationId?: string;
  externalCalendarId?: string;
  externalContactId?: string;
  sessionId?: string;
  normalizedEmail?: string;
  startsAt?: string;
  endsAt?: string;
  timezone?: string;
  rescheduleUrl?: string;
  cancelUrl?: string;
  meetingUrl?: string;
};

export type WebhookMode = "marketplace" | "workflow_shared_secret";

export const OFFICIAL_GHL_ED25519_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed && trimmed.length <= 2048) return trimmed;
    }
  }
  return undefined;
}

function isoDate(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function customFieldValue(
  fields: unknown,
  acceptedKeys: Set<string>
): string | undefined {
  if (!Array.isArray(fields)) return undefined;
  for (const field of fields) {
    const item = asRecord(field);
    if (!item) continue;
    const key = stringValue(item.key, item.fieldKey, item.name)?.toLowerCase();
    if (!key || !acceptedKeys.has(key)) continue;
    return stringValue(item.value, item.valueString);
  }
  return undefined;
}

function mapEventType(providerType: string, providerStatus: string): BookingEventType | null {
  const type = providerType.toLowerCase().replace(/[._\s-]/g, "");
  const status = providerStatus.toLowerCase().replace(/[._\s-]/g, "");

  if (
    type === "appointmentdelete" ||
    status === "cancelled" ||
    status === "canceled" ||
    status === "invalid"
  ) {
    return "cancelled";
  }
  if (status === "noshow") return "no_show";
  if (status === "showed" || status === "completed") return "completed";
  if (type === "appointmentcreate" || type === "scheduled") return "scheduled";
  if (type === "appointmentupdate" || type === "rescheduled") return "rescheduled";
  if (["new", "confirmed", "active", "scheduled"].includes(status)) {
    return type.includes("update") ? "rescheduled" : "scheduled";
  }
  return null;
}

/**
 * Normalizes the official nested AppointmentCreate/Update/Delete payload and a
 * deliberately small set of flat aliases used by a configured GHL Workflow
 * custom webhook. No raw payload is returned or persisted.
 */
export function normalizeGhlBookingEvent(
  value: unknown,
  fallbackEventId: string
): NormalizedGhlBookingEvent | null {
  const body = asRecord(value);
  if (!body) return null;
  const nested = asRecord(body.appointment);
  const appointment = nested ?? body;
  const customData = asRecord(body.customData) ?? asRecord(appointment.customData);

  const externalBookingId = stringValue(
    appointment.id,
    appointment.appointmentId,
    body.appointmentId
  );
  const startsAt = isoDate(
    appointment.startTime ?? appointment.startsAt ?? body.startTime ?? body.startsAt
  );
  const endsAt = isoDate(
    appointment.endTime ?? appointment.endsAt ?? body.endTime ?? body.endsAt
  );
  const occurredAt = isoDate(
    body.timestamp ??
      body.occurredAt ??
      appointment.dateUpdated ??
      appointment.dateAdded
  );
  if (!externalBookingId || externalBookingId.length > 255 || !occurredAt) {
    return null;
  }

  const providerType = stringValue(body.type, body.eventType) ?? "";
  const providerStatus =
    stringValue(appointment.appointmentStatus, appointment.status, body.status) ?? "";
  const eventType = mapEventType(providerType, providerStatus);
  if (!eventType) return null;
  const validInterval = Boolean(
    startsAt &&
      endsAt &&
      new Date(endsAt).getTime() > new Date(startsAt).getTime()
  );
  if (!validInterval && ["scheduled", "rescheduled"].includes(eventType)) {
    return null;
  }

  const sessionFieldKeys = new Set([
    "strategy_call_session_id",
    "strategycallsessionid",
    "session_id",
    "sessionid",
  ]);
  const sessionCandidate = stringValue(
    body.strategyCallSessionId,
    body.sessionId,
    appointment.strategyCallSessionId,
    appointment.sessionId,
    customData?.strategy_call_session_id,
    customData?.strategyCallSessionId,
    customFieldValue(body.customFields, sessionFieldKeys),
    customFieldValue(appointment.customFields, sessionFieldKeys)
  );

  const emailCandidate = stringValue(
    body.email,
    asRecord(body.contact)?.email,
    appointment.email,
    customData?.email
  )?.toLowerCase();

  const providerEventId = stringValue(
    body.webhookId,
    body.eventId,
    body.providerEventId,
    fallbackEventId
  );
  if (!providerEventId || providerEventId.length > 255) return null;

  return {
    providerEventId,
    occurredAt,
    eventType,
    externalBookingId,
    locationId: stringValue(body.locationId, appointment.locationId),
    externalCalendarId: stringValue(appointment.calendarId, body.calendarId),
    externalContactId: stringValue(appointment.contactId, body.contactId),
    sessionId:
      sessionCandidate && UUID_PATTERN.test(sessionCandidate)
        ? sessionCandidate
        : undefined,
    normalizedEmail:
      emailCandidate && emailCandidate.length <= 254 && EMAIL_PATTERN.test(emailCandidate)
        ? emailCandidate
        : undefined,
    startsAt: validInterval ? startsAt : undefined,
    endsAt: validInterval ? endsAt : undefined,
    timezone: stringValue(
      appointment.timezone,
      appointment.timeZone,
      body.timezone,
      body.timeZone
    ),
    rescheduleUrl: stringValue(
      appointment.rescheduleUrl,
      appointment.reschedule_url,
      body.rescheduleUrl,
      body.reschedule_url
    ),
    cancelUrl: stringValue(
      appointment.cancelUrl,
      appointment.cancel_url,
      body.cancelUrl,
      body.cancel_url
    ),
    meetingUrl: stringValue(
      appointment.meetingUrl,
      appointment.meeting_url,
      appointment.address,
      body.meetingUrl,
      body.meeting_url
    ),
  };
}

export function sanitizeProviderUrl(
  value: string | undefined,
  allowedHosts: readonly string[]
): string | undefined {
  if (!value || value.length > 2048 || allowedHosts.length === 0) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return undefined;
    const hostname = url.hostname.toLowerCase();
    if (
      !allowedHosts.some(
        (host) => hostname === host || hostname.endsWith(`.${host}`)
      )
    ) {
      return undefined;
    }
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function pemToDer(pem: string): Uint8Array | null {
  const base64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s/g, "");
  return base64ToBytes(base64);
}

async function verifyEd25519(
  rawBody: string,
  signature: string,
  publicKeyPem: string
): Promise<boolean> {
  const keyBytes = pemToDer(publicKeyPem);
  const signatureBytes = base64ToBytes(signature);
  if (!keyBytes || !signatureBytes) return false;
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      keyBytes,
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      signatureBytes,
      new TextEncoder().encode(rawBody)
    );
  } catch {
    return false;
  }
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0 && left.length === right.length;
}

export async function verifyWebhookAuthenticity(options: {
  rawBody: string;
  headers: Headers;
  mode: WebhookMode;
  publicKeyPem?: string;
  workflowSecret?: string;
}): Promise<boolean> {
  if (options.mode === "marketplace") {
    const signature = options.headers.get("x-ghl-signature");
    if (!signature || signature === "N/A") return false;
    return verifyEd25519(
      options.rawBody,
      signature,
      options.publicKeyPem || OFFICIAL_GHL_ED25519_PUBLIC_KEY
    );
  }

  // This mode is only for an explicitly configured GHL Workflow custom
  // webhook. It is never a fallback for a failed/missing Marketplace signature.
  if (options.mode === "workflow_shared_secret") {
    const supplied = options.headers.get("x-strategy-call-workflow-secret");
    if (!supplied || !options.workflowSecret) return false;
    return constantTimeEqual(supplied, options.workflowSecret);
  }
  return false;
}
