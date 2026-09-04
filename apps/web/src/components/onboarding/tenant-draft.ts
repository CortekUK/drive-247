"use client";

/**
 * Where the operator's tenant details live between the account step and
 * provisioning.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The business name, the web address and the terms tick used to be collected
 * AFTER payment, on a step of their own, and were sent to `signup-provision` in
 * the same breath. They are now collected BEFORE payment — which opens a gap
 * they have to survive: the operator fills the account form, is redirected to
 * Stripe's card flow (or to Google, or simply closes the tab), and comes back
 * needing those three values to still exist.
 *
 * The server cannot hold them. `signup-begin` takes a name, an email, a password
 * and a plan id, and nothing else; the only place that writes a business
 * snapshot into `app_metadata` is `signup-provision`, which is the very call
 * these values are needed FOR. Changing `signup-begin` to accept them would mean
 * redeploying a function that is live on production and serving real signups, so
 * this is solved entirely on the client instead.
 *
 * TWO STORES, ON PURPOSE
 * ----------------------
 * 1. `localStorage` — survives a refresh, a tab close and the Stripe/Google
 *    redirect. Same browser only.
 * 2. The user's own `user_metadata` — survives a device switch. Written with
 *    `auth.updateUser`, which needs no server change because GoTrue lets a
 *    signed-in user write their own `user_metadata`.
 *
 * That second store is EXACTLY as trustworthy as the first: `user_metadata` is
 * user-writable, so a determined caller can put anything in it. That is fine,
 * and is why this is not `app_metadata`. Nothing here is a security decision —
 * it is a draft of three values the operator typed themselves, and
 * `signup-provision` re-validates all three (name length, slug shape, reserved
 * list, availability, terms) before it will mint anything.
 */

import { getBrowserSupabase } from "@/lib/supabase/browser";
import { isSignupPlanId, type SignupPlanId } from "@/lib/plans";

import type { BusinessDraft, TenantFormValues } from "./onboarding-types";

/** Bumped if the stored shape ever changes; a foreign version is ignored, not half-read. */
const DRAFT_VERSION = 1;

/** Namespaced to match the auth client's own `d247-web-auth` storage key. */
const DRAFT_KEY = "d247-signup-tenant-draft";
const OAUTH_KEY = "d247-signup-oauth-pending";

/** The key inside `user_metadata`. Never `app_metadata` — see the file header. */
export const TENANT_DRAFT_META_KEY = "d247_tenant_draft";

interface StoredDraft {
  v: number;
  companyName: string;
  slug: string;
  acceptedTerms: boolean;
}

/**
 * What has to cross the Google redirect: the tenant details AND the plan.
 *
 * The plan matters because the operator comes back to a fresh page load with no
 * React state at all — without it we would know they had signed in but not what
 * they had chosen to buy, and would have to send them back to the pricing grid.
 */
interface StoredOauthPending extends StoredDraft {
  planId: SignupPlanId;
  /** ms epoch. Anything older than OAUTH_PENDING_TTL_MS is treated as absent. */
  at: number;
}

/**
 * How long a pending Google handoff stays valid.
 *
 * Long enough for a slow OAuth consent screen and a password prompt; short
 * enough that a blob abandoned days ago cannot silently seed a later, unrelated
 * signup with someone's stale business name.
 */
const OAUTH_PENDING_TTL_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Shape guards
// ---------------------------------------------------------------------------

/**
 * `unknown` in, a usable draft or null out.
 *
 * Both stores can hand back anything — hand-edited `localStorage`, a
 * `user_metadata` blob written by an older bundle — so nothing is trusted by
 * shape. A partial read is worse than no read: it would put a half-empty
 * business name in front of someone who has already paid.
 */
function toDraft(raw: unknown): TenantFormValues | null {
  if (!raw || typeof raw !== "object") return null;
  const blob = raw as Partial<StoredDraft>;
  if (blob.v !== DRAFT_VERSION) return null;
  if (typeof blob.companyName !== "string" || blob.companyName.trim().length < 2) return null;
  if (typeof blob.slug !== "string" || !blob.slug) return null;
  return {
    companyName: blob.companyName,
    slug: blob.slug,
    // Only ever `true` when it was literally stored as `true`. A draft that
    // cannot prove the box was ticked is a draft that has to ask again.
    acceptedTerms: blob.acceptedTerms === true,
  };
}

/**
 * Every read and write is wrapped: `localStorage` throws outright in Safari's
 * private mode and in any browser configured to block site data, and a signup
 * must not die because a convenience store is unavailable.
 */
function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Best effort. The `user_metadata` copy is the one that has to survive. */
  }
}

