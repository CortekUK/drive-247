-- =============================================================================
-- Welcome Pack — initial content
--
-- Every capability the platform ships, grouped into chapters, plus the FAQ set
-- (weighted toward the Bonzah onboarding form, which generates most inbound
-- support questions).
--
-- Every INSERT is ON CONFLICT DO NOTHING against a natural key, so re-running
-- this migration NEVER overwrites content a super admin has since edited in
-- the admin panel. To reset a page deliberately, delete the row and re-run.
--
-- NOTE ON THE BONZAH FAQs: these explain WHY a question is asked and that
-- accuracy matters. They deliberately never suggest HOW to answer. Copy that
-- coaches an operator toward a favourable answer would be advising
-- misrepresentation to an insurer.
-- =============================================================================

INSERT INTO public.welcome_pack_groups (key, title, description, icon, sort_order) VALUES
  ('start',     'Start here',               'What this platform is and what to do first',            'Compass',    10),
  ('website',   'Your booking website',     'The site your customers actually book on',              'Globe',      20),
  ('fleet',     'Your fleet',               'Vehicles, pricing and availability',                    'Car',        30),
  ('bookings',  'Bookings & rentals',       'From enquiry to signed agreement to keys back',         'FileText',   40),
  ('customers', 'Customers',                'Accounts, verification, messaging and trust',           'Users',      50),
  ('money',     'Money',                    'Payments, deposits, invoices and everything financial', 'CreditCard', 60),
  ('insurance', 'Insurance & Bonzah',       'Offering protection on every rental',                   'Shield',     70),
  ('comms',     'Messaging & notifications','Email, SMS, WhatsApp and automatic reminders',          'Bell',       80),
  ('team',      'Your team',                'Staff accounts, roles and what each one can see',       'Lock',       90),
  ('account',   'Your account',             'Subscription, going live, and getting help',            'Crown',     100),
  ('insights',  'Reports & insights',       'Knowing how the business is actually doing',            'BarChart3', 110),
  ('community', 'Community & referrals',    'You are part of something bigger than your fleet',      'Heart',     120)
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- START HERE
-- -----------------------------------------------------------------------------
INSERT INTO public.welcome_pack_sections (group_id, slug, title, summary, icon, required_flag, sort_order, body_md) VALUES
((SELECT id FROM public.welcome_pack_groups WHERE key='start'),
 'what-this-is', 'What this platform actually is',
 'Three connected products, one business', 'Compass', NULL, 10,
$md$
This is not one website. It is three connected products, and knowing which is which will save you a lot of confusion in your first week.

### 1. Your booking website

The public site your customers see. Your logo, your colors, your fleet, your prices, your terms. Customers browse cars, pick dates, pay, verify their identity and sign the rental agreement here.

You never edit this site by writing code. Everything on it is controlled from the portal.

### 2. The portal

Where you are right now. Your office: every booking, customer, payment, invoice, vehicle and message passes through here. Your staff log in here, each with their own account and their own level of access.

Everything in this document is about the portal unless it says otherwise.

### 3. The platform underneath

Behind both, we run the payments infrastructure, the insurance integration, the contract signing, the messaging and the servers. When something breaks at that level, that is us, not you.

---

> Your booking website is the shopfront. The portal is the back office. We are the building, the electricity and the plumbing.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='start'),
 'your-first-week', 'Your first week, in order',
 'The short list, sequenced so each step unlocks the next', 'ListChecks', NULL, 20,
$md$
### Day one — make it yours

1. **Business details.** Settings → General. Name, address, contact email, phone, hours. This appears on your website, your invoices and your rental agreements, so get it right once.
2. **Logo and colors.** Settings → Branding. Your site and your customer emails pick these up immediately.
3. **Locations.** Settings → Locations. Where customers collect and return.

### Day two — put cars on the site

4. **Add your vehicles.** Photos, specification, daily/weekly/monthly rates.
5. **Booking rules.** Settings → Requirements and Duration. Minimum age, license period, rental length, how far ahead people can book.

### Day three — get paid

6. **Connect Stripe.** Until this is done you cannot take a single payment. This is the step that most often stalls, so start it early.
7. **Decide your deposit.** Settings → Pre-Authorization.

### Day four — protect yourself

8. **Complete the Bonzah insurance form.** It is long and it asks direct questions. Read *The Bonzah onboarding form* before you start.
9. **Watch the training and pass the short quiz.** Built into the same form.

### Day five — the paperwork

10. **Rental agreement.** Settings → E-Signatures, plus your terms in Settings → Templates.
11. **Reminders.** Settings → Notifications.

### Before you go live

12. **Take a test booking yourself, end to end.** Book a car on your own website in test mode, pay with a test card, sign the agreement, watch it land in the portal. Nothing builds confidence like seeing it work.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='start'),
 'how-a-booking-works', 'How a booking actually works',
 'The whole journey, from a customer landing on your site to keys back', 'Route', NULL, 30,
$md$
The single most useful thing to understand. Everything else hangs off this sequence.

1. **The customer books** — chooses a vehicle and dates, sees a price built from your rates, any weekend or holiday surcharge, your fees and tax, and any extras.
2. **They pay** — in full, as a first installment, or they submit for your approval. A deposit is *held* on their card separately — held, not taken.
3. **They prove who they are** — license upload and an identity check. You see the result before handing over anything.
4. **They buy protection** — if you offer Bonzah, coverage options appear during checkout.
5. **They sign** — the agreement is generated with their details, your terms and any insurance addendum, then sent for electronic signature.
6. **They collect** — in person, or by lockbox, in which case the access code is sent automatically at the right time.
7. **The rental runs** — extend it, add charges, message the customer, record fines or damage.
8. **They return** — complete the rental, release or capture the deposit, raise final charges, rate the customer for your own future reference.

Every stage has its own page here. If you remember one thing: **the Rentals page shows exactly which stage every live rental is at.**
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='start'),
 'test-and-live', 'Test mode and going live',
 'Rehearse with fake money first — nothing in test mode is real', 'FlaskConical', NULL, 40,
$md$
You start in **test mode**. This is deliberate and it is the safest thing about your first week.

- Payments use test card numbers. No real money moves, ever.
- Insurance quotes are simulated.
- Signed agreements are watermarked and deleted automatically after 14 days.
- Everything else behaves exactly as it will in production.

Use it. Book a car on your own site with `4242 4242 4242 4242`, any future expiry, any three-digit code. Do it twice.

### Going live

Not one switch — a small set of genuine readiness checks: Stripe connected and approved, Bonzah active if you are offering insurance, subscription active. Your dashboard shows progress during setup.

### After you go live

**Test data does not disappear by itself.** Clear out test bookings and customers before you trade, so your reports start clean. Ask us if you would like a hand.

> Never take a real booking while still in test mode. The customer sees a successful payment. No money arrives.
$md$)
ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- WEBSITE
-- -----------------------------------------------------------------------------
INSERT INTO public.welcome_pack_sections (group_id, slug, title, summary, icon, required_flag, sort_order, body_md) VALUES
((SELECT id FROM public.welcome_pack_groups WHERE key='website'),
 'your-booking-site', 'Your booking site',
 'What customers see, and where each piece is controlled from', 'Globe', NULL, 10,
$md$
Your booking site is generated from your settings. There is no separate website to maintain.

**On it:** home page, fleet, the booking flow, About / Contact / FAQ / Terms / Privacy, and a customer portal where your customers see their bookings, documents, invoices and messages.

| To change | Go to |
|---|---|
| Logo, colors | Settings → Branding |
| Page text, images | Website Content |
| Which cars appear | Fleet → Vehicles |
| Prices | On each vehicle |
| Customer FAQs | Website Content → FAQs |
| Terms, privacy | Settings → Templates |
| Contact details, hours | Settings → General |

You get a platform web address immediately. To use your own domain instead, tell us — usually a day, most of it waiting for the internet to catch up.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='website'),
 'branding', 'Branding',
 'Making it look like your business', 'Palette', NULL, 20,
$md$
Settings → Branding controls how your business looks everywhere a customer sees it: your site, every customer email, your invoices, your rental agreements and the signing experience.

- **Logo** — upload the highest quality version you have; it is resized automatically.
- **Primary color** — take it from your existing brand rather than inventing one.
- **Light and dark variants** — your site adapts to whichever the customer prefers. Set both.
- **Hero imagery** — the large picture on your home page.

**Do this before you send your site to anyone.** Email clients cache images aggressively, so a logo swapped after your first mailout can linger for weeks in some inboxes.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='website'),
 'website-content', 'Editing your website text',
 'Every word on your public site, without a developer', 'PenLine', NULL, 30,
$md$
**Website Content** controls the words and pictures on your public site: home page, About, Contact, your renter-facing FAQ section, testimonials, and the meta titles and descriptions that appear in search results.

