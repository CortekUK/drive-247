# Example evals

The two evals for the made-up spec in the `spec` skill's example ("Spec 02 · Who gets the
birthday discount"). The feature does not exist, so these do not run: they show the shape.

## `evals/02-eligibility.mjs`

```js
import { statement, cleanup, run, sql, equal } from "../../eval-kit.mjs";

// The northwind tenant is the one thing an eval may assume is on staging.
const [{ id: tenant }] = await sql(`select id from public.tenants where slug = 'northwind'`);

/** A renter made for this eval, removed at the end. `born` is YYYY-MM-DD or null. */
async function renter(born, { completedRentals = 1 } = {}) {
  const [{ id }] = await sql(`
    insert into public.customers (tenant_id, name, email, date_of_birth)
    values ('${tenant}', 'Eval Renter', 'eval-${crypto.randomUUID()}@example.com', ${born ? `'${born}'` : "null"})
    returning id`);
  cleanup(() => sql(`delete from public.customers where id = '${id}'`));
  for (let i = 0; i < completedRentals; i++) {
    const [r] = await sql(`insert into public.rentals (tenant_id, customer_id, status) values ('${tenant}', '${id}', 'Closed') returning id`);
    cleanup(() => sql(`delete from public.rentals where id = '${r.id}'`));
  }
  return id;
}

const discount = async (customer, start, cents = 30000) =>
  (await sql(`select public.birthday_discount_cents('${tenant}', '${customer}', '${start}', ${cents}) as c`))[0].c;

// The setting is switched on for the eval and put back as it was.
const [{ was }] = await sql(`select birthday_discount_enabled as was from public.tenants where id = '${tenant}'`);
await sql(`update public.tenants set birthday_discount_enabled = true where id = '${tenant}'`);
cleanup(() => sql(`update public.tenants set birthday_discount_enabled = ${was} where id = '${tenant}'`));

statement("02.1", "A qualifying booking in the birthday week gets the discount", async () => {
  equal(await discount(await renter("1990-03-10"), "2027-03-10T15:00:00Z"), 3000, "discount");
});

statement("02.2", "The week is 3 days either side, to the minute, in the operator's timezone", async () => {
  const r = await renter("1990-03-10");
  // northwind is on America/New_York: 13 Mar 23:59 local is 14 Mar 03:59 UTC.
  equal(await discount(r, "2027-03-14T03:59:00Z"), 3000, "23:59 on the last day");
  equal(await discount(r, "2027-03-14T04:00:00Z"), 0, "00:00 the next day");
  equal(await discount(r, "2027-03-07T05:00:00Z"), 3000, "00:00 on the first day");
});

statement("02.4", "A 29 February birthday falls on 28 February outside a leap year", async () => {
  equal(await discount(await renter("1992-02-29"), "2027-02-28T15:00:00Z"), 3000, "discount");
});

statement("02.5", "A renter with no date of birth gets no discount", async () => {
  equal(await discount(await renter(null), "2027-03-10T15:00:00Z"), 0, "discount");
});

statement("02.6", "A renter with no completed rental here gets no discount", async () => {
  equal(await discount(await renter("1990-03-10", { completedRentals: 0 }), "2027-03-10T15:00:00Z"), 0, "discount");
});

statement("02.9", "With the setting off, nobody gets it", async () => {
  const r = await renter("1990-03-10");
  await sql(`update public.tenants set birthday_discount_enabled = false where id = '${tenant}'`);
  try {
    equal(await discount(r, "2027-03-10T15:00:00Z"), 0, "discount");
  } finally {
    await sql(`update public.tenants set birthday_discount_enabled = true where id = '${tenant}'`);
  }
});

await run(import.meta.url);
```

(02.7 is left out here to keep the example short. A real eval has every statement its spec's
Proof table gives it.)

## `evals/02-eligibility.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { birthdayDiscountCents, largerDiscountWins } from "../../../../supabase/functions/_shared/birthday-discount-rules";

describe("02 who gets the birthday discount", () => {
  // Worked examples 1 to 5 from the spec, in order: rental cents, discount cents.
  it.each([
    [1, 30000, 3000],
    [2, 14999, 1500],
    [3, 5, 1],
    [4, 4, 0],
    [5, 1250000, 125000],
  ])("02.3 #%i a rental of %i cents is discounted by %i", (_row, rental, expected) => {
    expect(birthdayDiscountCents(rental)).toBe(expected);
  });

  it("02.3 the discount is always a whole number of cents", () => {
    for (const rental of [0, 1, 7, 333, 14999, 99999]) expect(Number.isInteger(birthdayDiscountCents(rental))).toBe(true);
  });

  // Worked examples 6 and 7.
  it("02.8 #6 a larger promo wins and the birthday discount is dropped", () => {
    expect(largerDiscountWins({ birthdayCents: 3000, otherCents: 4500 })).toEqual({ birthdayCents: 0, otherCents: 4500 });
  });
  it("02.8 #7 when they are equal the other discount is kept", () => {
    expect(largerDiscountWins({ birthdayCents: 3000, otherCents: 3000 })).toEqual({ birthdayCents: 0, otherCents: 3000 });
  });
});
```

## What the run prints

```
02-eligibility.mjs
  pass  02.1  A qualifying booking in the birthday week gets the discount
  pass  02.2  The week is 3 days either side, to the minute, in the operator's timezone
  ...
02-eligibility.test.ts
  pass  02.3  #1 a rental of 30000 cents is discounted by 3000
  ...

Wrote docs/application/feat-000-birthday-discount/evals/RESULTS.md

EVALS feat-000  9/9 statements proved
```
