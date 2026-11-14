import type { ReactNode } from "react";

/*
 * A numbered label for the sliding track's screens (product-track.css .pt-label): a thin line
 * out of the thing it explains to a small slate box. Hidden anywhere but on the track.
 * "down" hangs below and runs down to the right; "right" / "left" run straight out sideways.
 */
export function TrackLabel({ n, way, children }: { n: number; way: "down" | "down-left" | "right" | "left"; children: ReactNode }) {
  return (
    <span className={`pt-label is-${way}`} data-n={n} aria-hidden>
      <span>
        <i>{n}</i>
        <b>{children}</b>
      </span>
    </span>
  );
}
