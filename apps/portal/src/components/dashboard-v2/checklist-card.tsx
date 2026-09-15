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
 * ── EVERY ROW CARRIES A LINK ─────────────────────────────────────────────────
 *
 *   "yahan par KOI NA KOI EK LINK LAAZIMI HOGA. wo link ya video ka hoga, ya us
 *    GUIDE ka hoga jisme detail mein humne guide likhi hogi SCREENSHOT KE
 *    SAATH."
 *
 * A row with neither is not a valid row. That is enforced three times over — a
 * CHECK constraint on `setup_checklist_items`, a refusal in the admin form, and
 * `toItem()` in `use-setup-checklist.ts` dropping any row that arrives without
 * one. This component checks once more, because it is the one that actually
 * hands the links to an href, a player and the router: a row whose links all
 * fail `safeChecklistLink` is not rendered, so there is never a control here
 * that does nothing. Same empty-URL contract as `lib/explainers.ts`: a missing
 * video is a missing play button, never a dead one.
 *
 * ── WHAT A ROW SHOWS ─────────────────────────────────────────────────────────
 *
 *   Auto-extension ······························ 1:30  (▶)  (⚙)
 *
 * The title; then the video's length as m:ss, or h:mm:ss from an hour ("make
 * sure to add the video timing too"), immediately before the round play
 * button, so the cost of pressing play is read before it is paid; then a
 * separate round button for the written guide or settings screen, whose icon
 * says where it goes — see `GUIDE_ICON`. Which video plays is decided in `resolveChecklistVideo()` in
 * lib/setup-checklist.ts:
 *
 *   - a real `videoUrl` wins, with its own length when one is known;
 *   - otherwise the CANARY gets the shared, self-hosted sample clip, with that
 *     clip's own 1:30, and the dialog badges it "Sample" — so the finished
 *     shape of the card can be reviewed before anything has been recorded;
 *   - every other tenant gets no video: no play button, no time, and the row
 *     opens the guide.
 *
 * ── LINKS ARE UNTRUSTED ──────────────────────────────────────────────────────
 *
 * `video_url` and `guide_url` are free text a super admin typed. Nothing here
 * puts one in an href, a `<video>`, an `<iframe>`, `router.push` or
 * `window.open` without `safeChecklistLink` (lib/safe-href.ts plus three
 * refusals of its own) — a `javascript:` link there runs in the operator's
 * signed-in session. A link that fails is treated exactly as if it were blank.
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
 * The video dialog and the tooltips are the exception, and they have to be: a
 * Radix dialog or tooltip portals to <body>, which is OUTSIDE the `.pv` scope,
 * so `--pv-*` resolves to nothing in there. They use semantic theme tokens
 * instead, exactly as `components/explainers/explainer.tsx` and the
 * announcement carousel's detail dialog do.
 *
 * TENANT ISOLATION: this component issues no query of its own. `useSetupChecklist`
 * reads a PLATFORM-WIDE table with no `tenant_id` column (V2_PLAN §5 — there is
 * no per-tenant filter to get wrong here) and is gated to the canary by slug.
 * The sample clip is gated the same way, by slug, below.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowUpRight,
  BookOpen,
  ExternalLink,
  Play,
  Settings2,
  type LucideIcon,
} from 'lucide-react';
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
  formatChecklistDuration,
  guideLinkKind,
  guideLinkText,
  isInPortalLink,
  resolveChecklistVideo,
  safeChecklistLink,
  type ChecklistVideo,
  type GuideLinkKind,
  type SetupChecklistItem,
} from '@/lib/setup-checklist';
import { Card } from './home/ui';

/* ── Links, resolved once per row ──────────────────────────────────────────
 *
 * Every link a row can use is worked out here, up front, and only these
 * resolved values are handed to the markup. That keeps "is this link safe?"
 * out of the JSX, where a later edit could reach for `item.guideUrl` directly
 * and skip the check.
 */

