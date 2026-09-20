"use client";

/**
 * The building blocks of a v2 settings page (northwind only — see
 * `settings/page.tsx`, which renders these behind `useV2('chrome')`).
 *
 * Modelled on Stripe's settings detail pages: one heading, then flat panels of
 * rows — label and a line of help on the left, the control right after it. No
 * breadcrumb (Settings in the nav is the way back), no card-per-field, no
 * decorative icons, and ONE save bar per page. A row is ~64px, so a page of
 * related settings fits on one screen where v1 gave every field its own card.
 *
 * PAGE SAVE BAR (reusable)
 *   <SettingsPageSaveProvider>          wrap the page body; sections inside it
 *     …sections…                         drop their own Save buttons and footers
 *   </SettingsPageSaveProvider>          and show only an inline save error
 *   <SettingsStickySaveBar               the page's one Reset + Save changes,
 *     dirty saving error                 sticky at the bottom while scrolling
 *     onSave onReset />
 *
 *   useSettingsPageSave()  true inside the provider. Section save parts
 *                          (SectionSaveBar, SaveFooter, the regional panel,
 *                          lockbox messages, the monthly rate row) read it.
 *   Sections still register `save` AND `discard` with the page
 *   (`RegisterSectionSave`, pricing-money-parts.tsx): Save changes runs every
 *   registered save, Reset runs every registered discard. Reset DISCARDS unsaved
 *   edits; it never restores defaults.
 *
 *   settingsSaveIssue(message, fieldId)
 *     What a save throws when a FIELD is what refused it, rather than the
 *     server. The save bar scrolls that field into view and focuses it, so a
 *     reason about something three screens up is not only a toast. The field
 *     shows the same reason inline; the bar keeps its summary line.
 *
 * HEADINGS
 *   SETTINGS_PAGE_TITLE     the page's h1, bold
 *   SETTINGS_SECTION_TITLE  a section's h2, semibold. `SettingsSection` draws
 *                           no line under it. Locations is the one page that
 *                           does (team lead, Sep 19 2026 — its two sides are
 *                           headed outside their panels and the divider is
 *                           what separates them); it draws its own heading
 *                           block and is pinned by
 *                           __tests__/components/settings-locations-lane-v2.
 *
 * SECTIONS AND DEEP LINKS
 *   <SettingsSection anchor="security-deposit" title=… description=…>
 *     a titled part of a longer page, with the id `settings-security-deposit`
 *   useScrollToSection(id, ready)
 *     scrolls that section to the top once the page's data is in, for a
 *     `?tab=preauth` link or a `#settings-…` hash
 *
 * BESIDE THE TRAX PANEL
 *   SETTINGS_COLUMN_BESIDE_TRAX   add to the page column: while the floating
 *                                 Trax panel is open it stops short of it
 *   SettingsRow                   stacks (label above control) while the
 *                                 panel is open on a screen too narrow for
 *                                 the 420px label column beside it
 *
 * TABS INSIDE A PAGE (reusable)
 *   <SettingsTabs label="General" tabs={[{ value, label }]} value onValueChange>
 *     <SettingsTabPanel value="regional">…</SettingsTabPanel>
 *   </SettingsTabs>
 *     One level of navigation: the index lists pages, a page opens, and tabs
 *     split it. Pills in the brand colour, the v2 hover pair. Every panel
 *     stays mounted while hidden, so switching tabs keeps unsaved edits and
 *     their registered saves (the page's one save bar covers every tab). The
 *     page owns `value` (General keeps it in `?tab=`).
 *
 * CONTROLS AT THE END OF THE ROW (opt-in)
 *   <SettingsRowAlignProvider align="end">  every SettingsRow inside puts its
 *                                           control at the far end of the row
 *   <SettingsRow align="end">               one row. The default is "start".
 *
 *   This is the house style for a settings FORM, and a section owns it rather
 *   than inheriting it: each panel in locations-v2, pricing-rules-v2,
 *   fees-deposit-v2, payment-modes-v2 and business-rules-pages wraps itself in
 *   the provider, so it reads the same whichever page mounts it (the return
 *   reminder panel sits on Customer messages, not on a General-lane page).
 *   The settings page's own `V2_PAGES_CONTROLS_AT_END` then only has to cover
 *   the rows written in `settings/page.tsx` itself.
 */

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Skeleton } from "@/components/ui-v2/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui-v2/tabs";
import { SettingsSaveState } from "@/components/settings-v2/section-states";
import { settingsSectionId } from "@/components/settings-v2/settings-shell-state";
import { cn } from "@/lib/utils";

