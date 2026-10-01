# Drive247 Illustration Guide — "Quiet Confidence"

Hand this file to any AI chat and say: **"Read `docs/brand/illustration-guide.md` and make an illustration for <purpose>."**
Everything needed is in here: the vibe, the rules, the palette, the approved drawing code, the layouts per
purpose, how to render and check, how to ship it into the app, and the mistakes already made once.

---

## 1. The vibe in one line

**The operator who already has it handled.** Not the loudest car in the lot — the one everyone notices anyway.

| It is | It is not |
|---|---|
| **Assured** — the job is done, no need to prove it | Arrogant, shouting, exclamation marks |
| **Composed** — still, low, planted | Cute — no big cartoon eyes, blush, bouncing |
| **Precise** — clean lines, exact numbers, a grid underneath | Busy — no chips, badges, labels, clutter |
| **Premium** — deep colour, one glint, careful light | Flashy — no rainbow, no neon everywhere |
| **Warm underneath** | Cold or corporate |

**Test:** would a calm expert present it this way? If it looks like it is trying hard, cut something.

The owner's taste (learned the hard way — follow it):
- **Plain and flat beats effects.** No 3D tilt, no heavy drop shadows, no glossy card chrome. When asked to make
  something "nicer", remove clutter first; propose effects only as small, easy-to-revert options.
- **Cartoon-illustrated, not realistic.** A realistic/3D-modelled car was tried and rejected. Keep the
  illustrated style below.
- **Headlights: simple rounded pills.** Thin strips, Bugatti quad-LEDs, twin projectors and "realistic"
  lamps were all tried and rejected. Use the approved simple lamp (section 5) — nothing crazy.
- **No floating accent lines** across the nose or body (an indigo bar across the nose was removed).
- **No chips/pills floating around the hero** ("Turo synced", "Paid $1,240"…) — removed on request.
- **No emojis** anywhere. Product voice is TRAX: plain, calm, first person.

---

## 2. Palette

| Token | Hex | Use |
|---|---|---|
| Midnight | `#07071a` | dark backgrounds, deepest shade |
| Indigo | `#2e2a8f` / body `#3a36a8` | car paint in dark mode, jackets |
| Accent | `#5b5bd6` | the portal's `--pv-accent`; trim, roof line, arrows, links |
| Rim light | `#a5b4fc` / `#c7d2fe` | edge light, soft glows, grid lines |
| Ink | `#1f2040` (outline) / `#12141c` (text) | outlines in light mode, headings |
| Paper / Wash | `#ffffff` / `#f7f8fc` | light backgrounds |
| Done | `#34d399` / `#12a594` | only when something is actually complete |
| Tail light | `#f43f5e` | rear lights only |

Rules: **one soft glow per picture** (an indigo ellipse under the subject). Colour only where it means
something. Faces/people use real skin tones (`#d9a88a`, `#b77e5f`), never grey or blue.

**Light / dark pairing:** every picture ships in both.
- Light mode → **Pearl** car (white → `#dfe2f1`, ink outline, indigo trim, indigo-tinted glass) on paper.
- Dark mode → **Indigo** car (`#4a46c2` → `#1f1b6e`, rim-light roof line) on midnight.

---

## 3. Characters

### The car (the brand's hero)
A low, wide coupe, illustrated: continuous body, **wheel arches**, soft shoulder sheen, door line + handle,
side mirror, **tinted glass worn like sunglasses with one glint**, indigo roof line, a single indigo side
trim line along the flank, mesh lower intake, 10-spoke rims, small ducktail spoiler, red tail light.
**No face** on the car (no eyes/mouth) — the attitude is in the stance and the glint.

Approved views (code in section 5): **front · front three-quarter (hero) · profile · rear three-quarter ·
rear · top-down**, plus close crops (headlight, wheel) made by changing the SVG `viewBox`.

Which view means what:
| View | Meaning / where |
|---|---|
| Front three-quarter | hero, feature posts, launches |
| Front | "your car", welcome |
| Profile | travel, speed, syncing, anything moving |
| Rear three-quarter / rear | handed over, heading out, returns, completed trips |
| Top-down (on a grid) | availability, bookings, scheduling — **the grid is the calendar** |
| Close crops | banners, small spots |

Other body types exist in the same language (sedan, GT, SUV, EV with no grille, pickup, van, roadster) —
build them by changing the body path, keeping glass, trim, wheels, lamp and paint identical.

### People
Faceless, upright, composed, well dressed. Two stock characters (code in section 5):
- **Operator** — short hair, indigo blazer, phone in hand.
- **Customer** — tied-back hair, light jacket, a bag, one hand out (for a key).
Use one or two people at most. They stand still; they do not wave, jump or pose.

