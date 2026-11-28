# Drive247 PRD

What every feature of Drive247 does, in plain language. One section per feature.

This file is the source for `PRD.pdf`. It is edited only through the `prd` skill, and the PDF is
rebuilt from it with `node scripts/build-prd.mjs`. How a feature is built is in its specs, in the
feature's folder.

## Features

| No. | Feature | Status | In one line |
|---|---|---|---|
| 003 | Driver verification, part 1 | Being built | Staff press Verify on a customer, the customer checks their licence and face on their phone, and premium record checks go on the next bill. |

## feat-003 · Driver verification, part 1

**Status:** Being built · **Built by:** Haris · **Folder:** `feat-003-driver-verification`

### In one line

Staff at a rental company press Verify on a customer, the customer checks their licence and face on their own phone, and the company gets one clear result, with optional paid record checks added to its next Drive247 bill.

### Why we have it

Today the ID check is part of adding a customer, and about one in three people who start it never finish (189 of 537 in the 90 days to 27 Nov 2026). It also does not catch a fake licence, a photo held up to the camera, a renter who is too young, a learner's permit, or a licence that runs out during the rental.

Ghulam decided on 28 Nov 2026 to rebuild it as its own module: a free standard check for every company, done by Drive247 with Didit, and premium record checks done by RentID that a company can add and pay for. Drive247 holds one account with each provider and every company uses it, so a company has nothing to set up. We expect more people to finish the check, fewer bad renters to get a car, and a small new income from the premium checks.

This is part 1. It covers the portal's Customers tab, the customer's phone, the result, the bill, and a warning when a rental is created. The later parts are listed under "What it does not do".

### Who it is for

- **Staff at a rental company**: they add customers and decide what to check before handing over a car.
- **A renter**: the person being checked, on their own phone.
- **The rental company's owner**: pays for premium checks on the monthly Drive247 bill.
- **Our team**: pays Didit and RentID, and wants to see what each company costs and brings in.

### What happens

1. **Staff add a customer.** The add-customer dialog asks for the name, email, phone, status, whether they drive for Uber or Lyft, and an emergency contact. It no longer asks for the date of birth or anything printed on the licence, and it no longer ends with an ID check. The customer is saved as **Not verified**. Nothing else happens.

2. **Staff type the licence details by hand.** A company that does not use the check can still type the date of birth and licence details on the customer's page. They are shown as **Typed, not verified**.

3. **Staff press Verify.** The button is on the customer's row in the list and on the customer's page. Both open the same dialog. The first screen is a short table of checks, one line each, with what it does and its price:
   - the **standard check**, free, always ticked and cannot be unticked;
   - **licence active with the state**, premium, ticked as the company had it last time (only the standard check is ticked the very first time);
   - **driving record** and **criminal record**, premium, shown greyed until our team switches them on;
   - **licence watch during the rental** and **rideshare driver proof**, greyed and marked "Coming soon".

   Under the table it says premium checks are added to the next subscription bill, and the company is only charged for a check the customer finishes. Above the button it shows the total for this customer, for example "For Marcus: $3.49". If a state fee may apply and the state is not known yet, it says "from $3.49" rather than an amount that may be wrong.

4. **Staff choose how the customer gets the link.** Email it (the address is shown and can be corrected first), text it (only if the company can send texts), show a code to scan when the customer is at the desk, or copy it. All four are the same link. A customer with no email and no phone gets only the code and the copy options.

5. **Staff watch it happen.** The dialog's last screen lists what has happened so far, each with a time: link emailed, link opened, agreed, check started, result. Staff can send the link again, cancel the check, or close the dialog. The customer's row and page show the same progress. Pressing Verify again on that customer goes straight back to this screen.

6. **The renter verifies on their phone.** They open the link. They see the rental company's name and logo, what will be checked, and they agree. They photograph the front and back of their licence and take a short selfie. They see "Thank you, you are done". If premium record checks were ticked, they see one more agreement for each before anything starts, and they can say no to any of them.

7. **The renter opens the link on a laptop.** The page shows the link as a code to scan and says to open it on a phone.

8. **The renter stops half way.** Opening the same link again, within 24 hours, carries on where they stopped.

9. **Nobody finishes within 24 hours.** The link ends and says "This link has ended. Ask the company for a new one." The customer shows **Expired**, with a Verify button to start again.

10. **Staff start a new check while one is still open.** The old one ends. Its link says it was replaced and to use the newest link.

11. **The standard check passes.** The customer shows **Verified**. The result has one line per check: real licence, live person, face match, details saved, not expired, old enough, name matches, right type of licence, not blocked and not a repeat, and the kind of document (for a passport or a foreign licence). The details read from the licence are saved on the customer and marked as verified, replacing anything typed by hand.

12. **The standard check fails.** The customer shows **Failed**, and the line that failed says why in plain words. For example: "Under your minimum age of 21", "This is a learner's permit", "The selfie is not the person on the licence", or "On your blocked list". A customer on the blocked list is marked blocked, as today. A check that could not be made (a field could not be read) says "Could not check", never Pass.

13. **Didit asks for a person to look.** The customer shows **Needs a look**, with the line that was unsure. Staff decide what to do: verify again, or go ahead where their settings allow.

14. **Premium checks run.** They start by themselves, only after the standard check passes. Each comes back with its own line, for example "Licence active: valid" or "Driving record: 1 DUI in 2024". If the standard check fails, the premium checks never run and nothing is charged.

