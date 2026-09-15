# TRAX permissions and data boundary

## Verified membership model

Scope is V2 tenants only. The existing `chrome` gate determines eligibility in both the portal and the dedicated backend, using the authenticated, server-loaded tenant on the backend. Northwind is the current canary; future tenants receive TRAX when enrolled in that V2 rollout, without adding a second TRAX tenant list. A super-admin selection, client V2 flag or supplied slug cannot enroll a V1 tenant. V1's original chat path is preserved and is not certified by these controls. Rebuild and review the generated backend policy alongside any V2 rollout change.

Supabase authenticates the bearer token. Staff identity comes from app_users.auth_user_id. TRAX requires is_active=true and a recognized role (head_admin, admin, manager, ops, viewer), or a verified super-admin membership.

Ordinary staff use the tenant on their membership. A supplied tenant ID must match it. Super admins can select a tenant only after their server-side super-admin flag is verified and the selected tenant is loaded. Tenant existence/branding, page context, model output and possession of a UUID are not authorization.

Managers receive only their server-loaded tab grants. Settings navigation requires the parent and mapped sub-tab. Viewers cannot receive edit-oriented return links. General finance navigation remains withheld. Reviewed how-to guidance for withheld finance areas (payments, invoices, fines, expenses, credits and billing) is retrievable only by head admins, admins and managers holding that tab grant (`canReadGuidance`); it never adds navigation, records or finance tools. The new read-only finance package is disabled by default; explicit server grants can narrow finance access to head admins/admins and permitted managers. Ops/viewers remain excluded. See read-only-finance.md; staff policy confirmation and activation are still pending. No new finance role policy is inferred from the frontend's permissive non-manager canView behavior.

## Navigation and entity access

The allowlist contains only destinations in navigation-map.json. Portal permission definitions, V2 gates, lean gates and the rental stageHref builder are generated from their actual sources. Changes make the knowledge check fail. Unknown destinations, extra URL arguments and unsupported entity kinds fail closed.

Record navigation selects only id and tenant_id, scoped to the authenticated tenant. It is validated at suggestion time and on every click. A manager needs the relevant record permission. Inaccessible and missing record IDs produce the same public error. A page ID cannot change tenancy.

The request handler rechecks membership and effective permissions before returning a response. Signed conversation tokens bind user, tenant, permissions, selected capability fields and the complete prepared knowledge artifact. Client scope values are consistency checks, never permission grants.

## Conversations, retention and provider policy

Phase 1 does not read or insert chat_messages and does not accept client history. Browser messages are cleared on account/permission context change, closure of the active dialog, or reset. Requests are aborted and late results discarded. Focus, realtime invalidation and a 30-second context refresh complement per-request server checks. Polling is not a substitute for server authorization.

The server encrypts and authenticates a 30-minute context using AES-GCM, a domain-separated key derived from the server credential and additional authenticated data containing current authorization/knowledge scope. With support storage configured, it holds only an opaque conversation reference; owner/tenant/scope-bound issue context stays on the server. Without storage it holds bounded recent turns and issue history with an explicit session-only label. Historical checks never establish current live facts. Historical signed Phase 1 tokens require their original signature, scope and expiry. Rotation invalidates tokens. A separately managed context key remains a later credential-policy improvement.

Provider calls require the explicitly approved minimal-operational-v1 policy flag and model/key configuration. The model receives the user's prompt, short scoped conversation context, relevant reviewed sections and allowlisted operational fields. Users must not place secrets in prompts. Free text and labels are treated as untrusted data. The legacy logging helper and embeddings are not called. No provider setting is an assertion about the provider's independently configured retention policy; that remains an approval decision. `store:false` disables API completion storage, not all provider processing.

The backend revalidates identity, tenant and permissions before and after each tool and model boundary and before releasing the answer. The same scoped entity validation runs on page hints, every tool entity and each navigation action. Unauthorized/missing record IDs intentionally share a public error. Exact lookup with no match says no matching record was found within the authorized account.

## Narrow operational permission policy

Vehicle-view access permits the same vehicle availability conclusion an operator can inspect, including the existence of a rental/block that occupies it. Rental-view access is separately required to expose the blocking rental ID/number/status/dates or to read its receiving context. Without it, return only a generic blocker with a restricted-coverage label; do not send hidden rental IDs or customers to the model. Availability-view access is required for blocked-period IDs and date details. These summary permissions do not grant access to arbitrary rental or blocked-date records. Vehicle checks validate every fetched row against the server-established tenant and parent vehicle.

Rental context requires rentals view; its associated vehicle ID is sent only after vehicle authorization. Return navigation additionally requires rentals edit and is omitted when records conflict. No customer support-context tool is exposed. Read-only payment tools are exposed only when finance is enabled and the Supabase staff role/permissions allow it (head admin or admin; a manager with Payments, plus Rentals for rental payments), as described in read-only-finance.md.

New logs contain request ID, response status, elapsed milliseconds and model/tool call counts. No prompts, IDs of business records, result payloads or credentials are logged. Hosting/provider log retention remains an environment verification item.

## Tool boundary

The model registry contains search_application_knowledge, resolve_navigation_target, resolve_authorized_entity, get_rental_support_context, diagnose_vehicle_availability, get_account_counts, list_account_bookings, find_available_vehicles, select_support_issue and request_support_handoff. The prepared fallback retains its original two-tool registry. Function names from user/model content are never executed dynamically. Arbitrary SQL/HTTP/shell, business writes and reminder actions remain unavailable. Separately gated finance tools (`get_rental_payment_evidence`, `investigate_rental_payment`, `resolve_payment_dashboard_action`, `get_stripe_account_summary`) use fixed SELECTs and fixed Stripe GET requests in a backend-derived account and environment; no general Stripe client, login link, checkout or financial mutation is exposed. Payment dashboard and receipt URLs are built on the server from verified objects, withheld from the model and re-validated by the portal. Existing reminder functionality outside TRAX is unchanged.

The approved support exception uses fixed UI requests for conversation state, explicit ticket submission and authorized support management. No ticket/storage/cleanup tool is exposed to the model. Conversation and requester-ticket access is owner/tenant/scope-bound. Related record permissions are checked again at handoff, including in the SQL transaction. Cross-tenant support access requires an explicit active `trax_support_agents` grant, not an ordinary admin or super-admin role. Retention controls additionally require `can_manage_policy`; browser RPC/table access is revoked. Permission/grant changes invalidate pending frontend responses and server actions. See [support-escalation.md](support-escalation.md) for 90/365-day defaults, holds, dry-run-only scheduling and production approval gates.

Sources: trax-support/support/auth.ts, registry.ts, conversation.ts and handler.ts; portal permissions.ts, use-manager-permissions.ts, use-trax-support.ts and trax-session.ts. Tests: trax-support.test.ts, trax-session.test.ts and use-trax-support.test.tsx.

Finance-enabled model requests may include minimal recorded payment states and sanitized processor amounts in addition to operational fields. No raw processor payload, customer/card data, credential or account ID enters the model. Finance grants/mapping configuration participate in the conversation scope. Current live data must come from new tool results; no financial cache or historical amount is represented as a fresh read.

## Human support conversation boundary

V2 owners may create/read/reply only to their own tenant tickets. The platform inbox and older queue endpoints require active `app_users.is_super_admin` AND explicit `trax_support_agents` membership. Tenant-admin status or notification email ownership does not grant support access. Counts and read acknowledgements use the same guard as messages. Handoff records are revalidated; see [in-app-support.md](in-app-support.md).
