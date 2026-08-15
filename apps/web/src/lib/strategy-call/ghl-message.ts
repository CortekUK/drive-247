export const GHL_BOOKING_COMPLETE_EVENT = "msgsndr-booking-complete";

type GhlMessageLike = Pick<MessageEvent, "data" | "origin" | "source">;

function toHttpsOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Builds an exact-origin allow-list. The calendar URL is a safe default while
 * NEXT_PUBLIC_GHL_ALLOWED_ORIGINS supports provider-confirmed message origins.
 */
export function getAllowedGhlOrigins(
  configuredOrigins: string | undefined,
  bookingUrl: string,
): ReadonlySet<string> {
  const origins = new Set<string>();
  const bookingOrigin = toHttpsOrigin(bookingUrl);
  if (bookingOrigin) origins.add(bookingOrigin);

  for (const candidate of configuredOrigins?.split(",") ?? []) {
    const origin = toHttpsOrigin(candidate);
    if (origin) origins.add(origin);
  }

  return origins;
}

export function isTrustedGhlCompletionMessage(
  event: GhlMessageLike,
  calendarWindow: Window | null | undefined,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  if (!calendarWindow || event.source !== calendarWindow) return false;
  if (!allowedOrigins.has(event.origin)) return false;

  return (
    Array.isArray(event.data) &&
    event.data.length > 0 &&
    event.data[0] === GHL_BOOKING_COMPLETE_EVENT
  );
}

export function getGhlSessionQueryParam(
  configuredParam: string | undefined,
): string | null {
  const param = configuredParam?.trim() ?? "";
  return /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(param) ? param : null;
}
