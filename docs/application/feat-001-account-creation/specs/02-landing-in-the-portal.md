# Spec 02 · Landing in the portal after the card

**Feature:** feat-001 · Account creation and the account · **PRD stories:** 1, 2 · **Status:** Draft

## What this covers

What happens between the card being accepted and the person using their portal: the build
screen, Bryan's call offer, and being signed in to `{slug}.portal.drive-247.com` without a
password.

## Behaviour

- 02.1 After `signup-provision` succeeds, it always returns a one-time `portalSignInUrl` (a magic
  link to `{portalUrl}/login`). The `SIGNUP_PORTAL_MAGICLINK` switch is removed.
- 02.2 Opening that link signs the person in to their own portal. They are never shown a password
  field on the way.
- 02.3 The link works once. Opening it again shows the normal login page.
- 02.4 The link only signs in to the portal of the company just created; on another company's
  portal it is refused (the existing wrong-portal sign-out).
- 02.5 The build animation and Bryan's call offer still show before the portal; "Not now" goes
  straight on to the portal.
- 02.6 If making the link fails, the person is sent to `{portalUrl}/login?email=…` and can use the
  sign-in code (spec 05).

## Worked examples

None.

## Database

None.

## Functions

`signup-provision`: `portalSignInUrl` is always set on success, from
`auth.admin.generateLink({ type: "magiclink", redirectTo: `${portalUrl}/login` })`.

## Screens

`apps/web/src/components/onboarding/provisioning-screen.tsx`, `onboarding-call.tsx` (unchanged
design). Portal `app/(auth)/login/page.tsx` accepts the link's session.

## Money and safety

The link is a credential. It is single use, short lived (Supabase's link expiry), and only
returned to the session that owns the company.

## Proof

| Statement | Proved by |
|---|---|
| 02.1, 02.3 | `evals/02-landing-in-the-portal.mjs` |
| 02.2, 02.4, 02.5, 02.6 | QA report (crosses two sites in a browser) |

## Not in this spec

The quick tour (not this feature). The verify window after the tour (03).
