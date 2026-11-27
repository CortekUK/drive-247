# Drive247 PRD

What every feature of Drive247 does, in plain language. One section per feature.

This file is the source for `PRD.pdf`. It is edited only through the `prd` skill, and the PDF is
rebuilt from it with `node scripts/build-prd.mjs`. How a feature is built is in its specs, in the
feature's folder.

## Features

| No. | Feature | Status | In one line |
|---|---|---|---|
| 001 | Onboarding call with Bryan, and his Call Calendar | Being built | A new company books, moves and cancels its free call with Bryan inside the portal, and Bryan runs all his calls from super admin. |

## feat-001 · Onboarding call with Bryan, and his Call Calendar

**Status:** Being built · **Built by:** Hamna · **Folder:** `feat-001-call-booking`

### In one line

Every new company can book one free 30-minute call with Bryan, our onboarding specialist, from inside its portal, and Bryan runs all of these calls, and his own hours, from one page in super admin.

### Why we have it

A new company that talks to a person in its first days gets set up faster and is more likely to stay. Bryan gives that call. Before this, the company booked through an outside calendar, nobody was emailed, and Bryan had a plain list with no way to move a call, book one for someone, or see what time it was for the customer. Our companies are all over the world and Bryan is in New York, so a wrong hour means a missed call. This feature makes the call something a company can book in under a minute on its phone, and something Bryan can run his day from.

### Who it is for

- **A company owner**: the person who signed the company up and runs its portal. Only owners are offered the call.
- **A team member**: someone else on the company's portal. They are not offered the call.
- **Bryan**: our onboarding specialist, in New York. He runs the calls and sets his hours.
- **Our team (Ghulam)**: who want to see that calls are booked and held.

### What happens

**The company's side**

1. **A new company owner sees the offer.** At the bottom of the portal's sidebar is a small card with Bryan's photo: "Free onboarding call, with Bryan, 30 minutes". It is shown in the company's first 30 days or while it is on a free trial. A team member who is not an owner never sees it.
2. **The owner opens the calendar.** From the card, from the quick tour's "Book onboarding call" button, or from a link in one of our emails. They see a month with the free days marked. Every time is shown in their own time, with the name of the zone written beside it, for example "7:00 PM, Karachi time".
3. **The owner is travelling.** They tap "change" beside the time zone and pick another one. Every time on the page changes to match.
4. **The owner picks a time.** They choose a day, then a time, then fill in their name, email, phone and a note for Bryan. They press Book.
5. **The call is booked.** They see the time in their zone, the link to join the call, and "Add to calendar", which works for Google, Apple and Outlook calendars on an iPhone, an Android phone and a laptop. If Bryan has not set a call link yet, the screen says the link will follow by email.
6. **The owner gets a confirmation email.** It shows the date and time in their zone, a Join button, an Add to calendar button and one line to move or cancel. It carries a calendar invite, so Gmail and Outlook add the call to their calendar by themselves.
7. **Bryan gets an email too.** It says which company, who is coming, how to reach them, their note, and the time in Bryan's zone and in theirs, with a button to open his Call Calendar. His Outlook calendar gets the call by itself.
8. **The owner comes back to the portal.** The card now says "Onboarding call booked" with the time in their zone, a short checklist to get ready (add a vehicle, upload a logo, preview the website), and two buttons: Move the call and Cancel it.
9. **The owner moves the call.** The calendar opens again. They pick a new time. The old time is freed. They and Bryan both get an email with the old time crossed out and the new one, and the calendar invite updates to the new time.
10. **The owner cancels the call.** They are asked once if they are sure, and may give a reason. The time is freed. They and Bryan both get an email saying who cancelled and why, and the call leaves both calendars. The card offers the call again.
11. **The owner opens "Move or cancel" from the email.** The portal opens straight on their booked call. If they are signed out, they sign in first and then land on it.
12. **A day before the call, and an hour before**, the owner gets a short reminder with the time and the Join link. A call booked less than a day ahead only gets the one-hour reminder. A cancelled call gets no reminder. A moved call's reminders follow the new time.
13. **Two companies pick the same time at the same moment.** One gets it. The other is told "Someone has just taken that time. Please pick another." and picks again. Two companies can never hold the same time.
14. **The call's time has passed and Bryan has not marked it yet.** The card no longer says the call is booked for a time in the past. It says "Waiting for Bryan to confirm your call". It clears as soon as Bryan marks it.
15. **Bryan marks the call done.** The card goes away for good.
16. **Bryan marks the call missed.** The owner gets one email, "Sorry we missed you", with a button to book again, and the card offers the call again.
17. **There are no free times this month.** The calendar says so and lets the owner look at the next month.
18. **Bryan is not taking calls right now.** The calendar says so in a plain sentence instead of showing an empty month.
19. **The calendar could not load.** It says so and offers to try again.

