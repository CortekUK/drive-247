# QA — Onboarding (plan → signup → payment → portal)

Owner: Ghulam (UI, manual) · Claude (backend checks, fixes, scoreboard)
Status: **NOT STARTED**

---

## 1. Scope

**In:** super admin edits a signup plan → the plan shows on drive-247.com pricing → a
visitor signs up (account → email code → payment) → the workspace is built → they land
logged in on their portal.

**Out:** the portal's first-run wizard *contents* (separate flow), billing after the
first payment (renewals, failed payments), the booking site.

**Flow and the edge function behind each step**


| Step | Screen                  | Edge function                                       |
| ---- | ----------------------- | --------------------------------------------------- |
| 0    | Admin → Signup Plans    | `manage-signup-plans`                               |
| 1    | drive-247.com → Pricing | (reads `signup_plans`, refreshes within ~1 min)     |
| 2    | Signup: account         | `signup-slug-check`, `signup-begin`                 |
| 3    | Signup: email code      | `signup-verify-otp`                                 |
| 4    | Signup: payment         | `promo-code-lookup`, `signup-payment-intent(-v2)`   |
| 5    | Building workspace      | `signup-provision` (`signup-resume` if interrupted) |
| 6    | Portal                  | magic-link login into `{slug}.portal.drive-247.com` |


---



## 2. Test plan



### 2.1 Environment — this is PRODUCTION

There is no staging. Signup charges **LIVE Stripe** for every real email.
Test cards work for exactly **one** address: the rehearsal email on
**Admin → Developer** (`dev_signup_rehearsal`).


| Rehearsal setting | Today                                                                        |
| ----------------- | ---------------------------------------------------------------------------- |
| Email             | `ilyasghulam35@gmail.com`                                                    |
| Stripe mode       | test                                                                         |
| Link to northwind | **on** — the signup attaches to `northwind` instead of building a new tenant |


So the runs are split into two modes:


| Mode                 | Rehearsal setting                      | Use for                                                                            |
| -------------------- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| **A — northwind**    | link to northwind ON                   | Steps 2–4 and 6 against northwind, repeated as often as needed                     |
| **B — fresh tenant** | link to northwind OFF, still test mode | Step 5 for real: a brand-new tenant row, slug, plan. Twice minimum (exit criteria) |




### 2.2 Hard rules during testing

1. **Never press Pay with any email except the rehearsal one.** Other emails
  (`qa+…`, disposable, existing) are only taken as far as Step 3.
2. **Step 0 touches the live pricing page.** Copy edits are reverted in the same
  sitting. **Prices are never changed on Starter / Growth / Scale** — a price change
   creates a new LIVE Stripe price. Price-edit testing needs Ghulam's go-ahead first.
3. Before every run: Developer page → **Reset** the rehearsal signup. Claude confirms
  the reset left nothing behind.
4. After Mode B runs: Claude deletes the test tenant and its Stripe test objects and
  confirms zero leftovers.



### 2.3 Original values (restore after Step 0)


| Plan    | Price        | Visible | Highlighted |
| ------- | ------------ | ------- | ----------- |
| Starter | $1 / month   | yes     | no          |
| Growth  | $199 / month | yes     | **yes**     |
| Scale   | $299 / month | yes     | no          |




### 2.4 Devices (each P0 case runs on all three)


|     | Device                |
| --- | --------------------- |
| D1  | Desktop Chrome        |
| D2  | Desktop Safari        |
| D3  | Phone (iPhone Safari) |




### 2.5 Known rules from the code (what "correct" means)


| Field              | Rule                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Full name          | at least 2 characters                                                                                                     |
| Password           | at least 10 characters, at least one letter and one number                                                                |
| Web address (slug) | 3–50 characters, starts with a letter, only `a-z 0-9 -`, at least 3 letters/numbers; reserved: `www admin portal api app` |
| Email code         | 6 digits, expires after **10 minutes**, **5** wrong tries then locked, resend allowed after **60 seconds**                |
| Speed              | submitting the account form in under 1.5s is refused as "too quick" (bot guard)                                           |
| Building lock      | a second build for the same signup is refused for 2 minutes while one is running                                          |


