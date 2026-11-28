# Driver verification · Part 1 · Task for Haris

| | |
|---|---|
| For | Haris |
| From | Ghulam |
| Written | Saturday 28 Nov 2026 |
| Branch | `haris/feat/driver-verification`, taken from `staging`, merged into `ray1` to test |
| Feature folder | `docs/application/feat-003-driver-verification/` |
| Research behind it | `docs/research/driver-verification-module.md` |
| Sketches of the screens | https://claude.ai/artifact/MczLmJif2M5VUywgrT2BZc (ask Ghulam to share it with you) |

## Read this first

**1. This is part 1 only.** Driver verification is a big module and it is built in parts. This task is the first part: add a customer, verify them from the Customers tab, run every check, and charge the premium ones on the next subscription bill. The later parts are listed in "Not in this task" below. Do not start them.

**2. This task follows the full path. No step is skipped.**

| Step | What you write | Skill |
|---|---|---|
| 1 | The PRD section, in plain business language | `prd` |
| 2 | The specs, each with numbered statements | `spec` |
| 3 | One eval per spec, proving its statements on staging. Money math in Vitest. | `eval` |
| 4 | The QA report: what a person checks by hand, ticked in your own words | `qa-report` |
| 5 | A pull request from `ray1` | |

**Write a proper PRD, proper specs, proper evals and a proper QA report, exactly as the onboarding documents describe.** They are in `docs/onboarding/`:

- `01-branches-and-your-test-site.md`
- `02-how-a-feature-is-built.md`
- `03-staying-in-sync.md`

Read all three before you write anything, even if you have read them before. Code without these four documents is not a finished task, however well it works. The feature is complete only when every statement is proved by an eval and every item of the QA report is ticked.

This document is the brief. It is not the PRD and it is not a spec. You write those yourself, from this, in the feature folder.

**3. When you are done, send Ghulam a Supercut video.** One recording that walks through the whole thing working on your `ray1` sites. What it must show is in section 17.5. The task is not handed in until Ghulam has the video.

**How to use this document.** Give it to your AI whole. It is written to be read from top to bottom once, then used as a reference. Where it says **Decided**, do not change it without asking Ghulam. Where it says **Recommended**, it is the suggested way and you may propose a better one in your spec. Where it says **Confirm**, the fact is not proven yet and you must check it before you build on it.

Contents:

1. What you are building
2. What is decided
3. The journey, step by step
4. The checks
5. Prices and the money math
6. The session
7. How the link changes with what was chosen
8. The renter's side
9. Didit (the free standard check)
10. RentID (the premium checks)
11. Charging on the next subscription bill
12. What exists today, and what must keep working
13. Data: tables and columns
14. Privacy, consent and safety
15. Edge cases
16. Things I found that you should look at
17. What you hand in
18. Open questions for Ghulam

---

## 1. What you are building

A rental company's staff member adds a customer, then presses **Verify**. A dialog asks what to check and how the customer should receive the link. The customer does the check on their own phone. The staff member watches the progress and gets a result with one line per check. Premium checks are added to the company's next subscription bill, and the Billing tab shows them.

The standard check is free for every company. It is done by Drive247 and Didit. The premium checks are done by RentID and the company pays what they cost us plus $0.50.

**The model: Drive247's own accounts, for every company.** Drive247 already has access to Didit and to RentID. Every check, for every rental company, goes through Drive247's one account with each. A company does nothing to switch it on: no sign-up with a provider, no account to link, no key to paste, no setup screen. It works the day the module ships. Drive247 pays the providers, and takes the money back from each company on its subscription bill.

**Start in the Customers tab.** Build in this order:

1. Add customer, without any verifying in it.
2. The Verify button, on the customer's row and on the customer's page.
3. The Verify dialog: what to check, how to send, live progress.
4. The link and the renter's side.
5. The standard check through Didit, with all ten results.
6. The premium checks through RentID.
7. Charging premium checks to the next subscription bill, and showing them in Billing.
8. The warning when a rental is created for a customer who is not verified.

### Not in this task (the later parts)

| Not included | Why |
|---|---|
| Licence watch during the rental | Coming soon. Show it in the table, greyed. |
| Rideshare driver proof | Coming soon. Show it in the table, greyed. |
| The key only opens for the verified face (lockbox) | A later round |
| Dispute pack and police pack | A later round |
| Risk score that sets the deposit | A later round |
| Wallet ID, verified-once across companies, the network shield | Later, and the last one needs a lawyer |
| Own car insurance (Modives) | Already in the portal. Leave it exactly as it is. |
| A screen where a company connects its own Didit or RentID account | Never. Every company uses Drive247's accounts (D21). |
| Changing verification on the booking site, the invite registration, or secondary drivers | They keep today's flow. See section 12. |

---

## 2. What is decided

All by Ghulam, on 28 Nov 2026.

| # | Decision |
|---|---|
| D1 | Adding a customer has nothing to do with verifying. The "Verify their ID" screen at the end of the add dialog is removed. |
| D2 | Anything printed on a licence is not asked in Add customer. The licence screen and the date of birth leave the dialog. The check brings them. |
| D3 | Add customer keeps: full name, email, phone, status, gig driver, emergency contact. |
| D4 | A company that does not use the check can still type date of birth and licence details by hand on the customer's page. They are marked "Typed, not verified". |
| D5 | Verify starts from two places: a Verify button on the customer's row in the list, and on the customer's page. Both open the same dialog. |
| D6 | One status the whole portal uses: Not verified, Link sent, In progress, Verified, Failed, Expired. |
| D7 | Creating a rental for a customer who is Not verified says so and offers Verify right there. |
| D8 | The Verify dialog's first screen is a table: a tick, the service, a short description, and Free or the price. |
| D9 | The table opens with the ticks the company used last time. No trip to Settings. The very first time, only the free check is ticked. "Last time" belongs to the company, not to the staff member. |
| D10 | The standard check cannot be unticked. |
| D11 | The table shows a total for this customer before sending. |
| D12 | Under the table: premium checks are added to your next subscription bill. |
| D13 | A company is charged only for a check the customer finishes. |
| D14 | The standard check is free for every company. It runs on Didit and costs Drive247 about $0.33 a customer. Drive247 carries that. |
| D15 | Anything that costs us more than $1 is premium. We do not carry it. The company pays our cost plus $0.50. |
| D16 | For now only Drive247, Didit and RentID checks are live. Everything else stays in the table marked "Coming soon" and cannot be ticked. |
| D17 | The charges show in the Billing tab, as part of the next bill. Reuse the billing system the portal already has. |
| D18 | Test the charging on Stripe in test mode. Never on live. |
| D19 | The ways to send: email the link, text the link, copy the link, or show a code to scan when the customer is there. All four are the same check and the same link. |
| D20 | One session per check. It is tracked from the moment it is made to the result. |
| D21 | **One account for everyone.** Drive247 has one Didit account and one RentID account, and every rental company on the platform uses them. A company never signs up with Didit or RentID, never connects an account, and never enters a key. Drive247 pays the providers and charges the company on its subscription bill with our margin on top. |

---

## 3. The journey, step by step

### Step 1 · Staff adds the customer

The add dialog today is `apps/portal/src/components/customers-v2/customer-form-dialog-v2.tsx`. It has six question screens and then a seventh, "Verify their ID" (`verify-id-screen-v2.tsx`).

