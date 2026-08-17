/**
 * banner-types — the shared contract for every top-of-app banner.
 *
 * WHY THIS EXISTS
 * The portal grew seven bespoke banners (platform-status, bonzah-pending,
 * go-live, maintenance, accounting-connection-expired, low-credits,
 * bonzah-status). Three of them rolled their own `localStorage` dismissal with
 * three different key shapes; the other four cannot be dismissed at all, and
 * `accounting-connection-expired-banner.tsx` imports `X` from lucide without
 * ever rendering it — a half-finished dismiss affordance frozen mid-thought.
 * Nothing coordinates them, so N live conditions means N stacked bars.
 *
 * This module is the vocabulary the stack speaks. It is deliberately generic:
 * it knows about SEVERITY, ORDER and DISMISSAL, and nothing about deposits,
 * Xero, credits or Bonzah. A source hook produces `AppBanner[]`; the stack
 * renders them. That seam is what lets the seven existing banners move in one
 * at a time rather than in a single risky rewrite.
 *
 * Nothing here imports React state, Supabase or the tenant — it is pure data
 * plus three pure functions, so it is trivially unit-testable.
 */

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/* -------------------------------------------------------------------------- */
/* Severity                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Four bands, and the boundary that matters is critical/warning.
 *
 * `critical` means money is exposed RIGHT NOW and a human has to do something.
 * It is the only band the stack refuses to collapse, so promoting something
 * into it is expensive: every extra critical is 44px stolen from the page the
 * operator actually opened. Anything that resolves itself — a retry already
 * scheduled, a hold mid-flight — is `warning` at most.
 */
export type BannerSeverity = "critical" | "warning" | "info" | "success";

/** Sort order. Lower renders first. */
export const SEVERITY_RANK: Record<BannerSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  success: 3,
};

/**
 * How long a dismissal silences a banner that is STILL TRUE.
 *
 * This map is the anti-GMT rule expressed as data. The incident that prompted
 * this work was four cars out with no deposit held and the only signal being an
 * in-app notification nobody opened — i.e. a warning that was, in effect,
 * permanently dismissed by default. So: a critical may be silenced for a shift
 * and comes back tomorrow. It may never be silenced for good.
 *
 * `success` is Infinity because "You're Live!" is a celebration, not a task —
 * once acknowledged it should stay gone.
 */
export const DEFAULT_DISMISS_TTL_MS: Record<BannerSeverity, number> = {
  critical: 24 * 60 * 60 * 1000, // 24h — it comes back
  warning: 7 * 24 * 60 * 60 * 1000,
  info: 30 * 24 * 60 * 60 * 1000,
  success: Number.POSITIVE_INFINITY,
};

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Either a link or a click handler, never both — the union stops a source
 * silently supplying an `onClick` that an `<a>` will never call.
 *
 * `external` renders a real `<a target="_blank">` instead of a `next/link`,
 * because some fixes genuinely live outside the portal (a chargeback can only
 * be answered in Stripe). Without it a source would be forced to smuggle an
 * absolute URL through the router.
 */
export type BannerAction =
  | {
      label: string;
      href: string;
      external?: boolean;
      onClick?: never;
      busy?: never;
    }
  | {
      label: string;
      onClick: () => void;
      busy?: boolean;
      href?: never;
      external?: never;
    };

/* -------------------------------------------------------------------------- */
/* Dismissal                                                                   */
/* -------------------------------------------------------------------------- */

export interface BannerDismissal {
  /**
   * Identifies the OCCURRENCE, not the condition. When it changes, the banner
   * comes back even if it was dismissed a minute ago — because "4 rentals are
   * unsecured" and "5 rentals are unsecured" are different facts.
   *
   * Build it with `fingerprint()` and read the warnings on that function: the
   * single most damaging mistake available here is feeding it something that
   * churns on a cron tick, which makes the banner reappear every few minutes
   * until the operator mutes the feature at the browser level.
   */
  fingerprint: string;

  /** Overrides `DEFAULT_DISMISS_TTL_MS[severity]`. */
  ttlMs?: number;

  /**
   * Accessible name for the dismiss control, and its visible text at `sm+`.
   * Defaults to `Dismiss: {plainTitle}`.
   *
   * Critical banners should pass something honest about what dismissing does —
   * "Snooze 24h" — so nobody believes a single click made the problem go away.
   */
  label?: string;

  /** Native `title` tooltip, e.g. "This comes back tomorrow if it is still unresolved." */
  tooltip?: string;
}

/* -------------------------------------------------------------------------- */
/* The banner                                                                  */
/* -------------------------------------------------------------------------- */