### Props
Key fob (indigo), calendar tiles, a dashed "empty bay" with a `+`, a single sync arrow (one clean arc with a
chevron), a perspective grid floor. Always sparse.

---

## 4. Layouts by purpose

### 4a. Empty state (list pages: Customers, Vehicles, Rentals, …) — the approved pattern

**When:** only when the page has *no records at all*. A search or filter that matched nothing is not an
empty state — keep the page as it is and show a small "No results · Clear filters" line instead.

**What stays on the page:** the page **title and its description** (e.g. "Fleet Management / Manage your
vehicle fleet…"). **Everything else is hidden**: overview/charts, search and filters (including the top-bar
search), Export and Import CSV, the tour button, and the header's own Add button (the empty state carries
the action). No CSV import on empty pages — first records should come in properly (typed in, or via an
invite link) so details and licences are checked.

**Surface:** no card — no border, no fill, no radius. It sits straight on the page, centred, and the
whole page must fit on a laptop screen **without scrolling**.

**Shape: a funnel.** Every layer is a little narrower than the one above, so the eye runs down to the action:

| Layer | Spec |
|---|---|
| Picture | up to **518px** wide; tells the page's *story*, not just an object |
| Headline | **21.5px** semibold, max **460px** (wraps rather than widening) |
| Description | **one line or two**, **15px** muted, max **380px** — always narrower than the headline, tucked under it |
| Action tiles | equal rounded squares (`rounded-2xl`), **icon only**; 2 tiles = **120×100** (icon ≈56px), 3 tiles = **104×88** (icon ≈48px) — the row stays narrower than the description |
| (nothing below) | no footnote, no bullet points, no tick marks |

**Tiles:** the main action is **indigo** with a big **+**; a second action is **white** with a hairline border
(e.g. a chain-link icon for "Invite by link" on Customers); **Watch how** is **soft indigo** with a big solid
**▶**. No text on the tiles — hovering (or keyboard focus) drops a **small card below** the tile with the
action's name in bold and one line on what it does. The name also stays as the tile's `aria-label`.

**Pictures in use** (ink lines, white cards, indigo only where it matters, pearl-on-light / matching dark):
- **Vehicles** — an empty dashed bay with a "+", a photo card and a "$/day" tag waiting to go on the car,
  and the white car pulling in.
- **Customers** — a phone showing your booking site ("Book") flowing into a customer record, with their
  driving licence clipped on and an indigo verified tick. No car.