interface GuideLink {
  url: string;
  kind: GuideLinkKind;
  /** Accessible name and tooltip — "Open Auto-extension settings". */
  text: string;
}

interface RowLinks {
  video: ChecklistVideo | null;
  guide: GuideLink | null;
}

function resolveRowLinks(item: SetupChecklistItem, allowSample: boolean): RowLinks {
  const video = resolveChecklistVideo(item, { allowSample });
  const url = safeChecklistLink(item.guideUrl);
  const kind = guideLinkKind(url);
  const text = guideLinkText(item.title, url);
  return { video, guide: url && kind && text ? { url, kind, text } : null };
}

/**
 * The guide button's icon follows the destination, for the same reason
 * `guideLinkLabel` exists: every seeded row points at a settings screen,
 * because no written guide exists yet, and a book icon on a settings screen
 * would be a small lie told four times on the operator's first screen.
 */
const GUIDE_ICON: Record<GuideLinkKind, LucideIcon> = {
  guide: BookOpen,
  settings: Settings2,
  portal: ArrowUpRight,
};

/** The dialog header's shorter wording — the title is already beside it. */
const GUIDE_SHORT_LABEL: Record<GuideLinkKind, string> = {
  guide: 'Read the guide',
  settings: 'Open settings',
  portal: 'Open in the portal',
};

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
  guide: GuideLink | null;
}

