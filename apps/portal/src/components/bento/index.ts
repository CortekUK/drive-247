/**
 * Bento component layer — compose every page from these (over shadcn primitives).
 * Spec: design_handoff_bento/DESIGN_SYSTEM.md §7 + SHADCN_MAPPING.md.
 */
export { Tile, tileVariants, type TileProps } from "./tile";
export { KpiTile, type KpiTileProps } from "./kpi-tile";
export { Eyebrow } from "./eyebrow";
export { Money, type MoneyProps } from "./money";
export {
  StatusPill,
  statusTone,
  type StatusTone,
  type StatusPillProps,
} from "./status-pill";
export { Segmented, type SegmentedOption } from "./segmented";
export { EmptyState, ErrorState, StateSwitch } from "./states";
export { useCountUp } from "./use-count-up";
export { SectionCard } from "./section-card";
export { TableTile, bentoTable } from "./table-tile";
export { SideSheet } from "./side-sheet";
export { Modal } from "./modal";
export { Stepper } from "./stepper";
export { ProcessOverlay, type ProcessStep } from "./process-overlay";
export { Shimmer, KpiTileSkeletonRow, TableSkeleton } from "./skeletons";
export { GlassBackdrop } from "./glass-backdrop";
