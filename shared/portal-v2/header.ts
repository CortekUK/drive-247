/**
 * The v2 page header's action cluster, shared by both portals. Re-exported by
 * apps/portal/src/components/shared/header-icon-button-v2.tsx, where the full
 * rationale lives (team lead, Sep 15–16 2026: ONE labelled button, the page's
 * main action, everything else an icon; every control 32px).
 */

/**
 * The cluster, centred on the SUBTITLE line rather than the heading: the box is
 * the subtitle's line box (24px) at the bottom of the header row, so 32px
 * controls overflow it by 4px each way and centre on it. Stacks below `sm`.
 */
export const HEADER_ACTIONS_V2 = "sm:self-end sm:h-6 sm:items-center";

/**
 * The header's one labelled button (Add Vehicle, Book a car) at the smaller
 * size: a 32px pill, 13px text, 14px icon. `!mr-0` drops the `mr-2` the v1
 * buttons put on their icon, since `gap-1.5` now spaces it.
 */
export const HEADER_PRIMARY_V2 = "h-8 gap-1.5 rounded-full px-3.5 text-[13px] [&_svg]:!size-3.5 [&_svg]:!mr-0";
