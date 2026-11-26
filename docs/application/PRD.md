# Drive247 PRD

What every feature of Drive247 does, in plain language. One section per feature.

This file is the source for `PRD.pdf`. It is edited only through the `prd` skill, and the PDF is
rebuilt from it with `node scripts/build-prd.mjs`. How a feature is built is in its specs, in the
feature's folder.

## Features

| No. | Feature | Status | In one line |
|---|---|---|---|
| 001 | Account creation and the account | Being built | A new operator signs up in three steps, then confirms their email and picks a password inside their portal. |

## feat-001 · Account creation and the account

**Status:** Being built · **Built by:** Hamza · **Folder:** `feat-001-account-creation`

### In one line

A new rental operator signs up for Drive247 in three short steps on their phone, lands in their own portal straight away, and then confirms their email and picks a password from inside the portal.

### Why we have it

Most operators find Drive247 through an ad and sign up on their phone. On 22 Nov 2026 signup grew to five steps: about you, business, an email code, a password, then the card. Since then about half as many visitors from ads finish signing up. Moving the email code and the password to after the card takes two steps out of the way of the card, which is where a signup turns into a customer. We expect more visitors from ads to finish.

The same work also makes sure everything a person does with their account afterwards works well, on a phone first: confirming the email, passwords, their profile, and signing in with Google or with an email and password.

### Who it is for

- **A new operator**: someone who runs a rental business and is signing up, usually on a phone, often from an ad on Instagram or Facebook.
- **A staff member**: someone an operator invites into their company's portal.
- **Our team**: who watch how many people start and finish signup, and where they stop.

### What happens

**Signing up**

1. **A new operator signs up with their email.** They tap "Start free trial" on drive-247.com, a plan card, or a link from an ad. They fill in about them, then their business (name, web address, city and state, colours), then their card. They do not type a code or choose a password during signup. After the card they watch their site being built, see the offer of a call with Bryan, and land in their portal already signed in.
2. **A new operator signs up with Google.** They tap "Continue with Google" and pick their Google account. Google has already confirmed the email, so they are never asked for a code or a password. They fill in the business and card steps and land in their portal.
3. **A new operator brings a promo code.** They open a link that carries a code, such as BF30, or type one on the card step. The card step shows the plan price, the discount, and what they pay and when. A code that does not exist or has ended is refused with a clear message, and they can carry on without it or remove a code they added.
4. **A new operator leaves part way through.** They close the page or leave for their mail app. When they come back, in the same browser or through the "finish later" email, they return to the step they left with what they typed still there. The first time they try to leave, they see one offer to stay; after that, they are left to go.
5. **Someone signs up with an email that already has an account.** They are told they already have a portal and are offered a way to sign in, instead of a second account.
6. **The card does not go through.** The card is declined or the bank check fails. They stay on the card step, see why, and can try another card. Nothing is set up until a card is accepted.

**Confirming the email and choosing a password in the portal**

7. **The new operator arrives in their portal for the first time.** The quick tour shows first. Straight after it, one window asks them to enter the 6-digit code we emailed them, then choose a password. When they finish, they can sign in from any device.
8. **They type the wrong code.** They are told it is wrong and how many tries are left. After 5 wrong tries the code stops working and they ask for a new one.
9. **The code has expired or never arrived.** They tap "Send a new code". The new code replaces the old one.
10. **They typed their email wrong at signup.** The code went nowhere. In the same window they tap "Wrong email?", correct the address, and a new code goes to the right one. The account now uses the corrected email.
11. **They close the window without finishing.** They can use the portal. Every time they come back, a reminder asks them to finish. Three days after signing up, the portal asks for the code and password before letting them do anything else.
12. **They closed the browser before choosing a password.** They come back on another day, or on another device, and have no password. On the sign-in page they tap "Email me a sign-in code", enter the code from their email, and are in. The window from story 7 then asks them to choose a password.

**Their profile**

13. **An operator changes their photo.** From the menu they open their profile, take a photo or pick one from their gallery, crop it with their fingers, and save. They can replace or remove it later. A file that is too large or is not a picture is refused with a message.
14. **An operator changes their name.** The new name shows everywhere in the portal.
15. **An operator changes their email.** A code goes to the new address. Once they enter it, they sign in with the new email from then on. An email that already belongs to another account is refused.
16. **An operator changes their password.** A code goes to their email first, then they choose the new password. The old password stops working straight away.
17. **An operator forgets their password.** On the sign-in page they tap "Forgot password?", get a code by email, and choose a new one.

**Google and email sign-in together**

18. **An operator who signed up with Google adds a password.** From their profile they set a password. From then on they can sign in either with Google or with their email and password.
19. **An operator who signed up with Google stops using Google.** From their profile they tap "Disconnect Google". This only works once they have a password; until then they are told to set one first.
20. **An operator who signed up with their email adds Google.** From their profile they tap "Connect Google" and pick a Google account with the same email. From then on they can sign in either way.
21. **They pick a Google account with a different email.** It is refused: "This Google account uses a different email from your Drive247 account." Nothing is connected. This keeps two people from ending up in the same account.
22. **They try to remove their only way of signing in.** It is refused with a message saying they need another way in first.
23. **An operator with Google connected changes their email.** Google is disconnected, because it no longer matches, and they are told so. They sign in with the new email and their password, and can connect a Google account with the new email if they want.

**Staff members**

24. **An operator invites a staff member.** The staff member is given a temporary password. The first time they sign in, they are asked to choose their own password, with a code sent to their email first. They do not see the window from story 7.

### The rules

- Signup has three steps: about you, business, card. The about you, business and card screens look the same as before.
- A password has at least 8 characters, with at least one letter and one number.
- An email code has 6 digits, lasts 30 minutes, and allows 5 tries. A new one can be sent; it replaces the old one.
- Confirming the email and choosing a password are required for everyone who signs up with an email. The reminder shows on every visit. Three days after signup, the portal is blocked until it is done.
- Someone who signed up with Google never needs a code or a password, unless they choose to add one.
- An account always keeps at least one way to sign in.
- A Google account can only be connected if its email is the same as the account's email.
- Changing the email disconnects Google.
- Prices, trial lengths and promo codes come from the signup plans our team sets. With a free trial, nothing is charged at signup and the first charge is the plan price, on the day the trial ends.
- BF30 takes 30% off the first 3 paid bills. With a free trial, the trial is not counted as one of the three, so the 4th paid bill is full price.
- A discount is always rounded to whole cents.
- If the operator changes plan on the card step after adding a promo code, the discount follows the new plan's price.
- The offer to stay shows at most once per signup.
- Every signup attempt is recorded, with the step where it stopped.

### What it does not do

- It does not change how the about you, business and card screens look.
- It does not change the quick tour, the call with Bryan, or the way renters prove who they are.
- It does not let one person sign in to two companies with one account.
- It does not show Google sign-in inside the Instagram and Facebook apps, where Google does not allow it. People there use their email.
- It does not charge anything during a free trial.

### How we know it is working

- On Super admin → Customer management → Signups, the share of visitors from ads who finish signup goes back up. The list shows each attempt and the step where it stopped, using the three new step names.
- On the same list, our team can see how many new operators have confirmed their email and chosen a password, and how many are past the three days without doing it.
- In the Stripe test dashboard, every price, trial and discount matches what the card step showed.
