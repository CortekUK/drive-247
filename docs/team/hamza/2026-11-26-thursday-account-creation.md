# Account creation and the account itself

*Task guide for Hamza · From Ghulam · 26 Nov 2026 · Signup on drive-247.com and the Northwind (v2) portal*

> **Your task in one line.** Make signup shorter by moving the email code and the password into the portal, then do a full QA of everything to do with creating and owning an account: signup, promo codes, verifying, passwords, profile, and linking Google and email.

> **The most important thing: the phone.** Most people sign up on a phone, usually from an ad. Build and check everything on a phone first, then on a laptop: an iPhone, an Android phone, and inside the Instagram and Facebook apps. If it is not excellent on a phone, it is not finished. Section 5 says exactly what to check.

This guide is the starting point for your PRD section. You follow the usual path: PRD, specs, evals, QA report, then a pull request from `ray2`.

## 1. The decision: a shorter signup

|   | Today | After your change |
|---|---|---|
| Signup | About you → Business → Email code → Password → Card | About you → Business → Card |
| In the portal | Nothing | Verify the email, then set a password |

The About you, Business and Card screens stay exactly as they are. So do the build animation and Bryan's call offer after the card.

Why: since the 5-step form went live on 22 Nov, about half as many visitors from ads finish signup. Two fewer steps before the card is the fix.

### How it works after the change

| Moment | What happens |
|---|---|
| After the card step | The person is signed in to their portal automatically. They have no password yet. |
| First visit | The 7-card quick tour comes first. It is not part of your task. |
| Straight after the tour | One dialog: enter the 6-digit code from the email, then choose a password. |
| Is it required? | Yes. Without a password they cannot get back in from another device. |
| If they close it | A reminder on every visit. After 3 days the portal asks for it before letting them continue. |
| Signed up with Google | No code and no password needed. They never see this dialog. |
| Password rule | Unchanged: 8 characters, a letter and a number. |
| Code rule | Unchanged: 30 minutes, 5 tries, resend available. |

> **Two cases you must solve, not only test.**
>
> - **Locked out before setting a password.** Someone signs up, closes the browser, and comes back with no password. The login page must let them in another way, for example a code sent to their email.
> - **A mistyped email at signup.** The code goes nowhere. They must be able to correct the email from the verify dialog.

## 2. What exists today

| Thing | Exists? | Where |
|---|---|---|
| Profile panel: photo, name, email, password | Yes | Portal, from the user menu |
| Upload and crop a profile photo | Yes | Profile panel |
| Change email | Yes | Profile panel. A code goes to the new address. |
| Change password | Yes | Profile panel. A code first, then the new password. Works for someone with no password yet. |
| Forgot password | Yes | Portal login page, and the signup "Sign in" panel |
| Sign in with Google | Yes | Signup and portal login |
| Verify email and set password inside the portal after signup | **No** | You build it (section 1) |
| Unlink Google, or link Google to an email account | **No** | Nothing in the portal does this today. You build it. |

The change-password panel already does "code, then password" for a person with no password. Reuse it for the new dialog rather than writing a second one.

## 3. Linking and unlinking

| Case | What should happen |
|---|---|
| Signed up with Google, wants email and password too | Sets a password from the profile. Can then sign in either way. |
| Signed up with Google, wants to stop using Google | Must have a password first. Then "Disconnect Google" works. |
| Signed up with email, wants to add Google | "Connect Google" from the profile. The Google email must match, or the PRD says what happens when it does not. |
| Tries to remove their only way of signing in | Refused, with a clear message. |
| Google account's email differs from the portal email | Decide in the PRD. Do not let two people end up sharing one account. |
| Changes email while Google is connected | Decide in the PRD what happens to the Google link. |

## 4. What to QA

| Area | Cases |
|---|---|
| Signup, main path | From "Start free trial" to the portal. Each field: empty, wrong, too long. Required marks. Back and forward without losing what was typed. City and state list. Web address taken. Colour and light/dark carried into the portal. Terms tick. |
| Ways in | Landing page button, a plan card, `?signup=start`, `?signup=start&promo=BF30`, the emailed "finish later" link. |
| Continue with Google | Start to portal. Cancelled half way. A Google email that already has an account. |
| Card step | Each plan. Trial wording. Test cards that pass, fail, and need 3D Secure. Apple Pay and Google Pay where they show. |
| Promo codes | From the link and typed in. Valid, invalid, expired, wrong case, with spaces. On each plan. With and without a trial. Removed again. |
| Leaving and coming back | Leaves at each step and returns: same browser, another browser, the emailed link. Tries to close signup (the leave offer shows once). |
| Already has an account | Same email signs up again. Sign in from signup. "You already have a portal". |
| Verify in the portal | Right code, wrong code, 5 wrong tries, expired, resend, corrected email, dialog closed and reopened, reminder on next visit, the 3-day point. |
| Password | First-time set. The rule and its messages. Change from the profile. Forgot password from the login page, start to finish. The old password stops working. |
| Profile | Photo: upload, crop, replace, remove, a very large file, a wrong file type. Name saved and shown everywhere. Change email: code to the new address, wrong code, email already in use, signing in with the new email afterwards. |
| Linking | Every row of section 3. |
| What gets recorded | Each attempt appears on Super admin → Retention → Signups with the right step it stopped at. The step names there must match the new 3-step order. |
| Other people | A second staff member invited to a company: do they verify and set a password the same way? |

