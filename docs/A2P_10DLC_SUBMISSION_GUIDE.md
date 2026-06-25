# A2P 10DLC Campaign Submission Guide (for tenants)

> Purpose: get a US SMS (A2P 10DLC) campaign **approved on the first try**.
> The #1 reason campaigns get rejected (Twilio error **30896 — "rejected because
> of provided Opt-in information"**) is that the reviewer **cannot see/verify how
> customers opt in**. Drive247 now ships every tenant a public, server-rendered
> opt-in page so this is solved — you just have to point your campaign at it.

---

## Before you start
- Your **Brand** must be **APPROVED** first (business name + EIN + address must
  exactly match IRS / state registration records). If the brand is rejected, the
  campaign can't pass — fix the brand first.
- Your Drive247 booking site must have **SMS enabled** (Settings → Integrations →
  Twilio SMS). When it is, your site automatically has these public pages:
  - `https://<your-domain>/sms-opt-in`  ← the opt-in proof page (cite this!)
  - `https://<your-domain>/privacy`     ← includes the SMS / third-party clause
  - `https://<your-domain>/terms`

---

## Campaign fields — copy/paste these

**Use case:** `Customer Care` (or `Low Volume Mixed` if you send very little).

**Campaign description:**
> [Brand] sends transactional SMS to customers who book or enquire about a vehicle
> rental: booking confirmations, reservation/status updates, vehicle pickup &
> collection details, lockbox codes, e-signing links, trip and return reminders,
> payment notifications, and customer support. No marketing or promotional messages.

**Opt-in type:** `Web form`

**Message Flow / "How do end users consent to receive messages?"** — THIS is the
field that gets rejected. Paste this (swap in your brand + domain):
> Customers opt in to SMS from [Brand] on our online booking form at
> https://<your-domain>/booking. After selecting a vehicle and entering their
> contact details (including mobile number), the customer must manually tick an
> **unchecked** opt-in checkbox to consent — it is never pre-selected and consent
> is **not a condition** of rental. The exact consent language is published
> publicly (no login required) at **https://<your-domain>/sms-opt-in** and reads:
> "I agree to receive SMS text messages from [Brand] about my rental — booking
> confirmations, vehicle collection/pickup details, lockbox codes and e-signing
> links. Message & data rates may apply. Message frequency varies. Reply STOP to
> opt out, HELP for help. See our Privacy Policy and Terms. Consent is not a
> condition of rental." Message frequency varies; message & data rates may apply;
> reply STOP to opt out and HELP for help. Mobile opt-in data and consent are
> never shared with third parties or affiliates for marketing. Privacy Policy:
> https://<your-domain>/privacy

**Sample messages** (provide 3–5; at least one MUST include the brand name AND
"Reply STOP to opt out"):
1. `[Brand]: Your booking is confirmed for Jun 28 at 10:00 AM. Reply STOP to opt out, HELP for help.`
2. `[Brand]: Reminder — your rental begins tomorrow at 10:00 AM. Please have your driver's license and ID ready. Reply HELP for help.`
3. `[Brand]: Your vehicle is ready for pickup. Reply here with any questions, or STOP to opt out.`
4. `[Brand]: Your rental has been extended to Jul 2. Updated total: $320. Reply HELP for help or STOP to opt out.`

**Opt-out keywords:** `STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT`
**Opt-out message:** `You have been unsubscribed and will receive no more messages. Reply START to resubscribe.`
**Help keywords:** `HELP, INFO`
**Help message:** `[Brand] support. Reply STOP to unsubscribe. Msg & data rates may apply.`

**Embedded links:** Yes (we send secure payment/e-sign links)
**Embedded phone numbers:** Yes (support number may appear)

---

## Why this passes (the 3 things reviewers check)
1. **Opt-in is publicly verifiable** — the `/sms-opt-in` URL renders the exact
   checkbox + consent wording with no login and no JS required, so the reviewer
   sees it instantly.
2. **Privacy policy has the carrier-required clause** — "No mobile information /
   SMS consent is shared with third parties or affiliates for marketing."
3. **Sample messages match the use case** and carry brand name + STOP language.

## Common rejection causes (avoid these)
- ❌ Saying opt-in happens "by calling us" or "verbally" for a web-form campaign.
- ❌ Pointing to a homepage where the checkbox isn't visible.
- ❌ Privacy policy with no SMS / no third-party-sharing clause.
- ❌ Sample messages with no brand name or no STOP instruction.
- ❌ Pre-checked consent box, or making consent a condition of renting.
