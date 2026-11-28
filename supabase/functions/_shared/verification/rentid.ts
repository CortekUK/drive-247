// feat-003: RentID, the premium record checks (spec 08). One Drive247 account for every company (D21).
// The key is read only here, inside edge functions, never returned or logged (spec 08.21).

const BASE = "https://api.rentid.io/api/v1";

const ENDPOINT: Record<string, string> = {
  licence_status: "/verifications/driver-license-checks",
  driving_record: "/verifications/motor-vehicle-reports",
  criminal_record: "/verifications/criminal-background-checks",
};

export interface Subject {
  first_name: string;
  last_name: string;
  dob: string | null;              // YYYY-MM-DD; sent as YYYYMMDD
  licence_number: string | null;
  licence_state: string | null;    // two letters
}

export type StartOutcome =
  | { kind: "started"; requestId: string; status: string; report: any }
  | { kind: "state_not_supported" }
  | { kind: "out_of_credit"; code: string }
  | { kind: "missing_details"; field: string }
  | { kind: "not_configured" }
  | { kind: "error"; detail: string };

export function isConfigured(): boolean {
  return !!Deno.env.get("RENTID_API_KEY");
}

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const key = Deno.env.get("RENTID_API_KEY");
  if (!key) return { status: 0, data: null };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000); // spec 08.10
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "X-API-Key": key, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/** Only the fields a check needs, nothing else (spec 08.5, 08.6). */
export function requestBody(service: string, s: Subject, webhookUrl: string, referenceId: string): Record<string, unknown> | { missing: string } {
  const dob = s.dob ? s.dob.replace(/-/g, "") : null;
  if (service === "criminal_record") {
    if (!dob) return { missing: "date of birth" };
    return { first_name: s.first_name, last_name: s.last_name, dob, reference_id: referenceId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) };
  }
  if (!s.licence_number) return { missing: "licence number" };
  if (!s.licence_state || !/^[A-Za-z]{2}$/.test(s.licence_state)) return { missing: "licence state" };
  return {
    first_name: s.first_name,
    last_name: s.last_name,
    driver_license_number: s.licence_number,
    driver_license_state: s.licence_state.toUpperCase(),
    ...(dob ? { dob } : {}),
    webhook_url: webhookUrl,
  };
}

export async function startCheck(service: string, subject: Subject, webhookUrl: string, referenceId: string): Promise<StartOutcome> {
  if (!isConfigured()) return { kind: "not_configured" };
  const body = requestBody(service, subject, webhookUrl, referenceId);
  if ("missing" in body) return { kind: "missing_details", field: String(body.missing) };
  let res: { status: number; data: any };
  try {
    res = await call("POST", ENDPOINT[service], body);
  } catch (e) {
    return { kind: "error", detail: `network: ${String(e).slice(0, 120)}` };
  }
  const code = res.data?.error_code ?? "";
  if (res.status >= 200 && res.status < 300 && res.data?.data?.request_id) {
    const d = res.data.data;
    return { kind: "started", requestId: d.request_id, status: d.status, report: d.report ?? null };
  }
  if (res.status === 400 && code === "STATE_NOT_SUPPORTED") return { kind: "state_not_supported" };
  if (res.status === 402) return { kind: "out_of_credit", code: code || "PAYMENT_REQUIRED" };
  return { kind: "error", detail: `${res.status} ${code}`.trim() };
}

/** Read a request and its report (free). Null when RentID has no such request. */
export async function getResult(requestId: string): Promise<{ status: string; report: any } | null> {
  const res = await call("GET", `/verifications/${encodeURIComponent(requestId)}`);
  if (res.status === 404) return null;
  if (res.status < 200 || res.status >= 300) throw new Error(`RentID read failed (${res.status})`);
  const d = res.data?.data ?? {};
  return { status: d.status, report: d.report ?? null };
}

// ── Webhook signature (spec 08.11): X-Rentid-Signature: t=<unix>,v1=<hex>[,v1=<hex>] ──

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyWebhook(rawBody: string, header: string, nowSeconds = Date.now() / 1000): Promise<boolean> {
  const secret = Deno.env.get("RENTID_WEBHOOK_SECRET");
  if (!secret || !header) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => (v ?? "").toLowerCase());
  if (!Number.isFinite(t) || Math.abs(nowSeconds - t) > 300 || !sigs.length) return false;
  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  return sigs.some((s) => s.length === expected.length && [...s].every((c, i) => c === expected[i]));
}

export const _forTests = { hmacHex };