export interface AppBanner {
  /**
   * Stable machine id for the CONDITION, never the occurrence.
   * `"deposit-hold.declined"` — never `"deposit-hold.declined.<rentalId>"`.
   *
   * This is half the dismissal storage key, so churn here silently orphans
   * every dismissal the operator has ever made.
   */
  id: string;

  severity: BannerSeverity;

  /** Bold lead sentence: what is TRUE. May be JSX. */
  title: ReactNode;

  /**
   * Plain-text mirror of `title`. Required — not optional — because `title` may
   * be JSX and both the live region and the dismiss button's accessible name
   * need a real string. Making it optional would let a source ship a banner
   * that is invisible to a screen reader.
   */
  plainTitle: string;

  /** Second sentence: the consequence, then who has to act. */
  description?: ReactNode;

  /** Defaults to the severity icon. */
  icon?: LucideIcon;

  /** Right-aligned primary CTA. */
  action?: BannerAction;

  /** Rendered to the left of `action`, low emphasis. */
  secondaryAction?: BannerAction;

  /**
   * Omit entirely => NOT dismissible. That is the correct default for anything
   * an admin pushed at the tenant (maintenance notices) — a banner the operator
   * cannot silence is sometimes exactly the point.
   */
  dismissal?: BannerDismissal;

  /** Which mount point renders it. Default "app". */
  scope?: "app" | "dashboard";

  /**
   * Hide while the operator is already on the page that fixes it.
   * The Xero banner does this with an inline `pathname?.startsWith("/settings")`
   * today; this hoists that idiom so every banner gets it for free.
   */
  hideOnPathPrefix?: string[];

  /**
   * Manager-permission tab key. Filtered by the registry (`useAppBanners`), not
   * here — the stack is presentational and must not reach for auth context.
   * A manager without the tab would only be told about work they cannot open.
   */
  requiresTab?: string;

  /** Tie-break WITHIN a severity band; higher first. Default 0. */
  weight?: number;

  /**
   * Escape hatch: render a bespoke body instead of title/description/action.
   *
   * This is the migration lever. The visually distinct legacy banners (go-live's
   * celebration gradient, bonzah-pending's three buttons and live retry
   * progress) join the stack on day one without being rewritten — the stack
   * still owns placement, ordering, collapse and dismissal, and only the body
   * is theirs. Drop `render` per component later as the bodies converge.
   */
  render?: (banner: AppBanner) => ReactNode;
}

/* -------------------------------------------------------------------------- */
/* Ordering                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Severity, then weight, then id.
 *
 * The `id` tie-break is not cosmetic: without a total order, `Array.prototype
 * .sort` is free to permute equal elements between renders, so the stack would
 * visibly reshuffle on every React Query refetch — including the 5-minute poll.
 * Ids are stable, so this is stable.
 */
export const compareBanners = (a: AppBanner, b: AppBanner): number =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
  (b.weight ?? 0) - (a.weight ?? 0) ||
  a.id.localeCompare(b.id);

/* -------------------------------------------------------------------------- */
/* Fingerprints                                                                */
/* -------------------------------------------------------------------------- */

/**
 * djb2 over the joined parts. Short, stable, collision-tolerant (a collision
 * costs one un-shown banner until the next change, not a correctness bug).
 *
 * WHAT TO FEED IT — the rules that decide whether dismissal works at all:
 *
 *   GOOD  fingerprint(...rows.map(r => `${r.id}:${r.status}`).sort())
 *           sorted, so PostgREST row order cannot flip it; a row joining,
 *           leaving, or changing state is a genuinely new occurrence.
 *   GOOD  fingerprint("expiring", earliestExpiry.slice(0, 10))
 *           bucketed to the day, so it re-shows once a day rather than on
 *           every 5-minute poll.
 *   GOOD  fingerprint("low", Math.floor(balance / 5))
 *           re-shows when it gets MEANINGFULLY worse.
 *
 *   NEVER a raw timestamp, a free-text provider error string, a retry counter,
 *         or a next-retry time. Every one of those moves on a cron tick; the
 *         banner then reappears every few minutes and the operator mutes the
 *         whole feature — strictly worse than the banner never existing.
 *
 * `null`/`undefined` collapse to "~" and parts are joined with NUL so
 * ("a", "b") and ("ab") cannot collide.
 */
export const fingerprint = (
  ...parts: (string | number | null | undefined)[]
): string => {
  const s = parts.map((p) => p ?? "~").join("\u0000");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/** Resolved TTL for a banner, honouring the per-banner override. */
export const resolveTtlMs = (banner: AppBanner): number =>
  banner.dismissal?.ttlMs ?? DEFAULT_DISMISS_TTL_MS[banner.severity];
