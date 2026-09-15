"use client";

import { useState, type CSSProperties } from "react";
import { ArrowRight, Ban, CalendarDays, CarFront, Check, FileSpreadsheet, Link2, Sparkles, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FeaturedArtKey } from "@/lib/featured-cards";

/**
 * The small animated art in each featured card, one per art key.
 *
 * Built the way the Calendar View card on Rentals is built: faint primary-tinted
 * shapes that echo the feature, moved by keyframes that already exist in
 * styles/v2-theme.css (`timeline-grow`, `playhead-scan`, `icon-float`,
 * `arrow-nudge`, `car-drive`, `particle-rise`, `shine-sweep`, `v2-glow`,
 * `v2-pulse-subtle`). That stylesheet is on <body> for exactly the gated
 * tenants who reach these screens, so no new CSS is added.
 *
 * `v2-trax-glow` is deliberately NOT used for the Trax art: it glows in
 * `--accent`, which the v2 theme sets to a near-white in light mode and a
 * near-black in dark mode, so on this card it is invisible in both.
 *
 * HEIGHT. Every art fits in 52px. On a hero tab the card is exactly as tall as
 * the graph beside it (the team lead asked for the two to line up top and
 * bottom), which leaves the art box about 56px once the badge row, the title,
 * the two-line subtitle and the deck's controls have their share; an art taller
 * than that would run into the text.
 *
 * MEANING. Each art is a small picture of the thing the card opens, recognisable
 * without its title: cars laid on a week for the calendar, a month with struck
 * days for availability, a name struck off a list for the blocklist. The first
 * pass drew abstract bars, and the team lead read the availability one as a row
 * of cars.
 *
 * Every art takes `still`. With reduced motion asked for, nothing animates:
 * moving parts are drawn at a sensible resting position (the playhead part way
 * across, the car mid-road) and particles, whose keyframe starts transparent,
 * are left out rather than frozen as stray dots.
 *
 * Colours are `primary` tints only, so the art follows the tenant's brand
 * colour like the rest of the card. In dark mode the art slot re-points
 * `--primary` at `--chart-2` for everything inside it: dark mode's --primary is
 * a deep indigo that all but vanishes on the near-black ground (the hero chart
 * beside this card switches its line to `--chart-2` for the same reason, and so
 * do this card's arrow, badge and dots). One custom property, so no art
 * component needs a `dark:` class of its own.
 */

type ArtProps = { still: boolean };

function loop(still: boolean, animation: string, delaySeconds = 0): CSSProperties | undefined {
  if (still) return undefined;
  return delaySeconds ? { animation, animationDelay: `${delaySeconds}s` } : { animation };
}

const GROW = "timeline-grow 3.6s ease-in-out infinite";
const FLOAT = "icon-float 3.6s ease-in-out infinite";
const PLAYHEAD =
  "absolute w-px bg-primary/60 shadow-[0_0_8px_hsl(var(--primary)/0.5)]";

function Particles({ still, className }: { still: boolean; className?: string }) {
  if (still) return null;
  return (
    <span className={cn("pointer-events-none absolute inset-x-0 flex justify-center gap-2", className)}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1 rounded-full bg-primary/70 opacity-0"
          style={{ animation: "particle-rise 3.2s ease-out infinite", animationDelay: `${i * 0.9}s` }}
        />
      ))}
    </span>
  );
}

/**
 * The calendar: three cars, each a row of its bookings laid across a week, and
 * today's line moving over them. The same picture the timeline view draws.
 */
const CALENDAR_ROWS: readonly (readonly { from: number; span: number; tone: string }[])[] = [
  [
    { from: 0, span: 3, tone: "bg-primary/55" },
    { from: 4, span: 2, tone: "bg-primary/35" },
  ],
  [{ from: 1, span: 4, tone: "bg-primary/45" }],
  [
    { from: 0, span: 1, tone: "bg-primary/30" },
    { from: 3, span: 4, tone: "bg-primary/60" },
  ],
];