- **Rentals** — a calendar with the booked dates (customer's avatar on the bar), connected to the three
  things a rental carries: payment ($ with a tick), signed agreement, and keys. No car.
Don't put the car in every picture — only where the page is about cars.

**Code:** `components/empty-states/teaching-empty-state.tsx` (layout, tiles, hover cards),
`components/empty-states/lean-empty-states.tsx` (copy per page), `components/illustrations-v2/empty-scenes.tsx`
(pictures) and `car-art.ts` (the approved car). Canary-only (northwind) — see V2_PLAN.

### 4b. Feature announcement card (dashboard "What's new" carousel)
- The card is **320 × 240** (4:3). Art is exported at **1280 × 960 PNG, no text in the image**.
- The card draws its own text on top: **heavy ink heading top-left**, grey description + ink link
  **bottom-left**, black carousel dots **bottom-right**, on a **white card** (toned down on 2026-09-27 from an
  indigo gradient — the owner wants mostly black and white, very little accent).
- **No card chrome** (2026-09-27): the card has no border or fill, so the art is a **transparent PNG**
  (export with Chrome's `--default-background-color=00000000`) and everything sits on the page wash.
  Earlier versions used a soft accent gradient (`#ffffff` → `#eeeefc` → `#d9d9f7`) as the background.
- The art must work on the light page wash: keep **top-left and bottom-left clear**, and put the car in
  the band between, on the right. Current Turo Sync art: a **monochrome car** (white body, black `#111114`
  outline, dark glass, grey rims) with one sync arc and a soft
  grey shadow. **A touch of accent** `#5b5bd6`: the sync arc (~75%), the car's roof line and side trim, and on
  the card the link and the active dot. The rest is black, white and grey (plus the tiny red tail light).
- Upload: bucket `portal-announcement-media`, path `feature/card/<uuid>.png` (the table's CHECK constraint
  requires exactly that pattern and png/jpg/webp), then `update portal_announcements set image_url=… where id=…`.
  Updating `image_url` does **not** bump `revision`, so nobody sees the popup again.

### 4c. Hero / login / marketing
- 1280 × 720+, dark (midnight radial) or light (paper + lavender glow). Heavy headline left
  ("Drive247" 96px, weight 900, tracking −4), calm subline, car right on a perspective grid floor with two
  faint light trails. No chips.

### 4d. Anything else
Pick the view from the table in 3, one or two props max, one glow, both modes.

---

## 5. Approved drawing code (copy exactly; change only placement, scale and paint)

All pieces are plain JS functions that return SVG strings. Render them inside an `<svg>` and position with
`<g transform="translate(x y) scale(s)">…</g>`. **Every gradient/filter id must be unique per render**
(pass a fresh id each call).

### 5.1 Headlight, car views and paints
```js
/* ---- headlight (approved: simple rounded) ---- */
function lamp2Defs(u){return `<filter id="${u}b" x="-40%" y="-120%" width="180%" height="340%"><feGaussianBlur stdDeviation="4"/></filter>
 <radialGradient id="${u}l" cx=".38" cy=".35" r=".75"><stop offset="0" stop-color="#7b81a8"/><stop offset=".5" stop-color="#2a2e4c"/><stop offset="1" stop-color="#0c0d1a"/></radialGradient>`;}
/* Simple rounded headlight: a soft pill lamp, light fill, clean outline, one highlight. */
function lamp4(u, line){
  return `<rect x="14" y="10" width="176" height="42" rx="21" fill="#eef2ff" stroke="${line}" stroke-width="5"/>
  <rect x="26" y="18" width="152" height="26" rx="13" fill="#ffffff"/>
  <ellipse cx="62" cy="24" rx="20" ry="4" fill="#ffffff" opacity=".9"/>`;
}

/* ---- front three-quarter + paints ---- */
/* Premium three-quarter coupe, front-left. Box 330 x 140. */
function car3(p,id){
  const rim=(cx,cy,r)=>{
    let s=`<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r}" fill="${p.tyre}"/>
      <ellipse cx="${cx+1.5}" cy="${cy}" rx="${r*.66}" ry="${r*.66}" fill="${p.rimFace}" stroke="${p.rimEdge}" stroke-width="1.4"/>`;
    for(let a=0;a<360;a+=36){const t=a*Math.PI/180;
      s+=`<path d="M${cx+1.5} ${cy} L${(cx+1.5+r*.6*Math.cos(t)).toFixed(1)} ${(cy+r*.6*Math.sin(t)).toFixed(1)}" stroke="${p.spoke}" stroke-width="2.2" stroke-linecap="round"/>`;}
    return s+`<circle cx="${cx+1.5}" cy="${cy}" r="${r*.18}" fill="${p.hub}"/><path d="M${cx-r*.72} ${cy-r*.5} A ${r*.9} ${r*.9} 0 0 1 ${cx+r*.2} ${cy-r*.86}" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="2"/>`;};
  return `<defs>
   <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.top}"/><stop offset=".55" stop-color="${p.mid}"/><stop offset="1" stop-color="${p.bot}"/></linearGradient>
   <linearGradient id="${id}h" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".45" stop-color="#fff" stop-opacity="${p.sheen}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  </defs>
  <ellipse cx="172" cy="130" rx="160" ry="10" fill="${p.shadow}" opacity="${p.shOp}"/>
  <!-- far wheels -->
  
  <!-- body -->
  <path d="M6 102 Q4 90 14 84 Q30 75 80 69 Q106 64 132 48 Q166 28 212 26 L240 28 Q272 32 292 56 L312 62 Q326 66 326 84 L326 102 Q326 112 314 112 L292 114 Q290 90 266 90 Q242 90 240 115 L146 120 Q144 96 118 96 Q92 96 90 121 L44 120 Q18 119 10 112 Q6 108 6 102 Z" fill="url(#${id}b)" stroke="${p.line}" stroke-width="1.8" stroke-linejoin="round"/>
  <!-- shoulder sheen -->
  <path d="M84 84 Q200 72 318 70 L318 76 Q200 78 86 90 Z" fill="url(#${id}h)"/>
  <!-- hood crease + nose crease -->
  <path d="M18 82 Q70 70 126 52" fill="none" stroke="#fff" stroke-opacity="${p.sheen*.7}" stroke-width="3" stroke-linecap="round"/>
  
  <!-- glass -->
  <path d="M104 66 Q130 48 164 36 L176 36 Q160 52 154 66 Z" fill="${p.glass}"/>
  <path d="M162 66 Q178 44 210 36 L240 36 Q266 40 284 60 Z" fill="${p.glass}"/>
  <path d="M218 36 L214 64" stroke="${p.pillar}" stroke-width="3.5"/>
  <path d="M104 66 Q130 48 164 36 L176 36 M162 66 Q178 44 210 36 L240 36 Q266 40 284 60" fill="none" stroke="${p.chrome}" stroke-width="1.2" opacity=".8"/>
  <path d="M122 62 L142 46 L150 46 L130 63 Z" fill="#fff" opacity=".55"/><path d="M226 58 L240 40 L246 40 L232 58 Z" fill="#fff" opacity=".25"/>
  <!-- roof line -->
  <path d="M132 48 Q166 28 212 26 L240 28 Q272 32 292 56" fill="none" stroke="${p.rim}" stroke-width="2"/>
  <!-- mirror -->
  <path d="M150 64 L164 60 L166 68 L152 70 Z" fill="${p.mid}" stroke="${p.line}" stroke-width="1.4"/>
  <!-- door cut -->
  <path d="M158 72 Q156 96 160 114 M238 70 Q240 88 238 100" fill="none" stroke="${p.line}" stroke-opacity=".28" stroke-width="1.3"/>
  <path d="M196 82 L210 81" stroke="${p.line}" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/>
  <!-- spoiler -->
  <path d="M290 56 L316 52 L314 60 L294 62 Z" fill="${p.line}"/>
  <!-- lights -->
  <defs>${lamp2Defs(id+"L")}</defs><g transform="matrix(0.44 -0.1 0.03 0.3 10 81)">${lamp4(id+"L",p.line)}</g>
  
  
  <path d="M318 72 L326 73 L326 82 L318 81 Z" fill="#f43f5e"/>
  <!-- intake + splitter -->
  
  <path d="M16 104 Q48 106 82 104 L80 114 Q48 116 20 112 Z" fill="${p.line}"/>
  <g stroke="${p.rim}" stroke-opacity=".35" stroke-width="1">${[28,36,44,52,60,68,76].map(x=>`<path d="M${x} 105 L${x-1} 114"/>`).join('')}</g>
  <path d="M12 116 Q46 122 88 121" fill="none" stroke="${p.line}" stroke-width="2.4" stroke-linecap="round"/>
  <!-- side line + skirt -->
  <path d="M92 98 Q200 86 322 86" fill="none" stroke="${p.trim}" stroke-width="2" opacity=".9"/>
  <path d="M148 118 L238 114" stroke="${p.line}" stroke-width="3" stroke-opacity=".45" stroke-linecap="round"/>
  <!-- wheels in arches -->
  ${rim(118,116,21)}${rim(266,110,21)}`;
}
const PAINT={
 indigo:{top:'#4a46c2',mid:'#332fa0',bot:'#1f1b6e',line:'#0b0b1a',rim:'#c7d2fe',glass:'#0b0b1a',pillar:'#1f1b6e',chrome:'#a5b4fc',lamp:'#eef2ff',drl:'#c7d2fe',trim:'#a5b4fc',tyre:'#0b0b1a',rimFace:'#2b2870',rimEdge:'#8b8cf0',spoke:'#c7d2fe',hub:'#0b0b1a',shadow:'#050414',shOp:.45,sheen:.28},
 pearl:{top:'#ffffff',mid:'#f3f4fb',bot:'#dfe2f1',line:'#1f2040',rim:'#5b5bd6',glass:'#1e1b4b',pillar:'#ffffff',chrome:'#5b5bd6',lamp:'#e0e7ff',drl:'#5b5bd6',trim:'#5b5bd6',tyre:'#1f2040',rimFace:'#e6e8f5',rimEdge:'#5b5bd6',spoke:'#5b5bd6',hub:'#1f2040',shadow:'#1e1b4b',shOp:.18,sheen:.9},
};

/* ---- other views ---- */
let uid=0;const nid=()=>'v'+(uid++);
function rimG(p,cx,cy,r){let s=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${p.tyre}"/><circle cx="${cx}" cy="${cy}" r="${r*.66}" fill="${p.rimFace}" stroke="${p.rimEdge}" stroke-width="1.4"/>`;
 for(let a=0;a<360;a+=36){const t=a*Math.PI/180;s+=`<path d="M${cx} ${cy} L${(cx+r*.6*Math.cos(t)).toFixed(1)} ${(cy+r*.6*Math.sin(t)).toFixed(1)}" stroke="${p.spoke}" stroke-width="2.2" stroke-linecap="round"/>`;}
 return s+`<circle cx="${cx}" cy="${cy}" r="${r*.18}" fill="${p.hub}"/>`;}
