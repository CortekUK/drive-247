import { getStrategyCallAdminClient } from "./supabase-admin";
import { getStrategyCallSession } from "./session";

export type BookingSummaryDTO = {
  status: "scheduled" | "rescheduled" | "cancelled" | "processing" | "missing";
  startsAt?: string;
  endsAt?: string;
  timezone?: string;
  rescheduleUrl?: string;
  canShowDetails: boolean;
};

function allowedUrlHosts(): string[] {
  return (process.env.GHL_STRATEGY_CALL_ALLOWED_URL_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function safeProviderUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return undefined;
    const allowed = allowedUrlHosts();
    if (
      allowed.length === 0 ||
      !allowed.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
      )
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * Resolves only fields approved for the public confirmation page. In
 * particular this never returns a contact row, provider IDs, or meeting URL.
 */
export async function getStrategyCallBookingSummary(): Promise<BookingSummaryDTO> {
  try {
    const session = await getStrategyCallSession();
    if (!session) return { status: "missing", canShowDetails: false };

    const { data, error } = await getStrategyCallAdminClient()
      .from("strategy_call_bookings")
      .select(
        "status, scheduled_start_at, scheduled_end_at, booking_timezone, reschedule_url"
      )
      .eq("session_id", session.id)
      .order("last_provider_event_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return { status: "processing", canShowDetails: false };
    if (!data) return { status: "processing", canShowDetails: false };

    // The public DTO intentionally has no attended/no-show state. Do not
    // misrepresent a finished appointment as an active booking on a revisit.
    if (data.status === "completed" || data.status === "no_show") {
      return { status: "missing", canShowDetails: false };
    }

    const publicStatus: BookingSummaryDTO["status"] =
      data.status === "cancelled" || data.status === "rescheduled"
        ? data.status
        : "scheduled";

    return {
      status: publicStatus,
      startsAt: data.scheduled_start_at,
      endsAt: data.scheduled_end_at,
      timezone: data.booking_timezone || undefined,
      rescheduleUrl: safeProviderUrl(data.reschedule_url),
      canShowDetails: true,
    };
  } catch {
    return { status: "missing", canShowDetails: false };
  }
}
