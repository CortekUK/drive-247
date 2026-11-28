# QA report · feat-001 · Account creation and the account

**Checked by:** Hamza · **Status:** 0 of 58 checked · **Evals:** see `evals/RESULTS.md` (the functions and the migration are on staging since 27 Nov; review 1 fixed 03.4 and narrowed 08.13)

| Part | Where | Checked |
|---|---|---|
| 1. Full check | `ray2` only, never localhost | 0 of 58 |
| 2. Staging look | https://staging.drive-247.com, https://northwind.portal.staging.drive-247.com | 0 of 2 |
| 3. Production check | northwind, live, no new company | 0 of 2 |

## Where each item is checked

Every item is checked on the `ray2` sites (review 1, 3.1): https://ray2.drive-247.com, https://northwind.portal.ray2.drive-247.com, https://admin.ray2.drive-247.com. **phone** means a real iPhone and a real Android phone, on ray2.

Each tick says what you saw, in your own words. A money item has three numbers written down: yours (calculator), the landing page's and the card step's. Anything that does not match is not ticked: write what you saw, fix it, check again.

### Logins and test addresses

- Signups: `hamza.shafique12123+N@gmail.com`, with N counting up. Codes and links arrive in that Gmail inbox.
- Portal: the staging accounts in `.staging-credentials.local`. Super admin: your own staging super admin in `.staging-admin-hamza.local` (the shared one does not work, 28 Nov).
- Stripe test cards (any future date, any CVC, any postcode): `4242 4242 4242 4242` passes; `4000 0000 0000 0002` is declined; `4000 0025 0000 3155` asks for 3-D Secure.
- Helpers (need `SUPABASE_ACCESS_TOKEN`): `node scripts/dev-account-tools.mjs status|code|age|owe|delete <email>`.

---

## Part 1 · Full check

### A. Signup: ways in and fields

#### 1. "Start free trial" on the landing page opens signup

- **Where:** ray2
- **Why by hand:** PRD story 1, spec 01.1
- **Do:** 1. Open https://ray2.drive-247.com. 2. Tap "Start free trial" at the top.
- **You should see:** "Let's get you on the road" with Your name, Email, How did you hear about us?, Phone number and "Sign up". Three progress dashes at the bottom.
- **How to be sure:** The cheapest plan (Starter) is the one picked, since no plan was chosen.
- [ ] Checked

#### 2. A plan card opens signup on that plan

- **Where:** ray2
- **Why by hand:** PRD story 1
- **Do:** 1. Scroll to the plans. 2. Tap "Start free trial" under **The Lot (Growth)**. 3. Fill About you and Business, continue to the card step.
- **You should see:** On the card step, Growth is ticked.
- **How to be sure:** Growth shows $229 crossed out and $160.30/month.
- [ ] Checked

#### 3. The `?signup=start` link opens signup

- **Where:** ray2
- **Why by hand:** spec 01.1, a link from another page or an ad
- **Do:** Open https://ray2.drive-247.com/?signup=start
- **You should see:** The signup opens by itself, and `?signup=start` disappears from the address bar.
- **How to be sure:** Reload: it does not open again on its own.
- [ ] Checked

#### 4. The BF30 link carries the code to the card step

- **Where:** ray2
- **Why by hand:** PRD story 3
- **Do:** 1. Open https://ray2.drive-247.com/?signup=start&promo=BF30 2. Go through to the card step.
- **You should see:** "Black Friday: 30% off your first 3 months" and, for Starter, "$129 $90.30/mo for 3 months, then $129."
- **How to be sure:** The address keeps `?promo=BF30` until the card step.
- [ ] Checked

#### 5. About you: empty, wrong and too long

- **Where:** ray2
- **Why by hand:** Ghulam's section 4, "each field: empty, wrong, too long"
- **Do:** 1. Tap "Sign up" with nothing filled. 2. Name `A`, email `jo@@example.com`, phone `12`, tap "Sign up". 3. Paste a name of 80 letters.
- **You should see:** 1: "Please enter your full name.", "Please enter your work email address.", "Please enter your phone number." 2: "That doesn't look like a valid email address." and "Please enter a valid phone number." 3: the name stops at 60 letters.
- **How to be sure:** Nothing moves on to the business step until all three are right.
- [ ] Checked