const bodyGrad=(p,id,x2=0,y2=1)=>`<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${p.top}"/><stop offset=".55" stop-color="${p.mid}"/><stop offset="1" stop-color="${p.bot}"/></linearGradient>`;
const mesh=(p,x0,x1,y0,y1,step=8)=>{let s='';for(let x=x0;x<=x1;x+=step)s+=`<path d="M${x} ${y0} L${x-1} ${y1}"/>`;return `<g stroke="${p.rim}" stroke-opacity=".35" stroke-width="1">${s}</g>`;};

/* FRONT · box 260x136 */
function front(p){const g=nid();return `<defs>${bodyGrad(p,g)}</defs>
 <ellipse cx="130" cy="132" rx="124" ry="7" fill="${p.shadow}" opacity="${p.shOp}"/>
 <rect x="20" y="98" width="30" height="34" rx="7" fill="${p.tyre}" stroke="${p.rimEdge}" stroke-opacity=".6" stroke-width="1.2"/><rect x="210" y="98" width="30" height="34" rx="7" fill="${p.tyre}" stroke="${p.rimEdge}" stroke-opacity=".6" stroke-width="1.2"/>
 <path d="M12 100 Q10 82 26 76 L64 70 Q84 40 130 36 Q176 40 196 70 L234 76 Q250 82 248 100 L248 108 Q248 116 236 116 L24 116 Q12 116 12 108 Z" fill="url(#${g})" stroke="${p.line}" stroke-width="1.8" stroke-linejoin="round"/>
 <path d="M64 70 Q84 40 130 36 Q176 40 196 70" fill="none" stroke="${p.rim}" stroke-width="2"/>
 <path d="M74 68 Q92 46 130 44 Q168 46 186 68 Q130 73 74 68 Z" fill="${p.glass}"/>
 <path d="M100 64 L118 48 L126 48 L108 65 Z" fill="#fff" opacity=".55"/><path d="M116 66 L128 55 L132 55 L120 66 Z" fill="#fff" opacity=".3"/>
 <path d="M58 68 L70 66 L70 74 L58 74 Z M202 68 L190 66 L190 74 L202 74 Z" fill="${p.mid}" stroke="${p.line}" stroke-width="1.3"/>
 <path d="M96 76 Q130 72 164 76" fill="none" stroke="#fff" stroke-opacity="${p.sheen*.6}" stroke-width="3" stroke-linecap="round"/>
 <defs>${lamp2Defs(g+"L")}</defs>
 <g transform="translate(18 76) scale(.35 .3)">${lamp4(g+"L",p.line)}</g>
 <g transform="translate(260 0) scale(-1 1)"><g transform="translate(18 76) scale(.35 .3)">${lamp4(g+"L",p.line)}</g></g>
 
 <path d="M38 99 Q130 104 222 99 L216 109 Q130 113 44 109 Z" fill="${p.line}"/>${mesh(p,50,212,101,110)}
 <path d="M28 116 Q130 121 232 116" fill="none" stroke="${p.line}" stroke-width="2.4" stroke-linecap="round"/>`;}

