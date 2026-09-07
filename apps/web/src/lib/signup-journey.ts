/**
 * Configuration and stand-ins for the DEVELOPMENT-ONLY signup journey hosted at
 * `/signup-preview`.
 *
 * WHAT THIS IS
 * ------------
 * The operator's first five minutes — pick a plan, create an account, confirm by
 * code, pay, land in the portal — rendered with the real pricing grid, the real
 * validation, the real tenant-identity field and the real Stripe card UI, but
 * wired to nothing. It exists so the journey can be walked end to end without a
 * Stripe customer, an auth user, a tenant row or a charge existing afterwards.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * Nothing in this module, or in anything under `components/signup-journey/`,
 * reaches a Supabase edge function or writes a row. In particular it never calls
 * `signup-begin`, `signup-begin-oauth`, `signup-slug-check`,
 * `signup-payment-intent` or `signup-provision`. Those all require an
 * authenticated user carrying signup metadata — which only exists once
 * `signup-begin` has minted a REAL `auth.users` row — so exercising any of them
 * would mean creating exactly the thing this route promises not to create. The
 * availability check, the confirmation code and the provisioning milestones are
 * therefore local, and the route is gated to `next dev` (see the page).
 *
 * The one genuinely live thing is the card form: it is Stripe's own Payment
 * Element, mounted against a **test-mode publishable key**, and the card typed
 * into it is tokenised by Stripe's test API. `journeyStripePublishableKey()`
 * below is the guard that makes a live key impossible.
 *
 * THE TENANT
 * ----------
 * The journey ends by handing the browser to **northwind**'s portal — the canary
 * workspace. Everything here keys on the SLUG, never on a tenant id: northwind
 * has a different id in production and on the staging branch, so an id-keyed
 * constant resolves to the wrong workspace with no error at all.
 */

import type { SlugCheckResult } from "@/components/onboarding/onboarding-types";
import { checkSlugShape, normalizeSlugClient } from "@/lib/signup-validation";

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * The workspace this journey represents creating, and the portal it hands off
 * to.
 *
 * A SLUG, never an id — see the file header. Anything that needs to know "which
 * tenant is this journey about" must compare against this string.
 */
export const JOURNEY_TENANT_SLUG = "northwind";

// ---------------------------------------------------------------------------
// The confirmation code
// ---------------------------------------------------------------------------

/**
 * The code the confirmation step accepts.
 *
 * It is NOT written anywhere on screen: the step reads as an ordinary
 * confirmation screen, and the only affordance is a neutral per-box
 * placeholder, which is what every four-box code input renders anyway.
 *
 * Four digits, not the six the real `signup-password-reset` flow uses, because
 * this is the number the journey was specified around.
 */
export const ACCEPTED_OTP_CODE = "0000";
export const OTP_LENGTH = ACCEPTED_OTP_CODE.length;

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

/**
 * A Stripe TEST publishable key that already ships in this repository
 * (`apps/booking/src/config/stripe.ts`). Publishable keys are public by design
 * and this one is test-mode, so it can safely be the default: the card step
 * renders a real card form on a machine with no Stripe environment configured at
 * all.
 */
const REPO_TEST_PUBLISHABLE_KEY =
  "pk_test_51OpazCHw4aNq4gdLwqocQbL63yx3IiQHUtQAUvR8oKI9zD2wLStLgx64lUOnmZ2y7TCgwayOM2rlr6K1oKman9Ht00Ecl9KJP9";

/**
 * The publishable key Elements is mounted with, or null if there is no usable
 * one.
 *
 * THE `pk_test_` PREFIX CHECK IS THE WHOLE SAFETY PROPERTY. Every candidate is
 * rejected unless it is explicitly test-mode, so no environment file, no `.env`
 * inherited from the monorepo root, and no future misconfiguration can put a
 * live key behind this form. A missing key is handled — the step falls back to
 * carrying on without a card — but a live key is never used.
 *
 * Order: the override intended for this route, then the booking app's public
 * test key if one is configured, then the repo default.
 */