### Writing that works

- **Answer the question in the first sentence.** People scan; they do not read.
- **Be specific about your rules.** Deposit, minimum age, mileage, fuel policy. Every rule stated clearly is an argument you never have at the counter.
- **Put your phone number where people can see it.** A visible number measurably increases bookings even when nobody calls it.

### The FAQ section earns its keep

The questions customers ask you repeatedly on the phone are exactly the ones costing you bookings from people who did not bother to call. Write them down as they come in. Ten good FAQs beats a redesign.

> Note: that FAQ section is *your* answers for *your renters*. The document you are reading now is our document for you. Different audiences.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='website'),
 'testimonials', 'Testimonials',
 'Showing that other people trusted you first', 'Quote', NULL, 40,
$md$
Publish customer quotes on your booking site. Add the quote, a first name, and a photo if you have one. Reorder them — the first two or three are the ones anyone reads. Unpublish rather than delete so you can rotate seasonally.

The best moment to ask is when the customer returns the vehicle and it went well. Ask in person, then follow up the same day while the goodwill is fresh.

This is separate from the internal customer ratings you leave after a rental — those are private notes for your team and never appear publicly.
$md$)
ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- FLEET
-- -----------------------------------------------------------------------------
INSERT INTO public.welcome_pack_sections (group_id, slug, title, summary, icon, required_flag, sort_order, body_md) VALUES
((SELECT id FROM public.welcome_pack_groups WHERE key='fleet'),
 'adding-vehicles', 'Adding vehicles',
 'What to fill in, and which fields actually affect bookings', 'Car', NULL, 10,
$md$
**Essentials:** make, model, year, registration (these appear on the agreement and your fleet page); category, which customers filter by; transmission, fuel, seats, doors, luggage; and photos, the single biggest influence on whether a car gets booked.

**Prices.** Each vehicle carries its own daily, weekly and monthly rate. You also control **which durations it can be booked for at all** — a car you only want on long lets can have daily bookings switched off, and it simply will not appear in short searches.

### Photos, properly

Six to ten per car. Front three-quarter view first — that is the one that sells. Include interior, dashboard and boot. Daylight, clean car, plain background. Use the same angles across the fleet so your page looks deliberate.

**Availability.** Take a vehicle off the market without deleting it — deleting takes its rental history with it.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='fleet'),
 'pricing', 'Pricing',
 'Rates, surcharges and per-vehicle overrides', 'TrendingUp', NULL, 20,
$md$
### Base rates

Daily, weekly and monthly per vehicle. The best tier for the length of booking is applied automatically, so a nine-day rental prices as a week plus two days, not nine days.

### Weekend surcharges

Settings → Pricing Rules adds a percentage for weekend days on short rentals, and you choose which days count as your weekend. Surcharges apply to daily-tier bookings only — a monthly rental does not take an uplift for every weekend it spans.

### Holiday pricing

Add holiday periods with their own surcharge: a name, a date range, a percentage. Mark one as recurring annually and it repeats without you touching it again.

### Per-vehicle overrides

Any vehicle can deviate from a weekend or holiday rule — **excluded**, a **fixed price** for the period, or a **custom percentage**. This is how you charge a premium on your two best cars at Christmas without touching the rest of the fleet.

### Minimum rental length

Settings → Duration. Expressed in days, hours, or both — a four-hour minimum is possible.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='fleet'),
 'availability', 'Availability and blocked dates',
 'Stopping the system selling a car you cannot supply', 'CalendarDays', NULL, 30,
$md$
The Availability page is your fleet calendar. Every confirmed rental blocks its vehicle automatically — you never do that yourself.

**Block manually for:** servicing and MOT, repairs, personal or staff use, a car being sold, and buffer time between rentals for cleaning and inspection.

**Buffer time is worth thinking about.** If you need two hours between a return and the next collection, block it. A back-to-back booking with no time to clean and check is how a small delay becomes an angry customer and a refund.

The calendar view shows every vehicle across a date range at once — the fastest way to spot the car that has sat idle for three weeks, and the one you keep turning bookings away for.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='fleet'),
 'plates', 'Plates',
 'Managing registration plates as their own records', 'Hash', NULL, 40,
$md$
Tracks registration plates separately from vehicles. This matters if you move plates between cars, run personalized plates, or operate where plates are assets with their own renewal dates and costs.

If you simply have one fixed plate per car, you can ignore this page — the registration on the vehicle record is enough.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='fleet'),
 'vehicle-owners', 'Vehicle owners',
 'Running cars that belong to other people', 'Users', 'vehicle_owners_enabled', 50,
$md$
If some cars in your fleet belong to other people, this tracks who owns what and what they are owed.

1. Add the owner with contact and payment details.
2. Link their vehicles.
3. Set the commission split.
4. Every completed rental on their car accrues automatically.

Owners do not get portal access — you send them statements. That keeps your customer data and your other owners' figures private.

**Agree six things in writing before the first rental:** who pays for fuel, cleaning, damage below the excess, fines, servicing, and idle time. Almost every dispute with a vehicle owner comes from one of those, and almost all are avoidable with one conversation.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='fleet'),
 'owner-payouts', 'Owner payouts',
 'Paying vehicle owners what they are owed', 'Banknote', 'vehicle_owners_enabled', 60,
$md$
Turns accrued earnings into actual payments. Rentals complete and accrue; at the end of your payout period you review each owner's statement, deduct anything agreed, and record the payout.

**Record it here even when you pay by bank transfer outside the system.** An owner asking "what did I earn in March?" eighteen months from now is a question you want answered in ten seconds, not by searching bank statements.
$md$)
ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- BOOKINGS
-- -----------------------------------------------------------------------------
INSERT INTO public.welcome_pack_sections (group_id, slug, title, summary, icon, required_flag, sort_order, body_md) VALUES
((SELECT id FROM public.welcome_pack_groups WHERE key='bookings'),
 'rental-lifecycle', 'The rental lifecycle',
 'Every state a rental moves through, and what you do at each', 'FileText', NULL, 10,
$md$
The Rentals page is the heart of the portal.

| State | Means | You do |
|---|---|---|
| **Pending** | Awaiting your approval | Approve or decline |
| **Confirmed** | Paid, not started | Check documents, prepare the vehicle |
| **Active** | Customer has the vehicle | Extend, message, add charges |
| **Completed** | Returned | Release deposit, raise final charges, rate |
| **Cancelled** | Called off | Refund per your policy |

**On a live rental you can:** extend dates and take the extra payment, swap the vehicle, add charges (fuel, cleaning, mileage, late return), message the customer, record damage, log a fine, and release or capture the deposit.

### The one habit worth building

Photograph the vehicle at handover and at return, every single time. Not "when the customer seems dodgy" — every time. Ninety seconds, and it is the difference between a damage claim you win and one you eat.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='bookings'),
 'approving-bookings', 'Approving bookings',
 'Automatic or manual, and how to choose', 'Clock', NULL, 20,
$md$
**Automatic** — the customer books, pays, and it is confirmed immediately. Faster, converts better, suits a standard fleet with clear rules.

**Manual approval** — every booking arrives Pending and waits for you. Slower, but you check the customer, vehicle and dates before committing. Suits high-value vehicles and new operators still calibrating. A Pending Bookings entry appears in your sidebar with a count so nothing sits unnoticed.

**If you choose manual, answer within an hour during business hours.** A customer who books at 9am and hears nothing by lunchtime has already booked elsewhere. If you cannot commit to that, automatic with clear rules will earn you more.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='bookings'),
 'quotes-enquiries', 'Quotes and enquiries',
 'Business that is not yet a booking', 'Inbox', NULL, 30,
$md$
**Enquiries** from your website contact form land in the portal with a count in your sidebar. Reply from inside the portal so the whole conversation stays attached to the customer record.

**Fleet quotes** are for business that does not fit the standard flow — a corporate account wanting six cars for three months, a film production, a long-term lease. Build the quote, send it, convert it to a real booking when accepted.

**Put an expiry date on every quote.** Prices move and availability moves. A quote sent in March being accepted in July at March's prices is a loss you agreed to in writing.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='bookings'),
 'leads-automations', 'Leads and automations',
 'Working prospects through a pipeline, automatically', 'Workflow', 'lead_management_enabled', 40,
$md$
**Leads** replaces simple enquiries with a proper pipeline: every prospect has a stage, an owner on your team, a value and a history.

**Automations** do the follow-up you would otherwise forget — a lead untouched for three days gets a nudge, an unanswered quote gets a reminder after a week, a completed rental triggers a review request, a customer who has not booked in six months gets an offer. Each is a trigger, a wait and an action.

**Build one, not eleven.** Start with the follow-up you most often forget, watch it for two weeks, then build the next. Automations that fire at the wrong moment do more damage than no automation at all.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='bookings'),
 'agreements-esign', 'Rental agreements and signing',
 'The contract, generated and signed electronically', 'FileSignature', NULL, 50,