/* REAR · box 260x136 */
function rear(p){const g=nid();return `<defs>${bodyGrad(p,g)}</defs>
 <ellipse cx="130" cy="132" rx="124" ry="7" fill="${p.shadow}" opacity="${p.shOp}"/>
 <rect x="20" y="98" width="30" height="34" rx="7" fill="${p.tyre}" stroke="${p.rimEdge}" stroke-opacity=".6" stroke-width="1.2"/><rect x="210" y="98" width="30" height="34" rx="7" fill="${p.tyre}" stroke="${p.rimEdge}" stroke-opacity=".6" stroke-width="1.2"/>
 <path d="M12 100 Q10 80 28 74 L68 68 Q88 42 130 38 Q172 42 192 68 L232 74 Q250 80 248 100 L248 108 Q248 116 236 116 L24 116 Q12 116 12 108 Z" fill="url(#${g})" stroke="${p.line}" stroke-width="1.8" stroke-linejoin="round"/>
 <path d="M68 68 Q88 42 130 38 Q172 42 192 68" fill="none" stroke="${p.rim}" stroke-width="2"/>
 <path d="M80 68 Q96 50 130 48 Q164 50 180 68 Q130 72 80 68 Z" fill="${p.glass}"/><path d="M140 64 L154 52 L160 52 L146 65 Z" fill="#fff" opacity=".35"/>
 <path d="M70 70 L190 70" stroke="${p.line}" stroke-width="4" stroke-linecap="round"/>
 <path d="M20 84 Q130 76 240 84 L238 90 Q130 83 22 90 Z" fill="#f43f5e" stroke="${p.line}" stroke-width="1.3"/>
 <path d="M24 86 Q130 79 236 86" fill="none" stroke="#fecdd3" stroke-width="1.2"/>
 <rect x="104" y="94" width="52" height="12" rx="3" fill="#fff" stroke="${p.line}" stroke-width="1.3"/>
 <path d="M44 106 L216 106 L210 114 L50 114 Z" fill="${p.line}"/>${mesh(p,60,200,107,114,12)}
 <rect x="62" y="112" width="18" height="7" rx="3.5" fill="${p.tyre}" stroke="${p.rim}" stroke-width="1"/><rect x="180" y="112" width="18" height="7" rx="3.5" fill="${p.tyre}" stroke="${p.rim}" stroke-width="1"/>`;}