| Screen today | After this task |
|---|---|
| 1. Who's renting? Full name, date of birth | Full name only, plus email and phone moved up if they fit the 3 by 4 grid |
| 2. How do I reach them? Email, phone | Kept (or merged into screen 1) |
| 3. Their licence: type and ID number | Removed |
| 4. A couple more things: status, gig driver | Kept |
| 5. Who do I call if something happens? | Kept, optional |
| 6. And how do I reach them? | Kept, optional |
| 7. Verify their ID | Removed |

When the dialog saves, the customer is in the list with the status **Not verified**. Nothing else happens.

Email or phone is needed to send a link later, but neither is required to save. If a customer has neither, the Verify dialog offers only "copy the link" and "show a code".

The blocked-list check that runs today on the typed ID number (the dialog shows "Blocked: reason") has nothing to check any more at this point. It moves to the result of the standard check (check 9).

### Step 2 · Staff presses Verify

| Where | What is there |
|---|---|
| Customers list, the row | The status word. A **Verify** button when the status is Not verified, Failed or Expired. A **Remind** button when it is Link sent or In progress. |
| Customer's page, Verification section | The same status and the same buttons, plus the result lines of the last check |

The list is `apps/portal/src/app/(dashboard)/customers/page.tsx`. The customer's page section is `components/customers-v2/customer-detail/section-verification.tsx`.

### Step 3 · The Verify dialog

One dialog, three screens. Each screen asks one thing. It is a dialog, never a side sheet. Minimal, stacked, no scrolling inside it on a laptop.

**Screen 1: What should I check?**

| Tick | Service | What it does | Price |
|---|---|---|---|
| On, locked | Standard check · Free | Real licence, live person, face match, age, name, licence type, blocked list. Saves their details. | Free |
| As last time | Licence active with the state · Premium | Not suspended, revoked or cancelled. | $3.49 |
| As last time | Driving record · Premium | Points, DUIs, accidents, past suspensions. | $3.49 + state fee |
| As last time | Criminal record · Premium | Any criminal history. | $3.49 + state fee |
| Greyed | Licence watch during the rental · Coming soon | Tells you if the licence is suspended mid-rental. | |
| Greyed | Rideshare driver proof · Coming soon | They are an active Uber or Lyft driver. | |

Under the table, outside it: **"Premium checks are added to your next subscription bill. You are only charged for a check the customer finishes."**

Above the Next button: **"For Marcus: $3.49"**, the sum of what is ticked.

The prices in this table come from the price list in section 5. They are never typed into the screen's code.

**Screen 2: How does Marcus do it?**

| Option | When it is offered | What happens |
|---|---|---|
| Email him the link | The customer has an email | The link is emailed. The address is shown and can be corrected first. |
| Text him the link | The customer has a phone, and the company can send texts | The link is texted |
| He is here: show a code to scan | Always | The dialog shows the link as a QR code |
| Copy the link | Always | The link is copied, for a chat or anything else |

The session is created when the staff member chooses one of these.

**Screen 3: Marcus is verifying**

A short list of moments, each with a time, that fills in as they happen. Buttons: Send again, Cancel this check, Close.

The staff member can close the dialog. The customer's row and page show the same progress. Opening Verify again on a customer with a live session goes straight to screen 3.

### Step 4 · The customer does the check

On their own phone. See section 8.

### Step 5 · The result

On the customer's page and in the dialog, one line per check with Pass, Fail or Could not check, and the reason in plain words when it is not a pass. The details read from the licence are saved on the customer and marked as verified.

### Step 6 · The rental

When staff create a rental for a customer whose status is not Verified, the screen says so and offers Verify there (D7). The company's existing settings still decide whether the rental may go ahead without it: `tenants.require_identity_verification` and `tenants.allow_rental_without_id_verification`.

### Step 7 · The bill

Each finished premium check appears in the Billing tab as part of the next bill, with the customer's name, the check and the day. See section 11.

---

## 4. The checks

Fifteen checks. Ten are the standard check, three are premium, two are coming soon.

### 4.1 The standard check (free, always on, one tick)

The staff member sees one tick. The result shows all ten lines.

| # | Check | Who does it | How it is decided | A fail means |
|---|---|---|---|---|
| 1 | Real licence | Didit | Didit's document result and its warnings | The licence is not genuine, or could not be read |
| 2 | Live person | Didit | Didit's liveness result | A photo of a photo, a screen, or a mask |
| 3 | Face match | Didit | Didit's face match result and score | The selfie is not the person on the licence |
| 4 | Details saved | Didit reads, Drive247 saves | The fields Didit returns are written to the customer | A field could not be read. Not a fail by itself: the line says which field is missing. |
| 5 | Not expired | Drive247 | The expiry date is after today. On a rental, after the return date. On an extension, after the new return date. | The licence is out of date, or runs out during the rental |
| 6 | Old enough | Drive247 | Date of birth against `tenants.minimum_rental_age` | Under the company's minimum age |
| 7 | Name matches | Drive247 | The name on the licence against the customer's name, with the same rule the app already uses (`_shared/secondary-driver-rules.ts`, `driverNameMatchesDocument`) | The licence belongs to someone with a different name |
| 8 | Right type of licence | Drive247 | The document type and subtype Didit returns: a full driving licence, not a learner's permit or an ID card. `tenants.accepted_verification_document` says what the company accepts. | A permit, or a document the company does not accept |
| 9 | Not blocked, not a repeat | Didit and Drive247 | Drive247's `blocked_identities` by licence number, and Didit's duplicate-face result | On the company's blocked list, or the same face under another name |
| 10 | Foreign renters | Didit | A passport or a foreign licence is accepted and read | Not a fail. The line says what kind of document it was. |

Rules for the standard check as a whole:

- **Verified** needs checks 1, 2, 3, 5, 6, 7, 8 and 9 to pass.
- Check 5 has two moments. At verification it compares with today. When a rental is created or extended it is checked again against the return date, without a new session and without a new charge.
- One rule lives in one place. The age rule, the expiry rule and the name rule are each a single shared function that the edge function calls and that Vitest tests. No copies in the portal.
- A check Drive247 cannot make (the date of birth is missing, say) is "Could not check", not Pass.

### 4.2 Premium checks (RentID)

| # | Check | What it tells the company | Needs from the standard check |
|---|---|---|---|
| 11 | Licence active with the state | Valid, suspended, revoked or cancelled, straight from the state | Licence number, state, date of birth, name |
| 12 | Driving record | Points, DUIs, accidents, past suspensions | The same, plus whatever RentID asks for |
| 13 | Criminal record | Any criminal history | Whatever RentID asks for |

Rules:

- **Recommended:** a premium check runs only after the standard check comes back Verified. If the standard check fails, the premium checks do not run and are not charged. There is no point paying for a driving record on a fake licence.
- A premium check that RentID cannot run for this state is greyed on screen 1 with "Not available in this state yet", once the state is known. Before the state is known (the first verification), it can be ticked, and if it then cannot run, it is not charged and the result says so.
- **Confirm** from RentID's documents: what each check needs as input, what it returns, how long it takes, and whether the renter must give anything extra.

### 4.3 Coming soon