$md$
Every rental produces a legally binding agreement carrying your terms, the customer's details and license information, the vehicle, dates and prices, any insurance addendum, and your mileage, fuel, deposit and damage policies.

1. Generated when the booking is confirmed.
2. Sent by email, and by WhatsApp if you use it.
3. Signed on their phone — no printing, no app, no account.
4. You are notified, and the signed copy is stored against the rental permanently.

Signing has a test mode like payments; test agreements are watermarked and auto-deleted after 14 days. Switch to live in Settings → E-Signatures — the portal asks you to confirm, because it is not something to do by accident.

**An unsigned agreement is not a contract.** If a customer will not sign, do not release the vehicle. That sounds obvious until it is Friday evening, the customer is in front of you and the link has not arrived — in which case resend, wait, and hold the keys.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='bookings'),
 'lockbox', 'Key handover and lockbox',
 'Handing over a car without being there', 'Lock', 'lockbox_enabled', 60,
$md$
Each vehicle carries its own lockbox code and a description of where the box is. Mark a rental as lockbox delivery and the code and instructions are sent automatically at the right time, by email, SMS or WhatsApp.

### Before you rely on it

- **Verify identity and signature first.** The code should only reach a customer whose documents are verified and whose agreement is signed. That is the whole risk of unattended handover in one sentence.
- **Change codes regularly.** A code given to twenty past customers is not a security measure.
- **Write instructions for a stranger, in the dark, in the rain.** Assume no local knowledge.
- **Have a number a person answers.** Every unattended collection eventually goes wrong at 11pm.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='bookings'),
 'extensions-returns', 'Extensions and returns',
 'The rental that runs long, and closing one out properly', 'CalendarPlus', NULL, 70,
$md$
### Extensions

A customer wanting to keep a vehicle longer is good news. Extend the dates from the rental record and take the additional payment. Check the calendar that the car is not already promised to someone else.

### Returns

1. **Inspect and photograph**, comparing against your handover photos.
2. **Check fuel and mileage** against your policy.
3. **Raise final charges** — fuel, cleaning, excess mileage, late return.
4. **Release the deposit**, or capture what you are owed.
5. **Complete the rental.**
6. **Rate the customer** for your own future reference.

**Release the deposit promptly.** Same day, ideally. It costs you nothing, it is the last thing the customer remembers about you, and slow deposit returns are the single most common complaint in this entire industry.
$md$)
ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- CUSTOMERS
-- -----------------------------------------------------------------------------
INSERT INTO public.welcome_pack_sections (group_id, slug, title, summary, icon, required_flag, sort_order, body_md) VALUES
((SELECT id FROM public.welcome_pack_groups WHERE key='customers'),
 'customer-accounts', 'Customer accounts',
 'What you hold on each customer, and what they see', 'Users', NULL, 10,
$md$
Every person who books gets a customer record and their own login to your customer portal.

**You see:** contact details and address, license and identity documents, verification status, every booking past and present, every payment and invoice, your whole message history, and your team's private ratings and notes.

**They see:** their own bookings, documents, invoices and messages. Nothing about your business, your other customers, or your notes on them.

**Keep notes.** "Returned it spotless, would rent to again" and "argued about the fuel policy for forty minutes" are both worth writing down. In two years, after four hundred rentals, that one line is the only thing that will remind you.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='customers'),
 'verification', 'Identity verification',
 'Knowing your customer is who they say they are', 'ScanFace', NULL, 20,
$md$
The customer photographs their license and takes a selfie. The system reads the license, checks it is genuine, and compares the face to the photograph on it. You see a clear result in the portal.

### What you still do yourself

- **Look at the license.** Check for anything expired, restricted or endorsed.
- **Check the name matches the payment card.** A license in one name and a card in another is the oldest problem in this business.
- **Trust your instincts.** If something feels wrong, ask more questions. You are allowed to decline.

**When verification fails** it is often innocent — a bad photograph, poor light, a damaged license. Ask them to retry in daylight before assuming the worst. If it fails repeatedly, ask for documents in person.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='customers'),
 'messaging', 'Messaging customers',
 'Keeping every conversation in one place', 'MessageSquare', NULL, 30,
$md$
Live chat with your customers, built into both the portal and their customer portal.

**Why not your phone:** every conversation is attached to the customer and the rental, any member of your team can pick up a thread, you see when they are typing and when they have read, and it does not vanish when someone leaves or changes their phone. Unread messages show as a count on your sidebar.

**Response time is the whole game.** The operators who grow fastest here are, almost without exception, the ones who reply quickest. Not the cheapest, not the ones with the newest cars. The quickest.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='customers'),
 'blocked-customers', 'Blocked customers and the blacklist',
 'Refusing business you do not want', 'Ban', NULL, 40,
$md$
**Your own blocked list.** Block a customer and they cannot book with you again. Record the reason — future you, or a member of staff who was not there, will need to know why. Typical reasons: unpaid damage, a vehicle returned in a state, aggression toward staff, a fraudulent payment, repeated no-shows.

**The platform blacklist** covers the serious cases across all operators — proven fraud, stolen vehicles, identity theft. If someone on it tries to book with you, you are warned.

**Use it fairly.** Block for behavior, never for anything else. Write the reason factually, as if the person will one day read it — because that is the standard the record should meet.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='customers'),
 'rating-customers', 'Rating your customers',
 'Private notes that make the second rental easier than the first', 'Star', NULL, 50,
$md$
After a rental completes you can rate the customer out of ten and leave a comment. **Customers never see this.** It is an internal note for your team.

Worth recording: did they return on time, was it clean, was the fuel right, were they straightforward, would you rent to them again.

Once a customer has a few ratings, a short summary is generated so you get the gist at a glance instead of reading four years of comments.

**Rate everyone, not just the bad ones.** A file where only difficult customers have entries tells you nothing about anybody else. Skipping is there for when there is genuinely nothing to say.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='customers'),
 'gig-drivers', 'Gig drivers',
 'Renting to rideshare and delivery drivers', 'Briefcase', NULL, 60,
$md$
Customers can identify as gig drivers and upload proof — a platform profile, an approval letter, an activity screenshot.

**Why it matters:** they do far higher mileage, they usually want weekly or monthly terms, their insurance requirements differ because commercial use is excluded from most standard policies, and — treated well — they are the most reliable repeat business in this industry.

**Before you accept gig work, check your own fleet insurance actually covers commercial passenger or delivery use.** Many policies specifically exclude it, and after an accident is the worst possible moment to find out. If unsure, ask us and we will help you check.
$md$)
ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- MONEY
-- -----------------------------------------------------------------------------
INSERT INTO public.welcome_pack_sections (group_id, slug, title, summary, icon, required_flag, sort_order, body_md) VALUES
((SELECT id FROM public.welcome_pack_groups WHERE key='money'),
 'how-money-flows', 'How money reaches your bank',
 'Stripe, your account, and why this comes first', 'CreditCard', NULL, 10,
$md$
Payments run through **Stripe**. Your customers pay into **your own** Stripe account, and Stripe pays out to your bank. **We never hold your money.**

### Connecting Stripe

You will need business registration details, bank details, proof of identity for the owners, and your business address. Approval is usually quick but can take days if Stripe asks for more documentation. **This is the step most likely to delay your launch — start it on day one, not the day before you go live.**

### When you get paid

Stripe pays out on a rolling schedule, typically two to seven days after the payment depending on your country and account history. New accounts wait longer at first; this shortens as you build a history.

### Fees

Stripe takes a processing fee per transaction, varying by country and card type. Your subscription with us is billed separately.

**If a payment fails**, it is usually the customer's bank. Ask them to try another card. Failures across many different customers mean something is wrong at your end — tell us straight away.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='money'),
 'test-live-payments', 'Test and live payments',
 'Which mode you are in, and what that changes', 'FlaskConical', NULL, 20,
$md$
**Test mode** — test cards, most commonly `4242 4242 4242 4242` with any future expiry and any three-digit code. No real money moves. Everything else behaves normally.

**Live mode** — real cards, real money, real payouts. Requires your Stripe account fully approved.

**Never take a real booking in test mode.** The customer sees a successful payment and gets a confirmation. No money arrives, and you find out when you look at your bank at the end of the month.

Your current mode is always visible in the portal. Check it before your first real booking, and again after any change to payment settings.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='money'),
 'deposits', 'Security deposits',
 'Holding money without taking it', 'ShieldCheck', NULL, 30,
$md$
A pre-authorization places a hold on the customer's card: reserved, not taken. You capture what you need and release the rest.

Set the amount in Settings → Pre-Authorization — flat, or per vehicle so your luxury cars carry a higher hold.

