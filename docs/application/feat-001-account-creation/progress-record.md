# feat-001 · Account creation — progress record

**Branch:** `ray2` · **Built by:** Hamza · **Last updated:** 27 Nov 2026
**Status:** steps 1–5 done and committed locally.
Nothing pushed, nothing deployed to staging. More than half of the build is done: the 3-step
signup and the portal window work end to end locally. Left: the sign-in code (6), Google linking
(7), the signups list (8), and the real-phone QA report (9), the biggest part left.

What each finished step changed: how it was before, what is new, how it works now, and how it was
proved. The plan for the whole feature is in the PRD (`docs/application/PRD.md`, feat-001) and the
specs (`specs/`).

---

## The plan, and where it stands

| # | Step | Status | Commit |
|---|---|---|---|
| – | PRD section, 9 specs, evals | Done | `a0281aff`, `13d2f0fe` |
| 1 | Safe temporary passwords for invited staff | **Done** | `728cf4b1` |
| 2a | BF30 / promo math in one place | **Done** | `ce170a44` |
| 2b | Card step shows the server's figures; coupon length fixed | **Done** | `546b91f9` |
| 3 | Server side of the portal "verify your email" window | **Done** | `5db8d77e`, `d353164a` |
| 4 | Signup in 3 steps (About you → Business → Card) | **Done** (needs 2 Supabase settings to go live) | `3d349f6d` |
| 5 | The verify-and-password window in the portal, reminder, 3-day block | **Done** (tested locally) | `545d1b3e` |
| 6 | "Email me a sign-in code" on the portal login | Not started | |
| 7 | Connect / disconnect Google in the profile | Not started | |
| 8 | Signups list: new step names | Not started | |
| 9 | QA report on real phones, then the pull request | Not started | |

---

## Step 1 · Safe temporary passwords for invited staff

**Before.** When an operator adds a staff member on the portal's Users page, the portal makes a
16-character temporary password. Every character was picked with `Math.random`, which is not secure:
its output can be predicted.

**New.** Every character, and the shuffle, now comes from the browser's secure random generator
(`crypto.getRandomValues`), with no bias toward any character.

**How it works now.** Nothing changes for the operator. The password is still 16 characters with an
uppercase letter, a lowercase letter, a number and a symbol, shown once, and the staff member must
change it at first sign-in.

**Proved by.**
- 100,000 generated passwords: all in the right format, all different, every allowed character used,
  no character more likely than another.
- In the local portal: created a staff member, signed in with the password it showed, then deleted
  the test person.
- Eval 06: 7/7.

**File.** `apps/portal/src/app/(dashboard)/users/page.tsx`

---

## Step 2 · BF30 and promo code math

### What BF30 is

Black Friday offer: a new operator gets **30% off their first 3 monthly bills**, after the 14-day
free trial. It switches itself off on 30 Nov 2026, 11:59pm ET.

### How it works (before and after)

1. The landing page puts BF30 in automatically during the offer and shows a preview price on the
   pricing cards.
2. At the card step, the browser asks our server (`signup-payment-intent-v2`) for the plan and code.
3. The server checks the code, then gives Stripe **the plan at full price** plus **a coupon: 30% off
   for 3 months**, and the 14-day trial.
4. Stripe does the charging itself:

| Date (signup 26 Nov, Growth $229) | Stripe charges |
|---|---|
| 26 Nov | $0 (trial, card saved) |
| 10 Dec, 10 Jan, 10 Feb | $229 − 30% = **$160.30** |
| 10 Mar onwards | **$229.00** |

This part was **already working before** (built by Neema). Steps 2a and 2b did not change it for
today's plans.

### What was wrong underneath (found while checking Ghulam's section 6)

| Problem | Effect |
|---|---|
| The price was worked out in **two places**: on the screen, and on the server for Stripe | They could drift apart, and the customer would see one price and pay another |
| The coupon length was "**trial days ÷ 30**" months | With a 30-, 60-, 61- or 90-day trial, 2 or 4 bills were discounted instead of 3 (3.0% of signup-day × trial cases). Today's 14-day trials were not affected |
| The screen's preview used floating-point rounding | Could show **half a cent** for some prices (today's prices do not trigger it) |