| # | Check | Shown as |
|---|---|---|
| 14 | Licence watch during the rental | A greyed row with "Coming soon". Cannot be ticked. |
| 15 | Rideshare driver proof | The same |

Build the table from a list of services, so switching one of these on later is a change to the list, not to the screen.

---

## 5. Prices and the money math

This section ends on a bill, so it carries hand-worked rows. Vitest runs every row, and the QA report has a person redo rows on a calculator and compare with the screen and with Stripe.

### 5.1 The rule (D14, D15)

| Kind | Price to the company |
|---|---|
| Free | $0.00. Anything Drive247 or Didit does. |
| Premium | What the check costs Drive247, plus $0.50 |

What a premium check costs Drive247 is: RentID's charge for that check, plus any state fee RentID passes on.

`company price = RentID charge + state fee + 0.50`

All money is held in whole cents. No fractions of a cent anywhere.

### 5.2 The price list

One table in the database, edited by Drive247's team only. The screen, the charge and the bill all read from it.

| Check | RentID charge | State fee | Margin | Company pays |
|---|---|---|---|---|
| Standard check | none | none | none | Free |
| Licence active with the state | $2.99 | none known | $0.50 | $3.49 |
| Driving record | $2.99 (**Confirm**) | By state (**Confirm**) | $0.50 | $3.49 + state fee |
| Criminal record | $2.99 (**Confirm**) | By state (**Confirm**) | $0.50 | $3.49 + state fee |

**Confirm with RentID, from your documents:** $2.99 is the price of one RentID credit. RentID does not say publicly how many credits a driving record or a criminal record takes. If one takes two credits, its charge is $5.98 and the company pays $6.48 plus the state fee. Put the real numbers in the price list and in this table before anything is charged.

### 5.3 Worked rows

| # | What was ticked and finished | RentID | State fee | Margin | Company pays |
|---|---|---|---|---|---|
| 1 | Standard only | 0.00 | 0.00 | 0.00 | **0.00** |
| 2 | Standard + licence active | 2.99 | 0.00 | 0.50 | **3.49** |
| 3 | Standard + driving record, state fee $8.00 | 2.99 | 8.00 | 0.50 | **11.49** |
| 4 | Standard + driving record, state fee $0.00 | 2.99 | 0.00 | 0.50 | **3.49** |
| 5 | Standard + licence active + driving record, state fee $8.00 | 5.98 | 8.00 | 1.00 | **14.98** |
| 6 | Standard + all three, state fees $8.00 and $5.00 | 8.97 | 13.00 | 1.50 | **23.47** |
| 7 | Standard + licence active, the customer never opens the link | 0.00 | 0.00 | 0.00 | **0.00** |
| 8 | Standard + licence active, the standard check fails | 0.00 | 0.00 | 0.00 | **0.00** |
| 9 | Standard + licence active, RentID returns "suspended" | 2.99 | 0.00 | 0.50 | **3.49** |
| 10 | Standard + licence active, RentID cannot run it for that state | 0.00 | 0.00 | 0.00 | **0.00** |
| 11 | Standard + licence active, verified twice for the same customer in one month | 5.98 | 0.00 | 1.00 | **6.98** |
| 12 | A month with 7 licence checks and 2 driving records at $8.00 state fee | 26.91 | 16.00 | 4.50 | **47.41** |

Row 9 matters: a check that finishes with a bad answer is still a finished check. The company asked a question and got the answer. Row 10 is not finished, so it is not charged.

The $0.50 is per premium check, not per session. Row 5 has two premium checks, so $1.00.

### 5.4 What "finished" means (D13)

| Check | It is finished, and charged, when |
|---|---|
| Standard | Never charged |
| A premium check | RentID returns a result for it, whatever the result says |

Not finished, so not charged: the link was never opened, the customer stopped half way, the session expired or was cancelled, the standard check failed so the premium checks never ran, RentID returned an error, or RentID does not cover the state.

**Confirm** from RentID's documents when RentID bills us. If RentID charges us for a call that errors, the rule above loses money, and you tell Ghulam before going live.

### 5.5 What the staff member sees before sending

The total on screen 1 uses the state fee only when the state is already known (the customer was verified before). When it is not known, the screen says "$3.49 + state fee" and the total says "from $3.49". Never show an exact total that may turn out wrong.

---

## 6. The session

One session is one request to verify one customer (D20).

### 6.1 What a session holds

| Field | What |
|---|---|
| Who | The company, the customer, the staff member who started it |
| What | The checks ticked, with the price of each at that moment (a price change later does not change an open session) |
| How it was sent | Email, text, code or copy, and the address or number used |
| The link | One unguessable token |
| When it ends | 24 hours after it was made |
| Status | See 6.2 |
| Moments | Each thing that happened, with a time. See 6.3. |
| The provider's side | The Didit session id, the RentID request ids |
| The result | One row per check: pass, fail or could not check, the reason, and the raw answer |
| The charges | One row per finished premium check. See section 11. |

### 6.2 Status

What the portal shows (D6), and what moves it:

| Status | Means | Moves when |
|---|---|---|
| Not verified | No session, or the last one was cancelled | The start |
| Link sent | A session exists and the customer has not opened it | The session is made |
| In progress | The customer opened the link, or the checks are running | The link is opened |
| Verified | The standard check passed | The results come back |
| Failed | The standard check did not pass | The results come back |
| Expired | 24 hours passed without a result | The clock |

Notes:

- The customer's status is the status of their **latest** session. A session that was replaced can never change it.
- A premium check's own result does not change Verified to Failed. A customer can be Verified with "Licence active: suspended". The result line carries that, in red, and the row in the list shows a warning mark. See open question Q1.
- "Expired" is a clock event with no row change, so the screen must work it out from the end time as well as from the stored status.

### 6.3 Moments

Recorded in order, each with a time. Screen 3 and the customer's page show them.

| Moment | Comes from |
|---|---|
| Session made | Drive247 |
| Link emailed / texted / copied / code shown | Drive247 |
| Reminder sent | Drive247 |
| Link opened | Drive247's own link page |
| Consent given | Drive247's own link page |
| Check started | Didit says the session is in progress |
| Standard check result | Didit |
| Premium check started, premium check result | RentID |
| Cancelled, expired | Drive247 |

Today's screen shows finer steps (licence front, licence back, selfie) because today's capture page is ours and writes them. With Didit's hosted flow we may only learn "in progress" and then the result. **Confirm** what Didit gives: the decision can be fetched with `?include=events`. If the fine steps are not available, screen 3 shows the moments in the table above and nothing is invented.

### 6.4 Rules

| Rule | Detail |
|---|---|
| One live session per customer | Starting a new one ends the old one. Its link then says the check was replaced and to use the new link. Today's code already does this for the old flow. |
| 24 hours | Then Expired. Didit's own session lifetime must be set to match (it accepts 1 hour to 28 days). |
| Send again | Sends the same link again by the same or another way. Does not make a new session. |
| Limits | Keep today's guard against abuse (at most 10 sessions per customer per hour), and limit reminders so a customer cannot be flooded. |
| Cancel | Ends the session. Nothing that has not finished is charged. |

---

## 7. How the link changes with what was chosen

The link is always one address of the same shape, on the company's own booking site:

`https://<company>.<booking domain>/verify/<token>`