**How long a hold lasts.** Card holds expire on their own, typically after around seven days — a limit set by the card networks, not by us. For longer rentals the platform can chain holds so coverage continues.

### Where operators get this wrong

- **Not explaining it.** Customers see the hold in their banking app and think you charged them. Say clearly, in writing, at booking: this is a hold, not a charge, and here is when it is released.
- **Setting it too high.** A deposit larger than the rental itself loses you bookings. Match it to realistic risk on that vehicle.
- **Releasing slowly.** Release the day the car comes back.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='money'),
 'installments', 'Installments',
 'Letting customers pay over time', 'Banknote', NULL, 40,
$md$
For longer or higher-value rentals, customers can pay on a schedule instead of all at once. You set how many payments and when; the first is taken at booking and the rest charged automatically to the same card. The schedule and its status show on the rental.

**If one fails** you are notified, the system retries, and the customer is prompted to update their card. Decide your policy in advance: how many failures before you recover the vehicle, and what you tell the customer.

Installments increase conversion on long rentals significantly. They also increase your exposure, because you are extending credit. Use them for monthly rentals and corporate accounts; think harder about weekend hires.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='money'),
 'pay-as-you-go', 'Pay as you go',
 'Charging for usage as the rental runs', 'Timer', NULL, 50,
$md$
Bills the customer periodically through the rental rather than up front. It suits long-term and open-ended rentals where neither side knows the end date at the start — someone whose own car is being repaired, or a driver renting week to week.

Configure the billing period and rate in Settings → Pay As You Go, and the card is charged on schedule.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='money'),
 'promos-extras', 'Promo codes and extras',
 'Discounts that win business, add-ons that raise the average', 'Zap', NULL, 60,
$md$
**Promo codes** carry a percentage or fixed discount, an expiry, a usage limit and optionally a minimum spend. Use them for returning customers, quiet periods, corporate accounts and recovering an unhappy renter. Keep them scarce — a permanent 10% code is not a promotion, it is a lower price with extra steps.

**Extras** are the add-ons customers choose at checkout: additional driver, child seat, satnav, delivery and collection, out-of-hours pickup, extra mileage, full-to-full fuel. Each has its own price, charged per day or per rental.

**Extras are the most underused feature in the portal.** They add margin at nearly zero cost and customers rarely resist them, because by the time they see them they have already decided to book. Delivery, additional drivers and extra mileage consistently earn the most.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='money'),
 'fees-tax', 'Fees and tax',
 'Everything added on top of the rental price', 'Receipt', NULL, 70,
$md$
Settings → Fees & Tax covers your tax rate (applied automatically), booking or service fee, young driver surcharge, additional driver fee, out-of-hours fee, delivery and collection charges, late return fee, cleaning fee, and your fuel charge when a vehicle comes back short.

**Every fee appears in the breakdown the customer sees before they pay. Keep it that way.** Surprise charges produce disputes and chargebacks, and a chargeback costs you far more than the fee ever earned.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='money'),
 'invoices-refunds', 'Invoices and refunds',
 'Paperwork, and money going back the other way', 'FileText', NULL, 80,
$md$
**Invoices** are produced automatically for every payment, carrying your branding, business details and tax number. Customers get theirs by email and can download it any time. You can find, resend and download any invoice.

**Refunds** can be full or partial, from the rental or the payment record. Money returns to the original card and takes five to ten days to appear — that is their bank, not you. You can also schedule a refund for a future date while you assess damage.

**Have a cancellation policy and publish it.** Decide now what a customer gets back if they cancel two weeks out, two days out, two hours out. Write it on your website and into your terms, then apply it consistently — the one time you make an exception is the one that gets screenshotted.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='money'),
 'fines', 'Fines and penalties',
 'Speeding tickets, parking charges and tolls', 'BadgeAlert', NULL, 90,
$md$
The fine arrives addressed to you as registered keeper. Log it against the vehicle and the rental it falls within, identify the driver, and where your local process allows, transfer liability. Then recharge the fine plus your administration fee.

**Move quickly.** Most authorities have short windows for transferring liability. A fine that sits in a drawer for three weeks becomes your fine permanently. Log it the day it arrives.

**State your handling fee in your terms and on your website.** A customer who knew about it in advance pays it; one who discovers it afterwards disputes it.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='money'),
 'expenses-pl', 'Expenses and profit',
 'What the business actually costs to run', 'Wallet', NULL, 100,
$md$
**Expenses** records what you spend: fuel, servicing, repairs, cleaning, insurance, tax, finance, marketing, parking. Attach an expense to a specific vehicle and you learn which cars earn their keep.

**The P&L dashboard** shows revenue minus costs over any period, across the business or per vehicle.

**Revenue per vehicle is interesting. Profit per vehicle tells you what to buy next.** The highest-revenue car is quite often not the most profitable, because it is also the one in the workshop every six weeks. You cannot see that without recording expenses against vehicles — which is why it is worth the five minutes a week.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='money'),
 'credits', 'Credits',
 'Your balance for services that cost money to send', 'CircleDollarSign', NULL, 110,
$md$
Some things cost money each time they happen — text messages, WhatsApp messages, identity verification checks, certain automated notifications. These draw on a **credit balance**, shown in your portal header.

Your balance is always visible, you are warned when it runs low, and you top up from the Credits page.

**Do not let it hit zero.** An empty balance means verification checks stop and text messages do not send — usually noticed when a customer says they never got their lockbox code. Set your warning generously.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='money'),
 'accounting', 'Accounting',
 'Sending your figures to Xero or Zoho', 'Calculator', NULL, 120,
$md$
Settings → Accounting connects the portal to **Xero** or **Zoho Books**, syncing invoices and payments, customer records, and refunds and credit notes. Connect the account, map your accounts and tax rates, and choose automatic or on-demand sync.

**Talk to your accountant first.** Have them tell you which nominal codes to map to before you connect anything. Fixing a thousand miscoded transactions afterwards is a genuinely miserable job, and one you will be doing rather than them.

If the connection expires a banner appears in the portal. Reconnect promptly — while it is broken, nothing is syncing.
$md$)
ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- INSURANCE
-- -----------------------------------------------------------------------------
INSERT INTO public.welcome_pack_sections (group_id, slug, title, summary, icon, required_flag, sort_order, body_md) VALUES
((SELECT id FROM public.welcome_pack_groups WHERE key='insurance'),
 'what-bonzah-is', 'What Bonzah is',
 'Insurance your customers buy at checkout, at no cost to you', 'Shield', NULL, 10,
$md$
**Bonzah** is our insurance partner. Your customers buy protection as part of the booking, on your website, in the same checkout — collision damage, liability, and supplemental protection depending on your market.

**Why it is worth doing:** it costs you nothing, because the customer pays and you take no risk on the policy. It protects your fleet, because a properly insured renter can actually pay for the damage. It converts, because customers who feel covered book with more confidence. And it removes the argument — "do you have insurance?" is answered at checkout rather than at the counter.

**What it is not.** Bonzah is protection for the *rental*, bought by the *customer*. It is not your business insurance. You still need your own fleet policy, your own liability cover, and whatever your jurisdiction requires. Bonzah sits on top of that; it does not replace it.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='insurance'),
 'bonzah-form', 'The Bonzah onboarding form',
 'The long form, explained before you start it', 'ClipboardList', NULL, 20,
$md$
Before you can offer Bonzah you complete an onboarding form. It is the longest thing you will do in your first week and it generates more questions to our support team than anything else on the platform. So here is what it is and why it asks what it asks.

### Why it exists

Bonzah is a real insurer. This is an **underwriting application** — an underwriter is deciding whether to accept your business and on what terms, exactly as for any commercial policy. The questions are not a formality.

### Gather these first

- Business registration details and tax identification number
- Full names, home addresses, dates of birth and ownership percentages for **every** owner
- Bank account details
- Details of your current insurance policy
- The states or regions you operate in
- Roughly how many vehicles you run and how many rentals you do

### The steps

1. **Business** — legal entity, addresses, registration
2. **Operations & ownership** — where you operate, licensing, owners, years of experience
3. **Contacts** — who Bonzah should speak to, and about what
4. **Banking** — where money moves
5. **Insurance** — your existing coverage
6. **Policies** — your rental terms and rules
7. **Underwriting questions** — the risk questions
8. **Training** — short videos on how the product works
9. **Quiz** — a few questions confirming you understood

### The underwriting questions

Step seven asks directly about accidents, cancelled policies, fraud convictions, serious driving offences, unlicensed drivers, salvage titles and modified vehicles.

**Answer them accurately.** Two things are true at once:

- A "yes" does **not** automatically disqualify you. Underwriters expect real businesses to have history, and plenty of accepted operators answered yes to something.
- **Concealing a material fact can void your coverage** — not just that claim, the coverage. It is examined most closely at exactly the moment you most need it.