/* PROFILE (facing right) · box 320x130 */
function profile(p){const g=nid();return `<defs>${bodyGrad(p,g)}</defs>
 <ellipse cx="160" cy="122" rx="150" ry="7" fill="${p.shadow}" opacity="${p.shOp}"/>
 <path d="M8 88 Q8 74 24 70 L94 60 Q128 30 172 26 L206 26 Q242 30 268 58 L296 64 Q314 68 316 86 L316 98 Q316 106 306 106 L284 106 Q282 82 256 82 Q230 82 228 106 L104 106 Q102 82 76 82 Q50 82 48 106 L18 106 Q8 106 8 98 Z" fill="url(#${g})" stroke="${p.line}" stroke-width="1.8" stroke-linejoin="round"/>
 <path d="M94 60 Q128 30 172 26 L206 26 Q242 30 268 58" fill="none" stroke="${p.rim}" stroke-width="2"/>
 <path d="M108 60 Q132 38 172 34 L182 34 L182 60 Z M190 60 L190 34 L204 34 Q234 38 252 60 Z" fill="${p.glass}"/>
 <path d="M150 56 L168 38 L176 38 L158 56 Z" fill="#fff" opacity=".4"/>
 <path d="M60 76 Q180 70 312 72 L312 76 Q180 74 62 80 Z" fill="#fff" opacity="${p.sheen*.5}"/>
 <path d="M8 66 L40 58 L46 60 L38 64 Z" fill="${p.line}"/>
 <defs>${lamp2Defs(g+"P")}</defs><g transform="translate(316 64) scale(-0.23 0.2)">${lamp4(g+"P",p.line)}</g>
 <path d="M290 90 L314 88 L314 96 L292 97 Z" fill="${p.line}"/>
 <path d="M8 72 L22 70 L22 80 L8 80 Z" fill="#f43f5e"/>
 <path d="M40 88 Q170 80 300 82" fill="none" stroke="${p.trim}" stroke-width="2" opacity=".9"/>
 <path d="M150 66 Q148 88 152 104 M226 64 Q228 80 226 94" fill="none" stroke="${p.line}" stroke-opacity=".25" stroke-width="1.3"/>
 ${rimG(p,76,106,21)}${rimG(p,256,106,21)}`;}

/* REAR THREE-QUARTER (rear-left) · box 330x136 */
function rearTQ(p){const g=nid();return `<defs>${bodyGrad(p,g)}</defs>
 <ellipse cx="170" cy="128" rx="158" ry="9" fill="${p.shadow}" opacity="${p.shOp}"/>
 <path d="M8 96 Q6 84 18 80 L64 74 Q86 70 104 56 Q136 32 176 30 L206 30 Q238 34 262 58 L300 66 Q322 70 324 88 L324 104 Q324 112 312 112 L290 114 Q288 90 264 90 Q240 90 238 115 L146 120 Q144 96 118 96 Q92 96 90 121 L40 120 Q10 118 8 106 Z" fill="url(#${g})" stroke="${p.line}" stroke-width="1.8" stroke-linejoin="round"/>
 <path d="M104 56 Q136 32 176 30 L206 30 Q238 34 262 58" fill="none" stroke="${p.rim}" stroke-width="2"/>
 <path d="M70 72 Q96 52 128 42 L140 42 Q124 56 118 72 Z" fill="${p.glass}"/>
 <path d="M126 72 Q142 50 176 40 L204 40 Q230 44 248 64 Z" fill="${p.glass}"/>
 <path d="M186 40 L184 70" stroke="${p.pillar}" stroke-width="3.5"/>
 <path d="M96 64 L112 50 L118 50 L102 65 Z" fill="#fff" opacity=".4"/>
 <path d="M60 72 L100 66 L98 60 L62 66 Z" fill="${p.line}"/>
 <path d="M12 82 Q38 78 66 76 L94 74 L94 79 L66 81 Q40 84 14 88 Z" fill="#f43f5e" stroke="${p.line}" stroke-width="1.2"/>
 <rect x="24" y="92" width="30" height="10" rx="2" fill="#fff" stroke="${p.line}" stroke-width="1.2"/>
 <path d="M14 108 L64 110 L62 118 L18 116 Z" fill="${p.line}"/>
 <rect x="22" y="112" width="12" height="6" rx="3" fill="${p.tyre}" stroke="${p.rim}" stroke-width="1"/>
 <path d="M96 84 Q200 76 320 80" fill="none" stroke="#fff" stroke-opacity="${p.sheen*.5}" stroke-width="3"/>
 <path d="M96 98 Q200 88 320 88" fill="none" stroke="${p.trim}" stroke-width="2" opacity=".9"/>
 <defs>${lamp2Defs(g+"R")}</defs><g transform="translate(323 68) scale(-0.13 0.16)">${lamp4(g+"R",p.line)}</g>
 ${rimG(p,118,116,21)}${rimG(p,264,110,21)}`;}

