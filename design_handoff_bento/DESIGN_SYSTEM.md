# Bento Design System — Specification

> The single source of truth for the Drive247 "Bento" redesign. Every screen in the
> portal (and admin) app must follow this. Pair it with `ROLLOUT_PLAYBOOK.md` for the
> page-by-page process.

The reference implementations live in `/reference/`. When a value here is ambiguous,
open the matching prototype and read the exact inline style.

---

## 1. Design language in one paragraph

Bento is a **calm, light-first, Apple-flavoured** admin system. Content sits on a soft
canvas in **rounded white "tiles"** (cards) with generous padding and a single violet
signature colour. Headlines and KPIs use an **oversized geometric sans (Sora)** with tight
negative tracking; figures, plates and codes use **IBM Plex Mono**. One **dark "feature"
tile** and the occasional **amber "needs-attention"** or **violet gradient hero** tile add
rhythm. Interactions are **snappy** — spring eases, press-scale, frosted sheets and modals.
Everything has a true **dark mode**.

Principles: less is more · one accent colour does the signalling · whitespace over borders ·
big numbers, quiet labels · every surface is a rounded tile · motion is quick and physical.

---

## 2. The stack this maps onto

The app is **Next.js + TailwindCSS + shadcn/ui (Radix)**, with semantic design tokens
defined as **CSS variables in `globals.css`** and consumed through Tailwind
(`hsl(var(--token))`). **Do not rip this out.** Bento is delivered by:

1. **Re-skinning the existing CSS variables** (Section 3) so every shadcn component inherits
   the new palette automatically.
2. **Adding a few Bento-only tokens** (feature tile, warn tile, etc.).
3. **Restyling/990 wrapping shadcn primitives** into the Bento component recipes (Section 7).
4. **Applying the page layouts** (Section 8) screen by screen.

Keep all data-fetching, routing, permissions and business logic exactly as-is. Bento is a
**presentation layer** change only.

---

## 3. Color tokens

Values are given as **hex**. The repo currently stores shadcn tokens as **HSL triplets**
(e.g. `--background: 258 30% 12%`) consumed via `hsl(var(--background))`. Convert each hex
below to the same triplet format and replace the values in `globals.css`. Keep the variable
names the app already uses; only the values change. Add the `--bento-*` extras as new vars.

### 3.1 Map to existing shadcn tokens

| shadcn token            | Light (hex) | Dark (hex)              |
|-------------------------|-------------|-------------------------|
| `--background`          | `#f5f4fb`   | `#0d0c15`               |
| `--foreground`          | `#1b1731`   | `#efecfb`               |
| `--card`                | `#ffffff`   | `#17142a`               |
| `--card-foreground`     | `#1b1731`   | `#efecfb`               |
| `--popover`             | `#ffffff`   | `#17142a`               |
| `--popover-foreground`  | `#1b1731`   | `#efecfb`               |
| `--primary`             | `#6a4ff0`   | `#8b6dff`               |
| `--primary-foreground`  | `#ffffff`   | `#ffffff`               |
| `--secondary`           | `#f4f2fb`   | `#1f1b36`               |
| `--secondary-foreground`| `#615c7a`   | `#a7a1c6`               |
| `--muted`               | `#f4f2fb`   | `#1f1b36`               |
| `--muted-foreground`    | `#9a95b0`   | `#6f6a8f`               |
| `--accent`              | `#efeafe`   | `rgba(139,109,255,.16)` |
| `--accent-foreground`   | `#5a3fd6`   | `#b9a6ff`               |
| `--destructive`         | `#e0524d`   | `#ff6f6a`               |
| `--destructive-foreground` | `#ffffff`| `#ffffff`              |
| `--border`              | `#ece9f6`   | `#272140`               |
| `--input`               | `#ece9f6`   | `#272140`               |
| `--ring`                | `#6a4ff0`   | `#8b6dff`               |
| `--sidebar-background`  | `#ffffff`   | `#141121`               |
| `--sidebar-foreground`  | `#615c7a`   | `#a7a1c6`               |
| `--sidebar-border`      | `#eceaf4`   | `#241f38`               |
| `--sidebar-accent`      | `#efeafe`   | `rgba(139,109,255,.16)` |
| `--sidebar-accent-foreground` | `#5a3fd6` | `#b9a6ff`          |

### 3.2 Bento-only tokens (add these)