---



## 3. Severity scale


| Level  | Meaning                                                                                                          | Ships?                |
| ------ | ---------------------------------------------------------------------------------------------------------------- | --------------------- |
| **P0** | Money taken with no workspace, duplicate charge, someone stuck with no way forward, data leaks to another tenant | Never                 |
| **P1** | Feature broken but the user can recover (retry works, clear error)                                               | Never                 |
| **P2** | Wrong copy, layout off, slow but works                                                                           | Only with Ghulam's OK |
| **P3** | Cosmetic polish                                                                                                  | Yes, logged           |


**Case types** (every step has a mix): `Happy` · `Boundary` · `Negative` ·
`Interrupt` · `Security` · `Message` (emails and on-screen copy) · `Device`

---



## 4. Checklist

`Who`: **G** = Ghulam on screen · **C** = Claude behind the scenes.
`Result`: ✅ pass · ❌ fail (bug ID) · ⏭ skipped (reason)

### Step 0 — Super admin plan setup


| ID      | Type     | Check                                                                  | Expected                                                  | Who | Pri | Result |
| ------- | -------- | ---------------------------------------------------------------------- | --------------------------------------------------------- | --- | --- | ------ |
| ON-0.1  | Happy    | Edit Starter's tagline, save, refresh                                  | Change kept after refresh                                 | G   | P1  |        |
| ON-0.2  | Happy    | —                                                                      | `signup_plans` row updated, `updated_at` moved            | C   | P1  |        |
| ON-0.3  | Happy    | Hide Scale, then show it again                                         | Toggles both ways, toast confirms                         | G   | P1  |        |
| ON-0.4  | Happy    | Move "highlighted" from Growth to Starter, then back                   | Exactly one plan highlighted at any time                  | G   | P1  |        |
| ON-0.5  | Happy    | —                                                                      | Never two `is_highlighted = true` rows                    | C   | P1  |        |
| ON-0.6  | Boundary | Bullet point at max length, empty bullet, 10+ bullets                  | Limits enforced with a clear message, or it saves cleanly | G   | P2  |        |
| ON-0.7  | Negative | Price field: `0`, `-5`, `abc`, `1.999` (do NOT save a valid new price) | Each refused with a clear message                         | G   | P1  |        |
| ON-0.8  | Negative | Empty plan name                                                        | Refused                                                   | G   | P1  |        |
| ON-0.9  | Security | —                                                                      | `manage-signup-plans` refuses a non-super-admin token     | C   | P0  |        |
| ON-0.10 | Happy    | Restore every value in §2.3                                            | Matches the table exactly                                 | G+C | P0  |        |




### Step 1 — Pricing on the landing page


| ID     | Type     | Check                              | Expected                                                                            | Who | Pri | Result |
| ------ | -------- | ---------------------------------- | ----------------------------------------------------------------------------------- | --- | --- | ------ |
| ON-1.1 | Happy    | Open drive-247.com → Pricing       | Names, prices, bullets match Step 0                                                 | G   | P0  |        |
| ON-1.2 | Happy    | After ON-0.1, wait ~1 min, refresh | Edit appears without a deploy                                                       | G   | P1  |        |
| ON-1.3 | Happy    | While Scale is hidden (ON-0.3)     | Scale card not shown                                                                | G   | P1  |        |
| ON-1.4 | Happy    | Highlighted plan                   | Badge on the right card only                                                        | G   | P2  |        |
| ON-1.5 | Happy    | Click each plan's button           | Dialog opens with **that** plan and price                                           | G   | P0  |        |
| ON-1.6 | Device   | ON-1.1 + ON-1.5 on D1, D2, D3      | Readable, no overflow, buttons tappable                                             | G   | P1  |        |
| ON-1.7 | Message  | Read every word on the cards       | No typos, prices formatted `$199/month` style                                       | G   | P2  |        |
| ON-1.8 | Negative | —                                  | If the plans read fails, the page shows the built-in catalogue, never an empty grid | C   | P1  |        |