15. **A premium check comes back bad.** For example, the licence is suspended. The customer stays Verified, with a red warning and the reason on their row and page. When a rental is created for them, the same warning shows there.

16. **A premium check cannot run.** The state is not covered yet, RentID is down, Drive247's balance with RentID is empty, or the renter said no to that check. The line says so in plain words, and the company is not charged. Staff can run a premium check again later without a new standard check.

17. **The company is billed.** Each finished premium check is added to the company's next Drive247 subscription bill. The Billing tab shows them as part of the next bill, by check, with a count and an amount, and a line "Standard check, 12 checks, Free". A list shows each check of the month: the customer, the check, the day, and the amount, the free ones marked Free. A paid bill's receipt shows the same lines.

18. **Staff create a rental for a customer who is not verified.** The rental screen says so and offers Verify right there. Whether the rental may go ahead without it is still decided by the company's existing setting. Where it may, a customer with only typed details can rent, and the rental shows "Not verified". If the customer is verified but their licence runs out before the return date, the rental screen says so. The same is checked again when a rental is extended, with no new check and no new charge.

19. **A viewer opens a customer.** They see the status and the result, but no Verify button.

20. **Someone in ops presses Verify.** They can send the standard check. The premium checks are greyed for them.

21. **A company with no active or trial subscription presses Verify.** The standard check works as usual. The premium checks are greyed with "Subscribe to use premium checks".

### The rules

- **Statuses**, the same everywhere in the portal: Not verified, Link sent, In progress, Verified, Needs a look, Failed, Expired. A customer's status is the status of their latest check.
- **Verified** needs these to pass: real licence, live person, face match, not expired, old enough, name matches, right type of licence, not blocked and not a repeat.
- **Old enough** uses the company's own minimum rental age. If the company has not set one, that line says "Not set" and where to set it.
- **Not expired** is checked against today when the renter verifies, and against the return date when a rental is created or extended.
- **A link lasts 24 hours.** It stops working once it is finished, replaced or cancelled. One open check per customer at a time.
- **At most 10 checks per customer per hour**, and a limit on reminders, so a renter cannot be flooded.
- **The standard check is free** for every company. Drive247 pays Didit about $0.33 for it.
- **A premium check costs the company what it costs Drive247, plus $0.50.** What it costs Drive247 is RentID's charge plus any state fee RentID passes on. The $0.50 is per premium check, not per customer.
- **Prices today:** licence active with the state $3.49, plus the state's record fee where that state charges one, if RentID confirms one credit for it. The driving record and criminal record get their prices from RentID before they are switched on; RentID bills the criminal record at a separate rate, not in credits.
- **A premium check is charged only when RentID returns a result**, whatever the result says. A suspended licence is still a finished check. Not charged: the link was never opened, the renter stopped, the check expired or was cancelled, the standard check failed, the renter said no, RentID failed or does not cover the state.
- **The price is fixed when the check is sent.** A price change afterwards does not change it.
- **A check is charged once**, however many times anything is retried.
- **Verifying the same customer twice is charged twice.** The first screen shows "Verified on 2 Dec" so staff see it before paying again.
- **Same person, two companies:** being checked at one Drive247 company is never flagged as a repeat at another.
- **Only Drive247's own team** changes the price list.
- **Northwind first.** Part 1 is switched on for the Northwind company on the new portal only, until Ghulam says otherwise.
- **Needs a look.** When Didit says a person should look at a check, the customer shows **Needs a look**, not Verified or Failed.
- **A bad premium result does not undo Verified.** The customer stays Verified with a red warning and the reason (for example "Licence suspended"). The same warning shows when a rental is created for them.
- **Premium checks need an active or trial subscription.** Without one they are greyed with "Subscribe to use premium checks".
- **Licence active with the state goes live first.** The driving record and criminal record are built behind a switch that our team turns on later, once a lawyer has approved their consent words and the refusal process.
- **Who may tick premium checks:** head admins, admins, and managers with edit access to Customers. Ops and viewers can send the standard check only.
- **Licence photos and the selfie** are kept in private storage while the customer exists, and removed when the customer is deleted. A lawyer confirms the period before real customers use it.
- **Typed details only.** Where the company's settings already allow a rental without verification, a rental may go ahead on details typed by hand. The rental shows "Not verified".

### What it does not do

- It does not change the ID check on the booking site, the invite registration, a customer's own portal, or secondary drivers. They keep today's check.
- It does not change any company other than Northwind in part 1.
- It does not ask a company to sign up with Didit or RentID, connect an account or enter a key. Ever.
- It does not run the driving record or criminal record for real customers until our team switches them on.
- It does not refund a premium check. If one is wrong, our team fixes it in Stripe.
- It does not change the renter's own car insurance check (Modives).
- It does not watch the licence during a rental, prove rideshare driving, open the lockbox only for the verified face, build a dispute or police pack, set the deposit by risk, use the licence in a phone wallet, or share a verified renter between companies. These are later parts.
- It does not show the renter their licence number or photos back on any page.

### How we know it is working

- The share of customers who finish the check, against today's one in three who never finish. Recorded on staging before and after.
- On the Billing tab, each finished premium check is a line on the next bill, and the amount matches the Stripe invoice to the cent.
- Our team can see, for each company and each month, what Didit and RentID cost us and what the company paid.
- No customer stays on "In progress" after their check has finished.
