# Landing page QA (QA-1)

*Task for Hamza · From Ghulam · Wednesday 25 Nov 2026 · drive-247.com landing page*

> **This is a record, not the original brief.** The task was given in conversation, with no written guide. What is below comes from the commit and the pull request.

## The task

Go through the landing page on phone, tablet and laptop, find what looks wrong, and fix it.

## What was done

| Area | Fix |
|---|---|
| Hero | The headline no longer overflows on phones before JavaScript loads. |
| Scroll animations | Sections build once instead of replaying when you scroll back. |
| Multichat demo | The thread scrolls and the message box stays visible on short screens. The window is slightly taller. |
| Windows displays | No horizontal scrollbar on scaled displays. |
| Insights map | A "Show all places" button, drag to pan, zoom limits. |
| Booking calendar | The Pickup / Return label no longer overlaps the date. |
| Admin demo | Notification badges use a valid font size. |
| Section spacing | Stacked margins and padding removed around phones, integrations, Turo and blog. |
| iPad | Demo tabs in a 2 × 2 grid at 760 to 899px, three phones from 760px, Turo chapter names on one line. |

## Where it is

| | |
|---|---|
| Branch | `hamza/qa-1/landing-page` |
| Commit | `772aa836` (16 files in `apps/web/src/components/`) |
| Pull request | #33, merged into `main` on 25 Nov 2026 (`0e860f56`) |
| State | Done and live. |

## Still owed

A QA report for this pass. A QA pass on something that already exists still gets a PRD section and a QA report.
