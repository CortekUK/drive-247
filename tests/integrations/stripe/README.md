# `integrations/stripe`

## Why this folder exists

> "main ek TEST CASE ka folder banaun, to uske neeche STRIPE ka folder bana kar
> uske andar jitne bhi Stripe ke possible test cases hain — like REFUND,
> PARTIAL PAYMENT — wo saare daal ke."
> — Haseeb. Ghulam: *"bilkul exactly, waise hi karenge hum."*

The model is the spine and the integrations around it:

```
                    Bonzah
                      |
        Square  ---  SPINE  ---  Stripe
                      |
                    INSHUR
```

`tests/spine/` is the spine. This folder is the first of the rings around it.
One folder per third party; inside it, one file per case that third party can
put the platform in.

## What is here today, and what is deliberately not

The scope limit from the same conversation:

> "yeh automatic test sirf abhi sirf yeh ONBOARDING FLOW tak hi honge."

Three cases, exactly the ones the meeting named — **refund, partial payment,
checkout** — and no more. The rest of the payments surface is still out of
scope. There are **no `test.todo` placeholders left**: every case named in this
folder is implemented, in the same two layers as the spine.

| File | Layer 1 — contract, no network, always runs | Layer 2 — live, opt-in |
|---|---|---|
| `checkout.test.ts` | The browser cannot name the price; the plan card's currency, interval and floor; `default_incomplete` so nothing is charged before the card confirms; no `tenant_id` in Stripe metadata; the three values the confirm handshake needs; one subscription reused across declines. | Confirms a real test-mode PaymentIntent and checks the signup flips to paid; and a declined test card leaving the subscription incomplete. |
| `refund.test.ts` | `process-refund`'s request contract, derived from its source (a destructured body — a shape the signup functions never use, so it also proves the helper generalises). The over-refund guard and the Extension guard are asserted to sit **above** `stripe.refunds.create`. The response's `ledgerRecorded` / `requiresReconciliation` split. | The Extension guard answering on a real deployment; an over-large refund refused by our arithmetic rather than by Stripe; a full refund returning 200 with the ledger row recorded. |
| `partial-payment.test.ts` | Amount + category + type; `apply-payment` settling Security Deposit last; the `categoryCap` clamp; the Refunded/Partial-Refund threshold and the double-count guard; already-refunded subtracted from the ceiling. | A partial drawing only from the category it names; one that exceeds the balance refused; two partials summing to the whole. |

### The FIFO case, and why it is not called that any more

The scaffold listed `live: a partial refund draws from categories in FIFO
order`. Reading `process-refund` and `apply-payment` shows the premise is
inverted, and this folder's own rule is that encoding a wrong order as correct
is worse than having no test. What is actually true:

- a refund does **not** walk the categories — it **names** one, and every read,
  guard and ledger row is scoped to it;
- FIFO lives on the way IN, in `apply-payment`, where it decided how much of the
  payment landed in each category and wrote that to
  `payment_applications.amount_applied`;
- `process-refund` reads that back as `categoryCap` and clamps with it.

So FIFO does bind a partial refund — as the *record* of what a payment put into
a category, not as an order that gets re-walked. Both halves are asserted,
because the guarantee only holds while both are in place.

## What belongs here next

One file per **case**, named after the case and not after the function. Written:
`checkout.test.ts`, `refund.test.ts`, `partial-payment.test.ts`. Not written, and
not in scope until the meeting says so: `preauth.test.ts`,
`installments.test.ts`, `connect-onboarding.test.ts`, `webhook-replay.test.ts`,
`dispute.test.ts`.

## The rules are the same as the spine's

Both layers apply here too, and Layer 2 matters more in this folder than in the
spine, because Stripe writes are third-party writes with no `DELETE`:

- **Layer 1** — contract only, no network, always runs.
- **Layer 2** — gated behind `D247_LIVE_TESTS=1` plus an explicit target, and
  `tests/helpers/live-call.ts` refuses the production project ref outright.

A refund test that runs against production does not fail loudly. It moves
somebody's money. So the money cases in this folder sit behind a **third rung**
that the signup writes never needed:

```bash
D247_LIVE_TESTS=1 \
D247_LIVE_FUNCTIONS_URL=https://<non-prod-ref>.supabase.co/functions/v1 \
D247_LIVE_ANON_KEY=<that project's anon key> \
D247_LIVE_ALLOW_WRITES=1 \
D247_LIVE_ALLOW_MONEY_MOVEMENT=1 \
D247_LIVE_STRIPE_MODE=test \
D247_LIVE_PORTAL_JWT=<head_admin/admin access token> \
D247_LIVE_REFUND_RENTAL_ID=<a rental with settled money on it> \
npm run test:spine
```

| variable | why it exists |
|---|---|
| `D247_LIVE_ALLOW_MONEY_MOVEMENT=1` | The third yes. `ALLOW_WRITES` covers rows we own and can delete; a Stripe refund is a third-party write with no `DELETE`. |
| `D247_LIVE_STRIPE_MODE=test` | The Supabase guards prove which *database* this is. They prove nothing about Stripe — `tenants.stripe_mode` is a per-tenant column, so a non-prod project can hold a tenant on live keys. This is a **declaration**, and unset means refused. |
| `D247_LIVE_PORTAL_JWT` | `process-refund` resolves the caller through `app_users` and needs head_admin/admin (or a manager with EDITOR on payments). Not the same token as the spine's `D247_LIVE_SESSION_JWT`, whose signup user has no `app_users` row at all. |
| `D247_LIVE_REFUND_RENTAL_ID` | The rental these cases may refund from. Never inferred: guessing a rental to refund is the payments-surface version of guessing a project ref. |
| `D247_LIVE_REFUND_CATEGORY` | Optional, default `Rental`. |
| `D247_LIVE_REFUND_AMOUNT` | Optional, default `1`. |
| `D247_LIVE_FULL_REFUND_RENTAL_ID` | Optional second rental for `refund.test.ts`'s full-refund case, because `partial-payment` sorts first and deliberately spends the shared fixture to zero. |

Every one of those is checked before the first HTTP call, and a half-configured
money run is a hard throw rather than a skip — the same treatment
`D247_LIVE_TESTS=1` with no target gets, for the same reason.

**The fixtures are one-shot.** The money cases spend a real balance, so a second
pass against the same rental skips with a message saying so. A drained fixture
is not a code failure and is never reported as one.

One live case needs none of that: the Extension-guard probe in `refund.test.ts`
runs on `D247_LIVE_TESTS=1` alone, against a rental id that cannot exist. It is
this folder's equivalent of the spine's `signup-slug-check` — the case that
proves the harness reaches a real deployed function without touching anything.
