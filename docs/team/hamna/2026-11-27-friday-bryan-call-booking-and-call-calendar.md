# Bryan's call booking and the Call Calendar

*Full brief for Hamna · From Ghulam · Friday 27 Nov 2026 · Portal (Northwind v2) and super admin · Branch `ray3`*

> **Your task in one line.** Make the free onboarding call with Bryan a complete, finished feature: a company books, moves and cancels its call inside the portal, and Bryan runs all of his bookings and his calendar from super admin. Check what exists, fix what is wrong, build what is missing, and prove it.

> **Three things matter most.**
>
> - **Time zones.** Bryan is in New York. The companies are everywhere. One wrong hour and a customer misses the call. Section 7 is the heart of this task.
> - **The phone.** Most companies will book from a phone. Build and check the company's side on a phone first.
> - **Both sides.** Every action on one side must show correctly on the other: a company cancels, Bryan sees it; Bryan moves a call, the company sees it and is told.

You follow the full path for this task: PRD, specs, evals, QA report, then a pull request from `ray3`. Read `docs/onboarding/` first; it explains the path, your branch and how to resync. This document is what you write your PRD from.

> **Not the signup flow.** The call is also offered at the end of signup on drive-247.com. That step is not yours. Your work starts when the company is already inside the portal.

## 1. The feature in plain words

Every new company gets one free 30-minute call with Bryan, our onboarding specialist, to get set up. The company picks a time from Bryan's calendar. Bryan sees who booked and runs the call.

| Person | What they need |
|---|---|
| The company's owner | To book a time that suits them, in their own time, in under a minute. To move or cancel it. To be reminded. To find the link when the call starts. |
| Bryan | To see every call, today's first. To know who he is talking to and what time it is for them. To mark a call done or missed, move it, cancel it, or book one for a company himself. To control his hours and days off. |
| Ghulam | To see that calls are being booked and held. |

## 2. The company's side today (portal)

| # | Step | What the company sees | State |
|---|---|---|---|
| 1 | The offer | A small card at the bottom of the sidebar: Bryan's photo, "Free onboarding call", "With Bryan · 30 minutes". Owners only. | Built |
| 2 | Opening the calendar | From the card, from the quick tour's "Book onboarding call", or from an email link (`?book-call=1`). | Built |
| 3 | Pick a time | A month with free days marked, then that day's times, in the viewer's own time zone. Bryan stays on the left. | Built |
| 4 | Details | Name, email, phone, a note for Bryan. | Built |
| 5 | Booked | A picture, the time, "Add to calendar", the call link. | Built. No call link is set. |
| 6 | Confirmation email | The time, a join link, a calendar invite. | **Not built** |
| 7 | Coming back | The card says "Onboarding call booked" with the time, a short checklist (add a vehicle, upload a logo, preview the website), Move the call, Cancel it. | Built |
| 8 | Move | Opens the calendar again. The new time replaces the old one. | Built. No email. |
| 9 | Cancel | Asks once, frees the time, and the card offers the call again. | Built. No email. |
| 10 | Before the call | A reminder. | **Not built** |
| 11 | After the call | Done: the card goes away. Missed: nothing happens. | Half built |

### Who is offered the call

A company on the v2 portal that is in its first 30 days or on a free trial. Northwind always, so the team can see it. The card goes away once Bryan marks the call done, or the owner hides it.

### The rules the server already enforces

| Rule | Value today |
|---|---|
| Call length | 30 minutes |
| Bryan's hours | Monday to Friday, 9:00 to 17:00, New York time |
| Notice | At least 12 hours ahead |
| How far ahead | Up to 30 days |
| Days off | Whole days, set by Bryan |
| Gap between calls | 0 minutes (Bryan can set one) |
| One call per company | Booking again moves the call |
| One company per time | Two companies can never get the same time. The second is told "Someone has just taken that time. Please pick another." |
| Taking calls | Bryan can switch the whole calendar off |

## 3. Bryan's side today (super admin → Call Calendar)

| Tab | What it does today |
|---|---|
| Bookings | A list grouped by day, in Bryan's time zone. Per call: Done, Missed, Cancel, add a note. |
| Availability | Weekly hours (several blocks a day), time zone, call length, gap between calls, minimum notice, days ahead, days off, the call link, his name, title and email, and a "Taking calls" switch. |

