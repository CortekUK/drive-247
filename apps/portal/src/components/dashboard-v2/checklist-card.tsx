'use client';

/**
 * The setup checklist — the second card in the dashboard's "On your desk" band.
 *
 * WHY THIS CARD EXISTS, in the words of the person who asked for it:
 *
 *   "ye wali cheezon ka bada masla hai, kyunki meeting ke andar bhi ye cheez
 *    clients ko samjhaayi nahi jaati... poora tamasha karna padta hai. ek hi
 *    dafa ka kaam hai, ek dafa kar ke set kar ke rakh den."
 *
 * Auto-extension, installments, pay-as-you-go and Bonzah are the four features
 * that cannot be explained in passing on a call. None of them is needed for the
 * main booking flow — "lekin ye wo cheezein hain jisko usko baith ke ek martaba
 * dekhna padega, samajhna padega". Every new operator has been costing the same
 * live walkthrough. This card is that walkthrough, recorded once.
 *
 * It is roughly the old Welcome Pack, "tod tod ke" — broken into pieces. The
 * Welcome Pack itself is untouched and still serves the other 56 tenants at
 * /welcome; this is a much smaller surface beside it, not a replacement for it.
 *
 * ── EVERY ROW CARRIES A WAY IN ───────────────────────────────────────────────
 *
 *   "yahan par KOI NA KOI EK LINK LAAZIMI HOGA. wo link ya video ka hoga, ya us
 *    GUIDE ka hoga jisme detail mein humne guide likhi hogi SCREENSHOT KE
 *    SAATH."
 *
 * A row with neither is not a valid row. The database, the admin form and
 * `toItem()` in `use-setup-checklist.ts` all refuse one. This component checks
 * once more, because it is the one that actually hands a target to a player,
 * the reader or a new tab: a row with no video AND nothing to read is not
 * rendered, so there is never a control here that does nothing. Same empty-URL
 * contract as `lib/explainers.ts`: a missing video is a missing play button,
 * never a dead one.
 *
 * ── WHAT A ROW SHOWS ─────────────────────────────────────────────────────────
 *
 *   Auto-extension ······························ 1:30  (▶)  (📖)
 *
 * The title; then the video's length as m:ss, or h:mm:ss from an hour ("make
 * sure to add the video timing too"), immediately before the round play
 * button, so the cost of pressing play is read before it is paid; then a
 * separate round READ button. Which video plays is decided in
 * `resolveChecklistVideo()` in lib/setup-checklist.ts:
 *
 *   - a real `videoUrl` wins, with its own length when one is known;
 *   - otherwise the CANARY gets the shared, self-hosted sample clip, with that
 *     clip's own 1:30, and the dialog badges it "Sample" — so the finished
 *     shape of the card can be reviewed before anything has been recorded;
 *   - every other tenant gets no video: no play button, no time, and the row
 *     opens what there is to read.
 *
 * ── THE READ BUTTON NEVER OPENS SETTINGS ─────────────────────────────────────
 *
 * It used to be a settings-slider icon that routed to /settings?tab=…. The
 * team lead, on that: "we keep settings to settings; we don't educate about
 * features in settings" — many of the details about these features are not in
 * settings and won't be. So what it opens, in order:
 *
 *   1. the row's compiled guide (lib/setup-checklist-guides.ts, keyed by
 *      `item.key`), in a page-turning reader (./checklist-guide-reader.tsx);
 *   2. otherwise the row's EXTERNAL written guide, in a new tab
 *      (`externalGuideLink`);
 *   3. otherwise nothing — there is no read button, and an in-portal
 *      `guideUrl` (every seeded row's /settings link) is never shown.
 *
 * Nothing in this card routes inside the portal any more.
 *
 * ── LINKS ARE UNTRUSTED ──────────────────────────────────────────────────────
 *
 * `video_url` and `guide_url` are free text a super admin typed. Nothing here
 * puts one in an href, a `<video>`, an `<iframe>` or `window.open` without
 * `safeChecklistLink` (lib/safe-href.ts plus three refusals of its own) — a
 * `javascript:` link there runs in the operator's signed-in session. A link
 * that fails is treated exactly as if it were blank.
 *
 * ── ON THE VISUAL LANGUAGE ───────────────────────────────────────────────────
 *
 * The chrome comes from `Card` in `./home/ui`, which is what the sibling cards
 * in this band already use — so this cannot drift from them, and no new design
 * token is invented here. Everything inside is a `--pv-*` variable from the
 * same scoped palette (`.pv`, applied by dashboard-v2.tsx).
 *
 * Two traps this file deliberately avoids:
 *  - `font-sans` maps to Playfair Display (a SERIF) in this Tailwind config, so
 *    it is never used here.
 *  - CLAUDE.md's "Portal Design System" section is stale — wrong primary, wrong
 *    font, and it claims there are no shadows. Nothing here is taken from it.
 *
 * The video dialog, the reader and the tooltips are the exception, and they
 * have to be: a Radix dialog or tooltip portals to <body>, which is OUTSIDE the
 * `.pv` scope, so `--pv-*` resolves to nothing in there. They use semantic
 * theme tokens instead, exactly as `components/explainers/explainer.tsx` and
 * the announcement carousel's detail dialog do.
 *
 * TENANT ISOLATION: this component issues no query of its own. `useSetupChecklist`
 * reads a PLATFORM-WIDE table with no `tenant_id` column (V2_PLAN §5 — there is
 * no per-tenant filter to get wrong here) and is gated to the canary by slug.
 * The sample clip is gated the same way, by slug, below. The guides are
 * compiled into the bundle and read nothing.
 */

