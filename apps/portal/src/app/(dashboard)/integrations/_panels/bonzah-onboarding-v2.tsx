"use client";

// ── Bonzah application, inside the Integrations dialog ────────────────────────
//
// WHY THIS FILE EXISTS AT ALL.
//
// The Bonzah application wizard is v1's — `components/settings/bonzah-onboarding/`
// — and 56 other tenants reach it through `/settings?tab=insurance`. V2_PLAN §3
// says never edit an old screen in place, so not one byte of that directory is
// touched here. The first choice was to mount `<BonzahOnboardingForm />` inside
// the dialog unchanged. It does not compose, for four reasons that are all
// layout assumptions baked into v1's own files:
//
//   1. `step-nav.tsx`'s desktop stepper is `hidden lg:flex` over TEN steps, each
//      carrying `style={{ minWidth: '88px' }}` — an 880px floor. `lg:` is a
//      VIEWPORT breakpoint, so on any desktop screen it renders that 880px rail
//      into a dialog whose content box is ~600px. It does not wrap; it overflows.
//   2. The wizard's root is a `<Card>` with its own `CardHeader`/`CardTitle`
//      ("Bonzah Onboarding" + a ShieldCheck) — a second title and a second card
//      edge inside a dialog that already has `DialogTitle` and a card edge.
//   3. Its footer is `sticky bottom-0 … border-t px-6 py-4`, written against the
//      settings page's scroll container. Nested inside `DialogContent`'s own
//      `overflow-y-auto` with `p-8`, its `px-6` fights the dialog's padding and
//      the bar sticks to the wrong box.
//   4. Every step change calls `containerRef.current.scrollIntoView(...)`, and
//      `scrollIntoView` walks EVERY scrollable ancestor — including the document
//      — so advancing a step scrolls the page behind the modal.
//
// So this is a v2 SHELL, not a v2 copy. What it re-implements is chrome only:
// the header, the progress meter, the scroll box and the footer. Everything with
// business meaning is imported from v1 and runs unmodified —
//
//   • `schema.ts`           — the Zod schema, DEFAULT_VALUES, STEPS, stepFields.
//                             Validation is imported, never duplicated.
//   • `steps/*`             — all ten step bodies, which are pure
//                             `useFormContext()` consumers with no page
//                             assumptions beyond `md:grid-cols-2`.
//   • `use-bonzah-onboarding` — draft read/write, the submission insert, and the
//                             two fire-and-forget notifications that tell the
//                             Bonzah reviewer an application landed.
//
// That keeps one source of truth for what an application IS, and confines the v2
// work to how it looks. When Settings' insurance tab is retired for everyone,
// this file loses nothing.
//
// ⚠️ ISOLATION. RLS is off (V2_PLAN §5). `useBonzahOnboarding` scopes every read
// and write to `tenant.id` from TenantContext; the only query issued directly
// here is the storage `move` below, whose paths are prefixed with the tenant id
// this component was handed. Nothing here reads a row it did not key by tenant.

import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Check, Loader2, Send } from "lucide-react";

import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Json } from "@/integrations/supabase/types";

import { Button } from "@/components/ui-v2/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui-v2/alert-dialog";

// ── v1, imported and not copied ──────────────────────────────────────────────
import {
  bonzahOnboardingSchema,
  DEFAULT_VALUES,
  stepFields,
  type BonzahOnboardingFormData,
  type FileUrls,
} from "@/components/settings/bonzah-onboarding/schema";
import { Step1Business } from "@/components/settings/bonzah-onboarding/steps/step-1-business";
import { Step2Operations } from "@/components/settings/bonzah-onboarding/steps/step-2-operations";
import { Step3Contacts } from "@/components/settings/bonzah-onboarding/steps/step-3-contacts";
import { Step4Banking } from "@/components/settings/bonzah-onboarding/steps/step-4-banking";
import { Step5Insurance } from "@/components/settings/bonzah-onboarding/steps/step-5-insurance";
import { Step6Policies } from "@/components/settings/bonzah-onboarding/steps/step-6-policies";
import { Step7Underwriting } from "@/components/settings/bonzah-onboarding/steps/step-7-underwriting";
import { Step8Training } from "@/components/settings/bonzah-onboarding/steps/step-8-training";
import { Step9Quiz } from "@/components/settings/bonzah-onboarding/steps/step-9-quiz";
import { BonzahReviewV2, BonzahSignV2 } from "./bonzah-review-v2";
import { useBonzahOnboarding } from "@/hooks/use-bonzah-onboarding";
import { BonzahDateField } from "./bonzah-date-field";
import type { QuizGradeResult } from "@/hooks/use-bonzah-quiz";

/* ─────────────────────────────── shape ──────────────────────────────────── */

/**
 * The same localStorage key v1 writes.
 *
 * Deliberate: an operator who started the application on the Settings screen
 * before this board existed, or on another tab, finds their draft here rather
 * than an empty form. The DB draft (`bonzah_onboarding_drafts`, one row per
 * tenant) is the cross-device copy and wins; localStorage is the instant one.
 */
const DRAFT_KEY = (tenantId: string) => `bonzah_onboarding_draft_${tenantId}`;

/** Steps that are gated on something other than field validity. */
const TRAINING_STEP = 8;
const QUIZ_STEP = 9;

/**
 * The ten v1 steps, grouped into five slides (Ghulam, Oct 2 2026).
 *
 * Ten stops felt like a tax form; five reads as a short journey. The grouping
 * is presentation only — every step's fields, validation and draft keys are
 * v1's, untouched. A slide shows its steps one after another and the pager
 * splits it into parts that fit the dialog.
 *
 * The draft still stores a STEP (the slide's first one), so a draft written
 * here opens on the right step in v1's Settings screen and vice versa.
 */
const STAGES = [
  { title: "Your business", steps: [1, 2] },
  { title: "People & payment", steps: [3, 4] },
  { title: "Your cover", steps: [5, 6] },
  // "Risk & training" (steps 7–9: underwriting questions, the training video
  // and the quiz) was removed from the flow — Ghulam, Oct 2 2026: "just
  // remove that risk and training". Their fields are no longer asked for, and
  // submit no longer validates them or requires a passed quiz.
  { title: "Review & sign", steps: [10] },
] as const;