That is all. It has no search, no filters, no counts, no calendar view, no way to move a call, no way to book one for a company, and it does not show what time the call is for the customer.

There is a second, older page: Customer management → Onboarding calls. It lists every new company and whether it has booked, and can send a "book your call" email. Its "Open calendar" button still opens the old outside calendar. Point it at the Call Calendar.

## 4. What to build: the company's side

| # | Build | Detail |
|---|---|---|
| C1 | Time zone shown clearly | Every time on the calendar, the booked screen and the card names its zone, for example "3:00 PM, Karachi time". A "change" link lets the person pick another zone, for someone booking while travelling. |
| C2 | Remember the company's zone | Save the zone the person booked in with the booking. Emails are sent by the server, which cannot know the zone otherwise. Bryan sees it too. |
| C3 | Confirmation email | Section 6. |
| C4 | Move and cancel, complete | Both send an email. Cancel asks for an optional reason. After a cancel the card offers the call again. |
| C5 | From the email | The email's "Move or cancel" link opens the portal straight on the booked call, signed in or after signing in. |
| C6 | Reminders | One the day before, one an hour before. Never for a cancelled call. A call booked less than a day ahead gets only the one-hour reminder. |
| C7 | The call link | Shown on the booked screen, on the card and in every email. If Bryan has not set one, the booking must still work and say the link will follow by email. |
| C8 | After a missed call | The company gets one email offering to book again, and the card offers the call again. |
| C9 | A call whose time has passed | The card must not keep showing a past time as "booked". Decide the wording in the PRD: "Waiting for Bryan to confirm", then it clears when he marks it. |
| C10 | Add to calendar | Works on iPhone, Android and laptop, for Google, Apple and Outlook calendars. |
| C11 | Empty and closed states | No free times in the month. Bryan not taking calls. The calendar could not load. Each has a clear sentence and a way forward. |

> **Proposed rule. Confirm it with Ghulam in your PRD.** A company can move or cancel its call at any moment before it starts. A move must still respect the 12 hours' notice for the new time.

## 5. What to build: Bryan's side

Turn the Call Calendar into a page Bryan can run his day from.

### The bookings list

| # | Build | Detail |
|---|---|---|
| B1 | Counts at the top | Today, this week, waiting to be marked, missed this month. Same stat-card look as other super admin pages. |
| B2 | Filters | Upcoming (the default), Today, Needs marking, Done, Missed, Cancelled, All. A date range. Filters stay when the page is refreshed. |
| B3 | Search | By company name, person's name, email or phone. |
| B4 | Sort and pages | Soonest first for upcoming, newest first for past. Pages or "load more", so 500 bookings do not slow it down. |
| B5 | Each row | Company, person, the time in Bryan's zone, the time in the company's zone with the zone's name, status, who cancelled it. |
| B6 | Needs marking | A call whose time has passed and is still "booked" is listed here until Bryan marks it Done or Missed. |
| B7 | Live | A new booking, a move or a cancel appears without reloading the page. |

### One booking

| # | Build | Detail |
|---|---|---|
| B8 | Details dialog | Company (with a link to its page in super admin), person, email, phone, their note, both times, the call link, Bryan's own note, and the history: booked, moved, cancelled, by whom and when. |
| B9 | Done and Missed | As today. Missed starts the company's "book again" email (C8). |
| B10 | Cancel | Asks for a reason. The company is emailed. The time is free again. |
| B11 | Move | Bryan picks a new free time from his own calendar. The same rules apply as for a company, except notice: Bryan may move a call to a time sooner than 12 hours away. The company is emailed the new time in its own zone. |
| B12 | Book for a company | Bryan picks a company, a time, and the person's details. For when a company asks by phone or WhatsApp. The company is emailed. |
| B13 | Undo a mistake | A call marked Done or Missed by mistake can be put back. Putting a cancelled call back to booked must be refused if the time has been taken. |

### The calendar and its settings

| # | Build | Detail |
|---|---|---|
| B14 | Week view | A week at a glance: his hours, the booked calls, the days off. Click a call to open it. Previous and next week, and Today. |
| B15 | Block part of a day | Today Bryan can only take a whole day off. He needs to block a few hours ("dentist, 2 to 4"). Blocked hours are not offered to companies. |
| B16 | A change that hits a booked call | If Bryan takes a day off, shortens his hours or blocks time where calls are already booked, the page lists those calls before saving and asks what to do. They are never silently left or silently cancelled. |
| B17 | Time zone, shown | The page always says which zone it is showing. Changing Bryan's zone moves no booked call: a call is one fixed moment. |
| B18 | The call link | A warning on the page while no link is set. |
| B19 | The older tracker | Customer management → Onboarding calls: "Open calendar" opens the Call Calendar. |