function VideoDialog({
  playing,
  onClose,
  onOpenGuide,
}: {
  playing: PlayingRow | null;
  onClose: () => void;
  onOpenGuide: (url: string) => void;
}) {
  const url = playing?.video.url ?? null;
  const length = lengthOf(playing?.video ?? null);
  const guide = playing?.guide ?? null;
  const GuideIcon = guide ? GUIDE_ICON[guide.kind] : null;

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
        className="w-[90vw] max-w-[820px] grid-cols-[minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:!max-w-[820px]"
      >
        {/* `pr-14` keeps the guide link clear of the dialog's own close
            button, which is absolutely positioned in this corner. */}
        <DialogHeader className="shrink-0 flex-row items-center gap-3 border-b pb-3 pl-5 pr-14 pt-4">
          <DialogTitle className="flex min-w-0 flex-1 items-center gap-2 text-base leading-snug">
            {/* `dark:text-indigo-300`: the dark theme's `--primary` is a deep
                indigo that measures 1.78:1 on the dark dialog. */}
            <Play className="h-4 w-4 shrink-0 fill-current text-primary dark:text-indigo-300" />
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
              operator wants is the screen where the feature is set up. */}
          {/* Icon only below `sm`, where the words would squeeze the title;
              `aria-label` names it either way. `dark:text-indigo-300` for the
              same contrast reason as the Play icon above. */}
          {guide && GuideIcon && (
            <button
              type="button"
              onClick={() => onOpenGuide(guide.url)}
              aria-label={guide.text}
              className="inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-full px-2 text-xs font-medium text-primary transition-colors hover:bg-primary/10 dark:text-indigo-300 dark:hover:bg-indigo-300/10 sm:h-auto sm:min-w-0 sm:px-2.5 sm:py-1"
            >
              <GuideIcon className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{GUIDE_SHORT_LABEL[guide.kind]}</span>
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
  onOpenGuide,
}: {
  item: SetupChecklistItem;
  links: RowLinks;
  onPlay: (row: PlayingRow) => void;
  onOpenGuide: (url: string) => void;
}) {
  const { video, guide } = links;
  const length = lengthOf(video);
  const GuideIcon = guide ? GUIDE_ICON[guide.kind] : null;
  const titleClass =
    'min-w-0 flex-1 truncate text-[13.5px] font-medium leading-tight text-[var(--pv-ink)]';

  return (
    /* ONE LINE PER FEATURE. This row used to stack a title, a three-line
       description and a text button, which came to ~170px each — four of those
       overflowed the card and made the list feel like reading rather than
       picking. The description is not lost: it rides as the title target's
       `title`, so it is one hover away.

       TWO SIBLING TARGETS, never one inside the other — a button inside a
       button is invalid HTML and browsers disagree about which one a click
       reaches. The left target is big (the title, plus the time and the play
       button when there is a video); the right one is the small round guide
       button. The vertical padding lives on the targets rather than the row,
       so the whole height of the row is still clickable.

       `min-h-[3.25rem]` on the left target is the height of one WITH a video
       (the 28px play circle plus py-3). Without it a row with no video is
       ~41px beside 52px ones, and a list that mixes the two looks uneven. It
       sits on the target, not the row, because the row carries the list's
       1px divider and a border-box min-height would count that border too. */
    <div className="flex items-center gap-2 pr-6 transition-colors hover:bg-[var(--pv-wash)]">
      {video ? (
        <button
          type="button"
          onClick={() => onPlay({ item, video, guide })}
          title={item.description || undefined}
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
      ) : guide ? (
        /* NO VIDEO: the title opens the guide, and there is no play button at
           all — no dimmed icon promising a video that does not exist. This is
           every tenant but the canary until a walkthrough is recorded: "jiski
           video nahi hogi, uski ek guide hum yahan rakh denge".

           This title target duplicates the guide button beside it, so it is
           kept out of the tab order and the accessibility tree: keyboard and
           screen-reader users get ONE control per row (the guide button, whose
           name includes the title), and a mouse can still click anywhere on
           the line. */
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => onOpenGuide(guide.url)}
          title={item.description || undefined}
          className={cn(titleClass, 'min-h-[3.25rem] py-3 pl-6 text-left')}
        >
          {item.title}
        </button>
      ) : null}

      {guide && GuideIcon ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onOpenGuide(guide.url)}
              aria-label={guide.text}
              data-guide-kind={guide.kind}
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--pv-line)] text-[var(--pv-ink-2)] transition-colors hover:bg-[var(--pv-accent-bg)] hover:text-[var(--pv-accent)]"
            >
              <GuideIcon className="size-3.5" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            {guide.text}
          </TooltipContent>
        </Tooltip>
      ) : (
        /* A video with no usable guide. The empty slot holds the column, so
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
  const router = useRouter();
  const { tenantSlug } = useTenant();
  const { items, isLoading } = useSetupChecklist();
  const [playing, setPlaying] = useState<PlayingRow | null>(null);

  // THE SAMPLE CLIP IS FOR THE CANARY ONLY, keyed on the slug exactly like
  // `ExplainerChip` and the checklist reader. Every other tenant keeps the
  // empty-URL contract: with no recorded video there is no play button.
  const allowSample = isLeanTenant(tenantSlug);

  // A row whose links all failed the safety check has nothing to offer, so it
  // is not shown — the reader already drops these; this holds for any source.
  const rows = items
    .map((item) => ({ item, links: resolveRowLinks(item, allowSample) }))
    .filter(({ links }) => links.video || links.guide);

  const openGuide = (url: string) => {
    // Checked again at the point of use: this is the one function that turns
    // a string into navigation.
    const safe = safeChecklistLink(url);
    if (!safe) return;
    // An in-portal path is routed rather than opened in a tab: the operator is
    // already signed in here, and a new tab would make them find their way
    // back. Anything else is external and opens away from the portal, with
    // `noopener` so the opened page cannot reach back through `window.opener`.
    if (isInPortalLink(safe)) {
      router.push(safe);
      return;
    }
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
                  onPlay={setPlaying}
                  onOpenGuide={openGuide}
                />
              ))}
            </div>
          </TooltipProvider>
        )}
      </Card>

      <VideoDialog
        playing={playing}
        onClose={() => setPlaying(null)}
        onOpenGuide={(url) => {
          setPlaying(null);
          openGuide(url);
        }}
      />
    </>
  );
}
