// Custom domain, self-serve — the Vercel side.
//
// A tenant who owns `example.com` gets:
//   example.com          → the booking project   (where customers book)
//   www.example.com      → the booking project, 308 to example.com
//   portal.example.com   → the portal project    (where staff sign in)
//
// Routing is already handled by the apps (booking middleware / portal proxy
// look the tenant up by custom_booking_domain / custom_portal_domain). What
// this module adds is the hosting half: putting the names on our Vercel
// projects, reading back the DNS records Vercel wants, and telling whether
// they are in place. Vercel issues and renews the certificate on its own once
// DNS points at it.
//
// Credentials: the project is at Supabase's 100-secret limit, so they live in
// Vault as `vercel_custom_domains` = {token, team_id, booking_project,
// portal_project}, read through custom_domain_vercel_config() (service role
// only; migration 20261015160000). Call loadVercelConfig(db) once per request
// before anything else here. VERCEL_API_TOKEN / VERCEL_TEAM_ID /
// VERCEL_BOOKING_PROJECT / VERCEL_PORTAL_PROJECT env vars override it.

import { getTenantBranding, getTenantNotificationRecipient, sendResendEmail, wrapWithBrandedTemplate } from "./resend-service.ts";

/**
 * Who gets the self-serve flow: the pilot tenant, or every v2 tenant once the
 * switch in Super Admin → Customer Management → Custom Domain is on
 * (custom_domain_settings, migration 20261015140000).
 */
export async function selfServeAllowed(db: any, tenantId: string): Promise<boolean> {
  const { data, error } = await db.rpc("custom_domain_self_serve_allowed", { p_tenant_id: tenantId });
  if (error) throw error;
  return data === true;
}

/** A pending domain still not live after this long is marked `error`. */
export const GIVE_UP_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const PLATFORM_DOMAINS = ["drive-247.com", "vercel.app", "localhost"];
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// Vercel's long-standing values. Only used when its API does not hand back
// project-specific ones; both still resolve to Vercel.
const FALLBACK_A = "76.76.21.21";
const FALLBACK_CNAME = "cname.vercel-dns.com";

export type DnsRecord = { type: "A" | "CNAME" | "TXT"; name: string; value: string; ok?: boolean };

/* ─────────────────────────────── domain rules ────────────────────────────── */