If a question is genuinely ambiguous in your situation, give the fullest answer you can and add the detail. Nobody has ever been penalised for explaining too much.

You can save and return — you do not have to finish in one sitting. After you submit, Bonzah reviews it; if they need clarification they will come back to you, and we can help chase.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='insurance'),
 'bonzah-training', 'Bonzah training and quiz',
 'Short videos and a few questions, built into the form', 'GraduationCap', NULL, 30,
$md$
Steps eight and nine are training videos and a short quiz.

**Why they are there:** customers will ask you about this coverage at the counter. "What does this actually cover?" is a question you need to answer without guessing, because guessing wrong about an insurance product is how people end up misled.

The videos are short and practical, about how the coverage works in real rental situations. Watch them properly rather than leaving them playing in another tab — the quiz draws on them. It is not a trap and it is not timed.

**Train your counter staff too.** The person handing over keys on a Saturday is the one being asked. If they have not watched the same videos they will invent an answer, and it will be wrong.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='insurance'),
 'bonzah-balance', 'Bonzah balance',
 'Keeping enough on account to issue policies', 'Wallet', NULL, 40,
$md$
Issuing policies draws on a balance held with Bonzah, shown in your portal header. Set a low-balance threshold that gives you real warning, and top up before it runs out.

**If it empties, policies stop being issued.** Your customers reach checkout, are offered insurance, and it fails — and you will usually hear about it from an annoyed customer rather than from the system. Set your warning at a week of normal trading, not a day.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='insurance'),
 'policies-addendum', 'Policies and the agreement addendum',
 'What happens after the customer buys', 'FileCheck', NULL, 50,
$md$
The **Insurances** page lists every policy sold through your bookings — who bought it, on which rental, what it covers, its status — and you can view or download any policy document.

When a customer buys coverage, an **insurance addendum** is attached automatically to their rental agreement and both are signed together. So the customer signs, in one action, both your rental terms and their acknowledgement of the coverage.

**When a customer has a claim**, it is between them and Bonzah. Your job is to give them the policy details and provide the facts of the rental — dates, vehicle, condition photographs, the signed agreement.

This is where your handover photographs earn their keep. A claim supported by timestamped before-and-after photographs gets settled. One supported by recollection gets argued about.
$md$)
ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- COMMS
-- -----------------------------------------------------------------------------
INSERT INTO public.welcome_pack_sections (group_id, slug, title, summary, icon, required_flag, sort_order, body_md) VALUES
((SELECT id FROM public.welcome_pack_groups WHERE key='comms'),
 'channels', 'Email, SMS and WhatsApp',
 'The three ways the platform reaches your customers', 'Send', NULL, 10,
$md$
**Email** — the default for anything substantial: confirmations, invoices, agreements, receipts. Free, carries your branding, holds attachments.

**SMS** — short and urgent: pickup reminders, lockbox codes, return reminders. Costs credits. Almost always read within minutes.

**WhatsApp** — increasingly what customers prefer, particularly for collection details, lockbox codes and photographs. Also costs credits.

| Situation | Use |
|---|---|
| Booking confirmation | Email |
| Invoice or receipt | Email |
| Agreement to sign | Email + WhatsApp |
| Pickup reminder | SMS or WhatsApp |
| Lockbox code | SMS or WhatsApp |
| Anything urgent | SMS |
| Anything long | Email |

**Do not send everything by every channel.** A customer who gets three messages about the same booking stops reading all of them, including the one that mattered.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='comms'),
 'templates', 'Message templates',
 'Writing once what you would otherwise write a thousand times', 'FileText', NULL, 20,
$md$
Settings → Templates holds the wording of every automatic message: booking confirmations, payment receipts, pickup and return reminders, lockbox instructions, agreement requests, cancellations, refund confirmations, review requests.

Templates use placeholders that fill themselves in — customer name, vehicle, booking reference, collection address, lockbox code. Write around them and each customer receives something specific to them.

**Worth doing on day one.** The default wording is correct but generic. Twenty minutes rewriting your top five templates in your own voice — your address, your parking instructions, your phone number, your actual tone — does more for how professional you seem than almost anything else here.

Always send yourself a test of any template you change.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='comms'),
 'reminders', 'Reminders',
 'The nudges that stop things being forgotten', 'Bell', NULL, 30,
$md$
**Customer reminders:** collection is tomorrow, return is due tomorrow, a payment is due, the agreement is still unsigned, documents still need uploading.

**Your own reminders** track what needs your attention: vehicle servicing, insurance renewals, expiring documents, overdue returns, unpaid invoices. Anything due shows as a count on your sidebar.

**Set these up early.** The reminder you did not configure is the vehicle you did not tax, the return you did not chase, and the customer who did not sign. Twenty minutes that keeps paying every week.
$md$)
ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- TEAM
-- -----------------------------------------------------------------------------
INSERT INTO public.welcome_pack_sections (group_id, slug, title, summary, icon, required_flag, sort_order, body_md) VALUES
((SELECT id FROM public.welcome_pack_groups WHERE key='team'),
 'roles', 'Staff accounts and roles',
 'Who can see what, and why it matters', 'Users', NULL, 10,
$md$
Everyone on your team gets their own login. **Never share one account** — you lose the audit trail, and you cannot remove one person's access without changing everyone's password.

| Role | Can do |
|---|---|
| **Head admin** | Everything, including staff and billing. This is you. |
| **Admin** | Everything operational; not billing or staff management |
| **Manager** | Exactly the areas you grant, individually |
| **Ops** | Day-to-day work — bookings, customers, vehicles |
| **Viewer** | Read-only |

Your business partner → admin. Someone running one part of the business → manager, with specific areas granted. Counter and yard staff → ops. Your accountant → viewer.

**When somebody leaves, deactivate their account the same day.** Not next week. Their account can see your customers' addresses, license images and payment history.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='team'),
 'manager-permissions', 'Manager permissions',
 'Granting access one area at a time', 'Lock', NULL, 20,
$md$
The **manager** role is the flexible one: rather than a fixed level, you grant each area individually and choose whether they can **view** or **edit**.

Grantable areas include vehicles, rentals, customers, payments, invoices, expenses, reports, messages and settings — and settings can be granted one tab at a time, so someone can manage branding without touching your payment configuration.

- **Fleet manager** — edit vehicles and availability, view rentals, nothing financial
- **Bookings coordinator** — edit rentals, customers and messages, view vehicles
- **Bookkeeper** — view and edit payments, invoices and expenses; no customer documents

Anything you have not granted does not appear in their sidebar at all. They do not see a locked door, they see nothing, which is much better.

**Give people what their job needs and nothing further** — not from distrust, but because it limits the damage from an honest mistake and from a compromised password.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='team'),
 'policies-audit', 'Policies and audit logs',
 'Agreements your staff accept, and a record of what everyone did', 'ScrollText', NULL, 30,
$md$
**Policy acceptance.** Your staff accept your privacy policy and terms before using the portal, and are asked again when you publish a new version. That gives you a dated record of who agreed to what.

**Audit logs** record who did what and when: bookings changed, prices altered, refunds issued, customers blocked, settings modified, users added or deactivated.

You will be glad of them when a price changed and nobody remembers doing it, when a refund was issued and you need to know by whom, when a customer disputes what they were told, or when something looks wrong and you need to know when it started.

Nobody looks at audit logs until they urgently need to. They are running whether you look or not.
$md$)
ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- ACCOUNT
-- -----------------------------------------------------------------------------
INSERT INTO public.welcome_pack_sections (group_id, slug, title, summary, icon, required_flag, sort_order, body_md) VALUES
((SELECT id FROM public.welcome_pack_groups WHERE key='account'),
 'subscription', 'Your subscription',
 'What you pay us, and what happens if it lapses', 'Crown', NULL, 10,
$md$
Your subscription is what you pay us to run the platform. It is entirely separate from the payments your customers make you — different account, different card, different invoices.

Settings → Subscription shows your plan, next billing date, payment method and every invoice.

**Trials.** Most operators start on one, with the remaining time shown in the portal. A trial is full access, not a limited version — use it to set the whole business up properly.

**If a payment fails** you are warned in the portal with days remaining, the warning escalates as the window shortens, and if unresolved, access is restricted until the outstanding invoice is paid. You will always be able to reach the subscription and settings pages so you can pay.

**If money is tight, talk to us.** An operator who tells us they have a cash flow problem is a conversation. An operator who ignores three warnings and loses access on a Saturday morning is an emergency. We would much rather have the conversation.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='account'),
 'setup-hub', 'Setup progress and going live',
 'The checklist that tracks your readiness', 'Rocket', NULL, 20,
$md$
While you are setting up, your dashboard shows a **Setup Hub** with your remaining setup time and progress on the items that genuinely block you from trading: **Stripe Connect**, without which you cannot take money, and **Bonzah insurance**, without which you cannot offer coverage.

