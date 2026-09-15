/**
 * The overview slot that turns over, under a name that does not lie about scope.
 *
 * The implementation lives at `rentals-v2/rentals-overview-flip.tsx` because
 * rentals needed it first, but nothing in it is rentals-specific: it takes a
 * `front` node, a `back` node, a `flipped` boolean and an `onFlipBack`, and its
 * own header says "presentation only — no filter semantics live here".
 *
 * Re-exported rather than moved. The rentals flip is working, and relocating a
 * file to improve a name is churn against a live feature for no behavioural
 * gain. New callers import `OverviewFlip` from here; rentals keeps its own
 * import; if the file is ever moved for real, this is the single line to update.
 */
export { RentalsOverviewFlip as OverviewFlip } from "@/components/rentals-v2/rentals-overview-flip";
