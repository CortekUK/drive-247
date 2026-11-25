---
name: eval
description: Write the evals for a Drive247 feature, or run them. Use when someone says "write the evals for X", "eval this spec", "/eval", "run the evals", or has specs that are not yet proved. An eval is a script that proves a spec's numbered statements against staging and prints pass or fail. Money math is proved in Vitest. It is step 3 of a feature: PRD, then specs, then evals, then the QA report.
---

# Eval

A spec says how a part of a feature behaves, as numbered statements. An **eval** proves those
statements are true, by running. Nobody reads an eval to believe it: they run it.

| File | What it is |
|---|---|
| `docs/application/feat-NNN-name/evals/NN-short-name.mjs` | Proves spec NN's statements against **staging** |
| `docs/application/feat-NNN-name/evals/NN-short-name.test.ts` | Proves spec NN's **math**, every worked example, in Vitest |
| `docs/application/feat-NNN-name/evals/RESULTS.md` | The last full run. Written by the command, committed, goes with the PR |
| `docs/application/eval-kit.mjs` | What every `.mjs` eval is built from |

One eval per spec, with the same number and name as the spec. A spec with math has both files.

```bash
npm run eval -- feat-001        # every eval of the feature; rewrites RESULTS.md
npm run eval -- feat-001 02     # only spec 02's evals, while you work on them
```

It needs `.staging-credentials.local` in the repo root, and `SUPABASE_ACCESS_TOKEN` in the
environment for evals that run SQL. The last line is the answer:

```
EVALS feat-001  23/23 statements proved
```

## What an eval may and may not do

| It does | It never does |
|---|---|
| Runs on **staging** | Touches production. The kit refuses the production project. |
| Calls the database, the API and edge functions the way the apps do | Opens a browser, or imitates one. What only a browser can show goes to the QA report. |
| Removes everything it creates, pass or fail | Leaves test rows, files or users behind |
| Gives the same answer every time it runs | Depends on the time of day, on a row someone else made, or on the order evals run in |
| Uses Stripe's test mode on staging when it must | Sends an email or a text to a real person |

## One check per statement

Every Behaviour statement the spec's Proof table gives to an eval gets a `statement()` with the
same number and the same words:

```js
import { statement, cleanup, run, sql, rest, fn, signIn, LOGINS, equal, ok } from "../../eval-kit.mjs";

statement("02.5", "A renter with no date of birth gets no discount", async () => {
  const [row] = await sql(`select public.birthday_discount_cents('${tenant}', '${renter}', '2027-03-10T10:00Z', 30000) as cents`);
  equal(row.cents, 0, "discount");
});

await run(import.meta.url);   // always the last line
```

The kit gives you:

| | |
|---|---|
| `sql(query)` | Run SQL on staging: to set a case up, and to look at what really happened |
| `rest(path, { method, body, as })` | A table call through the API, so row-level security applies |
| `fn(slug, body, { as })` | Call an edge function |
| `signIn(LOGINS.portal)` / `signIn(LOGINS.admin)` | A token for the northwind head admin, or the super admin. Pass it as `as` |
| `as: "anon"` (the default) / `as: "service"` | A visitor with no login / the server itself |
| `equal(actual, expected, what)` / `ok(condition, what)` | The check. It fails with what was expected and what came back |
| `cleanup(() => …)` | Undo something the eval created. Register it straight after creating it |

`rest` and `fn` return `{ status, data }` and do not throw on a refusal, because a refusal is
often the thing being proved ("a tenant admin cannot read this" → `equal(res.data.length, 0)`).

## How to prove a statement properly

- **Prove the refusals as hard as the successes.** For "only X can do this", check that X can,
  *and* that a visitor, a tenant's admin and another tenant cannot.
- **Look at the result where it lands**, not at what the function said. A function that answers
  `{ success: true }` proves nothing: read the row it should have written.
- **Make the case, then check it.** Do not rely on data that happens to be on staging. Create
  the renter, the booking, the code; check; clean up. The northwind tenant and the two logins are
  the only things you may assume are there.
- **An eval that cannot fail is not an eval.** Before you trust a new check, break the thing it
  checks (or flip the expected value) and see it fail. Then put it back.
- **Never weaken a check to make it pass.** If the code and the spec disagree, the eval is doing
  its job. Tell the person which one is wrong; fix that one.

## Math is proved in Vitest

Drive247 moves real money. Every spec with a **Worked examples** table gets a
`NN-short-name.test.ts` beside its `.mjs`, and it runs **every row of the table**, to the cent.

```ts
import { describe, expect, it } from "vitest";
import { birthdayDiscountCents } from "../../../../supabase/functions/_shared/birthday-discount-rules";

describe("02 who gets the birthday discount", () => {
  // The rows of the spec's Worked examples table, in order. Cents in, cents out.
  it.each([
    [1, 30000, 3000],
    [2, 14999, 1500],
    [3, 5, 1],
    [4, 4, 0],
    [5, 1250000, 125000],
  ])("02.3 #%i a rental of %i cents is discounted by %i", (_row, rental, expected) => {
    expect(birthdayDiscountCents(rental)).toBe(expected);
  });
});
```

- **The test name starts with the statement number** (`02.3 #1 …`). That is how the result is
  tied back to the spec. A test without one is counted as a failure.
- **The expected values come from the spec's table**, worked by hand. Never from running the
  code. If a row is wrong in the spec, fix the spec first, by hand, then the test.
- **Test the real function**, imported from the one place the math lives. Never copy the
  formula into the test: that proves the copy.
- **The math must be importable.** It lives in a plain file with no imports of its own (no
  `Deno`, no network, no database), like `supabase/functions/_shared/platform-promo-rules.ts`.
  If it is buried inside a function or a component, moving it out is part of the work.
- **Add the edges** even if the table missed them: `0`, `1`, a rounding half, the largest
  realistic amount, and that the answer is a whole number of cents (`Number.isInteger`).
- **Then prove it once end to end** in the `.mjs`: make the booking or the signup on staging and
  read the amount that was really stored or sent to Stripe. The unit test proves the formula;
  this proves the formula is the one actually used.

The same rows are checked a third time, by a person with a calculator, in the QA report.

## How to do it

1. **Read the feature's specs.** If there are none, stop and say so: the `spec` skill comes
   first. (A guide, not a gate: if the person says go ahead, go ahead.)
2. **For each spec, list its statements** from the Proof table: which go to an eval, which to the
   QA report. Say the list back to the person in chat.
3. **Write the `.mjs`**, one `statement()` each, and the `.test.ts` if the spec has math.
4. **Run it:** `npm run eval -- feat-NNN NN`. Fix what fails. If the code is wrong, say so and fix
   the code. If the spec is wrong, say so and fix the spec. Do not bend the eval.
5. **See each new check fail once** (break it, run, restore).
6. **Run the whole feature:** `npm run eval -- feat-NNN`. It writes `RESULTS.md`.
7. **Tell the person** the last line, and name any statement that is not proved and why.
8. Commit the evals and `RESULTS.md` on the feature's branch.

## What comes next

Evals are step 3. After them: the `qa-report` skill lists what a person must check by hand: every
statement the Proof tables gave to the QA report, the money math with a calculator, and one walk
through the whole feature. A feature is complete when `npm run eval` says every statement is
proved and every item on the QA report is ticked. The order is a guide, not a gate.

A full made-up example is in `example.md`, next to this file.