**Why only two?** These are the two that stop the business working. Everything else — branding, templates, extras — improves your operation but does not prevent it. The hub shows blockers rather than a list of forty tasks nobody finishes.

When both are complete you are live and the portal says so. From then the hub disappears and your billing state shows in the sidebar instead.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='account'),
 'support', 'Getting help',
 'How to reach us, and what to send so we can fix it fast', 'LifeBuoy', NULL, 30,
$md$
There is a **Send Feedback** button in your sidebar, available to every member of your team regardless of role — because a viewer hits the same bugs as an owner.

- 🐛 **Bug** — something is broken
- 🔧 **Improvement** — something works but is awkward
- ✨ **Feature request** — something you wish existed
- 📝 **Note** — anything else

### What to include

- **What you were doing** — "approving a booking"
- **What you expected** — "the deposit to be released"
- **What actually happened** — "an error saying…"
- **The booking reference**, if it involves one
- **A screenshot**

That costs you thirty extra seconds and routinely saves a day of back-and-forth.

**We do read all of it.** Feature requests from operators are a genuine input into what we build — a great deal of what is in this document exists because an operator asked for it.
$md$)
ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- INSIGHTS
-- -----------------------------------------------------------------------------
INSERT INTO public.welcome_pack_sections (group_id, slug, title, summary, icon, required_flag, sort_order, body_md) VALUES
((SELECT id FROM public.welcome_pack_groups WHERE key='insights'),
 'dashboard', 'Your dashboard',
 'What to look at each morning', 'LayoutDashboard', NULL, 10,
$md$
Built to be read in thirty seconds: key figures (revenue, active rentals, utilisation, upcoming collections and returns), action items, a fleet overview of what is out and what is available, the week ahead, and alerts for low balances, expiring documents and failed payments.

**A morning routine that works:** action items, then today's collections and returns, then unread messages, then any alert showing. Five minutes, then get on with the day.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='insights'),
 'reports', 'Reports',
 'The numbers, over any period you choose', 'BarChart3', NULL, 20,
$md$
Revenue by period, vehicle and category. Utilisation — how much of the time each car is earning. Customers, new against returning. Bookings — volume, average value, average duration. Cancellations, and when they happen. Filter by date range and export to a spreadsheet.

### Three numbers worth watching monthly

1. **Utilisation per vehicle.** Below about 50%, a car is usually costing you money.
2. **Average rental value.** If it is falling, check whether you are discounting without noticing.
3. **Repeat customer rate.** The cheapest booking you will ever get is the second one from someone who already trusts you.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='insights'),
 'trax-ai', 'Trax, your assistant',
 'Asking questions of your own data in plain language', 'Sparkles', NULL, 30,
$md$
**Trax** is built into the portal. Ask questions about your own business in ordinary language: "which vehicle earned the most last month?", "how many bookings did we cancel in June?", "show me customers who have rented more than three times", "what is my utilisation this quarter?"

Good at questions about your data. Not a substitute for your own judgement about a customer, and not a lawyer. Treat it as a very fast analyst, and check anything surprising before acting on it.
$md$)
ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- COMMUNITY
-- -----------------------------------------------------------------------------
INSERT INTO public.welcome_pack_sections (group_id, slug, title, summary, icon, required_flag, sort_order, body_md) VALUES
((SELECT id FROM public.welcome_pack_groups WHERE key='community'),
 'you-are-part-of-this', 'You are part of something here',
 'Why we build this the way we do', 'Heart', NULL, 10,
$md$
This platform exists because independent rental operators were being squeezed between marketplaces that took a large cut of every booking and software built for companies with a thousand cars and a technology department.

You have neither. You have a fleet, a phone that rings, and a business that has to work on a Saturday afternoon when someone has not turned up.

### What that means in practice

**Your customers are yours.** Their details, their history, their contact information. Not ours, not a marketplace's. Nobody is going to advertise a competitor to your customer list.

**Your brand is yours.** Your site carries your name and your logo. Customers who book with you know they booked with *you*, and come back to *you*.

**Your prices are yours.** Nobody sets them but you, and nobody takes a commission on your bookings.

### The operators around you

There are businesses here running three cars and businesses running three hundred. Almost every feature described in this document exists because one of them asked for it — the lockbox handover, the installment plans, the vehicle owner payouts, the fine tracking.

When you hit something awkward, or want something that is not here, tell us. That is not politeness. It is genuinely how this gets built.

### And the honest part

You will hit problems. Something will not work the way you expect, a customer will do something nobody anticipated, a payment will fail at the worst moment. That happens to every operator here, including the ones who have been doing it for years.

Ask. Early, and about anything. Nobody thinks less of an operator for asking a question in their first month — or their fifth year.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='community'),
 'referral-programme', 'The referral programme',
 'Introduce another operator, and we both benefit', 'Gift', NULL, 20,
$md$
If you know another rental operator who would be better off here, we would like to meet them — and we would like you to benefit from making the introduction.

### How it works

1. **Tell us who they are.** Use the Send Feedback button in your sidebar, or reply to any email from us. Their name and the best way to reach them is enough.
2. **We take it from there.** We contact them, show them the platform, and answer their questions. You are not expected to sell anything.
3. **If they join, you benefit.** We confirm the current arrangement with you when you make the introduction — it is normally applied as a credit against your subscription.

### Who to think of

- Operators running the business on spreadsheets and a phone
- Operators handing a large share of every booking to a marketplace
- Operators whose software does not do insurance, contracts and payments in one place
- Someone about to start, who would rather start properly

### Why we do it this way

The best operators here came from another operator saying it was worth a look. That is worth more than any advertising we could buy, and we would rather the value went to you than to an advertising platform.

**If you are unsure whether someone counts, or you want the current terms before mentioning it to anyone, just ask.** There is no complicated small print.
$md$),

((SELECT id FROM public.welcome_pack_groups WHERE key='community'),
 'what-next', 'What to do next',
 'Close this and do three things', 'ArrowRight', NULL, 30,
$md$
You have read the whole thing. That already puts you ahead of most people on their first day.

### Now do these three, in order

1. **Connect Stripe.** It takes longest to be approved and blocks everything else.
2. **Add one vehicle properly.** Photos, specification, prices. One car done well teaches you the pattern for the rest.
3. **Book that car on your own website in test mode.** Pay with the test card, sign the agreement, watch it arrive in the portal. Nothing else teaches you the system as quickly.

### Then

- Complete the Bonzah form when you have the documents to hand
- Rewrite your top five message templates in your own words
- Set up your reminders

### Keep this document

It stays in your sidebar. When something comes up in six months that you have never dealt with before, it is almost certainly in here.

**Welcome aboard.**
$md$)
ON CONFLICT (slug) DO NOTHING;

-- =============================================================================
-- FAQs
-- =============================================================================
INSERT INTO public.welcome_pack_faqs (group_id, question, answer_md, required_flag, sort_order) VALUES
((SELECT id FROM public.welcome_pack_groups WHERE key='start'),
 'How long does it take to get set up and taking real bookings?',
 $md$Most operators are live within a week. The work itself is a day or two; the waiting is Stripe approving your account and Bonzah reviewing your insurance application. Start both on day one and the rest fits around them.$md$, NULL, 10),
((SELECT id FROM public.welcome_pack_groups WHERE key='start'),
 'Do I need to know anything technical?',
 $md$No. Nothing to install, no code, no server to look after. If you can use online banking you can use this.$md$, NULL, 20),
((SELECT id FROM public.welcome_pack_groups WHERE key='start'),
 'Can I try everything without risking real money?',
 $md$Yes, and you should. In test mode you can take bookings, pay with test cards, sign agreements and complete rentals without a penny moving. Use `4242 4242 4242 4242` with any future expiry and any three-digit code.$md$, NULL, 30),
((SELECT id FROM public.welcome_pack_groups WHERE key='start'),
 'What happens to my test bookings when I go live?',
 $md$They stay unless you remove them. Clear out test bookings and customers before you trade so your reports are not polluted from day one. Ask us for help doing it.$md$, NULL, 40),
((SELECT id FROM public.welcome_pack_groups WHERE key='start'),
 'I have made a mess of my settings. Can I start again?',
 $md$Yes. Nothing you can configure is permanent, and we can reset your data if it comes to that. Ask before you spend an afternoon undoing things by hand.$md$, NULL, 50),

((SELECT id FROM public.welcome_pack_groups WHERE key='website'),
 'Can I use my own domain name?',
 $md$Yes. You get a platform address immediately, and we can point your own domain at it. Tell us the domain — usually a day, most of it waiting for the internet to update.$md$, NULL, 10),