import { useRef, useState } from 'react';
import { BookOpen, BookOpenText, ExternalLink, Play } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui-v2/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui-v2/tooltip';
import { cn } from '@/lib/utils';
import { useTenant } from '@/contexts/TenantContext';
import { useSetupChecklist } from '@/hooks/use-setup-checklist';
import { isLeanTenant } from '@/lib/lean-areas';
import {
  externalGuideLink,
  formatChecklistDuration,
  isInPortalLink,
  readGuideText,
  resolveChecklistVideo,
  type ChecklistVideo,
  type SetupChecklistItem,
} from '@/lib/setup-checklist';
import { checklistGuideFor, type ChecklistGuide } from '@/lib/setup-checklist-guides';
import { ChecklistGuideReader } from './checklist-guide-reader';
import { Card } from './home/ui';

/* ── Targets, resolved once per row ────────────────────────────────────────
 *
 * Everything a row can open is worked out here, up front, and only these
 * resolved values are handed to the markup. That keeps "is this link safe?"
 * and "is there a guide?" out of the JSX, where a later edit could reach for
 * `item.guideUrl` directly and skip the check.
 */

/** What the row's read button opens. */
type ReadTarget =
  | { kind: 'reader'; guide: ChecklistGuide; label: string }
  | { kind: 'external'; url: string; label: string };

interface RowLinks {
  video: ChecklistVideo | null;
  read: ReadTarget | null;
}

function resolveRowLinks(item: SetupChecklistItem, allowSample: boolean): RowLinks {
  const video = resolveChecklistVideo(item, { allowSample });
  // One accessible name for both kinds — "Read the Auto-extension guide" —
  // because both are a guide to read; only where it opens differs.
  const label = readGuideText(item.title);
  const guide = checklistGuideFor(item.key);
  if (guide) return { video, read: { kind: 'reader', guide, label } };
  const url = externalGuideLink(item.guideUrl);
  if (url) return { video, read: { kind: 'external', url, label } };
  return { video, read: null };
}

/**
 * The read button's icon. The reader gets an open book with text on its pages
 * — it is the thing you read here. An external guide keeps the plain open
 * book it always had, so the two are told apart before the click.
 */
const READ_ICON = { reader: BookOpenText, external: BookOpen } as const;

/**
 * `m:ss` (`h:mm:ss` from an hour), or `null` when no time should be printed at
 * all. The same format the admin form writes the length back in — see
 * `formatChecklistDuration`.
 */
function lengthOf(video: ChecklistVideo | null): string | null {
  return video?.durationSeconds ? formatChecklistDuration(video.durationSeconds) : null;
}

function watchLabel(title: string, video: ChecklistVideo): string {
  const length = lengthOf(video);
  const base = video.isSample
    ? `Watch a sample walkthrough for ${title}`
    : `Watch the ${title} video`;
  return length ? `${base} (${length})` : base;
}

