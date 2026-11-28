# The first visit to the portal

*Task guide for Hamna · From Ghulam · 26 Nov 2026 · Northwind (v2) portal only*

> **Your task in one line.** A new company's first visit is one short, required tour of 7 cards. After it, every tab has its own deep tour that a person takes at their own pace. You polish the first and build the second.

> **The most important thing: the phone.** Most new operators will meet the portal for the first time on a phone. Build and check every card, every menu and every tour step on a phone screen first, then on a laptop. If it is not excellent on a phone, it is not finished. Section 5 says exactly what to check.

## 1. What happens when a new company arrives

| Order | What they see | Detail |
|---|---|---|
| 1 | The portal home page | They land here straight from signup. |
| 2 | The quick tour, card 1 | It opens by itself. It is the first thing on the screen. |
| 3 | Cards 2 to 7 | They go through all of them. The tour is **required**: it cannot be skipped or closed. |
| 4 | The home page, free to use | With the Stripe line at the top and Bryan's card at the foot of the sidebar. Both exist already. |
| 5 | A "Tour" button on every tab | The deep tour for that tab. Optional. Taken whenever they like, as often as they like. |

## 2. The quick tour: 7 cards

Its only job: tell a new operator what they have and what they must do to create a rental. It names things. It does not teach them; the tab tours do that.

| # | Card title today | What it tells them | Points at |
|---|---|---|---|
| 1 | I am Trax. Here is what a rental needs. | What this tour is, and the three things a first rental needs: a car, a customer, Stripe. Shown as three small pictures. | Centre of the screen |
| 2 | A car, and someone to rent it | Cars live in Vehicles, renters in Customers. The driver's licence and face are checked before anyone drives. | Vehicles and Customers |
| 3 | The paperwork and the money | The agreement signed online, optional Bonzah insurance, and every payment, deposit and refund. | Agreements, Insurance, Finances |
| 4 | Put together, that is a rental | Pick the car and the customer; the check, agreement, insurance and payment follow in one flow. | Rentals |
| 5 | Your booking site is already live | Customers book and pay there. The switch opens the Website side where they edit it. | The Website switch |
| 6 | And I am always here | Ask Trax anything. Help is always in the top bar. | The Help button |
| 7 | That is the big picture | The one must-do: connect Stripe. Bryan can help on a free call. And: every tab has its own tour for the detail. | Centre of the screen |

### What to change

| Change | What we want |
|---|---|
| Make it required | Today it has a close button, a Skip, and the Esc key ends it. Remove all three. Only Back and Next. The last card is the only way out. |
| Improve card 1 | This is the very first thing a new operator sees. Give it better illustrations for the three things a rental needs. Use the illustration style the portal already has (thin light outlines, soft shadows, nothing cartoonish). |
| Card 7 hands over to the tab tours | Today this is one small line under the text. Make it clear and easy to notice. |
| Keep it at 7 | Never more than 7 cards. |

### What stays exactly as it is

- The look of the cards, the moving pointer, the Back and Next buttons, the colours and the fonts. Do not redesign them.
- The order and the subject of the 7 cards.

### The rules for the required tour

| Situation | What happens |
|---|---|
| They refresh or close the browser on card 4 | The tour comes back at card 4, not at card 1. |
| A company that already exists today | Not required. Only companies created after this goes live get the required tour. |
| A second staff member joins a company later | Required for them too, once. |
| Someone wants to see it again later | They can replay it from the Help menu. On a replay it can be closed. |

## 3. The deep tours, one for every tab

A person stands on a tab, presses **Tour**, and is taught that tab properly. Build one for every tab you can: Vehicles, Customers, Rentals, Payments, Availability, Agreements, Insurance, Finances, Integrations, and the rest of the sidebar.

### What exists today and what we want

| Today | What we want now |
|---|---|
| 5 tours: Vehicles, Customers, Rentals, Payments, Availability | Every tab. |
| About 10 steps each, surface only | As many steps as the tab needs, in full detail, split into topics. |
| One run from start to end | Topics. A person can jump straight to the topic they need. |
| No memory. Close it and it starts again. | It remembers. They can stop, come back, and carry on where they left off. |
| A Tour button on 4 tabs | A Tour button on every tab, in the same place on each. |

