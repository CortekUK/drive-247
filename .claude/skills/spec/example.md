# Example spec

One spec from a made-up feature (the "Birthday discount for renters" in the `prd` skill's
example). It shows the shape and how exact the statements should be. The feature does not exist.

Its feature would have about four specs:

| Spec | Part |
|---|---|
| `01-setting.md` | The operator's on/off switch |
| `02-eligibility.md` | Who gets the discount, and when (this example) |
| `03-email.md` | The birthday email and when it is sent |
| `04-price-step.md` | What the renter sees at the price step |

---

# Spec 02 · Who gets the birthday discount

**Feature:** feat-000 · Birthday discount for renters · **PRD stories:** 3, 4, 5, 6 · **Status:** Draft

## What this covers

The rule that decides whether a booking gets the birthday discount, and how much it is. It does
not cover the email (spec 03) or how the price is shown (spec 04).

## Behaviour

- **02.1** A booking gets the discount when the operator has the setting on, the renter has a
  date of birth, the renter has at least one completed rental with this operator, and the rental
  starts inside the renter's birthday week.
- **02.2** The birthday week is the 3 days before the birthday, the birthday, and the 3 days
  after, in the operator's timezone. A rental starting at 23:59 on the last day is inside; one
  starting at 00:00 the next day is outside.
- **02.3** The discount is 10% of the rental price, rounded to the cent. Extras, insurance and
  the deposit are not reduced.
- **02.4** A renter born on 29 February has their birthday on 28 February in a year that is not
  a leap year.
- **02.5** A renter with no date of birth gets no discount.
- **02.6** A renter with no completed rental with this operator gets no discount, even with
  completed rentals at another operator.
- **02.7** A renter who already has a birthday booking this calendar year with this operator
  gets no discount on a second one. A cancelled booking does not count as used.
- **02.8** When the booking has another discount, the larger of the two applies and the other is
  dropped. If they are equal, the other discount is kept.
- **02.9** With the operator's setting off, no booking gets the discount, whatever else is true.

## Worked examples

Rental price only; extras and insurance are left out before the discount is taken (02.3).
Rounding: to the cent, half up, once, on the discount itself.

| # | Rental price | Working | Discount | Renter pays for the rental |
|---|---|---|---|---|
| 1 | $300.00 | 30000 × 0.10 = 3000.0 | $30.00 | $270.00 |
| 2 | $149.99 | 14999 × 0.10 = 1499.9, rounds up to 1500 | $15.00 | $134.99 |
| 3 | $0.05 | 5 × 0.10 = 0.5, rounds up to 1 | $0.01 | $0.04 |
| 4 | $0.04 | 4 × 0.10 = 0.4, rounds down to 0 | $0.00 | $0.04 |
| 5 | $12,500.00 | 1250000 × 0.10 = 125000.0 | $1,250.00 | $11,250.00 |
| 6 | $300.00, with a 15% promo already on | 15% ($45.00) is larger than 10% ($30.00): promo kept, birthday dropped (02.8) | $0.00 | $255.00 |
| 7 | $300.00, with a 10% promo already on | Equal: the other discount is kept (02.8) | $0.00 | $270.00 |

## Database

Migration `supabase/migrations/20270101120000_birthday_discount.sql`.

- `tenants.birthday_discount_enabled boolean not null default false`.
- `rentals.birthday_discount_cents integer not null default 0`, check `>= 0`.
- No new table, no new policy: both columns sit under the existing policies of their tables.

## Functions

`birthday_discount_cents(p_tenant_id uuid, p_customer_id uuid, p_start timestamptz, p_rental_cents integer) returns integer`

- A database function, `security definer`, `search_path = public`. Called by the one price
  calculator; no app calls it directly.
- Returns the discount in cents, `0` when the booking does not qualify.
- Raises nothing: an unknown tenant or customer returns `0`.

## Screens

None. (Spec 04.)

## Money and safety

This reduces what a renter pays. The reduction is worked out on the server by the function
above and never taken from the browser. It cannot exceed 10% of the rental price, and it cannot
be combined with another discount (02.8).

## Proof

| Statement | Proved by |
|---|---|
| 02.1, 02.2, 02.4 to 02.7, 02.9 | `evals/02-eligibility.mjs` |
| 02.3, 02.8 (math) | `evals/02-eligibility.test.ts` (Vitest, all 7 worked examples) and the QA report |

## Not in this spec

- Letting an operator choose the percentage. Not being built.
- Sending the email (spec 03) and showing the price (spec 04).