**Bryan's side**

20. **Bryan opens his Call Calendar in super admin.** At the top he sees four counts: calls today, calls this week, calls waiting to be marked, and missed this month. Below is the list of calls, the soonest first. The page always says which time zone it is showing.
21. **Bryan reads a row.** Each call shows the company, the person, the time in his zone, the time in the company's zone with the zone's name, its state, and who cancelled it if it was cancelled.
22. **Bryan filters and searches.** He can show Upcoming (the default), Today, Needs marking, Done, Missed, Cancelled or All, pick a date range, and search by company, person, email or phone. His choice stays when he refreshes the page. A long list loads in pages, so it stays fast.
23. **A company books, moves or cancels while Bryan has the page open.** The list and the counts change by themselves. He does not reload.
24. **Bryan opens one call.** He sees the company (with a link to its page in super admin), the person, their email, phone and note, both times, the call link, his own note, and the history: booked, moved, cancelled, by whom and when.
25. **Bryan marks a call done or missed.** Missed sends the company the "Sorry we missed you" email.
26. **Bryan marks one by mistake.** He can put it back. Putting a cancelled call back is refused if that time now belongs to someone else.
27. **Bryan cancels a call.** He gives a reason. The company is emailed and the time is free again.
28. **Bryan moves a call.** He picks a new free time from his own calendar. The same rules apply as for a company, except that Bryan may move a call to less than 12 hours away. The company is emailed the new time in its own zone.
29. **A company asks Bryan for a call by phone or WhatsApp.** Bryan books it for them: he picks the company, a time, and the person's details. The company is emailed, and the call shows on its portal card as if they had booked it.
30. **Bryan looks at his week.** A week view shows his hours, the booked calls and his days off. He can go back and forward a week, or jump to today, and click a call to open it.
31. **Bryan sets his hours.** He sets his weekly hours (more than one block a day if he likes), his time zone, the call length, a gap between calls, how much notice he needs, how far ahead companies can book, and his name, title, email and call link. A switch turns the whole calendar off.
32. **Bryan has the dentist.** He blocks part of a day, for example 2 to 4 PM. Those times are no longer offered to companies.
33. **Bryan takes a day off, shortens his hours or blocks time where calls are already booked.** Before saving, the page lists those calls and asks what to do with each. Nothing is left in place or cancelled without him choosing.
34. **Bryan has not set a call link.** The page shows a warning until he does.
35. **Bryan changes his own time zone.** No booked call moves. A call is one fixed moment; only how it is written changes.
36. **Bryan opens the older tracker** (Customer management, Onboarding calls). Its "Open calendar" button takes him to the Call Calendar.

### The rules

**Who and when**

- The call is offered to a company on the new portal in its first 30 days or on a free trial. The Northwind demo company always has it, so our team can see it.
- Only an owner can book, move or cancel. This is checked by our system, not only hidden on the screen.
- One live call per company. Booking again moves the call.
- One company per time. The second company to pick a time is told "Someone has just taken that time. Please pick another."
- The card goes away when Bryan marks the call done, or when the owner hides it.

