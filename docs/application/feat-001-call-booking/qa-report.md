# QA report · feat-001 · Onboarding call with Bryan, and his Call Calendar

**Checked by:** Hamna · **Status:** 0 of 52 checked · **Evals:** see `evals/RESULTS.md`

| Part | Where | Checked |
|---|---|---|
| 1. Full check | `northwind.portal.ray3.drive-247.com` and `admin.ray3.drive-247.com` | 0 of 48 |
| 2. Staging look | `northwind.portal.staging.drive-247.com` and `admin.staging.drive-247.com` | 0 of 2 |
| 3. Production check | northwind, live (look only, never book) | 0 of 2 |

## Before you start

| | |
|---|---|
| Company login | The northwind staging login (`STAGING_LOGIN_EMAIL` in `.staging-credentials.local`). |
| A second company | Make one with a test signup on staging, with your own email. You need it for items 13, 19 and 47. |
| Bryan's login | The super admin staging login (`STAGING_ADMIN_EMAIL`). |
| Your test addresses | Tell Claude a Gmail address and an Outlook address you can open. Claude puts them on staging's test list (`ONBOARDING_CALL_ONLY_TO`) and sets the staging calendar's host email to the Outlook one. Any other address is skipped, so no real company is emailed. |
| When booking | Always type one of your own two addresses as the email. |
| Devices | A real iPhone, a real Android phone and a laptop. To change a device's zone: iPhone Settings, General, Date & Time, switch off "Set automatically", pick a city. Android: Settings, System, Date & time. Laptop: the system clock settings. |
| Reminders | Timed jobs are off on staging. When an item needs the reminder job, ask Claude to run it once by hand. |
| Never | Book, move or cancel on production. Change Bryan's real settings. Use a customer's email. |

The times to expect, worked by hand (spec 03): Bryan's 9:00 AM New York on Tuesday 8 December 2026 is
6:00 AM Los Angeles, 2:00 PM London, 7:00 PM Karachi, and 1:00 AM **Wednesday** 9 December in Sydney.
New York is UTC minus 5 in December.

## Part 1 · Full check

### The company's side

### 1. The card is offered to a new owner

- **Why by hand:** PRD story 1, spec 09.1 (a screen).
- **Do:** 1. Sign in to `northwind.portal.ray3.drive-247.com` as the northwind owner. 2. Look at the bottom of the sidebar.
- **You should see:** a small card with Bryan's photo: "Free onboarding call, with Bryan, 30 minutes". Collapse the sidebar: a round photo stays, and its tooltip says "Free onboarding call with Bryan".
- **How to be sure:** sign in as your second company's owner too: the card is there as well.
- [ ] Checked

### 2. The calendar opens from the card

- **Why by hand:** PRD story 2, spec 09.6.
- **Do:** press the card.
- **You should see:** a dialog with Bryan's panel on the left (photo, name, 30 minutes), a month with the days that have free times marked, and the times of the chosen day. A line says "Times are in Karachi time · change" (or your device's city).
- **How to be sure:** the first free day is at least 12 hours from now and no day is more than 30 days ahead.
- [ ] Checked

### 3. The calendar opens from the quick tour

- **Why by hand:** PRD story 2.
- **Do:** start the quick tour and press its "Book onboarding call" button.
- **You should see:** the same calendar as item 2.
- [ ] Checked

### 4. The times match the device's zone (Karachi)

- **Why by hand:** spec 03.3, 03.9 (needs a real device and its zone).
- **Do:** 1. Set the laptop's zone to Karachi. 2. Open the calendar on a Tuesday in December.
- **You should see:** the first time of the day is 7:00 PM, and the heading says "Tue 8 Dec · Karachi time". Bryan's Monday 4:30 PM shows on Tuesday as 2:30 AM.
- **How to be sure:** work it out: New York is UTC minus 5, Karachi UTC plus 5, so 10 hours ahead. 9:00 AM plus 10 hours is 7:00 PM.
- [ ] Checked