The address never changes. What the page behind it does changes with the session.

### 7.1 It changes with the checks that were ticked

| Ticked | What the customer's page adds |
|---|---|
| Standard only | The consent for the photo and face check, then the check |
| + Licence active with the state | One more line in the consent: the company will ask the state whether the licence is valid. No extra step for the customer. |
| + Driving record | A separate consent screen for the driving record, with its own tick. **Confirm** from RentID whether more is needed from the customer. |
| + Criminal record | A separate consent screen for the criminal record, with its own tick. **Confirm** the same. |

So the number of screens the customer sees depends on the session. The page reads the session by its token and builds its steps from the list of ticked checks. A check that was not ticked leaves no trace on the page.

If the customer refuses a premium consent, that check does not run and is not charged, the standard check still goes ahead, and the result line says "The customer did not agree".

### 7.2 It changes with how it was sent

| Sent by | What differs |
|---|---|
| Email | The email carries the company's name and logo and the link. Reuse `send-verification-link-v2`, which already builds the link itself from the session so the browser never sends an address. |
| Text | A short text with the link. Use the function the app already uses for a company's texts. Only offered when the company can send texts. |
| Code to scan | The same link as a QR code inside the dialog |
| Copy | The same link on the clipboard |

The way it was sent is recorded on the session and shown on screen 3 ("Link emailed to marcus@email.com, 2:14 PM").

### 7.3 It changes with where it was made

A link made on staging or on a ray site must open that site's booking pages, not live. Today `create-ai-verification-session` builds the address from one setting, `BOOKING_APP_URL`, and falls back to the live address, so a link made on staging points at live. The file `_shared/booking-origin.ts` exists to solve exactly this (`deriveBookingOrigin`) and its header says not to copy the old way. Use it.

### 7.4 It changes with the state of the session

| The session is | The page shows |
|---|---|
| Live, not started | The welcome and consent |
| Live, started | Carries on where the customer stopped |
| Finished | "You are verified" or "We could not verify you", with nothing private on it |
| Replaced by a newer one | "This link was replaced. Please use the newest link." |
| Expired or cancelled | "This link has ended. Ask the company for a new one." |

---

## 8. The renter's side

Today the customer's page is `apps/booking/src/app/(legacy)/verify/[token]/page.tsx`. It takes the photos itself and calls `process-ai-verification`. Many other flows use it (section 12), so it is not rewritten in place.

**Recommended shape:** the customer always opens Drive247's own page first. That page shows the company's name and logo, says what will be checked, takes the consents, and records "opened". Then it hands the customer to Didit's hosted check. When Didit is done it sends the customer back to our page, which shows the result and runs anything left.

Why our own page first, and not Didit's link directly:

- The consents in section 7 are ours to collect. Didit's documents say the create-session call does not record consent and that we must show our own notice before sending the customer on.
- "Link opened" becomes a moment we can record.
- The link stays in our hands: we can end it, replace it, and point it at the right site.

What the customer goes through, standard check only:

