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
 * one — so this component can assume at least one link and never has to render
 * a control that does nothing. Same empty-URL contract as `lib/explainers.ts`:
 * a missing video is a missing chip, never a dead one.
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
 * The video dialog is the one exception, and it has to be: a Radix dialog
 * portals to <body>, which is OUTSIDE the `.pv` scope, so `--pv-*` resolves to
 * nothing in there. It uses semantic theme tokens instead, exactly as
 * `components/explainers/explainer.tsx` and the announcement carousel's detail
 * dialog do.
 *
 * TENANT ISOLATION: this component issues no query of its own. `useSetupChecklist`
 * reads a PLATFORM-WIDE table with no `tenant_id` column (V2_PLAN §5 — there is
 * no per-tenant filter to get wrong here) and is gated to the canary by slug.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, BookOpen, ExternalLink, Play } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui-v2/dialog';
import { cn } from '@/lib/utils';
import { useSetupChecklist } from '@/hooks/use-setup-checklist';
import {
  guideLinkLabel,
  isInPortalLink,
  type SetupChecklistItem,
} from '@/lib/setup-checklist';
import { Card } from './home/ui';

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

function VideoDialog({
  item,
  onClose,
}: {
  item: SetupChecklistItem | null;
  onClose: () => void;
}) {
  const url = item?.videoUrl ?? null;

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[90vw] max-w-[820px] gap-0 overflow-hidden p-0 sm:!max-w-[820px]">
        <DialogHeader className="shrink-0 border-b px-5 pb-3 pt-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Play className="h-4 w-4 fill-current text-primary" />
            {item?.title}
          </DialogTitle>
        </DialogHeader>
        <div className="aspect-video w-full bg-black">
          {/* NEVER AUTOPLAY. `autoPlay` is omitted entirely rather than paired
              with `muted` — the operator presses play. */}
          {url && isVideoFile(url) && (
            <video
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
              title={item?.title}
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

function ActionButton({
  icon,
  label,
  onClick,
  primary,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
        primary
          ? 'bg-[var(--pv-accent-bg)] text-[var(--pv-accent)] hover:brightness-95'
          : 'text-[var(--pv-ink-3)] hover:bg-[var(--pv-wash)] hover:text-[var(--pv-ink-2)]'
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function ChecklistRow({
  item,
  onPlay,
  onOpenGuide,
}: {
  item: SetupChecklistItem;
  onPlay: (item: SetupChecklistItem) => void;
  onOpenGuide: (url: string) => void;
}) {
  const hasVideo = !!item.videoUrl;

  return (
    /* ONE LINE PER FEATURE. This row used to stack a title, a three-line
       description and a text button, which came to ~170px each — four of those
       overflowed the card and made the list feel like reading rather than
       picking. The description is not lost: it rides as the row's `title`, so
       it is one hover (and one screen-reader label) away.

       The WHOLE ROW is the target rather than a small button in it — it is a
       list of four things to go and learn, so the thing you point at should be
       the thing you click. */
    <button
      type="button"
      onClick={() =>
        hasVideo ? onPlay(item) : item.guideUrl && onOpenGuide(item.guideUrl)
      }
      title={item.description ?? undefined}
      aria-label={
        hasVideo ? `Watch the ${item.title} video` : `Open the ${item.title} guide`
      }
      className="group flex w-full items-center gap-3 px-6 py-3 text-left transition-colors hover:bg-[var(--pv-wash)]"
    >
      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium leading-tight text-[var(--pv-ink)]">
        {item.title}
      </span>

      {/* The video icon is on EVERY row, because a video is the intended answer
          for all four of these — "har ek ke saath ek video ka link aa raha ho".
          None of them has been recorded yet (every seeded row is videoUrl:null),
          so rather than hide the affordance until the day someone uploads a file,
          the icon shows dimmed and the row opens that feature's written guide
          instead. That is the documented fallback — "jiski video nahi hogi, uski
          ek guide hum yahan rakh denge" — and it means the row's shape does not
          change on the day the video lands; only the icon lights up. */}
      <span
        aria-hidden="true"
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full transition-colors',
          hasVideo
            ? 'bg-[var(--pv-accent)]/10 text-[var(--pv-accent)] group-hover:bg-[var(--pv-accent)]/20'
            : 'bg-[var(--pv-line)] text-[var(--pv-ink-3)] group-hover:text-[var(--pv-ink-2)]'
        )}
      >
        <Play className="size-3 translate-x-[0.5px] fill-current" />
      </span>
    </button>
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
  const { items, isLoading } = useSetupChecklist();
  const [playing, setPlaying] = useState<SetupChecklistItem | null>(null);

  const openGuide = (url: string) => {
    // An in-portal path is routed rather than opened in a tab: the operator is
    // already signed in here, and a new tab would make them find their way
    // back. Anything else is external and opens away from the portal, with
    // `noopener` so the opened page cannot reach back through `window.opener`.
    if (isInPortalLink(url)) {
      router.push(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      {/* No count while the skeleton is up: `items` is already the compiled
          fallback at that point, so printing its length would state a number
          for a list that has not been read yet. */}
      <Card
        title="Sit down with these once"
        count={isLoading ? undefined : items.length || undefined}
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
        ) : items.length === 0 ? (
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
             band's three cards out of line. */
          <div className="no-scrollbar min-h-0 flex-1 divide-y divide-[var(--pv-line)] overflow-y-auto">
            {items.map((item) => (
              <ChecklistRow
                key={item.key}
                item={item}
                onPlay={setPlaying}
                onOpenGuide={openGuide}
              />
            ))}
          </div>
        )}
      </Card>

      <VideoDialog item={playing} onClose={() => setPlaying(null)} />
    </>
  );
}