### 5. The times match London, Los Angeles and Sydney

- **Why by hand:** brief section 10 item 2, spec 03.9.
- **Do:** repeat item 4 with the device set to London, then Los Angeles, then Sydney.
- **You should see:** Bryan's 9:00 AM Tuesday reads 2:00 PM Tuesday (London), 6:00 AM Tuesday (Los Angeles), 1:00 AM **Wednesday** (Sydney).
- **How to be sure:** write the three times down and compare with the table at the top.
- [ ] Checked

### 6. "change" picks another zone, everywhere

- **Why by hand:** PRD story 3, spec 03.4 and 03.8.
- **Do:** 1. Press "change" and pick Los Angeles. 2. Close the calendar and look at the sidebar card. 3. Reload the page and open the calendar again.
- **You should see:** every time on the page moves to Los Angeles time at once. After a reload it still says Los Angeles.
- **How to be sure:** after booking (item 7) the card and the booked screen also give the Los Angeles time.
- [ ] Checked

### 7. Book a call on a laptop

- **Why by hand:** PRD story 4, brief item 1.
- **Do:** pick a day and a time, fill in your name, your Gmail address, a phone and a note, press Book.
- **You should see:** the booked screen: the time in your zone with the city named, the call link (or "Bryan will send you the call link by email before the call." if none is set), and "Add to calendar".
- [ ] Checked

### 8. Book a call on an iPhone

- **Why by hand:** brief item 1. Cancel the laptop call first (item 15) so the company is free to book.
- **Do:** the same as item 7, on the iPhone in Safari.
- **You should see:** the same. The keyboard never covers the Book button.
- [ ] Checked

### 9. Book a call on an Android phone

- **Why by hand:** brief item 1.
- **Do:** the same as item 7, on the Android phone in Chrome.
- **You should see:** the same.
- [ ] Checked

### 10. "Add to calendar" on an iPhone

- **Why by hand:** brief item 18, suspicion 7 (Safari refused the old way).
- **Do:** on the booked screen press "Add to calendar", then "Apple or other".
- **You should see:** iPhone Calendar opens the event with the right time and "Drive247 onboarding call with Bryan Diaz".
- **How to be sure:** add it, open the iPhone Calendar app, and find the event on the right day.
- [ ] Checked

### 11. "Add to calendar" on Android and on a laptop

- **Why by hand:** brief item 18.
- **Do:** press "Add to calendar", then Google. On the laptop also try Outlook.
- **You should see:** Google Calendar (and Outlook) opens a new event filled in with the right time.
- [ ] Checked

### 12. The confirmation email in Gmail

- **Why by hand:** PRD story 6, brief item 3. The eval builds it but does not open it in a mail app.
- **Do:** open the email sent to your Gmail after booking, on your phone.
- **You should see:** subject "Your onboarding call with Bryan: Tue 8 Dec, 7:00 PM Karachi time" (your day and time). The date tile, the time with the city, Join the call, Add to calendar, "Move or cancel your call". It reads well on the phone.
- **How to be sure:** the invite is attached and Gmail shows the event card with Yes, Maybe, No.
- [ ] Checked

### 13. The confirmation email in Outlook

- **Why by hand:** brief item 3.
- **Do:** book once with your Outlook address, from your second company.
- **You should see:** the same email, and the call appears in your Outlook calendar by itself.
- [ ] Checked

### 14. Bryan's email, and his Outlook calendar