/* TOP-DOWN · box 110x200, nose up */
function topView(p){const g=nid();return `<defs>${bodyGrad(p,g,1,0)}</defs>
 <rect x="2" y="30" width="14" height="34" rx="5" fill="${p.tyre}"/><rect x="94" y="30" width="14" height="34" rx="5" fill="${p.tyre}"/>
 <rect x="0" y="136" width="16" height="38" rx="5" fill="${p.tyre}"/><rect x="94" y="136" width="16" height="38" rx="5" fill="${p.tyre}"/>
 <path d="M30 6 Q55 0 80 6 Q98 14 98 44 L100 170 Q100 194 80 198 L30 198 Q10 194 10 170 L12 44 Q12 14 30 6 Z" fill="url(#${g})" stroke="${p.line}" stroke-width="1.8"/>
 <path d="M22 62 Q55 48 88 62 L82 88 Q55 80 28 88 Z" fill="${p.glass}"/><path d="M34 72 L50 58 L56 58 L40 74 Z" fill="#fff" opacity=".45"/>
 <path d="M28 92 L82 92 L84 140 L26 140 Z" fill="${p.glass}" opacity=".9"/>
 <path d="M28 144 Q55 138 82 144 L84 164 Q55 160 26 164 Z" fill="${p.glass}"/>
 <path d="M16 16 Q30 8 42 10 M94 16 Q80 8 68 10" fill="none" stroke="${p.drl}" stroke-width="4" stroke-linecap="round"/>
 <path d="M16 190 L94 190" stroke="#f43f5e" stroke-width="4" stroke-linecap="round"/>
 <path d="M8 76 L14 74 L14 84 L8 84 Z M102 76 L96 74 L96 84 L102 84 Z" fill="${p.mid}" stroke="${p.line}" stroke-width="1.2"/>
 <path d="M55 12 L55 58 M55 168 L55 186" stroke="${p.trim}" stroke-width="3"/>`;}


