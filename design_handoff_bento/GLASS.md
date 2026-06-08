# Glass surfaces — glassmorphism add-on

An optional **glass** material layered on the Bento system. Use it for **floating chrome and
overlays**, not for dense data. It reads as frosted translucent panels over a soft, colourful
backdrop. Binding alongside `DESIGN_SYSTEM.md`.

Reference: `reference/Auth Screens Prototype.html` and `reference/Rental Detail Glass Prototype.html`.

---

## 1. When to use glass (and when NOT)

**Use glass for:**
- Auth screens (sign in / reset) and other full-screen, low-density moments.
- **Overlays**: dialogs, sheets, popovers, dropdown menus, command palette, toasts.
- Floating panels over imagery or a map (e.g. live-ops map cards).
- A detail-page **header** or hero strip.

**Keep solid (`--bento-tile`) for:**
- Dense data — tables, ledgers, dashboards, long forms. Readability + scroll performance win.
- Anything with lots of small text where translucency hurts contrast.

> Glass only reads as glass when there is **something colourful behind it** to blur (a gradient,
> blobs, imagery). Over a flat background it just looks like a slightly off-white panel — add an
> ambient backdrop (see §4) or don't use glass there.

---

## 2. Tokens (add to `globals.css`, both themes)

| token | Light | Dark |
|---|---|---|
| `--glass` | `rgba(255,255,255,0.60)` | `rgba(28,24,52,0.52)` |
| `--glass-2` (inset/input/nested) | `rgba(255,255,255,0.46)` | `rgba(40,34,68,0.48)` |
| `--glass-border` | `rgba(255,255,255,0.70)` | `rgba(255,255,255,0.10)` |
| `--glass-input-bg` | `rgba(255,255,255,0.55)` | `rgba(255,255,255,0.05)` |
| `--glass-shadow` | `0 18px 50px rgba(55,40,110,.14), inset 0 1px 0 rgba(255,255,255,.62)` | `0 20px 56px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.05)` |
| `--glass-blur` | `20px` | `22px` |

Notes: the **inset top-1px highlight** in the shadow is what gives the "lit glass edge" — keep
it. Light glass uses a bright white border; dark glass uses a faint white border. Bump `--glass`
opacity toward `0.7+` on any glass panel that carries a lot of text.

---

## 3. CSS recipe

```css
.glass {
  background: var(--glass);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(160%);
  backdrop-filter: blur(var(--glass-blur)) saturate(160%);
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-shadow);
  border-radius: var(--radius);   /* Bento radius; 20–26 on big panels */
}
/* opaque fallback where backdrop-filter is unsupported */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass { background: var(--card); }
}
/* inputs inside glass */
.glass-input { background: var(--glass-input-bg); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
```

Optional **specular rim** for a more premium edge (pure CSS, cheap):
```css
.glass::after {
  content:''; position:absolute; inset:0; border-radius:inherit; padding:1px; pointer-events:none;
  background: linear-gradient(135deg, rgba(255,255,255,.7), transparent 45%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
}
```
(Do **not** ship the iOS-style `feDisplacementMap` "liquid glass" refraction — it's Chromium-only
and was explicitly dropped. Frosted glass + this rim is the agreed look.)

---

## 4. Ambient backdrop

Glass needs a backdrop. On glass screens, place 2–3 soft, blurred, brand-tinted "blobs" behind
the content (fixed, `pointer-events:none`, `filter: blur(70–80px)`), optionally drifting slowly.
Tint the largest blob with `--primary` (via `color-mix`) so it follows the per-tenant accent.

---

## 5. shadcn mapping

Apply the `.glass` material to the **content surfaces** of these shadcn/Radix components (keep
their behaviour/a11y):

| shadcn component | glass treatment |
|---|---|
| `DialogContent`, `AlertDialogContent` | `.glass`, radius 24–26 |
| `SheetContent` | `.glass`, plus the ambient backdrop showing through |
| `PopoverContent`, `DropdownMenuContent`, `HoverCardContent` | `.glass`, radius 14–18 |
| `Command` (⌘K palette) | `.glass` panel |
| Toast / Sonner | `.glass` pill |
| `Card` (overlay/hero variant only) | add a `glass` variant; **default Card stays solid** |
| Inputs inside glass panels | `.glass-input` |

Scrims behind overlays: `rgba(10,8,24,.35)` + `backdrop-filter: blur(3px)`.

---

## 6. Guardrails

- **Legibility first.** On glass, use `--foreground` for primary text and avoid the faintest
  `--bento-text-3` for anything important. Raise `--glass` opacity if text contrast dips.
  Re-check contrast in **both** themes.
- **Performance.** `backdrop-filter` is GPU work — cap the number of simultaneous glass layers
  on one screen (chrome + overlays, not every row). Never nest glass inside glass inside glass.
- **Dark-mode gotcha (still applies).** Don't CSS-transition `var()`-driven colours; swap theme
  instantly (DESIGN_SYSTEM §6).
- **Reduced transparency.** Honour `prefers-reduced-transparency: reduce` (and treat very low-end
  devices similarly) by falling back to solid `--card`.
- **Borders carry it in dark.** In dark mode the faint border + inset highlight do the
  separating, since shadows are invisible on near-black.
```css
@media (prefers-reduced-transparency: reduce) { .glass { background: var(--card); -webkit-backdrop-filter:none; backdrop-filter:none; } }
```
