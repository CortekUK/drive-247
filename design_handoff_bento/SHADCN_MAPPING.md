# Bento ↔ shadcn/ui mapping

**Rule: use shadcn/ui (Radix) components everywhere.** Don’t hand-roll primitives. Bento is
delivered by (a) the re-skinned design tokens (`DESIGN_SYSTEM.md §3`), (b) **CVA variants** and
small wrappers on top of the shadcn components, and (c) the motion from `ANIMATION.md`. The
design and theme stay identical because everything reads the same CSS variables.

## How to "Bento-ize" a shadcn component
1. Keep the generated shadcn component in `components/ui/*` as the base (don’t fork Radix).
2. Add a **Bento variant** via its `cva()` (or a thin wrapper in `components/bento/*`) that sets
   the Bento radius/padding/shadow/typography using **token classes only** (no raw hex).
3. Attach motion through Radix `data-[state]` + `tailwindcss-animate`, or wrap with `motion`.
4. Compose pages from these — never style ad-hoc.

## Mapping table

| Bento recipe (DESIGN_SYSTEM §7) | shadcn / Radix base | How to theme + animate |
|---|---|---|
| **Tile / Card**, KPI / Feature / Hero / Warn tiles | `Card` | Variants on `Card`: radius 18–22, `bg-card`/`bg-[--bento-feature-bg]`/gradient, `shadow-[--bento-shadow]`. Mount = `motion` stagger fade-up; hover lift. |
| **Button** (primary/secondary/ghost/icon) | `Button` | Add Bento sizes/variants in its `buttonVariants` cva; `whileTap`/`:active` press-scale. |
| **Input / Textarea** | `Input`, `Textarea` | Token bg `--bento-tile-2`, h-46, radius 13; focus ring via `ring`/`--ring`; error = `aria-invalid` → destructive ring + shake. |
| **Select / Combobox / Customer & Vehicle picker** | `Select`, or `Popover` + `Command` (cmdk) for searchable | shadcn’s Radix open/close animations retuned to Bento easings; rich option rows (avatar+meta). |
| **Segmented control** (filters, plan, handover) | `Tabs` (`TabsList`/`TabsTrigger`) | Style `TabsList` as the pill track; put the sliding indicator behind the active trigger with `layoutId`. Replaces bespoke segmented. |
| **Toggle** | `Switch` | Token track/knob; knob slides with `springs.pop`. |
| **Checkbox** | `Checkbox` | 22px, radius 7, `data-[state=checked]` fill + check draw. |
| **Stepper** | two `Button`s + value | value flip on change. |
| **Status pill** | `Badge` | Variants per status map (success/info/warn/danger/neutral) using the muted tokens. |
| **Table** | `Table` (shadcn) + optionally **TanStack Table** for sort/filter/paginate | Header `bg-[--bento-tile-2]`, mono tabular figures, row hover, `AnimatePresence` row add/remove, `layout` on sort. Wrap in a Tile. |
| **Side sheet (detail)** | `Sheet` (`side="right"`) | Retune to `ease.sheet`; add drag-to-dismiss; sticky footer actions. |
| **Modal (create/confirm)** | `Dialog` / `AlertDialog` | `springs.pop` scale-in; blurred `DialogOverlay`. |
| **Toast** | shadcn `Toast` (Radix) or `Sonner` | Bottom-centre, feature-bg pill, spring up; the app already uses Sonner — theme it. |
| **Section card (forms)** | `Card` + `Form`/`FormField` (RHF + zod) | Keep existing RHF+zod; render `FormMessage` as the Bento inline error; checklist tick on valid. |
| **Skeleton** | `Skeleton` | Token bg, shimmer; mirror the layout; cross-fade to content. |
| **Dropdown menu / context actions** | `DropdownMenu` | Radix data-state animations → Bento easings. |
| **Tooltip / Popover / HoverCard** | `Tooltip`/`Popover`/`HoverCard` | Same, retuned. |
| **Accordion / Collapsible** (settings, FAQs) | `Accordion`/`Collapsible` | `tailwindcss-animate` height animation already wired; retune duration. |
| **Calendar / date range** (rental dates) | `Calendar` (react-day-picker) + `Popover` | Token theme; disable booked dates; month-change fade. |
| **Tabs (real tabbed pages)** | `Tabs` | Bento underline/pill; content cross-fade on switch. |
| **Progress** (creation overlay, utilization) | `Progress` | Token fill; width tween `ease.out`. |
| **Avatar** | `Avatar` | Rounded-12 (not full circle) for company/vehicle marks; hue-tinted fallback. |
| **Command palette** (⌘K) | `Command` (cmdk, shadcn) | Add globally; Bento modal styling — see IMPROVEMENTS. |
| **Charts** | shadcn **Chart** (Recharts wrapper) | Use `ChartContainer` + the `--chart-*`/`--primary` tokens; enable draw-in animation. |

## Theming rules (so design never drifts)
- **Only token classes**: `bg-card`, `text-foreground`, `text-muted-foreground`,
  `border-border`, `bg-primary`, `ring-ring`, and the `--bento-*` vars. No literal hex in
  components.
- Put Bento sizing/radius/shadow into each component’s **cva variants**, not inline per usage.
- One **`<ThemeProvider>`** (next-themes) drives `.dark`; all components inherit — no
  per-component dark logic. (Mind the §6 transition gotcha.)
- Keep all Radix a11y (focus traps, roles, keyboard) — that’s a big reason to stay on shadcn.

## Net effect
Pages are composed almost entirely from shadcn components wearing Bento variants + Bento
motion. You get the exact look & theme, full accessibility, and animation for free — with far
less bespoke code to maintain.