These are the cases we thought of. Add any others you find around them.

## 5. Phones and browsers

| Device | Browsers |
|---|---|
| iPhone | Safari, Chrome |
| Android phone | Chrome, Samsung Internet if you have one |
| Inside apps | Open the signup link from Instagram and from Facebook. Google sign-in is hidden there, and the card step offers "Open in Safari / Chrome". |
| Laptop | Chrome, Safari, Firefox |

Use real phones, not only the phone view in a laptop browser. Run the whole of section 4 on at least one iPhone and one Android phone.

| Check on each phone | What good looks like |
|---|---|
| Every screen fits | Nothing cut off, no sideways scroll, no scrolling needed to reach the main button. |
| The keyboard | It does not cover the field being typed in or the button. The right keyboard opens: numbers for the code and phone, email keyboard for email. |
| The email code | It can be pasted from the email, and the phone's "from Messages / Mail" suggestion fills it. |
| Autofill and saved passwords | Name, email and phone fill the right fields. The phone offers to save the new password. |
| Leaving to the mail app and back | They come back to the same screen with what they typed still there. |
| Apple Pay and Google Pay | Shown where the phone supports them, and the payment completes. |
| The portal dialog | The verify and password dialog fits, and its buttons are easy to tap. |
| Profile photo | Taking a photo with the camera and choosing one from the gallery both work, and the crop works with fingers. |
| Small and large phones | A small phone (360 wide) and a large one (430 wide). |
| Slow connection | On mobile data, buttons show they are working and cannot be pressed twice. |

## 6. The math

Work each of these out by hand on a calculator first, write the expected numbers in your spec, then compare with the screen, the Stripe test dashboard and the invoice.

| Check | What to compare |
|---|---|
| Each plan's price | The price on the landing page, on the card step, and in Stripe are the same. |
| Free trial | $0 today. The first charge date is the trial length after signup. The amount then is the plan price. |
| BF30 | 30% off the first 3 months. With a free trial, that is 3 paid bills at the lower price, not 4. The 4th paid bill is full price. |
| Rounding | A discount never leaves a fraction of a cent. Check a price where 30% does not divide evenly. |
| Promo plus plan change | Pick a plan, apply the code, change the plan: the discount follows the new plan's price. |

Read the plan prices and trial length from the live Signup Plans, not from this guide.

## 7. How to work

| Rule | Detail |
|---|---|
| Where you build | On `ray2`, brought level with `main` first. |
| Where you test | On your live site, `ray2.drive-247.com` and `northwind.portal.ray2.drive-247.com`. Staging database, Stripe test cards. |
| Never | A real signup on production while testing. |
| Edge functions | The signup functions will change. You may deploy them to staging only, and say so in the group first: staging is shared with Haris and Hamna. |
| Hand-in | PRD section, specs, evals (the code and password rules, and the money math in Vitest), the QA report, then a pull request from `ray2`. |
| Things you find outside this task | Write them down for Ghulam. |

## 8. Not in your task

> - **The quick tour and the tab tours.** Someone else is on them. Do not change them. Build your dialog on its own; how it follows the tour is sorted out when the branches are merged.
> - **Renter driver verification.** Haris is on it.
> - **The About you, Business and Card screens' design.** You test them; you do not redesign them.
> - **Bryan's call booking.** Test that the offer appears and that "Not now" works. Do not change it.

## 9. Where to look in the code

| Place | What it is |
|---|---|
| `apps/web/src/components/onboarding/` | The signup screens and their order |
| `.../onboarding/signup-stand-in.ts` | How the account gets a temporary password before the real one is set. Read this first. |
| `supabase/functions/signup-*` and `_shared/signup-*.ts` | The server side of signup: begin, code, card, provision, finish later |
| `apps/web/src/lib/black-friday.ts`, `promo-offer.ts` | The promo math |
| `apps/portal/src/components/shared/layout/profile-sheet-v2.tsx` | The profile panel: photo, name, email, password |
| `.../layout/password-change-panel-v2.tsx` | "Code, then password". Reuse for the new dialog. |
| `apps/portal/src/components/auth-v2/forgot-password-dialog-v2.tsx` | Forgot password |
| `apps/portal/src/hooks/use-google-sign-in.ts` | Google sign-in on the portal |