### Step 2 — Create account


| ID      | Type      | Check                                                                            | Expected                                                                   | Who | Pri | Result |
| ------- | --------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --- | --- | ------ |
| ON-2.1  | Happy     | Fill everything validly with the rehearsal email, continue                       | Moves to the code screen                                                   | G   | P0  |        |
| ON-2.2  | Happy     | —                                                                                | Exactly one auth user for that email, signup attempt logged as allowed     | C   | P0  |        |
| ON-2.3  | Boundary  | Name: 1 char, then 2 chars                                                       | 1 refused, 2 accepted                                                      | G   | P1  |        |
| ON-2.4  | Boundary  | Password: 9 chars / 10 letters only / 10 numbers only / 10 mixed                 | Only the last is accepted; rule list updates live                          | G   | P1  |        |
| ON-2.5  | Boundary  | Slug: `ab`, 50 chars, 51 chars, `1abc`, `Acme`, `acme rentals`, `acme--`, `a-b-` | Correct accept/refuse per §2.5; capitals/spaces handled or refused clearly | G   | P1  |        |
| ON-2.6  | Negative  | Slug `northwind` (taken)                                                         | "Taken", with a way to pick another                                        | G   | P0  |        |
| ON-2.7  | Negative  | Slugs `admin`, `www`, `portal`, `api`, `app`                                     | All refused as reserved                                                    | G   | P0  |        |
| ON-2.8  | Boundary  | Company name: 100 chars, emoji, `O'Brien & Sons`, Arabic text                    | Saved and shown correctly, or refused clearly                              | G   | P2  |        |
| ON-2.9  | Negative  | Terms unticked                                                                   | Cannot continue, focus jumps to the box                                    | G   | P0  |        |
| ON-2.10 | Negative  | Email of an existing Drive247 user                                               | "Sign in instead" — never reveals what kind of account it is               | G   | P1  |        |
| ON-2.11 | Negative  | `x@mailinator.com`                                                               | Refused as disposable                                                      | G   | P2  |        |
| ON-2.12 | Negative  | `abc`, `abc@`, `abc@x.c`                                                         | Refused as invalid                                                         | G   | P1  |        |
| ON-2.13 | Interrupt | Double-click Continue                                                            | One request, one user                                                      | G   | P0  |        |
| ON-2.14 | Interrupt | —                                                                                | After ON-2.13, still one auth user                                         | C   | P0  |        |
| ON-2.15 | Negative  | Fill the form in under 1.5s (autofill)                                           | "Too quick", retry works                                                   | G   | P2  |        |
| ON-2.16 | Security  | —                                                                                | Repeated attempts from one IP / one email hit RATE_LIMITED                 | C   | P1  |        |
| ON-2.17 | Interrupt | Close dialog, reopen, same plan                                                  | Form state sensible (restored or clean), no crash                          | G   | P2  |        |
| ON-2.18 | Device    | ON-2.1 on D1, D2, D3                                                             | Keyboard doesn't cover fields on phone; password managers behave           | G   | P1  |        |




### Step 3 — Email code