The code comments in `lib/tab-tours/` describe the old rule ("about ten steps, surface only, no resume"). That rule is replaced by this guide.

### How a deep tour works

| Part | What it does |
|---|---|
| The Tour button | Opens a small menu of topics for this tab. |
| The topic menu | Lists the topics in learning order. Each shows: not started, in progress, or done (a tick). "Continue" and "Start from the beginning" at the top. |
| A topic | 4 to 8 steps about one subject. Short enough to finish in a minute or two. |
| A step | Points at one thing on the screen and explains it in one or two sentences. |
| Progress | Saved for each person. It is still there tomorrow and on another device. |
| Leaving | These tours are optional. A person can close one at any step. |

### How to decide the topics and steps for a tab

You do not need to work this out alone. For each tab, ask your Claude, then build what you agree on. Paste this, with the tab's name filled in:

```text
I am building the deep tour for the [TAB NAME] tab of the Northwind (v2)
portal. Read this tab's page, every dialog it opens, and the record page
behind it. Then give me:

1. The topics for this tab's tour, in the best order for someone
   learning it for the first time.
2. For each topic, 4 to 8 steps. Each step: what on the screen it points
   at, and one or two short sentences Trax says, in the first person.
3. Anything on this tab the tour would leave unexplained.

The steps must be useful to a rental operator doing real work, not a
list of button names. When a person has finished every topic, nothing
on this tab should be left unexplained.
```

### How deep is deep enough

| Cover | Meaning |
|---|---|
| The list page | Every number at the top, every filter, the search, every column, every button. |
| Adding one | The add dialog, field by field: what goes in, which are required. |
| The record page | Every section and every tab inside one record. |
| Every dialog | Each dialog that can open from the tab, and what its choices do. |
| Every status | What each status means and what moves a record from one to the next. |
| What happens elsewhere | What the customer sees on the booking site, what email or text is sent, what changes on other tabs. |
| Empty and full | The tour must make sense for a company with nothing yet and for one with data. |

### An example of the level: Vehicles

| # | Topic | What the steps teach |
|---|---|---|
| 1 | Your fleet at a glance | The numbers at the top, the list, search, filters, what each column means. |
| 2 | Adding a car | The add dialog field by field. |
| 3 | The car's record | Each section of one car's page and what it is for. |
| 4 | Photos | Adding, ordering, why the first photo is the cover on the booking site. |
| 5 | Prices | Daily, weekly and monthly rates, and which one a booking uses. |
| 6 | Weekends and holidays | What a surcharge is, how to set it, how to change it for one car. |
| 7 | When a car can be booked | Blocked dates, the daily/weekly/monthly switches, why a car may not appear. |
| 8 | Keys and lockbox | The lockbox code and instructions, and what the customer is sent. |
| 9 | Upkeep | Documents, maintenance, the odometer, reminders. |
| 10 | On your booking site | How a car appears to customers and what controls it. |

> **Order of work.** Build the topic menu, saved progress and the Vehicles tour first, completely, on phone and laptop. Show Ghulam. Once that one is agreed, the other tabs follow the same pattern and go quickly.

## 4. Build yourself a small testing helper first

Do not sign up a new company each time you want to see the first visit. Before anything else, build a small helper for your own machine that lets you move around the tours freely. It will save you hours.

| What it should let you do | Why |
|---|---|
| Start the first visit from the beginning with one click | No signup needed. |
| Jump to any of the 7 cards, forward or back | To check one card without clicking through the others. |
| Stay on a card for as long as you like | To inspect its layout at each screen size. |
| Reset "tour already seen" and all saved tab-tour progress | So you can run it again and again. |
| Open any tab tour at any topic and step | The same, for the deep tours. |
| Pretend to be different companies: no cars yet, with cars, Stripe connected or not, call booked or not | The cards and tours change with these. |

### Rules for the helper

- **Your machine only.** It must not work on any live site.
- **It changes nothing real.** No test companies or rows in the database. It only pretends, on your screen.
- **Remove it before the pull request.** The pull request contains the tours, not the helper.

