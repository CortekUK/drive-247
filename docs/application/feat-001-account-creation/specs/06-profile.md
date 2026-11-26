# Spec 06 · The profile panel

**Feature:** feat-001 · Account creation and the account · **PRD stories:** 13, 14, 15, 16, 24 · **Status:** Draft

## What this covers

What exists today in the portal profile panel (photo, name, email, password) and how an invited
staff member gets their password. Mostly a record of built behaviour to test; changes are marked.

## Behaviour

- 06.1 The profile panel opens from the user menu.
- 06.2 A photo can be taken with the camera or picked from the gallery, cropped (by touch on a
  phone), saved, replaced and removed.
- 06.3 A file that is not an image, or is over the size limit, is refused with a message before
  upload. (The limit is read from the code and written in the eval.)
- 06.4 A saved name shows in the user menu, the sidebar and anywhere the person's name appears.
- 06.5 Changing the email sends a code to the new address; the email changes only after the right
  code. A wrong code is refused.
- 06.6 An email that already belongs to another account is refused.
- 06.7 After an email change, signing in works with the new email and not the old one.
- 06.8 Changing the password sends a code first, then takes the new password; the old one stops
  working. It works for a person with no password yet.
- 06.9 An invited staff member is created with a temporary password and `must_change_password`;
  at first sign-in they are asked to change it through 06.8. This is unchanged. (Changed from the
  PRD draft: they do not see the signup window.)
- 06.10 *(Change)* The temporary password is made with `crypto.getRandomValues`, not `Math.random`.

## Worked examples

None.

## Database

None.

## Functions

`admin-create-user` (06.9, 06.10).

## Screens

Portal `components/shared/layout/profile-sheet-v2.tsx`, `password-change-panel-v2.tsx`,
`user-menu-v2.tsx`, `app/(dashboard)/users/page.tsx`.

## Money and safety

`Math.random` is not safe for a password; 06.10 fixes that.

## Proof

| Statement | Proved by |
|---|---|
| 06.5, 06.6, 06.7, 06.8, 06.9 | `evals/06-profile.mjs` |
| 06.3, 06.10 | `evals/06-profile.mjs` (reads the source) |
| 06.1, 06.2, 06.4 | QA report (camera, crop by touch, how it looks) |

## Not in this spec

Google in the profile (07).
