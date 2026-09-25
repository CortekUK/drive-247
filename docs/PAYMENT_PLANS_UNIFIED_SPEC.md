# Payment plans — unified model

**Source:** Ghulam's walkthrough, recorded Thu 24 Sep 2026, 17 minutes, with the
Excalidraw board "Payment plan and payments in general". This document is a
faithful restatement in English of what was asked for, with the decisions
separated from the open questions. Where the recording is ambiguous it says so
rather than guessing.

**Audience:** whoever builds and reviews this. Quotes are the lead's own words,
translated.

---

## 1. Why this one is different

> "Neither I nor any QA will test these. Your word will be it. These things
> will go out."

and, thirteen minutes later:

> "Payments are too risky for us to take your word. We'll accept evidence only.
> Proper testing will happen."

Both were said. They are not a contradiction — they are the standard:

- **No one else is going to catch a mistake here.** There is no QA pass behind
  this work.
- **Therefore "I tested it" is not the deliverable.** The deliverable is
  evidence: a reviewer must be able to re-run what was tested and see the same
  result.
- "V2 took us time. We have to make this a solid foundation." "This time there
  isn't even a second chance." "Two or three reviews per feature are not
  possible."
- "This is the thing where we are at zero risk" — i.e. must be.

**Deadline as stated:** "Give it to me by before Friday." The recording is
Thursday 24 Sep, so that is Friday 25 Sep. See §12 for what that means against
the size of the ask.

---

## 2. What is, and is not, a payment plan

Five things exist in the product today:

| Thing | Is it a payment plan? |
|---|---|
| Simple booking | No |
| Extension | No (today) |
| Auto extension | No (today) — but see D1 |
| Pay as you go (PAYG) | **Yes** |
| Installment | **Yes** |

> "Simple booking, extension and auto extension — put them in one box for now,
> because they are not payment plans. The payment plans are these two: pay as
> you go, and installment."

**The core task:**

> "I want you to build the logic somehow and FUSE these two together. Fuse pay
> as you go and installment. You have the full context. Find the common ground
> and extract one thing out of it. We will call that thing **payment plan**."

Both a **customer** and an **admin** must be able to create any kind of payment
plan, of any shape.

**The user must never be told which one they are using.**

> "We don't have to tell them 'this is the pay as you go plan' and 'this is the
> installment plan'."

PAYG and installment are internal characterisations, not labels, not tabs, and
not a choice presented to anyone.

---

## 3. The shape of a plan (the worked examples)

The lead gave these as "one case out of millions — but we have to cover all the
million cases. Our solution has to be that dynamic."

**Example A — PAYG-shaped.** Admin is me; Abu Bakr is my customer. I want him
to pay **every Friday**. On each due date I want one of exactly three things to
happen:

1. **Auto charge** his saved card, or
2. **Send him a link** (checkout), or
3. **Add the payment manually** myself.

> "Those are the only three options I have."

**Example B — the anchoring problem.** "Every third day", or "every Wednesday".
The rental does not necessarily start on a Monday — it might start on a
Wednesday, so the weekly date lands there instead.

> "So how will that third day be defined? You have to make this easy for them,
> properly, in a **calendar view**."

**Example C — installment-shaped.** Same customer, no "every third day": take a
payment **every three weeks**, or **bi-weekly**, or **twice a week**.

**Around all of it:** "a whole web of reminders."

**Requirement:** one schedule model that expresses all of the above — a weekday
anchor, an interval, an interval unit, a count or an end, an anchor that may be
the rental's own start date, and a per-occurrence collection method from the
three above. The calendar view is how the operator *sees* what they just
described, not a second way of describing it.

---

## 4. D1 — the boundary decision (the green line)

This is the one genuinely open architectural question in the recording, and the
lead was explicit that he had not decided:

> "Now I'm confused about this. I don't know what decision to make. Should we
> put auto extension into payment plan too? Should we simplify further — do we
> draw our extension boundary from *here*, or from *here*? That's the question."

His leaning, stated twice:

> "I would love a simpler process... Draw the extension boundary from this
> side. Simple booking should be its own thing, and we do the whole circus on
> top of it. This way our spine stays more protected."

> "So one gateway. I think we should go with the **green** option, so there are
> fewer spectacles for us. But still, if you have better arguments for this
> line, it's fine."

**What "the green option" means in practice:** simple booking stays a plain
thing on its own. Everything else — extension, auto extension, PAYG,
installment — is reached through **one** entry point.

**The flow he described:**

- The operator presses **one button: "Payment plan"**.
- It asks them a set of questions — "what kind of recurring do you want? daily
  recurring?" — and they fill in fields.