Look and feel: the same as the other super admin pages. Dialogs, not side sheets. No browser pop-ups: use the admin's own confirm and prompt dialogs. Flat, no shadows. Super admin is used on a laptop, but it must not break on a phone.

## 6. The emails

| Email | To | When | What it carries |
|---|---|---|---|
| Call booked | Company | At once | The time in the company's zone, Join, Add to calendar, one line to move or cancel. A calendar invite. |
| New onboarding call | Bryan | At once | Company, person, contact, their note, the time in Bryan's zone and in theirs, Join, Open Call Calendar. A calendar invite. |
| Call moved | Both | On a move, by either side | The old time crossed out, the new time. An updated invite. |
| Call cancelled | Both | On a cancel, by either side | Who cancelled, the reason if given. A cancelling invite. For the company: a button to book again. |
| Reminder | Company | A day before, and an hour before | The time, Join. |
| We missed you | Company | When Bryan marks Missed | One line and a button to book again. |

| Rule | Detail |
|---|---|
| The look, already agreed | The logo and a white card together on one rounded light-purple panel (the shared email helper has this as `framed: true`). The confirmation is compact: a date tile, one line, Join and Add to calendar, one move-or-cancel line. No long scroll. |
| The invite | A real calendar invite with Bryan as the organiser and the company as the attendee, so Gmail and Outlook add it by themselves. Bryan uses Outlook. A move updates the same event; a cancel removes it. The shared email sender needs an attachments option for this. |
| Times in an email | Always in the reader's zone, with the zone's name written out. |
| Sent once | A retry or a double click never sends the same email twice. |
| Where Bryan's go | The email saved in the calendar's settings. |
| Voice | Short and plain. No emojis. |
| While testing | Only to your own addresses. Never to a real customer. |

Three "book your call" emails already exist and go out to new companies who have not booked (at signup, after a day, after two to three days). They are not yours to rewrite, but check they stop when a call is booked and behave sensibly after a cancel.

## 7. Time zones

### The rules

| # | Rule |
|---|---|
| 1 | A call is one fixed moment. It is stored once and shown to each person in their own zone. |
| 2 | Bryan's hours and days off are in Bryan's zone. |
| 3 | A company sees times in the zone of the device it books from, and can change it. |
| 4 | A time is never shown without its zone. |
| 5 | The same call must read the same time everywhere for the same person: the calendar, the booked screen, the sidebar card, the email, the invite. |
| 6 | The company's day and Bryan's day can be different dates. |
| 7 | When clocks change, a booked call does not move for the person whose clock did not change. |

### Worked examples: Bryan's first slot, 9:00 AM New York

In winter New York is 5 hours behind UTC, so 9:00 AM is 14:00 UTC.

| The company is in | Its time | Its date |
|---|---|---|
| Los Angeles | 6:00 AM | Same day |
| Honolulu | 4:00 AM | Same day |
| London | 2:00 PM | Same day |
| Dubai | 6:00 PM | Same day |
| Karachi | 7:00 PM | Same day |
| Sydney | 1:00 AM | **The next day** |

Bryan's last slot is 4:30 PM New York, which is 21:30 UTC: 2:30 AM the next day in Karachi, and 8:30 AM the next day in Sydney. A company in Karachi looking at its own Tuesday sees calls that are Bryan's Monday afternoon and Bryan's Tuesday morning.

### Worked examples: when the clocks change

| Date | What changes |
|---|---|
| Sunday 14 March 2027 | New York moves its clocks forward. 9:00 AM New York becomes 13:00 UTC. |
| Sunday 28 March 2027 | London moves its clocks forward. |
| Sunday 7 November 2027 | New York moves its clocks back. |

| Bryan's 9:00 AM on | London | Karachi |
|---|---|---|
| Wednesday 10 March 2027 | 2:00 PM | 7:00 PM |
| Wednesday 17 March 2027 | 1:00 PM | 6:00 PM |
| Wednesday 31 March 2027 | 2:00 PM | 6:00 PM |

