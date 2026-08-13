/**
 * The release catalogue.
 *
 * Shipping two to three changes a week into software people use for their job
 * only works if nobody is ever surprised. Overwhelm does not come from
 * *frequency* — it comes from a Tuesday workflow quietly behaving differently
 * with no explanation. So the rule is not "ship less", it is "never change an
 * existing workflow silently", and this file is what enforces it.
 *
 * Adding an entry here is part of shipping, not an afterthought. Write it for a
 * rental operator, not for us: what changed, and why they should care. If it
 * cannot be said in two sentences, it probably is not understood well enough to
 * ship.
 *
 * Deliberately a static catalogue rather than a table. Release notes are
 * authored with the code that ships them, they are identical for every tenant,
 * and keeping them here means no migration, no fetch, no loading state, and no
 * way for the copy to drift out of sync with the build it describes.
 */

export type ReleaseTier =
  /** Looks different, behaves identically. */
  | 'cosmetic'
  /** Something new. Nothing existing changed. */
  | 'new'
  /** An existing workflow behaves differently — the tier that earns a ticket. */
  | 'changed'
  | 'fixed';

export interface ReleaseItem {
  title: string;
  /** One or two plain sentences. No jargon, no internal names. */
  body: string;
  tier: ReleaseTier;
  /** Deep link to the screen this is about, so "show me" actually shows them. */
  href?: string;
}

export interface Release {
  /** Stable id. Never reuse or reorder — dismissal is keyed on it. */
  id: string;
  /** ISO date, used only for display ordering. */
  date: string;
  title: string;
  items: ReleaseItem[];
}

/**
 * Newest first. The top entry is the one the weekly modal offers.
 */
export const RELEASES: Release[] = [
  {
    id: '2026-08-13-appearance',
    date: '2026-08-13',
    title: 'Make the portal yours',
    items: [
      {
        title: 'Choose your own colours',
        body: "Settings → Appearance lets you set your brand colour and watch the whole portal change around you before you save. Your logo and colours stay yours — we never overwrite them.",
        tier: 'new',
        href: '/settings/appearance',
      },
      {
        title: 'Logo help built in',
        body: "We can now spot a logo that will disappear in dark mode, strip the white box off a JPG, or build you a simple logo from your business name if you don't have one yet.",
        tier: 'new',
        href: '/settings/appearance',
      },
      {
        title: 'A fresh look',
        body: 'The portal has a new coat of paint. Everything is exactly where you left it — only the styling has changed.',
        tier: 'cosmetic',
      },
      {
        title: 'Everything in one place, on the right',
        body: 'Messages, enquiries, notifications and Trax now live in a dock on the right edge of the screen instead of the bar across the top.',
        tier: 'changed',
      },
    ],
  },
];

/** The release the weekly modal should offer, if any. */
export function latestRelease(): Release | null {
  return RELEASES[0] ?? null;
}

export const TIER_LABEL: Record<ReleaseTier, string> = {
  cosmetic: 'Improved',
  new: 'New',
  changed: 'Changed',
  fixed: 'Fixed',
};

/**
 * Tier styling. `changed` is deliberately the loudest: it is the only tier that
 * means "your workflow is different today", and it is the one that generates
 * support tickets when it goes unnoticed.
 */
export const TIER_CLASS: Record<ReleaseTier, string> = {
  new: 'bg-primary/10 text-primary',
  changed: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  cosmetic: 'bg-muted text-muted-foreground',
  fixed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
};
