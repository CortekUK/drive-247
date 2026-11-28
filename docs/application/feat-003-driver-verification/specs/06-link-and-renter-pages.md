# Spec 06 · The link and the renter's pages

**Feature:** feat-003 · Driver verification, part 1 · **PRD stories:** 6, 7, 8, 9, 10 · **Status:** Draft

## What this covers

What the renter sees when they open the link, how the pages change with the ticked checks and the
state of the session, the consents, and the hand-off to Didit and back. The Didit check itself is
spec 07.

## Behaviour

- **06.1** The link opens a new booking-site page at `/id/<token>`, served for every company from the booking app's original route group (the segment `id` is added to `ORIGINAL_ONLY_SEGMENTS`). Today's `/verify/<token>` page is not changed.
- **06.2** Opening the page calls `verification-v2-link` action `open`, which records `link_opened` (the first time only) and moves the session from `link_sent` to `in_progress`.
- **06.3** `open` returns only: the company's name and logo, the customer's first name, the list of ticked services with their consent texts, the session state, and what to show. It never returns a licence number, a photo, a date of birth or the other customer details.
- **06.4** An unknown token returns 404 and the page says "This link is not valid."
- **06.5** A session that is `expired` or `cancelled` (not_verified with `cancelled_at`) shows "This link has ended. Ask <company> for a new one."
- **06.6** A session that was replaced shows "This link was replaced. Please use the newest link <company> sent you."
- **06.7** A finished session shows "You are verified" or "We could not verify you. <company> will be in touch.", with nothing private on it.
- **06.8** The welcome screen names the company, says what will be checked, and asks for the consent to the photo and face check, with its words shown in full. Nothing is taken before the renter agrees.
- **06.9** With licence status ticked, the consent adds one line: "<company> will also ask your state whether your licence is valid." No extra screen.
- **06.10** With the driving record ticked, a separate consent screen with its own tick follows. The same for the criminal record. (Both are switched off for now; the screens exist behind the switch.)
- **06.11** Agreeing calls `consent` with the ticked consents. It records `consent_given` with the exact text version, the time, and the browser's IP and user agent, and sets each premium check's `consent` to `given` or `refused`.
- **06.12** A premium check whose consent is refused is set to `not_run` with reason "The customer did not agree", is never sent to RentID and is never charged. The standard check goes ahead.
- **06.13** Refusing the photo and face consent records `consent_refused`, sets the session to `failed` with reason "The customer did not agree to the check", and the page says so.
- **06.14** After consent the page calls `start-didit`, which creates the Didit session (spec 07) and returns Didit's hosted URL; the browser goes there.
- **06.15** Didit returns the renter to `/id/<token>?done=1`. The page then shows "Thank you, you are done" while the result is fetched.
- **06.16** Opening the link again before the session finishes carries on: an open Didit session is reused, so the renter is not asked to agree twice.
- **06.17** Opened on a screen wider than 768 pixels without a touch screen, the page shows the same link as a QR code and says "Open this on your phone", with a "Continue here anyway" link.
- **06.18** Every page fits a 360-pixel-wide phone without sideways scrolling, in light and dark.
- **06.19** The words on these pages are said by Trax, in the first person, with no emojis.
- **06.20** `verification-v2-link` accepts at most 30 requests per token per 10 minutes; more get 429.

## Worked examples

None.

## Database

Spec 01. The consent text versions are constants in `_shared/verification/consent.ts`
(`standard-v1`, `licence-status-v1`, `driving-record-v1`, `criminal-record-v1`); the version saved on
the session says which words were shown.

## Functions

`verification-v2-link` (`verify_jwt = false` in `supabase/config.toml`; the token is the only key):

| Action | Input | Output | Errors |
|---|---|---|---|
| `open` | `{ token }` | the page model (06.3) | 404 `unknown`; 429 |
| `consent` | `{ token, standard: bool, premium: { key: bool } }` | `{ ok }` | 404; 409 `not_open` |
| `start-didit` | `{ token }` | `{ url }` | 404; 409 `not_open`, `no_consent`; 503 `provider_unavailable` |

## Screens

Booking app, new route `apps/booking/src/app/(legacy)/id/[token]/page.tsx` (client component), with
`id` added to `ORIGINAL_ONLY_SEGMENTS` in `lib/booking-design.ts`. Screens: welcome and consent;
premium consents (one per ticked record check); hand-off; done; ended; replaced; laptop QR.

This differs from the brief's `/verify/<token>`: that path is today's page, used by the booking site,
invites and secondary drivers, and must not change (brief 12.3). `/id/<token>` keeps the old page
untouched.

## Money and safety

A premium check without a recorded consent is never run or charged (06.12). The page holds no private
data (06.3, 06.7). The token is unguessable (spec 01.12) and stops working when the session ends.

## Proof

| Statement | Proved by |
|---|---|
| 06.2 to 06.7, 06.11, 06.12, 06.13, 06.16, 06.20 | `evals/06-link-and-renter-pages.mjs` (calls `verification-v2-link` like the page does) |
| 06.1, 06.8 to 06.10, 06.14, 06.15, 06.17 to 06.19 | QA report (on a real iPhone and Android phone, and a laptop) |

## Not in this spec

- What Didit checks and how its answer becomes result lines (spec 07).