For two weeks in March, London is 4 hours ahead of New York, not 5. Karachi never changes its clocks, so its time for the same slot moves by an hour for good. A company that booked 9:00 AM New York on 17 March while it was still February must be shown 1:00 PM London, not 2:00 PM.

On 14 March 2027 the hour from 2:00 to 3:00 AM does not exist in New York, and on 7 November the hour from 1:00 to 2:00 AM happens twice. Bryan does not work then, but his hours can be set to anything, so prove that odd hours on those days neither crash nor offer a time that does not exist.

### How to test time zones

- The times are worked out in two places: in the browser (to show them) and in the database (to check a booking). Give both the same cases and prove they agree.
- The browser side takes "now" as an input, so an eval can stand in March 2027 without waiting.
- Calls can only be booked 30 days ahead, so a real booking cannot reach March. Prove the clock-change cases on the calculation itself, and say so in the QA report as a gap.
- By hand: change your phone's and laptop's time zone to Karachi, London, Los Angeles and Sydney, and book in each. The times must match this section.

## 8. What is done, what is not, what I suspect

### Done

| Thing | State |
|---|---|
| The portal's calendar, booking, move and cancel | Live. One real booking so far. |
| The sidebar card and its checklist | Live. |
| Bryan's bookings list and availability settings | Live. |
| The server rules in section 2 | Live. |
| The "book your call" emails | Live. |

### Not done

| Thing | Detail |
|---|---|
| Every email in section 6 | None exists for our own calendar. Today the company and Bryan are told nothing. |
| Reminders and the missed-call follow-up | Not built. |
| The company's time zone on a booking | Not saved, not shown to Bryan. |
| Bryan: search, filters, counts, week view, move, book for a company, block hours | Not built. |
| The call link | Not set on production. |
| PRD, specs, evals, QA report | None for this feature. |
| Staging | Staging has no calendar settings at all, so the calendar cannot open there. Add them first (section 11). |

### Things I suspect are wrong

These come from reading the code, not from testing. Check each one. If it is real, fix it and write it in your report. If it is not, write why.

| # | Suspicion | Why |
|---|---|---|
| 1 | Anyone on a company's team can book, move or cancel, not only owners. | "Owners only" is decided on the screen. The server accepts any signed-in member of the company. |
| 2 | The server accepts a time such as 9:07. | It checks the time is inside Bryan's hours, not that it is one of the offered times. |
| 3 | The card and the calendar can show different times for the same call. | The card uses the company's saved zone; the calendar uses the device's zone. |
| 4 | A past call that Bryan never marks stays "booked" for ever. | The company then cannot book a fresh call; it can only "move" an old one. |
| 5 | Putting a call back to "booked" can collide with another call. | That path does not check the time is still free. |
| 6 | A day off does nothing to calls already booked that day. | They stay, and nobody is told. |
| 7 | "Add to calendar" may do nothing on an iPhone. | The file is offered in a way Safari often refuses. |
| 8 | The two calculators can disagree. | Browser and database each work the times out on their own. |
| 9 | After a cancel, the "book your call" emails may start again, or never. | Cancelling clears the booked state the emails look at. |
| 10 | The card disappears while a call is still booked. | The offer ends after 30 days or when the trial ends. Check a company that booked on day 29. |
| 11 | A changed call length breaks existing bookings. | Bryan changes 30 minutes to 45 while calls are booked at 30. |

## 9. What evals must prove

Scripts, on staging. They never open a browser and never email a real person. One check per numbered statement in your specs.

| Area | Must be proved |
|---|---|
| **Booking rules** | A good booking is saved. Each refusal with its exact message: too soon, too far ahead, a day off, blocked hours, outside his hours, across midnight, Bryan not taking calls, a time that is not an offered time, not eligible, not signed in. |
| **Two at once** | Two companies book the same time at the same moment: exactly one wins. With a gap set, a neighbouring time is refused too. |
| **Move** | The old time is free, the new one held, still one live call for the company. By the company and by Bryan. |
| **Cancel** | By the company and by Bryan. The time is free. Who cancelled and why is recorded. |
| **Who may do what** | A company cannot read another company's booking, name or note. Only owners can book, move, cancel. Only a super admin can read all bookings, change settings, or act on a booking. A visitor with no login gets nothing. |
| **Status** | Done, Missed, back again. Each updates the company's card state. Putting back a cancelled call into a taken time is refused. |
| **Settings** | A bad time zone, hours that end before they start, and values out of range are refused. A change that hits booked calls is reported, not applied silently. |
| **Time zones** | Every row of section 7, against both calculators. The clock-change dates. The date changing between zones. |
| **Emails** | Each email is built for the right person with the right time in the right zone, and the invite is valid. Each is sent once. A cancelled call gets no reminder. (Built and checked, not delivered.) |
| **Reminders** | Due a day before and an hour before; a late booking gets only the second; a moved call's reminders follow the new time. |
| **The list** | Each filter, the search and the paging return the right calls, including "Needs marking". |

