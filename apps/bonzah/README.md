# Bonzah Partner Console (`apps/bonzah`)

Standalone Next.js app for Bonzah partners (e.g. Brandon) to review Drive247
operator onboarding submissions and activate Bonzah insurance.

Intended host: **bonzah.drive-247.com**

- Dev: `npm run dev:bonzah` (port **3004**)
- Auth: Supabase Auth gated on `app_users.is_bonzah_partner` (super admins also
  allowed in for oversight). Partner-only actions (approve/reject) are gated
  server-side by `is_bonzah_partner()` in the `bonzah-partner-review` edge fn.
- Pages: `/login`, `/dashboard` (review queue), submission detail dialog with AI
  verdict card, quiz result, activity timeline, credential fields + message box,
  and approve/reject controls.

## Phase status

- Phase 3: review-only. Approve/reject controls are present but disabled
  (`ACTIVATION_ENABLED = false` in `components/console/BonzahQueue.tsx`).
- Phase 4 wires the controls to the `bonzah-partner-review` edge function and
  flips `ACTIVATION_ENABLED` on.

## MANUAL steps (cannot be automated from here)

1. **Vercel project** — create a new Vercel project pointing at `apps/bonzah`
   (root directory `apps/bonzah`, framework Next.js). Set env vars
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
2. **DNS** — add `bonzah.drive-247.com` as a domain on that Vercel project and
   point the DNS record accordingly. `bonzah` is already added to the reserved
   subdomain lists in the portal + booking middleware so it is never treated as
   a tenant slug.
3. **Brandon's partner account** — create an `app_users` row with
   `is_bonzah_partner = true`, `is_super_admin = false`, `tenant_id = NULL`, and
   a matching Supabase Auth user.
