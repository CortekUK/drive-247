# Round 2: promo codes, referrals and campaigns

*Full brief for Hamza · From Ghulam · 27 Nov 2026 · Starts after round 1 (account creation) is handed in*

> **Your task in one line.** Own the three ways Drive247 gives a company money off its subscription: promo codes, referrals and campaigns. Check everything that exists, fix what is wrong, build what is missing, and prove the math. When you hand this in, nobody should need to look at it again.

> **Two things matter most.**
>
> - **The math.** Every number here ends on a real bill. Work each one out by hand first, then prove it against Stripe. Section 7 has the worked examples.
> - **The phone.** The banner, the code field and the leave offer are seen mostly on a phone, often inside Instagram or Facebook. Check on an iPhone and an Android phone before a laptop.

This document is what you write your PRD, specs, evals and QA report from. It is in this order: what each feature is (sections 1 to 5), what is done and what is not (6), the math (7), what to check (8 to 10), and how to hand it in (11 to 14).

## 1. The three features in plain words

| Feature | What it is | Who starts it |
|---|---|---|
| **Promo code** | A word such as WELCOME20 that takes money off a new company's subscription for a set time. | Ghulam creates it in super admin. A person types it or arrives by a link. |
| **Referral** | Every subscribed company has its own code and link. A new company that uses it gets a discount. The company that shared it gets a discount on its own bill for as long as the new company stays. | A rental company shares its link. |
| **Campaign** | An offer for everyone for a few days, such as Black Friday. It shows a banner and applies itself. Nobody types anything. | Ghulam switches it on. Today a developer has to. |

### Words used in this document

| Word | Meaning |
|---|---|
| New company | The company signing up. The code calls it the *referee*. |
| Referrer | The company whose code or link was used. |
| Tier | A level of reward for the referrer, set by how many of its referred companies are subscribed right now. |
| Redemption | One use of a code by one company. |
| The engine | The job that works out referrals and rewards (`referral-engine`). Every 15 minutes on production. |

> **A naming trap.** In the database a normal promo code already has `kind = 'campaign'`, and a referral code has `kind = 'referral'`. So "campaign" in the code today means "a promo code Ghulam made". The new feature in section 4 needs its own name in code. Choose it in your spec and never reuse the word for two things.

There is also a second, unrelated promo code system: codes a rental company gives to its own renters (portal → Promotions, table `promocodes`). It is not part of this task.

## 2. Promo codes

### The story

1. Ghulam opens super admin → Promo codes → Codes and creates a code.
2. A person signing up reaches the card step. The code is already there (from a link) or they type it.
3. The card step shows the lower price and what it will be afterwards.
4. They finish. Stripe puts the discount on the subscription, for that plan only.
5. The discount ends by itself after its months. The next bill is full price.

### What a code has

| Setting | Detail |
|---|---|
| Code | Capital letters and digits, single dashes allowed, up to 64 characters. Typing is not case-sensitive. |
| Discount | A percent (up to 100) or a fixed amount in dollars. |
| How long | Once (the first paid bill), a number of months, or forever. |
| Maximum uses | Optional. |
| Expires on | Optional date and time. |
| Only for these plans | Optional. A list of signup plan keys, typed by hand. |
| Internal note | For the team only. |
| Status | Active or switched off. |

### The rules today

| Rule | Detail |
|---|---|
| New companies only | Refused for a company that has ever had a real subscription. A declined card does not count as one. |
| One code per signup | Never two together. |
| Plan price only | The discount applies to the plan. It never touches the $1 card check or e-sign usage. |
| With a free trial | The discounted months are counted so that "3 months" means 3 paid bills. See section 7. |
| Editing a code | Stripe coupons cannot be changed, so an edit retires the old version and makes a new one with the same word. Companies that already used it keep what they got. The use limit counts across all versions. |
| Looking a code up | Limited to 30 tries in 10 minutes for one visitor. |
| Who can do what | Super admin: everything. Sales agent: read, copy links, put a code on a payment link. Nothing that changes money. |

