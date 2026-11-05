"use client";

/**
 * A real, scaled-down look at a page that just went live: the operator's own
 * booking site, or their portal's sign-in page, loaded in an iframe and shrunk
 * to fit a card.
 *
 * It is a picture, not a second browser: no pointer events, out of the tab
 * order, hidden from screen readers, and sandboxed without forms or top-level
 * navigation, so nothing inside it can be clicked, typed into or take the page
 * away. The card around it is what opens the real thing.
 *
 * The portal is shown at /login on purpose. A magic sign-in link must never be
 * loaded here: opening it in a hidden frame would spend it.
 */

import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";

/** The desktop width the page is laid out at before it is scaled down. */
const PAGE_WIDTH = 1280;

/**
 * Never a grey box for ever: if the frame has not reported `load` by now (a
 * slow page, or a browser holding it back), show whatever it has painted.
 */
const REVEAL_ANYWAY_MS = 6000;

/**
 * The page on a laptop: a dark lid with a camera, a 16:10 screen holding a
 * slim address bar and the scaled page, and the aluminium base underneath,
 * a little wider than the lid, with the thumb notch.
 */
export function LivePreview({
  url,
  className,
  tilt = "none",
  shot,
}: {
  url: string;
  /**
   * A picture to show instead of loading the page. For the portal: its real
   * page here would be the sign-in screen (the frame has no session), which
   * says nothing about what they just bought, so the dashboard shot the
   * landing page uses stands in.
   */
  shot?: { light: string; dark: string };
  className?: string;
  /** Which way the laptop turns: "left" faces right (stands on the left), "right" the other way. */
  tilt?: "left" | "right" | "none";
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setLoaded(true), REVEAL_ANYWAY_MS);
    return () => window.clearTimeout(t);
  }, []);

  const scale = box.w / PAGE_WIDTH;
  const address = url.replace(/^https?:\/\//, "").replace(/\/login$/, "");

  return (
    // Perspective on the outside, the turn on the inside: the two laptops
    // angle in towards each other, and straighten a little on hover.
    <div className={cn("mx-auto w-full [perspective:1800px]", className)}>
      <div
        className={cn(
          "relative transition-transform duration-300 ease-out motion-reduce:transition-none",
          tilt === "left" && "[transform:rotateX(7deg)_rotateY(16deg)] group-hover:[transform:rotateX(4deg)_rotateY(8deg)]",
          tilt === "right" && "[transform:rotateX(7deg)_rotateY(-16deg)] group-hover:[transform:rotateX(4deg)_rotateY(-8deg)]",
        )}
      >
      {/* lid: a lit edge on top, darker towards the hinge */}
      <div className="relative rounded-t-[16px] bg-[linear-gradient(160deg,#3a3a44_0%,#16161c_38%,#0b0b10_100%)] p-[2.4%] pb-[3%] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_0_0_1px_rgba(255,255,255,0.06)] dark:bg-[linear-gradient(160deg,#4a4a55_0%,#22222b_45%,#16161c_100%)]">
        <span aria-hidden className="absolute top-[1%] left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-zinc-700 ring-1 ring-zinc-600" />
        {/* screen */}
        <div className="flex aspect-[16/10] flex-col overflow-hidden rounded-[3px] bg-white dark:bg-[#16161f]">
          <div className="flex h-[9%] min-h-4 shrink-0 items-center gap-1.5 border-b border-zinc-200 bg-zinc-50 px-2 dark:border-white/10 dark:bg-white/[0.04]">
            <span className="flex gap-[3px]" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-1.5 rounded-full bg-zinc-300 dark:bg-white/20" />
              ))}
            </span>
            <span className="mx-auto flex min-w-0 max-w-[70%] items-center gap-1 rounded-full bg-white px-2 py-px text-[9px] leading-tight font-medium text-zinc-600 ring-1 ring-zinc-200 dark:bg-white/[0.06] dark:text-zinc-300 dark:ring-white/10">
              <Lock className="size-2.5 shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden />
              <span className="truncate">{address}</span>
            </span>
          </div>
          <div ref={boxRef} className="relative min-h-0 flex-1 overflow-hidden bg-zinc-50 dark:bg-white/[0.02]">
            {shot ? (
              <>
                <img src={shot.light} alt="" className="absolute inset-0 h-full w-full object-cover object-left-top dark:hidden" />
                <img src={shot.dark} alt="" className="absolute inset-0 hidden h-full w-full object-cover object-left-top dark:block" />
              </>
            ) : null}
            {!shot && !loaded && (
              <div aria-hidden className="absolute inset-0 animate-pulse bg-zinc-100 dark:bg-white/[0.04]" />
            )}
            {!shot && scale > 0 && (
              <iframe
                src={url}
                title=""
                aria-hidden
                tabIndex={-1}
                sandbox="allow-scripts allow-same-origin"
                onLoad={() => setLoaded(true)}
                className={cn(
                  "pointer-events-none absolute top-0 left-0 origin-top-left border-0 bg-white transition-opacity duration-200 ease-out motion-reduce:transition-none",
                  loaded ? "opacity-100" : "opacity-0",
                )}
                style={{ width: PAGE_WIDTH, height: box.h / scale, transform: `scale(${scale})` }}
              />
            )}
          </div>
        </div>
      </div>
      {/* hinge */}
      <div aria-hidden className="mx-auto h-1 w-[92%] bg-[linear-gradient(180deg,#52525b,#27272a)]" />
      {/* base: the deck, then its front lip catching the light */}
      <div aria-hidden className="relative -mx-[7%] h-2 rounded-t-[3px] bg-[linear-gradient(180deg,#f4f4f5_0%,#d9d9de_100%)] dark:bg-[linear-gradient(180deg,#52525b_0%,#3f3f46_100%)]">
        <span className="absolute top-0 left-1/2 h-1 w-[16%] -translate-x-1/2 rounded-b-md bg-zinc-400/70 dark:bg-black/40" />
      </div>
      <div aria-hidden className="relative -mx-[7%] h-2 rounded-b-[14px] bg-[linear-gradient(180deg,#c4c4cc_0%,#a1a1aa_70%,#8b8b94_100%)] dark:bg-[linear-gradient(180deg,#3f3f46_0%,#27272a_100%)]" />
      </div>
      {/* the shadow on the table, wide and soft */}
      <div
        aria-hidden
        className={cn(
          "mx-auto mt-1 h-5 w-[104%] -translate-x-[2%] rounded-[50%] bg-indigo-950/[0.14] blur-[10px] dark:bg-black/60",
          tilt === "left" && "translate-x-[1%]",
          tilt === "right" && "-translate-x-[5%]",
        )}
      />
    </div>
  );
}
