// =============================================================================
// Meta Conversions API — the server half of the StartTrial signup event.
//
// The browser half is `trackStartTrial` in apps/web/src/lib/meta-tracking.ts.
// Both send the SAME event_id (`<tenantId>_trial`), so Meta counts one signup
// once (deduplication), whichever of the two arrives.
//
// Config: the project is at Supabase's 100-secret limit, so it lives in Vault,
// read through meta_capi_config() (service role only; migration
// 20261113120000):
//   meta_capi_token            the dataset's Conversions API access token
//   meta_capi_test_event_code  OPTIONAL. While set, every event is sent as a
//                              TEST event (it shows only under Events Manager →
//                              Test events). Delete it to go live:
//                              delete from vault.secrets where name = 'meta_capi_test_event_code';
//
// Never throws and never blocks the signup: a Meta outage or a missing token
// must not turn a provisioned tenant into an error the client retries.
// =============================================================================

export const META_DATASET_ID = "2196369497442053";
const GRAPH_VERSION = "v21.0";
const TIMEOUT_MS = 5_000;

// deno-lint-ignore no-explicit-any
type SupabaseLike = { rpc: (fn: string, args?: Record<string, unknown>) => any };

export interface MetaBrowserIds {
  /** The `_fbp` cookie. */
  fbp?: string | null;
  /** The `_fbc` cookie (or one built from a captured fbclid). */
  fbc?: string | null;
  /** The page the signup finished on. */
  eventSourceUrl?: string | null;
}

export interface StartTrialInput {
  /** Shared with the browser event. `<tenantId>_trial`. */
  eventId: string;
  email: string;
  fullName?: string | null;
  /** Any format; reduced to digits (with country code) before hashing. */
  phone?: string | null;
  /** The new account's auth user id. Hashed. */
  externalId: string;
  clientIp?: string | null;
  userAgent?: string | null;
  browser?: MetaBrowserIds | null;
  /** The signup's Stripe mode. A test-mode signup is only sent as a test event. */
  mode: "test" | "live";
}

const FBP_RE = /^fb\.\d\.\d{10,16}\.\d{1,30}$/;
const FBC_RE = /^fb\.\d\.\d{10,16}\.[A-Za-z0-9_\-]{1,500}$/;
const SOURCE_RE = /^https:\/\/([a-z0-9-]+\.)*drive-247\.com(\/|$)/i;

/** Only well-formed Meta ids and our own pages pass; anything else is dropped. */
export function sanitiseBrowserIds(raw: unknown): MetaBrowserIds {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.length <= max ? v.trim() : "";
  const fbp = str(r.fbp, 100);
  const fbc = str(r.fbc, 600);
  const url = str(r.eventSourceUrl, 500);
  return {
    fbp: FBP_RE.test(fbp) ? fbp : null,
    fbc: FBC_RE.test(fbc) ? fbc : null,
    eventSourceUrl: SOURCE_RE.test(url) ? url.split("#")[0] : null,
  };
}

async function sha256(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Meta's normalisation: trimmed + lowercased; names keep letters only. */
export function normaliseName(name: string): string {
  return name.trim().toLowerCase().normalize("NFKC").replace(/[^\p{L}]/gu, "");
}

/** Digits only, country code included (E.164 without the +). */
export function normalisePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export async function buildStartTrialEvent(input: StartTrialInput, nowSec = Math.floor(Date.now() / 1000)) {
  const email = input.email.trim().toLowerCase();
  const parts = (input.fullName ?? "").trim().split(/\s+/).filter(Boolean);
  const fn = parts.length ? normaliseName(parts[0]) : "";
  const ln = parts.length > 1 ? normaliseName(parts[parts.length - 1]) : "";
  const ph = input.phone ? normalisePhone(input.phone) : "";

  const userData: Record<string, unknown> = {
    em: [await sha256(email)],
    external_id: [await sha256(input.externalId)],
  };
  if (ph.length >= 7) userData.ph = [await sha256(ph)];
  if (fn) userData.fn = [await sha256(fn)];
  if (ln) userData.ln = [await sha256(ln)];
  if (input.clientIp) userData.client_ip_address = input.clientIp;
  if (input.userAgent) userData.client_user_agent = input.userAgent.slice(0, 500);
  if (input.browser?.fbp) userData.fbp = input.browser.fbp;
  if (input.browser?.fbc) userData.fbc = input.browser.fbc;

  return {
    event_name: "StartTrial",
    event_time: nowSec,
    event_id: input.eventId,
    action_source: "website",
    event_source_url: input.browser?.eventSourceUrl || "https://drive-247.com/",
    user_data: userData,
    custom_data: { currency: "USD", value: 0 },
  };
}

/**
 * Send StartTrial. Returns a short outcome string for the log; never throws.
 */
export async function sendStartTrial(supabase: SupabaseLike, input: StartTrialInput): Promise<string> {
  try {
    const { data: cfg, error } = await supabase.rpc("meta_capi_config");
    if (error) return `skipped: config read failed (${error.message ?? error})`;
    const token: string | undefined = cfg?.token || undefined;
    const testCode: string | undefined = cfg?.test_event_code || undefined;
    if (!token) return "skipped: no meta_capi_token in Vault";
    // A test-mode (fake card) signup is never reported to the live dataset.
    if (input.mode === "test" && !testCode) return "skipped: test-mode signup and no test event code";

    const event = await buildStartTrialEvent(input);
    const form = new URLSearchParams({ data: JSON.stringify([event]), access_token: token });
    if (testCode) form.set("test_event_code", testCode);

    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${META_DATASET_ID}/events`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) return `failed: HTTP ${res.status} ${text.slice(0, 300)}`;
    return `sent${testCode ? " (test event)" : ""}: ${text.slice(0, 200)}`;
  } catch (e) {
    return `failed: ${(e as Error)?.message ?? e}`;
  }
}

/**
 * Fire-and-forget: run after the response when the edge runtime allows it,
 * otherwise wait (bounded by the fetch timeout) so the event is not lost.
 */
export async function sendStartTrialInBackground(
  supabase: SupabaseLike,
  input: StartTrialInput,
  log: string,
): Promise<void> {
  const p = sendStartTrial(supabase, input).then((outcome) =>
    console.log(`${log} Meta StartTrial ${input.eventId}: ${outcome}`)
  );
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
  else await p;
}