### Where a code can come from

| Way in | Detail |
|---|---|
| Typed on the card step | "Have a promo code?" |
| A link with `?promo=CODE` | Used by ads. Remembered like a referral link. |
| A referral link | Section 3. |
| The leave offer | Section 5. |
| A payment link from sales | Exists, not in this task. |

### Why a code is refused, and the words shown

| Reason | Message today |
|---|---|
| Not found | We don't recognise that code. |
| Expired | That code has expired. |
| Used up | That code has already been used as many times as it allows. |
| Switched off | That code is no longer active. |
| Wrong plan | That code can't be used with this plan. |
| Not a new company | Promo codes are for new Drive247 subscriptions only. |
| A second code | Only one code can be used, and this link already has one. |
| Too many tries | Too many tries. Please wait a few minutes and try again. |
| Could not check | We couldn't check that code just now. Please try again. |
| Referrals off | Referral codes aren't available right now. |
| Referrer's code off | That referral code isn't active right now. |
| Own code | You can't use your own referral code. |
| Already referred | Your account is already linked to a referral. |

## 3. Referrals

### The story for the referrer

1. A subscribed company opens Referrals in its portal (v2 portal: inside Billing).
2. It sees its code, for example `SUNSET-4821`, and its link, `drive-247.com/r/SUNSET-4821`, with share buttons.
3. It sees what a new company gets, its own tier, how many more it needs for the next tier, who it referred and whether each still counts, and how much it has saved.
4. When a referred company subscribes, the referrer's next bill is lower. It gets a notice in the portal and an email.
5. If someone joined without the code, it can send a claim: "someone joined because of me". Super admin approves or rejects it.

### The story for the new company

1. It opens the link. The landing page opens at pricing with a banner: "Sunset Rentals invited you: 20% off for your first 3 months."
2. The prices on the page show the discount.
3. The code is remembered for 90 days, through Google sign-in and the return from the card.
4. On the card step the code is already applied.

### The rules today

| Rule | Detail |
|---|---|
| Who gets a code | Every subscribed company that is not suspended. The engine creates it. |
| The code's shape | The business name without common words ("Sunset Rentals" → SUNSET), up to 10 characters, then 4 digits. |
| New company's discount | 20% off for the first 3 months. Set in Settings; can be different for one referrer. |
| Referrer's reward | By tier: 1 subscribed referral = 10% off every bill, 3 = 20%, 5 = 30%. |
| Tiers are levels | Never added. 2 referrals in the 10% tier is 10%, not 20%. |
| What "subscribed" means | Today: the referred company's subscription is active, in its free trial, or payment is due. Cancelled or unpaid stops counting. **This changes, see below.** |
| When the reward changes | From the referrer's next bill. It goes down again when a referred company leaves. |
| One referrer per company | A new company can be linked to one referrer only. |
| No self-referral | A company cannot use its own code. |
| Other discounts | The reward is added to the referrer's subscription without removing any other discount, and it always goes last. |
| Name on the banner | A referrer can choose not to show its name. |

> **Decided change: a referral counts only after the first paid bill.** Today a referrer is rewarded the moment the new company starts its free trial, before it has paid anything. After your work, a referral starts counting when the new company has paid its first bill. It keeps counting while that company is active or its payment is due, and stops when it cancels or goes unpaid. During the trial the referrer's page shows the referral as "in free trial, not counted yet".

### What super admin can do

| Tab | What it does |
|---|---|
| Codes | Create, edit, switch off promo codes. See uses. |
| Referral links | Each company's code and link. Per company: switch referrals off, give it its own tiers, its own new-company discount, its own name in the code, a new code. Attach a referral by hand, with or without the discount. Void a referral with a reason. **Sync now**. |
| Claims | Approve or reject "someone joined because of me". |
| Leaderboard | Who has referred the most. |
| Settings | The programme on or off, the default new-company discount, the default tiers, digits in a code, days a link is remembered. Run the engine for everyone. |

## 4. Campaigns

### Today: Black Friday, written by hand