### Step 2a · New: the math in one place

`supabase/functions/_shared/platform-promo-rules.ts` now holds:

| Function | Does |
|---|---|
| `promoBillCents` | One discounted bill in whole cents, half up ($229.00 × 70% = $160.30). Never below $0. Refuses half cents, over 100%, negatives |
| `paidBillDates` | The bill dates: trial end, then monthly; the 31st falls on a short month's last day; leap years |
| `couponMonthsFor` | How many months the Stripe coupon must run so **exactly 3 paid bills** are discounted, from the real dates |
| `discountedBillDates` | Which bills that coupon really discounts |
| `signupBill` | What the card step shows: due today, first charge and date, discounted bill, full price |

### Step 2b · New: wired in

- The server uses `couponMonthsFor` for the coupon, and sends a `bill` with the figures to the card
  step.
- The card step's BF30 box shows the **server's** figure.
- The screen's previews round to whole cents exactly like the server.
- The old "trial days ÷ 30" functions were removed.

### Before / after

| | Before | After |
|---|---|---|
| Full price + 30% coupon sent to Stripe | Yes | Yes (unchanged) |
| Coupon length, 14-day trial | 3 months | **3 months (identical)** |
| Coupon length, 60- or 90-day trial | One extra discounted bill | Exactly 3 discounted bills |
| Where the price is worked out | Screen and server separately | One place; the screen shows the server's figure |
| Half-cent previews | Possible | Never |

### Proved by

- **18 rows worked out by hand** in spec 08 (all 3 plans, 14/30/60/90-day trials, month end, leap
  day, fixed discounts, rounding) run in Vitest: all pass.
- A sweep of every signup day over 3 years × every trial length 0–90 days: old rule wrong in 3.0%,
  new rule in 0.04%, **never** with today's 14-day trial.
- **The real server coupon code run in Deno** against a fake Stripe: 8/8. Run once against the old
  code: the 60- and 90-day cases fail ("expected 4, got 5", "expected 5, got 6").
- The real signup function compiles in Deno with every import.
- **In Chrome, locally:** pricing cards and the card step show $90.30 / $160.30 / $244.30,
  $0 today, first payment 10 December; changing plan moves the discount to the new price.
- **A real test signup** (local site → staging → Stripe test mode, test card 4242): Stripe accepted
  the card, charged $0, the subscription is trialing until 10 Dec with BF30 attached. The test
  company was deleted afterwards and its Stripe subscription cancelled.

### Open

- **Long trials (for Ghulam).** A coupon counted from signup cannot give exactly 3 discounted bills
  when someone signs up on the 29th–31st with a trial of 30+ days (44 of 99,645 cases). Either no
  plan will have such a trial, or the coupon must start at the trial's end (a Stripe subscription
  schedule). No current plan is affected.
- **Stripe dashboard check.** Ghulam asked to compare with the Stripe test dashboard and the invoice.
  That needs the staging deploy and a dashboard login.

---

## Step 3 · Server side of the portal "verify your email" window

**Before.** Signup is 5 steps: About you → Business → **email code** → **password** → Card. The
email code is checked by `signup-verify-otp`, which works by email address, without a sign-in.

**New.** Two server functions for the coming 3-step signup, where the person lands in their portal
first and proves their email and picks a password there:

| Function | Does |
|---|---|
| `signup-verify-email` (sign-in required) | **Check the code**: right = email proved; wrong = tries left; 5 wrong = locked; older than 30 min = expired. **Send a new code**: once per 60 s, old code stops working. **"Wrong email?"**: refuses a broken, same or taken address; changes the email; sends the code only to the new address |
| `signup-set-password` (sign-in required) | Saves the first password (8+ characters, a letter and a number), only **after** the code, only once |
| `_shared/signup-account-rules.ts` | The two "still to do" flags, the password rule, the email check |

