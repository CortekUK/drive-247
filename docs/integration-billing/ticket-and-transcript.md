# Integration subscriptions — ticket and transcript (as given, Sep 22 2026)

## Ticket

**Description.** Premium integrations get their own monthly price, shown clearly and added to the operator's subscription bill.

**Supercut video.** "Integration subscriptions: premium pricing and how it's billed" (10:07), `https://supercut.ai/share/NOaHTOLu5xT9r4VXt2E3uc`.

**Area.** Portal → Integrations, plus the operator's subscription and invoices.

**Items.**
- **Premium integrations (01:35).** A premium integration carries its own monthly subscription on top of the software subscription. The video's example is $200 for the software plus an extra $20.20.
- **Free vs premium (01:35).** Make it clear which integrations are free and which are premium.
- **Insurer integration (03:35).** The insurer integration has its own subscription fee ($20 in the video). Show the insurer and platform subscription costs clearly.
- **Billing (04:53).** When an operator turns on a premium integration, its cost is added to their next bill and to every invoice after that.

**Branch.** `haseeb/subs-integration`. **Env changes.** None.

**Notes.**
- The ticket is a draft built from chapter notes; the transcript below sharpens it.
- The prices are the video's examples; confirm the real ones with Ghulam.
- This touches real billing. Keep it northwind-only, and add new functions rather than editing the existing subscription ones.
- v2 only: northwind gets it, and every other tenant keeps their current billing.

## Transcript gist (Hindi/Urdu, translated; timestamps from the video)

- **[00:29–01:22]** End the credits system end to end. Operators see credits as a second payment: they already pay for the base software, then pay credits again to send an agreement. So credits go.
- **[01:34]** Split the integrations into two categories: premium and free.
- **[01:43–02:03]** Inshur is an example premium integration. It shows a small crown somewhere on the card, meaning paid. The operator can still open it and read about it.
- **[02:12–02:38]**
  - There is a Subscribe button, and it should create FOMO.
  - Pressing Subscribe takes the payment inside the same dialog, the way onboarding does.
  - The operator should not have to scroll.
- **[02:46–03:32]** The model:
  - The first month is free, for premium subscriptions too.
  - After that, say Inshur is $20: with the software at $200, the $20 is added to the subscription.
  - The invoice shows "platform subscription 200" and "Inshur subscription 20 USD".
- **[03:44–04:19]** Every month after the first, the $20 is charged automatically, as one bill. No buying credits and entering a card at the end of the month.
- **[04:26–04:55]** The gap:
  - If the plan bills on the 15th and Inshur is taken on the 20th, Drive247 bears that gap too.
  - The wording is "$20 will be added to your next bill".
  - It is charged together with the platform fee.
- **[05:17–06:00]** Super admin controls:
  - which integrations are premium;
  - the monthly price;
  - whether the first month is free.

  No free/premium filter is needed ("we don't have that many things").
- **[06:11–06:27]** Billing → Next invoice:
  - say when the next invoice comes;
  - show 200 and 20 on two separate lines, never "220". This is important.
- **[06:34–07:04]** Turo Sync could be paid; we will decide on the spot which are paid. BoldSign is free: credits come off it. To test, make any integration paid.
- **[07:15]** Simulate the billing day and check that it works.
- **[07:30–07:50]** Access is controlled by the subscribe flow itself; super admin doesn't need more for that.
- **[07:50–08:42]** More super-admin controls:
  - hide any integration;
  - a Beta flag;
  - "Not available", which dims the card slightly.

  These go in a new super-admin tab named Integrations. Crown and beta placement are to be adjusted.
- **[08:42–09:02]** Credits in Billing is a separate vertical, so remove it. We can't cut everyone off yet, so for now all of this is for Northwind only.
