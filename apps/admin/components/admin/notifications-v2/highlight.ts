/**
 * The sidebar highlight the operator portal's Notifications view uses
 * (ui-v2/sidebar SIDEBAR_HIGHLIGHT_*), kept here so the full-screen view draws
 * its rows the same way without changing this app's shared sidebar.
 */
export const NV_HIGHLIGHT_HOVER =
  'hover:bg-primary/10 hover:text-primary [&:hover_svg]:text-primary dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))] dark:hover:text-[hsl(var(--v2-link,var(--primary)))] dark:[&:hover_svg]:text-[hsl(var(--v2-link,var(--primary)))]';
export const NV_HIGHLIGHT_FOCUS =
  'focus-visible:bg-primary/10 focus-visible:text-primary [&:focus-visible_svg]:text-primary dark:focus-visible:bg-[hsl(var(--v2-hover,var(--muted)))] dark:focus-visible:text-[hsl(var(--v2-link,var(--primary)))] dark:[&:focus-visible_svg]:text-[hsl(var(--v2-link,var(--primary)))]';
export const NV_HIGHLIGHT_ACTIVE =
  'bg-primary/10 text-primary [&_svg]:text-primary dark:bg-[hsl(var(--v2-hover,var(--muted)))] dark:text-[hsl(var(--v2-link,var(--primary)))] dark:[&_svg]:text-[hsl(var(--v2-link,var(--primary)))]';
