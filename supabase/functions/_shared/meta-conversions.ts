// =============================================================================
// meta-conversions — tells Meta (Facebook ads) that a signup happened, from the
// server, through the Conversions API.
//
// The browser pixel sends the same event (apps/web/src/lib/meta-tracking.ts),
// but iPhone privacy settings and ad blockers drop a lot of browser events, so
// the server copy is the one Meta can rely on. Both carry the SAME `event_id`,
// which is how Meta counts one signup instead of two.
//
// Secrets (Supabase function secrets, never in the repo):
//   META_CAPI_ACCESS_TOKEN     Events Manager → dataset → Settings → Conversions API
//   META_CAPI_TEST_EVENT_CODE  optional; set ONLY while testing. Events then show
//                              under "Test events" and do not feed the campaign.
//   META_PIXEL_ID              optional override of the dataset below.
//
// Nothing here may fail a signup: every path catches and logs.
// =============================================================================

/** The "Cortek Systems" dataset — the same id the site's pixel uses. */
const DEFAULT_PIXEL_ID = "2196369497442053";
const GRAPH = "https://graph.facebook.com/v21.0";
const LOG = "[meta-conversions]";

/** What the browser hands over so Meta can tie the signup to the ad click. */
export interface MetaBrowserSignals {
  /** The `_fbp` cookie: Meta's browser id. */
  fbp?: string;
  /** The `_fbc` cookie, or one built from the landing page's `fbclid`. */
  fbc?: string;
  /** The page the signup happened on. */
  sourceUrl?: string;
}

export interface StartTrialInput {
  /** The new account's auth user id. */
  userId: string;
  email: string;
  fullName?: string | null;
  phone?: string | null;
  signals?: MetaBrowserSignals | null;
  /** The signup request, for the visitor's IP and browser. */
  req: Request;
}

/** One id per account, shared by the browser and the server event. Never reused. */
export function startTrialEventId(userId: string): string {
  return `${userId}_trial`;
}

/** True while a test code is set: events go to Meta's "Test events" tab. */
export function metaTestCode(): string | null {
  return Deno.env.get("META_CAPI_TEST_EVENT_CODE")?.trim() || null;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** `fb.1.<ms>.<id>` — anything else is dropped rather than sent malformed. */
function cleanFbCookie(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  return v.length <= 500 && /^fb\.\d\.\d+\.[\w.-]+$/.test(v) ? v : undefined;
}

function cleanUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2000) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    // The address without its query string: it can carry tokens and codes.
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

function clientIp(req: Request): string | undefined {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || undefined;
}

/**
 * Send `StartTrial` for a newly created account. Returns true when Meta took it.
 *
 * Call it once, on the run that actually created the account — never on an
 * idempotent repeat. Safe to await: it gives up after five seconds.
 */
export async function sendStartTrial(input: StartTrialInput): Promise<boolean> {
  try {
    const token = Deno.env.get("META_CAPI_ACCESS_TOKEN")?.trim();
    if (!token) {
      console.warn(`${LOG} META_CAPI_ACCESS_TOKEN is not set — StartTrial not sent`);
      return false;
    }
    const pixelId = Deno.env.get("META_PIXEL_ID")?.trim() || DEFAULT_PIXEL_ID;

    const userData: Record<string, unknown> = {
      em: [await sha256(input.email.trim().toLowerCase())],
      external_id: [await sha256(input.userId)],
    };

    const names = (input.fullName ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (names.length) userData.fn = [await sha256(names[0])];
    if (names.length > 1) userData.ln = [await sha256(names[names.length - 1])];

    const phoneDigits = (input.phone ?? "").replace(/\D/g, "");
    if (phoneDigits.length >= 8) userData.ph = [await sha256(phoneDigits)];

    const ip = clientIp(input.req);
    if (ip) userData.client_ip_address = ip;
    const userAgent = input.req.headers.get("user-agent");
    if (userAgent) userData.client_user_agent = userAgent;

    const fbp = cleanFbCookie(input.signals?.fbp);
    if (fbp) userData.fbp = fbp;
    const fbc = cleanFbCookie(input.signals?.fbc);
    if (fbc) userData.fbc = fbc;

    const event: Record<string, unknown> = {
      event_name: "StartTrial",
      event_time: Math.floor(Date.now() / 1000),
      event_id: startTrialEventId(input.userId),
      action_source: "website",
      user_data: userData,
      custom_data: { currency: "USD", value: 0 },
    };
    const sourceUrl = cleanUrl(input.signals?.sourceUrl) ?? cleanUrl(input.req.headers.get("referer"));
    if (sourceUrl) event.event_source_url = sourceUrl;

    const payload: Record<string, unknown> = { data: [event] };
    const testCode = metaTestCode();
    if (testCode) payload.test_event_code = testCode;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${GRAPH}/${pixelId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        console.error(`${LOG} StartTrial refused (${res.status}):`, (await res.text()).slice(0, 500));
        return false;
      }
      console.log(`${LOG} StartTrial sent for ${event.event_id}${testCode ? " (test event)" : ""}`);
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.error(`${LOG} StartTrial threw (non-fatal):`, e);
    return false;
  }
}