/** The page title: always heavier than any section title under it. */
export const SETTINGS_PAGE_TITLE = "font-heading text-2xl font-bold tracking-tight text-foreground";
/** A section title (and a panel title). */
export const SETTINGS_SECTION_TITLE = "font-heading text-base font-semibold tracking-tight text-foreground";

/* -------------------------------------------------------------------------- */
/* Beside the Trax panel                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The Trax panel floats over the bottom-right corner of the page
 * (components/trax/trax-panel.tsx), and a settings column 1160px wide ran
 * underneath it: the panel and its suggestion chips landed in the middle of a
 * section, over its controls and over the page's Save changes.
 *
 * Added to a settings page's column (`w-full max-w-[1160px] …`), this makes
 * the column's right edge stop short of the open panel on md and up: never
 * wider than 1160px, never wider than the space left of the panel, never
 * narrower than 20rem (below that there is no room for both, and the panel,
 * which the operator can close, overlaps instead). The page's save bar is the
 * column's last child, so it steps aside with it. The width animates with the
 * panel's own 200ms.
 *
 * It keys on `data-trax-panel="open"`, which TraxPanel puts on <html>, and uses
 * the FLOATING width (`--trax-width`, styles/v2-theme.css) even while the panel
 * is expanded, so the page does not reflow under the expanded overlay's scrim.
 * With Trax closed, below md, and on every v1 page (which never mounts
 * TraxPanel) nothing matches and the column is exactly what it was.
 */
export const SETTINGS_COLUMN_BESIDE_TRAX =
  "transition-[max-width] duration-200 ease-linear motion-reduce:transition-none " +
  "md:[html[data-trax-panel=open]_&]:max-w-[min(1160px,max(20rem,calc(100%-var(--trax-width,440px)-1rem)))]";

/**
 * A settings row's grid needs ~720px (a 420px label column, the 40px gap and
 * the panel padding, then the control). While the Trax panel is open on a
 * screen up to 1440px wide the column is narrower than that, so rows stack as
 * they do on a phone instead of squeezing the control to a sliver. Nothing
 * changes with Trax closed.
 */
export const SETTINGS_ROW_STACKS_BESIDE_TRAX =
  "max-[1440px]:[html[data-trax-panel=open]_&]:flex max-[1440px]:[html[data-trax-panel=open]_&]:items-stretch";

export function SettingsPageHeader({
  title,
  description,
  tourAnchor,
}: {
  title: string;
  description?: ReactNode;
  tourAnchor?: string;
}) {
  return (
    <header className="space-y-1.5" data-tour={tourAnchor}>
      <h1 className={SETTINGS_PAGE_TITLE}>{title}</h1>
      {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
    </header>
  );
}

/** `SettingsPageHeader` before its page is known: the same two line boxes
 *  (32px title, 20px description) and gap, so whatever follows it lands where
 *  the loaded page's first panel will. Decorative only; pair it with a
 *  skeleton that carries the loading label. */
export function SettingsPageHeaderSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-1.5">
      <div className="flex h-8 items-center">
        <Skeleton className="h-6 w-48 max-w-full rounded-full" />
      </div>
      <div className="flex h-5 items-center">
        <Skeleton className="h-3.5 w-80 max-w-full rounded-full" />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* One save bar per page                                                       */
/* -------------------------------------------------------------------------- */

const SettingsPageSaveContext = createContext(false);

/** Sections inside this defer Save and Reset to the page's `SettingsStickySaveBar`. */
export function SettingsPageSaveProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  return <SettingsPageSaveContext.Provider value={enabled}>{children}</SettingsPageSaveContext.Provider>;
}

/** True when the page owns Save and Reset (see the header of this file). */
export function useSettingsPageSave(): boolean {
  return useContext(SettingsPageSaveContext);
}

/**
 * The page's Reset and Save changes. The last child of the page wrapper: where
 * the page is short it sits at the end, where it scrolls it floats 16px above
 * the bottom of the window. Both buttons wait for a genuine change. It is as
 * wide as the page column, so a column carrying `SETTINGS_COLUMN_BESIDE_TRAX`
 * keeps it clear of the open Trax panel.
 *
 * A refused save that names its field (`settingsSaveIssue`) also takes the
 * operator there — see `focusSettingsSaveIssue` below. That lives here rather
 * than in each page because every v2 settings page reports its refusals
 * through this one `error`.
 */