| What it does | Detail |
|---|---|
| The offer | BF30: 30% off the first 3 monthly payments. |
| Runs | From its release until Mon 30 Nov 2026, 11:59pm Eastern. It stops by the clock. |
| Applies itself | Every new signup gets BF30, wherever they came from. |
| Replaces other codes | A referral code, WELCOME20 or DRIVE20 is dropped in favour of BF30. |
| Banner and wording | On the landing page and the card step. All fixed in the code. |
| Ends on the server too | The BF30 code expires at the same moment, so an old tab cannot get it late. The card step then carries on at full price. |
| Test clock | `?bf_now=2026-12-02T00:00:00Z` pretends it is that moment. Ignored on drive-247.com. |

Every date, word and rule above is typed into `apps/web/src/lib/black-friday.ts`. The next campaign needs a developer again. That is what you fix.

### What to build

A new tab in super admin → Promo codes where Ghulam creates a campaign himself.

| A campaign has | Detail |
|---|---|
| A name | For the team, for example "Black Friday 2026". |
| A promo code | Picked from the Codes tab. A campaign does not invent a second kind of discount. |
| Start and end | Date and time, with the time zone shown. |
| Banner text, headline, fine print | Shown on the landing page and the card step while it runs. |
| Leave offer code | Optional (section 5). |
| Status | Draft, scheduled, running, ended. It can be stopped early. |

| Rule | Detail |
|---|---|
| Applies itself | While it runs, every new signup gets the code without typing. |
| One at a time | Overlapping dates are refused when saving. |
| Ends on the server too | The campaign's end and the code's expiry are the same moment. Saving a campaign keeps them equal. |
| Nothing running | The site looks and works exactly as it does with no offer. |
| Preview | Keep a test clock so a campaign can be seen before it starts. Never honoured on drive-247.com. |
| Prices shown | The landing page plans and the card step show the campaign price, the months, and the price afterwards. |
| Look | Same as the other tabs. Dialogs, not side sheets. No browser pop-ups. Flat, no shadows. |
| Results | The campaign shows how many signups used it. |

> **Decided: Black Friday becomes the first campaign, and it is yours.** Move it out of the hand-written file into a campaign, set up as an active campaign with the same code, banner, wording and end time. A signup must get exactly what it gets today; prove that in your evals. Until your work is relayed, the live Black Friday must keep working untouched. If its end date has passed by the time you get there, ask Ghulam for the dates before you activate it.

## 5. The leave offer, and which code wins

### The leave offer today

| Rule | Detail |
|---|---|
| Where | The card step only. |
| Trigger | Laptop: the mouse leaves through the top of the window. Phone: the X or the back button. |
| Once | Once per person: remembered in the browser and on the account, so not on another device either. |
| Never when | A code is already applied, a payment is in progress, or signup is finished. |
| The code | WELCOME20, fixed in the code. During Black Friday the "email me a link" button uses BF30. |

**Your change:** the code it offers comes from super admin, and a running campaign can set its own.

### Which code wins

One discount per new account. Today the only rule is "BF30 replaces everything". Ghulam has decided the rule below. Write it in the PRD as it is, and build it in one place that every screen and function uses.

> **The rule (decided by Ghulam, 27 Nov 2026).**
>
> | Situation | Result |
> |---|---|
> | Campaign running, nothing else | Campaign code. |
> | Campaign running, person came by a referral link | The new company gets the campaign discount. The referrer still gets credit for the referral. |
> | Campaign running, person types another code | Refused with a clear message: the campaign offer is already applied. |
> | No campaign, referral link, then a typed code | The typed code replaces the referral only if the person confirms. |
> | Campaign ends while they are on the card step | Signup carries on. The price shown and the price charged are the same. |

Row 2 is a change you build. Today, during Black Friday, the referral code is dropped before the card step, so the referrer gets no credit at all. After your work the referral is recorded even though the new company's discount is the campaign's.

### Other discounts that can be on the same subscription

You do not change these, but your math must hold when they are present.