| token                   | Light                    | Dark                      | Use |
|-------------------------|--------------------------|---------------------------|-----|
| `--bento-tile`          | `#ffffff`                | `#17142a`                 | card/tile background |
| `--bento-tile-2`        | `#f4f2fb`                | `#1f1b36`                 | inset / table header / inputs |
| `--bento-text-2`        | `#615c7a`                | `#a7a1c6`                 | secondary text |
| `--bento-text-3`        | `#9a95b0`                | `#6f6a8f`                 | tertiary / labels |
| `--bento-primary-weak`  | `#efeafe`                | `rgba(139,109,255,.16)`   | primary tint bg |
| `--bento-primary-weak-fg`| `#5a3fd6`               | `#b9a6ff`                 | text/icon on tint |
| `--bento-feature-bg`    | `#1b1731`                | `#221d3e`                 | dark "feature" tile |
| `--bento-feature-fg`    | `#ffffff`                | `#ffffff`                 | text on feature tile |
| `--bento-feature-sub`   | `#8d86b0`                | `#a99fd6`                 | label on feature tile |
| `--bento-hero-grad`     | `linear-gradient(150deg,#7a5cff,#5a3fd6 72%)` | `linear-gradient(150deg,#7d5fff,#4f33c4 78%)` | hero KPI tile |
| `--bento-warn-bg`       | `#fff5e3`                | `#2a2114`                 | needs-attention tile |
| `--bento-warn-border`   | `#f6e6c4`                | `#3d2f17`                 | |
| `--bento-warn-fg`       | `#8a5e0e`                | `#f3c878`                 | |
| `--bento-warn-accent`   | `#b07d1a`                | `#f3c06a`                 | |
| `--bento-success`       | `#1f9d6b`                | `#4fd99b`                 | |
| `--bento-success-weak`  | `#e4f6ee`                | `rgba(79,217,155,.14)`    | |
| `--bento-danger-fg`     | `#c23a36`                | `#ff8b86`                 | error text (readable on weak bg) |
| `--bento-danger-weak`   | `#fceae9`                | `rgba(255,111,106,.14)`   | |
| `--bento-info`          | `#3d7fe0`                | `#7aa8ff`                 | |
| `--bento-info-weak`     | `#e9f0fd`                | `rgba(122,168,255,.14)`   | |
| `--bento-shadow`        | `0 2px 12px rgba(40,30,80,.05)` | `0 2px 14px rgba(0,0,0,.4)` | resting tile shadow |
| `--bento-hero-shadow`   | `0 16px 40px rgba(106,79,240,.26)` | `0 18px 44px rgba(80,50,200,.34)` | hero tile shadow |

> Status colours (`success/warn/danger/info`) are intentionally muted so the violet stays
> the loudest thing on screen. Never introduce a new hue without adding it here first.

---

## 4. Typography

- **Display / headings / KPI numerals / buttons:** `Sora` (Google Fonts), weights 400–800.
  Use **700–800** for headings and big numbers, with `letter-spacing: -0.02em` to `-0.04em`
  (tighter as the size grows).
- **Figures, monetary values in tables, plates, reg numbers, codes, timestamps:** `IBM Plex
  Mono` (weights 400–600), with `font-variant-numeric: tabular-nums`.
- **Body / labels / inputs:** Sora 400–600. (The old app used Inter — replace it.)

Add both fonts via `next/font/google` and set `--font-sans: Sora` in Tailwind config.

### Type scale (px)
| Role | Size | Weight | Tracking |
|------|------|--------|----------|
| Page title (`h1`) | 30 | 800 | −0.04em |
| Section / card title | 16–17 | 700 | −0.02em |
| Hero KPI numeral | 56–68 | 800 | −0.04em |
| Standard KPI numeral | 30–42 | 800 | −0.04em |
| Body | 13–14 | 400–600 | normal |
| Label / field label | 12.5 | 700 | normal |
| Eyebrow (uppercase) | 11 | 700 | +0.07em |
| Tertiary / hint | 11.5–12 | 500 | normal |

**Eyebrow pattern** (used above most KPIs and section headers): uppercase, 11px, weight 700,
`letter-spacing: 0.07em`, colour `--bento-text-3`.

---

## 5. Radius, spacing, shadow

- **Radius:** inputs/buttons/segmented `12–13px`; tiles/cards `18–22px`; pills/avatars `999px`;
  small chips `9–11px`. Set shadcn base `--radius` to **`0.85rem` (~14px)**.
- **Spacing:** grid gap between tiles **16px**; card padding **16 / 18 / 20** (compact / default
  / roomy); vertical field gap **14–16px**; page padding **22–24px**.