**Bryan's calendar**

| Rule | Today's value |
|---|---|
| Call length | 30 minutes |
| Bryan's hours | Monday to Friday, 9:00 AM to 5:00 PM, New York time |
| Notice | At least 12 hours ahead |
| How far ahead | Up to 30 days |
| Days off and blocked hours | Set by Bryan |
| Gap between calls | None (Bryan can set one) |
| Taking calls | On (Bryan can switch it off) |

- Only the times the calendar offers can be booked. A time such as 9:07 is refused.
- A company sees what it is told when it is refused: too soon, too far ahead, Bryan is not available then, someone has just taken that time, Bryan is not taking calls right now.
- Changing the call length does not change calls already booked.

**Time**

- A call is one fixed moment. Each person sees it in their own zone.
- Bryan's hours and days off are in his zone.
- A time is never shown without the name of its zone.
- The same call reads the same time everywhere for the same person: the calendar, the booked screen, the card, the emails and the invite.
- The company's date and Bryan's date can be different. Bryan's 4:30 PM on a Monday is 2:30 AM on Tuesday in Karachi.
- When the clocks change in one place, a booked call does not move for the person whose clock did not change.

Bryan's 9:00 AM in New York, in winter:

| The company is in | Its time | Its date |
|---|---|---|
| Los Angeles | 6:00 AM | Same day |
| London | 2:00 PM | Same day |
| Dubai | 6:00 PM | Same day |
| Karachi | 7:00 PM | Same day |
| Sydney | 1:00 AM | The next day |

New York moves its clocks forward on 14 March 2027 and London on 28 March 2027. For those two weeks Bryan's 9:00 AM is 1:00 PM in London, not 2:00 PM.

**Emails**

| Email | To | When |
|---|---|---|
| Call booked | Company, and Bryan | At once |
| Call moved | Company and Bryan | On a move, by either side |
| Call cancelled | Company and Bryan | On a cancel, by either side |
| Reminder | Company | A day before, and an hour before |
| Sorry we missed you | Company | When Bryan marks a call missed |

- Every email gives times in the reader's zone with the zone's name.
- The booked, moved and cancelled emails carry a calendar invite with Bryan as the organiser. A move updates the same event and a cancel removes it.
- The same email is never sent twice, even if a button is pressed twice.
- The emails are short and plain, with no emojis.

**Not decided yet (to confirm with Ghulam)**

- A company can move or cancel its call at any time before it starts. A move must still give 12 hours' notice for the new time.
- "Owner" means the head admin and the admins of the company, as the card does today.
- A company that has a call booked keeps the card until the call is done, even if its 30 days or its trial end in between.
- When the call's time has passed and Bryan has not marked it, the owner can book a new time from the card. The old call is then recorded as missed.
- When a change of hours hits booked calls, Bryan chooses for each one: keep it, or cancel it and email the company to book again.
- Bryan must give a reason to cancel. A company may give one.
- After a cancel, the three "book your call" emails do not start again. The cancel email carries its own button to book again.
- A company can book again after a missed call as many times as it likes while the call is offered to it.
- Bryan gets no reminder emails. His Outlook calendar reminds him.

### What it does not do

- It is not the call step at the end of signup on drive-247.com. That is a separate feature.
- It is not the call offered when a company cancels its subscription. That is a different call.
- It does not read Bryan's Outlook or Google diary. His other meetings do not block times by themselves; he blocks them by hand.
- It does not send text messages, only emails.
- It does not let a team member who is not an owner book.
- It does not change the three "book your call" emails, only checks that they stop once a call is booked.
- It does not offer more than one host. Every call is with Bryan.

### How we know it is working

- Bryan's counts: calls today, this week, waiting to be marked, missed this month.
- Bryan's list filtered to Done shows how many calls were held, and Missed how many were not.
- The older tracker shows, for every new company, whether it has booked.
- Ghulam can open the Call Calendar at any time and see the same numbers Bryan sees.
