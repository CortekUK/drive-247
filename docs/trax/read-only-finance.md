# V2 TRAX read-only payment investigation

## Rental payment investigation with Stripe verification (2026-09-15)

A granted user can ask for a rental's payments ("Show me the payments for rental #1234X"), have each linked payment checked against its exactly linked Stripe records, investigate one they cannot find in Stripe, get a verified **Open in Stripe** or **View receipt** action, and use **Check again**. English and Roman Urdu follow-ups reuse the rental and payment already established in the authorized conversation. Nothing is created, captured, refunded, transferred or repaired, and the existing charge flow is unchanged.

### Verified Stripe setup (repository and read-only data review)

- Drive247 has two Connect platforms. `uk` ("managed") creates **Express** accounts (`create-connected-account`). `uae` ("own", from 2026-07-03) connects the operator's **Standard** account through OAuth. Every current charge flow is a **direct charge** on the connected account (`Stripe-Account`), per `_shared/stripe-client.ts:getConnectAccountId`.
- History: platform-only card payments before 2025-12-20, destination charges from 2025-12-20 to 2026-01-13 (commit 28977d74), direct charges afterwards. Test mode generally uses the shared account `STRIPE_TEST_CONNECT_ACCOUNT_ID`.
- `payments` records only `platform_account`; it has no account, mode, charge or currency column. Environment evidence is the Checkout Session prefix (`cs_live_`/`cs_test_`). `deposit_hold_links` records account, platform and mode per hold attempt. `tenants.own_stripe_connected_at` is the only account-connection timestamp; managed accounts have none. Portal-created placeholder IDs (`portal-admin-…`) are not Stripe references.

### Routing rules (`payment-routing.ts`)

Each payment's Stripe location is derived on the backend from recorded evidence only. The model, browser and chat never choose an account. In order:

1. A reviewed `TRAX_STRIPE_RECORD_MAPPINGS` entry (rejected if it contradicts the recorded platform or checkout environment).
2. Payments created before 2026-01-13 are **not searched** (platform-era; a reviewed mapping is required).
3. Environment comes only from the checkout prefix or the exact hold record for the stored PaymentIntent; otherwise **environment unrecorded**.
4. The exact hold record's account; else, for `uae`, the current own account only if it was connected **before** the payment; for `uk` live, the current managed account only when the complete live hold history shows that same account in use since before the payment and never another one.
5. Shared test accounts, accounts linked to more than one business, and unprovable accounts are reported explicitly. No other account is ever scanned.

### Tools (strict inputs; rental resolved first; payment access required)

| Tool | Result |
|---|---|
| `get_rental_payment_evidence({rentalId, offset})` | Up to 8 payments per page (all direct and allocation-linked), each with route, fresh Stripe evidence, Drive247 vs Stripe status, verification result (verified, discrepancy, offline, unable + reason), per-currency Stripe-verified totals (captured, refunded, authorized-not-captured), coverage and actions. |
| `investigate_rental_payment({rentalId, paymentId})` | One payment re-verified, with evidence-based explanations separated from suggestions (account and mode, hold vs capture, failed attempt, refund, test mode, Express limitation). |
| `resolve_payment_dashboard_action({rentalId, paymentId})` | One payment re-verified and its permitted action, or the reason none exists. |

The adapter adds one fixed GET shape (`checkout/sessions/{cs}` then `payment_intents/{pi}?expand[]=latest_charge`) in the derived account and environment. It verifies object type, IDs, livemode, the session-to-PaymentIntent link and `tenant_id`/`rental_id` metadata when present; accounts not exclusively owned by the tenant require matching metadata. A PaymentIntent and its charge count once; transfers are never payments. Provider results are discarded if the linked payment rows or routing inputs changed during the read. A 404 is "not found in the recorded account" (receipt not confirmed), a transport failure is "check could not be completed", and neither is reported as "no payment".

### Actions