```

### 5.2 People
```js
/* People: faceless, upright, composed. Box 80 x 180, feet at y=176. */
const INK='#1f2040';
function operator(dark){ // short hair, indigo blazer, phone in hand
  const jacket=dark?'#4f4ccc':'#2e2a8f', trousers=dark?'#1b1a3f':'#1f2040', skin='#d9a88a', hair='#1f2040', line=dark?'#0b0b1a':INK;
  return `<g stroke="${line}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">
   <ellipse cx="40" cy="176" rx="26" ry="4" fill="#000" opacity="${dark?.4:.1}" stroke="none"/>
   <path d="M28 108 L26 170 L38 170 L40 124 L42 170 L54 170 L52 108 Z" fill="${trousers}"/>
   <path d="M24 172 L38 172 L38 176 L22 176 Z" fill="${line}"/><path d="M42 172 L56 172 L58 176 L42 176 Z" fill="${line}"/>
   <path d="M34 42 L46 42 L46 52 L34 52 Z" fill="${skin}"/>
   <path d="M20 58 Q22 48 34 48 L46 48 Q58 48 60 58 L62 112 L18 112 Z" fill="${jacket}"/>
   <path d="M34 48 L40 66 L46 48" fill="#fff"/><path d="M34 48 L40 66 L46 48" fill="none"/>
   <path d="M40 66 L40 110" stroke-opacity=".35"/>
   <path d="M20 60 Q14 86 18 108" fill="none" stroke="${jacket}" stroke-width="9"/><path d="M20 60 Q14 86 18 108" fill="none"/>
   <path d="M60 60 Q66 76 56 86 L48 84" fill="none" stroke="${jacket}" stroke-width="9"/><path d="M60 60 Q66 76 56 86 L48 84" fill="none"/>
   <rect x="40" y="74" width="10" height="17" rx="2.5" fill="${line}" transform="rotate(-12 45 82)"/>
   <circle cx="47" cy="85" r="3.8" fill="${skin}"/>
   <circle cx="18" cy="110" r="3.8" fill="${skin}"/>
   <circle cx="40" cy="30" r="13" fill="${skin}"/>
   <path d="M27 30 Q26 15 40 15 Q54 15 53 28 Q48 22 40 22 Q32 22 27 30 Z" fill="${hair}"/>
  </g>`;
}
function customer(dark){ // tied-back hair, sand jacket, tote bag, reaching out
  const jacket=dark?'#c7d2fe':'#e7dccb', top=dark?'#8b8cf0':'#5b5bd6', trousers=dark?'#2e2a8f':'#3a36a8', skin='#b77e5f', hair='#2a1d1a', line=dark?'#0b0b1a':INK;
  return `<g stroke="${line}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">
   <ellipse cx="40" cy="176" rx="26" ry="4" fill="#000" opacity="${dark?.4:.1}" stroke="none"/>
   <path d="M29 108 L27 170 L38 170 L40 126 L42 170 L53 170 L51 108 Z" fill="${trousers}"/>
   <path d="M24 172 L38 172 L38 176 L22 176 Z" fill="${line}"/><path d="M42 172 L56 172 L58 176 L42 176 Z" fill="${line}"/>
   <path d="M34 42 L46 42 L46 52 L34 52 Z" fill="${skin}"/>
   <path d="M22 58 Q24 48 34 48 L46 48 Q56 48 58 58 L60 112 L20 112 Z" fill="${jacket}"/>
   <path d="M34 48 L40 60 L46 48 Z" fill="${top}"/>
   <path d="M58 58 Q62 84 58 104" fill="none" stroke="${jacket}" stroke-width="9"/><path d="M58 58 Q62 84 58 104" fill="none"/>
   <rect x="54" y="94" width="18" height="22" rx="4" fill="${top}"/><path d="M58 94 Q63 84 68 94" fill="none"/>
   <path d="M22 60 Q10 70 2 70" fill="none" stroke="${jacket}" stroke-width="9"/><path d="M22 60 Q10 70 2 70" fill="none"/>
   <circle cx="0" cy="70" r="3.8" fill="${skin}"/>
   <circle cx="40" cy="30" r="13" fill="${skin}"/>
   <path d="M27 32 Q24 14 40 15 Q56 14 53 32 Q50 20 40 21 Q30 20 27 32 Z" fill="${hair}"/>
   <circle cx="55" cy="22" r="5" fill="${hair}"/>
  </g>`;
}
function key(x,y,c){return `<g transform="translate(${x} ${y})" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"><rect x="-7" y="-10" width="14" height="20" rx="5" fill="${c}"/><circle cx="0" cy="-3" r="2" fill="#fff" stroke="none"/><circle cx="0" cy="-14" r="4" fill="none"/></g>`;}


```

---

## 6. How to make, check and ship

1. **Draft in a scratch HTML file** that loads the code above and composes the scene.
2. **Render with headless Chrome** and look at the PNG before showing anyone:
   ```bash
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
     --hide-scrollbars --force-device-scale-factor=2 --window-size=W,H --virtual-time-budget=3000 \
     --screenshot=out.png "file://$PWD/draft.html"
   ```
3. **Check:** nothing overlaps the text zones; wheels visible; no stray lines; both modes present;
   reads at the real size (320 × 240 card, 360 × 210 empty state).
4. **Deliver previews as PNG files on the Desktop** (`~/Desktop/…png`) and open them — not as artifact links.
5. **In the app (React/TSX):** port the SVG to JSX (`stroke-width` → `strokeWidth`, etc.), gradient ids via
   `useId().replace(/:/g, '')`, both themes via `dark:` classes, `aria-hidden`. Portal v2 work only, behind
   the northwind canary — see `V2_PLAN.md`.
6. No build / tests / commit unless the owner asks.

---

## 7. Mistakes already made — don't repeat

- A top-level JS function named **`top`** silently breaks the page (`window.top` is read-only). Use `topView`.
- **Duplicate SVG ids** (two gradients called the same) make one car render with the wrong paint or
  see-through. Always unique ids.
- React `useId()` returns `:r0:` — **colons break `url(#…)`**; strip them.
- **SVG filter regions clip** drop shadows into hard bands; set `filterUnits="userSpaceOnUse"` with a large
  region, or avoid shadows (preferred — flat style).
- **Art under card text:** the first versions put the car on top of the description. Keep the text zones empty.
- Hood highlight lines drawn past the body show as stray lines in dark mode — keep highlights inside the shape.
- Reusing an image from the storage bucket without looking at it put a **fighter jet** on a card. Look first.
- Don't copy any real brand's character (e.g. Pixar's Lightning McQueen) — draw our own.

---

## 8. Prompt template for any chat

> Read `docs/brand/illustration-guide.md`. Make a **<purpose>** illustration (for example: empty state for
> the Payments page / feature card for "<feature>" / login hero). Use view **<view>**, **<people/props>**,
> in quiet confidence. Give me light and dark versions as PNGs on my Desktop first; do not put anything in
> the app until I approve.