| ID      | Type      | Check                            | Expected                                                          | Who | Pri | Result |
| ------- | --------- | -------------------------------- | ----------------------------------------------------------------- | --- | --- | ------ |
| ON-3.1  | Happy     | Code arrives                     | Under 1 min; inbox, not spam                                      | G   | P0  |        |
| ON-3.2  | Message   | Read the email                   | Right sender name, no typos, readable on phone, code obvious      | G   | P1  |        |
| ON-3.3  | Happy     | Paste the code                   | Fills all 6 boxes, submits by itself                              | G   | P1  |        |
| ON-3.4  | Happy     | Type the code digit by digit     | Same result                                                       | G   | P1  |        |
| ON-3.5  | Happy     | —                                | Email marked verified on the auth user                            | C   | P0  |        |
| ON-3.6  | Negative  | Wrong code once                  | Clear error, boxes clear, can retry                               | G   | P1  |        |
| ON-3.7  | Negative  | Wrong code 5 times               | Locked, message says what to do                                   | G   | P1  |        |
| ON-3.8  | Interrupt | Resend before 60s                | Refused or button disabled with countdown                         | G   | P2  |        |
| ON-3.9  | Happy     | Resend after 60s                 | New code works, **old code no longer works**                      | G   | P1  |        |
| ON-3.10 | Negative  | Wait 10+ minutes, enter the code | "Expired", resend works                                           | G   | P1  |        |
| ON-3.11 | Interrupt | Refresh on the code screen       | Returns to the code screen (not back to step 1), no new user      | G   | P1  |        |
| ON-3.12 | Security  | —                                | Code cannot be verified for another email by changing the request | C   | P0  |        |




### Step 4 — Payment (rehearsal email only)


| ID      | Type      | Check                                      | Expected                                                                               | Who | Pri | Result |
| ------- | --------- | ------------------------------------------ | -------------------------------------------------------------------------------------- | --- | --- | ------ |
| ON-4.1  | Happy     | Plan name + price shown                    | Same as the card clicked in Step 1                                                     | G   | P0  |        |
| ON-4.2  | Happy     | Pay with `4242 4242 4242 4242`             | Moves to "building"                                                                    | G   | P0  |        |
| ON-4.3  | Happy     | —                                          | One Stripe test customer, one subscription, correct price, metadata carries the signup | C   | P0  |        |
| ON-4.4  | Negative  | `4000 0000 0000 0002` (declined)           | Clear error, can retry with another card                                               | G   | P0  |        |
| ON-4.5  | Negative  | —                                          | Declined attempt left no active subscription; retry reuses the customer                | C   | P0  |        |
| ON-4.6  | Happy     | `4000 0025 0000 3155` (3D Secure), approve | Continues to building                                                                  | G   | P0  |        |
| ON-4.7  | Negative  | Same card, **fail** the 3DS popup          | Clear error, can retry                                                                 | G   | P1  |        |
| ON-4.8  | Negative  | `4000 0000 0000 9995` (insufficient funds) | Clear error                                                                            | G   | P1  |        |
| ON-4.9  | Happy     | Valid promo code                           | Price updates before paying; charged amount matches                                    | G   | P1  |        |
| ON-4.10 | Negative  | Invalid / expired promo code               | Says so, continues at full price                                                       | G   | P1  |        |
| ON-4.11 | Negative  | Promo **and** referral code together       | Only one applies, UI says which                                                        | G   | P1  |        |
| ON-4.12 | Interrupt | Double-click Pay                           | One charge                                                                             | G   | P0  |        |
| ON-4.13 | Interrupt | —                                          | After ON-4.12, exactly one charge in Stripe                                            | C   | P0  |        |
| ON-4.14 | Interrupt | Browser back button on payment             | No duplicate subscription, can come forward again                                      | G   | P0  |        |
| ON-4.15 | Happy     | **Growth** plan end to end                 | Charges $199 correctly. ⚠ Growth has no stored `stripe_price_id` (Starter/Scale do)    | G+C | P0  |        |
| ON-4.16 | Device    | ON-4.2 on D1, D2, D3                       | Card form usable, Apple Pay/Link behave if offered                                     | G   | P1  |        |




### Step 5 — Building the workspace (Mode B for the full run)


