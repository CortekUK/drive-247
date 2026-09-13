# TRAX application context

This is the entry point for Drive247 operator support knowledge. It describes repository-verified behavior at a stated scope; it is **not a complete manual or evidence about any live account**. See the [manifest](docs/trax/knowledge-manifest.json) for source commit, knowledge version, verification date and release status.

## Application map

Drive247 has an operator portal, a customer booking/customer portal, a platform administration app, and marketing sites. Staff authenticate through Supabase Auth and an active `app_users` membership. Customer authentication uses `customer_users`; a valid customer session does not grant staff access. Tenant branding or a client-selected ID is not authorization.

Rentals link customers and vehicles. Approval, payment, agreement, insurance and handover are separate workflow dimensions. A physical return reported by an operator is different from a return recorded in Drive247. Booking eligibility also depends on dates, tenant configuration and availability rules.

The portal uses V1 and V2 variants selected per area by `isV2`. Lean-area gates can hide functionality even when a route exists. Manager tab grants and settings sub-grants govern navigation. A hidden control is not a backend authorization check.

## Read the functionality documentation

- [Rental workflow and return](docs/trax/workflows/rentals-and-returns.md)
- [Vehicle availability and fleet quotes](docs/trax/workflows/vehicle-availability.md)
- [Customers and vehicles](docs/trax/workflows/customers-and-vehicles.md)
- [Messages, reminders and website content](docs/trax/workflows/operator-tools.md)
- [Settings and integration navigation](docs/trax/workflows/settings.md)
- [Financial behavior and limitations — developer reference](docs/trax/developer/finances.md)
- [Unavailable-car playbook](docs/trax/troubleshooting/vehicle-not-bookable.md)
- [Missing or conflicting payment playbook](docs/trax/troubleshooting/payment-discrepancy.md)
- [Permission rules](docs/trax/permission-rules.md)
- [Feature catalog](docs/trax/feature-catalog.json), [navigation registry](docs/trax/navigation-map.json), [coverage report](docs/trax/generated/coverage-report.json)
- [Unverified modules](docs/trax/unverified-modules.md)
- [Maintenance and rollout](docs/trax/maintenance.md)
- [Phase 0/1 implementation and test evidence](docs/trax/implementation-report.md)
- [Local portal setup and manual testing](docs/trax/local-testing.md)

## What Phase 1 actually does

This implementation is enabled for **V2 tenants**, through the existing `chrome` rollout gate in `apps/portal/src/lib/v2.ts`: Northwind Rentals now, and future tenants when enabled for V2. Its separate `/functions/v1/trax-support` endpoint applies that same gate to the server-loaded tenant. V1 tenants keep the original chat UI, hook, endpoint and retrieval behavior. V1 code may inform support documentation without receiving new implementation. Open TRAX using V2's existing **Ask AI** sidebar control or Ctrl/Cmd+J. Supabase's `/functions/v1/` URL prefix is its API version, not the portal's V1 interface.

TRAX selects prepared, bilingual application sections and constructs authorized navigation actions. It does not send account records or user prompts to a model provider in this phase. It does not read old embeddings, chat history, rental statuses, customer notes, financial totals or Stripe. It reads membership, permissions, limited tenant capability fields, and minimal entity ownership when validating a record link.

Guidance is always labelled as documentation; live checks are unavailable. Production release matching is unverified until a reviewed release mapping exists. Navigation is checked at suggestion time and again when selected.

Conversations remain in browser memory. A server-signed, 30-minute token binds the conversation's section selection to user, tenant, permissions, capabilities and knowledge version. No new chat messages are persisted. Existing stored conversations and embeddings are not deleted or rebuilt.

## Authority and coverage

For account facts, a successful authorized live tool result would be required. None is implemented in Phase 1. For application guidance, use the prepared sections linked to source references. Comments describing production observations are not live verification. Unsupported and partial features remain visible in the coverage inventory and are not automatically promoted.

The manifest is a review candidate produced alongside code. It is not automatically published, and no deployment mapping is inferred from package.json or the current branch.