- **Shadow:** resting tiles use `--bento-shadow` (very soft). Elevate only sheets, modals,
  dropdowns and the hero tile. Prefer borders + radius over heavy shadow.
- **Borders:** `1px solid var(--border)` on every tile. In dark mode borders do the
  separating, not shadows.

---

## 6. Motion

- **Spring (overshoot)** for things that "pop" in (modals, toggles, segmented indicator,
  toasts, success check): `cubic-bezier(.34, 1.56, .64, 1)`, 280–400ms.
- **iOS sheet curve** for side/bottom sheets: `cubic-bezier(.32, .72, 0, 1)`, ~500ms on
  `transform`/`opacity`.
- **Press feedback:** clickable elements scale to `0.96–0.98` on pointer-down (transform
  transition 120ms).
- **Row hover:** background fades to `--bento-tile-2` over 160ms.

### ⚠️ Dark-mode gotcha (must read)
Do **not** CSS-`transition` colour properties whose value comes from a CSS variable
(`background-color`, `color`, `border-color` set via `var(--…)`). Chromium **freezes** the
old value and the theme appears not to switch. Swap the theme **instantly** (toggle the
`.dark` class / `data-theme`) and, if you want a soft change, fade a **one-shot full-screen
overlay** of the new `--background` from ~0.5 → 0 opacity. See the prototypes' `themeFade`.

---

## 7. Component recipes

Build these once as a small Bento component layer (extend `components/ui/`), then compose every
page from them. Exact paddings/sizes are in the reference files — match them.

### Tile / Card
`background var(--bento-tile)` · `border 1px solid var(--border)` · `border-radius 20px` ·
`box-shadow var(--bento-shadow)` · padding 16–20. This replaces shadcn `<Card>`’s look.

### KPI tile
Eyebrow (uppercase label) top, then big Sora numeral (`30–42px / 800`), then a small
delta/sub line. Optional small icon top-right in `--primary`.

### Feature tile (dark)
Same shape but `background var(--bento-feature-bg)`, white text, label in
`--bento-feature-sub`. Use for ONE lead stat per dashboard (e.g. Active rentals).

### Hero tile (violet gradient)
`background var(--bento-hero-grad)`, white text, `box-shadow var(--bento-hero-shadow)`,
radius 22. Holds the single most important number (e.g. Revenue) + an area chart. White text;
override chart `--primary` to `#fff`.

### Warn tile
`background var(--bento-warn-bg)`, `border 1px solid var(--bento-warn-border)`, text in
`--bento-warn-fg`/`--bento-warn-accent`. For overdue / fines / attention.

### Buttons
- **Primary:** bg `--primary`, white text, radius 13–15, Sora 700, 38–50px tall, gap-2 icon.
  Press-scale.
- **Secondary:** bg `--bento-tile-2`, text `--foreground`, no border (or 1px `--border`).
- **Ghost:** transparent, text `--bento-text-2`, hover bg `--bento-tile-2`.
- **Icon button:** 36–40px square, radius 11–12, `1px --border`, bg `--bento-tile`.

### Input / textarea / select trigger
Height 46, radius 13, bg `--bento-tile-2`, `1px --border`, padding-x 14, font 14. Optional
leading icon in `--bento-text-3`. **Focus:** `--ring` border + 3px `--bento-primary-weak`
ring. **Error:** `--destructive` border + 3px `--bento-danger-weak` ring.

### Dropdown / combobox (Radix Select/Popover)
Trigger = input style with trailing chevron (rotates on open). Panel = tile with 18–44px-tall
options, radius 14, soft shadow, `rnPop` entrance; searchable variant has a search field on
top; selected option tinted `--bento-primary-weak`. Rich option rows (avatar + name + meta)
are encouraged for customers/vehicles.

### Segmented control  → replaces shadcn Tabs for short option sets
Pill track `--bento-tile-2` with a **sliding white indicator** (spring eased) behind the
active label. Use for filters (All/Active/…), payment plan, light/dark, handover method.

### Toggle (Switch)
Track `--primary` when on / `--border` when off; white knob slides with spring.

### Stepper
−/value/+ in a bordered pill; value in Sora 800. For quantities (extras, days).

### Checkbox
22px, radius 7; checked = `--primary` fill + white check.

### Status pill
Tinted bg + matching text from the status map, weight 700, 11.5px, radius 999, optional
leading dot. Map: Active/On rental/Verified → success · Upcoming/Available → info ·
Pending/Maintenance → warn · Overdue/Blocked → danger · Completed → neutral.