**How it works now.** Nothing visible yet: the window that calls these is step 5. The old
`signup-verify-otp` is **left untouched**, because today's live signup still uses it; changing it
would break signups on staging. It is retired in step 4.

**Proved by.**
- Both real functions run in Deno against an in-memory login service and a fake email sender:
  **20/20**: every server rule in spec 03, plus edge cases (browser CORS check, GET refused, broken
  request body, codes with spaces or letters, one person's sign-in never touching another account,
  a new code after a lock or expiry, the full wrong-email → new code → password journey, email
  sending down, exact password length limits, accounts with no flags, flags read fresh).
- The fake login service checked against **staging's real Supabase login service** with throwaway
  accounts (deleted after): saving one flag keeps the rest; a taken email is refused with an error
  the function recognises; a new password replaces the stand-in at once; a free email is accepted.
  8/8.
- Both compile in Deno.

**Fixed during testing.** When the email sender was down, "Send a new code" failed but still
started the 60-second wait, so the person had to wait a minute to try again. A failed send no longer
starts the wait.

---

## Step 4 · Signup in 3 steps

**Before.** Signup is 5 steps: About you → Business → Email code → Password → Card. The progress
bar has 5 dots. After the card, the person is sent to the portal's login page (a one-time sign-in
link only if a setting is switched on), at an address hard-coded to the production portal.

**New (written).**

| Part | Change |
|---|---|
| `signup-begin` | The account is created ready to sign in, with two flags: email still to confirm, password still to choose. The code is always emailed, so it waits in the inbox for the portal window. The old code on/off switch is removed. An older browser still works with this server (it shows the password screen and skips the code) |
| Signup in the browser | After "Your business" it goes straight to the card: no code screen, no password screen |
| Progress bar | 3 dots: "Step 1 of 3: You", "Step 2 of 3: Your business", "Step 3 of 3: Card" |
| Landing page test mode | Answers like the new server |
| `signup-provision` | Always makes the one-time sign-in link to the portal (there is no password now). The portal address comes from the shared portal-domain setting instead of the hard-coded production address |

**Proved by.**
- **The real `signup-begin` run in Deno** against an in-memory Supabase and a fake email sender:
  **9/9** (account ready to sign in with the stand-in, both flags set, no code screen, the emailed
  code is the stored one, signup continues if the email fails, a taken email or portal staff refused
  with no second account, honeypot makes nothing, bad email or weak password refused). Run once
  against the old `signup-begin`: 4 of them fail, as they should.