export function journeyStripePublishableKey(): string | null {
  const candidates = [
    process.env.NEXT_PUBLIC_DEMO_SIGNUP_STRIPE_PK,
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    REPO_TEST_PUBLISHABLE_KEY,
  ];
  for (const candidate of candidates) {
    const key = candidate?.trim();
    if (key && key.startsWith("pk_test_")) return key;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Portal handoff
// ---------------------------------------------------------------------------

/**
 * Where the journey sends the browser at the end.
 *
 * The default is this worktree's portal dev port. The hard rule for this repo is
 * booking 4001 / portal 4002 / web 4003 / admin 4004 / bonzah 4005 — never
 * 3000-3005 — so 4002 is the portal and nothing else.
 */
export const PORTAL_FALLBACK_URL = "http://localhost:4002";

export function portalBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_DEMO_PORTAL_URL?.trim();
  if (!raw) return PORTAL_FALLBACK_URL;
  try {
    return new URL(raw).toString().replace(/\/$/, "");
  } catch {
    // A malformed override must not strand the last step.
    return PORTAL_FALLBACK_URL;
  }
}

/**
 * The URL the final button opens.
 *
 * The tenant travels as a SLUG in the query string. It is inert — the portal
 * resolves its tenant from the subdomain or from
 * `NEXT_PUBLIC_DEFAULT_TENANT_SLUG` in development — but it documents which
 * workspace this handoff is about, and if anything downstream ever wants to read
 * it, a slug is the only form that means the same thing in production and on
 * staging.
 */
export function portalHandoffUrl(slug: string = JOURNEY_TENANT_SLUG): string {
  const tenant = normalizeSlugClient(slug) || JOURNEY_TENANT_SLUG;
  const url = new URL(portalBaseUrl());

  // THE SLUG HAS TO BE IN THE HOSTNAME, not just the query string.
  //
  // The portal resolves its tenant from the subdomain — `proxy.ts` parses
  // `{tenant}.portal.localhost` and `{tenant}.portal.drive-247.com` and sets
  // `x-tenant-slug` from it. Landing on bare `localhost:4002` gives it nothing
  // to parse, so it fell through to the platform-domain path and the operator
  // got "We couldn't find a portal at this address / Tenant drive-247 not found
  // or inactive" at the end of a signup that had otherwise worked perfectly.
  //
  // So the host is rewritten to carry the tenant. `*.localhost` resolves to
  // 127.0.0.1 in every current browser, so this needs no /etc/hosts entry.
  //
  // An explicit `NEXT_PUBLIC_DEMO_PORTAL_URL` that ALREADY names a subdomain is
  // left exactly as given — if someone has pointed this at a real deployment
  // they have already said where it goes, and second-guessing them would be the
  // same class of bug as the one above.
  const host = url.hostname;
  const bare =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "portal.localhost" ||
    host === "portal.drive-247.com";
  if (bare) {
    url.hostname =
      host === "portal.drive-247.com"
        ? `${tenant}.portal.drive-247.com`
        : `${tenant}.portal.localhost`;
  }

  // Kept alongside the hostname: inert, but it documents which workspace the
  // handoff is about for anything downstream that wants to read it.
  url.searchParams.set("tenant", tenant);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/**
 * Addresses reported as taken, so the live availability check visibly does
 * something.
 *
 * These are real operator slugs from the platform, which is what makes the check
 * feel true — but nothing is looked up: this is a hardcoded set. The reserved
 * list (`www`, `admin`, `portal`, …) is NOT repeated here because
 * `checkSlugShape` already rejects it, with the same copy the real form uses.
 *
 * `northwind` is deliberately absent. It is the workspace this journey is about,
 * so it has to come back free.
 */
const TAKEN_SLUGS: ReadonlySet<string> = new Set([
  "revtek",
  "goniko",
  "jangram",
  "flowrentalsllc",
  "openbayrental",
  "drive-hustle",
  "globalmotiontransport",
  "eastpeakrentalsllc",
  "acme",
  "acme-rentals",
  "rentals",
  "cars",
  "hello",
]);

/** Alternatives offered under a taken address, mirroring the real endpoint. */
function slugSuggestions(slug: string): string[] {
  return [`${slug}-rentals`, `${slug}-cars`, `go-${slug}`]
    .map(normalizeSlugClient)
    .filter((s) => checkSlugShape(s).ok && !TAKEN_SLUGS.has(s))
    .slice(0, 3);
}

/**
 * Latency, so the "Checking availability…" state is actually visible.
 *
 * A check that resolves in the same frame renders as a tick appearing out of
 * nowhere, and the thing on show here is that the platform checks.
 */
const SLUG_LATENCY_MS = 420;

/**
 * Stand-in for `signup-slug-check`, with the same return shape so
 * `<TenantIdentityFields>` — the real component, unmodified — can be dropped
 * straight in.
 *
 * Never throws: the caller treats a rejection as "we could not check", which is
 * an honest state in the real flow but a confusing one to walk through.
 */
export async function checkSlugAvailability(
  raw: string,
): Promise<SlugCheckResult> {
  const verdict = checkSlugShape(raw);

  await new Promise((resolve) => setTimeout(resolve, SLUG_LATENCY_MS));

  if (!verdict.ok) {
    return {
      slug: verdict.slug,
      available: false,
      reason: verdict.problem === "reserved" ? "reserved" : "invalid",
      suggestions: [],
    };
  }

  if (TAKEN_SLUGS.has(verdict.slug)) {
    return {
      slug: verdict.slug,
      available: false,
      reason: "taken",
      suggestions: slugSuggestions(verdict.slug),
    };
  }

  return { slug: verdict.slug, available: true, reason: "ok", suggestions: [] };
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/**
 * The steps that happen INSIDE the dialog.
 *
 * Choosing a plan is not one of them. It happens on the pricing grid, in the
 * page behind the dialog, and it is what opens the dialog in the first place —
 * so counting it would put "Step 1 of 5" on a screen the operator has already
 * left, and every step they can actually see would be misnumbered.
 */
export type JourneyStep = "account" | "verify" | "payment" | "portal";

export const JOURNEY_STEPS: readonly { key: JourneyStep; label: string }[] = [
  { key: "account", label: "Account" },
  { key: "verify", label: "Confirm" },
  { key: "payment", label: "Payment" },
  { key: "portal", label: "Portal" },
] as const;

/** The step the dialog opens on. */
export const FIRST_JOURNEY_STEP: JourneyStep = "account";

export function journeyStepIndex(step: JourneyStep): number {
  return JOURNEY_STEPS.findIndex((s) => s.key === step);
}
