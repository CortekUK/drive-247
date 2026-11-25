---
name: spec
description: Write the specs for a Drive247 feature, or update them. Use when someone says "write the specs for X", "spec this", "/spec", or has a feature in the PRD that needs its technical detail. A spec says exactly how one part of a feature behaves and how it is built, as numbered statements an eval can prove. It is step 2 of a feature: PRD, then specs, then evals, then the QA report.
---

# Spec

The PRD says what a feature does for a person, in plain language. The **specs** say exactly how
it behaves and how it is built. They are technical, and they are written so that each statement
can be proved by an eval or checked by hand.

| File | What it is |
|---|---|
| `docs/application/feat-NNN-name/specs/NN-short-name.md` | One spec. A feature has several. |
| `docs/application/PRD.md` | The feature's section. Read it first. |

Specs are markdown. They are read by developers and by Claude.

## One feature, several specs

Split the feature into the parts that can be built and proved on their own. Typical parts:

- **The data**: tables, columns, what is allowed in them, who can read and write them.
- **A rule or a calculation**: a price, a date window, who qualifies, what wins in a clash.
- **A function**: one edge function or database function, what goes in, what comes out, how it fails.
- **A flow**: a job that runs on a schedule, a webhook, an email that is sent.
- **A screen**: what a person sees and can do in one place.

One spec per part. Number them `01`, `02`, … in the order they would be built. A small feature
may have two specs; a large one ten. If a spec runs past two screens of text, split it.

## The shape of a spec

Use exactly these headings, in this order. Write "None." under one that does not apply.

```markdown
# Spec NN · Title

**Feature:** feat-NNN · Feature name · **PRD stories:** 2, 3, 6 · **Status:** Draft | Built | Changed

## What this covers
Two or three sentences: which part of the feature this is, and where it stops.

## Behaviour
Numbered statements, `NN.1`, `NN.2`, … Each is one fact that is either true or false:
what happens, for whom, under what condition. Include the refusals and the edges.

## Worked examples
Only when this spec has math: a price, a discount, a tax, a refund, a proration, a date
count. A table of real cases worked out BY HAND, each with its inputs, the working, and
the expected result to the cent. "None." if there is no math.

## Database
Tables, columns, types, defaults, constraints, indexes, RLS policies, grants, and the
migration file. "None." if this spec changes no data.

## Functions
Each edge function or database function: its name, who may call it (`verify_jwt`, role),
its inputs, its outputs, and every error it returns. "None." if there are none.

## Screens
The app, the route and the component, and what a person sees and can do there.
"None." if this spec has no screen.

## Money and safety
What this part can charge, refund, discount or expose, and what stops it going wrong.
"None." if it touches neither money nor private data.

## Proof
| Statement | Proved by |
|---|---|
| NN.1, NN.2 | `evals/NN-short-name.mjs` |
| NN.3 (math) | `evals/NN-short-name.test.ts` (Vitest, every worked example) and the QA report |
| NN.5 | QA report (a person has to see it) |

## Not in this spec
What a reader might expect here that lives in another spec, or is not being built.
```

## The Behaviour statements are the heart of it

An eval is written against these statements, one check per statement. So:

- **One fact each.** "A renter with no date of birth gets no email" is one statement. "The
  email is sent correctly" is not a statement.
- **Say the condition and the result.** Who, when, what happens. Real numbers, real dates, the
  timezone where a time matters.
- **Cover what is refused.** Every "no", "not allowed", "expired", "already used", "missing".
  These are where features break.
- **Never renumber.** A statement keeps its number for life. A statement that is removed is
  struck through and kept; a new one takes the next free number. Evals point at these numbers.

## Math gets extra care

Drive247 moves real money. Any spec with a number that ends up on a bill, a refund, a payout or
a discount is a **math spec**, and it carries a Worked examples table:

- **Worked by hand, not by the code.** Write the working out in the table ("$229.00 × 0.70 =
  $160.30"). Never run the code and paste its answer in: that only proves the code agrees with
  itself.
- **Cover the edges of the math**, not only the normal case: zero, one cent, the largest
  realistic amount, a rounding half (x.xx5), a 100% discount, two discounts meeting, a month end,
  a leap day, a timezone boundary.
- **Say the rounding rule** as a Behaviour statement: to the cent, half up or half even, and at
  which step. Rounding each line and rounding the total give different answers.
- **Money is in whole cents** everywhere it is stored or passed. A statement says so.
- **Name the one place the math lives.** If the same calculation exists in two places today, say
  so in the spec: that is a defect to fix, not a detail.

The table is used three times: the eval runs every row (in Vitest), and the QA report asks the
person who built the feature to redo rows with a calculator and compare with what the screen and
the bill show.

## Proof: an eval, or a person

Most statements are proved by an eval. Evals do **not** drive a browser, so:

| What the statement is about | Proved by |
|---|---|
| Data, rules, calculations, functions, permissions, scheduled jobs, what an email contains | An eval |
| How something looks, a layout, an animation, a flow through several screens, a third party's own page (Stripe checkout, a signing page) | The QA report |

Fill in the Proof table for every statement. A statement with nothing beside it is not done.
If you choose the QA report for something an eval could prove, say why in one line.

## How to do it

1. **Read the feature's section in `PRD.md`.** If there is none, stop and say so: the `prd` skill
   comes first. (This is a guide, not a gate: if the person says go ahead without one, go ahead.)
2. **Read the code** if the feature is built: the branch's commits, the migration, the functions,
   the screens. A spec of built work describes what the code really does, not what was intended.
   If the code and the PRD disagree, say so to the person; do not quietly pick one.
3. **Propose the split** in chat: the list of specs with one line each. Agree it before writing.
4. **Write each spec** in `docs/application/feat-NNN-name/specs/`, following the shape above.
5. **Check every PRD story and rule is covered** by at least one statement. List any that are
   not, and ask.
6. **Show the person** the list of specs and the Behaviour statements. Change them until they
   say yes.
7. Commit the specs on the feature's branch.

## Rules this project already has

A spec must not contradict these. They are in `CLAUDE.md` and apply to everything built here.

- Database changes go to **staging first**, as a whole migration file, never by altering a table
  in place. New tables: uuid primary key, `not null` where a value is always there, enums or
  check constraints instead of free text, `timestamptz`, foreign keys, RLS on, grants stated.
- **One place per rule.** A price, a date window or an eligibility rule is implemented once and
  every app calls it. A spec names that one place.
- Edge functions are deployed one at a time and verified.
- Local development uses the staging database. Nothing in a spec needs production to be tested.

A full made-up example is in `example.md`, next to this file.

## What comes next

Specs are step 2. After them: the `eval` skill writes one eval per spec, proving its Behaviour
statements against staging. Then the `qa-report` skill lists what a person must check by hand.
The order is a guide, not a gate.
