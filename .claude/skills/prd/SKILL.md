---
name: prd
description: Add a feature to the Drive247 PRD, or update one that is there. Use when someone says "write the PRD for X", "add X to the PRD", "/prd", or starts a new feature. The PRD is the one document that says, in plain business language, what every feature does. It is the first step of a feature: PRD, then specs, then evals, then the QA report.
---

# PRD

Drive247 keeps **one PRD for the whole application**. Every feature is one section in it.

| File | What it is |
|---|---|
| `docs/application/PRD.md` | The source. This skill is the only thing that edits it. |
| `docs/application/PRD.pdf` | What people read. Built from the source, never edited by hand. |
| `docs/application/feat-NNN-name/` | The feature's folder. Its specs, evals and QA report go here later. |

## Who reads it

Ghulam, Neema, Bryan, and anyone who is not a developer. They read it to know what the product
does for a customer. If a sentence needs a developer to explain it, it does not belong here.

## What a feature section says

What is literally happening in the business: who the person is, what they see, what they do, what
they get, and what the company gets. Write it as short stories about a person.

**Nothing technical.** No table names, function names, file names, code, API names, branch names
or status codes. Those belong in the specs. Product names a customer would know are fine (Stripe,
Google sign-in). Say "the card step", not `payment-step.tsx`. Say "the offer ends by itself", not
"`expires_at` is checked server side".

It is high level, but it goes all the way through the feature: every path a person can take,
including the ones where something is refused, expires or is skipped.

## The shape of a section

Use exactly these headings, in this order. Leave none out; write "Nothing." if one is empty.

```markdown
## feat-NNN · Feature name

**Status:** Planned | Being built | Live (since <date>) | Ended (<date>) · **Built by:** <name> · **Folder:** `feat-NNN-name`

### In one line
One sentence a stranger would understand.

### Why we have it
The business reason: who asked, what problem it solves, what we expect to gain.

### Who it is for
The people involved, each in a few words.

### What happens
Numbered stories. Each one: a person, what they do, what they see, what they get.
One story per path through the feature, the unhappy paths included.

### The rules
The business rules as a list: amounts, dates, limits, who qualifies, what wins when two
things clash.

### What it does not do
Things a reader might assume it does, and it does not.

### How we know it is working
What someone in the business can look at to see it working: a number, a screen, a report.
```

A full made-up example is in `example.md`, next to this file. Read it before writing your first
section: it shows the tone and how far to go. Never copy it into the PRD.

## How to do it

1. **Find out what the feature is.** If it is already built, read the code and the commits on the
   branch. If it is not, ask the person in plain chat. Ask until you can tell each story start to
   finish. Do not guess a rule: ask, or say in the section that it is not decided.
2. **Pick the number.** Look at the `## feat-NNN` headings in `PRD.md` and take the next free
   one. Three digits. The folder is `feat-NNN-` plus a short name in lowercase with hyphens.
   Updating a feature keeps its number.
3. **Write the section** in `docs/application/PRD.md`, in number order. Follow the shape above.
4. **Add it to the list of features** at the top of `PRD.md` (number, name, status, one line).
5. **Make the folder** `docs/application/feat-NNN-name/` with empty `specs/` and `evals/` folders
   (a `.gitkeep` in each).
6. **Build the PDF:** `node scripts/build-prd.mjs`. It must finish with `PRD.pdf written`.
7. **Show the person the section** you wrote, in chat, and ask if it reads right. Change it until
   they say yes. Rebuild the PDF after every change.
8. Commit `PRD.md`, `PRD.pdf` and the folder together, on the feature's branch.

## Writing rules

- Short sentences. Everyday words. Present tense ("A visitor sees…").
- Name the person each time: a visitor, a new operator, a renter, our team. Never "the user".
- Real numbers and real dates, with the timezone where a time matters.
- No emojis. No marketing language. No "simply", "seamlessly", "robust".
- If the feature has ended or been removed, keep its section and change the status. The PRD is
  also the record of what the product used to do.

## What comes next

The PRD is step 1. After it: the `spec` skill (how it is built), the `eval` skill (proof each
spec works), the `qa-report` skill (the manual check). A feature is complete when its evals pass
and every item on its QA report is ticked. The order is a guide, not a gate.