- **In Chrome, locally (test mode):** About you → Your business → straight to Card ("Step 3 of 3:
  Card", 3 dots), no code or password screen; the card step shows $90.30 / $160.30 / $244.30 and
  $0 today as before.
- All local Deno tests still pass together: **37/37**. Spec 08 unchanged (12/13, the open
  long-trial case).
- `signup-begin` compiles in Deno; the changed web files have no syntax errors. `signup-provision`
  has 3 type errors that were already in the committed code; the change adds none.
- Spec 01 and eval 01 updated to match: the browser signs itself in with the stand-in, rather than
  the server handing back a session.

**Before it works on `ray2` or staging:** the two Supabase settings in "Waiting on Ghulam".

**Note.** During testing, a real signup ran against staging by mistake (test mode was not on yet),
creating the test account `mock-3step@example.com`. It never reached the card and was deleted.

---

## Step 5 · The "check your email, then choose a password" window in the portal

**Before.** Nothing in the portal asked a new operator to prove their email or choose a password.

**New.**

| Part | What it does |
|---|---|
| The window (`verify-account-dialog-v2.tsx`) | "Check your email": 6 code boxes (number keyboard, the phone's code autofill), wrong code shows tries left, "Send a new code" with a countdown, "Wrong email?" to correct the address. Then "Choose a password" with the signup rule (8+, a letter, a number) |
| When it shows (`lib/signup-verify.ts`) | Every visit while a flag is set; after the first-run questions and after any tour; "Not now" until 72 hours after signup ("3 days left"…), then it cannot be closed |
| Password panel | The portal's own `PasswordChangePanelV2` reused, with two new options (signup rules, password only). The profile's use of it is unchanged |

**Proved by (all local; nothing deployed).** The 2 server functions were run on this laptop with
Deno against staging's data (emails printed, not sent), and the local portal pointed at them by a
development-only setting. A test staff member on staging's northwind was used.

| Case | Result |
|---|---|
| Window waits for the Trax tour, appears when it closes | ✅ (after fix 1) |
| "3 days left" straight after signup | ✅ (after fix 2) |
| Wrong code → "That code is not right. 4 tries left." | ✅ |
| Send a new code → countdown; old code refused; new code works | ✅ |
| Wrong email? → wait while a code was just sent; broken address stopped; taken address refused; good address changes it and the code goes only there | ✅ (after fix 3) |
| Portal staff record follows the corrected email | ✅ (after fix 4) |
| Right code → "Choose a password" | ✅ |
| Too-short password / passwords that don't match → Save disabled | ✅ |
| Save password → stays signed in; old temporary password refused, new one works; flags cleared | ✅ (after fix 5) |
| Not now → closes; reload → back, at the step they were on | ✅ |
| 3 days passed → no close, no Not now, Escape and clicking outside do nothing | ✅ |
| Done → never shows again | ✅ |
| Console errors from the window | None (only a browser extension's warning) |
| Spec 04 rules (Vitest) | 3/3, 17 checks |
| Step 3 functions (Deno) | 20/20 |

**Found and fixed while testing.**
1. The window opened underneath the Trax tour card. It now waits for any tour on screen.
2. "2 days left" straight after signup (rounded down). Days now count up: "3 days left".
3. A taken address showed a generic error: real Supabase answers "Error updating user", not
   "already registered". The function now looks the address up first.
4. "Wrong email?" left the portal's staff record on the old email. It now follows.
5. Saving the password signed the person out (Supabase ends sessions on a password change). The
   window now signs them straight back in.

**Edge cases, second round (also local).**

| Case | Result |
|---|---|
| 5 wrong codes on screen: "4 tries left" … "1 try left" → "Too many tries. Ask for a new code."; the right code is refused after that | ✅ |
| Code older than 30 minutes → "That code has expired. Ask for a new one." | ✅ |
| Email sending down → "We could not send the code. Please try again.", and "Send a new code" is ready again at once | ✅ |
| An account without the flags (staging head admin) never sees the window | ✅ |
| Phone 360 wide: window fits, nothing sticks out, buttons 44px | ✅ (after fixes 6 and 7) |
| Phone 430 wide: both steps fit | ✅ |
| Double tap on "Save password" → sent once | ✅ |
| Two tabs: the out-of-date tab moves on to the password step by itself | ✅ |
| Signed out mid-way (password changed in another tab) → sent to the login page, not stuck | ✅ |
| Dark mode: readable | ✅ |
| 3-day block while a tour shows: the tour is on top (layer 65 over 50), the block waits underneath | ✅ by the code; the tour could not be brought back live |
| Waiting for the first-run questions screen | Not reproduced: it only shows for a company that has not answered it; covered by the same rule as the tour |

6. At 360 wide the code boxes and the Verify button ran past the window's edge (6 fixed 44px boxes
   need 304px; the window has ~280). The boxes now share the space (shared code-box part, so the
   profile's code boxes benefit too), and the window's content may shrink; long emails wrap.
7. "Not now" and "Save password" were 32px tall on a phone; now 44px.

Outside this task, for Ghulam: the **Trax tour card is cut off at 360 wide**.

**Clean-up.** The test staff member could not be deleted (the portal's audit log refers to it,
and audit entries are kept), so it was deactivated through the portal's own function and its
password set to an unknown random one.

---

## Waiting on Ghulam

| # | Question | Why it matters |
|---|---|---|
| 1 | **Redirect allow-list**: add the portal addresses to Supabase Auth's allowed redirects (empty on staging) | Without it, the sign-in link after payment lands on `localhost:3000` instead of the portal |
| 2 | **Portal domain per environment**: `ray2` and staging share the same edge functions, so one `PORTAL_ROOT_DOMAIN` cannot send each to its own portal | Staging signups were being sent to the production portal |
| 3 | **PRD decisions** to confirm: Google with a different email refused; changing email disconnects Google; "Email me a sign-in code" for locked-out users; 3 days counted from signup; invited staff keep the temporary-password flow | These are my proposals, built into the specs |
| 4 | **BF30 long trials**: will any plan have a trial of 60+ days? | If yes, the coupon must start at the trial's end so it is always exactly 3 bills |
| 5 | **Keep the extras?** Step 1 (staff passwords) and the code fixes in step 2 were not asked for | He decides whether they stay |
| 6 | **OK to deploy** the signup functions to staging once steps 4–6 are ready | Staging is shared with Haris and Hamna |
| 7 | **The new 7-card quick tour** (being built by someone else) should carry a mark like `data-first-rental-tour`, so the verify window can wait for it | The window reads the page to know a tour is showing |

---

## Work left (from Ghulam's document)

| # | What | Size |
|---|---|---|
| 6 | "Email me a sign-in code" on the portal login page | Medium |
| 7 | Connect and disconnect Google in the profile | Medium–big |
| 8 | Signups list in Super admin: new step names | Small |
| – | Deploy steps 3–6 to staging together | Small |
| 9 | QA report: section 4 on a real iPhone, Android, inside Instagram and Facebook, then a laptop; Stripe dashboard check | Big |
| – | Pull request from `ray2` | Small |

---

## Found along the way (for Ghulam, outside these steps)

| # | Finding | Where |
|---|---|---|
| 1 | **Stuck at "Check your inbox."** An already-confirmed signup reopens on the code screen; the code is spent and "Send a new code" is refused. Only "Use a different email" gets past it | Live 5-step signup |
| 2 | **A staging signup sends people to the production portal** (`{slug}.portal.drive-247.com`), where the staging company does not exist. Step 4 makes it use the portal-domain setting; the setting itself is waiting on Ghulam | `signup-provision` |
| 3 | Plan list shows **"1â€"5 vehicles"** instead of "1–5 vehicles" (garbled dash in the plan data) | Card step, staging data |
| 4 | **staging.drive-247.com shows no Black Friday offer**: its deployed site looks older than the code | Staging web deploy |
| 5 | Welcome email for a new staff member failed on staging ("Edge Function returned a non-2xx") | Portal → Users |
| 6 | The referral end-to-end test kit is out of date (its fake Stripe lacks price lookup, customer update and setup intents); 4 of 23 steps fail on the committed code too | `supabase/functions/_tests/referrals` |
| 7 | Edge-case staff invite: adding an email that already has an account may keep the old password | Not checked |

---

## Next, after feat-001 (asked by Ghulam)

**Auto-applied vs specific promo codes.** Today BF30 is hard-wired to apply to every signup during
its dates. Ghulam wants a new option when creating a promo code in Super admin:

- **Auto-applied:** the code is applied on the card step for every new signup, within its valid
  dates. The person can remove it and enter their own code instead.
- **Specific:** the code applies only when the person types it and it is valid.

To be started once feat-001 is finished, with its own PRD section, specs and evals.

## How to re-run the proof

```
npm run eval -- feat-001                                   # all evals (staging)
npm run eval -- feat-001 08                                # the money math
deno test -A --no-check supabase/functions/_tests/signup-promo-coupon_test.ts
deno test -A --no-check supabase/functions/_tests/signup-verify-window_test.ts
deno test -A --no-check supabase/functions/_tests/signup-begin-3step_test.ts
npm run eval -- feat-001 04                                # the 72-hour rule and wording
```
