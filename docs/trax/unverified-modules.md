# Unverified and partial functionality

The feature catalog is an inventory, not a claim of complete application knowledge. Its status vocabulary is:

- **verified**: the narrowly stated behavior has code references and offline support tests.
- **partially_documented**: only named prepared sections are eligible for runtime; other behavior is not verified.
- **requiring_confirmation**: source/route inventoried but end-to-end behavior, permissions or deployment need review.
- **unsupported**: intentionally excluded from operator support.

The generated report enumerates portal pages, permission keys, feature coverage, and unmatched routes. A newly discovered route remains requiring confirmation until catalogued. Other applications and provider integrations are inventoried as separate unverified surfaces; portal coverage is never called whole-application completeness.

## Outstanding modules

| Group | What operators use it for | Missing verification |
| --- | --- | --- |
| Payments, invoices, credits, fines, expenses, owner payouts | Collecting, allocating, invoicing and reconciling money | Finance-read policy; currency units; historical processor routing; permissions and reconciliation scenarios |
| Payment plans (canary) | Collecting a rental's balance on a schedule — card, emailed link or recorded by hand | Canary-only and hidden until its migration and edge functions are applied; collection, reminders, provider routing and permissions are not deployed or verified |
| Finances (canary) | One tab for what is owed, what came in, what is coming and what needs the operator; on the canary it replaces the Payments, Invoices and Fines rows | Canary-only by slug; figures, redirects, per-view permissions and the reused payment, refund, plan and fine actions are not verified end to end |
| Reports, Insights, P&L | Reviewing operational/financial aggregates and exporting | Complete query scope; financial entitlement; partial results; enabled variants |
| Insurance, agreements, documents | Completing coverage, signature and document requirements | Provider-specific states and callbacks, identity-field exposure and failure recovery |
| Leads, enquiries, automations | Customer acquisition and follow-up | Tenant flags, state transitions, side effects, consent and role enforcement |
| Owners, plates, fleet health | Fleet administration and maintenance | Domain-specific writes, deployed functions and maintenance-block rules |
| Users, audit logs | Staff access and recorded activity | Native mutation guards, retention, auditing and permission change propagation |
| Settings and integrations | Business configuration and provider setup | Per-tab grants, subscription features, credential redaction and provider state |
| Subscription | Paying for Drive247 | Distinction from renter money; platform/tenant billing authorization |
| Welcome pack | Operator onboarding | Published database content and authoring release workflow |
| Developer tools | Internal development | Excluded from support; never offer shell or operational tools |
| Support section | Reading and answering the tenant's own support tickets | Deployed ticket workflow, notification delivery, retention and permission enforcement |
| Trax full-screen page, Turo Sync | Chat history and the Turo Bridge extension workflow | Chat endpoint behavior, per-tenant flags, extension pairing and import decisions |

Customer booking, customer portal, platform admin, marketing, Tesla, accounting, voice, charts, exports and ticketing require their own scoped reviews. Existing files or UI labels are evidence of an implementation entry point, not proof that every feature works in every deployment.

## Next-phase prerequisites

Phase 2: read-only deployed policy/function inventory; authoritative booking path per UI variant; reviewed date/buffer/PAYG/return semantics; complete and permission-safe blocker evidence.

Phase 3: explicit rental-finance and account-funds permissions; Stripe/Square provider mapping; UK/UAE platform and test/live provenance; historical connected-account mapping; dedicated restricted Stripe credentials; deterministic financial projections and completeness tests. Do not request credentials in chat or shared documentation.

Retention, provider data processing policy and production release mappings are unresolved. Phase 1 stores no new server-side conversation content and sends no prompts or records to a model provider.

