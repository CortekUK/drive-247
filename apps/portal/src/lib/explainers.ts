/**
 * Explainer video manifest — the ONE file to edit when a video is ready.
 *
 * Every video slot in the portal (setup-guide items, teaching empty states,
 * the guides shelf) reads from this map and nothing else. Producing a video is
 * therefore a two-field edit here — `url` and `durationSeconds` — with no
 * component change anywhere.
 *
 * THE EMPTY-URL CONTRACT IS LOAD-BEARING.
 * ---------------------------------------
 * `url: ''` means "not produced yet", and every consumer must render NOTHING
 * for it — no player, no disabled button, no "coming soon" placeholder, no
 * dead link. `getExplainer()` returns `null` for those entries and that is the
 * only supported way to read this map, so the failure mode is a missing chip
 * rather than a broken one. Half the entries below ship empty on day one; an
 * operator must never see a control that does nothing.
 *
 * That is deliberately STRICTER than the pattern in
 * `components/rentals-v2/booking-mode-selector.tsx`, which points every mode at
 * a Big Buck Bunny placeholder. That file's `videoUrl` fields should migrate to
 * ids from this map when its explainers are produced; it is left alone for now
 * because another surface owns it.
 *
 * DURATION IS SHOWN UP FRONT, always. Nobody clicks a video without knowing
 * what it costs them. Target is under 90 seconds — `durationSeconds` above 90
 * is a content smell, not a code error, so it is not enforced here.
 *
 * NEVER AUTOPLAY WITH SOUND. The shared player omits `autoPlay` entirely
 * rather than relying on `muted` — see `components/explainers/explainer.tsx`.
 *
 * WHERE THE FILES GO
 * ------------------
 * Drop the mp4 at `apps/portal/public/explainers/<name>.mp4` and set
 * `url: '/explainers/<name>.mp4'`. Same-origin paths and mp4/webm/ogg files
 * play inline in the dialog. A YouTube/Vimeo/Loom embed URL is iframed. Any
 * other external URL falls back to an "open in new tab" button, because most
 * hosts refuse to be framed.
 */

export interface ExplainerEntry {
  /** Shown as the dialog heading and the shelf row title. */
  title: string;
  /** One line of what the video covers. Shown in the guides shelf only. */
  blurb: string;
  /**
   * Runtime in seconds, rendered as `m:ss` next to every play control.
   * Must match the real file — it is a promise to the operator, not a hint.
   */
  durationSeconds: number;
  /**
   * `''` until the file exists. See the empty-URL contract above: an empty
   * string makes every slot for this id render nothing at all.
   */
  url: string;
}

/**
 * Ids are `<area>.<task>` and are referenced from setup-guide items and empty
 * states. Renaming one is a breaking change across both, so `ExplainerId` is
 * derived from these keys — a typo'd reference fails `tsc` instead of silently
 * rendering nothing (which is also what a missing video looks like, and is
 * exactly the confusion this typing prevents).
 */