((SELECT id FROM public.welcome_pack_groups WHERE key='website'),
 'Can I change the layout of my booking site, not just the text?',
 $md$Text, images, colors, logo and fleet are all yours. The underlying layout is standard because it is continuously tested for booking conversion across every operator here. If there is a specific change you need, tell us — layout changes that help one operator usually help all of them.$md$, NULL, 20),
((SELECT id FROM public.welcome_pack_groups WHERE key='website'),
 'Why is a vehicle not showing on my website?',
 $md$Almost always one of four things: it is not published, it has no price for the duration searched, that duration is switched off for the vehicle, or it is blocked on the calendar for those dates. Check in that order.$md$, NULL, 30),
((SELECT id FROM public.welcome_pack_groups WHERE key='website'),
 'Do I need to write my own terms and conditions?',
 $md$Yes, and they should be reviewed by someone qualified in your jurisdiction. We provide the mechanism to attach and sign them; the content of your contract is your business and your legal responsibility.$md$, NULL, 40),

((SELECT id FROM public.welcome_pack_groups WHERE key='fleet'),
 'How many photos should each vehicle have?',
 $md$Six to ten. Front three-quarter view first, then interior, dashboard and boot. Daylight, clean car, plain background. This affects bookings more than almost anything else you control.$md$, NULL, 10),
((SELECT id FROM public.welcome_pack_groups WHERE key='fleet'),
 'Can I stop a car being booked for single days?',
 $md$Yes. Each vehicle controls daily, weekly and monthly availability independently. Switch daily off and the car does not appear in short searches.$md$, NULL, 20),
((SELECT id FROM public.welcome_pack_groups WHERE key='fleet'),
 'How do I take a car off the road for servicing?',
 $md$Block the dates on the Availability page. Do not delete the vehicle — that takes its rental history with it.$md$, NULL, 30),
((SELECT id FROM public.welcome_pack_groups WHERE key='fleet'),
 'Can I charge more at Christmas without changing all my prices?',
 $md$Yes. Add a holiday period with a surcharge and set it to recur annually. You can also override individual vehicles within that period, so your two best cars take a bigger uplift than the rest.$md$, NULL, 40),
((SELECT id FROM public.welcome_pack_groups WHERE key='fleet'),
 'Can I rent by the hour?',
 $md$You can set a minimum rental length in hours as well as days, so a four-hour minimum is possible. Talk to us about your specific model and we will make sure it is configured correctly.$md$, NULL, 50),

((SELECT id FROM public.welcome_pack_groups WHERE key='bookings'),
 'Should I approve bookings manually or automatically?',
 $md$Automatic converts better and suits most fleets with clear rules. Manual is worth it for high-value vehicles, or while you are new. If you choose manual, commit to replying within an hour in business hours — a slow reply loses the booking anyway.$md$, NULL, 10),
((SELECT id FROM public.welcome_pack_groups WHERE key='bookings'),
 'A customer wants to extend. What do I do?',
 $md$Open the rental, check the calendar that the vehicle is not promised to someone else, extend the dates and take the additional payment. It all happens on the rental record.$md$, NULL, 20),
((SELECT id FROM public.welcome_pack_groups WHERE key='bookings'),
 'The customer has not signed. Can I still give them the car?',
 $md$No. An unsigned agreement is not a contract — no documented terms, no agreed deposit, and a much weaker position on any damage. Resend the link and wait.$md$, NULL, 30),
((SELECT id FROM public.welcome_pack_groups WHERE key='bookings'),
 'What if a customer does not return the vehicle?',
 $md$Contact them first — most overruns are disorganisation, not theft. If you cannot reach them you have their verified identity, signed agreement and payment details on file. Follow your local process for reporting it, and tell us so we can help with the records you will need.$md$, NULL, 40),
((SELECT id FROM public.welcome_pack_groups WHERE key='bookings'),
 'Can I move a customer onto a different vehicle after booking?',
 $md$Yes, from the rental record; the agreement is regenerated with the correct vehicle. Tell the customer before you do it, not after they arrive.$md$, NULL, 50),

((SELECT id FROM public.welcome_pack_groups WHERE key='customers'),
 'A customer failed identity verification. What now?',
 $md$Usually a bad photograph rather than anything sinister. Ask them to retry in good light with the license flat and no glare. If it fails repeatedly, ask to see the documents in person before releasing anything.$md$, NULL, 10),
((SELECT id FROM public.welcome_pack_groups WHERE key='customers'),
 'Can I refuse a booking?',
 $md$Yes. It is your business and your vehicles. Decline for genuine reasons — failed verification, a poor previous rental, a license that does not meet your policy. Never for anything discriminatory, and record the reason you gave.$md$, NULL, 20),
((SELECT id FROM public.welcome_pack_groups WHERE key='customers'),
 'Do customers see the rating I give them?',
 $md$Never. Internal ratings and notes are private to your team and are not visible to the customer under any circumstances.$md$, NULL, 30),
((SELECT id FROM public.welcome_pack_groups WHERE key='customers'),
 'Someone blocked by another operator wants to book with me. Will I know?',
 $md$You see your own blocked list, and you are warned about anyone on the platform-wide blacklist, which is reserved for serious cases such as proven fraud or vehicle theft. Another operator''s ordinary internal notes are private to them, as yours are to you.$md$, NULL, 40),
((SELECT id FROM public.welcome_pack_groups WHERE key='customers'),
 'Can I rent to rideshare and delivery drivers?',
 $md$Commercially yes, and they are often excellent repeat customers. Check first that your own fleet insurance covers commercial passenger or delivery use — many policies specifically exclude it, and after an accident is the wrong moment to discover that.$md$, NULL, 50),

((SELECT id FROM public.welcome_pack_groups WHERE key='money'),
 'When does the money actually reach my bank?',
 $md$Stripe pays out on a rolling schedule, typically two to seven days after the payment depending on your country and account history. New accounts wait a little longer at first, and this shortens as you build a track record.$md$, NULL, 10),
((SELECT id FROM public.welcome_pack_groups WHERE key='money'),
 'Do you take a cut of my bookings?',
 $md$No. Your customers pay into your own Stripe account, which pays out to your bank. We charge a subscription for the platform, billed separately, never taken from a booking.$md$, NULL, 20),
((SELECT id FROM public.welcome_pack_groups WHERE key='money'),
 'A customer says they were charged twice.',
 $md$Almost always the security deposit hold sitting alongside the rental payment. The hold is reserved, not taken, and disappears when released. Show them the payment record — and explain the hold at booking to avoid the call entirely.$md$, NULL, 30),
((SELECT id FROM public.welcome_pack_groups WHERE key='money'),
 'How long can I hold a deposit?',
 $md$Card holds expire on their own, typically after around seven days — a limit set by the card networks, not by us. For longer rentals the platform can chain holds so coverage continues. Release the hold the day the vehicle comes back.$md$, NULL, 40),
((SELECT id FROM public.welcome_pack_groups WHERE key='money'),
 'How much should my deposit be?',
 $md$Enough to cover a realistic worst case on that vehicle — typically your insurance excess plus a margin. A deposit larger than the rental itself costs you bookings, so scale it per vehicle rather than applying one figure to the whole fleet.$md$, NULL, 50),
((SELECT id FROM public.welcome_pack_groups WHERE key='money'),
 'A payment failed. Is something wrong with my setup?',
 $md$A single decline is nearly always the customer''s bank. Ask them to try another card. Failures across many different customers point at a configuration problem — tell us immediately.$md$, NULL, 60),
((SELECT id FROM public.welcome_pack_groups WHERE key='money'),
 'How do I refund a customer?',
 $md$From the rental or the payment record, in full or in part. It returns to the original card and takes five to ten days to appear, which is their bank rather than you. You can also schedule a refund for a future date while you assess damage.$md$, NULL, 70),
((SELECT id FROM public.welcome_pack_groups WHERE key='money'),
 'What are credits and why did mine run out?',
 $md$Credits pay for things that cost money each time — text messages, WhatsApp messages and identity verification checks. Top up from the Credits page and set your low-balance warning generously, because at zero your verification checks stop and your messages stop sending.$md$, NULL, 80),

((SELECT id FROM public.welcome_pack_groups WHERE key='insurance'),
 'Why is the Bonzah form so long?',
 $md$Because it is a genuine insurance underwriting application, not a sign-up form. An underwriter is deciding whether to accept your business and on what terms, exactly as for any commercial policy. Gather your documents first and it goes much faster.$md$, NULL, 10),
((SELECT id FROM public.welcome_pack_groups WHERE key='insurance'),
 'What do I need before I start the Bonzah form?',
 $md$Business registration details and tax identification number; full names, home addresses, dates of birth and ownership percentages for every owner; bank details; details of your existing insurance policy; the states or regions you operate in; and roughly how many vehicles and rentals you handle.$md$, NULL, 20),
