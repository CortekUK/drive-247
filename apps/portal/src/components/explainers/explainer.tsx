"use client";

/**
 * The single video slot used everywhere in the portal.
 *
 * One component, one contract: give it an `ExplainerId` and it either renders a
 * play control that opens the video, or renders NOTHING. There is no third
 * state — no disabled button, no "coming soon", no dead link — because on day
 * one most ids in the manifest have no file behind them and a control that
 * does nothing is worse than no control. `getExplainer()` enforces that; see
 * the empty-URL contract in `lib/explainers.ts`.
 *
 * Two hard product rules live here:
 *   1. NEVER AUTOPLAY WITH SOUND. `<video>` is rendered without `autoPlay`
 *      at all rather than with `muted` — muted-autoplay is still a video
 *      starting under someone's cursor, and the moment a later edit drops the
 *      `muted` attribute it becomes the thing we promised not to do. The
 *      operator presses play.
 *   2. DURATION UP FRONT. Every control prints `m:ss`, and an entry without a
 *      duration is treated as not-ready, so there is no path to a play button
 *      whose length is unknown.
 *
 * Playback follows the pattern already established by
 * `components/rentals-v2/booking-mode-selector.tsx`: local/same-origin files
 * and mp4/webm/ogg play inline, known embed hosts are iframed, and anything
 * else gets an explicit "open in new tab" because most hosts refuse framing.
 */

import { useState } from "react";
import { ExternalLink, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-v2/dialog";
import {
  formatExplainerDuration,
  getExplainer,
  listReadyExplainers,
  type ExplainerId,
  type ReadyExplainer,
} from "@/lib/explainers";

const isVideoFile = (url: string) => /\.(mp4|webm|ogg)(\?|$)/i.test(url);
const isEmbeddable = (url: string) =>
  url.startsWith("/") ||
  isVideoFile(url) ||
  /youtube\.com|youtu\.be|vimeo\.com|loom\.com|player\./i.test(url);

/** The player surface. Exported so the shelf can reuse it in its own dialog. */
function ExplainerPlayer({ explainer }: { explainer: ReadyExplainer }) {
  if (isVideoFile(explainer.url)) {
    return (
      <video
        src={explainer.url}
        controls
        playsInline
        preload="metadata"
        className="h-full w-full bg-black object-contain"
      />
    );
  }

  if (isEmbeddable(explainer.url)) {
    return (
      <iframe
        src={explainer.url}
        title={explainer.title}
        className="h-full w-full border-0"
        allow="fullscreen"
      />
    );
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-muted px-6 text-center">
      <p className="text-sm text-muted-foreground">
        This explainer is hosted externally and can&apos;t be embedded here.
      </p>
      <a
        href={explainer.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <ExternalLink className="h-4 w-4" />
        Open video in new tab
      </a>
    </div>
  );
}

function ExplainerDialog({
  explainer,
  onClose,
}: {
  explainer: ReadyExplainer | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!explainer} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[90vw] max-w-[820px] gap-0 overflow-hidden p-0 sm:!max-w-[820px]">
        <DialogHeader className="shrink-0 border-b px-5 pb-3 pt-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Play className="h-4 w-4 fill-current text-primary" />
            {explainer?.title}
            {explainer && (
              <span className="text-xs font-normal tabular-nums text-muted-foreground">
                {formatExplainerDuration(explainer.durationSeconds)}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="aspect-video w-full bg-black">
          {explainer && <ExplainerPlayer explainer={explainer} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export type ExplainerChipVariant =
  /** Filled pill. For empty states, where the video is a real second action. */
  | "chip"
  /** Text-only, sits inline on a dense row. For setup-guide checklist items. */
  | "link";

export interface ExplainerChipProps {
  id: ExplainerId;
  variant?: ExplainerChipVariant;
  /** Defaults to "Watch". Empty states use "Watch how". */
  label?: string;
  className?: string;
}

/**
 * `Watch (1:12)` — the slot. Renders `null` when the video does not exist yet,
 * which is the expected state for most ids today.
 *
 * `stopPropagation` on the click is not optional: every current host (a
 * checklist row, an empty-state action bar) is itself clickable, and without
 * it opening the video would also navigate away underneath the dialog.
 */
export function ExplainerChip({
  id,
  variant = "chip",
  label = "Watch",
  className,
}: ExplainerChipProps) {
  const [open, setOpen] = useState(false);
  const explainer = getExplainer(id);

  if (!explainer) return null;

  const duration = formatExplainerDuration(explainer.durationSeconds);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen(true);
        }}
        aria-label={`${label}: ${explainer.title} (${duration})`}
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 transition-colors",
          variant === "chip"
            ? "rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/20"
            : "rounded-md px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10",
          className
        )}
      >
        <Play className="h-3 w-3 fill-current" />
        {label}
        <span className="tabular-nums opacity-70">({duration})</span>
      </button>

      <ExplainerDialog
        explainer={open ? explainer : null}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/**
 * The guides shelf — every produced video in one browsable list, for the
 * operator who watched something once and wants to find it again.
 *
 * Deliberately NOT a route. A new page under `(dashboard)/` would be unmapped
 * in `lib/permissions.ts`, and `getTabKeyForRoute()` returning null means
 * `canAccessRoute()` ALLOWS it — so shipping a route here would silently widen
 * what a manager with no grants can reach. Mapping it properly would mean a new
 * tab key mirrored into the `ALLOWED_TAB_KEYS` arrays of two edge functions and
 * backfilled for existing managers. A dialog hung off the setup guide reaches
 * the same operator with none of that, so the shelf lives here.
 *
 * Renders `null` while no video exists, exactly like a single slot — the entry
 * point disappears rather than opening an empty shelf.
 */
export function ExplainerShelfButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState<ReadyExplainer | null>(null);
  const ready = listReadyExplainers();

  if (ready.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:underline",
          className
        )}
      >
        <Play className="h-3 w-3 fill-current" />
        Browse all guides
        <span className="tabular-nums opacity-70">({ready.length})</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[90vw] max-w-[560px] gap-0 overflow-hidden p-0 sm:!max-w-[560px]">
          <DialogHeader className="shrink-0 border-b px-5 pb-3 pt-4">
            <DialogTitle className="text-base">Guides</DialogTitle>
          </DialogHeader>
          <ul className="max-h-[min(60vh,480px)] divide-y divide-border overflow-y-auto">
            {ready.map((explainer) => (
              <li key={explainer.id}>
                <button
                  type="button"
                  onClick={() => setPlaying(explainer)}
                  className="flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/60"
                >
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Play className="size-3 fill-current" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium text-foreground">
                        {explainer.title}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {formatExplainerDuration(explainer.durationSeconds)}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                      {explainer.blurb}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      <ExplainerDialog explainer={playing} onClose={() => setPlaying(null)} />
    </>
  );
}
