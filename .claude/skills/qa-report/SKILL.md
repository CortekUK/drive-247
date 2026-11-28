---
name: qa-report
description: Write a Drive247 feature's QA report and tick it off with the person who checks it by hand. Use when someone says "write the QA report for X", "/qa-report", "I've tested X", "tick off item 3", or has a feature whose evals pass and now needs its manual check. The QA report is the list of things a person must do and see for themselves. It is step 4 of a feature: PRD, then specs, then evals, then the QA report.
---

# QA report

Evals prove what a script can prove. The **QA report** is everything else: what a person has to
do with their own hands and see with their own eyes before a feature is called done.

Claude writes the list. The person does each item on a real site and tells Claude what happened.
Claude writes their words down and ticks the item. When every item is ticked, the report goes
with the pull request, and Ghulam reads it.

| File | What it is |
|---|---|
| `docs/application/feat-NNN-name/qa-report.md` | The report. One per feature. Markdown. |

**A feature is complete when `npm run eval` says every statement is proved and every item on this
report is ticked.**

## The person goes through the feature themselves

Whoever built the feature walks through it by hand at least once, start to finish, as the
customer would. Passing evals do not replace this. The report exists to make that walk complete:
every path, not only the one they built last.

## What goes on the list

Build the list from these five sources, in this order. Leave none out.

1. **Every story in the feature's PRD section**, walked once, start to finish. Every branch: the
   refusals, the expired, the skipped, the "someone arrives late". One item per story.
2. **Every statement a spec's Proof table gave to the QA report**: screens, layouts, flows across
   several screens, a third party's own page (Stripe checkout, a signing page).
3. **The money math, by hand.** For every spec with a Worked examples table: the person takes
   rows from it, works them out on a calculator, and compares three numbers: their own, what the
   screen shows, and what the bill or the stored amount says. At least three rows per table, and
   always the awkward ones (a rounding row, two discounts meeting). One item per table.
4. **What the evals are weak on.** Read the evals and say plainly what they do not prove: a
   statement checked only loosely, a third party that was faked, timing, an email that was built
   but never actually received, anything on a real device. One item for each gap. Do not hide a
   gap to make the evals look complete.
5. **The things only a person notices.** The emails and texts as received (wording, links work,
   the right name and amount). Each changed screen on a phone and on a laptop. Reading every new
   sentence the product says, out loud.

If the feature has no specs or evals (a QA pass on something that already exists), build the list
from the PRD stories and source 5 alone. That is fine.

## Where each part is done

The report has three parts, done in three places. Never on `localhost`: a test on a developer's
machine does not show what a customer gets.

| Part | Where | How much | When |
|---|---|---|---|
| **1. Full check** | The person's own live test site (`ray1`, `ray2` or `ray3`, see `CLAUDE.md`). Staging data. | Every item from the five sources | Before the pull request |
| **2. Staging look** | The staging site, after the work is merged there | Two or three items: it is there, it loads, the main path works | During the relay |
| **3. Production check** | Live, on the **northwind** tenant | One or two real tests | Straight after the relay |

A QA pass on something that is already live everywhere (no new code) does part 1 on the staging
site itself.

Rules for part 3, production:

- Use the northwind tenant. Never create test customers, companies or rentals among real ones.
- Never send an email or a text to a real customer.
- When the feature changes what someone is charged, one test is a **real payment**: a small
  amount, on a real card, refunded from Stripe the same day. The item says the amount to expect,
  and has a second tick for "refunded".
- Otherwise: look, do one real path, and read the record it produced.

## The shape of the report

```markdown
# QA report · feat-NNN · Feature name

**Checked by:** <name> · **Status:** 0 of 14 checked · **Evals:** 23/23 proved (`evals/RESULTS.md`)

| Part | Where | Checked |
|---|---|---|
| 1. Full check | <the site's address> | 0 of 11 |
| 2. Staging look | <the staging address> | 0 of 2 |
| 3. Production check | northwind, live | 0 of 1 |

## Part 1 · Full check

### 1. <What is being checked, in a few words>

- **Why by hand:** <PRD story 3 | spec 04.2, a screen | money math, spec 02 | not covered by an eval: …>
- **Do:** <numbered steps a person can follow without asking anyone>
- **You should see:** <exactly what, with the real numbers and words>
- **How to be sure:** <what would tell them it is really right, not just that nothing broke>
- [ ] Checked
```