1. Opens the link on a phone.
2. Sees who is asking and what will be checked. Agrees.
3. Photographs the front of the licence, the back, and takes a selfie (inside Didit's flow).
4. Sees "Thank you, you are done" or what to do next.

Rules:

- A phone first. Every screen fits one phone screen without sideways scrolling.
- If the link is opened on a laptop, the page shows the link as a QR code and says "Open this on your phone".
- If the customer stops, opening the same link again carries on. The session lasts 24 hours.
- Nothing private is ever shown back to the customer on a finished link: no licence number, no photos.
- The words on these pages are said by Trax, first person, no emojis.

---

## 9. Didit (the free standard check)

Read from Didit's own documents on 28 Nov 2026. Check each point yourself in the sandbox before you rely on it. Points I could not confirm are marked.

### 9.1 The facts

| Thing | What the documents say |
|---|---|
| Base address | `https://verification.didit.me`, routes under `/v3/` |
| How the server signs in | Header `x-api-key` with the whole key. No OAuth for verification calls. |
| Sandbox | A separate application with its own key (`sk_test_` prefix). Free. External providers are mocked. Up to 500 sessions a day. |
| Make a session | `POST /v3/session/` with `workflow_id` (required) |
| Useful optional fields | `vendor_data`, `multi_account_segment`, `callback`, `metadata`, `session_expiration_time` (3600 to 2419200 seconds), `language`, `expected_details`, `user_state`, `biometric_consent` |
| What comes back | `session_id`, `session_token` (secret), `url` (the hosted check), `expires_at`, `status` ("Not Started") |
| Which checks run | Set by the **workflow**, built in Didit's console and named by `workflow_id`. There is no way to pick checks per session. |
| Get the result | `GET /v3/session/{session_id}/decision/` |
| Status words | Not Started, In Progress, Approved, Declined, In Review, Abandoned, Expired, Kyc Expired, Resubmitted, Awaiting User. Case matters. |
| Webhooks | Events `status.updated` and `data.updated`. Sent from IP `18.203.201.92`. Retried twice, order not guaranteed. |
| Webhook signature | Header `X-Signature-V2`: HMAC-SHA256 over the canonical JSON, with the destination's secret. Header `X-Timestamp`: refuse if more than 300 seconds away. |
| After the check | The customer is sent to `callback` with `verificationSessionId` and `status` added to the address |
| Price | $0.33 for the full check per finished session. $10 free each month on the free plan. Billed for finished checks, including ones that find a fake. |

### 9.2 What the result holds

The `/v3/` result uses lists (plural names). The single names are the old version.

| In the result | Fields that matter |
|---|---|
| `id_verifications[]` | `document_type`, `document_subtype`, `document_number`, `issuing_state`, `expiration_date`, `date_of_birth`, `age`, `first_name`, `last_name`, `full_name`, `address`, `parsed_address`, `barcodes`, `front_image`, `back_image`, `portrait_image`, `warnings` |
| `liveness_checks[]` | `status`, `method`, `score`, `warnings` |
| `face_matches[]` | `status`, `score`, `warnings` |
| `ip_analyses[]` | `ip_country`, `is_vpn_or_tor`, `device_fingerprint`, `warnings` |
| `linked_records` | `same_face`: other people whose face matched |

The image links are short-lived. If we keep the images, copy them into our own private storage straight away.

### 9.3 How it maps to our checks

| Our check | From Didit |
|---|---|
| 1 Real licence | The status and warnings of `id_verifications` |
| 2 Live person | `liveness_checks.status` |
| 3 Face match | `face_matches.status` and `score` |
| 4 Details saved | The fields of `id_verifications` |
| 5 to 8 | Our own rules, on those fields |
| 9 Not blocked, not a repeat | Our `blocked_identities` on `document_number`, and `linked_records.same_face` |
| 10 Foreign renters | `document_type` and `issuing_state` |

### 9.4 Things to get right

| Point | Why |
|---|---|
| Set `multi_account_segment` to the company's id | Without it, Didit compares faces across everything we send. One person renting from two of our companies would be flagged as a duplicate. With it, the comparison stays inside one company. |
| Set `vendor_data` to the customer's id | It ties Didit's session to our customer |
| Same `workflow_id` and `vendor_data` returns the existing unfinished session | Didit does this by design. It affects "a new session ends the old one". Decide how you handle it and prove it in the sandbox. |
| Set `session_expiration_time` to 86400 | So Didit's session and ours end together |
| Verify every webhook, then fetch the result again | Order is not guaranteed. Never trust the webhook's body as the final result. |
| A webhook can arrive twice | Handling it twice must change nothing |
| One workflow for the standard check | The checks do not vary per session. The company's minimum age is our rule, not Didit's. |
| Illinois, Texas, Colorado | Didit can ask for explicit biometric consent, driven by `user_state` or by a consent we collected (`biometric_consent`) |
| Sandbox US licences carry no state | A rule that depends on the state will not match in the sandbox. Pass the state another way when testing. |
| Sandbox outcomes | `sandbox_scenario` at create time (for example `approve`, `decline_document_expired`), or `POST /v3/session/{id}/simulate/` with a `new_status` |

### 9.5 Confirm

| # | Not confirmed from the documents |
|---|---|
| 1 | Whether a US licence's class, restrictions and endorsements are returned. Check 8 needs the licence type. See what `document_subtype` and `barcodes` give for real US licences. |
| 2 | Whether the back barcode of a US licence is decoded |
| 3 | Whether a customer who stops can carry on in the same Didit session |
| 4 | When exactly a session becomes Abandoned |
| 5 | Where Didit stores data. Earlier research said the EU. |
| 6 | Adding a face or a licence to Didit's blocklist by API |
| 7 | Deleting a session by API: listed as `DELETE /v3/session/{sessionId}/delete/` |
| 8 | The white-label price: one page says $0.09 a session, another $0.10 |

### 9.6 Keys

There is **one** Didit key for the whole platform (D21). It is a secret on the Supabase project, never in the repo, the docs or the group. Staging uses the sandbox key. Live uses the live key and is set only during the relay. Ask Ghulam for the keys; do not create a new Didit account.

### 9.7 What one shared account means for the build

| Point | Detail |
|---|---|
| No per-company setup | Nothing in Settings or Integrations for Didit. No column per company for a key. The old `tenants.integration_veriff` column is not used. |
| Every call carries the company | `multi_account_segment` = the company's id and `metadata` = company id, customer id, our session id. That is how one account stays tidy across many companies, and how a webhook is matched back to the right company. |
| A webhook never chooses the company | The company comes from our own session row, found by our session id. Never from a field the caller could set. |
| One workflow for all | The standard check is the same for every company, so one Didit workflow serves everyone. |
| One webhook address | One destination on Didit's side, one handler on ours |
| Shared limits | Didit allows 600 session creates a minute for the whole account. All companies share that. Handle a 429 by waiting and trying again, not by failing the check. |
| Our cost per company | Record every finished Didit session against the company, even though it is free to them. Drive247's team needs to see what each company costs us. |

---

## 10. RentID (the premium checks)

You have RentID's developer documents. I do not, so this section says what the brief needs from them.

### 10.1 Confirm before building

| # | Question | Why it matters |
|---|---|---|
| 1 | How many credits does each check take: licence status, driving record, criminal record? | The price list (5.2) |
| 2 | What are the state fees, per check and per state? Is there a list or does each answer carry its fee? | The price and the total on screen 1 |
| 3 | Which states does each check cover? | Greying a check that cannot run. RentID's site lists licence status for CT, DC, FL, GA, ID, KS, MN, MO, NE, NJ, ND, RI, TX, WA, WV and WI only. |
| 4 | What does each check need as input? | Whether the standard check gives us everything, or the customer must type more |
| 5 | What consent must the customer give, and in what words? | The consent screens (7.1) |
| 6 | Is the answer immediate, or does it come later by webhook? How long can it take? | Screen 3 and the "in progress" state |
| 7 | When does RentID charge us: on the request, or on a result? Are errors charged? | The "finished" rule (5.4) |
| 8 | Is there a sandbox, and how do you force each answer? | The evals |
| 9 | What does a result look like for each check? | The result lines |
| 10 | Do RentID's terms allow one account to run checks for many rental companies and bill them on? | D21 says we work this way. If the terms forbid it, tell Ghulam before going live. |

Write the answers into your spec, with the page of the documents you took each from.

### 10.2 One RentID account for everyone (D21)

Drive247 already has RentID access. Every company's premium checks go through that one account. A company never has a RentID account, never buys RentID credits and never sees RentID's name on a setup screen.

| Point | Detail |
|---|---|
| One key | A secret on the Supabase project. Ask Ghulam. Do not create a new RentID account. |
| Drive247 buys the credits | RentID bills Drive247. The company pays Drive247, on its subscription bill, at our cost plus $0.50. |
| Running out of credits | If Drive247's RentID balance is empty, premium checks would fail for every company at once. Find out from the documents how the balance is read, and warn Drive247's team before it runs low. Until it is topped up, premium checks show "Not available right now" and nothing is charged. |
| Every request carries the company | Tag each RentID request with our session id, so a result is matched to the right company and customer |
| Our cost per company | Each charge row already holds what RentID charged us (section 11.3). That is the record of cost against income. |

### 10.3 How to build it

- **One interface, two providers.** Didit and RentID each sit behind the same small interface: start a check, read a result. Swapping a provider later is then one file. The research recommends this, and it matters here: RentID is a small company and its parent sells a rental platform that competes with us.
- **Send RentID as little as possible.** Only what a check needs. Never our list of companies.
- **Keep the raw answer** with the result row, so a result can be explained later.
- **A premium check starts by itself** once the standard check comes back Verified. Nobody presses anything.

---

## 11. Charging on the next subscription bill

### 11.1 What the portal already has

| Already built | Where | What it does |
|---|---|---|
| The next bill, line by line | `supabase/functions/integration-billing/` (action `upcoming`) | Asks Stripe for the upcoming invoice of the company's subscription and returns one row per line |
| The Billing page | `apps/portal/src/components/billing-v2/` | Shows the next bill ("Upcoming, estimated") and past bills |
| A per-use usage list | `report-usage-event`, table `esign_usage_log`, `apps/portal/src/lib/usage-categories.ts`, `use-usage-data.ts`, `components/settings/usage-dashboard.tsx` | Records each e-sign at $1 and shows the list on Billing. Made to take new kinds. |
| Monthly add-ons as their own bill line | `integration-billing` (action `subscribe`), table `tenant_integration_subscriptions_v2` | Premium integrations at a monthly price |
| Which Stripe account bills a company | `_shared/subscription-stripe.ts` (`getTenantSubscriptionAccount`, `getSubscriptionStripeClientForAccount`) | A company is billed on the `uk` or the `uae` account |

### 11.2 Who pays whom (D21)

| Money | From | To | When |
|---|---|---|---|
| Didit's $0.33 for a standard check | Drive247 | Didit | As Didit bills us |
| RentID's charge and any state fee | Drive247 | RentID | As RentID bills us |
| Our cost plus $0.50 for each premium check | The rental company | Drive247 | On the company's next subscription bill |

The company's money never goes to a provider, and a provider never bills a company. So the charge on the subscription bill is the only money the portal moves, and it is on Drive247's own Stripe subscription account, not on the company's Stripe Connect account.

Each charge row keeps the three parts apart (RentID's charge, the state fee, our margin), so Drive247's team can see for any month: what we paid out, what we took in, and the difference.

### 11.2a The problem with reusing the per-use one as it is

`report-usage-event` sends Stripe a meter event: a count of one, priced by a fixed price that must be attached to the subscription. Two things do not fit:

- It is switched off in practice. No meter price is attached to subscriptions today, so nothing reaches a bill.
- A meter has one fixed price per unit. Our premium checks do not: the state fee changes the amount from one check to the next.

### 11.3 Recommended way

For each finished premium check, add a **pending invoice item** to the company's Stripe customer, tied to their subscription. Stripe then puts it on the next subscription invoice by itself.

| Step | What |
|---|---|
| 1 | A premium check finishes. Write one charge row: company, customer, session, check, RentID charge, state fee, margin, total, all in cents. |
| 2 | Create the Stripe invoice item for the total, on the right account (`uk` or `uae`) and the right mode, with a description like "Licence active with the state · Marcus Hill · 2 Dec". |
| 3 | Save the Stripe id on the charge row. |
| 4 | The Billing page shows it: `integration-billing`'s `upcoming` already lists every line of the upcoming invoice, so the item appears there without new billing code. |
| 5 | The invoice is paid as usual. `subscription-webhook` already stores every invoice whatever lines it carries. |

Why this fits: the amount can differ per check, each line can name the customer, and it uses the "next bill" view that is already built.

You may propose the meter way instead in your spec if you find a clean answer to the state fee. Say why.

### 11.4 Rules

| Rule | Detail |
|---|---|
| Exactly once | A check is charged once, however many times a webhook arrives or a function is retried. Use the charge row's id as Stripe's idempotency key, and a unique rule in the table on (session, check). |
| Recorded is not billed | The charge row and the Stripe item are two steps, and the second can fail on its own. Keep a "sent to Stripe" mark. Retry the ones that failed. The screen never says "billed" for a row that did not reach Stripe. (The usage list already makes this same distinction.) |
| No subscription | A company with no active subscription (never subscribed, or cancelled): see open question Q2. Until Ghulam answers, do not let them tick premium checks, and say why on screen 1. |
| Trial | A company in its free trial has a subscription and a next bill. The item waits on it. |
| The price is frozen | The amount charged is the price saved on the session when it was made |
| No refunds in this round | A charge is not taken back by the portal. If one is wrong, Drive247's team fixes it in Stripe. |
| Past bills | The receipt for a past bill shows the check lines. `receipt-dialog-v2.tsx` shows e-sign usage today; do the same for checks. |

### 11.5 What Billing shows

| Where | What |
|---|---|
| The next bill | The plan, then each premium check kind with its count and amount, then "Standard check, N checks, Free", then the estimated total |
| This month's checks | Each one: the customer, the check, the day, the amount. Free ones too, marked Free. |

"Standard check, Free" is shown on purpose. It tells the company what it is getting for nothing.

### 11.6 Testing on Stripe (D18)

- Staging bills on Stripe **test mode**, on the UAE test account only. Never put a live key on staging.
- Use a **test clock** to move a test subscription forward to its next bill and see the items land on the invoice. That is how you prove rows 2, 3, 5, 6, 11 and 12 of section 5.3 end to end.
- For each of those rows: the screen total, the charge row, the Stripe invoice item and the invoice line must be the same number of cents.
- The northwind company on staging must have a test subscription for this. If it does not, set one up in test mode and say so in the group.

---

## 12. What exists today, and what must keep working

### 12.1 Today's flow

| Piece | Where | What it does |
|---|---|---|
| Make a session | `create-ai-verification-session` | Writes a row in `identity_verifications` with a QR token that lasts 3 hours. Ends older open sessions of the same customer. Limit: 10 an hour per customer. |
| The customer's page | `apps/booking/src/app/(legacy)/verify/[token]/page.tsx` | Takes the front, back and selfie, uploads them, writes `verification_step` as it goes |
| Decide | `process-ai-verification` | Reads the licence with an AI model (`ai-document-ocr`), compares faces with AWS Rekognition (`ai-face-match`): 90 or more passes, 70 to 89 asks for a retry, under 70 fails. Then checks `blocked_identities`. |
| Email the link | `send-verification-link-v2` | Rebuilds the link from the session and emails it |
| Tell the company | `notify-identity-verified` | Sends the notification |
| The portal's screen | `verify-id-screen-v2.tsx` | The QR code with live progress, read by polling the session |
| Own car insurance | `cmd-create-verification`, `use-cmd-verification.ts` | Modives. Not part of this task. |

### 12.2 Who else uses those functions

All of these call `create-ai-verification-session`, `process-ai-verification` or `send-verification-link-v2` today. **None of them may break.**

| Area | Files |
|---|---|
| Booking site, during a booking | `MultiStepBookingWidget.tsx`, `northwind-site/components/booking/identity-capture.tsx`, `documents-screen.tsx`, `use-booking-documents.ts`, `use-customer-verification.ts` |
| Customer invite registration | `register/[token]/page.tsx` in all three booking sites, `submit-customer-registration` |
| Customer's own portal | `portal/verification/page.tsx` (legacy and northwind), `portal-v2/settings/_sections/verification.tsx` |
| Secondary drivers | `_shared/additional-driver-invite.ts`, `use-rental-additional-drivers.ts`, `additional-drivers-card.tsx` |
| Creating a rental in the portal | `rentals/new/page.tsx`, `rentals-v2/rental-create-v2.tsx`, `rental-detail/stage-customer.tsx` |
| Old portal customer screens | `customers/customer-form-modal.tsx`, `identity-verification-tab.tsx`, `start-verification-dialog.tsx` |
| Others | `booking-documents-link`, `create-boldsign-document`, `trax-id-rescan-v2`, `customer-start-verification` |

### 12.3 The rules for touching it

| Rule | Detail |
|---|---|
| New, beside the old | Build the new module as new functions and new components. Do not change `create-ai-verification-session` or `process-ai-verification`. |
| Northwind only | The new module is for the northwind company, on the v2 portal, until Ghulam says otherwise. Every other company keeps what it has today. |
| Never edit a shared v1 file | If a screen is shared, fork it to a `-v2` file and point the v2 mount at the fork. Search for every importer first. |
| The add dialog is v2 | `customer-form-dialog-v2.tsx` is the v2 dialog, so D1 to D3 change it directly. Check who else opens it first. |
| The old screens still read the same customer fields | `customers.identity_verification_status` is read in many places (the list, the overview count, the rental flow). Keep writing it, with values those places understand. |
| Secondary drivers | A secondary driver's check stays on today's flow. Its rules (`_shared/secondary-driver-rules.ts`) are the model for our name and expiry rules: reuse them, do not copy them. |

---

## 13. Data: tables and columns

### 13.1 What exists

`identity_verifications` has, among others: `customer_id`, `tenant_id`, `provider`, `verification_provider`, `session_id`, `status`, `review_status`, `review_result`, `document_type`, `document_number`, `document_country`, `document_expiry_date`, `first_name`, `last_name`, `date_of_birth`, `address`, `document_front_url`, `document_back_url`, `selfie_image_url`, `ai_face_match_score`, `ai_ocr_data`, `qr_session_token`, `qr_session_expires_at`, `verification_step`, `rental_id`, and the `cmd_*` columns for Modives.

`customers` has: `identity_verification_status`, `license_number`, `license_state`, `id_number`, `date_of_birth`, `address_street`, `address_city`, `address_state`, `address_zip`, `is_gig_driver`.

`tenants` has: `minimum_rental_age`, `require_identity_verification`, `allow_rental_without_id_verification`, `accepted_verification_document`, `verification_document_type`.

`blocked_identities` has: `identity_type`, `identity_number`, `reason`, `is_active`, `tenant_id`, `customer_name`.

Storage: `verification-documents` is a **private** bucket and already exists. `customer-documents` is **public**.

### 13.2 What is needed

**Recommended.** Name them as you see fit in the spec.

| New thing | Holds |
|---|---|
| A sessions table | Section 6.1. Either new columns on `identity_verifications` or a new table that points at it. A new table keeps the old flow untouched. |
| A session moments table | Section 6.3: session, moment, time, detail |
| A check results table | One row per session and check: result, reason, raw answer, provider's id |
| A price list table | Section 5.2: check, RentID charge, margin, whether it is live or coming soon |
| A state fee table, if RentID gives a list | Check, state, fee |
| A charges table | Section 11.3: session, check, the three amounts and the total in cents, the Stripe id, sent or not |
| The company's last ticks | One small column or row per company (D9) |
| On `customers` | Licence expiry, licence type, and for each licence detail whether it is "verified" or "typed" (D4) |

### 13.3 Rules for the database

- New tables follow the standard: a UUID key, NOT NULL where a value is always there, real enum types for status words, `timestamptz` for times, foreign keys, RLS on, money in whole cents as integers.
- RLS: a company reads only its own rows. Only the service role writes results and charges. The price list is read by everyone signed in and written by Drive247's team only.
- Write one migration file. Apply the **whole file** to staging. Never alter a table in place half way through, or its column order ends up different from production and the database check fails.
- Say it in the group before you apply it. The staging database is shared by staging, ray1, ray2, ray3 and every laptop.
- Never run `supabase db push`.
- Nothing goes to production. Production changes only during a relay.

---

## 14. Privacy, consent and safety

| # | Rule |
|---|---|
| 1 | **Photos go in private storage.** Today's licence photos and selfies sit in `customer-documents`, which is public. Anything this module stores goes in a private bucket and is shown through signed links only. Do not move the old files in this task, but tell Ghulam what it would take. |
| 2 | **Consent before anything is taken.** The customer agrees to the photo and face check before the camera opens. Each premium check has its own consent. Record what was agreed, the exact words shown, and when. |
| 3 | **Driving and criminal records are regulated in the US.** They need the person's written consent, and a set process when someone is refused because of what they show. Build the consent and keep the record. The words of the consent and the refusal process are open question Q3: do not make them up. |
| 4 | **A selfie is biometric data.** Illinois, Texas and Washington have their own rules. Use Didit's consent support and keep our own record. |
| 5 | **Verify every webhook** from Didit and RentID. An unsigned or old webhook is refused. |
| 6 | **The customer never sees private details back.** No licence number, no photos, on any page they can open. |
| 7 | **The link is unguessable** and ends after 24 hours. It works once the session is live and stops when it is replaced, cancelled or finished. |
| 8 | **Who can press Verify.** Viewers cannot. Managers need the Customers tab with edit access (`lib/permissions.ts`). Premium checks spend the company's money: see open question Q4. |
| 9 | **Keys are secrets on the project.** One Didit key and one RentID key for the whole platform. Never in the repo, the docs, the group or a log line. Never sent to a browser: every provider call is made from an edge function. |
| 10 | **One company never sees another's data.** Every query is by company, and RLS proves it. |
| 11 | **Everything is logged.** Who started a check, who cancelled it, who typed a detail by hand. Use the audit log the portal has (`use-audit-log`). |

---

## 15. Edge cases

Each of these needs a statement in a spec and, where a script can prove it, an eval.

| # | Case | What should happen |
|---|---|---|
| 1 | The customer has no email and no phone | Only "show a code" and "copy the link" are offered |
| 2 | The email on file is wrong | Staff correct it on screen 2 before sending. Ask whether to save the correction on the customer. |
| 3 | Staff close the dialog right after sending | The session carries on. The row shows Link sent. |
| 4 | Staff press Verify on a customer with a live session | Screen 3 opens, not screen 1 |
| 5 | Staff start a new check while one is live | The old one ends. Its link says it was replaced. |
| 6 | The customer opens the link on a laptop | A QR code and "Open this on your phone" |
| 7 | The customer stops half way and comes back | Carries on, within 24 hours |
| 8 | The link is opened after 24 hours | "This link has ended" |
| 9 | The licence expires in three weeks, the rental is for a month | Verified today. At rental creation, check 5 fails against the return date and says so. |
| 10 | The customer is 20 and the company's minimum is 21 | Failed, "Under your minimum age of 21" |
| 11 | The company has no minimum age set | Check 6 is "Not set", and the line says where to set it |
| 12 | The name on file is "Mike Hill", the licence says "Michael James Hill" | Decided by the shared name rule. Whatever it decides, the line shows both names. |
| 13 | A learner's permit | Failed on check 8 |
| 14 | A passport from another country | Read and accepted where the company accepts it. Checks 11 to 13 cannot run and are not charged. |
| 15 | The licence number is on the blocked list | Failed on check 9. The customer is marked blocked, as today. |
| 16 | The same face was verified under another name at this company | Check 9 flags it |
| 17 | The same person rents from two of our companies | Not a flag. This is why `multi_account_segment` is the company's id. |
| 18 | Didit says "In Review" | See open question Q1 |
| 19 | The Didit webhook arrives twice, or late, or out of order | One result, the right one |
| 20 | The Didit webhook never arrives | A fallback fetches the result. A customer is never stuck on In progress. |
| 21 | RentID is down | The premium check says "Could not check, try again". Not charged. Staff can run it again without a new standard check. |
| 22 | RentID does not cover the state | "Not available in this state yet". Not charged. |
| 23 | The customer refuses the driving record consent | That check does not run and is not charged. The rest goes ahead. |
| 24 | A premium check finishes but the Stripe item fails | The charge row is kept as "not sent" and retried. Never lost, never doubled. |
| 25 | The company's subscription is cancelled before the next bill | See open question Q2 |
| 26 | The company is past due on its bill | See open question Q2 |
| 27 | The same customer is verified twice in a month with premium checks | Charged twice. Screen 1 says "Verified on 2 Dec" so staff see it before paying again. |
| 28 | Staff type the licence by hand, then the check runs | The checked details replace the typed ones and the mark becomes "verified" |
| 29 | A verified customer's name is edited afterwards | The page already warns when details move under a result (`section-verification.tsx`). Keep that working. |
| 30 | A price changes while a session is open | The session keeps the price it was made with |
| 31 | A manager with view-only access | No Verify button |
| 32 | Another company's staff guess a session id | Nothing. RLS. |
| 33 | Dark mode, and a 360-wide phone | Every screen works in both |
| 34 | Drive247's RentID balance is empty | Premium checks say "Not available right now". Nothing is charged. Drive247's team is told. |
| 35 | Didit answers 429 because all companies together hit the limit | Wait and try again. The staff member sees a short delay, not a failure. |
| 36 | A new company signs up today | It can verify a customer straight away, with nothing to connect |

---

## 16. Things I found that you should look at

Found while reading the code for this brief. Prove or disprove each one. Do not take them as facts.

| # | Suspicion | Where |
|---|---|---|
| 1 | A link made on staging points at the live booking site | `create-ai-verification-session`, `buildQRUrl` |
| 2 | Today's link lasts 3 hours, not 24 | The same function |
| 3 | The rate limit lets the request through when its own query fails | `checkRateLimit` in the same function |
| 4 | Licence photos and selfies are in a public bucket | `customer-documents` |
| 5 | `process-ai-verification` builds public links to the photos | `getStoragePublicUrl` |
| 6 | Expiry and name are checked only for secondary drivers today | `process-ai-verification` |
| 7 | The per-use billing records usage but nothing reaches a bill, because no meter price is attached | `report-usage-event` |
| 8 | One in three people who start a check never finish: 189 of 537 in the last 90 days on production | `identity_verifications` |
| 9 | The staff add dialog checks the blocked list on a typed number; once the licence screen is gone that check has nothing to check | `customer-form-dialog-v2.tsx` |
| 10 | The customers list still imports the old start-verification dialog | `customers/page.tsx` |
| 11 | Many places read `identity_verification_status` with their own idea of the words (`verified`, `pending`, `unverified`, `rejected`) | The list, the overview, the rental flow |
| 12 | Didit returns an existing unfinished session for the same customer and workflow, which may fight "a new session ends the old one" | Didit's create-session behaviour |

Number 8 is the one this module is meant to move. Record what the number is on staging before and after.

---

## 17. What you hand in

The same path as every feature, with nothing left out: PRD, then specs, then evals, then the QA report, then the pull request, then the Supercut video. The skills are `prd`, `spec`, `eval` and `qa-report`. Follow `docs/onboarding/02-how-a-feature-is-built.md` for each one.

### 17.1 Before you start

1. Resync. `ray1` is behind `main`. Follow `docs/onboarding/03-staying-in-sync.md`.
2. Read `docs/onboarding/` if you have not, then this file, then the research file.
3. Take `haris/feat/driver-verification` from `staging`.
4. Read RentID's documents and answer section 10.1. Read Didit's and answer section 9.5.
5. Tell Ghulam anything in those answers that changes this brief, before you write the specs.

### 17.2 The documents

| Step | What | Where |
|---|---|---|
| 1 | The PRD section, in plain business language | `docs/application/PRD.md` |
| 2 | The specs, with numbered statements | `docs/application/feat-003-driver-verification/specs/` |
| 3 | One eval per spec; money math in Vitest | `.../evals/` |
| 4 | The QA report | `.../qa-report.md` |
| 5 | A pull request from `ray1` | |

Suggested specs, one per part:

| # | Spec |
|---|---|
| 01 | Add customer without verifying, and typed details |
| 02 | The Verify button and the one status |
| 03 | The Verify dialog: the table, last time's ticks, the total |
| 04 | Sending: email, text, code, copy |
| 05 | The session: statuses, moments, 24 hours, one live session |
| 06 | The link and the customer's pages, and how they change with the ticks |
| 07 | The standard check through Didit: the webhook, the result, the ten checks |
| 08 | The premium checks through RentID |
| 09 | Prices and charges (with the worked rows of section 5.3) |
| 10 | The next bill and the Billing tab |
| 11 | The warning when creating a rental |
| 12 | Who can do what, and one company never sees another's |

### 17.3 Evals

- Evals run on staging, never on production, and never drive a browser.
- Didit runs in its sandbox. RentID in its sandbox if it has one; if not, say how you proved it.
- Stripe runs in test mode with a test clock.
- Every row of section 5.3 is a Vitest case.
- `npm run eval -- feat-003` must end with every statement proved.

### 17.4 The QA report

Things only a person can check, done on the `ray1` sites, never on localhost:

- The whole journey on a real iPhone and a real Android phone, with a real licence.
- Each way of sending, received for real.
- A link opened on a laptop.
- The money rows redone on a calculator and compared with the screen, the Billing tab and the Stripe test invoice: three numbers written down per row.
- Light and dark, and a 360-wide phone.
- That the booking site's own verification, the invite registration and a secondary driver still work exactly as before.

### 17.5 The Supercut video for Ghulam

When everything above is done, record one Supercut video and send the link to Ghulam in the group. Record it on your `ray1` sites, not on localhost. Talk through what you are doing as you do it.

It shows, in order: adding a customer; the row saying Not verified; the Verify dialog with last time's ticks; each way of sending; the customer's phone; the progress filling in; the result with all its lines; a failed check; a premium check; the Billing tab with the next bill; the Stripe test invoice after the test clock moves; and creating a rental for an unverified customer.

### 17.6 It is complete when

- Every statement is proved and every item of part 1 of the QA report is ticked, in your own words.
- Nothing in section 12.2 behaves differently.
- `npm run synced` differs only by this feature's own migration and functions.
- The PRD section, the specs, the evals and the QA report are all in the pull request, written the way `docs/onboarding/02-how-a-feature-is-built.md` describes.
- You have sent Ghulam the Supercut video, with the pull request, in the group.

Nothing is relayed until Ghulam says "relay to prod".

---

## 18. Open questions for Ghulam

Do not guess these. Each has a recommendation; build to the recommendation only after Ghulam says yes.

| # | Question | Recommendation |
|---|---|---|
| Q1 | Didit can answer "In Review", and a premium check can come back bad while the standard check passed. The six statuses (D6) have no word for "a person should look". | Add a seventh, "Needs a look", for Didit's In Review. For a bad premium result, keep Verified and show a warning mark on the row with the reason. |
| Q2 | A company with no active subscription, or past due, ticks a premium check. There is no next bill to add it to. | Premium checks need an active or trialing subscription. Otherwise the ticks are greyed with "Subscribe to use premium checks". Past due: allowed, until the portal's own block starts. |
| Q3 | The consent words for the driving and criminal records, and what the company must do when it refuses someone because of them. | Ask a lawyer before these two checks go live for real customers. Build them now behind a switch that Ghulam turns on. Licence active with the state can go first. |
| Q4 | Who may tick premium checks, since they spend the company's money? | Head admin and admin always. Managers only with edit access to Customers. Ops and viewers: standard check only. |
| Q5 | Do we keep the licence photos and the selfie, and for how long? | Keep them in private storage for the life of the customer, because the dispute pack in a later round needs them. Confirm the period with the same lawyer. |
| Q6 | The "typed, not verified" details (D4): can a rental go ahead on typed details alone? | Yes, where the company's settings already allow a rental without verification. The rental shows "Not verified". |
| Q7 | Should the booking site (a renter booking online) move to this module too? | Later, as its own task, once the portal side is proven. Today's one-in-three drop-off is mostly there, so it is worth doing next. |
| Q8 | The due date. The old note said end of day Saturday 28 Nov, written before this brief existed. | Ghulam sets a new one after Haris has read RentID's and Didit's documents and sized the work. |
| Q9 | Feature folder numbers. Hamza's is `feat-001-account-creation` and Hamna's branch uses `feat-001-call-booking`. | Hamza keeps 001, Hamna takes 002, this one is 003. |