((SELECT id FROM public.welcome_pack_groups WHERE key='insurance'),
 'Can I save the Bonzah form and come back to it?',
 $md$Yes. Your progress is saved as you go — you do not have to complete it in one sitting.$md$, NULL, 30),
((SELECT id FROM public.welcome_pack_groups WHERE key='insurance'),
 'What happens if I answer "yes" to one of the underwriting questions?',
 $md$Not what most people fear. A "yes" does not automatically disqualify you — underwriters expect real businesses to have history, and plenty of accepted operators answered yes to something. What matters is that the answer is accurate. Concealing a material fact can void your coverage entirely, and that is discovered at exactly the moment you most need the policy.$md$, NULL, 40),
((SELECT id FROM public.welcome_pack_groups WHERE key='insurance'),
 'Why does it ask about accidents or claims in the past 3 years?',
 $md$It is a standard measure of risk across the operation. Answer for the operators and drivers covered by the policy. If you are not certain of a date or an outcome, say so and give what you know rather than guessing or leaving it out.$md$, NULL, 50),
((SELECT id FROM public.welcome_pack_groups WHERE key='insurance'),
 'Why does it ask about a previously cancelled or non-renewed policy?',
 $md$Because why a previous insurer ended cover is genuinely informative to a new one. A non-renewal for an administrative reason is very different from one for claims history, so if the reason is innocuous, say what it was.$md$, NULL, 60),
((SELECT id FROM public.welcome_pack_groups WHERE key='insurance'),
 'Why does it ask whether any vehicle has a salvage title?',
 $md$A vehicle previously written off carries a different risk and a different value, and insurers treat it differently. If you have any, declare them — an undeclared salvage-title vehicle is the sort of omission that voids a claim.$md$, NULL, 70),
((SELECT id FROM public.welcome_pack_groups WHERE key='insurance'),
 'What counts as a vehicle "modified for performance"?',
 $md$Changes that increase power or alter handling — engine or turbo modifications, remapped software, suspension and brake changes, exhaust systems. Cosmetic changes such as wraps and wheels generally do not count, but if you are unsure about a specific vehicle, declare it and explain. Declaring something harmless costs you nothing.$md$, NULL, 80),
((SELECT id FROM public.welcome_pack_groups WHERE key='insurance'),
 'It asks whether vehicles are used for anything other than rentals. What does that mean?',
 $md$Whether any vehicle on the policy is used outside renting it out or routine maintenance — personal use, staff use, deliveries, driver hire, courtesy loans. If any of that happens, say so: a policy underwritten for rental use may not respond to a loss during a different kind of use.$md$, NULL, 90),
((SELECT id FROM public.welcome_pack_groups WHERE key='insurance'),
 'Why does it ask for owners'' addresses and dates of birth?',
 $md$Standard identity and financial-crime checks that apply to every commercial insurance application. Provide them for each owner along with their ownership percentage. This goes to the insurer, not onto your website or anywhere customer-facing.$md$, NULL, 100),
((SELECT id FROM public.welcome_pack_groups WHERE key='insurance'),
 'Why does it ask how many years I have been on Turo?',
 $md$Experience in private auto rental is one of the clearest risk signals available, and time on a rental platform is a concrete way to measure it. If you have none, put zero — new operators are accepted; the answer just needs to be true.$md$, NULL, 110),
((SELECT id FROM public.welcome_pack_groups WHERE key='insurance'),
 'What if I am not sure I am licensed correctly in every location?',
 $md$Find out before you answer. This is a compliance question about your own business rather than an insurance technicality, and the honest answer is worth having regardless of the form. If you are mid-way through an application in a jurisdiction, say exactly that.$md$, NULL, 120),
((SELECT id FROM public.welcome_pack_groups WHERE key='insurance'),
 'How long does Bonzah take to approve my application?',
 $md$It varies, and it is not instant. Bonzah may come back with follow-up questions. Submit early, and tell us if you have heard nothing for a while — we can chase it.$md$, NULL, 130),
((SELECT id FROM public.welcome_pack_groups WHERE key='insurance'),
 'Do I have to offer insurance to my customers?',
 $md$No, it is optional. But it costs you nothing, it protects your fleet, and it means "am I covered?" is answered at checkout rather than argued about at the counter.$md$, NULL, 140),
((SELECT id FROM public.welcome_pack_groups WHERE key='insurance'),
 'Does Bonzah replace my own business insurance?',
 $md$No, and this matters. Bonzah is protection for the rental, bought by the customer. You still need your own fleet policy, your own liability cover, and whatever your jurisdiction requires.$md$, NULL, 150),
((SELECT id FROM public.welcome_pack_groups WHERE key='insurance'),
 'A customer wants to make a claim. What do I do?',
 $md$The claim is between the customer and Bonzah. Give them their policy details and provide the facts of the rental — dates, vehicle, the signed agreement and your condition photographs. This is exactly why you photograph every vehicle at handover and return.$md$, NULL, 160),
((SELECT id FROM public.welcome_pack_groups WHERE key='insurance'),
 'Why did insurance stop being offered at checkout?',
 $md$Usually an empty Bonzah balance. Check the balance in your portal header and top it up. Set your low-balance warning at roughly a week of normal trading so this never happens unannounced.$md$, NULL, 170),

((SELECT id FROM public.welcome_pack_groups WHERE key='team'),
 'How many staff accounts can I have?',
 $md$Add as many as your team needs. Never share one login — you lose the audit trail, and you cannot remove one person''s access without disrupting everyone.$md$, NULL, 10),
((SELECT id FROM public.welcome_pack_groups WHERE key='team'),
 'Which role should I give my counter staff?',
 $md$Ops for day-to-day work on bookings, customers and vehicles. Use manager instead when someone needs a specific extra area, such as pricing or reports, and grant only that area.$md$, NULL, 20),
((SELECT id FROM public.welcome_pack_groups WHERE key='team'),
 'A member of staff has left. What do I do?',
 $md$Deactivate their account the same day. Their login can see customer addresses, license images and payment history.$md$, NULL, 30),
((SELECT id FROM public.welcome_pack_groups WHERE key='team'),
 'Can I see who changed a price or issued a refund?',
 $md$Yes. The Audit Logs page records who did what and when, including bookings, prices, refunds, blocked customers, settings and user changes.$md$, NULL, 40),

((SELECT id FROM public.welcome_pack_groups WHERE key='account'),
 'What happens if my subscription payment fails?',
 $md$You are warned in the portal with the days remaining, and the warning escalates as the window shortens. If unresolved, access is restricted until the outstanding invoice is paid — but you can always still reach the subscription and settings pages so you can pay.$md$, NULL, 10),
((SELECT id FROM public.welcome_pack_groups WHERE key='account'),
 'Can I change my plan?',
 $md$Yes. Talk to us about what you need and we will set the right plan up for your account.$md$, NULL, 20),
((SELECT id FROM public.welcome_pack_groups WHERE key='account'),
 'My subscription and my customer payments are on different cards. Is that right?',
 $md$Yes, entirely. Your customers pay into your Stripe account; your subscription is billed separately by us. Two different systems, deliberately.$md$, NULL, 30),
((SELECT id FROM public.welcome_pack_groups WHERE key='account'),
 'Where do I get help?',
 $md$The Send Feedback button in your sidebar, available to every member of your team. Include what you were doing, what you expected, what happened, the booking reference and a screenshot — that turns a day of back-and-forth into one reply.$md$, NULL, 40),
((SELECT id FROM public.welcome_pack_groups WHERE key='account'),
 'I have an idea for a feature. Is it worth telling you?',
 $md$Yes, genuinely. A large amount of what is in this document exists because an operator asked for it. Send it through the feedback button.$md$, NULL, 50),

((SELECT id FROM public.welcome_pack_groups WHERE key='community'),
 'How does the referral programme work?',
 $md$Tell us about an operator who would be better off here — their name and the best way to reach them is enough. We contact them and answer their questions; you are not expected to sell anything. If they join, you benefit, normally as a credit against your subscription. Ask us for the current terms when you make the introduction.$md$, NULL, 10),
((SELECT id FROM public.welcome_pack_groups WHERE key='community'),
 'Who should I refer?',
 $md$Operators running on spreadsheets and a phone; operators handing a large share of every booking to a marketplace; anyone whose software does not do insurance, contracts and payments in one place; and anyone about to start who would rather start properly.$md$, NULL, 20),
((SELECT id FROM public.welcome_pack_groups WHERE key='community'),
 'Do you contact my customers?',
 $md$No. Your customers are yours. We never market to them, and we never advertise another operator to your customer list.$md$, NULL, 30),
((SELECT id FROM public.welcome_pack_groups WHERE key='community'),
 'Can I export my data if I ever leave?',
 $md$Yes. Your customers, bookings and financial records are yours. Ask and we will export them for you.$md$, NULL, 40)
ON CONFLICT DO NOTHING;