| Discount | From |
|---|---|
| Promo or campaign code | Signup. |
| Referral tier reward | The engine. Always last. |
| "Discount next invoice" | Super admin, one bill. |
| Retention offer | The company accepts it when cancelling. Once ever. |
| Creator reward | Super admin approves a submission. Once ever. |
| Tenure reward | A daily job, for long-standing companies. |

## 6. What is done, what is not, what I suspect

### Done and live

| Thing | State |
|---|---|
| Creating, editing, switching off codes | Live. |
| Codes typed or carried by a link at signup | Live. BF30 has been used by 5 real signups. |
| Referral codes and links | Live. 54 companies have a code. |
| Landing page banner and discounted prices | Live. |
| Tiers, the engine, notices and emails | Live, every 15 minutes. |
| Portal Referrals page, claims | Live. |
| All five super admin tabs | Live. |
| The leave offer | Live. |
| Automated checks of the rules | 25 exist in `supabase/functions/_tests/referrals`. They use a pretend Stripe, not staging. |

> **Live does not mean proven.** In production there has been exactly one referral, attached by hand during a test, and that company has since cancelled. No company has ever earned a tier reward on a real bill. One claim has been waiting since 6 Nov. The referral side has never been through real use. Treat it as untested.

### Not done

| Thing | Detail |
|---|---|
| Campaigns from super admin | Does not exist. Section 4. |
| The "which code wins" rule | Decided (section 5), not built. Only the Black Friday shortcut exists. |
| Referral counts only after the first paid bill | Decided (section 3), not built. |
| Leave offer code from super admin | Fixed in the code. |
| PRD section, specs, evals, QA report | None for promo codes or referrals. |
| Staging data | Staging has no referral settings, no tiers, and no WELCOME20 or DRIVE20. Section 12. |
| Plan picker on a code | The plan limit is typed by hand as text. Production has a code limited to a plan key that does not exist. It should be a list to pick from. |

### Things I suspect are wrong

These come from reading the code, not from testing. Check each one. If it is real, fix it and write it in your report. If it is not, write why.

| # | Suspicion | Why |
|---|---|---|
| 1 | A use limit can be passed. | A use is recorded by the engine up to 15 minutes after signup, not at the card step. Two people can use a "1 use" code in that gap. |
| 2 | A 30-day trial gives 4 discounted bills, not 3. | Worked out in section 7. Trials are 14 days today, but super admin can give one email a longer trial. |
| 3 | Changing plan loses the promo discount. | The discount is tied to one plan's product, and each plan has its own product. |
| 4 | The screen and the bill can differ by one cent. | The landing page and card step work the price out in the browser, in two different places. Stripe works out the bill. Three calculators. |
| 5 | A referrer is rewarded before the new company pays anything. | A free trial counts as subscribed. **Decided: change it.** Section 3. |
| 6 | Referrals cannot be tested on staging at all. | Signups on staging are marked as test companies, and the engine skips test companies except northwind. |
| 7 | A referrer gets nothing during a campaign. | **Decided: the referrer still gets credit.** Section 5. |
| 8 | A fixed-amount code larger than the plan price. | Check the bill is $0, not negative, and nothing carries to the next bill unless the PRD says so. |
| 9 | A new company that cancels and returns. | Does the referral count again? Does the referrer's tier come back? |

## 7. The math

Plans today (read them from Signup Plans before you start, in case they changed):

| Plan | Price a month | Free trial |
|---|---|---|
| Starter | $129 | 14 days |
| Growth | $229 | 14 days |
| Scale | $349 | 14 days |

### 7.1 One percent code

| Code | Starter | Growth | Scale |
|---|---|---|---|
| 10% off | $116.10 | $206.10 | $314.10 |
| 20% off (WELCOME20, a referral) | $103.20 | $183.20 | $279.20 |
| 30% off (BF30) | $90.30 | $160.30 | $244.30 |
| 50% off | $64.50 | $114.50 | $174.50 |

### 7.2 The bills over time