/** Same rules as the portal's normalizeDomain — the server does not trust the client's. */
export function normalizeDomain(raw: string): string {
  let s = String(raw ?? "").trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split(/[/?#]/)[0];
  s = s.split("@").pop() ?? "";
  s = s.split(":")[0];
  s = s.replace(/\.+$/, "");
  if (s.startsWith("www.")) s = s.slice(4);
  return s;
}

export function validateDomain(domain: string): string | null {
  if (!domain) return "Enter your domain, like example.com.";
  if (domain.length > 253) return "That is too long to be a domain name.";
  const labels = domain.split(".");
  if (labels.length < 2) return "Include the ending — example.com, not just example.";
  if (!labels.every((l) => LABEL.test(l))) return "That does not look like a domain name. Enter it like example.com.";
  if (!/^[a-z]{2,63}$/.test(labels[labels.length - 1])) return "The ending does not look right — it should be letters, like .com or .net.";
  if (domain.startsWith("portal.")) return "Enter the main domain only. We add portal. in front of it for you.";
  if (PLATFORM_DOMAINS.some((p) => domain === p || domain.endsWith("." + p))) {
    return "That is a Drive247 address. A custom domain has to be one you own, like example.com.";
  }
  return null;
}

export const hostsFor = (domain: string) => ({
  apex: domain,
  www: `www.${domain}`,
  portal: `portal.${domain}`,
});

/* ─────────────────────────────── Vercel API ─────────────────────────────── */

export class VercelError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

type VercelConfig = { token: string; teamId: string | null; booking: string; portal: string };
let cached: VercelConfig | null = null;

export async function loadVercelConfig(db: any): Promise<void> {
  if (cached) return;
  const env = (k: string) => Deno.env.get(k) || null;
  let v: any = {};
  if (!env("VERCEL_API_TOKEN")) {
    const { data, error } = await db.rpc("custom_domain_vercel_config");
    if (error) console.error("custom_domain_vercel_config failed:", error);
    v = data ?? {};
  }
  const token = env("VERCEL_API_TOKEN") ?? v.token;
  const booking = env("VERCEL_BOOKING_PROJECT") ?? v.booking_project;
  const portal = env("VERCEL_PORTAL_PROJECT") ?? v.portal_project;
  if (token && booking && portal) {
    cached = { token, teamId: env("VERCEL_TEAM_ID") ?? v.team_id ?? null, booking, portal };
  }
}

function config(): VercelConfig {
  if (!cached) {
    throw new VercelError(503, "not_configured", "Custom domains are not switched on yet. Please try again later.");
  }
  return cached;
}

export function projects() {
  const c = config();
  return { booking: c.booking, portal: c.portal };
}

async function vercel(method: string, path: string, body?: unknown, query: Record<string, string> = {}) {
  const c = config();
  const url = new URL(`https://api.vercel.com${path}`);
  if (c.teamId) url.searchParams.set("teamId", c.teamId);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const code = json?.error?.code ?? `http_${res.status}`;
    const message = json?.error?.message ?? `Vercel answered ${res.status}`;
    throw new VercelError(res.status, code, message);
  }
  return json;
}

const enc = encodeURIComponent;

/** The domain on the project, or null when it is not there. */
async function getProjectDomain(project: string, name: string) {
  try {
    return await vercel("GET", `/v9/projects/${enc(project)}/domains/${enc(name)}`);
  } catch (e) {
    if (e instanceof VercelError && e.status === 404) return null;
    throw e;
  }
}

/** Adds the name to the project unless it is already there. Idempotent. */
async function ensureProjectDomain(project: string, name: string, redirect?: string) {
  const existing = await getProjectDomain(project, name);
  if (existing) return existing;
  try {
    return await vercel("POST", `/v10/projects/${enc(project)}/domains`, {
      name,
      ...(redirect ? { redirect, redirectStatusCode: 308 } : {}),
    });
  } catch (e) {
    if (e instanceof VercelError && (e.code === "domain_already_in_use" || e.status === 409)) {
      throw new VercelError(
        409,
        "domain_in_use",
        `${name} is already connected to another website on our hosting. If it is yours, email support@drive-247.com and we will free it up.`,
      );
    }
    if (e instanceof VercelError && e.code === "invalid_domain") {
      throw new VercelError(400, "invalid_domain", `${name} is not a domain we can connect.`);
    }
    throw e;
  }
}

async function removeProjectDomain(project: string, name: string) {
  try {
    await vercel("DELETE", `/v9/projects/${enc(project)}/domains/${enc(name)}`);
  } catch (e) {
    if (e instanceof VercelError && e.status === 404) return;
    throw e;
  }
}

/** Asks Vercel to re-check ownership. A not-yet-verifiable domain is not an error here. */
async function verifyProjectDomain(project: string, name: string) {
  try {
    return await vercel("POST", `/v9/projects/${enc(project)}/domains/${enc(name)}/verify`);
  } catch (e) {
    if (e instanceof VercelError && e.status === 400) return null;
    throw e;
  }
}

type DomainConfig = { misconfigured: boolean; a: string; cname: string };

async function getDomainConfig(project: string, name: string): Promise<DomainConfig> {
  try {
    const c = await vercel("GET", `/v6/domains/${enc(name)}/config`, undefined, { projectIdOrName: project });
    const ipv4 = (c?.recommendedIPv4 ?? []).find((r: any) => r.rank === 1)?.value?.[0];
    const cname = (c?.recommendedCNAME ?? []).find((r: any) => r.rank === 1)?.value;
    return {
      misconfigured: c?.misconfigured !== false,
      a: ipv4 || FALLBACK_A,
      cname: String(cname || FALLBACK_CNAME).replace(/\.$/, ""),
    };
  } catch (e) {
    if (e instanceof VercelError && e.code === "not_configured") throw e;
    return { misconfigured: true, a: FALLBACK_A, cname: FALLBACK_CNAME };
  }
}

/* ──────────────────────────────── records ───────────────────────────────── */

/** The A + CNAME records the operator adds, as Vercel recommends them for our projects. */
export async function recommendedRecords(domain: string): Promise<DnsRecord[]> {
  const p = projects();
  const h = hostsFor(domain);
  const [apex, www, portal] = await Promise.all([
    getDomainConfig(p.booking, h.apex),
    getDomainConfig(p.booking, h.www),
    getDomainConfig(p.portal, h.portal),
  ]);
  return [
    { type: "A", name: "@", value: apex.a },
    { type: "CNAME", name: "www", value: www.cname },
    { type: "CNAME", name: "portal", value: portal.cname },
  ];
}

/** TXT records Vercel asks for when the domain is already claimed in another Vercel account. */
function verificationRecords(domainObj: any, apex: string): DnsRecord[] {
  return (domainObj?.verification ?? [])
    .filter((v: any) => v?.type === "TXT")
    .map((v: any) => {
      const full = String(v.domain ?? "").replace(/\.$/, "");
      const name = full === apex ? "@" : full.endsWith("." + apex) ? full.slice(0, -(apex.length + 1)) : full;
      return { type: "TXT" as const, name, value: String(v.value ?? "") };
    });
}

/* ─────────────────────────────── lifecycle ──────────────────────────────── */

/** Puts all three names on our projects. Rolls back what it added if one fails. */
export async function connectDomain(domain: string) {
  const p = projects();
  const h = hostsFor(domain);
  const added: Array<[string, string]> = [];
  try {
    await ensureProjectDomain(p.booking, h.apex);
    added.push([p.booking, h.apex]);
    await ensureProjectDomain(p.booking, h.www, h.apex);
    added.push([p.booking, h.www]);
    await ensureProjectDomain(p.portal, h.portal);
    added.push([p.portal, h.portal]);
  } catch (e) {
    await Promise.allSettled(added.map(([proj, name]) => removeProjectDomain(proj, name)));
    throw e;
  }
}

export async function disconnectDomain(domain: string) {
  const p = projects();
  const h = hostsFor(domain);
  await Promise.all([
    removeProjectDomain(p.booking, h.www),
    removeProjectDomain(p.booking, h.apex),
    removeProjectDomain(p.portal, h.portal),
  ]);
}

/** Does anything answer over https? A TLS failure means the certificate is not there yet. */
async function answersOverHttps(host: string): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8_000);
  try {
    const res = await fetch(`https://${host}/`, { method: "HEAD", redirect: "manual", signal: ctl.signal });
    await res.body?.cancel();
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export type CheckResult = {
  status: "pending" | "active" | "error";
  detail: string;
  records: DnsRecord[];
};

/**
 * Where the domain stands right now, from Vercel's side. Re-adds a name that
 * went missing from a project (someone removed it by hand) rather than waiting
 * forever on it.
 */
export async function checkDomain(domain: string): Promise<CheckResult> {
  const p = projects();
  const h = hostsFor(domain);

  const [apexObj, wwwObj, portalObj] = await Promise.all([
    ensureProjectDomain(p.booking, h.apex),
    ensureProjectDomain(p.booking, h.www, h.apex),
    ensureProjectDomain(p.portal, h.portal),
  ]);

  const verified = await Promise.all(
    [[p.booking, apexObj], [p.booking, wwwObj], [p.portal, portalObj]].map(async ([proj, obj]: any) =>
      obj?.verified ? obj : (await verifyProjectDomain(proj, obj.name)) ?? obj
    ),
  );

  const [apexCfg, wwwCfg, portalCfg] = await Promise.all([
    getDomainConfig(p.booking, h.apex),
    getDomainConfig(p.booking, h.www),
    getDomainConfig(p.portal, h.portal),
  ]);

  const txt = verified.flatMap((d) => (d?.verified ? [] : verificationRecords(d, h.apex)));
  const records: DnsRecord[] = [
    { type: "A", name: "@", value: apexCfg.a, ok: !apexCfg.misconfigured },
    { type: "CNAME", name: "www", value: wwwCfg.cname, ok: !wwwCfg.misconfigured },
    { type: "CNAME", name: "portal", value: portalCfg.cname, ok: !portalCfg.misconfigured },
    ...txt.map((r) => ({ ...r, ok: false })),
  ];

  if (txt.length) {
    return {
      status: "pending",
      detail: "This domain is also set up on another hosting account. Add the TXT record below to prove it's yours.",
      records,
    };
  }
  // www is a convenience redirect; the booking site and portal are what must work.
  if (apexCfg.misconfigured || portalCfg.misconfigured) {
    const missing = [apexCfg.misconfigured && "the A record", portalCfg.misconfigured && "the portal record"].filter(Boolean);
    return {
      status: "pending",
      detail: `Waiting for ${missing.join(" and ")} to show up. New records can take a few minutes to a few hours.`,
      records,
    };
  }

  const [apexHttps, portalHttps] = await Promise.all([answersOverHttps(h.apex), answersOverHttps(h.portal)]);
  if (!apexHttps || !portalHttps) {
    return { status: "pending", detail: "Your records are in. Setting up the secure certificate now.", records };
  }
  return { status: "active", detail: "Live.", records };
}

/* ────────────────────────────── persistence ─────────────────────────────── */

/**
 * Checks one tenant and writes the result. Emails the operator the first time
 * it goes live. Returns the new state for the caller to show.
 */
export async function checkAndRecord(db: any, tenant: {
  id: string;
  custom_booking_domain: string | null;
  custom_domain_status: string | null;
  custom_domain_requested_at: string | null;
}): Promise<CheckResult> {
  const domain = tenant.custom_booking_domain!;
  const nowIso = new Date().toISOString();
  let result: CheckResult;
  try {
    result = await checkDomain(domain);
  } catch (e) {
    const msg = e instanceof VercelError ? e.message : "We could not reach our hosting just now. We'll try again shortly.";
    // A fault on our side or Vercel's is not the operator's problem: stay
    // pending (the runner retries) unless Vercel refused the domain outright.
    const hard = e instanceof VercelError && (e.code === "domain_in_use" || e.code === "invalid_domain");
    await db.from("tenants").update({
      custom_domain_status: hard ? "error" : tenant.custom_domain_status ?? "pending",
      custom_domain_detail: msg,
      custom_domain_checked_at: nowIso,
    }).eq("id", tenant.id);
    return { status: hard ? "error" : "pending", detail: msg, records: [] };
  }

  const requestedAt = tenant.custom_domain_requested_at ? new Date(tenant.custom_domain_requested_at).getTime() : Date.now();
  if (result.status === "pending" && Date.now() - requestedAt > GIVE_UP_AFTER_MS) {
    result = {
      ...result,
      status: "error",
      detail: "We still can't see your records after a week. Check them against the list below, then press Check again.",
    };
  }

  const wentLive = result.status === "active" && tenant.custom_domain_status !== "active";
  await db.from("tenants").update({
    custom_domain_status: result.status,
    custom_domain_detail: result.detail,
    custom_domain_records: result.records,
    custom_domain_checked_at: nowIso,
    ...(wentLive ? { custom_domain_live_at: nowIso } : {}),
  }).eq("id", tenant.id);

  // Only a domain we were waiting on gets the email — not one that was
  // already working before this tenant's first check.
  if (wentLive && tenant.custom_domain_status === "pending") await emailLive(db, tenant.id, domain).catch((e) => console.error("custom domain live email failed:", e));
  return result;
}

async function emailLive(db: any, tenantId: string, domain: string) {
  const to = await getTenantNotificationRecipient(db, tenantId);
  if (!to) return;
  const branding = await getTenantBranding(tenantId, db);
  const html = wrapWithBrandedTemplate(
    `<h2 style="margin:0 0 12px">${domain} is live</h2>
     <p>Customers can now book at <a href="https://${domain}">${domain}</a>, and your team signs in at
     <a href="https://portal.${domain}">portal.${domain}</a>.</p>
     <p>The secure certificate renews on its own, and your Drive247 addresses keep working too.</p>`,
    branding,
  );
  await sendResendEmail({
    to,
    subject: `${domain} is live`,
    html,
    tenantId,
    idempotencyKey: `custom-domain-live-${tenantId}-${domain}`,
  }, db);
}
