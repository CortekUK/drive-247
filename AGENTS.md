# Repository contributions

Preserve unrelated working-tree changes. Do not deploy or run live migrations or financial tests without explicit session authorization.

## V2 implementation scope

All new application work belongs in V2: Northwind Rentals now, and other rental tenants as they are enabled for V2 through the existing rollout gates. Preserve V1 behavior. V1 may be inspected as a source of business rules, functionality and documentation, but do not implement new features in V1. Keep V2 implementations separate, with only the necessary gated integration in shared entry points. Do not hardcode new functionality to the Northwind tenant when it should follow the V2 rollout.

## TRAX application knowledge

Changes to application behavior, navigation, permissions, tenant variants or supported workflows must update the affected TRAX documents and regression tests in the same review. Start with TRAX_APPLICATION_CONTEXT.md and docs/trax/feature-catalog.json.

Run node scripts/trax-knowledge.mjs --check. Review affected sources and documentation before rebuilding the local artifact with --build. New routes and permission keys must be inventoried; unverified features must remain marked as such. Do not promote a feature or claim deployed release parity merely to pass a check.

Generated knowledge and policy copies are not hand-edited. Documentation build commands are local preparation only and never publish. Keep secrets, identity documents and tenant financial/operational records out of shared knowledge.

TRAX Phase 1 is limited to V2 tenants, prepared application guidance and authorized navigation. Keep its components, hook and trax-support endpoint separate from V1; enforce the existing V2 chrome rollout gate server-side as well as in the UI. Northwind is the current canary, not a permanent tenant restriction. Preserve V1 chat and retrieval behavior. Keep business writes and Phase 2/3 diagnostic/finance tools unavailable until separately approved. Existing reminder tools elsewhere are not to be removed.

For shared fleet quote changes, run node scripts/sync-fleet-quote.mjs --check and the fleet-quote and synchronization tests. Preserve exact business logic; only line-ending transport differences are normalized.
