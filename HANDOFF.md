# Handoff — v2 onboarding UI work

Branch: `haseeb/v2-onboarding-ui` · Branched from `main` at `8045f5be` · 2026-09-08

Everything below is **one commit on this branch**. Nothing was committed to
`main`, and nothing here has been merged.

---

## 0. How to pick this up on the other laptop

The goal is: the code lands in your working tree **on `main`, uncommitted**, so
it shows as "these files have changed and need committing" rather than as
history you have to unpick.

```bash
git switch main
git pull                                        # get main up to date first
git fetch origin

# Copy this branch's files into main's working tree, without merging.
git checkout origin/haseeb/v2-onboarding-ui -- .
git reset                                       # unstage → plain modified files

git status                                      # 45 changed / new files
```

`git checkout <ref> -- .` writes the files and stages them; `git reset` unstages
them. You end up on `main`, with every change sitting in the working tree
exactly as it is on this machine, and **no merge commit and no branch history in
`main`**.

The change set contains **no deletions**, only modified and new files, which is
what makes that one-liner safe — a plain checkout cannot remove files, so
nothing is left behind.

To throw it all away instead: `git checkout -- . && git clean -fd`.

### Do NOT merge this branch into `main`

The team lead's standing rule is no commits on `main`. This branch exists so the
work is backed up on the remote and portable between machines — not as something
to merge. When it is ready to land, that is his call.

---

## 1. What this work is

The team lead's video brief (transcribed in full in section 8) asked for the v2
onboarding experience to be finished: the signup journey, the first-run wizard,
the guided tour, and super-admin control over the content behind them.

Everything is gated to the **`northwind` canary** and changes nothing for the
other 56 tenants. See `V2_PLAN.md` §2 and §3 for why that matters.

**Verification status at the time of writing**

| | |
|---|---|
| `apps/portal` tests | 1762 pass, 11 fail — **all 11 pre-existing**, verified by stashing every change and re-running against `HEAD` |
| `apps/admin` typecheck | clean, and it is the strict app (`strict: true`, no `ignoreBuildErrors`) |
| `apps/admin` build | passes |
| `apps/web` build | passes |
| `apps/portal` typecheck | clean for every file touched |

---

## 2. The two SQL files that still need applying

**Neither has been applied.** Both live in `ops/` rather than
`supabase/migrations/` because the standing rule for this project is that schema
changes go through the Supabase MCP tools — and that server was unreachable
(`CONNECT_TIMEOUT`) throughout this work.

| file | creates |
|---|---|
| `ops/platform_legal_documents.sql` | Terms + Privacy, editable from super admin |
| `ops/first_run_questions.sql` | the first-run wizard's questions, editable from super admin, **seeded with the current five** |

**Everything ships safe without them.** Every reader falls back:

- `apps/web` `/terms` and `/privacy` serve the documents compiled into the site
- the portal wizard asks the five questions in `lib/first-run-questions.ts`
- both admin pages show a plain "table not created yet" notice, prefilled with
  the live content, instead of an error

So applying them is a deliberate step someone takes when ready, not a
prerequisite for this branch to be correct.

There is a **third**, pre-existing one, not created by this work:
`supabase/migrations/20260904120000_add_tenant_first_run.sql` is committed but
has only ever been applied to **staging**. That is why `/dev` → "First-time
operator" and "Full signup journey" do nothing against production. See §5.

---

## 3. What changed, by area

### 3.1 The tour — `apps/portal/src/components/onboarding/first-rental-tour.tsx`

The most-iterated file here. Several fixes stacked, each from a specific
complaint:

- **Backdrop blur.** The tour had a 45% dim and **no blur at all**, so every
  card, table row and sidebar label behind it stayed readable. Now
  `SCRIM` + `SCRIM_BLUR` (5px), with the dim reduced to 0.38 so blur and dim do
  not stack into fog.
- **The spotlight was rebuilt** after a judged design panel (four independent
  proposals, three judges; "Lifted Pane" won). It is now a cast shadow, a
  layered rim (white hairline → indigo band → hairline), an interior indigo
  wash, and a soft bloom — instead of a flat `ring-2` on a bright cut-out.
- **Oversized anchors degrade.** Past **66% of the viewport** a step drops the
  spotlight and uses the centred wash. A rim around the whole screen points at
  nothing. This came from the Booking-site step, which anchored to the entire
  Brand Identity card.
