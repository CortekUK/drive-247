# v2/apps/web — Design tokens & UI conventions

The authoritative source is **`src/app/globals.css`**. This file is the written
version of what is in there, plus the rules for using it. If the two disagree,
`globals.css` wins and this file is the bug.

Tailwind v4 is CSS-first here — **there is no `tailwind.config`**. Every utility
class below exists because a `--color-*` / `--text-*` / `--radius-*` custom
property is declared inside the `@theme inline { … }` block in `globals.css`.
Adding a token means editing that block; you cannot add one from a component.

---

## 1. The brand palette (what the site actually looks like)

This is the layer that defines the shipped look: a cream page, near-black text,
dark-green pill buttons, amber accents. **This is the palette you reach for.**

| Utility suffix        | CSS var                  | Hex       | Where it is used |
|-----------------------|--------------------------|-----------|------------------|
| `brand-cream`         | `--brand-cream`          | `#ebece7` | Page background (`body`) |
| `brand-forest`        | `--brand-forest`         | `#162921` | **Primary button fill**, tooltips |
| `brand-forest-deep`   | `--brand-forest-deep`    | `#0a130e` | Navbar CTA, modal scrim |
| `brand-forest-darker` | `--brand-forest-darker`  | `#0e1b17` | Footer background |
| `brand-stats-bg`      | `--brand-stats-bg`       | `#0f1f1a` | Stats strip background |
| `brand-amber`         | `--brand-amber`          | `#f2c12c` | Accent CTA fill, step badges |
| `brand-gold`          | `--brand-gold`           | `#e0ad17` | Accent focus ring, feature card fill |
| `brand-stone`         | `--brand-stone`          | `#e8e5dc` | Hover fill on quiet controls, skeletons |
| `brand-pale-yellow`   | `--brand-pale-yellow`    | `#fbe99a` | Soft highlight |
| `brand-card`          | `--brand-card`           | `#fdfffc` | Card / dialog / popover surface |
| `brand-text`          | `--brand-text`           | `#111210` | Headings, primary body copy |
| `brand-text-soft`     | `--brand-text-soft`      | `#4a4b48` | Secondary body copy |
| `brand-text-muted`    | `--brand-text-muted`     | `#4b4e47` | Muted copy |
| `brand-text-subtle`   | `--brand-text-subtle`    | `#8a8c88` | Captions, metadata, inactive tabs |
| `brand-placeholder`   | `--brand-placeholder`    | `#a0a29c` | Input placeholders |
| `brand-border-soft`   | `--brand-border-soft`    | `#ececec` | Card hairlines |
| `brand-border`        | `--brand-border`         | `#e1e3df` | Field borders, scrollbar thumb, switch off-state |
| `brand-progress-fill` | `--brand-progress-fill`  | `#14231b` | Progress fill |
| `brand-progress-bar`  | `--brand-progress-bar`   | `#5b6cff` | Progress track accent |
| `brand-ring-dark`     | `--brand-ring-dark`      | `#181a17` | Location-search dot |
| `brand-ring-red`      | `--brand-ring-red`       | `#df232a` | Location-search dot (drop-off) |

## 2. Semantic tokens (design-system layer)

These are the generic layer the shadcn primitives were generated against. They
are real and usable, but **most of them route to indigo**, which is not on this
site. Prefer the brand palette above for anything a customer sees.

Surfaces / text: `surface`, `surface-variant`, `on-surface`, `on-surface-inverse`,
`on-surface-subtle`, `on-surface-variant`, `container-low`, `container-lowest`,
`container-high`, `container-highest`, `container-inverse`.

Outlines: `outline`, `outline-dark`, `outline-variant`, `outline-primary`.

shadcn aliases that exist so generated primitives compile: `background`,
`foreground`, `card`, `popover`, `border`, `input`, `ring`, `muted`,
`muted-foreground`, `accent`, `secondary`, `destructive`, `primary`,
`primary-foreground`.

> ⚠️ `primary` = `--main-primary` = **`#6366f1` (indigo)**. `accent` and
> `ring` also resolve to indigo. None of these appear on the shipped site.

### Status colours — these ARE safe to use

| Utility | Hex (light) | Utility | Hex |
|---|---|---|---|
| `success` | `#16a34a` | `success-light` | `#f0fdf4` |
| `danger` | `#dc2626` | `danger-light` | `#fef2f2` |
| `warning` | `#d97706` | `warning-light` | `#fffbeb` |
| `info` | `#2563eb` | `info-light` | `#eff6ff` |

`*-med` (`success-med`, `warning-med`, `info-med`) and `danger-subtle` are the
400-weight versions, used for borders on tinted panels.

## 3. Type scale

Family is **DM Sans** for everything (`--font-dm-sans`, loaded in
`src/app/layout.tsx`, exposed as `font-sans`, `font-display`, `font-button` —
all three are the same family). There is no second typeface.

Token utilities (`text-h1` … `text-body-xs`) are responsive: the `--typeface-*`
vars are redefined at `min-width: 768px`.