| ID     | Type      | Check                                         | Expected                                                                                                                                             | Who | Pri | Result |
| ------ | --------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------ |
| ON-5.1 | Happy     | Watch the building screen                     | Progress shown, finishes under ~30s                                                                                                                  | G   | P1  |        |
| ON-5.2 | Happy     | —                                             | Tenant row (right slug, name, `portal_experience = v2`), owner `app_users` row, plan, `tenant_subscriptions` linked to the Stripe sub, first invoice | C   | P0  |        |
| ON-5.3 | Happy     | —                                             | Booking-site content published; new tenant's booking site loads                                                                                      | C   | P1  |        |
| ON-5.4 | Interrupt | Refresh mid-build                             | Resumes, no second tenant, no second charge                                                                                                          | G   | P0  |        |
| ON-5.5 | Interrupt | Close the tab mid-build, reopen site, sign in | `signup-resume` puts them back on the right step                                                                                                     | G   | P0  |        |
| ON-5.6 | Interrupt | —                                             | After ON-5.4/5.5: exactly one tenant, one sub, one invoice                                                                                           | C   | P0  |        |
| ON-5.7 | Security  | —                                             | `signup-provision` without a paid subscription → PAYMENT_REQUIRED, nothing written                                                                   | C   | P0  |        |
| ON-5.8 | Security  | —                                             | Slug taken between Step 2 and Step 5 (race) → clear error, payment kept, user can pick another                                                       | C   | P0  |        |
| ON-5.9 | Negative  | —                                             | A forced failure mid-build rolls the tenant back and leaves the payment and login intact                                                             | C   | P0  |        |




### Step 6 — Into the portal


| ID      | Type     | Check                                        | Expected                                                                           | Who | Pri | Result |
| ------- | -------- | -------------------------------------------- | ---------------------------------------------------------------------------------- | --- | --- | ------ |
| ON-6.1  | Happy    | Arrival                                      | Already logged in, no second login screen                                          | G   | P0  |        |
| ON-6.2  | Happy    | URL                                          | `{chosen-slug}.portal.drive-247.com`                                               | G   | P0  |        |
| ON-6.3  | Happy    | Company name, plan, sidebar status chip      | All correct                                                                        | G   | P1  |        |
| ON-6.4  | Happy    | Look and feel                                | v2 portal (northwind look)                                                         | G   | P1  |        |
| ON-6.5  | Happy    | First-run wizard                             | Opens                                                                              | G   | P1  |        |
| ON-6.6  | Happy    | Log out, log in with Step 2 email + password | Works                                                                              | G   | P0  |        |
| ON-6.7  | Message  | Welcome / receipt emails                     | Arrive, correct amounts and names, no typos                                        | G   | P1  |        |
| ON-6.8  | Security | —                                            | New tenant sees **only its own** data (no northwind or other tenant rows anywhere) | C   | P0  |        |
| ON-6.9  | Device   | ON-6.1 on D3                                 | Phone lands logged in too                                                          | G   | P1  |        |
| ON-6.10 | Happy    | —                                            | No errors in function logs for the whole run                                       | C   | P1  |        |


---



## 5. How we run it

1. Claude gives **one step** (its rows above).
2. Ghulam does the **G** rows, replies with results + what data was used
  (email, slug, card). Screenshot on any ❌.
3. Claude does the **C** rows and replies ✅ or ❌ with a bug ID.
4. ❌ → Claude fixes (v2-gated, v1 untouched), Ghulam re-tests that row,
  then the **regression set**: every other P0 row in the same step is re-run.
5. Next step only once the current one is all ✅.



## 6. Bug log

Every bug in this format:


| Bug | Row | Pri | Steps to reproduce | Expected | Actual | Evidence | Fix | Re-tested |
| --- | --- | --- | ------------------ | -------- | ------ | -------- | --- | --------- |
|     |     |     |                    |          |        |          |     |           |




## 7. Exit criteria — "signed off"

All must be true. No exceptions.

- [ ] Every P0 and P1 row ✅
- [ ] Every P0 row passed on D1, D2 and D3
- [ ] Two complete Mode B runs, back to back, each on a fresh tenant, all ✅
- [ ] Zero open P0/P1 bugs; every P2 either fixed or accepted by Ghulam in writing
- [ ] Every fix followed by its regression set
- [ ] Leftover check after cleanup: zero orphan auth users, tenants, subscriptions or Stripe test objects from QA
- [ ] Step 0 values match §2.3 exactly
- [ ] `npm run v1:check` passes

**Signed off by:** ______ **Date:** ______