## 10. What you check by hand

The QA report. On your `ray3` sites, never on localhost. On a real iPhone, a real Android phone and a laptop.

### Definitely, every one of these

| # | Check |
|---|---|
| 1 | Book a call from start to finish on an iPhone, an Android phone and a laptop. |
| 2 | Book with the device set to Karachi, London, Los Angeles and Sydney. The time matches section 7 on the calendar, the booked screen, the card, the email and the invite. |
| 3 | The confirmation email arrives in Gmail and in Outlook, reads well on a phone, and the invite appears in the calendar by itself. |
| 4 | Bryan's email arrives and his Outlook calendar shows the call. |
| 5 | Move the call as the company. Both calendars update, both get the email. |
| 6 | Cancel as the company. Both calendars lose it, both get the email, the card offers the call again. |
| 7 | Bryan moves a call. The company's card, email and invite show the new time in the company's zone. |
| 8 | Bryan cancels a call with a reason. The company is told. |
| 9 | Bryan books a call for a company. The company's portal shows it. |
| 10 | Two browsers, two companies, the same time: the second is asked to pick again, kindly. |
| 11 | Bryan takes a day off that has a booked call: the page lists it and asks. |
| 12 | Bryan blocks 2 to 4 PM: those times vanish from the company's calendar. |
| 13 | Bryan switches "Taking calls" off: the company sees a clear sentence, not an empty calendar. |
| 14 | Each filter, the search and the week view on Bryan's page, with at least 30 bookings in it. |
| 15 | Both reminders arrive at the right times. Shorten the wait on staging to test, then put it back. |
| 16 | Bryan marks a call Missed: the company gets the email and can book again. Marks one Done: the card goes away. |
| 17 | The email's links open the portal in the right place, signed in and signed out. |
| 18 | "Add to calendar" on iPhone, Android and laptop. |
| 19 | A team member who is not an owner does not see the card and cannot book. |
| 20 | Every screen at 360 and 430 wide, in light and dark. Nothing cut off, the keyboard never hides the button. |

### Also

A slow connection. A very long note and a very long company name. The collapsed sidebar. Opening the calendar from the quick tour. Leaving the dialog half way and coming back. Read every new sentence the product says, out loud.

## 11. Before you start

| Thing | What to do |
|---|---|
| Read | `docs/onboarding/`, all three pages. Then resync. |
| Your branch and sites | `ray3`. `northwind.portal.ray3.drive-247.com` for the company's side, `admin.ray3.drive-247.com` for Bryan's. |
| Staging has no calendar | Add the calendar's settings to staging first, with the same values production has (section 2). Say so in the group. |
| A second company | You need two companies to test a clash. Northwind is one. Make a second with a test signup on staging. |
| Emails | Use your own addresses for the company and for Bryan while testing. Use a real Outlook address for Bryan's side. |
| The reminder job | Timed jobs are switched off on staging. Run yours by hand to test it. Do not switch the timers on. |
| Database and functions | You will change both. Staging only, and say so in the group first. |

## 12. The demo, in Supercut

When everything is built and checked, record one Supercut video that shows the whole feature working on your `ray3` sites. Ghulam watches it before he opens the pull request. If something is not in the video, it is treated as not done.

| Rule | Detail |
|---|---|
| Real sites | Your `ray3` sites, not localhost. |
| Talk through it | Say what you are about to do, do it, say what happened. |
| Two windows | Keep the portal and super admin side by side when one side should react to the other. |
| The phone | Show the company's side on a real phone, or the phone's own screen recording, not only a narrow browser window. |
| The emails | Open each one in the inbox and open the calendar to show the invite. |
| One take per part is fine | Several short videos in order are better than one long one that drifts. |

### The scenes, in this order