Growth, BF30, signed up 25 Nov 2026, 14-day trial.

| Date | What | Charged |
|---|---|---|
| 25 Nov | Signup. Trial starts. | $0 |
| 9 Dec | Paid bill 1 | $160.30 |
| 9 Jan | Paid bill 2 | $160.30 |
| 9 Feb | Paid bill 3 | $160.30 |
| 25 Feb | The discount ends (3 months after signup) |  |
| 9 Mar | Paid bill 4 | $229.00 |

Total saved: 3 × $68.70 = $206.10. The discount is counted from signup, not from the first paid bill.

### 7.3 Trial length and the number of discounted bills

The rule in the code: add one month to the discount for every whole 30 days of trial. For a "3 months" code:

| Trial days | Discount runs for | Expected |
|---|---|---|
| 0 | 3 months | 3 paid bills |
| 14 | 3 months | 3 paid bills |
| 29 | 3 months | 3 paid bills |
| 30 | 4 months | 3 paid bills. **I get 4.** |
| 31 | 4 months | 3 paid bills. On the edge. |
| 45 | 4 months | 3 paid bills |
| 60 | 5 months | 3 paid bills. Check. |

**The 30-day case by hand.** Signup 1 Dec, 30-day trial. Bills fall on 31 Dec, 31 Jan, 28 Feb, 31 Mar. The discount runs 4 months from 1 Dec, so it ends 1 Apr. All four bills are before 1 Apr. That is 4 discounted bills.

A "once" code with a trial becomes a 1-month discount so it lands on the first paid bill and is not spent on the $0 trial bill. A "forever" code is never stretched.

Use Stripe test clocks to move a test subscription forward month by month. Do not wait for real dates.

### 7.4 Fixed-amount codes

| Code | Starter | Growth | Scale |
|---|---|---|---|
| $20 off, once | $109.00 | $209.00 | $329.00 |
| $150 off, once | $0.00 | $79.00 | $199.00 |

### 7.5 The referrer's reward

Default tiers. A referrer on Growth:

| Subscribed referrals | Tier | Referrer's bill |
|---|---|---|
| 0 | None | $229.00 |
| 1 | 10% | $206.10 |
| 2 | 10% | $206.10 |
| 3 | 20% | $183.20 |
| 4 | 20% | $183.20 |
| 5 | 30% | $160.30 |
| 6 | 30% | $160.30 |

Going down: 3 referrals (20%), one cancels → 2 → 10% from the next bill. All cancel → no reward, and the notice says the reward has paused.

With the decided change, a new company in its free trial does not count yet. Example: 3 referrals, one still in its trial → 2 count → 10%. On the day that company pays its first bill → 3 count → 20% from the referrer's next bill.

"You have saved": the reward taken off each paid bill, added up. Three bills at 10% on Growth = 3 × $22.90 = $68.70.

A company with its own tiers uses only its own. The two tables are never mixed.

### 7.6 Two discounts on one subscription

Stripe applies percent discounts one after the other, each on what is left. They are not added. Confirm this on a Stripe test invoice before you rely on it.

| Case | Starter | Growth | Scale |
|---|---|---|---|
| Joined with 20%, then earns the 10% tier | $92.88 | $164.88 | $251.28 |
| Joined with BF30, then earns the 30% tier | $63.21 | $112.21 | $171.01 |

Growth, second row: $229 × 0.70 = $160.30, then × 0.70 = $112.21. It is not 60% off ($91.60).

### 7.7 Rounding

Use prices where the percent does not divide evenly. Example: 12.5% off Growth is $28.625 off, which leaves $200.375. The landing page, the card step, Stripe and the invoice must all show the same cents. Write down which way it rounds, and test it.

### 7.8 The money table for Vitest

Your spec carries one table with every row above, plus: each plan × each kind of code × trial 0 and 14 days; the tier table from 0 to 6 referrals; both stacking cases; three rounding cases. Vitest runs every row. In the QA report a person redoes rows on a calculator and compares with the screen and the bill.

## 8. What to check: promo codes