function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// The local (same-browser) draft
// ---------------------------------------------------------------------------

export function readLocalTenantDraft(): TenantFormValues | null {
  return toDraft(readJson(DRAFT_KEY));
}

export function writeLocalTenantDraft(values: TenantFormValues): void {
  writeJson(DRAFT_KEY, { v: DRAFT_VERSION, ...values } satisfies StoredDraft);
}

export function clearLocalTenantDraft(): void {
  removeKey(DRAFT_KEY);
}

// ---------------------------------------------------------------------------
// The remote (cross-device) draft
// ---------------------------------------------------------------------------

/**
 * Mirror the draft into the signed-in user's own `user_metadata`.
 *
 * Deliberately fire-and-forget from the caller's point of view: it resolves to
 * `true`/`false` rather than throwing, because failing to save a convenience
 * copy must never fail the step that just created the account. The local copy
 * covers the common case on its own.
 */
export async function writeRemoteTenantDraft(values: TenantFormValues): Promise<boolean> {
  try {
    const { error } = await getBrowserSupabase().auth.updateUser({
      data: { [TENANT_DRAFT_META_KEY]: { v: DRAFT_VERSION, ...values } },
    });
    if (error) {
      console.warn("[onboarding] could not save tenant draft to user_metadata", error);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[onboarding] could not save tenant draft to user_metadata", e);
    return false;
  }
}

/** Read the draft back off a GoTrue user object. */
export function readTenantDraftFromUser(
  user: { user_metadata?: Record<string, unknown> | null } | null | undefined,
): TenantFormValues | null {
  return toDraft(user?.user_metadata?.[TENANT_DRAFT_META_KEY]);
}

/**
 * The draft, from wherever it can be found.
 *
 * Local first: it is synchronous, it is always the most recently written copy,
 * and it costs no round trip. The `user_metadata` copy is the fallback that
 * makes a device switch survivable.
 */
export async function resolveTenantDraft(): Promise<TenantFormValues | null> {
  const local = readLocalTenantDraft();
  if (local) return local;
  try {
    const { data, error } = await getBrowserSupabase().auth.getUser();
    if (error || !data.user) return null;
    return readTenantDraftFromUser(data.user);
  } catch {
    return null;
  }
}

/**
 * Save to both stores. Returns once the local write is done — the remote write
 * is awaited too, because the one moment it matters (a device switch mid-flow)
 * is precisely the moment we cannot come back and retry it.
 */
export async function saveTenantDraft(values: TenantFormValues): Promise<void> {
  writeLocalTenantDraft(values);
  await writeRemoteTenantDraft(values);
}

/**
 * Drop the local copy once the tenant exists.
 *
 * The `user_metadata` copy is left alone on purpose: clearing it costs a GoTrue
 * round trip on the success screen, it is three values the operator typed about
 * their own business, and `signup-provision` is idempotent — a stale draft can
 * only ever re-describe the tenant it already built.
 */
export function clearTenantDraft(): void {
  clearLocalTenantDraft();
}

// ---------------------------------------------------------------------------
// The Google handoff
// ---------------------------------------------------------------------------

export function writePendingOauth(planId: SignupPlanId, values: TenantFormValues): void {
  writeJson(OAUTH_KEY, {
    v: DRAFT_VERSION,
    planId,
    at: Date.now(),
    ...values,
  } satisfies StoredOauthPending);
}

/** The pending handoff, or null when there is none, it is stale, or it is malformed. */
export function readPendingOauth():
  | { planId: SignupPlanId; values: TenantFormValues }
  | null {
  const raw = readJson(OAUTH_KEY);
  const values = toDraft(raw);
  if (!values) return null;
  const blob = raw as Partial<StoredOauthPending>;
  if (!isSignupPlanId(blob.planId)) return null;
  if (typeof blob.at !== "number" || Date.now() - blob.at > OAUTH_PENDING_TTL_MS) return null;
  return { planId: blob.planId, values };
}

export function clearPendingOauth(): void {
  removeKey(OAUTH_KEY);
}

// ---------------------------------------------------------------------------
// Draft <-> state
// ---------------------------------------------------------------------------

/**
 * Fold a recovered draft onto the reducer's draft shape.
 *
 * `slugTouched` is set to true unconditionally: the operator chose this address
 * once already, and leaving it false would let the account step re-derive it
 * from the business name the next time that field changed — silently replacing a
 * deliberate choice with a generated one.
 */
export function draftToBusiness(values: TenantFormValues): BusinessDraft {
  return {
    companyName: values.companyName,
    slug: values.slug,
    slugTouched: true,
    acceptedTerms: values.acceptedTerms,
  };
}