/* ── Playback ──────────────────────────────────────────────────────────────
 *
 * Lifted from `components/explainers/explainer.tsx` rather than imported: that
 * component's contract is an `ExplainerId` from the compiled manifest, and
 * these URLs come from a database row a super admin typed. Same rules, though —
 * a same-origin path or a video file plays inline, a known embed host is
 * iframed, and anything else gets an honest "open in a new tab", because most
 * hosts refuse to be framed and a blank iframe reads as a broken card.
 */

const isVideoFile = (url: string) => /\.(mp4|webm|ogg)(\?|$)/i.test(url);

const isEmbeddable = (url: string) =>
  isInPortalLink(url) ||
  isVideoFile(url) ||
  /youtube\.com|youtu\.be|vimeo\.com|loom\.com|player\./i.test(url);

interface PlayingRow {
  item: SetupChecklistItem;
  video: ChecklistVideo;
  read: ReadTarget | null;
}

function VideoDialog({
  playing,
  onClose,
  onRead,
  onCloseAutoFocus,
}: {
  playing: PlayingRow | null;
  onClose: () => void;
  onRead: (row: PlayingRow, read: ReadTarget) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const url = playing?.video.url ?? null;
  const length = lengthOf(playing?.video ?? null);
  const read = playing?.read ?? null;
  const ReadIcon = read ? READ_ICON[read.kind] : null;

  return (
    <Dialog open={!!playing} onOpenChange={(open) => !open && onClose()}>
      {/* `aria-describedby={undefined}` says, on purpose, that this dialog has
          no description — the title and the video are the whole of it. */}
      {/* `grid-cols-[minmax(0,1fr)]` IS LOAD-BEARING. DialogContent is a grid
          with one implicit `auto` column, and an auto column grows to its
          content's min-content width — so the header's non-shrinking pieces
          (length, Sample pill, guide link) widened the column past the 90vw
          dialog at phone width, and `overflow-hidden` then clipped the guide
          link under the close button and cropped the video. A `minmax(0,1fr)`
          column is held to the dialog's width and lets the title shrink. */}
      <DialogContent
        aria-describedby={undefined}
        onCloseAutoFocus={onCloseAutoFocus}
        className="w-[90vw] max-w-[820px] grid-cols-[minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:!max-w-[820px]"
      >
        {/* `pr-14` keeps the guide link clear of the dialog's own close
            button, which is absolutely positioned in this corner. */}
        <DialogHeader className="shrink-0 flex-row items-center gap-3 border-b pb-3 pl-5 pr-14 pt-4">
          <DialogTitle className="flex min-w-0 flex-1 items-center gap-2 text-base leading-snug">
            {/* Dark reads --v2-link: the dark theme's `--primary` is a deep
                shade that measures 1.78:1 on the dark dialog. */}
            <Play className="h-4 w-4 shrink-0 fill-current text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" />
            {/* Wraps below `sm` rather than truncating: a phone-width header
                carries the length and the Sample pill too, and "Bonzah ins…"
                hides the one word that says which video this is. */}
            <span className="min-w-0 break-words sm:truncate">{playing?.item.title}</span>
            {/* The same length the row printed, so the promise made before the
                click is the one kept after it. Nothing when it is unknown —
                never "0:00". */}
            {length && (
              <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">
                {length}
              </span>
            )}
            {/* Said out loud rather than left to be discovered, mirroring
                explainer.tsx: whoever is looking needs to know in one glance
                that the plumbing is finished and the content is not. */}
            {playing?.video.isSample && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Sample
              </span>
            )}
          </DialogTitle>
          {/* The way on from the video: after watching, the next thing an
              operator wants is the short written version to keep — never the
              settings screen. Closes the video and opens the reader (or the
              external guide). */}
          {/* Icon only below `sm`, where the words would squeeze the title;
              `aria-label` names it either way. --v2-link in dark for the
              same contrast reason as the Play icon above. */}
          {playing && read && ReadIcon && (
            <button
              type="button"
              onClick={() => onRead(playing, read)}
              aria-label={read.label}
              className="inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-full px-2 text-xs font-medium text-primary transition-colors hover:bg-primary/10 dark:text-[hsl(var(--v2-link,var(--primary)))] dark:hover:bg-[hsl(var(--v2-link,var(--primary))_/_0.1)] sm:h-auto sm:min-w-0 sm:px-2.5 sm:py-1"
            >
              <ReadIcon className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Read the guide</span>
            </button>
          )}
        </DialogHeader>
        <div className="aspect-video w-full bg-black">
          {/* NEVER AUTOPLAY. `autoPlay` is omitted entirely rather than paired
              with `muted` — the operator presses play. `url` has already been
              through `safeChecklistLink`. */}
          {url && isVideoFile(url) && (
            <video
              key={url}
              src={url}
              controls
              playsInline
              preload="metadata"
              className="h-full w-full bg-black object-contain"
            />
          )}
          {url && !isVideoFile(url) && isEmbeddable(url) && (
            <iframe
              src={url}
              title={playing?.item.title}
              className="h-full w-full border-0"
              allow="fullscreen"
            />
          )}
          {url && !isEmbeddable(url) && (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-muted px-6 text-center">
              <p className="text-sm text-muted-foreground">
                This walkthrough is hosted externally and can&apos;t be played here.
              </p>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <ExternalLink className="h-4 w-4" />
                Open the video in a new tab
              </a>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── The row ───────────────────────────────────────────────────────────────
 *
 * NO CHECKBOX, deliberately, despite the name. Ticking an item off is
 * per-tenant state, and there is no per-tenant state behind this card — the
 * table is platform-wide and has no `tenant_id` (see the SQL). A checkbox that
 * forgets what you did the moment you reload is worse than none, so the row is
 * what it actually is: a feature, why it is worth an hour, and the way in.
 */

function ChecklistRow({
  item,
  links,
  onPlay,
  onRead,
  playButtonRef,
  readButtonRef,
}: {
  item: SetupChecklistItem;
  links: RowLinks;
  onPlay: (row: PlayingRow) => void;
  onRead: (item: SetupChecklistItem, read: ReadTarget) => void;
  playButtonRef: (el: HTMLButtonElement | null) => void;
  readButtonRef: (el: HTMLButtonElement | null) => void;
}) {
  const { video, read } = links;
  const length = lengthOf(video);
  const ReadIcon = read ? READ_ICON[read.kind] : null;
  const titleClass =
    'min-w-0 flex-1 truncate text-[13.5px] font-medium leading-tight text-[var(--pv-ink)]';

  return (
    /* ONE LINE PER FEATURE. This row used to stack a title, a three-line
       description and a text button, which came to ~170px each — four of those
       overflowed the card and made the list feel like reading rather than
       picking. The description is deliberately NOT a native `title` either:
       the browser drew it as a long black box over the rows below (Sep 16
       2026). The read button's tooltip names the guide, and the guide is
       where the feature is explained.

       TWO SIBLING TARGETS, never one inside the other — a button inside a
       button is invalid HTML and browsers disagree about which one a click
       reaches. The left target is big (the title, plus the time and the play
       button when there is a video); the right one is the small round read
       button. The vertical padding lives on the targets rather than the row,
       so the whole height of the row is still clickable.

       `min-h-[3.25rem]` on the left target is the height of one WITH a video
       (the 28px play circle plus py-3). Without it a row with no video is
       ~41px beside 52px ones, and a list that mixes the two looks uneven. It
       sits on the target, not the row, because the row carries the list's
       1px divider and a border-box min-height would count that border too. */
    <div className="flex items-center gap-2 pr-6 transition-colors hover:bg-[var(--pv-accent-bg)]">
      {video ? (
        <button
          ref={playButtonRef}
          type="button"
          onClick={() => onPlay({ item, video, read })}
          aria-label={watchLabel(item.title, video)}
          className="group flex min-h-[3.25rem] min-w-0 flex-1 items-center gap-3 py-3 pl-6 text-left"
        >
          <span className={titleClass}>{item.title}</span>
          {/* The length sits immediately before the play button it describes.
              Muted and tabular so four of them read as one column. Omitted,
              not "0:00", when unknown. */}
          {length && (
            <span
              aria-hidden="true"
              className="shrink-0 text-[11px] tabular-nums text-[var(--pv-ink-3)]"
            >
              {length}
            </span>
          )}
          {/* Pre-baked palette tokens, never `bg-[var(--pv-accent)]/10`: under
              Tailwind 3.4 an opacity modifier on a `var()` compiles to NOTHING
              (see HOME_PALETTE in ./home/ui), which left this a bare triangle
              with no circle and no hover. */}
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--pv-accent-bg)] text-[var(--pv-accent)] transition-colors group-hover:bg-[var(--pv-accent-30)]"
          >
            <Play className="size-3 translate-x-[0.5px] fill-current" />
          </span>
        </button>
      ) : read ? (
        /* NO VIDEO: the title opens what there is to read — the reader, or the
           external guide — and there is no play button at all, no dimmed icon
           promising a video that does not exist. This is every tenant but the
           canary until a walkthrough is recorded: "jiski video nahi hogi, uski
           ek guide hum yahan rakh denge".

           This title target duplicates the read button beside it, so it is
           kept out of the tab order and the accessibility tree: keyboard and
           screen-reader users get ONE control per row (the read button, whose
           name includes the title), and a mouse can still click anywhere on
           the line. */
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => onRead(item, read)}
          className={cn(titleClass, 'min-h-[3.25rem] py-3 pl-6 text-left')}
        >
          {item.title}
        </button>
      ) : null}

      {read && ReadIcon ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              ref={readButtonRef}
              type="button"
              onClick={() => onRead(item, read)}
              aria-label={read.label}
              aria-haspopup={read.kind === 'reader' ? 'dialog' : undefined}
              data-read-kind={read.kind}
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--pv-line)] text-[var(--pv-ink-2)] transition-colors hover:bg-[var(--pv-accent-bg)] hover:text-[var(--pv-accent)]"
            >
              <ReadIcon className="size-3.5" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            {read.label}
          </TooltipContent>
        </Tooltip>
      ) : (
        /* A video with nothing to read. The empty slot holds the column, so
           this row's time and play button line up with the rows around it. */
        <span aria-hidden="true" className="size-7 shrink-0" />
      )}
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="animate-pulse divide-y divide-[var(--pv-line)]">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-2 px-6 py-4">
          <div className="h-3 w-2/5 rounded bg-[var(--pv-line)]" />
          <div className="h-2.5 w-4/5 rounded bg-[var(--pv-line)]" />
        </div>
      ))}
    </div>
  );
}