/** Steps the flow still asks for, for the final validation. */
const ASKED_STEPS = STAGES.flatMap((st) => st.steps as readonly number[]);
const REVIEW_STAGE = STAGES.length - 1;

const stageIndexOf = (step: number) => {
  const i = STAGES.findIndex((st) => (st.steps as readonly number[]).includes(step));
  // A draft saved on a removed step (7–9) resumes at Review.
  return i >= 0 ? i : step > 6 ? REVIEW_STAGE : 0;
};

/* ───────────────────────────── the grid ─────────────────────────────────── */

/**
 * ONE PATTERN for every screen of the application (Ghulam, Oct 2 2026):
 * a grid of 3 columns × 4 rows — twelve cells — and every field takes one
 * cell. A slide is cut into screens of twelve; there is no measuring, no
 * scrolling and no guessing. Rows are as tall as their fields and the block
 * is centred in the box, so every
 * screen has the same rhythm whatever its fields are.
 *
 * v1's step bodies are nested blocks (step › groups › two-column grids), and
 * they are v1's files, so the grid is built over the rendered DOM rather than
 * by editing them (V2_PLAN §3):
 *
 *   • A FIELD (an element holding at most one control — an input, a text area,
 *     a dropdown, a Yes/No group, an upload) becomes a grid cell.
 *   • Anything holding several fields is dissolved with `display: contents`
 *     and its children are classified the same way, so every field of the
 *     slide ends up a direct cell of one grid.
 *   • Two exceptions take more room: a quiz question spans the whole row (its
 *     answers read across it), and a training video or the signature pad takes
 *     a whole screen — neither can be read in a twelfth of one.
 *
 * Fields stay MOUNTED on every screen (paged-out cells are only hidden), so
 * react-hook-form keeps every value and error, and validation runs over the
 * whole slide.
 */

const COLS = 3;
const ROWS = 4;
/** Row gap bounds: generous where a screen has room, tight where it does not. */
const MAX_ROW_GAP = 44;
const MIN_ROW_GAP = 10;

const PG_ATTR = "data-pg-hidden";
/** Marks what v2 hides permanently, as opposed to what is paged out. */
const GONE_ATTR = "data-bz-gone";
const ITEM_ATTR = "data-bz-item";
const CONTENTS_ATTR = "data-bz-contents";

/** What counts as one field's control. Radios count once, as their group. */
const CONTROLS =
  'input:not([type="hidden"]):not([type="radio"]), textarea, button[role="combobox"], [role="radiogroup"]';