- **It must NOT be a three-way menu.** He rejected that explicitly:

> "It shouldn't be that I click payment plan and it gives me three options —
> 'you want auto extend, extend, pay as you go, installment'. No. That's just
> the previous design with a dialogue box in the middle. No."

- **Same fields for everything.** One form, whose answers happen to produce an
  extension, an auto extension, a PAYG schedule or an installment schedule.

> "The same fields will be there... Then one proper thing gets built, and the
> four base cases — extension, auto extension, pay as you go, installment — and
> all the preliminary cases on top of them, all get covered."

- He accepts the cost: "That form will be somewhat comprehensive. That part I
  get."

**Why he wants it — this is the part worth keeping in mind while building:**

1. **No per-customer justification.** "We won't have to justify every single
   person through extension, auto extension, PAYG, installment."
2. **One centre point to test.**
3. **Building blocks.** "We'll have one building block for recurring crons —
   auto extension, PAYG and installment all run crons. So with ONE simulation
   we can see whether the mechanism is behaving."
4. **One entry point into the danger zone.** "We'll have a single entry point
   to the danger zone — the complex part of the application, which is the part
   after this green line. Then we can watch it properly."

**Status: DECIDED-BY-DEFAULT, REVERSIBLE.** Build the green option unless there
is a better argument; if there is, put it to him before building.

---

## 5. Collection, reconciliation and the money story

### 5.1 Taking payment

Three methods, and only these three:

- **Checkout link**, sent by email.
- **Auto charge** — "mainly it has to be done from Stripe."
- **Manual** entry by the operator.

**Explicitly dropped:** the old "checkout opens on the spot" behaviour.

> "That thing we used to do where checkout opens on the spot — it's not needed,
> leave it. We'd taken an overhead there too: I had to check separately, and
> then auto charge the card afterwards."