When an item is ticked, its last line becomes:

```markdown
- [x] Checked · Haris · 25 Nov 2026 · on https://northwind.portal.staging.drive-247.com
- **They said:** "<their words, as they said them>"
```

and when it did not pass:

```markdown
- [ ] **Failed** · Haris · 25 Nov 2026
- **They said:** "<what happened instead>"
```

A failed item stays failed until the cause is fixed and the person does it again. Then it is
ticked, and the failure stays written beneath it. The report is the history, not a clean sheet.

Update the counts in the status line and the table every time an item changes.

## Writing an item

- **The person should not have to ask anything.** Which site, which login (the staging logins
  are in `.staging-credentials.local`), which screen, what to type, which test card
  (`4242 4242 4242 4242` on staging).
- **Say what right looks like**, with the numbers. Not "the discount shows correctly" but "the
  plan shows $229 crossed out and $160.30/mo beside it".
- **Tell them how to prove it to themselves.** "Open the customer in Stripe's test dashboard and
  read the first invoice: it should say $160.30." This is advice to the person, not a demand for
  a file.
- **One thing per item.** If an item has an "and", it is two items.
- **A math item names the rows** to redo and has them write down three numbers: theirs, the
  screen's, the bill's.

## Ticking

The person tells Claude, in their own words, what they did and what they saw. Then:

- **Their word is the evidence.** If they say they did it and it was right, tick it and write
  down what they said, as they said it. Do not ask for a screenshot. If they offer a link or a
  screenshot, record where it is.
- **Tick only what they spoke to.** "All done" ticks nothing: ask which items, and go through
  them. Never tick an item because it probably works, or because its eval passes.
- **Claude never ticks on its own.** Not from reading the code, not from running something.
  These are the items a person has to do.
- **If what they saw is not what the item says, it failed**, even if they think it is fine.
  Write it as failed with their words, and tell them. If the item was wrong and the feature is
  right, fix the item, say so in the report, and they do it again.
- **Something they noticed that is not on the list** gets added as a new item, marked
  "found while testing", ticked or failed like the rest.

## Work that was already tested

Sometimes the checking was done before the report existed. Then the report is written up from
what the person did, and nothing is tested again:

- Ask them what they checked, where, on which sizes, and what they found and fixed.
- Write one item per thing they checked, in the same shape, and tick it with their words and the
  date they did it. Put "written up afterwards" beside the date.
- If they have their own report, video or screenshots, link them at the top.
- List anything from the five sources they did **not** check, unticked. Do not tick it to make
  the report look finished; it is for Ghulam to decide whether it matters.

## How to do it

1. **Read** the feature's PRD section, its specs (the Proof tables and Worked examples) and its
   evals with `RESULTS.md`. If the evals are not all proved, say so first.
2. **Write `qa-report.md`** from the five sources, in the shape above.
3. **Show the person the list** and how long it should take. Ask if any path is missing: they
   know the feature best.
4. **They do part 1** on a live test site and report back, an item or a few at a time. Tick,
   fail, or add items as above.
5. **When part 1 is fully ticked**, the report is ready to go with the pull request. Commit it on
   the feature's branch. Give the person the status line to paste into the PR.
6. **Parts 2 and 3** are ticked during and after the relay, the same way, and committed.

## What comes next

The pull request, with the PRD section, the specs, the evals and their `RESULTS.md`, and this
report. Ghulam reviews it and says "relay to prod". Sometimes he will say to merge without a
pull request; that is his call. Either way the report is finished only when parts 2 and 3 are
ticked too.

A full made-up example is in `example.md`, next to this file.
