# Example QA report

For the made-up "Birthday discount for renters" used in the other skills' examples. The feature
does not exist. It shows the shape, how exact an item should be, and what a ticked and a failed
item look like. Only some of its items are shown.

---

# QA report · feat-000 · Birthday discount for renters

**Checked by:** Sam · **Status:** 4 of 7 checked, 1 failed · **Evals:** 21/21 proved (`evals/RESULTS.md`)

| Part | Where | Checked |
|---|---|---|
| 1. Full check | https://northwind.portal.sam.drive-247.com and https://northwind.sam.drive-247.com | 4 of 5, 1 failed |
| 2. Staging look | https://northwind.staging.drive-247.com | 0 of 1 |
| 3. Production check | northwind, live | 0 of 1 |

## Part 1 · Full check

### 1. An operator turns the birthday discount on

- **Why by hand:** PRD story 1; spec 01.3, a screen.
- **Do:**
  1. Log in to the portal as the northwind head admin (`STAGING_LOGIN_EMAIL`).
  2. Open Settings, then Pricing.
  3. Switch "Birthday discount" on and save.
  4. Reload the page.
- **You should see:** The switch still on after the reload, and the line "Renters get 10% off a rental that starts in the week of their birthday."
- **How to be sure:** Log out and back in. It is still on.
- [x] Checked · Sam · 12 Jan 2027 · on https://northwind.portal.sam.drive-247.com
- **They said:** "Turned it on, saved, reloaded, logged out and in. Still on, the sentence is there."

### 2. A renter books in their birthday week and sees the lower price

- **Why by hand:** PRD story 3; spec 04.1 to 04.3, a screen.
- **Do:**
  1. In the portal, open the customer "Dana Whitfield" and set her date of birth to a date 2 days from today.
  2. On the booking site, log in as Dana and book the Toyota Corolla for 3 days starting tomorrow.
  3. Stop at the price step.
- **You should see:** Rental $300.00 crossed out, "Birthday discount −$30.00", rental $270.00. Extras and insurance unchanged.
- **How to be sure:** The total at the bottom is exactly $30.00 lower than the same booking started 10 days later.
- [x] Checked · Sam · 12 Jan 2027 · on https://northwind.sam.drive-247.com
- **They said:** "Shows 300 crossed out, minus 30, 270. Did the same dates plus ten days, total was 30 more."

### 3. The money math, by hand (spec 02, Worked examples)

- **Why by hand:** Money math. The evals run every row; a person checks the screen and the bill agree.
- **Do:** For rows **2**, **3** and **6** of the table in `specs/02-eligibility.md`:
  1. Work out the discount on a calculator from the rental price. Write it down.
  2. Make that booking as Dana (change the car or the days to reach the rental price; for row 6 add promo code `SPRING15`).
  3. Read the discount on the price step. Write it down.
  4. Pay with the test card `4242 4242 4242 4242`, open the payment in Stripe's test dashboard, and read the amount charged for the rental. Write it down.
- **You should see:** Row 2: $15.00 off $149.99. Row 3: $0.01 off $0.05. Row 6: no birthday discount, $45.00 promo kept. Your number, the screen and Stripe agree on all three.
- **How to be sure:** Three rows, three numbers each, nine numbers that match in threes.
- [ ] **Failed** · Sam · 12 Jan 2027
- **They said:** "Row 2 and 6 fine. Row 3: I got 1 cent, the screen says $0.01, but Stripe charged $0.05, the full amount."
- [x] Checked · Sam · 13 Jan 2027 · on https://northwind.sam.drive-247.com
- **They said:** "After the fix: row 3 again, calculator 0.01, screen 0.01, Stripe charged 0.04. Redid rows 2 and 6 too, all match."

### 4. The birthday email, as received

- **Why by hand:** Not covered by an eval: the eval checks the email is queued with the right renter, not what arrives or whether its link works.
- **Do:**
  1. Set Dana's email to your own address and her date of birth to 7 days from today.
  2. Run the daily job from the admin site (Internal, Jobs, "Birthday emails", Run now).
  3. Open the email on your phone.
- **You should see:** Subject "It's nearly your birthday". Her first name, the operator's name and logo, "10% off a rental that week". The button opens northwind's booking site.
- **How to be sure:** Tap the button on the phone. It opens the booking site, not an error page.
- [x] Checked · Sam · 12 Jan 2027 · on a phone, Gmail app
- **They said:** "Got it within a minute. Name, logo and wording right. Button opens the booking site."

### 5. A renter with another discount gets the larger one, on a phone

- **Why by hand:** PRD story 6; spec 04.5, layout on a small screen.
- **Do:** On a phone, book as Dana in her birthday week with promo code `SPRING15`. Stop at the price step.
- **You should see:** Only "Promo SPRING15 −$45.00". No birthday line. Nothing runs off the screen.
- **How to be sure:** Remove the promo code: the birthday line appears with −$30.00.
- [ ] Checked

## Part 2 · Staging look

### 6. It is on the staging site

- **Why by hand:** After the merge, to catch a build or settings problem.
- **Do:** Open the portal on staging, Settings, Pricing.
- **You should see:** The "Birthday discount" switch.
- [ ] Checked

## Part 3 · Production check

### 7. One real booking on northwind, live

- **Why by hand:** Production has real Stripe and real settings; staging cannot prove them.
- **Do:**
  1. On the live portal, as northwind, turn "Birthday discount" on.
  2. On northwind's live booking site, book the cheapest car for 1 day as the test renter whose birthday is this week, and pay with a real card.
  3. Open the payment in Stripe's live dashboard.
  4. Refund it in full from Stripe.
- **You should see:** The rental charged at 10% less than its listed price, to the cent.
- **How to be sure:** The amount in Stripe equals the price step's total.
- [ ] Checked
- [ ] Refunded