function CalendarArt({ still }: ArtProps) {
  return (
    <div className="relative">
      <div className="space-y-1.5">
        {CALENDAR_ROWS.map((bookings, r) => (
          <div key={r} className="flex items-center gap-2">
            <CarFront className="size-3 shrink-0 text-primary/70" />
            <div className="relative h-2.5 flex-1 rounded-full bg-primary/[0.07]">
              {bookings.map((b, i) => (
                <span
                  key={i}
                  className={cn("absolute inset-y-0 origin-left rounded-full", b.tone)}
                  style={{
                    left: `${(b.from / 7) * 100}%`,
                    width: `calc(${(b.span / 7) * 100}% - 2px)`,
                    ...loop(still, GROW, r * 0.45 + i * 0.3),
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <span
        className={cn(PLAYHEAD, "-top-1.5 bottom-[-0.375rem]")}
        style={still ? { left: "62%" } : { animation: "playhead-scan 4s ease-in-out infinite" }}
      >
        <span className="absolute -left-[3px] -top-1 size-[7px] rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.7)]" />
      </span>
    </div>
  );
}

/**
 * A question and an answer being written: Trax. The assistant's mark carries
 * the one gradient on the deck, the AI's own colour, so it reads as something
 * other than another list.
 */
function TraxArt({ still }: ArtProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-end">
        <span className="h-4 w-20 rounded-full rounded-br-sm bg-primary/20" />
      </div>
      <div className="flex items-end gap-2">
        <span
          className="relative flex size-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-fuchsia-500 shadow-[0_0_12px_hsl(var(--primary)/0.45)]"
          style={loop(still, FLOAT)}
        >
          <Sparkles className="size-3 text-white" />
          <Particles still={still} className="bottom-full" />
        </span>
        <span className="flex flex-1 flex-col gap-1.5 rounded-2xl rounded-bl-sm bg-primary/[0.08] px-2.5 py-1.5">
          <span
            className="h-1.5 w-full origin-left rounded-full bg-gradient-to-r from-primary/60 to-fuchsia-500/50"
            style={loop(still, GROW)}
          />
          <span className="h-1.5 w-2/3 origin-left rounded-full bg-primary/30" style={loop(still, GROW, 0.45)} />
        </span>
      </div>
    </div>
  );
}

/** Trips travelling from one calendar into the other: Turo Sync. */
function TuroArt({ still }: ArtProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
          <CalendarDays className="size-4 text-primary" />
        </span>
        <span className="relative h-6 flex-1 overflow-hidden">
          <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-primary/40" />
          <span
            className="absolute top-1/2 -translate-y-1/2"
            style={still ? { left: "42%" } : { animation: "car-drive 4.2s ease-in-out infinite" }}
          >
            <CarFront className="size-4 text-primary" />
          </span>
        </span>
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/15"
          style={loop(still, "v2-pulse-subtle 4.2s ease-in-out infinite")}
        >
          <Check className="size-4 text-primary" />
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 flex-[2] origin-left rounded-full bg-primary/45" style={loop(still, GROW)} />
        <span className="h-1.5 flex-1 rounded-full bg-primary/15" />
        <span className="h-1.5 flex-[2] origin-left rounded-full bg-primary/35" style={loop(still, GROW, 0.6)} />
      </div>
    </div>
  );
}

/** A sign-up link with its Copy button, and the people it brings in. */
function InviteArt({ still }: ArtProps) {
  return (
    <div>
      <div className="relative flex h-6 items-center gap-2 overflow-hidden rounded-full bg-primary/[0.08] pl-2.5 pr-1">
        <Link2 className="size-3 shrink-0 text-primary" />
        <span className="h-1.5 flex-1 rounded-full bg-primary/25" />
        <span className="flex h-4 items-center rounded-full bg-primary/60 px-1.5 text-[8px] font-semibold leading-none text-white">
          Copy
        </span>
        {!still && (
          <span
            className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/25 to-transparent"
            style={{ animation: "shine-sweep 4s ease-in-out infinite", transform: "translateX(-120%)" }}
          />
        )}
      </div>
      <div className="mt-2 flex items-center justify-center">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="-ml-1 flex size-5 items-center justify-center rounded-full bg-primary/15 ring-2 ring-background first:ml-0"
            style={loop(still, FLOAT, i * 0.45)}
          >
            <User className="size-3 text-primary" />
          </span>
        ))}
        <span
          className="ml-1.5 flex size-5 items-center justify-center rounded-full bg-primary/60"
          style={loop(still, "v2-pulse-subtle 2.4s ease-in-out infinite")}
        >
          <Check className="size-3 text-white" />
        </span>
      </div>
    </div>
  );
}

/** A spreadsheet flowing into rows: Import CSV. */
function ImportArt({ still }: ArtProps) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10"
        style={loop(still, FLOAT)}
      >
        <FileSpreadsheet className="size-5 text-primary" />
      </span>
      <ArrowRight
        className="size-3.5 shrink-0 text-primary/60"
        style={loop(still, "arrow-nudge 3.6s ease-in-out infinite")}
      />
      <div className="flex-1 space-y-2">
        {[0, 0.45, 0.9].map((delay) => (
          <div key={delay} className="flex items-center gap-1.5">
            <span className="size-2.5 shrink-0 rounded-full bg-primary/25" />
            <span className="relative h-1.5 flex-1 rounded-full bg-primary/15">
              <span
                className="absolute inset-0 origin-left rounded-full bg-primary/50"
                style={loop(still, GROW, delay)}
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A short customer list with one name being struck off it. */
function BlockedArt({ still }: ArtProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="size-3 shrink-0 rounded-full bg-primary/25" />
        <span className="h-1.5 flex-[3] rounded-full bg-primary/20" />
        <span className="h-1.5 flex-1 rounded-full bg-primary/10" />
      </div>
      <div className="flex items-center gap-2">
        <span className="size-3 shrink-0 rounded-full bg-primary/40" />
        <span className="relative flex h-3.5 flex-[4] items-center">
          <span className="h-1.5 w-full rounded-full bg-primary/15" />
          <span
            className="absolute inset-x-0 top-1/2 h-0.5 origin-left -translate-y-1/2 rounded-full bg-primary/70"
            style={loop(still, GROW)}
          />
        </span>
        <Ban className="size-3.5 shrink-0 text-primary" style={loop(still, FLOAT, 0.45)} />
      </div>
      <div className="flex items-center gap-2">
        <span className="size-3 shrink-0 rounded-full bg-primary/25" />
        <span className="h-1.5 flex-[2] rounded-full bg-primary/20" />
        <span className="h-1.5 flex-[2] rounded-full bg-primary/10" />
      </div>
    </div>
  );
}

/** Two weeks of a month, Monday first: the dates struck through are blocked. */
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"] as const;
const BLOCKED_CELLS: ReadonlySet<number> = new Set([4, 11, 12]);
const TODAY_CELL = 8;

/**
 * Availability: a small calendar, two weeks of dates under their weekday
 * letters, with the blocked days struck through and today ringed. What the
 * Availability screen sets: when customers can book, and the days they cannot.
 */
function AvailabilityArt({ still }: ArtProps) {
  return (
    <div className="mx-auto w-full max-w-[12rem]">
      <div className="grid grid-cols-7 gap-1 text-center text-[8px] font-semibold leading-none text-primary/60">
        {WEEKDAYS.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-7 gap-1">
        {Array.from({ length: 14 }, (_, i) => {
          const blocked = BLOCKED_CELLS.has(i);
          return (
            <span
              key={i}
              className={cn(
                "relative flex h-4 items-center justify-center overflow-hidden rounded-[4px] text-[8px] font-medium leading-none tabular-nums",
                blocked ? "bg-primary/15 text-primary/45" : "bg-primary/[0.06] text-primary/75",
                i === TODAY_CELL && "ring-1 ring-inset ring-primary/70",
              )}
              style={blocked ? loop(still, "v2-glow 3.6s ease-in-out infinite", i * 0.25) : undefined}
            >
              {14 + i}
              {blocked && <span className="absolute inset-x-0.5 top-1/2 h-px -rotate-[24deg] bg-primary/70" />}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Something new arriving: a small panel catching the light.
 *
 * FLUID. The art holder is ~226px wide on the widest card and ~120px on the
 * ~162px card of a 1024px screen; a fixed 9.5rem panel ran 32px past the
 * holder there and was cut off by the card, sparkle and all. The wrapper now
 * fills the holder up to 10.5rem, and its 0.5rem side padding is where the
 * sparkle hangs off the panel's corner, so the sparkle stays inside the holder
 * at every width.
 */
function AnnouncementArt({ still }: ArtProps) {
  return (
    <div className="relative mx-auto w-full max-w-[10.5rem] px-2">
      <span
        className="absolute -inset-y-3 -inset-x-1 rounded-full bg-primary/20 blur-xl"
        style={loop(still, "v2-glow 3.6s ease-in-out infinite")}
      />
      <div className="relative overflow-hidden rounded-lg bg-background/60 p-2 shadow-sm">
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-primary/50" />
          <span className="h-1.5 w-10 max-w-[60%] rounded-full bg-primary/35" />
        </div>
        <span className="mt-1.5 block h-1.5 w-full rounded-full bg-primary/20" />
        <span className="mt-1 block h-1.5 w-2/3 rounded-full bg-primary/15" />
        {!still && (
          <span
            className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/20 to-transparent"
            style={{ animation: "shine-sweep 4.5s ease-in-out infinite", transform: "translateX(-120%)" }}
          />
        )}
      </div>
      <span
        className="absolute -top-2.5 right-0 flex size-6 items-center justify-center rounded-full border border-primary/30 bg-primary/15"
        style={loop(still, FLOAT)}
      >
        <Sparkles className="size-3 text-primary" />
      </span>
      <Particles still={still} className="bottom-full" />
    </div>
  );
}

/** A to-do list: one item done, the next one lit. A recommendation. */
function SuggestionArt({ still }: ArtProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="flex size-3 shrink-0 items-center justify-center rounded-full bg-primary/40">
          <Check className="size-2 text-white" />
        </span>
        <span className="h-1.5 flex-[3] rounded-full bg-primary/20" />
        <span className="h-1.5 flex-1 rounded-full bg-primary/10" />
      </div>
      <div className="flex items-center gap-2">
        <span
          className="size-3 shrink-0 rounded-full border-2 border-primary/60"
          style={loop(still, "v2-pulse-subtle 2.4s ease-in-out infinite")}
        />
        <span className="relative h-1.5 flex-[3] rounded-full bg-primary/15">
          <span className="absolute inset-0 origin-left rounded-full bg-primary/55" style={loop(still, GROW)} />
        </span>
        <ArrowRight
          className="size-3 shrink-0 text-primary"
          style={loop(still, "arrow-nudge 3.6s ease-in-out infinite")}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="size-3 shrink-0 rounded-full border-2 border-primary/25" />
        <span className="h-1.5 flex-[2] rounded-full bg-primary/15" />
        <span className="h-1.5 flex-[2] rounded-full bg-primary/10" />
      </div>
    </div>
  );
}

const ARTS: Record<FeaturedArtKey, (props: ArtProps) => JSX.Element> = {
  calendar: CalendarArt,
  trax: TraxArt,
  turo: TuroArt,
  invite: InviteArt,
  import: ImportArt,
  blocked: BlockedArt,
  availability: AvailabilityArt,
  announcement: AnnouncementArt,
  suggestion: SuggestionArt,
};

export function FeaturedCardArt({ art, still }: { art: FeaturedArtKey; still: boolean }) {
  const Art = ARTS[art] ?? AnnouncementArt;
  return <Art still={still} />;
}

/**
 * The art region of a card: fills whatever height the card leaves between its
 * badge row and its text, so every card in a deck has the same art box.
 *
 * With an image (an announcement whose `image_url` passed `safeImageSrc`), the
 * image fills the box, cropped to cover, under a faint edge; if it fails to
 * load, the generic art takes its place rather than a broken-image glyph.
 */
export function FeaturedArtSlot({
  art,
  imageUrl,
  still,
}: {
  art: FeaturedArtKey;
  imageUrl?: string | null;
  still: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = !!imageUrl && failedSrc !== imageUrl;

  return (
    <div aria-hidden className="pointer-events-none relative my-2 min-h-0 flex-1 dark:[--primary:var(--chart-2)]">
      {showImage ? (
        <div className="absolute inset-0 overflow-hidden rounded-lg bg-primary/5">
          {/* A plain <img>: announcement images live on Supabase storage, a
              host next/image is not configured for, and this box is small. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl as string}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            draggable={false}
            onError={() => setFailedSrc(imageUrl as string)}
            className="size-full object-cover"
          />
          <span className="absolute inset-0 rounded-lg ring-1 ring-inset ring-foreground/10" />
        </div>
      ) : (
        <div className="absolute inset-x-1 top-1/2 -translate-y-1/2 opacity-80 transition-opacity duration-300 group-hover/deck:opacity-100">
          <FeaturedCardArt art={art} still={still} />
        </div>
      )}
    </div>
  );
}
