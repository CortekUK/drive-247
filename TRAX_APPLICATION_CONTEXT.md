# TRAX application context

This is the entry point for Drive247 operator support knowledge. It describes repository-verified behavior at a stated scope; it is **not a complete manual or evidence about any live account**. See the [manifest](docs/trax/knowledge-manifest.json) for source commit, knowledge version, verification date and release status.

## Application map

Drive247 has an operator portal, a customer booking/customer portal, a platform administration app, and marketing sites. Staff authenticate through Supabase Auth and an active `app_users` membership. Customer authentication uses `customer_users`; a valid customer session does not grant staff access. Tenant branding or a client-selected ID is not authorization.

Rentals link customers and vehicles. Approval, payment, agreement, insurance and handover are separate workflow dimensions. A physical return reported by an operator is different from a return recorded in Drive247. Booking eligibility also depends on dates, tenant configuration and availability rules.

The portal uses V1 and V2 variants selected per area by `isV2`. Lean-area gates can hide functionality even when a route exists. Manager tab grants and settings sub-grants govern navigation. A hidden control is not a backend authorization check.

Platform super admins find human support at Management → Support in the separate admin app. The destination stays visible while support is unconfigured; its page explains setup or access failures. Ticket access still requires the explicit active support grant and server verification. See [in-app support](docs/trax/in-app-support.md).

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
- [Model and read-only diagnostic milestone](docs/trax/operational-milestone.md)
- [Typed tool contracts](docs/trax/tool-contracts.md)
- [Persistent issues, support handoff and retention](docs/trax/support-escalation.md)
- [Read-only payment investigation and finance activation limits](docs/trax/read-only-finance.md)
- [Current completion status and test evidence](docs/trax/completion-status.md)
- [Bonzah setup](docs/trax/workflows/bonzah.md)

## Human support messaging

The V2 tenant interface now has TRAX ? My Tickets, and the actual platform administration app has `/admin/support`. First-message submission is atomic, conversations are persistent, unread ticket counts are per viewer, and a separate durable Resend notification job alerts support. Platform inbox access requires both the real super-admin flag and an explicit support grant. See [in-app support](docs/trax/in-app-support.md) for contracts, setup, retention and tested limits. Candidate migrations and email delivery have not been activated or verified in production.

## Human support messaging

The V2 tenant interface now has TRAX > My Tickets, and the actual platform administration app has `/admin/support`. First-message submission is atomic, conversations are persistent, unread ticket counts are per viewer, and a separate durable Resend notification job alerts support. Platform inbox access requires both the real super-admin flag and an explicit support grant. See [in-app support](docs/trax/in-app-support.md) for contracts, setup, retention and tested limits. Candidate migrations and email delivery have not been activated or verified in production.

## Current local implementation

The V2 sidebar's **Ask AI** / Ctrl+J entry uses a separate support hook and handler, gated by the actual `chrome` rollout on both client and server. Northwind is the current canary; other tenants follow that rollout. V1 chat is unchanged. The development route `/api/trax-support` returns 404 outside development; production uses the separately deployed `/functions/v1/trax-support` endpoint (the API prefix is not the portal version).

When an approved model configuration is present, TRAX uses a bounded OpenAI **Responses API** tool loop. It retrieves up to three reviewed sections by exact ID, resolves authorized records, reads rental/receiving context, diagnoses V2 website visibility or date occupancy, counts complete authorized datasets, and lists bounded booking/fleet-check pages. Checkout diagnosis covers only its read-only pause and overlap prechecks. Tool errors, permission restrictions, truncation and incomplete coverage are explicit. Validated source/navigation IDs, observation timestamps and canonical findings accompany the explanation. **Check Again** fetches the selected issue's diagnostic anew; it does not mutate the return.

The model is configured by server-only `TRAX_MODEL`; the existing local selection is `gpt-4o`. Outbound requests require `OPENAI_API_KEY` and the approved `TRAX_MODEL_DATA_POLICY=minimal-operational-v1`. The local key/policy were configured with the user's authorization, but an earlier provider attempt returned insufficient quota and the latest connectivity check timed out without an HTTP response. No successful signed-in/model/live-read verification is claimed. Missing/failed model service uses explicitly labelled prepared guidance, not a simulated AI answer. Responses use `store:false`; private reasoning items exist only inside the transient bounded tool loop.

Operational tools return bounded, tenant-scoped fields without customer contacts, notes, identity documents or old embeddings. The new default-disabled finance package can inspect rental-linked payment records and exact mapped Stripe payments or exclusive connected-account funds with explicit server grants and restricted credentials. Full rental money totals remain unsupported where historical currency cannot be verified. General payment-method guidance grants no financial access. All business mutations remain unavailable. Support state and explicit ticket submission are narrowly separated writes, never model tools. The legacy provider helper is not invoked.

The prepared support migration adds owner/tenant/scope-bound conversations, independent issue scores, redacted ticket handoffs, explicit support-agent grants and configurable retention. Storage requires the reviewed migration, support assignments and server-only `TRAX_SUPPORT_STORAGE=enabled`; it is **not enabled on production**. Configured conversations use a short encrypted reference, revision checks and recent-conversation resume. Without storage, bounded encrypted session context supports short follow-ups with an honest session-only label. Old messages are never current evidence; membership and entity access are revalidated. No legacy conversations are imported.

At support level 100, **Contact Support** explains the disclosure and creates a persistent ticket only after the user's click. Database idempotency prevents duplicate submissions. Ordinary staff see their own scoped tickets; cross-tenant queue access requires an explicit support grant. Issue resolution and ticket closure remain independent. Retention defaults are 90 days after conversation activity and 365 days after latest ticket closure; open tickets and approved holds survive cleanup. The scheduled job is **dry-run only** pending separate production approval. See the support report for exact limits, tests, deployment prerequisites and backup/provider retention.

## Authority and coverage

For account facts, a successful current authorized tool result is required. The narrow operational milestone implements this path; live integration verification and complete checkout coverage remain outstanding. For application guidance, use the prepared sections linked to source references. Comments describing production observations are not live verification. Unsupported and partial features remain visible in the coverage inventory and are not automatically promoted.

The manifest is a review candidate produced alongside code. It is not automatically published, and no deployment mapping is inferred from package.json or the current branch.