| # | Scene | Show |
|---|---|---|
| 1 | The offer | The card in the sidebar, as an owner. Then as a team member: no card. |
| 2 | Book, on a phone | Open the calendar, pick a day and a time, fill the details, the booked screen. Point at the time zone. |
| 3 | The emails | The company's confirmation and Bryan's notice, both inboxes, both calendars. |
| 4 | Bryan sees it | The Call Calendar: the new call in the list and in the week view, with both times. Open its details. |
| 5 | Time zones | Change the device to Karachi, then Sydney. The same call, the right time each time, and the date changing. |
| 6 | Move, by the company | The card, Move the call, a new time. Bryan's page updates on its own. Both emails. |
| 7 | Cancel, by the company | Cancel with a reason. The time is free again on the calendar. Both emails. The card offers the call again. |
| 8 | A clash | Two companies, two windows, the same time. The second is asked to pick again. |
| 9 | Bryan books for a company | From super admin. It appears in that company's portal. |
| 10 | Bryan moves and cancels | Move one call, cancel another with a reason. The company's card and emails. |
| 11 | Bryan's list | Each filter, the search, the counts, "Needs marking". |
| 12 | Bryan's settings | Change his hours, block 2 to 4 PM, take a day off that has a call (the warning), switch "Taking calls" off. Show the company's calendar after each. |
| 13 | Reminders | Both reminder emails. |
| 14 | Done and Missed | Mark one of each. The card going away, and the "book again" email. |
| 15 | The refusals | Too soon, too far ahead, a day off: what the company is told. |
| 16 | The evals | Run `npm run eval` for your feature and show the last line. |

## 13. What to hand in

| Document | Detail |
|---|---|
| PRD | One section in the one PRD: the stories for the company and for Bryan, every rule, every refusal. Plain business language. |
| Specs | One per part. Suggested: the data; the booking rules; time zones and the two calculators; move and cancel; Bryan's actions; the emails and invites; reminders; the portal screens; the super admin page. |
| Evals | One per spec. Section 9 is the minimum. |
| QA report | Section 10 is the minimum. |
| Findings | Each of the 11 suspicions: real or not, and what you did. |
| The Supercut demo | Section 12. The link goes in the pull request. |
| Pull request | From `ray3`, with all of the above. Say so in the group. |

**Finished means:** every statement proved, every QA item ticked, every suspicion answered, and every scene in the demo.

## 14. The rules, and what is not yours

| Rule | Detail |
|---|---|
| Never | Book, move or cancel a call on production. Never email a real customer. Never change Bryan's real settings. |
| One place per rule | The booking rules and the wording live in one place that every screen and function uses. |
| Existing bookings | Production has a real booking. Your database change must keep it intact. |
| Things outside this task | Write them down for Ghulam. |

> - The call step at the end of signup on drive-247.com.
> - The call offer inside the cancel-subscription flow. It is a different call.
> - Connecting Bryan's Google or Outlook diary so his other meetings block times. A later step; B15 covers it by hand for now.
> - The quick tour and the tab tours. Your earlier work on them is waiting to be merged; do not build on top of it here.
> - Rewriting the three "book your call" emails.

## 15. Where to look

| What | Where |
|---|---|
| Tables and server rules | `supabase/migrations/20261123180000_onboarding_call_calendar.sql` |
| The company's call state | `supabase/migrations/20261101130000_tenant_onboarding_calls.sql` |
| Times in the browser | `apps/portal/src/lib/onboarding-call-slots.ts` |
| Portal data | `apps/portal/src/hooks/use-onboarding-call-calendar.ts`, `use-onboarding-call.ts`, `use-first-steps.ts` |
| Portal screens | `apps/portal/src/components/onboarding/onboarding-call-booking.tsx`, `onboarding-call-sidebar.tsx`, `components/dashboard-v2/onboarding-call-card.tsx` (the checklist) |
| Bryan's page | `apps/admin/components/admin/call-calendar/call-calendar-page.tsx` |
| The older tracker | `apps/admin/components/admin/customer-management/onboarding-calls-tab.tsx` |
| Emails | `supabase/functions/_shared/drive247-email.ts`, `_shared/resend-service.ts`, `_shared/onboarding-call-journey.ts`, `onboarding-call-reminder` |
| The old outside calendar | `supabase/functions/onboarding-call-booked`. Read it to understand the history. Do not build on it. |