export function SettingsStickySaveBar({
  dirty,
  saving,
  error,
  onSave,
  onReset,
  className,
}: {
  dirty: boolean;
  saving: boolean;
  /** Why the last Save changes failed; cleared by the page on the next edit or save. */
  error?: unknown;
  onSave: () => void;
  onReset: () => void;
  className?: string;
}) {
  const status = saving ? "saving" : error ? "error" : dirty ? "dirty" : "idle";
  // Each refusal is a new error object, so two refusals for the same field
  // still move the view. Does nothing when the failure names no field (a write
  // that was refused by the server), or while the leave dialog holds the
  // message instead (the page passes null then).
  useEffect(() => {
    focusSettingsSaveIssue(error);
  }, [error]);
  return (
    <div
      data-settings-save-bar=""
      className={cn("pointer-events-none sticky bottom-4 z-30 flex justify-end pt-2", className)}
    >
      <div
        role="region"
        aria-label="Save changes"
        className={cn(
          "pointer-events-auto flex max-w-full flex-wrap items-center justify-end gap-2 border bg-card p-1.5 shadow-lg",
          status === "error" ? "rounded-3xl pl-4" : "rounded-full pl-4",
        )}
      >
        <SettingsSaveState status={status} error={error} className="mr-1 min-w-0" />
        <Button type="button" variant="outline" size="sm" onClick={onReset} disabled={!dirty || saving}>
          Reset
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onSave}
          disabled={!dirty || saving}
          aria-busy={saving || undefined}
          className="min-w-[112px]"
        >
          {saving && <Loader2 className="animate-spin" data-icon="inline-start" />}
          Save changes
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sections of a longer page                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One titled part of a page that holds several (Tax and deposit). The id is
 * `settings-<anchor>`, the target of a deep link; `scroll-mt-24` keeps its
 * title clear of the 64px sticky top bar when it is scrolled to. `action` sits
 * beside the title (a section's own "View only" on a partly editable page).
 */
export function SettingsSection({
  anchor,
  title,
  description,
  action,
  children,
  className,
}: {
  anchor: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = settingsSectionId(anchor);
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      data-settings-section={anchor}
      className={cn("scroll-mt-24 space-y-3", className)}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className={SETTINGS_SECTION_TITLE}>
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * Scroll the element with `targetId` to the top of the window once `ready`
 * (the page's data is in, so the skeletons above it have given way and it will
 * not be pushed down after the jump). Once per target: scrolling back up is
 * not undone, and a new target (another deep link) scrolls again. A section
 * that mounts a few frames late is still found (up to ~half a second).
 */
export const SCROLL_TO_SECTION_MAX_FRAMES = 30;

export function useScrollToSection(targetId: string | null, ready: boolean) {
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (!targetId) {
      scrolledTo.current = null;
      return;
    }
    if (!ready || scrolledTo.current === targetId) return;
    let frames = 0;
    let frame = 0;
    const attempt = () => {
      const target = document.getElementById(targetId);
      if (target) {
        scrolledTo.current = targetId;
        target.scrollIntoView?.({ block: "start" });
        return;
      }
      frames += 1;
      if (frames < SCROLL_TO_SECTION_MAX_FRAMES) frame = window.requestAnimationFrame(attempt);
    };
    frame = window.requestAnimationFrame(attempt);
    return () => window.cancelAnimationFrame(frame);
  }, [targetId, ready]);
}

/* -------------------------------------------------------------------------- */
/* Where a refused save takes the operator                                     */
/* -------------------------------------------------------------------------- */

/**
 * A refused save that names the field to fix.
 *
 * A v2 settings page is one long column of panels, so the reason a save was
 * refused ("Enter your pickup address") routinely belongs to a field several
 * screens from the save bar reporting it. A section throws this instead of a
 * plain Error and the save bar takes the operator to that field. The message is
 * untouched, so the bar's summary line, the leave dialog and the toast read
 * exactly as they did.
 */
const ISSUE_FIELD_KEY = "settingsIssueField";

export function settingsSaveIssue(message: string, field: string): Error {
  return Object.assign(new Error(message), { [ISSUE_FIELD_KEY]: field });
}

/** The `id` of the field a refused save named, or null for any other failure. */
export function settingsSaveIssueField(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const field = (error as Record<string, unknown>)[ISSUE_FIELD_KEY];
  return typeof field === "string" && field ? field : null;
}

/** Frames to keep looking for the field, for a row that renders with the note. */
export const SETTINGS_FOCUS_MAX_FRAMES = 30;

/**
 * Take the operator to the field a refused save named: focus it, then bring it
 * into view. Focus first with `preventScroll` and scroll once afterwards, so
 * the browser's own jump cannot land the field under the 64px sticky top bar.
 * Instant rather than smooth where the operator has asked for less motion.
 * Returns whether the error named a field at all.
 */
export function focusSettingsSaveIssue(error: unknown): boolean {
  const field = settingsSaveIssueField(error);
  if (!field || typeof document === "undefined") return false;
  let frames = 0;
  const attempt = () => {
    const target = document.getElementById(field);
    if (target) {
      target.focus?.({ preventScroll: true });
      target.scrollIntoView?.({ behavior: settingsScrollBehavior(), block: "center" });
      return;
    }
    frames += 1;
    if (frames < SETTINGS_FOCUS_MAX_FRAMES && typeof window !== "undefined") {
      window.requestAnimationFrame(attempt);
    }
  };
  attempt();
  return true;
}

function settingsScrollBehavior(): ScrollBehavior {
  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return reduced ? "auto" : "smooth";
}

/* -------------------------------------------------------------------------- */
/* Panels and rows                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A flat bordered panel of rows, with an optional title. `footer` is a panel
 * action (e.g. "Add promo code"). Inside a page save bar there is no divider
 * line above it, and it collapses when a section's save part renders nothing.
 */
export function SettingsPanel({
  title,
  description,
  children,
  footer,
  className,
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const pageSave = useSettingsPageSave();
  return (
    <section className={cn("rounded-xl border bg-card", className)}>
      {(title || description) && (
        <div className="px-5 pt-4 pb-1">
          {title && <h2 className={SETTINGS_SECTION_TITLE}>{title}</h2>}
          {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
        </div>
      )}
      <div className="divide-y">{children}</div>
      {footer &&
        (pageSave ? (
          <div className="flex flex-wrap items-center justify-start gap-2 px-5 pb-4 empty:hidden">{footer}</div>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3">{footer}</div>
        ))}
    </section>
  );
}

/**
 * Where a row's control sits: "start" (right after the 420px label column,
 * the default) or "end" (at the far end of the row, the label and its help
 * taking the rest). A page sets it once for all its rows with
 * `SettingsRowAlignProvider`; a row's own `align` wins.
 */
export type SettingsRowAlign = "start" | "end";

const SettingsRowAlignContext = createContext<SettingsRowAlign>("start");

export function SettingsRowAlignProvider({ align, children }: { align: SettingsRowAlign; children: ReactNode }) {
  return <SettingsRowAlignContext.Provider value={align}>{children}</SettingsRowAlignContext.Provider>;
}

/** Row grid when the control sits at the end: the label takes the rest, capped so help text stays readable. */
const ROW_GRID_END = "flex flex-col gap-3 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-x-10";
const ROW_LABEL_END = "min-w-0 md:max-w-2xl";
const ROW_CONTROLS_END = "flex min-w-0 flex-wrap items-center justify-start gap-2 md:justify-end";

/**
 * One setting: a left-aligned grid. The label column is 420px and the control
 * starts right after it, so it never drifts to the far edge of a wide screen.
 * The whole row stacks on a phone, and beside an open Trax panel on a screen
 * up to 1440px wide (`SETTINGS_ROW_STACKS_BESIDE_TRAX`). With `align="end"`
 * (or inside a `SettingsRowAlignProvider align="end"`) the control sits at the
 * end of the row instead; the DOM is the same two columns either way. Only the
 * default layout takes the Trax stacking rule: it is the fixed 420px label
 * column that squeezes the control beside the panel, and an "end" row's label
 * column is elastic, so it narrows on its own without the control losing room.
 */
export function SettingsRow({
  label,
  description,
  htmlFor,
  children,
  note,
  align,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  children?: ReactNode;
  /** A warning or consequence that belongs to this row, shown under it. */
  note?: ReactNode;
  /** Where the control sits. Defaults to the nearest `SettingsRowAlignProvider`, else "start". */
  align?: SettingsRowAlign;
  className?: string;
}) {
  const inherited = useContext(SettingsRowAlignContext);
  const end = (align ?? inherited) === "end";
  return (
    <div className={cn("px-5 py-4", className)}>
      <div
        className={
          end
            ? ROW_GRID_END
            : `flex flex-col gap-3 md:grid md:grid-cols-[minmax(0,420px)_minmax(0,1fr)] md:items-center md:gap-x-10 ${SETTINGS_ROW_STACKS_BESIDE_TRAX}`
        }
      >
        <div className={end ? ROW_LABEL_END : "min-w-0"}>
          {htmlFor ? (
            <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
              {label}
            </label>
          ) : (
            <p className="text-sm font-medium text-foreground">{label}</p>
          )}
          {description && (
            <div className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{description}</div>
          )}
        </div>
        {children && (
          <div className={end ? ROW_CONTROLS_END : "flex min-w-0 flex-wrap items-center justify-start gap-2"}>{children}</div>
        )}
      </div>
      {note && <div className="mt-1.5 text-[13px] leading-snug">{note}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tabs inside a page                                                          */
/* -------------------------------------------------------------------------- */

export interface SettingsTabItem {
  value: string;
  label: string;
}

/**
 * The strip: no track, pills side by side, wrapping onto a second line on a
 * narrow phone (a scrolling strip would clip each pill's focus ring).
 */
export const SETTINGS_TAB_LIST =
  "h-auto max-w-full flex-wrap justify-start gap-1 bg-transparent p-0 group-data-[orientation=horizontal]/tabs:h-auto";

/**
 * One pill. The selected one is the brand tint with brand text (lightened in
 * dark mode, where the deep brand colour is too dark to read); the others are
 * muted and take the v2 hover pair. Overrides the ui-v2 trigger's white
 * "raised" look, which is for segmented controls, not page tabs.
 */
export const SETTINGS_TAB_TRIGGER =
  "h-8 flex-none px-3 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))] data-[state=active]:bg-primary/10 data-[state=active]:text-primary dark:data-[state=active]:bg-primary/10 dark:data-[state=active]:text-[hsl(var(--v2-link,var(--primary)))]";

/**
 * Tabs that split one settings page. `value` and `onValueChange` belong to the
 * page, so it can keep the open tab in the URL. Put one `SettingsTabPanel` per
 * tab inside.
 */
export function SettingsTabs({
  label,
  tabs,
  value,
  onValueChange,
  children,
  className,
}: {
  /** Names the tab strip for screen readers ("General"). */
  label: string;
  tabs: readonly SettingsTabItem[];
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tabs value={value} onValueChange={onValueChange} className={cn("gap-4", className)}>
      <TabsList aria-label={label} className={SETTINGS_TAB_LIST}>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className={SETTINGS_TAB_TRIGGER}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {/* A fragment: Radix's children type comes from a second copy of the React types. */}
      <>{children}</>
    </Tabs>
  );
}

/**
 * One tab's content. Stays mounted while another tab is open (hidden, not
 * unmounted), so its unsaved edits and the save it registered with the page
 * survive a tab switch.
 */
export function SettingsTabPanel({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <TabsContent
      value={value}
      forceMount
      className={cn(
        "rounded-xl focus-visible:ring-3 focus-visible:ring-ring/30 data-[state=inactive]:hidden",
        className,
      )}
    >
      <>{children}</>
    </TabsContent>
  );
}

/** A labelled field for a small form laid out as a grid (e.g. a new promo code). */
export function SettingsField({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint && <div className="text-xs leading-snug text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** A unit or connecting word beside an input ("years", "hours before pickup"). */
export function Unit({ children }: { children: ReactNode }) {
  return <span className="text-sm text-muted-foreground">{children}</span>;
}

/**
 * An input and its unit, held together, so in "[2] days [4] hours" each unit
 * sits closer to its own box than to the next one. Put two or more groups in a
 * `UnitGroups`, which spaces them further apart than a box is from its unit.
 */
export function UnitGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1.5", className)}>{children}</span>;
}

/** Several `UnitGroup`s on one row ("[2] days  [4] hours"). */
export function UnitGroups({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>{children}</div>;
}