const GRID_CSS = `
.bz-grid [${GONE_ATTR}] { display: none !important; }
.bz-grid [data-bz-root] {
  display: grid !important; height: 100%;
  grid-template-columns: repeat(${COLS}, minmax(0, 1fr));
  /* Rows are as tall as their fields, with a modest gap, and the block sits
     in the vertical centre of the box — not stretched to fill it, which left
     wide empty bands between rows (Ghulam, Oct 2). */
  grid-template-rows: repeat(${ROWS}, auto);
  align-content: center;
  row-gap: var(--bz-row-gap, 31px); column-gap: 1.25rem; margin: 0 !important;
}
.bz-grid [${CONTENTS_ATTR}] { display: contents !important; }
.bz-grid [${ITEM_ATTR}] {
  display: flex !important; flex-direction: column; gap: .375rem;
  min-width: 0; min-height: 0; overflow: hidden; margin: 0 !important;
  padding: 2px; /* focus rings stay inside the clipped cell */
}
/* Controls line up along a row whatever their labels do: a cell's content
   sits at its BOTTOM, so a question that wraps to two lines lifts its own
   label rather than pushing its Yes / No below the inputs beside it
   (Ghulam, Oct 2). Spanning items (quiz, review, video) and group headers
   keep their own layout. */
.bz-grid div[${ITEM_ATTR}]:not([data-bz-span]):not([data-bz-header]):not(.flex-row):not(:has(> div:first-child > svg:only-child)) { justify-content: flex-end; }
/* Nothing in a cell shrinks — a label is never squashed into its box. */
.bz-grid [${ITEM_ATTR}] > * { flex-shrink: 0; }
.bz-grid [${ITEM_ATTR}][${PG_ATTR}] { display: none !important; }
.bz-grid [${ITEM_ATTR}] > * { margin-top: 0 !important; }
.bz-grid [${ITEM_ATTR}][data-bz-span="row"] { grid-column: 1 / -1; }
.bz-grid [${ITEM_ATTR}][data-bz-span="wide"] { grid-column: 1 / -1; grid-row: span 2; }
.bz-grid [${ITEM_ATTR}][data-bz-span="tall"] { grid-row: 1 / -1; }
.bz-grid [${ITEM_ATTR}][data-bz-span="screen"] { grid-column: 1 / -1; grid-row: 1 / -1; }

/* Labels: one size, at most two lines; the full text is in the title. */
.bz-grid [${ITEM_ATTR}] > label:first-child,
.bz-grid [${ITEM_ATTR}] > :first-child > label:first-child {
  font-size: .75rem !important; line-height: 1.25 !important; padding-left: .125rem;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.bz-grid [id$="-form-item-message"] { font-size: .75rem !important; line-height: 1.3 !important; }

/* THE FIELD SKIN (Ghulam, Oct 2: "the input fields look very bad").
   One shape for every control — input, select, date, text area: 44px tall,
   softly rounded (not a pill), a hairline border on the card colour, a lift
   to the accent on hover and focus. Labels are quiet; the required mark is
   the accent, not an alarm red. Scoped to .bz-grid, so v1's own Bonzah
   screen in Settings is untouched. */
.bz-grid input:not([type="checkbox"]):not([type="radio"]):not([type="file"]),
.bz-grid button[role="combobox"],
.bz-grid [data-bz-date] > button,
.bz-grid textarea {
  height: 2.75rem !important; min-height: 2.75rem !important; flex: 0 0 auto !important;
  font-size: .875rem !important; line-height: 1.25rem !important;
  border-radius: .875rem !important; border: 1px solid hsl(var(--foreground) / .16) !important;
  background: hsl(var(--card)) !important; box-shadow: 0 1px 2px hsl(var(--foreground) / .06) !important;
  padding-left: .875rem !important; padding-right: .875rem !important;
  transition: border-color .2s ease-out, box-shadow .2s ease-out !important;
}
.bz-grid textarea { padding-top: .6875rem !important; padding-bottom: .6875rem !important; resize: none; overflow: hidden; white-space: nowrap; }
.bz-grid input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):hover,
.bz-grid button[role="combobox"]:hover,
.bz-grid [data-bz-date] > button:hover,
.bz-grid textarea:hover { border-color: hsl(var(--primary) / .5) !important; }
.bz-grid input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):focus-visible,
.bz-grid button[role="combobox"]:focus-visible,
.bz-grid button[role="combobox"][data-state="open"],
.bz-grid [data-bz-date] > button:focus-visible,
.bz-grid textarea:focus-visible {
  outline: none !important; border-color: hsl(var(--primary) / .55) !important;
  box-shadow: 0 0 0 3px hsl(var(--primary) / .12) !important;
}
.bz-grid input::placeholder, .bz-grid textarea::placeholder { color: hsl(var(--muted-foreground) / .85) !important; }
.bz-grid button[role="combobox"] > span[data-placeholder], .bz-grid button[role="combobox"][data-placeholder] { color: hsl(var(--muted-foreground) / .85) !important; }
.bz-grid input[aria-invalid="true"], .bz-grid textarea[aria-invalid="true"], .bz-grid button[role="combobox"][aria-invalid="true"] {
  border-color: hsl(var(--destructive) / .5) !important;
}
/* Labels: small, medium weight, muted — the field carries the eye. */
.bz-grid [${ITEM_ATTR}] label { font-weight: 500 !important; color: hsl(var(--foreground) / .78) !important; letter-spacing: .005em; }
.bz-grid [${ITEM_ATTR}] label .text-destructive { color: hsl(var(--primary)) !important; opacity: .75; margin-left: .0625rem; }
.dark .bz-grid [${ITEM_ATTR}] label .text-destructive { color: hsl(var(--v2-link, var(--primary))) !important; }
/* A tick-box item keeps its box beside its text, as v1 draws it. */
.bz-grid [${ITEM_ATTR}].flex-row,
.bz-grid label[${ITEM_ATTR}] { flex-direction: row !important; align-items: flex-start; gap: .75rem !important; }
/* A lone button (Add Another Driver) is a normal one-line button, sitting on
   the same line as the inputs around it. */
.bz-grid button[${ITEM_ATTR}] { flex-direction: row !important; align-items: center; justify-content: center; gap: .5rem; height: 2.25rem; align-self: end; }
/* A group header (an additional driver): title left, action right, a hairline
   under it — the row that opens the driver's fields. */
.bz-grid [${ITEM_ATTR}][data-bz-header] {
  flex-direction: row !important; align-items: center; justify-content: space-between;
  padding: 0 0 .375rem !important; border-bottom: 1px solid hsl(var(--border));
}
.bz-grid [${ITEM_ATTR}][data-bz-header] h4 { font-size: .875rem !important; }
.bz-grid [${ITEM_ATTR}][data-bz-header] button { height: 1.75rem !important; }
/* Review summary cards: tighter lines so a card fits its two rows. */
.bz-grid [${ITEM_ATTR}] .border-b.py-2 { padding-top: .1875rem !important; padding-bottom: .1875rem !important; }
.bz-grid [${ITEM_ATTR}].p-4 { padding: .625rem .875rem !important; }
.bz-grid [${ITEM_ATTR}] h4.mb-2 { margin-bottom: .25rem !important; }
.bz-grid [${ITEM_ATTR}] .border-b.py-2 > span { font-size: .8125rem !important; line-height: 1.2 !important; }
/* A note led by an icon (the banking note's lock) keeps the icon beside its
   text instead of on a line of its own. */
.bz-grid [${ITEM_ATTR}]:has(> div:first-child > svg:only-child) { flex-direction: row !important; align-items: center; gap: .75rem !important; }
.bz-grid [role="radiogroup"] { display: flex !important; flex-wrap: wrap; gap: .5rem !important; }
/* Yes / No: the same 44px shape as a field, the chosen one in the accent. */
.bz-grid [role="radiogroup"] > label {
  height: 2.75rem; min-width: 6rem; padding: 0 1rem !important; display: inline-flex !important; align-items: center; gap: .5rem;
  border-radius: .875rem !important; border: 1px solid hsl(var(--foreground) / .16) !important; background: hsl(var(--card)) !important;
  box-shadow: 0 1px 2px hsl(var(--foreground) / .06);
  font-size: .875rem !important; color: hsl(var(--foreground)) !important; font-weight: 500 !important; cursor: pointer;
  transition: border-color .2s ease-out, background-color .2s ease-out !important;
}
.bz-grid [role="radiogroup"] > label:hover { border-color: hsl(var(--primary) / .5) !important; }
.bz-grid [role="radiogroup"] > label:has([data-state="checked"]) {
  border-color: hsl(var(--primary) / .55) !important; background: hsl(var(--primary) / .07) !important;
  color: hsl(var(--primary)) !important;
}
.dark .bz-grid [role="radiogroup"] > label:has([data-state="checked"]) { color: hsl(var(--v2-link, var(--primary))) !important; }
/* Quiz answers read across their row instead of stacking. */
.bz-grid [data-bz-span="wide"] [role="radiogroup"] > * { flex: 1 1 0; min-width: 9rem; margin: 0 !important; }

/* Uploads: one slim bar the height of an input. */
.bz-grid div.border-dashed.cursor-pointer {
  flex-direction: row !important; justify-content: flex-start !important; gap: .625rem !important; padding: 0 .875rem !important;
  height: 2.75rem; min-height: 2.75rem; border-radius: .875rem !important; border: 1.5px dashed hsl(var(--foreground) / .2) !important;
  background: hsl(var(--card)) !important; transition: border-color .2s ease-out, background-color .2s ease-out;
}
.bz-grid div.border-dashed.cursor-pointer:hover { border-color: hsl(var(--primary) / .45) !important; background: hsl(var(--primary) / .04) !important; }
.bz-grid div.border-dashed.cursor-pointer svg { color: hsl(var(--primary)) !important; }
.bz-grid div.border-dashed.cursor-pointer > div:first-child { height: 1.5rem !important; width: 1.5rem !important; flex-shrink: 0; }
.bz-grid div.border-dashed.cursor-pointer > .text-center { min-width: 0; text-align: left !important; }
.bz-grid div.border-dashed.cursor-pointer > .text-center > p { margin: 0 !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: .875rem !important; font-weight: 400 !important; color: hsl(var(--muted-foreground)) !important; }
.bz-grid div.border-dashed.cursor-pointer > .text-center > p + p { display: none; }

/* A whole-screen item (training video): the frame fits the box. */
.bz-grid [data-bz-span="screen"] div:has(> iframe) { width: min(100%, calc((94vh - 20rem) * 16 / 9)) !important; margin-inline: auto; }

@media (max-width: 767px) {
  .bz-grid [data-bz-root] { grid-template-columns: minmax(0, 1fr); }
}
`;