- **The card can never overlap the spotlight.** `placeCard()` returns only a
  placement that is both fully on screen AND clear of the spotlight, with a
  10px margin, and **no fallback and no clamping** — the old code chose well and
  then clamped the result straight back on top of the anchor.
- **Elevated anchors hug.** `getComputedStyle(el).position === 'fixed'` decides
  the padding: 0 for a floating panel, 12px for in-page content. A padded hole
  around the Setup guide dock revealed the dashboard *behind* it, sharp and
  undimmed — which read as a stray card wedged underneath.

**Two things recorded in comments so nobody re-derives them the hard way:**

1. An outer `box-shadow`'s inner edge **cannot** be feathered at any blur
   radius — the 9999px spread pushes its blurred perimeter off-screen, so
   `0 0 28px 9999px` renders pixel-identical to `0 0 0 9999px`. Three separate
   design agents proposed it; all three were wrong.
2. A `BLUR_FEATHER` ring (blur hole cut wider than the dim hole) leaves a band
   that is dimmed but **not** blurred. Around a floating panel that band shows
   the page behind it. It was tried and removed.

### 3.2 The tour's step data — `apps/portal/src/lib/first-rental-tour.ts`

The `booking-site` step now anchors to `[data-tour="settings-tab-branding"]` —
the **Branding row in the settings rail** — instead of the whole Brand Identity
card.

Root cause worth knowing: the step already had a small-element fallback,
`[id$="-trigger-branding"]`, but that addresses Radix's generated `TabsTrigger`
id from the **v1** settings page, which the v2 sidebar replaced. It matched
nothing, so every run silently fell through to the oversized card. A dead
selector, failing invisibly.

`data-tour="settings-tab-{value}"` was added to **every** settings nav row in
`app-sidebar-v2.tsx`, so a future step can point at any of them.

### 3.3 The first-run wizard — `apps/portal/src/components/onboarding/first-run-wizard.tsx`

- **Blurred, calmer backdrop.** Was fully opaque; now a translucent scrim with
  `backdrop-blur-2xl`.
- **`LiquidWash` fixed.** It drew two *mismatched* blobs (46rem vs 42rem,
  `-top-48 -right-40` vs `-bottom-56 -left-48`) that **drifted to a new position
  on every step** via `Math.sin(step)`. That was the "noise" and the asymmetry
  in the brief — the background moved exactly when the eye should have gone to
  the new question. Now identical size, mirrored on both axes, completely
  static.
- **Wider content column** (`64rem → 76rem`).
- **Questions come from the database**, via the new
  `hooks/use-first-run-questions.ts`, falling back to the compiled list.
- **The whole-wizard skip is gone.** "Skip for now" called `finish(true)` and
  ended onboarding from any step, which made `required` decorative. It is now
  **"Skip this question"**, appearing only on a question the author marked
  optional, and advancing one step.