| Area | Cases |
|---|---|
| A good code | Typed. From `?promo=`. Lower case, with spaces around it. On each plan. Removed, then another applied. |
| Every refusal | Each row of the refusal table in section 2 shows its own message, on the card step and on the landing page. |
| Kinds | Percent and fixed. Once, months, forever. With and without a trial. |
| Limits | The last allowed use works and the next is refused. Two people at the same moment (suspicion 1). A code that expires while someone is on the card step. |
| Editing | Edit a code that was already used: old users keep their terms, new users get the new ones, the use count carries over. |
| Plan limit | Allowed on one plan, refused on another. The person changes plan after applying it. |
| After signup | The discount is on the first paid bill, in Stripe, on the invoice and on the portal's billing page. It ends on the right bill. |
| Plan change later | The company changes plan while the discount runs (suspicion 3). |
| Super admin | Create, edit, switch off and on. Uses shown. Search. A sales agent cannot change money. Phone and laptop. |
| Abandoned signup | A code applied, the card never entered: it is not counted as a use. |

## 9. What to check: referrals

| Area | Cases |
|---|---|
| The link | Opens at pricing with the banner. A wrong code. A switched-off code. Inside Instagram and Facebook. Remembered the next day, after Google sign-in, and after the card step returns. |
| The banner and prices | The name, the discount and the months are right. The name is hidden when the referrer chose that. Fits a 360-wide phone. |
| Refusals | Own code. Already referred. Programme off. Referrer switched off. Referrer suspended. |
| The new company | Gets the discount for the right number of paid bills. Its Referrals page shows what it joined with and how many discounted bills are left. |
| Free trial does not count | A referred company in its trial: not counted, and the referrer's page says so. It pays its first bill: counted. It ends the trial without paying: never counted. |
| The referrer, going up | 1, 3, then 5 subscribed referrals: the right tier each time, on the next bill, with a notice and an email each time, sent once. |
| The referrer, going down | A referred company cancels, goes unpaid, or ends its trial without paying. The tier drops. All leave: the reward stops. |
| The referrer has no subscription | Nothing breaks. The reward starts when it subscribes. |
| Other discounts kept | The referrer already has a promo discount or a "discount next invoice": both stay, the reward is added last. |
| Own tiers, own discount | A company with its own tiers and its own new-company discount. Changing the default does not change it. |
| Changing the default discount | Companies on the default get a new version of their code. Companies that already joined keep what they got. |
| New code for a company | The old link stops working. The new one works. Past referrals stay. |
| By hand | Attach with the discount and without. Void with a reason: the tier is worked out again. |
| Claims | Send one from the portal. Approve: a referral is made. Reject. The portal shows the result. |
| Leaderboard and counts | Super admin, the portal and Stripe agree. |
| The engine | Run it twice in a row: the second run changes nothing. Two runs at once do not double anything. |

## 10. What to check: campaigns and the leave offer

| Area | Cases |
|---|---|
| Creating | Each field empty or wrong. Overlapping dates refused. End before start refused. A code that expires before the campaign ends. |
| Before, during, after | With the test clock: one minute before the start, during, one minute after the end. Banner, prices and the code on the card step each time. |
| Stopped early | The banner goes and the code stops within a minute, on an open tab too. |
| The end on the card step | Signup carries on at full price, and the screen says the same price that is charged. |
| With other codes | Every row of the "which code wins" table. |
| Black Friday as a campaign | Same discount, banner, wording and end time as today, now coming from the campaign. The hand-written file is no longer what decides it. |
| Phone | The banner on 360 and 430 wide. It does not cover the menu or the signup button. |
| Leave offer | Each trigger. Once only, on a second device too. Never with a code applied. Accepting changes the price at once. The code comes from super admin. During a campaign it follows the campaign. |

## 11. What to hand in