| Utility | Mobile | ≥768px |
|---|---|---|
| `text-display` | 3rem / 48px | 3.75rem / 60px |
| `text-h1` | 1.875rem / 30px | 3rem / 48px |
| `text-h2` | 1.5rem / 24px | 1.875rem / 30px |
| `text-h3` | 1.25rem / 20px | 1.5rem / 24px |
| `text-h4` | 1.125rem / 18px | 1.25rem / 20px |
| `text-h5` | 0.875rem / 14px | 1.125rem / 18px |
| `text-subheading` | 1.125rem / 18px | 1.25rem / 20px |
| `text-body` | 1rem / 16px | — |
| `text-body-s` | 0.875rem / 14px | — |
| `text-body-xs` | 0.75rem / 12px | — |

**House convention:** the shipped sections and every file in `components/ui/`
use the plain Tailwind sizes (`text-sm`, `text-xs`, `text-lg`) with explicit
responsive steps, *not* the `text-h*` tokens. Match what you are editing;
don't mix the two scales inside one component.

Headings get `letter-spacing: -0.02em` from the base layer automatically.

## 4. Radius

`--radius` is `0.75rem` (12px). Derived: `rounded-sm` 8px, `rounded-md` 10px,
`rounded-lg` 12px, `rounded-xl` 16px, `rounded-2xl` 20px, `rounded-pill` 9999px.

Observed house recipe on real surfaces:

- **Buttons / pills / chips** → `rounded-full`
- **Cards** → `rounded-[14px]` (vehicle card, radio cards) or `rounded-[18px]`
  (feature card, dialog)
- **Inputs, small controls** → `rounded-md`
- **Borders** are always 1px. Elevation is a soft custom shadow
  (`shadow-[0_4px_18px_rgba(0,0,0,0.06)]` on hover), never a stock `shadow-lg`.

## 5. Which Button variant to use when

`components/ui/button.tsx`.

| Variant | Looks like | Use for |
|---|---|---|
| **`brand`** | dark green pill, white text | **The default choice.** "Rent Now", "Continue", "Pay now" — every primary action. |
| `brand-deep` | near-black green pill | The navbar CTA only (it sits on cream and needs more contrast). |
| `brand-accent` | amber pill, dark text | One high-emphasis CTA on a dark/forest band. Never two on a screen. |
| `brand-outline` | white pill, 1px border | Secondary action beside a `brand` button — "Back", "Cancel". |
| `brand-ghost` | no fill until hover | Tertiary / icon-adjacent actions inside a panel. |
| `destructive` | red | Irreversible actions. |
| `default` `secondary` `outline` `ghost` `link` | stock shadcn | **Legacy.** They resolve to indigo/slate and are kept only so existing call sites compile. Do not introduce new usages. |

Sizes: `xs` `sm` `default` `lg` `xl` plus `icon`, `icon-xs`, `icon-sm`,
`icon-lg`. `xl` (h-12, px-8) is the full-width sidebar CTA size.

The pill radius on `brand*` variants is applied via `compoundVariants`, so it
survives any `size` — `<Button variant="brand" size="lg">` is still a pill.

## 6. DO NOT

1. **No indigo tokens outside `components/ui/`.** Everything in this family
   resolves to `--main-primary` (`#6366f1`) or its `#e0e7ff` tint, and none of
   it appears on the shipped site:
   `bg-/text-/border-/ring-primary`, `primary-foreground`, `primary-subtle`,
   `on-surface-primary`, `bg-/text-accent`, `accent-foreground`, and the focus
   pair `border-ring` / `ring-ring`.
   Use `variant="brand"` for buttons, `bg-brand-forest` for fills, and
   `focus-visible:ring-brand-forest/25` for focus rings.
2. **No `font-serif`.** DM Sans is the only typeface. There is no serif token
   and loading one is a design change, not a styling choice.
3. **No hardcoded colour in a Tailwind class.** `bg-[#e1e3df]` must be
   `bg-brand-border`. If the colour you want has no token, that is a signal to
   add one to `globals.css` — raise it, don't inline it.
   *Carve-out:* a literal hex on an inline `<svg>` `fill`/`stroke` attribute is
   allowed. Logo and brand-mark artwork carries its own colours and is not part
   of the palette.
4. **No `dark:` utilities outside `components/ui/`.** `globals.css` defines a
   `.dark` block, but **no ThemeProvider is mounted** — nothing ever adds the
   `.dark` class, so a `dark:` utility in a page or section is dead code that
   reads as an unfinished feature. The primitives in `components/ui/` keep the
   `dark:` classes they were generated with; leave them alone.
5. **No `ignoreBuildErrors`, no `@ts-ignore`, no `as any`.** `strict: true` has
   no escape hatch in this app and must not gain one.
6. **Don't reach past `cn()`.** Every primitive merges via
   `cn(...)` from `src/lib/utils.ts` (clsx + tailwind-merge) so a caller's
   `className` can always override. Keep that contract.

## 7. Enforcement

`scripts-v2-guard/check-design-drift.sh` (repo root) greps `v2/apps/web/src`
outside `components/ui/` for rules 1–4 and exits non-zero on a hit. Run it
before you push:

```sh
./scripts-v2-guard/check-design-drift.sh
```

It carries a short allowlist of pre-existing violations at the top; if you fix
one, delete its allowlist entry in the same commit.