/**
 * Hide/show a cell. Sets the real `hidden` attribute as well as the marker, so
 * Tailwind's `space-y` margins never count a paged-out cell.
 */
const pgHide = (el: Element) => {
  el.setAttribute(PG_ATTR, "");
  el.setAttribute("hidden", "");
};
const pgShow = (el: Element) => {
  if (!el.hasAttribute(PG_ATTR)) return;
  el.removeAttribute(PG_ATTR);
  // Never un-hide something v2 removed for good.
  if (!el.hasAttribute(GONE_ATTR)) el.removeAttribute("hidden");
};

const goneForGood = (el: Element) => {
  el.setAttribute(GONE_ATTR, "");
  el.setAttribute("hidden", "");
};

/**
 * Turns v1's rendered step into twelve-cell screens and pages through them.
 * Re-runs when the slide changes or its DOM does (a driver added, an error
 * message appearing, the quiz graded), keeping the operator on the screen
 * they were looking at.
 */
function useGridPager(
  contentRef: RefObject<HTMLDivElement | null>,
  stepKey: number,
  /** Runs on the step's DOM before every layout — the wizard's own fix-ups. */
  prepare?: (content: HTMLElement) => void,
) {
  const [part, setPart] = useState(0);
  const [partCount, setPartCount] = useState(1);
  const [tick, setTick] = useState(0);
  const unitsRef = useRef<{ el: Element; part: number }[]>([]);
  const partRef = useRef(0);
  partRef.current = part;
  const prepareRef = useRef(prepare);
  prepareRef.current = prepare;
  /** Set by "Back" from a slide's first screen: land on the previous slide's last. */
  const enterAtEndRef = useRef(false);
  const lastStepRef = useRef(stepKey);

  const apply = useCallback((p: number) => {
    for (const { el, part: up } of unitsRef.current) {
      if (up === p) pgShow(el);
      else pgHide(el);
    }

    // Row gap, per screen: as roomy as MAX_ROW_GAP when the screen has the
    // space, and only as tight as it must be when its labels wrap to two
    // lines — so a generous gap can never push a row out of the box.
    const slide = contentRef.current?.firstElementChild as HTMLElement | null;
    if (!slide) return;
    slide.style.setProperty("--bz-row-gap", "0px");
    const shown = unitsRef.current
      .filter((u) => u.part === p && u.el.getClientRects().length > 0)
      .map((u) => u.el.getBoundingClientRect());
    if (shown.length === 0) return;
    const rows = new Set(shown.map((r) => Math.round(r.top))).size;
    const content = Math.max(...shown.map((r) => r.bottom)) - Math.min(...shown.map((r) => r.top));
    const room = slide.clientHeight - content - 16;
    const gap = rows > 1 ? Math.max(MIN_ROW_GAP, Math.min(MAX_ROW_GAP, room / (rows - 1))) : MAX_ROW_GAP;
    slide.style.setProperty("--bz-row-gap", `${Math.floor(gap)}px`);
  }, [contentRef]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    const slide = content?.firstElementChild;
    if (!content || !slide) return;

    const stepChanged = lastStepRef.current !== stepKey;
    lastStepRef.current = stepKey;
    const anchor = stepChanged
      ? null
      : unitsRef.current.find((u) => u.part === partRef.current && u.el.isConnected)?.el ?? null;

    prepareRef.current?.(content);

    // v1's section titles (icon tile + heading + description + rule) are not
    // shown in v2 — the stage row says where the operator is.
    content.querySelectorAll("div.border-b:has(> div > h3)").forEach(goneForGood);

    // Helper text: into the placeholder for a text field; into the label's
    // tooltip for anything else. Either way the line is gone from the cell.
    content.querySelectorAll('[id$="-form-item-description"]').forEach((d) => {
      const text = d.textContent?.trim();
      if (!text) return;
      const sel = `[aria-describedby~="${CSS.escape(d.id)}"]`;
      const ctl = content.querySelector<HTMLInputElement | HTMLTextAreaElement>(`input${sel}, textarea${sel}`);
      const typed = ctl && !(ctl instanceof HTMLInputElement && ["checkbox", "radio", "file", "date"].includes(ctl.type));
      if (typed && ctl.placeholder !== text) ctl.placeholder = text;
      const label = d.parentElement?.querySelector("label");
      if (label && !label.title) label.title = `${label.textContent?.trim() ?? ""} — ${text}`;
      goneForGood(d);
    });

    // Every label carries its full text as a tooltip (labels clamp to 2 lines).
    content.querySelectorAll("label").forEach((l) => {
      if (!l.title) l.title = l.textContent?.trim() ?? "";
    });

    // ── classify: fields become cells, everything holding several fields
    // dissolves into the grid.
    content.querySelectorAll(`[${ITEM_ATTR}], [${CONTENTS_ATTR}], [data-bz-root]`).forEach((el) => {
      el.removeAttribute(ITEM_ATTR);
      el.removeAttribute(CONTENTS_ATTR);
      el.removeAttribute("data-bz-root");
      el.removeAttribute("data-bz-span");
      el.removeAttribute("data-bz-header");
    });
    content.querySelectorAll(`[${PG_ATTR}]`).forEach(pgShow);
    slide.setAttribute("data-bz-root", "");

    type Span = "cell" | "row" | "wide" | "tall" | "screen";
    const items: { el: Element; span: Span }[] = [];
    const walk = (parent: Element) => {
      for (const el of Array.from(parent.children)) {
        if (el.hasAttribute(GONE_ATTR) || el.tagName === "STYLE") continue;
        const controls = el.querySelectorAll(CONTROLS).length;
        const media = el.querySelectorAll("iframe, canvas").length;
        const text = el.textContent?.trim() ?? "";
        if (controls === 0 && media === 0 && !text) {
          goneForGood(el); // an empty wrapper would still take a cell
          continue;
        }
        // How much of the grid an item takes:
        //   cell   one of the twelve — every ordinary field
        //   row    a full row — a tick-box declaration, a long note
        //   wide   a full row, two rows tall — a quiz question (answers
        //          across), a review summary card
        //   tall   one column, all four rows — a review summary card
        //   screen the whole grid — a training video, the signature pad
        let span: Span | null = null;
        if (media === 1 && controls <= 1) span = "screen";
        else if (media > 1 || controls >= 2) span = null;
        else if (controls === 1) {
          const radios = el.querySelectorAll('[role="radiogroup"] [role="radio"]').length;
          const tick = !!el.querySelector('input[type="checkbox"], button[role="checkbox"]');
          if (radios > 2) span = "wide";
          else if (tick && text.length > 40) span = "row";
          else span = "cell";
        } else {
          // No control: text. A short note is a cell, a long one a row, and a
          // card of several label/value lines (the review summary) is wide.
          const lines = el.querySelectorAll("p, dt, dd, li, span.text-sm, div.flex").length;
          // Several substantial blocks side by side (the four review summary
          // cards in one v1 grid) are not one item — each card is.
          // A "card" is anything with three or more lines of its own — counted
          // by structure, not text, since an empty form's cards are all dashes.
          const cards = Array.from(el.children).filter((c) => c.children.length >= 3);
          // A group's header — a heading plus its own action, like an
          // additional driver's "Additional Driver — 1 · Remove" — is a full
          // row that opens the group, so its fields read as belonging to it.
          if (el.querySelector("h4") && el.querySelector("button") && el.children.length <= 3) {
            span = "row";
            el.setAttribute("data-bz-header", "");
          } else if (el.children.length >= 2 && cards.length === el.children.length) span = null;
          // A card on its own (a review summary) is a column: one wide, the
          // full four rows tall, so three sit side by side.
          else if (el.children.length >= 3) span = "tall";
          else if (text.length <= 60) span = "cell";
          else if (lines >= 4) span = "wide";
          else span = "row";
        }
        if (span === null) {
          el.setAttribute(CONTENTS_ATTR, "");
          walk(el);
        } else {
          el.setAttribute(ITEM_ATTR, "");
          if (span !== "cell") el.setAttribute("data-bz-span", span);
          items.push({ el, span });
        }
      }
    };
    walk(slide);

    // ── assign cells to screens of COLS × ROWS, in reading order.
    // Fixed, not read back from the grid: the computed track list includes
    // implicit columns, so it would count a fourth that tall cards created.
    const cols = window.matchMedia("(max-width: 767px)").matches ? 1 : COLS;
    const assigned: { el: Element; part: number }[] = [];
    let p = 0;
    let row = 0;
    let col = 0;
    const nextRow = () => {
      col = 0;
      row += 1;
      if (row >= ROWS) {
        row = 0;
        p += 1;
      }
    };
    let inTall = false;
    for (const { el, span } of items) {
      // Tall cards share a screen only with each other, side by side.
      if (span === "tall") {
        if (!inTall && (row > 0 || col > 0)) {
          p += 1;
          row = 0;
          col = 0;
        }
        inTall = true;
        assigned.push({ el, part: p });
        col += 1;
        if (col >= cols) {
          p += 1;
          col = 0;
        }
        continue;
      }
      if (inTall) {
        inTall = false;
        if (col > 0) {
          p += 1;
          col = 0;
          row = 0;
        }
      }
      if (span === "wide") {
        // Starts a row, needs two rows left on this screen.
        if (col > 0) nextRow();
        if (row > ROWS - 2) {
          p += 1;
          row = 0;
        }
        assigned.push({ el, part: p });
        nextRow();
        nextRow();
        continue;
      }
      if (span === "screen") {
        if (row > 0 || col > 0) {
          p += 1;
          row = 0;
          col = 0;
        }
        assigned.push({ el, part: p });
        p += 1;
        continue;
      }
      const width = span === "row" ? cols : 1;
      if (col + width > cols) nextRow();
      assigned.push({ el, part: p });
      col += width;
      if (col >= cols) nextRow();
    }
    const count = Math.max(1, row === 0 && col === 0 ? p : p + 1);

    unitsRef.current = assigned;

    let next = 0;
    if (stepChanged && enterAtEndRef.current) next = count - 1;
    else if (anchor) next = assigned.find((u) => u.el === anchor)?.part ?? Math.min(partRef.current, count - 1);
    else if (!stepChanged) next = Math.min(partRef.current, count - 1);
    enterAtEndRef.current = false;

    apply(next);
    setPartCount(count);
    setPart(next);
    partRef.current = next;
  }, [stepKey, tick, contentRef, apply]);

  useLayoutEffect(() => {
    apply(part);
  }, [part, apply]);

  // Re-lay out when the step's own DOM changes. Attribute changes are not
  // observed, so hiding cells never re-triggers a layout.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    let frame = 0;
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTick((t) => t + 1));
    });
    mo.observe(content, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
    };
  }, [contentRef]);

  /** The screen holding the first invalid field, once the form has marked it. */
  const partOfFirstError = useCallback((): number | null => {
    const bad = contentRef.current?.querySelector('[aria-invalid="true"]');
    if (!bad) return null;
    const hit = unitsRef.current.find((u) => u.el === bad || u.el.contains(bad));
    return hit ? hit.part : null;
  }, [contentRef]);

  return {
    part,
    partCount,
    setPart,
    partOfFirstError,
    enterAtEnd: () => {
      enterAtEndRef.current = true;
    },
  };
}