### Table
Header row bg `--bento-tile-2`, uppercase 10.5px labels in `--bento-text-3`. Rows separated by
`1px --border`, 12–13px text, hover → `--bento-tile-2`, row click → detail. Money/figures in
IBM Plex Mono, right-aligned, tabular. Wrap the whole table in a Tile.

### Side sheet (detail)
Slides in from the right (430px) over a blurred scrim; iOS-sheet curve; Esc + scrim close;
sticky action bar at the bottom. Use for record details opened from a row.

### Modal
Centred, radius 24–26, spring scale-in from 0.92, blurred scrim. Use for create/confirm forms.

### Toast
Bottom-centre pill, `--bento-feature-bg` bg, white text, slides up (spring), auto-dismiss ~2.4s,
leading status icon.

### Section card (forms)
Header = round icon chip (`--bento-primary-weak`) + number + title + description, divider,
then body. Group long forms into these.

### Skeleton
Shimmer blocks in `--bento-tile-2` (opacity pulse 1.3s) mirroring the real layout. Show on
first load of any data view.

---

## 8. Page layout patterns

### App chrome
- **Sidebar / rail:** the portal’s existing nav, re-skinned (`--sidebar-*`). A slim 64–66px
  glyph rail is the Bento signature, but a labelled sidebar is fine if the app needs it — keep
  the active item as a `--bento-primary-weak` pill with `--bento-primary-weak-fg` icon/text.
- **Header:** page title (Sora 30/800) + subtitle/eyebrow on the left; search, date-range,
  notifications, **light/dark toggle**, primary action on the right.
- **Content:** padding 22–24, max-width readable, tiles on the canvas.

### Dashboard / overview page
Bento grid (e.g. `grid-cols-4`, `grid-rows-3`, gap 16): one **hero** tile (2×2) + one **feature**
tile + KPI tiles + a **warn** tile + list tiles (schedule / activity / action items). Oversized
numbers; charts live inside tiles. See `reference/Bento Rental Admin.html` (Dashboard).

### List / index page (e.g. Rentals, Vehicles, Customers, Payments)
Row of 4 **stat tiles** on top (one may be feature/warn), then a single **Table tile** with a
**segmented filter**, search and primary action. Rows open a detail (route or side sheet).
See the Rentals/Customers screens + `reference/Bento Rentals Prototype.html` (interactions).

### Detail page (e.g. Rental detail, Customer detail, Vehicle detail)
Header with avatar/title + status pills + actions; a strip of KPI tiles; then a 2-column body
(left: charts + related table tiles; right: side tiles for integrations / payment / metadata).

### Create / edit form page (e.g. New Rental)
3-zone: **section checklist** (left, ticks green / red-on-error, click-to-scroll) · **form**
(centre, grouped into Section cards, max-width ~760) · **sticky live Preview / summary** (right)
with the primary submit. Full coverage of states below. See
`reference/New Rental Agreement Prototype.html`.

### Fleet / gallery page
Bento grid of object cards (vehicle: car mark, make/model, plate, status pill, rate, utilization
bar, next booking). See `reference/Bento Rental Admin.html` (Fleet).

---

## 9. Required states (every data view must implement)

1. **Loading** — shimmer skeleton matching the layout (not a spinner-on-blank).
2. **Empty** — friendly tile with an icon, one line of copy, and the primary action.
3. **Error** — inline tile with `--bento-danger-weak` bg, message, and a Retry button. For
   forms, a red summary banner at top + inline field errors + red checklist markers.
4. **Submitting / processing** — for multi-step server actions, a frosted overlay that steps
   through the real backend stages with a spinner→check per step + progress bar, ending on a
   **success** state. For simple saves, a button spinner + success toast.
5. **Populated** — the normal state.
6. **Dark** — every one of the above must be correct in dark mode.

Validation: keep the existing Zod schemas / rules; surface them as inline field errors (red
border + 3px danger ring + message) and reflect completion on the section checklist.

---

## 10. Do / Don’t

**Do:** use the tokens; compose from the Bento components; one accent colour; big quiet
numbers; rounded tiles; tabular mono for figures; spring motion; build light + dark together;
keep shadcn primitives and all logic.

**Don’t:** invent colours/hues; use heavy gradients or shadows everywhere; transition
var-driven colours (gotcha §6); use Inter/Roboto; cram dense borders instead of whitespace;
ship a screen without its loading/empty/error/dark states; change routes, data or permissions.