| Document | Detail |
|---|---|
| PRD | Three sections in the one PRD: Promo codes, Referrals, Campaigns. Plain business language. Include the three decisions already made: the "which code wins" rule, a referral counting only after the first paid bill, and Black Friday as the first campaign. |
| Specs | One per part, each with numbered statements. Suggested: code rules and refusals; discount length and trials; referral attribution; tiers and the reward; campaigns; which code wins; the leave offer; super admin screens. Every spec with money carries a hand-worked table. |
| Evals | One per spec, against staging. Money math in Vitest. The 25 existing checks are a start, but they use a pretend Stripe. |
| QA report | What a person checks by hand, on your ray2 sites, on real phones. |
| Findings | Each of the 9 suspicions: real or not, and what you did. |
| Pull request | From `ray2`, with all of the above. |

**Finished means:** every statement proved, every QA item ticked, every suspicion answered, and the money table passing.

## 12. Before you start: staging is empty

| Missing on staging | What production has |
|---|---|
| Referral settings | On. New company: 20% for 3 months. 4 digits. 90 days. |
| Default tiers | 1 → 10%, 3 → 20%, 5 → 30%. |
| WELCOME20 | 20% for 3 months, no limit. The leave offer needs it. |
| DRIVE20 | 20% for 3 months, 1 use. |
| Any referral code | Staging has none. |

- Add these to staging first, and say so in the group. Until then the referral screens fail on staging.
- The engine's timer is off on staging. Use **Sync now** after each test signup.
- Solve suspicion 6 first, or no referral test can pass. Do it in a way that cannot switch the rule off on production.

## 13. How to work

| Rule | Detail |
|---|---|
| Where you build | On `ray2`, brought level with `main` first. |
| Where you test | `ray2.drive-247.com`, `admin.ray2.drive-247.com`, `northwind.portal.ray2.drive-247.com`. Staging database, Stripe test cards, Stripe test clocks. |
| Never | A real signup on production. Never create, change or use a code on production. |
| Database and functions | Staging only, and say so in the group first. |
| One place per rule | Price math, the "which code wins" rule and the wording each live in one place that every app calls. No copies. |
| Things outside this task | Write them down for Ghulam. |

### Not in your task

> - Payment links sent by sales (`/subscribe/…`). Do not break them: they use the same code rules.
> - The "How did you hear about us" answers and the Signups page.
> - Follow-up emails to people who left signup.
> - Promo codes a rental company gives its renters.
> - Retention offers, creator rewards and tenure rewards themselves.
> - Changing the default tiers or the default new-company discount. You check them; Ghulam sets them.

## 14. Where to look

| What | Where |
|---|---|
| The rules, pure | `supabase/functions/_shared/platform-promo-rules.ts` |
| Stripe and database work | `supabase/functions/_shared/platform-promo.ts` |
| Functions | `promo-code-lookup`, `admin-promo-codes`, `referral-engine`, `tenant-referrals`, `signup-payment-intent-v2`, `change-subscription-plan-v2` |
| Existing checks | `supabase/functions/_tests/referrals/` |
| Black Friday | `apps/web/src/lib/black-friday.ts`, `components/sections/black-friday-banner.tsx` |
| Prices and messages in the browser | `apps/web/src/lib/promo-offer.ts`, `components/pricing/` |
| Referral link | `apps/web/src/app/r/[code]/route.ts`, `lib/referral-cookie.ts`, `components/sections/referral-banner.tsx` |
| Card step and leave offer | `apps/web/src/components/onboarding/steps/payment-step.tsx`, `onboarding-provider.tsx`, `exit-offer.ts` |
| Super admin | `apps/admin/app/admin/(protected)/promo-codes/`, `apps/admin/components/admin/promo-codes/` |
| Portal | `apps/portal/src/components/referrals/`, `hooks/use-referrals.ts` |
| Tables | `platform_promo_codes`, `platform_promo_code_stripe`, `promo_code_redemptions`, `referrals`, `referral_tiers`, `referral_tier_state`, `referral_program_settings`, `tenant_referral_settings`, `referral_claims`, `referral_savings`, `referral_events` |
| Migration | `supabase/migrations/20260922120000_platform_promo_codes.sql` |