type Props = {
  /** The tenant this application belongs to. Used for storage paths. */
  tenantId: string;
  /** northwind walks the wizard unvalidated while it is being built. */
  skipValidation?: boolean;
  /** Leave the wizard and return to the panel's stage view. */
  onExit: () => void;
  /** Called after a submission row lands, so the panel can re-read its stage. */
  onSubmitted: () => void | Promise<void>;
};

/* ──────────────────────────────── shell ─────────────────────────────────── */

export default function BonzahOnboardingV2({ tenantId, skipValidation = false, onExit, onSubmitted }: Props) {
  const { fetchDraft, saveDraft, deleteDraft, submit } = useBonzahOnboarding();

  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [fileUrls, setFileUrls] = useState<FileUrls>({});
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [trainingAcknowledged, setTrainingAcknowledged] = useState(false);
  const [quizResult, setQuizResult] = useState<QuizGradeResult | null>(null);
  /** Review & sign has two screens of its own: 0 = check, 1 = sign. */
  const [reviewPart, setReviewPart] = useState<0 | 1>(0);

  /**
   * The wizard owns a fixed-height box between its header and footer, and the
   * slide inside it is laid out as 3 × 4 screens (see `useGridPager`). Nothing
   * in here scrolls — not the box, not the dialog, not the page behind it.
   */
  const contentRef = useRef<HTMLDivElement | null>(null);
  const stageIdx = stageIndexOf(currentStep);
  const stage = STAGES[stageIdx];
  /**
   * Native date inputs → the app's own date field (Ghulam, Oct 2).
   *
   * Each `<input type="date">` in v1's steps gets a host element slotted in
   * right after it, and the native box is hidden for good. `BonzahDateField`
   * is portalled into the host and reads/writes the SAME form value by the
   * input's `name`, so drafts, validation and submission see no difference.
   * Found again on every pack, so a newly added driver's date of birth is
   * picked up too; hosts whose step has unmounted simply drop out.
   */
  const [dateHosts, setDateHosts] = useState<{ name: string; el: HTMLElement; cls: string }[]>([]);
  const prepareDates = useCallback((content: HTMLElement) => {
    const found: { name: string; el: HTMLElement; cls: string }[] = [];
    content.querySelectorAll<HTMLInputElement>('input[type="date"][name]').forEach((input) => {
      let host = input.nextElementSibling as HTMLElement | null;
      if (!host || !host.hasAttribute("data-bz-date")) {
        host = document.createElement("div");
        host.setAttribute("data-bz-date", "");
        input.insertAdjacentElement("afterend", host);
      }
      if (!input.hasAttribute(GONE_ATTR)) {
        input.setAttribute(GONE_ATTR, "");
        input.setAttribute("hidden", "");
      }
      found.push({ name: input.name, el: host, cls: input.className });
    });
    setDateHosts((prev) =>
      prev.length === found.length && prev.every((h, i) => h.el === found[i].el && h.name === found[i].name)
        ? prev
        : found,
    );
  }, []);

  const pager = useGridPager(contentRef, stageIdx, prepareDates);

  const form = useForm<BonzahOnboardingFormData>({
    resolver: zodResolver(bonzahOnboardingSchema),
    defaultValues: DEFAULT_VALUES as BonzahOnboardingFormData,
    mode: "onTouched",
  });

  const draftKey = DRAFT_KEY(tenantId);
  // Gate saving until the initial load resolves, so the empty default form does
  // not overwrite a stored draft before it has been hydrated. (v1's rule; the
  // bug it prevents is silent and total.)
  const draftLoadedRef = useRef(false);

  const applyDraft = (parsed: {
    values?: BonzahOnboardingFormData;
    step?: number;
    completed?: number[];
    fileUrls?: FileUrls;
  }) => {
    if (parsed?.values) form.reset(parsed.values);
    if (typeof parsed?.step === "number") setCurrentStep(parsed.step);
    if (parsed?.completed) setCompletedSteps(new Set(parsed.completed));
    if (parsed?.fileUrls) setFileUrls(parsed.fileUrls);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let hydrated = false;
      try {
        const dbDraft = await fetchDraft();
        if (!cancelled && dbDraft) {
          applyDraft(dbDraft);
          hydrated = true;
        }
      } catch {
        // fall through to localStorage
      }
      if (!cancelled && !hydrated) {
        try {
          const raw = localStorage.getItem(draftKey);
          if (raw) applyDraft(JSON.parse(raw));
        } catch {
          // ignore corrupt drafts
        }
      }
      if (!cancelled) draftLoadedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  const watched = form.watch();
  useEffect(() => {
    if (!draftLoadedRef.current) return;
    const snapshot = {
      values: watched,
      step: currentStep,
      completed: Array.from(completedSteps),
      fileUrls,
    };
    const handle = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify(snapshot));
      } catch {
        // ignore quota errors
      }
      void saveDraft(snapshot as never).catch(() => {
        // best-effort; localStorage still holds the draft
      });
    }, 600);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watched, currentStep, completedSteps, fileUrls, draftKey]);

  const currentStepRef = useRef(currentStep);
  currentStepRef.current = currentStep;

  const furthest = useMemo(
    () => Math.max(currentStep, ...(completedSteps.size ? Array.from(completedSteps) : [1])),
    [currentStep, completedSteps],
  );

  const goToStep = (step: number) => {
    // The pager lands on part one of the new slide (or its last part, when
    // arriving via Back) on its own; it resets whenever the slide changes.
    setCurrentStep(step);
  };
  const goToStage = (i: number) => {
    setReviewPart(0);
    goToStep(STAGES[i].steps[0]);
  };
  const onReview = stageIdx === REVIEW_STAGE;

  const lastPart = onReview ? reviewPart === 1 : pager.part >= pager.partCount - 1;

  const goForward = async () => {
    if (onReview) {
      if (reviewPart === 0) setReviewPart(1);
      return;
    }
    if (!lastPart) {
      pager.setPart(pager.part + 1);
      return;
    }
    const step = currentStep;
    await handleNext();
    // Still on the same slide means validation stopped it. Bring the operator
    // to the part holding the first highlighted field — it may be hidden.
    requestAnimationFrame(() => {
      if (stageIndexOf(step) !== stageIndexOf(currentStepRef.current)) return;
      const target = pager.partOfFirstError();
      if (target !== null) pager.setPart(target);
    });
  };

  const goBack = () => {
    if (onReview && reviewPart === 1) {
      setReviewPart(0);
      return;
    }
    if (!onReview && pager.part > 0) {
      pager.setPart(pager.part - 1);
      return;
    }
    if (stageIdx > 0) {
      pager.enterAtEnd();
      goToStage(stageIdx - 1);
    }
  };

  const handleNext = async () => {
    const steps = stage.steps as readonly number[];
    if (skipValidation) {
      if (stageIdx < STAGES.length - 1) goToStage(stageIdx + 1);
      return;
    }
    if (steps.includes(TRAINING_STEP) && !trainingAcknowledged) {
      toast({
        title: "Please confirm the training",
        description: "Tick the box to confirm you have watched the training.",
        variant: "destructive",
      });
      return;
    }
    if (steps.includes(QUIZ_STEP) && !quizResult?.passed) {
      toast({
        title: "Pass the quiz to continue",
        description: 'Answer the questions and click "Check answers" to pass.',
        variant: "destructive",
      });
      return;
    }

    const fieldsForStage = steps.flatMap((id) => stepFields[id] ?? []);
    const valid = await form.trigger(fieldsForStage as never);
    if (!valid) {
      toast({
        title: "Please fix the highlighted fields",
        description: "Some required information is missing or invalid.",
        variant: "destructive",
      });
      return;
    }
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      steps.forEach((id) => next.add(id));
      return next;
    });
    if (stageIdx < STAGES.length - 1) goToStage(stageIdx + 1);
  };

  /**
   * Files are uploaded to `<tenant>/draft/…` before a submission row exists, so
   * once it does they are moved under its id. Identical to v1's: the path is
   * prefixed with the tenant id, which is what keeps one operator's uploads out
   * of another's folder.
   */
  const moveDraftFiles = async (submissionId: string): Promise<FileUrls> => {
    const updated: FileUrls = {};
    for (const [field, files] of Object.entries(fileUrls)) {
      if (!files) continue;
      const moved = [];
      for (const file of files) {
        const newPath = file.path.replace(`${tenantId}/draft/`, `${tenantId}/${submissionId}/`);
        if (newPath !== file.path) {
          const { error } = await supabase.storage
            .from("bonzah-onboarding-files")
            .move(file.path, newPath);
          if (!error) {
            const { data: signed } = await supabase.storage
              .from("bonzah-onboarding-files")
              .createSignedUrl(newPath, 60 * 60 * 24 * 30);
            moved.push({ ...file, path: newPath, url: signed?.signedUrl ?? file.url });
            continue;
          }
        }
        moved.push(file);
      }
      updated[field as keyof FileUrls] = moved;
    }
    return updated;
  };

  const handleFinalSubmit = async () => {
    setShowSubmitConfirm(false);
    const asked = ASKED_STEPS.flatMap((id) => stepFields[id] ?? []);
    const valid = await form.trigger(asked as never);
    if (!valid) {
      toast({
        title: "Please complete the form",
        description: "Some required fields are missing on earlier steps.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const values = form.getValues();
      const row = await submit.mutateAsync({ data: values, fileUrls, quizResult });
      const movedFiles = await moveDraftFiles(row.id);
      if (Object.keys(movedFiles).length > 0) {
        await supabase
          .from("bonzah_onboarding_submissions")
          .update({ file_urls: movedFiles as unknown as Json })
          .eq("id", row.id)
          .eq("tenant_id", tenantId); // ← isolation: RLS is off on this table
      }
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // ignore
      }
      await deleteDraft().catch(() => {});

      toast({
        title: "Application sent",
        description:
          "Bonzah has your application. They review it and set your account up from their side — you will see the status here.",
      });
      // The panel re-reads its stage and lands on "In review", which is the
      // submission status. Nothing navigates; the dialog stays open.
      await onSubmitted();
    } catch (err: unknown) {
      toast({
        title: "Could not submit",
        description:
          (err as { message?: string })?.message || "Could not submit. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLast = stageIdx === STAGES.length - 1 && lastPart;

  return (
    // A FIXED height, not a max: the pager packs parts against this box, so it
    // has to know its size before the content decides it. 8rem is the
    // dialog's own logo row and padding around the wizard (94vh dialog).
    <div className="flex h-[calc(94vh_-_8rem)] min-h-[20rem] flex-col">
      {/* ── header ──────────────────────────────────────────────────────────
          Fixed above the scroll box, so the operator always knows where they
          are in a ten-step form without scrolling back up. */}
      {/* Only the meter: the step's own section heading below says where the
          operator is, so a second title above it was noise (Ghulam, Oct 2).
          Answers save as they go; Back on the first part leaves the wizard. */}
      <div className="shrink-0 pb-4">
        {/* Five stages, each a small picture with its name under it. Done
            stages carry a tick; upcoming ones are faded until reached. */}
        <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${STAGES.length}, minmax(0, 1fr))` }} aria-label="Application progress">
          {STAGES.map((st, i) => {
            const done = (st.steps as readonly number[]).every((id) => completedSteps.has(id));
            const active = i === stageIdx;
            const reachable = done || st.steps[0] <= furthest;
            // How full this tile is: the current slide fills screen by screen
            // as the operator moves through its parts; finished slides stay
            // full; upcoming ones are empty.
            const fill = active
              ? onReview
                ? (reviewPart + 1) / 2
                : (pager.part + 1) / Math.max(1, pager.partCount)
              : done
                ? 1
                : 0;
            return (
              <li key={st.title} className="min-w-0">
                <button
                  type="button"
                  aria-label={`Stage ${i + 1}: ${st.title}`}
                  aria-current={active ? "step" : undefined}
                  disabled={!reachable || isSubmitting}
                  onClick={() => reachable && goToStage(i)}
                  className={cn(
                    "group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl px-2 py-2.5 transition-[background-color,opacity] duration-200 ease-out focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none",
                    active ? "bg-primary/[0.05]" : reachable ? "hover:bg-muted/60" : "cursor-default",
                    !active && !done && "opacity-45",
                  )}
                >
                  {/* The fill: solid accent, growing left to right.
                      The tile's content is drawn twice — normal underneath,
                      and on-accent (white text) on top — and both the fill and
                      the top copy are revealed by the SAME clip, so the label
                      turns white exactly where the accent has reached it and
                      stays readable at every point of the animation. Slower
                      than the 200ms standard on purpose: it is progress being
                      made, not a panel appearing. */}
                  {(() => {
                    const clip = { clipPath: `inset(0 ${(1 - fill) * 100}% 0 0)` };
                    const reveal =
                      "transition-[clip-path] duration-500 ease-out motion-reduce:transition-none";
                    // Name only — no picture, no tick (Ghulam, Oct 2). A
                    // finished slide reads as finished by being full.
                    const content = (onAccent: boolean) => (
                      <span
                        className={cn(
                          "relative min-w-0 truncate text-sm",
                          onAccent
                            ? "font-semibold text-primary-foreground"
                            : active
                              ? "font-semibold text-foreground"
                              : "font-medium text-muted-foreground",
                        )}
                      >
                        {st.title}
                      </span>
                    );
                    return (
                      <>
                        {content(false)}
                        <span
                          aria-hidden
                          className={cn("absolute inset-0 flex items-center justify-center gap-2 rounded-xl bg-primary px-2", reveal)}
                          style={clip}
                        >
                          {content(true)}
                        </span>
                      </>
                    );
                  })()}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* ── the step itself ─────────────────────────────────────────────────
          `no-scrollbar` keeps the bar off the dialog (the theme rule is at
          styles/v2-theme.css); the box still scrolls by wheel, trackpad,
          keyboard and the focus ring moving through the fields. */}
      <FormProvider {...form}>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (isLast) setShowSubmitConfirm(true);
            else void goForward();
          }}
        >
          <div
            // `[&_div.border-b:has(>div>h3)]`: v1's SectionTitle (icon tile +
            // heading + description + rule). The stage row above already says
            // where the operator is, so v2 shows no section headings and no
            // icons (Ghulam, Oct 2). section-title.tsx is v1's, so it is hidden
            // from here rather than edited.
            className="min-h-0 flex-1 overflow-hidden [&_[data-pg-hidden]]:!hidden [&_div.border-b:has(>div>h3)]:hidden"
          >
            {/* `px-0.5` keeps focus rings off the clipped edge. */}
            <style>{GRID_CSS}</style>
            {dateHosts.map((h) => {
              const name = h.name as never;
              const error = form.getFieldState(name, form.formState).error;
              return createPortal(
                <BonzahDateField
                  value={(form.getValues(name) as string | undefined) ?? ""}
                  invalid={!!error}
                  triggerClassName={h.cls}
                  onChange={(v) =>
                    form.setValue(name, v as never, {
                      shouldDirty: true,
                      shouldTouch: true,
                      // Re-check only a field already showing an error, so it
                      // clears the moment a date is picked.
                      shouldValidate: !!error,
                    })
                  }
                />,
                h.el,
                h.name,
              );
            })}
            {onReview && (
              <div key={reviewPart} className="h-full duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none">
                {reviewPart === 0 ? <BonzahReviewV2 fileUrls={fileUrls} onEdit={goToStage} /> : <BonzahSignV2 />}
              </div>
            )}
            <div ref={contentRef} className={cn("bz-grid h-full", onReview && "hidden")}>
              {/* One slide = its steps, one after another. The pager
                  descends into each and pages them as one flow. */}
              <div className="space-y-8">
                {(stage.steps as readonly number[]).map((id) => (
                  <div key={id} className="space-y-8">
                    {id === 1 && <Step1Business fileUrls={fileUrls} setFileUrls={setFileUrls} />}
                    {id === 2 && <Step2Operations />}
                    {id === 3 && <Step3Contacts fileUrls={fileUrls} setFileUrls={setFileUrls} />}
                    {id === 4 && <Step4Banking />}
                    {id === 5 && <Step5Insurance fileUrls={fileUrls} setFileUrls={setFileUrls} />}
                    {id === 6 && <Step6Policies fileUrls={fileUrls} setFileUrls={setFileUrls} />}
                    {id === 7 && <Step7Underwriting />}
                    {id === 8 && (
                      <Step8Training
                        acknowledged={trainingAcknowledged}
                        onAcknowledgedChange={setTrainingAcknowledged}
                      />
                    )}
                    {id === 9 && <Step9Quiz result={quizResult} onResult={setQuizResult} />}
                    {/* id 10 — Review & sign — is drawn by the v2 screens below. */}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── footer ────────────────────────────────────────────────────── */}
          {/* Same Back / Next pair as the panel's intro screens: outline
              Back bottom-left, outline Next bottom-right, nothing between.
              Back on the very first part leaves the wizard for the intro, so
              there is always a way back. Only the final Submit is solid. */}
          <div className="mt-3 flex shrink-0 items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => (stageIdx === 0 && pager.part === 0 ? onExit() : goBack())}
              disabled={isSubmitting}
            >
              <ArrowLeft className="mr-1.5 size-4" />
              Back
            </Button>

            <Button type="submit" variant={isLast ? "default" : "outline"} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                  Sending…
                </>
              ) : isLast ? (
                <>
                  <Send className="mr-1.5 size-4" />
                  Submit application
                </>
              ) : (
                <>
                  Next
                  <ArrowRight className="ml-1.5 size-4" />
                </>
              )}
            </Button>
          </div>
        </form>
      </FormProvider>

      <AlertDialog open={showSubmitConfirm} onOpenChange={setShowSubmitConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Check className="size-4 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" />
              Send this to Bonzah?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Bonzah reviews your application and sets your account up from their side. You cannot
              edit it once it is sent, but you can send a new one if something needs correcting.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={handleFinalSubmit}>Send it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
