# TRAX permissions and data boundary

## Verified membership model

Scope is V2 tenants only. The existing `chrome` gate determines eligibility in both the portal and the dedicated backend, using the authenticated, server-loaded tenant on the backend. Northwind is the current canary; future tenants receive TRAX when enrolled in that V2 rollout, without adding a second TRAX tenant list. A super-admin selection, client V2 flag or supplied slug cannot enroll a V1 tenant. V1's original chat path is preserved and is not certified by these controls. Rebuild and review the generated backend policy alongside any V2 rollout change.

Supabase authenticates the bearer token. Staff identity comes from app_users.auth_user_id. Phase 1 requires is_active=true and a recognized role (head_admin, admin, manager, ops, viewer), or a verified super-admin membership.

Ordinary staff use the tenant on their membership. A supplied tenant ID must match it. Super admins can select a tenant only after their server-side super-admin flag is verified and the selected tenant is loaded. Tenant existence/branding, page context, model output and possession of a UUID are not authorization.

Managers receive only their server-loaded tab grants. Settings navigation requires the parent and mapped sub-tab. Viewers cannot receive edit-oriented return links. Finance permissions (including all Stripe account reads) are withheld for every role until an explicit policy is reviewed. No new finance role policy is inferred from the frontend's permissive non-manager canView behavior.

## Navigation and entity access

The allowlist contains only destinations in navigation-map.json. Portal permission definitions, V2 gates, lean gates and the rental stageHref builder are generated from their actual sources. Changes make the knowledge check fail. Unknown destinations, extra URL arguments and unsupported entity kinds fail closed.

Record navigation selects only id and tenant_id, scoped to the authenticated tenant. It is validated at suggestion time and on every click. A manager needs the relevant record permission. Inaccessible and missing record IDs produce the same public error. A page ID cannot change tenancy.

The request handler rechecks membership and effective permissions before returning a response. Signed conversation tokens bind user, tenant, permissions, selected capability fields and the complete prepared knowledge artifact. Client scope values are consistency checks, never permission grants.

## Conversations, retention and provider policy

Phase 1 does not read or insert chat_messages and does not accept client history. Browser messages are cleared on account/permission context change, closure of the active dialog, or reset. Requests are aborted and late results discarded. Focus, realtime invalidation and a 30-second context refresh complement per-request server checks. Polling is not a substitute for server authorization.

The server signs a 30-minute opaque conversation token containing a random conversation ID, the previous prepared section and language. It contains no message text or customer/payment facts. Its signature uses the existing server-held service credential as HMAC key with an explicit Phase 1 domain separator; no credential is returned. Rotation invalidates conversations. A separate signing key can be introduced under a reviewed credential policy later.

No user prompts or records are sent to the model provider in Phase 1. Runtime answers are assembled from verified English/Roman Urdu sections. Request text can rank sections; it cannot edit them, establish facts, create URLs or register tools. Stored notes and legacy embeddings are not loaded at all.

New server logs contain request ID, status and duration only. Platform log retention remains an environment verification item. No new conversation-retention period or provider processing agreement is invented.

## Explicitly absent capabilities

Only search_application_knowledge and resolve_navigation_target are registered. create_reminder, arbitrary SQL, HTTP, shell, write-capable functions, availability diagnosis, Stripe balances, reconciliation and financial mutations are not registered. The reminder UI and its existing domain functions outside TRAX are preserved.

Sources: trax-support/support/auth.ts, registry.ts, conversation.ts and handler.ts; portal permissions.ts, use-manager-permissions.ts, use-trax-support.ts and trax-session.ts. Tests: trax-support.test.ts, trax-session.test.ts and use-trax-support.test.tsx.