export function ChecklistCard({ className }: { className?: string }) {
  const { tenantSlug } = useTenant();
  const { items, isLoading } = useSetupChecklist();
  const [playing, setPlaying] = useState<PlayingRow | null>(null);
  const [reading, setReading] = useState<ChecklistGuide | null>(null);

  /**
   * FOCUS, when a dialog closes or hands over.
   *
   * Neither dialog is opened through a Radix `DialogTrigger` — both are driven
   * by state — and a modal Radix dialog, as it closes, focuses its trigger and
   * nothing else. With no trigger that is nothing at all, so focus fell to
   * <body> and a keyboard user was sent back to the top of the page. Each
   * dialog therefore puts focus back itself, on the row it came from:
   *
   *   - the video dialog, on that row's play button;
   *   - the reader, on that row's read button — the one keyboard target that
   *     names this guide — whether it was opened from that button, from the
   *     row's title (mouse only) or from the video dialog's "Read the guide".
   *
   * `handingOff` stops the video dialog putting focus back on the play button
   * as it closes, when the reader is the dialog now in front.
   */
  const playButtons = useRef(new Map<string, HTMLButtonElement>());
  const lastPlayKey = useRef<string | null>(null);
  const readButtons = useRef(new Map<string, HTMLButtonElement>());
  const lastReadKey = useRef<string | null>(null);
  const handingOff = useRef(false);

  /**
   * Put focus on a row's button in place of Radix's trigger-less default. When
   * the row has gone (the list changed while the dialog was open) Radix is left
   * to do what it would have done.
   */
  const refocus = (
    event: Event,
    buttons: Map<string, HTMLButtonElement>,
    key: string | null,
  ) => {
    const button = key ? buttons.get(key) : undefined;
    if (!button?.isConnected) return;
    event.preventDefault();
    button.focus();
  };

  // THE SAMPLE CLIP IS FOR THE CANARY ONLY, keyed on the slug exactly like
  // `ExplainerChip` and `useSetupChecklist`. Every other tenant keeps the
  // empty-URL contract: with no recorded video there is no play button.
  const allowSample = isLeanTenant(tenantSlug);

  // A row with nothing to play and nothing to read has nothing to offer, so it
  // is not shown — the hook already drops rows with no link; this holds for
  // any source, and for a row whose only link was an in-portal one.
  const rows = items
    .map((item) => ({ item, links: resolveRowLinks(item, allowSample) }))
    .filter(({ links }) => links.video || links.read);

  const openRead = (item: SetupChecklistItem, read: ReadTarget) => {
    if (read.kind === 'reader') {
      lastReadKey.current = item.key;
      setReading(read.guide);
      return;
    }
    // Checked again at the point of use: this is the one line that turns a
    // string into navigation. `externalGuideLink` runs `safeChecklistLink` and
    // refuses every in-portal path, so this only ever opens an http(s) page,
    // away from the portal, with `noopener` so the opened page cannot reach
    // back through `window.opener`.
    const safe = externalGuideLink(read.url);
    if (!safe) return;
    window.open(safe, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      {/* No count while the skeleton is up: `items` is already the compiled
          fallback at that point, so printing its length would state a number
          for a list that has not been read yet. */}
      <Card
        title="Sit down with these once"
        count={isLoading ? undefined : rows.length || undefined}
        tall
        // A CEILING, not just the `tall` floor. `tall` sets min-h-[352px]; the
        // band's grid is `items-stretch`, so a card with more content than that
        // grows and DRAGS ITS TWO NEIGHBOURS UP WITH IT — which is what happened
        // here: four features with descriptions come to roughly double 352px, so
        // the announcement poster and the reminders card stretched to match and
        // the whole band changed shape.
        //
        // Capping at the same 352px is also what makes the list SCROLL, which is
        // what was asked for — "wo beshak scrollable ho jaaye". The inner
        // `min-h-0 flex-1 overflow-y-auto` cannot scroll while its parent is free
        // to grow; a scroll container needs a bounded ancestor.
        className={cn('max-h-[352px]', className)}
      >
        {isLoading ? (
          <LoadingRows />
        ) : rows.length === 0 ? (
          /* Unreachable in practice — the hook falls back to the compiled list
             rather than returning nothing — but a card that renders an empty
             box on some future change is worse than one that says why. */
          <div className="flex flex-1 flex-col items-center justify-center gap-1 py-8 text-center">
            <p className="text-sm font-medium">Nothing set up yet</p>
            <p className="text-[11px] text-[var(--pv-ink-3)]">
              Guides for the trickier features will appear here.
            </p>
          </div>
        ) : (
          /* SCROLLABLE — "wo beshak scrollable ho jaaye". `min-h-0` is what
             makes it actually scroll: without it a flex child refuses to
             shrink below its content and the card grows instead, pushing the
             band's three cards out of line.

             The provider is local on purpose. The portal root has one, but
             this card should not depend on where it is mounted, and a short
             delay stops tooltips flickering on while the pointer travels down
             the list. */
          <TooltipProvider delayDuration={300}>
            <div className="no-scrollbar min-h-0 flex-1 divide-y divide-[var(--pv-line)] overflow-y-auto">
              {rows.map(({ item, links }) => (
                <ChecklistRow
                  key={item.key}
                  item={item}
                  links={links}
                  onPlay={(row) => {
                    lastPlayKey.current = row.item.key;
                    setPlaying(row);
                  }}
                  onRead={openRead}
                  playButtonRef={(el) => {
                    if (el) playButtons.current.set(item.key, el);
                    else playButtons.current.delete(item.key);
                  }}
                  readButtonRef={(el) => {
                    if (el) readButtons.current.set(item.key, el);
                    else readButtons.current.delete(item.key);
                  }}
                />
              ))}
            </div>
          </TooltipProvider>
        )}
      </Card>

      <VideoDialog
        playing={playing}
        onClose={() => setPlaying(null)}
        onRead={(row, read) => {
          handingOff.current = read.kind === 'reader';
          setPlaying(null);
          openRead(row.item, read);
        }}
        onCloseAutoFocus={(event) => {
          if (handingOff.current) {
            handingOff.current = false;
            event.preventDefault();
            return;
          }
          refocus(event, playButtons.current, lastPlayKey.current);
        }}
      />

      <ChecklistGuideReader
        guide={reading}
        onClose={() => setReading(null)}
        onCloseAutoFocus={(event) => refocus(event, readButtons.current, lastReadKey.current)}
      />
    </>
  );
}