#### 6. Required marks match what is required

- **Where:** ray2
- **Why by hand:** Ghulam's section 4, "required marks"
- **Do:** Look at the four field labels on "Let's get you on the road".
- **You should see:** A red `*` on every field that cannot be left empty.
- **How to be sure:** Known finding (27 Nov): Phone is required but has **no** `*`. If it is still missing, mark this failed for Ghulam (signup screens are not redesigned in this task).
- [ ] Checked

#### 7. Business: taken, reserved and free web addresses

- **Where:** ray2
- **Why by hand:** Ghulam's section 4, "web address taken"
- **Do:** On "What's your business called?": 1. Business name `Northwind`. 2. Web address `admin`. 3. Web address `Bad Slug!!`. 4. A new name of your own.
- **You should see:** 1: "That web address is already taken." with "Try: northwind-rentals northwind-cars northwind1". 2: "That web address is reserved. Please choose another one." 3: it becomes `bad-slug`. 4: "… .drive-247.com is available".
- **How to be sure:** Tapping a suggestion fills it in.
- [ ] Checked

#### 8. Business: city list and terms box

- **Where:** ray2
- **Why by hand:** Ghulam's section 4, "city and state list", "terms tick"
- **Do:** 1. Type `Hous` in City and state. 2. Fill everything except the terms box.
- **You should see:** 1: Houston, TX / Houston, MS / … to choose from. 2: "Continue" stays greyed out until the terms box is ticked.
- **How to be sure:** The Terms and Privacy Policy links open the right pages.
- [ ] Checked

#### 9. Back and forward keep what was typed

- **Where:** ray2
- **Why by hand:** Ghulam's section 4
- **Do:** Fill About you, go to Business, tap "Back", then "Sign up" again.
- **You should see:** Every field still filled, both ways.
- **How to be sure:** The colour and Light/Dark choice you made on Business is still chosen after going back and forward.
- [ ] Checked

### B. Signup: the new 3 steps, and leaving

#### 10. No code and no password during signup

- **Where:** ray2
- **Why by hand:** PRD story 1, spec 01.1 (the flow through screens)
- **Do:** Sign up with a new `+N` address: About you → Business → Continue.
- **You should see:** Straight to "Last step, <name>" (the card step). No "Check your inbox" and no "Pick a password" screen.
- **How to be sure:** `node scripts/dev-account-tools.mjs status <email>` shows `email_owed: 'true'` and `password_owed: 'true'`.
- [ ] Checked

#### 11. The code email is sent at signup

- **Where:** ray2
- **Why by hand:** not covered by an eval: the email is built but never received in an eval
- **Do:** After item 10, look at your Gmail.
- **You should see:** "<6 digits> is your Drive247 verification code", to the address you typed.
- **How to be sure:** The portal's verify window later accepts this exact code (item 24).
- [ ] Checked

#### 12. The leave offer shows once

- **Where:** ray2
- **Why by hand:** PRD story 4
- **Do:** 1. On the card step, tap the ✕. 2. Tap "Continue now", then ✕ again.
- **You should see:** 1: "Your Black Friday price is saved until Monday … Email me a link to finish later". 2: the signup just closes.
- **How to be sure:** In a new private window it shows once again (it is remembered per browser).
- [ ] Checked

#### 13. The "finish later" email link

- **Where:** ray2
- **Why by hand:** PRD story 4, not covered by an eval (email received)
- **Do:** 1. In the leave offer, tap "Email me a link to finish later". 2. Open the email. 3. Open its link in a different browser.
- **You should see:** "Finish setting up your Drive247 account", and the link returns you to the card step, signed in.
- **How to be sure:** Known finding (27 Nov): the link goes to **www.drive-247.com** (live), not ray2, because the address is written into `signup-finish-later` (existing code). Mark failed if so; it works only on the live site.
- [ ] Checked

#### 14. Coming back in the same browser