export const EXPLAINERS = {
  // ---- Tell us about your business -------------------------------------
  'business.logo': {
    title: 'Add your logo',
    blurb: 'Where your logo appears across the booking site, emails and agreements.',
    durationSeconds: 0,
    url: '',
  },
  'business.details': {
    title: 'Your business details',
    blurb: 'The name, contact and address that go on every customer-facing document.',
    durationSeconds: 0,
    url: '',
  },
  'business.location': {
    title: 'Set up a pickup location',
    blurb: 'How pickup locations drive availability, delivery fees and the booking map.',
    durationSeconds: 0,
    url: '',
  },
  'business.site': {
    title: 'Publish your booking site',
    blurb: 'Taking your public booking pages live on your own subdomain.',
    durationSeconds: 0,
    url: '',
  },

  // ---- Build your fleet -------------------------------------------------
  'fleet.vehicle-add': {
    title: 'Add your first vehicle',
    blurb: 'Registration, make and model, and the fields that decide bookability.',
    durationSeconds: 0,
    url: '',
  },
  'fleet.vehicle-photos': {
    title: 'Photograph a vehicle well',
    blurb: 'The shots that convert, and where each one shows up in the booking flow.',
    durationSeconds: 0,
    url: '',
  },
  'fleet.vehicle-rates': {
    title: 'Set your rates',
    blurb: 'Daily, weekly and monthly tiers, and how weekend surcharges stack on top.',
    durationSeconds: 0,
    url: '',
  },

  // ---- Rentals ----------------------------------------------------------
  'rentals.first-rental': {
    title: 'Create your first rental',
    blurb: 'Customer, vehicle, dates and payment mode — start to finish.',
    durationSeconds: 0,
    url: '',
  },

  // ---- Customers --------------------------------------------------------
  'customers.add': {
    title: 'Add and verify a customer',
    blurb: 'What a customer record holds, and how licence checks attach to it.',
    durationSeconds: 0,
    url: '',
  },

  // ---- Agreements -------------------------------------------------------
  'agreements.first-agreement': {
    title: 'Send your first agreement',
    blurb: 'Generating a rental agreement and getting it e-signed before handover.',
    durationSeconds: 0,
    url: '',
  },
  'agreements.esign-brand': {
    title: 'Brand your e-sign emails',
    blurb: 'Putting your logo and colours on the signing experience.',
    durationSeconds: 0,
    url: '',
  },

  // ---- Insurance --------------------------------------------------------
  'insurance.bonzah': {
    title: 'Turn on Bonzah insurance',
    blurb: 'Selling per-rental cover at checkout, and how the balance is drawn down.',
    durationSeconds: 0,
    url: '',
  },

  // ---- Get paid ---------------------------------------------------------
  'payments.stripe-connect': {
    title: 'Connect your Stripe account',
    blurb: 'Onboarding Stripe so rental payments land in your own bank account.',
    durationSeconds: 0,
    url: '',
  },
  'payments.deposit': {
    title: 'Set your security deposit',
    blurb: 'How deposit holds are placed, refreshed and released.',
    durationSeconds: 0,
    url: '',
  },
  'payments.go-live': {
    title: 'Switch to live payments',
    blurb: 'Moving off test mode once your first test rental has gone through.',
    durationSeconds: 0,
    url: '',
  },
  'payments.overview': {
    title: 'How money moves through Drive247',
    blurb: 'Card charges, manual records, refunds and deposit holds in one ledger.',
    durationSeconds: 0,
    url: '',
  },
  'invoices.overview': {
    title: 'How invoices work',
    blurb: 'Where invoices come from, and how owed / paid / overdue are worked out.',
    durationSeconds: 0,
    url: '',
  },

  // ---- Verification & billing -------------------------------------------
  'verification.driver': {
    title: 'Turn on driver verification',
    blurb: 'Automatic licence and identity checks before a car is handed over.',
    durationSeconds: 0,
    url: '',
  },
  'billing.subscription': {
    title: 'Activate your subscription',
    blurb: 'What your plan covers and how billing works.',
    durationSeconds: 0,
    url: '',
  },
} satisfies Record<string, ExplainerEntry>;

export type ExplainerId = keyof typeof EXPLAINERS;

/** An entry that actually has a file behind it. */
export interface ReadyExplainer extends ExplainerEntry {
  id: ExplainerId;
  url: string;
}

/**
 * The ONLY supported read of the manifest.
 *
 * Returns `null` for an unproduced video, so `if (!e) return null` in a
 * component is the whole of the not-ready handling. Also returns `null` for an
 * unknown id, which keeps a stale reference from ever throwing at runtime.
 *
 * A missing `durationSeconds` disqualifies an entry just as a missing `url`
 * does. Showing the runtime up front is a rule the product committed to, and
 * the only way to break it from this file is to fill in a URL and forget the
 * duration — so that combination is treated as not-ready rather than rendered
 * as a confident "0:00".
 */
export function getExplainer(id: ExplainerId | null | undefined): ReadyExplainer | null {
  if (!id) return null;
  const entry = (EXPLAINERS as Record<string, ExplainerEntry>)[id];
  if (!entry) return null;
  if (!entry.url) return null;
  if (!(entry.durationSeconds > 0)) return null;
  return { ...entry, id };
}

/** Every produced video, in manifest order. Empty until the first file lands. */
export function listReadyExplainers(): ReadyExplainer[] {
  return (Object.keys(EXPLAINERS) as ExplainerId[])
    .map((id) => getExplainer(id))
    .filter((e): e is ReadyExplainer => e !== null);
}

/**
 * `m:ss`. Seconds are always two digits so the numbers stay comparable in a
 * list. A duration of 0 or less is not renderable — callers should treat it
 * the same as a missing video rather than printing "0:00".
 */
export function formatExplainerDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
