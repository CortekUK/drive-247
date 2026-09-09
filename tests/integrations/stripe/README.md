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

So this folder is **scaffolded, not filled**. The structure was agreed, so it
exists and it runs; the payments surface was explicitly out of scope, so it has
not been built out. What is here:

| File | What it asserts today |
|---|---|
| `checkout.test.ts` | The signup checkout payload — the browser cannot name the price, and the money that reaches Stripe comes from the plan the operator was shown. |
| `refund.test.ts` | `process-refund`'s request contract, derived from its source the same way the spine derives its own. Proves the helper generalises past onboarding. Behavioural cases are `todo`. |
| `partial-payment.test.ts` | The category-and-amount fields a partial refund depends on. Behavioural cases are `todo`. |

`test.todo` is not a placeholder for its own sake. It prints in the run output
as a named, unwritten case, so the list of what Stripe can do to us stays
visible in the test report instead of living in someone's head.

## What belongs here when this folder is filled in

One file per **case**, named after the case and not after the function:

- `checkout.test.ts` — a payment that succeeds
- `refund.test.ts` — a full refund
- `partial-payment.test.ts` — a partial refund, and the FIFO category order it
  has to respect
- future: `preauth.test.ts`, `installments.test.ts`, `connect-onboarding.test.ts`,
  `webhook-replay.test.ts`, `dispute.test.ts`

## The rules are the same as the spine's

Both layers apply here too, and Layer 2 matters more in this folder than in the
spine, because Stripe writes are third-party writes with no `DELETE`:

- **Layer 1** — contract only, no network, always runs.
- **Layer 2** — gated behind `D247_LIVE_TESTS=1` plus an explicit target, and
  `tests/helpers/live-call.ts` refuses the production project ref outright.

A refund test that runs against production does not fail loudly. It moves
somebody's money.