- **Where:** ray2
- **Why by hand:** PRD story 4
- **Do:** Reach the card step, close the tab, open https://ray2.drive-247.com/?signup=start again.
- **You should see:** "Checking your setup…", then "Last step, <name>" again.
- **How to be sure:** The plan you picked is still ticked.
- [ ] Checked

#### 15. Signing up again with the same email

- **Where:** ray2
- **Why by hand:** PRD story 5, found while testing (27 Nov)
- **Do:** Sign out (private window), sign up again with the same `+N` address, through Business.
- **You should see:** "Welcome back. You already started signing up with this email. Enter your password, or if you haven't chosen one yet, tap "Forgot password?" and we'll email you a code."
- **How to be sure:** Item 16 gets you in without ever having chosen a password.
- [ ] Checked

#### 16. "Forgot password?" from signup gets a 3-step signup back in

- **Where:** ray2
- **Why by hand:** found while testing (27 Nov); spec 05.6
- **Do:** On "Welcome back": "Forgot password?" → "Send reset code" → enter the code (runner window or Gmail) and a new password twice → sign in with it.
- **You should see:** "Password updated. Sign in with your new password to carry on." Then the card step.
- **How to be sure:** `status <email>` shows both `email_owed` and `password_owed` as `'false'`. After the portal is built, no verify window appears.
- [ ] Checked

#### 17. "You already have a portal"

- **Where:** ray2
- **Why by hand:** PRD story 5
- **Do:** Sign up with the email of a portal staff member, e.g. the northwind login from `.staging-credentials.local`.
- **You should see:** "This email already has a Drive247 portal account. Sign in at your portal instead, or use a different email address."
- **How to be sure:** No new company appears in Super admin → Signups.
- [ ] Checked

### C. Card step and money

#### 18. Card prices match the landing page (math)

- **Where:** ray2
- **Why by hand:** money math, spec 08, rows 2, 3, 4
- **Do:** On a calculator: 129 × 0.7, 229 × 0.7, 349 × 0.7. Compare with the landing plan cards and with the card step.
- **You should see:** $90.30, $160.30, $244.30 on both. Write down three numbers per plan: yours, the landing page's, the card step's.
- **How to be sure:** The plan prices come from the live Signup Plans (Super admin), not this report: check them there first.
- [ ] Checked

#### 19. The discount follows a plan change (math)

- **Where:** ray2
- **Why by hand:** money math, spec 08, row 10
- **Do:** With BF30, on the card step switch Growth → Scale.
- **You should see:** "$349 $244.30/mo for 3 months, then $349."
- **How to be sure:** Switch back to Growth: "$229 $160.30/mo for 3 months, then $229."
- [ ] Checked

#### 20. Free trial: $0 today, first charge in 14 days (math)

- **Where:** ray2
- **Why by hand:** money math, spec 08, row 5
- **Do:** On the card step, read "Due today" and the first payment date. Count 14 days from today on a calendar.
- **You should see:** "Due today $0" and "Your first payment is on <today + 14 days>".
- **How to be sure:** After a test payment (item 23), Stripe's test dashboard shows the subscription trialing until that date.
- [ ] Checked

#### 21. Promo codes typed by hand

- **Where:** ray2
- **Why by hand:** PRD story 3, Ghulam's section 4
- **Do:** On the card step, without the BF30 link, type: `bf30`, ` BF30 ` (spaces), `NOPE123`. Then remove the code.
- **You should see:** The first two give the BF30 price. `NOPE123` is refused with a message and you can carry on at full price. Removing returns the full price.
- **How to be sure:** Try it on all three plans.
- [ ] Checked

#### 22. An expired promo code is refused

- **Where:** ray2
- **Why by hand:** PRD story 3, spec 08 row 12
- **Do:** In Super admin → Promo codes, make a test code that has already ended (or ask Ghulam for one). Type it on the card step.
- **You should see:** Refused with a message; the plan stays at full price.
- **How to be sure:** BF30 itself ends 1 Dec 2026 04:59:59 UTC; after that it must be refused too.
- [ ] Checked

#### 23. A test card that passes

