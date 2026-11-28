# How a feature is built

Every feature goes through the same four documents, in the same order, then a pull request. Claude has a skill for each one, so everyone's work has the same shape.

| Step | Document | What it answers | Who reads it |
|---|---|---|---|
| 1 | **PRD** | What does this do for a person? | Ghulam, Neema, Bryan. Anyone. |
| 2 | **Specs** | Exactly how does each part behave, and how is it built? | Developers and Claude. |
| 3 | **Evals** | Is each statement in the specs true? | Nobody reads them. You run them. |
| 4 | **QA report** | What did a person check with their own hands and eyes? | Ghulam, before he relays. |
| 5 | Pull request | All of the above, plus the code. | Ghulam. |

**A feature is complete when every statement is proved and every item on the QA report is ticked.**

## Where the files go

| File | What it is |
|---|---|
| `docs/application/PRD.md` | The one PRD for the whole product. Your feature is one section in it. |
| `docs/application/feat-NNN-name/specs/01-name.md`, `02-…` | The specs. A feature has several. |
| `docs/application/feat-NNN-name/evals/01-name.mjs` | Proves spec 01 against staging. |
| `docs/application/feat-NNN-name/evals/01-name.test.ts` | Proves spec 01's math, in Vitest. Only when the spec has math. |
| `docs/application/feat-NNN-name/evals/RESULTS.md` | The last full run. |
| `docs/application/feat-NNN-name/qa-report.md` | The QA report. |

`NNN` is the next free number in the PRD.

## Step 1: the PRD

Plain business language. Short stories about a person: who they are, what they do, what they see, what they get. Every path, including the ones where something is refused, expires or is skipped.

Nothing technical: no table names, file names or code. If a sentence needs a developer to explain it, it does not belong in the PRD.

Say to Claude: **"Write the PRD for <feature>."**

Claude asks you questions until it can tell each story from start to finish. If a rule is not decided, ask Ghulam. Do not guess one.

## Step 2: the specs

One spec per part that can be built and proved on its own: the data, a rule or calculation, a function, a scheduled job or an email, a screen.

The heart of a spec is its **Behaviour** list: numbered statements such as `02.5`, each one a single fact that is either true or false. Include the refusals and the edges.

Each statement is given to either an eval or the QA report in the spec's Proof table. Nothing is left unproved.

Say to Claude: **"Write the specs for feat-NNN."**

## Step 3: the evals

An eval is a script. It runs against staging and proves the statements, one check per statement, with the same number and the same words.

| An eval does | An eval never does |
|---|---|
| Runs on staging | Touches production |
| Calls the database and functions the way the apps do | Opens a browser. What only a browser shows goes to the QA report. |
| Removes everything it creates | Leaves test rows or users behind |
| Gives the same answer every time | Sends an email or a text to a real person |

Say to Claude: **"Write the evals for feat-NNN."** Then run them:

```bash
npm run eval -- feat-NNN        # every eval of the feature
npm run eval -- feat-NNN 02     # only spec 02
```

The last line is the answer:

```text
EVALS feat-NNN  23/23 statements proved
```

## Step 4: the QA report

Evals prove what a script can prove. The QA report is everything else. You walk through the whole feature yourself, as the customer would, and tell Claude what happened. Claude writes your words down and ticks the item.

| Part | Where | When |
|---|---|---|
| 1. Full check | Your own ray sites, staging data | Before the pull request |
| 2. Staging look | The staging site | During the relay |
| 3. Production check | Live, on the northwind tenant only | Straight after the relay |

Never on `localhost`. Always on a real phone as well as a laptop.

Say to Claude: **"Write the QA report for feat-NNN."** Then, as you test: **"I've tested item 3, this is what happened: …"**

## Money gets extra care

Any spec with a number that ends on a bill, a refund, a payout or a discount carries a table of examples **worked out by hand**. Vitest runs every row. In the QA report you redo rows on a calculator and compare three numbers: yours, the screen, and the bill.

## Step 5: the pull request

From your ray branch, with the PRD section, the specs, the evals, `RESULTS.md`, the QA report with part 1 ticked, and the code. Say so in the group.

## Common mistakes

| Mistake | Instead |
|---|---|
| Writing the code first and the documents after | PRD first. It is how you find the questions before they cost you a day. |
| Guessing a rule | Ask Ghulam, or write in the PRD that it is not decided. |
| A statement that says two things | Split it. One fact each. |
| An eval that passes because it checks very little | Prove the refusals as hard as the successes. |
| Ticking a QA item you did not do yourself | The report is your word that you saw it. |
| Testing only on a laptop | Most customers are on a phone. |