> ⚠️ **Trade worth flagging to the lead.** With no whole-wizard escape, a badly
> published question set could lock a new operator out of their dashboard. He
> asked for this explicitly ("they should never be able to skip the whole
> thing"), so it was done — but he should know the risk he accepted. The admin
> page warns when every published question is required.

### 3.4 Signup journey — `apps/web/src/components/signup-journey/**`

- **The stray line removed.** A 2px progress rail spanned the full width of the
  panel, flush to the rounded corners; at 25% it read as a coloured line snagged
  on the top. Progress is now **four segments beside "STEP 1 OF 4"**, where the
  words explain it.
- **Scrolling removed on the account step** (~520px recovered): both dividers
  deleted, credential and business fields put **side by side from `md`**, social
  buttons paired, vertical rhythm trimmed. Panel widened to `62rem` / `96dvh`.
- **Sticky submit** on the account and payment steps, so the primary action is
  never the thing clipped by a short window.
- **Scrollbar hidden** via a new `.scrollbar-none` utility in `globals.css`
  (`scrollbar-width: none`, not `overflow: hidden` — the region still scrolls by
  wheel, trackpad, touch and keyboard).
- **Provisioning screen paced**. Was a fixed 420ms per milestone (~3.4s), which
  ticked like a metronome. Now per-milestone dwells summing to **~12.4s**, with
  `brand_ready` longest at 3.2s because it genuinely is the slowest (it calls
  OpenAI, and is already named `SLOW_MILESTONE`). **The durations live in the
  journey step, NOT in `onboarding-types.ts`** — that module is shared with the
  live signup, which advances only on server confirmation.
- **"You're live" shows both addresses** — portal *and* booking site — in a
  bordered panel. The old screen named only the portal, so the thing an operator
  most wants at that moment, their public URL, was the one thing missing.

> ⚠️ **The payment step still scrolls, and no code can fix it.** The Stripe
> Payment Element is a cross-origin iframe; with **Link** enabled it adds a
> ~420px "Save my information" block. Verified against the installed
> `@stripe/stripe-js` types: there is **no display toggle** —
> `paymentMethodTypes: ['card']` does not suppress Link's inline signup, and the
> only `link` key is `setup_future_usage`. **The fix is one Stripe Dashboard
> setting**: turn Link off for the account. A nested `max-h` scroll was tried
> and reverted — it put the sticky button on top of the element's own fields.

### 3.5 Super admin — two new tabs

Both under **Configuration** in `apps/admin`:

| tab | route | file |
|---|---|---|
| Legal Pages | `/admin/legal` | `app/admin/(protected)/legal/page.tsx` |
| Onboarding Questions | `/admin/onboarding-questions` | `app/admin/(protected)/onboarding-questions/page.tsx` |

Both **prefill with the content that is live right now** rather than opening on
an empty form. Those defaults are **generated, not transcribed**:

- `lib/legal/default-documents.ts` — all **50 ToS sections** serialized from
  `apps/web/src/lib/legal/platform-tos.ts` (its four block types → markdown),
  plus the privacy policy converted from its JSX
- `lib/onboarding/default-questions.ts` — from
  `apps/portal/src/lib/first-run-questions.ts`

Generating rather than retyping matters for the ToS specifically: its own header
says *"This is legal copy. Do not reword, 'clean up', or fix apparent typos
inline."*

**Legal Pages** also warns when the published Terms `version` differs from
`STAMPED_TOS_VERSION` — the string `create-subscription-checkout` records
against every signup. `supabase/functions/_shared/platform-tos.ts` was **not**
edited: V2_PLAN §7 forbids changing a shared helper that four edge functions
import, so the drift is made *visible* instead.

**Onboarding Questions**: add / remove / reorder, per-question **Required**,
Live/Draft, and the answer key **locks once saved** (renaming it orphans every
answer already collected under the old one). No submissions view — ruled out
explicitly, and not building it means the page never reads another operator's
answers.

### 3.6 Smaller fixes

- **`/dev` actions failed silently on production.** `resetFirstRunRow` treated
  *any* database error as a failed reset — including "table does not exist",
  which is what `tenant_first_run` is on prod. Now a missing table returns
  `{ ok: true, absent: true }`: a table that does not exist holds no row, so
  there is nothing to clear and nothing has gone wrong. **An RLS refusal is
  still a hard failure** — that distinction must not collapse, or the wizard
  stays dark while the page claims it was reset.
- **The `/dev` status line was rendering below the fold**, after the Empty
  States section — so a failing action looked like a dead button. Moved above
  the actions.
- **`v2/apps/web` dev port `3000 → 4006`**, matching what
  `apps/portal/src/lib/site-v2-url.ts` looks for. Running `npm run dev` there
  used to start it on the wrong port and the CMS editor silently fell back.
- **`kill-dev-ports.mjs` now scans `v2/apps` too** — 4006 was previously freed
  by nothing, so a crashed server could not be restarted without a manual kill.
- **New root script `npm run dev:site`** → starts `v2/apps/web` on 4006.
- **`apps/portal/src/lib/site-v2-url.ts`** was missing from `main` entirely
  (imported but never committed), breaking every `/cms/*` route. Upstream landed
  the real one in `8045f5be`; mine was discarded.
- **"Important" pill contrast.** `bg-destructive/15 text-destructive` on the
  **brand gradient** composited into a muddy plum with almost no luminance
  contrast. Now a solid red chip with white text and an inset ring — still
  unmistakably red, legible on any brand colour.
- **Connect-Stripe dialog** widened to `34rem`, icon moved to its own tile,
  `pr-8` so the description clears the "×", and the three same-weight footer
  buttons regrouped.
- **`ui-v2` overlays** (`dialog`, `alert-dialog`, `sheet`, `drawer`)
  `backdrop-blur-sm → md`. Verified `components/ui/dialog.tsx` (v1) is a
  separate file on its own Radix primitives — **v1 tenants are untouched**.

---

## 4. Local setup for the other laptop

**Never use ports 3000–3005.**

| app | port | command |
|---|---|---|
| booking (v1) | 4001 | `npm run dev:booking` |
| portal | 4002 | `npm run dev:portal` |
| web (marketing) | 4003 | `npm run dev:web` |
| admin | 4004 | `npm run dev:admin` |
| bonzah | 4005 | `npm run dev:bonzah` |
| **v2/apps/web — the site the CMS edits** | **4006** | `npm run dev:site` |

Typical session:

```bash
npm run dev:staging     # portal on 4002, pointed at the staging database
npm run dev:site        # 4006 — required for the CMS visual editor
npm run dev:web         # 4003 — required for the signup journey
```

Then open **`http://northwind.portal.localhost:4002`** — never bare
`localhost:4002`.

Two independent reasons the subdomain is required: the portal resolves its
tenant from the hostname (`apps/portal/src/proxy.ts`), and the v2 site's overlay
only answers a parent matching
`/^https?:\/\/[a-z0-9-]+\.portal\.(drive-247\.com|localhost)(:\d+)?$/i`.

`*.localhost` resolves to 127.0.0.1 in every current browser — no `/etc/hosts`
entry needed.

### Gotchas that cost real time

- **"This page can't be edited in place yet"** means *the site never answered*,
  not *the feature is missing*. It is almost always `v2/apps/web` not running on
  4006.
- **`Unable to acquire lock at apps/portal/.next/dev/lock`** — a stale dev
  server is still alive. The lock is per app directory, not per port, so killing
  the port you *think* it is on will not release it:
  `fuser -k 3001/tcp && rm -rf apps/portal/.next`
- **`npm run dev:staging` vs `dev:prod`.** `dev:staging` is where
  `tenant_first_run` exists, so it is the only place `/dev` → "First-time
  operator" works. But staging shares production's Stripe **test** account and
  its webhooks fire into **prod** — do not chase a "payment didn't settle" bug
  there.
- The signup journey's verification code is **`0000`** (four digits).

---

## 5. Known-outstanding, in priority order

1. **Apply the two `ops/*.sql` files** (§2). Needs Ghulam + a working MCP.
2. **`20260904120000_add_tenant_first_run.sql` has never been applied to
   production.** Until it is, `/dev` onboarding actions only work against
   staging.
3. **Turn Link off in the Stripe Dashboard** so the payment step stops
   scrolling (§3.4).
4. **A live-looking `sbp_` Supabase *Management* token is committed** in 7
   tracked files across 6 commits — `.claude/settings.local.json`,
   `DEPLOYMENT_COMPLETE.md`, `QUICK_START.md`, `STRIPE_MODE_TESTING.md`,
   `force-migration.js`, `scripts/run-migration-manual.sh`,
   `scripts/test-stripe-mode.sh`. Pre-existing, not from this work.
   `V2_PLAN.md` §8 claims this token is *"deliberately not stored in this
   repo"* because *"it can delete any project on the account"*. **That claim is
   false and the token wants rotating.**
5. **`npm run v1:check` cannot pass at `main`** — 4 BREAKING `EDGE FNS`
   findings; the repo is well past its last re-baseline.
6. **The signup flow is dormant.** `<PricingSection>` is rendered nowhere on the
   marketing site — the only reference is inside the dev-only preview. There is
   currently **no way to sign up on the real site**. See §6.

---

## 6. The "make it functional" thread — read before starting

The team lead said the onboarding work is *"only complete when I can open the
landing page locally, come in, create my account, and a proper tenant gets
created."*

There are **two separate signup flows**, and this is easy to miss:

| | `/signup-preview` | the real one |
|---|---|---|
| where | dev-only route on 4003 | the Pricing section (not mounted anywhere) |
| shell | `signup-journey.tsx` | `onboarding-dialog.tsx` |
| edge functions | **calls none** | `signup-begin`, `signup-slug-check`, `signup-payment-intent`, `signup-provision` |
| creates | **nothing** | a real auth user, tenant, subscription |

**All of the UI work in this branch is on the preview shell.** The two share
only `onboarding-types`, `password-toggle` and `TenantIdentityFields`.

So "functional" is three jobs: mount the entry point, port the shell
improvements onto `onboarding-dialog.tsx`, and run it once for real until
`signup-provision` inserts a genuine `tenants` row.

**Worth deciding before touching it:** unify the two shells behind a mock/live
flag, or keep them separate and mirror the styling? Mirroring guarantees they
diverge again on the next UI change. That is the lead's call.

---

## 7. Drift found in `V2_PLAN.md`

A verification pass (21 agents, adversarially checked) ran every load-bearing
claim in `V2_PLAN.md` against the repo. **Treat its prose as authoritative and
its numbers and code samples as unreliable.**

| claim | reality |
|---|---|
| "Neither `@/lib/v2` nor `@/lib/tenant-server` exists yet" (§3) | both exist, 7 commits deep — following it literally would clobber live files |
| §3's sample imports `tenantIdFromHeaders` | the real export is `tenantSlugFromHeaders`; the sample would not compile |
| §2's code sample | its `Record<string, …>` **throws** on an unknown area, violating §2's own "fails to v1" rule |
| 324 edge functions | **321** |
| 67 with `verify_jwt = false` | **63** — and 67 was never right; it counted 5 prose comment lines |
| 1,930 v1 source files | 1,999 in the baseline |
| `queue_for_rag()` on 4 tables | **6** — also `fines` and `plates` |
| 5 reserved subdomains | **6** — `bonzah` missing (also wrong in `CLAUDE.md`) |
| `web`/`bonzah` `ignoreBuildErrors: —` | both are **`true`**; only `admin` fails a build on a type error |

Claims that were challenged and **survived**: the divergence figures
(1,420 files / 333,232 deletions), the `.from()` call-site counts, the
`booking_v2_enabled` description, and §10's removal-completeness reasoning.

`V2_PLAN.md` also states flatly *"there is no staging"*, while `dev:staging`, a
staging Supabase project and staging-only migrations all exist.

---

## 8. The original brief

The team lead's video, translated from Urdu/Hindi. Condensed to the
instructions; timestamps are from the original.

**Priority** — the whole week is V2-focused, above support work.

**The signup form** *(02:04–03:22)*
- The UI "breaks" partway down; there is an **ugly line — remove it**
- **No scrolling in any dialog.** The dialog may get bigger. Compact, not noisy
- Business name + web address, email + password all fine as they are
- **Google sign-up must work today**; report if Apple is hard
- "This form must have no mistakes — neither functionally nor UI-wise"

**Terms and privacy** *(04:46–05:43)*
- The consent tick is **mandatory** — the button stays disabled until it is on
- **Both documents must be editable from a tab inside super admin**

**The questions** *(07:00–07:52, 09:06–09:30)*
- Ask them in the portal after handoff; put them in a proper order
- **Controllable from super admin** — add, remove, "the whole scene"
- **"I don't need to see their submissions"**
- Mark **which questions can be skipped and which cannot**
- **"They should never be able to skip the whole thing"**

**The "preparing your site" screen** *(07:57–09:06)*
- A deliberate **five-to-seven second** wait *(later raised to 10s+)*
- Friendly, slightly funny copy naming what is being set up
- Then straight to the dashboard, confetti on arrival

**Visual system** *(09:30–10:38)*
- **Blur what is behind**; the background is too noisy and asymmetric
- Make the dialog bigger
- **"Big, bold, minimal, breathable is our vibe"**

**The tour** *(10:38–12:50)*
- Blur behind it too — **slightly**, not a blackout
- Kill the loading pill that appears mid-navigation
- The highlight "looks really bad" — *"use your own UI sense"*
- **Keep it short.** Don't navigate far
- Content: show the tabs → add a Customer → add a Vehicle → create a Rental

**The checklist card** *(13:11–14:15)*
- Turn the dashboard card into a **setup checklist** (Bonzah, etc.)
- Each item carries a **video**, opening in a **normal-size dialog with the
  background blurred**
- Generic for now

**Scope** *(03:34–04:46, 14:47–15:31)*
- On Northwind everything stays **mocked**, so it can be re-simulated freely
- But the task is **only complete** when a real tenant can be created end to end
  with a real payment
- *"Work with a product mindset, not a developer mindset"*

---

## 9. Files changed

45 files. `git diff --stat main..haseeb/v2-onboarding-ui` for the full list.

New files:

```
ops/platform_legal_documents.sql
ops/first_run_questions.sql
apps/admin/app/admin/(protected)/legal/page.tsx
apps/admin/app/admin/(protected)/onboarding-questions/page.tsx
apps/admin/lib/legal/default-documents.ts
apps/admin/lib/onboarding/default-questions.ts
apps/portal/src/hooks/use-first-run-questions.ts
apps/web/src/components/legal/published-legal-document.tsx
apps/web/src/lib/legal/legal-documents-server.ts
HANDOFF.md
```