A start exists already: the page `/fake-quick-tour` (Northwind only) replays the quick tour from card 1 with nothing else on screen, and accepts `?stripe=connected` and `?call=booked`. Build on it. **That page itself stays**; remove only what you add.

To ask your Claude for it:

```text
Build me a small developer helper for the portal tours, for localhost
only. Start from the existing /fake-quick-tour page. I need: start the
quick tour from card 1, jump to any card, reset "seen" and all saved
tour progress, open any tab tour at any topic and step, and switch
between pretend companies (no cars / with cars, Stripe connected or
not). It must write nothing to the database and must not work outside
localhost. Keep everything you add in clearly named files so we can
remove it before the pull request.
```

## 5. Checking on a phone

Check each item at every size in the table. Use the device toolbar in Chrome, and at least once a real phone.

| Screen | Width to test |
|---|---|
| Small phone | 360 |
| Usual phone | 390 and 430 |
| Tablet | 768 |
| Laptop | 1366 and 1440 |

| Check | What good looks like |
|---|---|
| The card fits | The whole card is on screen. Nothing cut off, no sideways scrolling. |
| The card does not cover what it points at | On a phone the sidebar is hidden, so decide where each card points and make sure it is visible. |
| Buttons are easy to tap | Back and Next are big enough for a thumb and not at the very edge. |
| Text is readable | No tiny text. No line squeezed to two words. |
| Illustrations scale | Card 1's pictures stay sharp and in proportion at every width. |
| The topic menu | Opens fully on screen, scrolls if long, closes easily. |
| Phone keyboard and rotation | Turning the phone sideways does not break the card. |
| Dark and light | Both themes look right. |
| Every step of every tab tour | Not only the first one. Each step points at something that exists on a phone. |

## 6. Not in your task

> - **Booking a call with Bryan.** The card, the calendar and everything after pressing it. Leave it as it is.
> - **Connecting Stripe.** The line at the top of the home page and the connect flow. Leave it as it is.
> - **The other pop-ups** a new company may get: questions, feedback, webinar, welcome pack, announcements, ratings. That is a separate task. Do not move, hide or remove them.
> - **Signup.** Hamza is on it.
> - **Driver verification.** Haris is on it.

Cards 6 and 7 of the quick tour mention Bryan and Stripe and have their buttons. Keep those buttons working exactly as they do now.

## 7. Rules for this work

| Rule | Detail |
|---|---|
| Northwind only | These are the new (v2) screens. Do not change a file the other companies' portal uses. If you are unsure whether a file is shared, ask Ghulam. |
| Trax is the voice | Everything a tour says is Trax speaking in the first person. No emojis. |
| One look | Deep tours look exactly like the quick tour: the moving pointer and a plain card beside it. No blur, no spotlight ring. |
| Short sentences | One or two per step, in the words an operator uses. |
| If something else is broken | Write it down for Ghulam. Do not fix things outside the tours. |

## 8. How to work and hand in

1. Make a branch from the latest `staging`, for example `hamna/feat/portal-tours`.
2. Build the testing helper (section 4).
3. Do the quick tour changes (section 2). Check on a phone.
4. Build the topic menu, saved progress and the Vehicles tour (section 3). Check on a phone. Show Ghulam.
5. Build the tours for the other tabs. Check each on a phone.
6. Remove the testing helper.
7. Push your branch and raise a pull request. In it, list the tabs that now have a tour and add phone screenshots of card 1, one other card, and the topic menu.

## 9. Where to look in the code

| File (inside `apps/portal/src`) | What it is |
|---|---|
| `lib/first-rental-tour.ts` | The 7 cards: their words and what they point at |
| `components/onboarding/first-rental-tour.tsx` | How a card and the pointer are drawn; Skip, close and Esc are here |
| `lib/tab-tours/` | The five tab tours as they are today |
| `components/onboarding/tab-tour-button.tsx` | The Tour button |
| `app/(dashboard)/fake-quick-tour/` and `lib/fake-quick-tour.ts` | The replay page your helper starts from |
