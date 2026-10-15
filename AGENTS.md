# AGENTS.md

Instructions for AI coding agents (Codex, Claude, etc.) working in this repo.

Read these before changing anything, in order:

1. `PROJECT_CONTEXT.md` — the map of the whole project: apps, backend, data model, scripts, hazards.
2. `V2_PLAN.md` — the rules for how v2 is built. Non-negotiable.
3. `CLAUDE.md` — v1 architecture detail. Partly stale; `PROJECT_CONTEXT.md` §12 lists the known drift.
4. `ILLUSTRATION_GUIDE.md` — only when making illustrations or visual assets.

The short version:

- `main` deploys to production. Never run deploy/seed/wipe scripts or apply migrations without explicit approval.
- RLS is off on the core tables. Every query must filter by `tenant_id`.
- v2 work goes in new files beside v1 and is gated by tenant slug (`apps/portal/src/lib/v2.ts`). Never edit v1 screens in place.
- Database changes are additive only. A new `tenants` column needs `GRANT SELECT (col) ON public.tenants TO anon`.
- Never change an existing edge function or `_shared/` helper. Add a `-v2` one instead.
- Always start dev servers through the root npm scripts (`npm run dev:portal`, etc.).