- **Where:** ray2
- **Why by hand:** spec 01 (a third party's own page), PRD story 1
- **Do:** Card `4242 4242 4242 4242` → "Start my 14-day free trial".
- **You should see:** The site being built, then the offer of a call with Bryan ("Not now" works), then the portal.
- **How to be sure:** In Stripe's test dashboard the customer has a subscription with the BF30 coupon. Known: the sign-in link into the portal needs Ghulam's redirect allow-list; until then you may land on the login page (use item 29).
- [ ] Checked

#### 24. A declined card

- **Where:** ray2
- **Why by hand:** PRD story 6
- **Do:** Card `4000 0000 0000 0002`.
- **You should see:** You stay on the card step with the bank's reason, and can try another card.
- **How to be sure:** No company appears for this signup in Super admin.
- [ ] Checked

#### 25. 3-D Secure

- **Where:** ray2
- **Why by hand:** PRD story 6
- **Do:** Card `4000 0025 0000 3155`, then "Complete" in the test bank window; then again with "Fail".
- **You should see:** Complete: signup goes on. Fail: you stay on the card step with a message.
- **How to be sure:** Only one company is built.
- [ ] Checked

#### 26. BF30 stops after 3 paid bills (math)

- **Where:** ray2
- **Why by hand:** spec 08.16, money math rows 3 and 5
- **Do:** After item 23 with Growth + BF30, open the subscription in Stripe's test dashboard.
- **You should see:** The coupon lasts for 3 paid bills after the trial: <trial end>, +1 month, +2 months at $160.30, then $229.
- **How to be sure:** Stripe's "upcoming invoices" or the coupon's "duration in months" shows when it stops. Write down your date, Stripe's date and the amounts.
- [ ] Checked

#### 27. Rounding never leaves a fraction of a cent

- **Where:** — (proved by Vitest)
- **Why by hand:** money math, spec 08 rows 6, 7
- **Do:** On a calculator: 99.99 × 0.7 = 69.993 and 0.05 × 0.7 = 0.035. No live plan has these prices.
- **You should see:** The rule gives $69.99 and $0.04 (half up). Compare with `evals/RESULTS.md` (08.6, 08.7 passed).
- **How to be sure:** Every price on screen in items 18–20 has exactly two decimals.
- [ ] Checked

### D. The portal: verify window

#### 28. The verify window after the tour

- **Where:** ray2
- **Why by hand:** PRD story 7, spec 03 (keyboard, autofill)
- **Do:** Sign in to the portal as a 3-step signup that still owes the code (item 10's account, or `owe <email>`). Close the quick tour.
- **You should see:** "Check your email. We sent a 6-digit code to <email>. 3 days left to finish this." Six boxes, "Verify", "Send a new code", "Wrong email?", "Not now".
- **How to be sure:** The window waits until the tour is closed; it never covers it.
- [ ] Checked

#### 29. Right code, then choose a password

- **Where:** ray2
- **Why by hand:** PRD story 7
- **Do:** Type the code (runner window or Gmail). Then a password of 8+ characters with a letter and a number, twice.
- **You should see:** "Choose a password", then the window closes and you stay signed in.
- **How to be sure:** Sign out and sign in with the new password on another browser.
- [ ] Checked

#### 30. Wrong codes and the 5-try limit

- **Where:** ray2
- **Why by hand:** PRD story 8
- **Do:** Type `000000` five times.
- **You should see:** "That code is not right. 4 tries left." … "1 try left", then "Too many tries. Ask for a new code."
- **How to be sure:** The right code is now refused too, until "Send a new code".
- [ ] Checked

#### 31. Send a new code

- **Where:** ray2
- **Why by hand:** PRD story 9
- **Do:** Tap "Send a new code" twice in a row.
- **You should see:** A new code arrives; the second tap asks you to wait (60 seconds).
- **How to be sure:** The old code is refused; the new one works.
- [ ] Checked

#### 32. "Wrong email?" corrects the address

- **Where:** ray2
- **Why by hand:** PRD story 10, one of Ghulam's two "must solve" cases
- **Do:** Tap "Wrong email?", type a new `+N` address, send. Then try the northwind staff email.
- **You should see:** A code goes to the new address and the window now names it. The staff email is refused: "That email already has a Drive247 account."
- **How to be sure:** After finishing, you sign in with the corrected email; the old one no longer works.
- [ ] Checked

#### 33. "Not now", the reminder, and the 3-day block

- **Where:** ray2
- **Why by hand:** PRD story 11, spec 04 (the clock is moved on a test account)
- **Do:** 1. Tap "Not now", reload: it comes back. 2. `age <email> 49` → reload. 3. `age <email> 70` → reload. 4. `age <email> 72` → reload.
- **You should see:** 1: the window again. 2: "2 days left". 3: "2 hours left" and "Not now" still there. 4: no "Not now", no ✕, Escape does nothing.
- **How to be sure:** In 4, Subscription and Settings pages still open, so a payment link is never blocked.
- [ ] Checked

#### 34. Locked out: "Email me a sign-in code"

- **Where:** ray2
- **Why by hand:** PRD story 12, Ghulam's other "must solve" case; spec 05.1
- **Do:** On https://northwind.portal.ray2.drive-247.com/login tap "Email me a sign-in code", enter your email, type the code from Gmail.
- **You should see:** Signed in to the portal. For an account that still owes a password, the window from item 28 follows.
- **How to be sure:** Ask for a second code at once: the button counts down ("Wait 58s").
- [ ] Checked

#### 35. Sign-in code: unknown email and wrong company

- **Where:** ray2
- **Why by hand:** spec 05.4, 05.5
- **Do:** 1. Ask for a code for an address that has no account. 2. Ask for one as a staff member of a different company.
- **You should see:** 1: the same "If … has an account here, a six-digit code is on its way" as a real account. 2: after the code, "This login belongs to a different company's portal."
- **How to be sure:** Neither creates an account.
- [ ] Checked

### E. The profile

#### 36. Photo: upload, crop, replace, remove

- **Where:** ray2
- **Why by hand:** PRD story 13, spec 06.1
- **Do:** Profile → tap the photo → pick a picture → crop → save. Replace it, then remove it.
- **You should see:** The new photo in the menu and the sidebar at once.
- **How to be sure:** It is still there after a reload.
- [ ] Checked

#### 37. Photo: too large or not a picture

- **Where:** ray2
- **Why by hand:** PRD story 13
- **Do:** Pick a 20 MB photo, then a PDF.
- **You should see:** A message for each; nothing changes.
- **How to be sure:** The old photo stays.
- [ ] Checked

#### 38. Name shows everywhere

- **Where:** ray2
- **Why by hand:** PRD story 14
- **Do:** Profile → change the display name → Save.
- **You should see:** The new name in the sidebar, the menu and the dashboard greeting.
- **How to be sure:** After a reload too.
- [ ] Checked

#### 39. Change email

- **Where:** ray2
- **Why by hand:** PRD story 15, spec 06.5
- **Do:** Profile → Email → a new `+N` address → "Confirm change" → wrong code once → right code. Then try an address another account uses.
- **You should see:** "Email updated. You now sign in with <new>." The taken address is refused.
- **How to be sure:** Sign out; sign in with the new email works, the old one does not.
- [ ] Checked

#### 40. Change password

- **Where:** ray2
- **Why by hand:** PRD story 16
- **Do:** Profile → Change password → new password → code from email → save.
- **You should see:** "Password updated".
- **How to be sure:** The old password is refused at once; the new one works.
- [ ] Checked

#### 41. Forgot password on the portal login

- **Where:** ray2
- **Why by hand:** PRD story 17, spec 05.6
- **Do:** Login → "Forgot password?" → code → new password.
- **You should see:** Signed in with the new password.
- **How to be sure:** The old password is refused.
- [ ] Checked

### F. Linking Google and email

#### 42. Sign-in methods shows how you sign in

- **Where:** ray2
- **Why by hand:** spec 07.1
- **Do:** Profile → "Sign-in methods".
- **You should see:** "Email and password: Set" (or "No password yet") and "Google: Not connected" (or "Connected (<email>)").
- [ ] Checked

#### 43. Disconnect Google needs a password first

- **Where:** ray2
- **Why by hand:** PRD stories 19 and 22, spec 07.6
- **Do:** As a Google-only account (no password), tap "Disconnect".
- **You should see:** "Set a password first.", and the password panel opens.
- **How to be sure:** `status <email>` still lists the Google sign-in.
- [ ] Checked

#### 44. A Google-only account sets a password

- **Where:** ray2
- **Why by hand:** PRD story 18, spec 07.2
- **Do:** Sign-in methods → "Set a password" → new password → code.
- **You should see:** "Email and password: Set".
- **How to be sure:** Sign in with that password; Google still works too.
- [ ] Checked

#### 45. Connect Google with the same email

- **Where:** ray2, and after Ghulam turns on Google and "manual linking" in Supabase Auth
- **Why by hand:** PRD story 20, spec 07.3 (Google's own page)
- **Do:** Sign-in methods → "Connect Google" → pick the Google account with the same email.
- **You should see:** Back in the portal: "Google connected".
- **How to be sure:** Sign out, "Continue with Google" signs you in to the same account.
- [ ] Checked

#### 46. A Google account with a different email is refused

- **Where:** as item 45
- **Why by hand:** PRD story 21
- **Do:** "Connect Google" → pick a Google account with another email.
- **You should see:** "This Google account uses a different email from your Drive247 account." Nothing connected.
- **How to be sure:** Signing in with that Google account does not open this portal account.
- [ ] Checked

#### 47. Changing email with Google connected

- **Where:** ray2
- **Why by hand:** PRD story 23, spec 07.9
- **Do:** With Google connected and a password set, change the email (item 39).
- **You should see:** "You now sign in with <new>. Google was disconnected because your email changed…"
- **How to be sure:** With Google and **no** password, the change is refused: "Set a password first".
- [ ] Checked

### G. Other people, Super admin

#### 48. An invited staff member

- **Where:** ray2
- **Why by hand:** PRD story 24, Ghulam's section 4 "other people"
- **Do:** Portal → Users → invite a `+N` address as staff. Sign in as them with the temporary password.
- **You should see:** They are asked to choose their own password (a code first). They never see the "Check your email" window from item 28.
- **How to be sure:** The temporary password is 16 characters with upper, lower, a number and a symbol.
- [ ] Checked

#### 49. Signups list in Super admin

- **Where:** ray2 (step names); and the "email confirmed / password set" line
- **Why by hand:** spec 09.5, Ghulam's section 4 "what gets recorded"
- **Do:** https://admin.ray2.drive-247.com → Retention → Signups. Find each `+N` you used today.
- **You should see:** "stopped at about you / at the business / at the card" and "At the card step, no card yet". "Email confirmed, password set" or "No password yet · N days left" (amber), "… · 3-day point passed" (red).
- **How to be sure:** Older rows read "at the email code (old signup)" / "at the password (old signup)".
- [ ] Checked

### I. From review 1 (28 Nov)

#### 53. A ray2 signup lands on the ray2 portal

- **Where:** ray2
- **Why by hand:** review 1 answer 2.2, spec 02.7
- **Do:** Sign up on https://ray2.drive-247.com with a new `+N` address and pay with `4242 4242 4242 4242`.
- **You should see:** You land on `https://<your-slug>.portal.ray2.drive-247.com`, not `portal.drive-247.com` and not localhost. The welcome email's "Open your portal" goes there too.
- **How to be sure:** Read the address bar and hover the email's button.
- [ ] Checked

#### 54. After paying you come back to ray2, not localhost

- **Where:** ray2
- **Why by hand:** review 1 answer 2.1 (redirect URLs on staging)
- **Do:** The same signup as item 53, through Stripe's card page.
- **You should see:** After paying you return to a ray2 address. Never `localhost:3000`.
- [ ] Checked

#### 55. "Finish later" from ray2 opens ray2

- **Where:** ray2 (phone)
- **Why by hand:** review 1 answer 2.7, spec 01.14
- **Do:** On a phone, reach the card step on ray2 and tap "Email me a link to finish later". Open the email.
- **You should see:** The link starts `https://ray2.drive-247.com/?signup=finish`, not www. It opens the card step, signed in.
- [ ] Checked

#### 56. The three Google buttons on ray2

- **Where:** ray2
- **Why by hand:** review 1 answer 2.3 (after the staging Google client and the two Vercel flags)
- **Do:** 1. Signup: "Continue with Google". 2. Portal login: "Sign in with Google". 3. Portal profile → Sign-in methods: "Connect Google" with the same Gmail.
- **You should see:** All three work. A Google account with a different email is refused with the PRD's message.
- [ ] Checked

#### 57. The 3-day block screen is never a dead end (phone)

- **Where:** phone (ray2)
- **Why by hand:** review 1 answer 2.4, Ghulam's condition
- **Do:** `node scripts/dev-account-tools.mjs age <email> 73` on a test account that still owes its code; sign in to the portal on a phone.
- **You should see:** The window cannot be closed and always shows **"Send a new code"** and **"Wrong email?"**, on a 360-wide screen too, also right after a wrong code and while the 60-second wait counts down.
- [ ] Checked

#### 58. Super admin refuses a trial of 30 days or more

- **Where:** ray2 (https://admin.ray2.drive-247.com → Signup Plans)
- **Why by hand:** review 1 answer 2.5, spec 08.19
- **Do:** On any plan, Free trial: type 30, then 45, then 29. Put it back to 14 afterwards.
- **You should see:** 30 and 45: "A signup trial must be under 30 days (1 to 29)." and Save stays off. 29 is accepted.
- [ ] Checked

### H. Phones and emails as received

#### 50. Every screen on a real iPhone and Android phone

- **Where:** phone (ray2): iPhone Safari and Chrome, Android Chrome
- **Why by hand:** Ghulam's section 5, not covered by an eval
- **Do:** Go through items 1–25, 28–44 and 53–58 on each phone, small (360 wide) and large (430 wide) if you have them.
- **You should see:** Nothing cut off, no sideways scroll, the main button reachable, the keyboard never covers the field or the button, numbers keyboard for codes and phone, email keyboard for email.
- **How to be sure:** Known small things on the signup screens (for Ghulam, 27 Nov): colour dots 24×24, terms box 16×16, "Sign in" link 20 px tall.
- [ ] Checked

#### 51. Inside Instagram and Facebook

- **Where:** phone (ray2)
- **Why by hand:** Ghulam's section 5, spec 07.10
- **Do:** Send yourself the ray2 link in Instagram and in Facebook Messenger; open it there. Sign up to the card step; open the portal profile.
- **You should see:** Google sign-in hidden; the card step offers "Open in Safari / Chrome"; Sign-in methods says "Open this page in your browser to change Google."
- **How to be sure:** Opening in Safari/Chrome continues where you were.
- [ ] Checked

#### 52. The emails as received

- **Where:** your Gmail (ray2)
- **Why by hand:** not covered by an eval (emails are never received there)
- **Do:** Read each email you got today: the signup code, the sign-in code, the reset code, "finish later", and the staff invite.
- **You should see:** The right name, a code that works, links that open the right site, Drive247 as the sender, no broken characters.
- **How to be sure:** Read every new sentence out loud: none should be confusing. Codes paste into the six boxes and the phone's "from Mail" suggestion fills them.
- [ ] Checked

---

## Part 2 · Staging look (during the relay)

#### S1. Signup is 3 steps on staging

- **Do:** https://staging.drive-247.com/?signup=start with a new `+N` address, to the card step.
- **You should see:** About you → Business → "Last step". No code or password screen.
- [ ] Checked

#### S2. The verify window on the staging portal

- **Do:** Sign in to the staging portal as that account (item 34's sign-in code).
- **You should see:** "Check your email" after the tour.
- [ ] Checked

## Part 3 · Production check (straight after the relay)

#### P1. Northwind login offers "Email me a sign-in code"

- **Do:** https://northwind.portal.drive-247.com/login → "Email me a sign-in code" with your own northwind staff email.
- **You should see:** The code arrives and signs you in.
- [ ] Checked

#### P2. The northwind profile shows Sign-in methods

- **Do:** Signed in as your northwind staff account on https://northwind.portal.drive-247.com, open the profile.
- **You should see:** "Sign-in methods" with Email and password ✓, and Google as Connect or Connected. No new company is created and nothing is paid (review 1: no real signup on production).
- [ ] Checked