- **Why by hand:** PRD story 7, brief item 4.
- **Do:** open the email sent to the staging host email (your Outlook address).
- **You should see:** "New onboarding call: Northwind, Tue 8 Dec, 9:00 AM New York time". The company, the person, the email, the phone, the note, both times ("for them" in the company's zone), Join, Open Call Calendar. The call is in the Outlook calendar.
- **How to be sure:** "Open Call Calendar" opens `admin.ray3.drive-247.com/admin/call-calendar`.
- [ ] Checked

### 15. The card after booking

- **Why by hand:** PRD story 8, spec 09.2 and 09.3.
- **Do:** close the calendar and look at the sidebar card. Press it.
- **You should see:** "Onboarding call booked" and the time in your zone. The dialog shows the full time, the call link or its sentence, Add to calendar, the short checklist (add a vehicle, upload a logo, preview the website), "Move the call" and "Cancel it".
- [ ] Checked

### 16. Move the call as the company

- **Why by hand:** PRD story 9, brief item 5.
- **Do:** press "Move the call", pick a new time, book.
- **You should see:** the new time on the card. You and Bryan both get "Your onboarding call has moved to ..." with the old time struck through.
- **How to be sure:** both calendars (Gmail and Outlook) show the call at the new time only, not twice.
- [ ] Checked

### 17. Cancel the call as the company

- **Why by hand:** PRD story 10, brief item 6.
- **Do:** press "Cancel it", type a reason in "Reason (optional)", confirm.
- **You should see:** "Your call is cancelled". The card offers the call again. You get "Your onboarding call is cancelled" with "You cancelled your call." and a Book a new time button. Bryan gets "Onboarding call cancelled: Northwind" with the reason.
- **How to be sure:** both calendars lose the event.
- [ ] Checked

### 18. "Move or cancel" from the email, signed in and signed out

- **Why by hand:** PRD story 11, brief item 17, spec 09.19 and 09.20.
- **Do:** 1. Book a call. 2. In the email press "Move or cancel your call". 3. Sign out of the portal and press it again.
- **You should see:** the portal opens straight on your booked call. Signed out, it asks you to sign in first and then opens the call.
- [ ] Checked

### 19. Two companies, the same time

- **Why by hand:** PRD story 13, brief item 10.
- **Do:** open the calendar as northwind in one browser and as your second company in another. Pick the same time in both. Press Book in both, as close together as you can.
- **You should see:** one is booked. The other says "Someone has just taken that time. Please pick another." and stays on the calendar with that time gone.
- [ ] Checked

### 20. A call whose time has passed

- **Why by hand:** PRD story 14, spec 09.4.
- **Do:** ask Claude to move your booked call 10 minutes into the past on staging. Reload the portal.
- **You should see:** the card says "Waiting for Bryan to confirm". Pressed, it says "Your call was for ... Bryan will mark it shortly." with "Book a new time".
- **How to be sure:** book a new time from there: it works, and Bryan's page shows the old call as Missed.
- [ ] Checked

### 21. A team member who is not an owner

- **Why by hand:** brief item 19, spec 09.5.
- **Do:** sign in as a team member (role ops or viewer) of a company.
- **You should see:** no call card. Opening `?book-call=1` shows nothing to book.
- [ ] Checked

### 22. No free times this month

- **Why by hand:** PRD story 17, spec 09.10.
- **Do:** ask Claude to block the rest of this month on staging. Open the calendar.
- **You should see:** a sentence that there are no free times this month, and the next month can be opened.
- [ ] Checked

### 23. Bryan not taking calls

- **Why by hand:** PRD story 18, brief item 13.
- **Do:** in super admin switch "Taking calls" off and save. Open the portal calendar.
- **You should see:** a plain sentence that Bryan is not taking new calls right now, not an empty month. Switch it back on after.
- [ ] Checked

### 24. The calendar could not load

- **Why by hand:** PRD story 19.
- **Do:** open the calendar, then switch the laptop's Wi-Fi off and open it again.
- **You should see:** a message that it could not load and a Try again button that works once Wi-Fi is back.
- [ ] Checked

### 25. Reminders arrive at the right times

- **Why by hand:** PRD story 12, brief item 15. The eval proves when a reminder is due, not that it arrives.
- **Do:** book a call about 2 hours ahead. Ask Claude to move it to 50 minutes from now and to run the reminder job.
- **You should see:** "In one hour: your onboarding call with Bryan", with the time and Join. Then ask Claude to put a call 23 hours ahead that was booked yesterday and run the job: "Tomorrow: your onboarding call with Bryan".
- [ ] Checked

### Bryan's side

### 26. The Call Calendar page and its counts

- **Why by hand:** PRD story 20, spec 10.
- **Do:** sign in to `admin.ray3.drive-247.com` as the super admin. Open Call Calendar.
- **You should see:** "Times in New York time", the four counts (Today, This week, Needs marking, Missed this month) and the list of upcoming calls.
- **How to be sure:** count the calls on the list by hand and compare with the cards.
- [ ] Checked

### 27. A row says everything

- **Why by hand:** PRD story 21.
- **Do:** read the row of your Karachi booking.
- **You should see:** the company, the person, 9:00 AM New York style time, 7:00 PM Karachi time beside it, its state, and for a cancelled one who cancelled.
- [ ] Checked

### 28. Filters, search and paging with 30 calls

- **Why by hand:** PRD story 22, brief item 14.
- **Do:** ask Claude to add 30 test calls on staging. Try every filter (Upcoming, Today, Needs marking, Done, Missed, Cancelled, All), a date range, a search by company, by person, by email, by phone, and Load more.
- **You should see:** each shows only the right calls. Load more brings the next ones.
- [ ] Checked

### 29. The page updates by itself

- **Why by hand:** PRD story 23. No eval opens a browser.
- **Do:** keep the Call Calendar open on the laptop. Book, then cancel, from the phone.
- **You should see:** the list and the counts change without reloading.
- [ ] Checked

### 30. One call's details

- **Why by hand:** PRD story 24.
- **Do:** open a call.
- **You should see:** the company linked to its super admin page, the person, email, phone, note, both times, the call link, Bryan's note box, and the history in order (booked, moved, cancelled, with who).
- [ ] Checked

### 31. Mark a call done

- **Why by hand:** PRD stories 15 and 25, brief item 16.
- **Do:** on a call whose time has passed (item 20), press Done.
- **You should see:** the call shows Done. In the portal the card is gone for good. Done is not offered on a call still in the future.
- [ ] Checked

### 32. Mark a call missed

- **Why by hand:** PRD stories 16 and 25, brief item 16.
- **Do:** on a past call press Missed and confirm.
- **You should see:** the company gets "Sorry we missed you" with Book a new time. The portal card offers the call again.
- [ ] Checked

### 33. Put a call back

- **Why by hand:** PRD story 26.
- **Do:** put the missed call back. Then cancel a call, book that same time from your second company, and try to put the cancelled one back.
- **You should see:** the first goes back. The second is refused with "Someone has just taken that time. Please pick another."
- [ ] Checked

### 34. Bryan cancels with a reason

- **Why by hand:** PRD story 27, brief item 8.
- **Do:** cancel a call from the page. Try with an empty reason first, then type one.
- **You should see:** empty is refused ("Please give a reason."). Then the company gets "Bryan cancelled your call." with the reason, and the time is free again.
- [ ] Checked

### 35. Bryan moves a call

- **Why by hand:** PRD story 28, brief item 7.
- **Do:** move a call to a new free time from his slot picker.
- **You should see:** the company's card, email and invite give the new time in the company's zone. The picker offers times sooner than 12 hours too.
- [ ] Checked

### 36. Bryan books for a company

- **Why by hand:** PRD story 29, brief item 9, spec 05.18.
- **Do:** press Book for a company, pick your second company, a time, the person's details, book.
- **You should see:** the company gets the confirmation email. Its portal card says "Onboarding call booked" with the time, as if it had booked itself.
- [ ] Checked

### 37. The week view

- **Why by hand:** PRD story 30, brief item 14.
- **Do:** open the Week tab. Go forward a week, back, and press Today. Click a call.
- **You should see:** Bryan's hours shaded, days off and blocked times marked, calls at their times, the call opening when clicked.
- [ ] Checked

### 38. Bryan sets his hours

- **Why by hand:** PRD story 31.
- **Do:** in Availability give Monday two blocks (9 to 12 and 1 to 5), save. Open the portal calendar on a Monday.
- **You should see:** no times from 12:00 to 12:30 New York on Mondays. Put the hours back after.
- [ ] Checked

### 39. Bryan blocks 2 to 4 PM

- **Why by hand:** PRD story 32, brief item 12.
- **Do:** block 2:00 to 4:00 PM on a free weekday, save. Open the portal calendar on that day.
- **You should see:** 2:00, 2:30, 3:00 and 3:30 PM New York (in your zone) are gone. 1:30 and 4:00 are still there.
- [ ] Checked

### 40. A day off that has a booked call

- **Why by hand:** PRD story 33, brief item 11.
- **Do:** book a call, then in Availability make that date a day off and save.
- **You should see:** before saving, the page lists that call and asks Keep or Cancel. Cancel emails the company "Bryan is no longer available at this time." Keep leaves it booked.
- [ ] Checked

### 41. No call link set

- **Why by hand:** PRD story 34.
- **Do:** clear the call link in Availability and save.
- **You should see:** a warning at the top of the page with a button that jumps to the call link field. The company's emails say "Bryan will send you the call link before the call." Put the link back after.
- [ ] Checked

### 42. Bryan changes his time zone

- **Why by hand:** PRD story 35.
- **Do:** with a call booked, change the zone to Chicago and save (keep any call it lists). Then change it back.
- **You should see:** the company's card still shows the same time. On Bryan's page the call reads an hour earlier while Chicago is set.
- [ ] Checked

### 43. The older tracker's button

- **Why by hand:** PRD story 36.
- **Do:** open Customer management, Onboarding calls, press "Open calendar".
- **You should see:** the Call Calendar page, not the old outside booking page.
- [ ] Checked

### What the evals do not prove

### 44. Every screen at 360 and 430 wide, light and dark

- **Why by hand:** brief item 20, spec 09 and 10 (layouts).
- **Do:** look at the calendar, the booked screen, the card's dialog and the Call Calendar at 360 and 430 wide, in light and in dark.
- **You should see:** nothing cut off, no sideways scroll, the keyboard never hides the button.
- [ ] Checked

### 45. Long text

- **Why by hand:** brief "Also".
- **Do:** book with a 1000 character note, from a company with a very long name.
- **You should see:** the booked screen, Bryan's row, his details and his email all wrap neatly.
- [ ] Checked

### 46. A slow connection

- **Why by hand:** brief "Also".
- **Do:** in the browser's developer tools set the network to Slow 3G and book.
- **You should see:** the Book button shows it is working and cannot be pressed twice. One booking is made.
- [ ] Checked

### 47. Leaving half way

- **Why by hand:** brief "Also".
- **Do:** fill in the form, close the dialog, open it again.
- **You should see:** nothing is booked. You can pick again without the page breaking.
- [ ] Checked

### 48. Read every new sentence out loud

- **Why by hand:** brief "Also", source 5.
- **Do:** read every message on the calendar, the card, the Call Calendar and in the nine emails out loud.
- **You should see:** each reads like a person wrote it, with no long dashes, and names the time zone whenever it gives a time.
- [ ] Checked

## Part 2 · Staging look

### 49. The company's calendar on staging

- **Do:** after the merge to staging, open `northwind.portal.staging.drive-247.com`, press the card.
- **You should see:** the calendar with free times.
- [ ] Checked

### 50. The Call Calendar on staging

- **Do:** open `admin.staging.drive-247.com`, Call Calendar.
- **You should see:** the page with its counts and tabs.
- [ ] Checked

## Part 3 · Production check (look only)

Never book, move or cancel here, and never change Bryan's settings.

### 51. The company's calendar in production

- **Do:** open the northwind portal in production and press the call card.
- **You should see:** the calendar with Bryan's free times in your zone. Close it without booking.
- [ ] Checked

### 52. The Call Calendar in production

- **Do:** open super admin in production, Call Calendar.
- **You should see:** the real booking that was there before this change, with its company and time intact.
- [ ] Checked