- **Open in Stripe**: `https://dashboard.stripe.com/[test/]payments/{pi}` only for a verified PaymentIntent in an exclusively owned **Standard** (`uae`) account, with a note to sign in to the account shown. Not live-opened with a tenant account in this pass.
- **Express** (`uk`) accounts get no per-payment link (Express has no single-payment deep link and login links need a separate reviewed flow); TRAX gives the reference and the in-app Integrations destination.
- **View receipt**: only Stripe-hosted `pay.stripe.com/receipts/…` URLs from the verified charge, labelled as a receipt.
- URLs are built on the server, never sent to the model, and re-validated in the portal hook (dashboard link must match the card's own PaymentIntent). They open with `rel="noopener noreferrer"`.

### Conversation, escalation and configuration

The dialog shows "Checking rental payments… Verifying with Stripe…" while a payment question is running (not per-read streaming). Check again re-runs the server-held rental/payment check. A discrepancy scores 75; `request_support_handoff` can reach 100 after partial or failed payment checks, and the handler then creates or reuses the issue's ticket automatically and answers with its real reference. The ticket handoff includes structured `paymentReferences` (internal payment ID, Stripe reference, mode, account label, verification result, reason, observation time), without links, amounts or credentials. A dashboard-link request never creates a ticket.

Activation requires a usable Stripe key for the account's platform and mode — a restricted `rk_` key by preference, otherwise the existing platform secret — and the deployed `trax-stripe-read` edge function; `TRAX_FINANCE_READS=disabled` turns it off even when a key exists, and `=enabled` is retained for environments that provide the key some other way. Who may use payment checks comes from Supabase (staff role and manager tab permissions); there is no separate grant list. Which credential is used, and why read-only does not depend on it, is in the configuration section below.

### Verification status

- Offline: routing, adapter, tools, handler conversation, two-tenant reference isolation, handoff and hook-link validation tests (`trax-payment-investigation.test.ts`, `use-trax-support.test.tsx`), plus `node tests/trax/browser.mjs --finance`.
- Real model with fixture data: gpt-4.1 completed the English/Roman Urdu conversation (show payments, cannot find in Stripe, which account, link, Check again) through the real handler and tools.
- Authorized live Stripe reads: **performed, 2026-09-19.** The first real one in this
  project. `trax-stripe-read` is deployed (v1, ACTIVE since 2026-09-15), Northwind has
  its own Stripe TEST account connected (`own_stripe_test_account_id`), and a USD 500.00
  test payment on rental `R-b8621b` was read back through the deployed bridge with the
  same route the tools build: `intentStatus: succeeded`, `livemode: false`,
  requested/received/captured all `USD 500.00`, `refunded: USD 0.00`,
  `ownership: metadata` (Stripe's own `tenant_id` matched), `platformFlow: false`, and a
  Stripe-hosted receipt URL.

  Everything before this date was fixture-driven: `tests/trax/browser.mjs --finance`
  imports `finance-fixtures.mjs`, so the payment conversation was exercised against
  invented records. Real model, real handler, real tools, no real Stripe.
- Dashboard links opened with a tenant's Stripe account: **none yet.** The link is now
  derivable — Standard account, exclusive to this tenant, not a platform flow — but
  nobody has opened one as the tenant.

The sections below describe the earlier summary/inspection tools, which remain as backend functions; the model now uses the tools above.

Repository review candidate, 2026-09-15, knowledge 0.3.1. This extends the support/escalation package; it does not enable production finance or apply a migration. Source commit and working-tree hashes are in `knowledge-manifest.json`. Deployed release parity is unverified.

## Implemented behavior

Three strict tools now participate in the existing Responses loop. A separately granted user can resolve a rental, inspect its direct and allocation-linked payments, inspect one exact mapped Stripe PaymentIntent, explain a discrepancy and offer the existing explicit Contact Support handoff. No financial mutation tool exists. Missing configuration, mappings, permissions and failed reads remain visible. A model-generated tool name or argument never grants access.

The UI displays canonical financial findings returned by the backend, including observation time and limitations. The model explains the issue and next step; it must not perform money arithmetic. Model availability remains a prerequisite for conversational tool orchestration. If it fails after attempting checks, the response says so and retains completed issue checks for support.

| Tool / strict input | Output | Sources and permissions | Maximum scope / freshness / errors |
|---|---|---|---|
| `get_rental_payment_summary({rentalId, offset})` | Exact linked-record count when bounded reads are complete, up to 25 payment IDs and recorded states, next offset, hold warning. Money totals are null. | `ledger_entries`, `payment_applications`, `payments`; same two-ended relationship used in V2 `useRentalLedgerRows`. Explicit `rental_payments` grant plus native Rentals permission. | One authorized rental. At most 200 entries, 200 applications and 200 payments; 201 is a truncation sentinel. Fresh SELECTs, no cache. Incomplete relationships fail rather than becoming zero. |
| `inspect_rental_payment({rentalId, paymentId})` | Fresh Stripe state, requested/received/capturable/refunded amounts in original minor units and currency, recorded-state differences, mapping review date. | Same rental relationship validated again; exact internal PaymentIntent link plus reviewed historical account/mode/currency mapping. `rental_payments` grant. | One payment from the current rental summary; one GET with expanded latest charge. No search by amount/name. Revalidate the linked record after the read; changed records invalidate the result. |
| `get_stripe_account_summary({})` | Available and pending connected-account funds, each currency separately, test/live mode, observation timestamp. | Current tenant configuration and exclusive Connect ownership check; separate `account_balance` grant. | One verified exclusive connected account. One balance GET, maximum 30 currency entries per balance array. Revalidate configuration/ownership afterward. No platform or shared-test balance fallback. |

Every result uses the existing `OperationalResult`: `status`, `observedAt`, `checks`, `findings`, `sources`, `navigation`, `limitations`, and bounded `data`. Statuses are verified, partial, restricted, missing, error or needs_input. Missing/inaccessible individual records share the same public error. Raw provider errors, notes, identities, card details, client secrets, keys and account IDs are not returned to the model. The ownership check uses an exact head count; it does not load other tenants into context.

## Financial rules and deliberate limits

`apps/portal/src/components/rentals-v2/rental-detail/payments-model.ts:useRentalLedgerRows` gathers both direct rental payments and customer payments applied to that rental's charge entries. The support read adapter follows that relationship without calling allocation/repair functions. It does not create a second ledger calculator.

The checked-in payment/ledger schema has no reliable per-record historical currency snapshot. The current tenant currency cannot prove the currency of older/manual entries. Consequently the rental tool **does not claim an outstanding balance, unapplied credit or aggregate money total**. A future complete rental reconciliation must reuse `buildLedger`/`totals` behind verified currency and complete relationship coverage, including refunds and holds. This remains a gap, not a zero balance. The existing native Payments stage continues to work unchanged.

Stripe account funds and rental finances are different scopes. An authorization amount still capturable is separate from received money. Refunds are not automatically subtracted from rental charges or reallocated. The payment check compares only a reviewed currency-consistent internal amount/refund/capture state with one exact processor record. It reports differences without updating either system. Latest-charge evidence is not a complete investigation of disputes, every attempt, platform transfers or payout timing.

Native routing is verified in `_shared/stripe-client.ts:getConnectAccountId`, `getChargePlatformAccount` and historical `platform_account` fields: own-account charges use the UAE platform; managed charges use UK. Managed test accounts can share a Connect account, and some historic charges used platform context. The balance tool refuses these pooled cases. A payment inspection can use a reviewed exact historical mapping, but this initial adapter requires a connected account and does not inspect historical platform charges. No subscription account is substituted for rental payment routing.

Currency formatting preserves integer minor units. USD/GBP/AED and other reviewed two-decimal currencies divide by 100; JPY and other reviewed zero-decimal currencies do not; reviewed three-decimal currencies use 1,000. ISK/UGX retain Stripe's two-decimal API representation; HUF/TWD balance formatting is not their payout divisibility rule. Unsupported currencies fail closed. Decimal comparisons use integer parsing and never round away a discrepancy. See [Stripe currencies](https://docs.stripe.com/currencies).

## Server configuration and authorization

Payment access follows the authenticated staff record in Supabase, the same finance staff policy as guidance: head admins and admins (super-admins act as head admin) get rental payments and account funds; managers need the Payments tab permission, plus Rentals for rental payments; ops and viewers get none. Nothing is available until a usable Stripe key resolves for that platform and mode.

1. A usable Stripe key enables configuration loading on the V2 server only. `TRAX_FINANCE_READS=disabled` suppresses it regardless; `=enabled` forces loading without one, for an environment that supplies the key elsewhere — every read still refuses with `stripe_configuration_required` until a key resolves.
2. `TRAX_FINANCE_GRANTS` is no longer read. Access comes from Supabase staff roles and manager permissions as described above.
3. `TRAX_STRIPE_RECORD_MAPPINGS` is an optional bounded JSON array of `{tenantId, paymentId, platform, mode, accountId, currency, verifiedAt}`. Platform is `uk` or `uae`, mode is `test` or `live`, currency is the verified three-letter uppercase historical currency, and review date is ISO. This is reviewed server deployment data, not model output or a user-entered chat mapping. Missing links stay missing. It does not change original payment rows. Keep the tenant-specific registry in server configuration, not the shared knowledge bundle.
4. Stripe keys, in order of preference: `TRAX_STRIPE_READ_{UK|UAE}_{LIVE|TEST}_KEY` (`rk_` only), then the packed form below, then **the existing platform secret for the same platform and mode** (`STRIPE_LIVE_SECRET_KEY` and friends). Platform and mode must match exactly; a key for the other mode, the other platform, or a publishable key is never used, and the restricted slots accept nothing but `rk_`.

   The platform-secret step is a deliberate, recorded compromise. Those keys can write. A restricted key remains the preference and `stripeKeyIsRestricted()` reports which kind is in use — but this project sits at Supabase's 100-secret cap, no secret can be removed, and the platform keys are already present, so requiring a restricted key would mean no Stripe reads at all.

   **Read-only therefore rests on the code, not on the credential.** `isReadEndpoint()` is the single boundary: every request path must match one of exactly three shapes — `balance`, `payment_intents/pi_…?expand[]=latest_charge`, `checkout/sessions/cs_{live,test}_…` — and it is checked before a credential is even looked up. Anything else raises `stripe_read_refused` and sends nothing. The returned object exposes only `balance`, `intent` and `evidence`; there is no general request method, no SDK and no write path. That predicate is exported and tested directly rather than through the tools, because the tools' own id checks would reject a bad path first and a test routed through them would pass for the wrong reason. A backend outside Supabase (the local portal) calls the `trax-stripe-read` edge function, which requires the service-role credential and runs the same fixed read-only GETs; key values never leave Supabase. Restricted keys need only the read permissions for Balance, PaymentIntents, Charges and Checkout Sessions.

   Because this project is at its Supabase secret limit, one secret can carry them all: `TRAX_STRIPE_READ_KEYS={"uk":{"live":"rk_live_…","test":"rk_test_…"},"uae":{…}}`, costing one slot instead of four. A per-name variable wins over the packed one for the same platform and mode. A blob that is malformed, oversized, holds a key for the other mode, or holds anything but an `rk_` string yields no key at all — never a partial guess — and the read then refuses.

`STRIPE_TEST_CONNECT_ACCOUNT_ID` is used only to recognize and exclude the existing shared-test account from tenant balance reads. It is never a fallback balance source. Configuration changes alter the authorization scope used for subsequent conversation requests. Identity/membership/manager permissions are freshly checked at every model/tool boundary; returned payment/account mapping changes also invalidate the financial check. Existing support scope invalidation discards incompatible histories and late frontend responses.

No generic HTTP/SQL/client tool exists. The adapter exposes exactly `intent` and `balance`; each constructs a fixed GET to Stripe, refuses redirects, caps the response at 128 KB and uses an eight-second timeout inside the overall request deadline. It never retries automatically. An identical failed finance check is suppressed within a request and for 60 seconds across follow-ups unless the user explicitly requests a retry. No prior result is reused as live money evidence.

The native financial route remains withheld from general TRAX navigation. The tool returns the verified **Open rental** action; authorized staff can use its existing Payments stage. This package adds no financial route, billing state transition, migration or automatic correction. Ticket creation is still only the existing explicit user-click exception and includes relevant redacted issue findings, not raw processor payloads.

## Verification and remaining deployment work

Run the finance tests with `npm.cmd run test -- src/__tests__/lib/trax-finance.test.ts --maxWorkers=1` from `apps/portal`. Run `node tests/trax/browser.mjs --finance` at the repository root for the actual V2 dialog/hook/handler with clearly isolated financial fixtures. Add `--manual` for an interactive fixture browser. This is not a real-model or signed-in tenant test.

Tests cover granted/denied roles, cross-tenant attempts, strict queries, pagination/truncation, direct/allocation-linked records, missing historical mappings, refund/capture differences, exclusive/shared Connect accounts, currency units, missing fields, failures, prompt injection in processor text, blocked write tools, issue handoff, and scope changes. Backend tests exercise the HTTP adapter with mocked Stripe responses; they do not contact Stripe.

Production still requires deploying `trax-stripe-read` and the V2 `trax-support` endpoint, optional reviewed historical mappings, approved support-storage rollout and explicit support-agent assignments. Actual signed-in OpenAI/Stripe/Supabase verification remains outstanding. The previously attempted real OpenAI call returned insufficient quota; no new live-provider success is claimed here. Full rental money totals, complete application documentation, reconciliation accuracy, model-language accuracy and real latency/cost metrics remain unverified. Retention cleanup remains dry-run only until the user's separate production approval.

Final local regression evidence is in [completion-status.md](completion-status.md): 271 targeted tests, 24 isolated SQL tests, four fixture browser modes, strict backend compilation and no additional focused portal diagnostics. The latest real provider check timed out without an HTTP response. Signed-in/live verification is still incomplete.
<!-- trax:payments_record:en -->
To record money received for a rental, open the rental and choose **Payments** in its stage rail. The stage shows **Outstanding**, the **Charges** list and the **Payments** list; manual entries read **Recorded by hand** with no provider record. Select **Take a payment** (it reads **Nothing owed** when nothing is outstanding). In the **Take a payment** window, tick categories under **Apply to**, check **Amount**, then press the confirm button that states the amount and number of charges. The **Record Payment** dialog opens with that amount fixed. Choose **Method** (**Cash**, **Card**, **Transfer**, **Zelle**, **Check** or **Other**), set **Date**, add an optional **Reference**, then select **Record Payment**. If the same amount was recorded on this rental in the last 14 days, you are asked to confirm a possible duplicate. The payment is applied to the chosen charges; if applying fails, nothing is saved. The provider buttons in that dialog create a payment link rather than recording money already received. Use these controls only if your role allows it. TRAX does not record, charge or verify payments.
<!-- /trax -->
<!-- trax:payments_record:ur-Latn -->
Rental par aayi raqam darj karne ke liye rental kholein aur stage rail mein **Payments** chunein. Is stage mein **Outstanding**, **Charges** list aur **Payments** list dikhti hai; haath se darj entries par **Recorded by hand** likha hota hai aur provider record nahi hota. **Take a payment** dabayein (kuch baqi na ho to button par **Nothing owed** likha hota hai). **Take a payment** window mein **Apply to** ke neeche categories tick karein, **Amount** check karein, phir woh confirm button dabayein jis par amount aur charges ki tadaad likhi hoti hai. Phir **Record Payment** dialog usi amount ke saath khulta hai. **Method** (**Cash**, **Card**, **Transfer**, **Zelle**, **Check** ya **Other**) chunein, **Date** set karein, optional **Reference** likhein, aur **Record Payment** dabayein. Agar pichle 14 din mein isi rental par yehi amount record hui ho to duplicate ki confirmation maangi jati hai. Payment chuni hui charges par apply hoti hai; apply na ho sakay to kuch save nahi hota. Dialog ke provider buttons payment link banate hain, mili hui raqam record nahi karte. Ye controls sirf apni role ki ijazat ke mutabiq use karein. TRAX payment record, charge ya verify nahi karta.
<!-- /trax -->
- `apps/portal/src/components/rentals-v2/rental-detail/payments-actions.tsx`
- `apps/portal/src/components/rentals-v2/rental-detail/stage-payments.tsx`
- `apps/portal/src/components/rentals-v2/rental-detail/payments-model.ts`
- `apps/portal/src/components/shared/dialogs/add-payment-dialog.tsx`
- `apps/portal/src/app/(dashboard)/payments/page.tsx`
- `apps/portal/src/components/payments/payment-filters.tsx`
- `apps/portal/src/hooks/use-payment-verification.ts`
<!-- trax:payments_review:en -->
Open **Payments** from the sidebar to see payments across all rentals. The list opens on **This Month**; use **Period** (**7 Days**, **This Month**, **All Time**), the calendar button, **Method**, **Status** and the customer or vehicle search. Select a rental badge to open that rental, then choose **Payments** in its stage rail. Staff with payments edit permission see **Record Payment**, where **Customer** and **Vehicle** are required and the vehicle list shows that customer's active rentals. A **Pending Review** payment shows **Approve Payment** and **Reject Payment**; approving marks it approved and applies it to charges. Rejecting needs **Reason for Rejection**, and the dialog warns that **Reject & close rental** also ends the rental, frees the vehicle, writes off outstanding charges and emails the customer. To drop an unpaid duplicate link without touching the rental, use **Remove payment link** in the row menu. **Reverse Payment** appears only for eligible manual payments, needs **Reason for Reversal**, returns allocated charges to outstanding and cannot be undone. TRAX does not approve, reject, reverse or investigate payments.
<!-- /trax -->
<!-- trax:payments_review:ur-Latn -->
Sidebar se **Payments** kholein. List **This Month** par khulti hai; **Period** (**7 Days**, **This Month**, **All Time**), calendar button, **Method**, **Status** aur customer ya vehicle search use karein. Rental badge dabakar woh rental kholein, phir stage rail mein **Payments** chunein. Payments edit permission wale staff ko **Record Payment** dikhta hai; is mein **Customer** aur **Vehicle** zaroori hain aur vehicle list mein us customer ke active rentals aate hain. **Pending Review** payment par **Approve Payment** aur **Reject Payment** hote hain; approve karne se payment charges par apply hoti hai. Reject ke liye **Reason for Rejection** zaroori hai, aur dialog khabardar karta hai ke **Reject & close rental** poora rental band karta hai, gaari free karta hai, baqi charges write off karta hai aur customer ko email bhejta hai. Rental chheray baghair unpaid duplicate link hatana ho to row menu se **Remove payment link** use karein. **Reverse Payment** sirf eligible manual payments par aata hai, **Reason for Reversal** maangta hai, charges dobara outstanding karta hai aur undo nahi hota. TRAX payment approve, reject, reverse ya investigate nahi karta.
<!-- /trax -->