Reminders hang off the schedule ("I should be able to set reminders on it, so
and so forth").

### 5.2 Stripe / Square identity — required

> "Whatever payment happens via Stripe, the Stripe payment ID will appear
> there, and next to it a link that takes you to that individual payment in the
> dashboard. I'm talking about Stripe's dashboard — so that they can reconcile."

Same for Square. This is a reconciliation requirement, not a nicety.

### 5.3 Manual reconciliation — "this is the most important point"

> "If I want to reconcile something manually — payment drift has happened, I
> want to rearrange things and bring them back — how will I do that?"

Requirements:

- Reconciliation is possible **at any point**, with **no blockers**.
  > "There shouldn't be a blocker at any point — 'oh well, the money got
  > missed, so are we defeated now?'"
- Changing a plan mid-life must be **smooth**. "If he wants to change the plan
  at any moment, that has to be a smooth process."
- The individual-charging behaviour from the old payment breakdown stays in
  scope: individual refunds, partial refunds, and the deposit handling that was
  pulled into the transaction view.

### 5.4 Show the math — tell the whole story

> "Show him the math. Tell him this whole story: this is what happened, this is
> what was taken, this is what remains, and this is how you have to pay."

> "If we do this, we'll be rid of our own queries — how many days, what
> happened, what's been taken, what's left."

And the recovery case:

> "Secondly: this happened, you missed this, and here's how you can resolve
> it."

with his own small example: if they simply forgot to enter a day's payment,
the system should offer to generate a payment link (or the equivalent) that
states what the situation is under that rental, or what can be done under the
payment plan.

---

## 6. Extension and auto extension

Work order, from the recording: **verify simple booking first**, then extension,
then auto extension.

> "First you have to start with whether simple booking is even working or not.
> Simple booking is happening, the numbers are all coming to me correctly. Then
> you have to extend it."

Open questions he raised about extending, each of which needs a verified answer:

- **Bonzah**: "does Bonzah extend for me?"
- **Agreement**: is an agreement sent on extension? Should we ask the operator
  whether to send one? If we do send one, **is it an updated agreement**? How
  are extension agreements managed separately?
- **Payments**: "what's the scene with extension payments?"

---

## 7. Finances — the tab merge

> "We have to merge the payments, invoices and fines tabs. The merged tab's name
> will be **Finances**."

Inside it:

- All invoices, viewable.
- Individual payment links and auto charge, actionable from there.
- **Fines stay.** "We didn't give fines that much attention, but still fines
  should be there." Individual rentals should also have a fine element.

---

## 8. Customer balance

> "The admin's mind works like this: how much does this customer owe me."

- The **Customer tab** must show the whole picture, and be a place to act from.
- Worked flow: if Ghulam owes Kristen 300 USD, Kristen works in the customer
  tab — creates the link there, writes what the payment is for — and **Ghulam's
  balance updates from there**.
- **Manual adjustment both ways.** "She can move my balance up and down
  herself" — on the rental's balance and on the individual customer account —
  "so that it matches her own mental math." Example: knock 30 USD off in the
  rental, or off the individual customer account.
- **Off-platform credit**: "she gives me some money as credit, which she has
  actually taken from me outside the platform, but she wants it mentioned
  here."
- He flagged the overlap himself: "this will relate very closely to manual
  payments — almost the same thing, but there will be some caveats."

---

## 9. Testing — the acceptance condition

This is the part that decides whether the work is accepted.

- **Whatever way it is tested, he must be able to test it the same way.**
  > "However you test it, make sure I can test it that same way."
- **It goes in the Developer tab.**
  > "Put the testing in the developer tab. It'll be easier for me to test it
  > properly. These things will get used later too."
  > "If you've already built a simulation in the developer tab, you can
  > reference that and do all of it."
- **Every branch, simulated.**
  > "By testing environment I mean this whole simulation — we should be able to
  > test each and every branch. There shouldn't be anything where, when I sit
  > down to test it, [it can't be reached]."
- **Not on a hunch, and more than once.**
  > "We won't take a feature this important on a hunch. You have to test every
  > possible thing, and multiple times."
- **One simulation for the recurring engine.** Per §4: because auto extension,
  PAYG and installment all run crons, a single simulation should exercise that
  one building block.

---

## 10. Preparation he explicitly asked for

> "Sit with Claude properly and put the time in — sorry, put the *thinking* in
> — on how we can sort this thing out. Every possible case."

> "You've worked on this feature the most, Haseeb. So every problem a customer
> has is one of our cases."

> "If you're not in the habit of using Excalidraw, do this bit on pen and
> paper. But until you've done this on pen and paper, the idea of how we are
> going to fuse these payment plans will not settle in your head."

Two axes of quality, named separately:

1. **Smooth** — the user experience. "The thing must not be bad UX-wise,
   there's no point otherwise. And the obvious things must not break now
   either."
2. **Solid** — the drifting, reconciliation and correctness side.

---

## 11. Board reference

The Excalidraw board shows, in the lead's own hand:

- A box titled *Payment plan and payments in general* listing: simple booking,
  extension, auto extension, PAYG, installment — with a **green** line drawn
  under "simple booking" and a **red** line drawn under "auto extension". Those
  two lines are the two boundary options in D1.
- `payments/invoices/fines` → `auto charge` (the §7 merge).
- `PYG + installment → payment plan` (the §2 fusion).
- A `recurring` box beside a `payment plan` box (the §4 building block).
- A note listing: `payment — checkout link / manual / auto charge / refunds /
  customers balance` (§5, §8).

---

## 12. Scope reality against the stated deadline

Stated: before Friday 25 Sep. What is being asked for is, in engineering terms:

1. One unified schedule/plan model that replaces four behaviours.
2. One entry-point form that produces all four.
3. One recurring engine with a single simulation.
4. A merged Finances area.
5. Customer balance with two-way manual adjustment and off-platform credit.
6. Stripe/Square ID surfacing with dashboard deep links.
7. A Developer-tab simulation covering *every branch*.
8. Verified answers on extension: Bonzah, agreements, payments.
9. Evidence — not assurance — for all of it, on the money path.

That is not a Friday. Pretending otherwise on a payments rebuild is the exact
risk the recording is trying to eliminate. What follows must therefore be
agreed, not assumed:

- **What can be honest by Friday:** this spec, a verified map of what exists
  today versus what §2–§9 require, the D1 recommendation with its argument, and
  the first slice built behind the developer tab with its simulation.
- **What must not be rushed:** anything that changes how money is captured,
  refunded or reconciled on a live tenant.

Open questions for the lead are tracked in §13.

---

## 13. Open questions

1. **D1** — green (one gateway for extension + auto extension + PAYG +
   installment) versus red (extension/auto extension stay outside). His leaning
   is green; confirm before the schema is cut.
2. **Customer-created plans** — §2 says a customer can create any kind of plan.
   Does that mean self-serve from the customer portal, and if so with what
   limits and what approval?
3. **Twice a week** — is that two fixed weekdays, or every 3–4 days?
4. **Extension inside a plan** — if green wins, does extending a rental still
   move the rental's end date as it does today, or does the plan own that?
5. **Off-platform credit** — does it affect the tenant's revenue figures and
   the ledger, or is it a display-only adjustment on the balance?
6. **Fines in Finances** — merged into the same list, or a section of their own
   inside the tab?
