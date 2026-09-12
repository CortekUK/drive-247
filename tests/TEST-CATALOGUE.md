# Test catalogue

**GENERATED FILE — do not edit by hand.** Regenerate with `npm run test:docs`
(which runs the suite and rebuilds this from its own JSON report). Editing this
file directly means the next run silently discards your change.

Every test title below is the string the suite actually ran. If a title does not
read as a sentence about behaviour, that is a defect in the test, not in this
document — see the naming convention in [README.md](./README.md#naming-convention).

| | |
|---|---|
| Test files | 48 |
| Tests | 1121 |
| Passing | 1043 |
| Skipped (opt-in Layer 2) | 78 |
| Failing | 0 |
| Known-defect watchdogs | 79 |

## How to read this

- **Layer** is inferred from evidence in the file, not from a naming rule.
  `L1 contract` reads edge-function source text offline. `L2 live` makes real
  HTTP calls and is skipped unless explicitly enabled. `L3 executable` imports
  the shipped module and runs it against hand-derived literals.
- **⚠ watchdog** marks a test declared with `it.fails(...)`. It documents a
  **known, unfixed defect**: the test states the CORRECT behaviour, so it passes
  while the bug exists and turns **red the day someone fixes it**, which forces
  the stale expectation to be revisited. A watchdog going red is good news.
- **skipped** means an opt-in Layer 2 test that needs credentials. Not a failure.


## `tests/integrations/accounting/oauth-callback-state.test.ts`

**Layer:** L2 live, L1 contract · **40 tests** (32 passing, 8 skipped)

### accounting/'Xero' — 'xero-oauth-callback' query contract

- it reads its inputs from the query string, not a body
- it reads exactly the extra parameters this provider sends, and no others
- it is still verify_jwt = false in config.toml

### accounting/'Zoho Books' — 'zoho-oauth-callback' query contract

- it reads its inputs from the query string, not a body
- it reads exactly the extra parameters this provider sends, and no others
- it is still verify_jwt = false in config.toml

### accounting/'Xero' — 'xero-oauth-callback' refuses a bad state

- it refuses a request with no state (and one with no code)
- it refuses a state that is not in accounting_oauth_state
- it refuses a state minted for the OTHER provider
- it refuses an expired state, and compares the clock the right way round
- it selects the columns the guards read, so none of them can fail open
- it handles a provider `error` parameter instead of treating it as success
- it does EVERY state check before the authorization code is redeemed
- it does every state check before any token is stored against a tenant

### accounting/'Zoho Books' — 'zoho-oauth-callback' refuses a bad state

- it refuses a request with no state (and one with no code)
- it refuses a state that is not in accounting_oauth_state
- it refuses a state minted for the OTHER provider
- it refuses an expired state, and compares the clock the right way round
- it selects the columns the guards read, so none of them can fail open
- it handles a provider `error` parameter instead of treating it as success
- it does EVERY state check before the authorization code is redeemed
- it does every state check before any token is stored against a tenant

### accounting/'Xero' — 'xero-oauth-callback' consumes the nonce

- it deletes the nonce once it has been redeemed
- it deletes it only after the tokens are safely stored
- it takes the tenant from the state row, never from the query string
- it stores tokens through the RPC, never by writing the connection row directly
- it never writes a token or the client secret into a log line

### accounting/'Zoho Books' — 'zoho-oauth-callback' consumes the nonce

- it deletes the nonce once it has been redeemed
- it deletes it only after the tokens are safely stored
- it takes the tenant from the state row, never from the query string
- it stores tokens through the RPC, never by writing the connection row directly
- it never writes a token or the client secret into a log line

### accounting/'Xero' — 'xero-oauth-callback' live (Layer 2)

- it live: a provider `error` is reported as an error, not as a success — skipped
- it live: no state at all is refused — skipped
- it live: an unknown state is refused before any code is redeemed — skipped
- it live: a POST is refused with 405 — skipped

### accounting/'Zoho Books' — 'zoho-oauth-callback' live (Layer 2)

- it live: a provider `error` is reported as an error, not as a success — skipped
- it live: no state at all is refused — skipped
- it live: an unknown state is refused before any code is redeemed — skipped
- it live: a POST is refused with 405 — skipped


## `tests/integrations/accounting/oauth-start.test.ts`

**Layer:** L2 live, L1 contract · **34 tests** (28 passing, 6 skipped)

### accounting/'Xero' — 'xero-oauth-start' request contract

- it parses a request shape the shared contract helper cannot
- it agrees with the payload the portal actually builds
- it reads tenantSlug even though the declared Payload type does not mention it

### accounting/'Zoho Books' — 'zoho-oauth-start' request contract

- it parses a request shape the shared contract helper cannot
- it agrees with the payload the portal actually builds
- it reads tenantSlug even though the declared Payload type does not mention it

### accounting/'Xero' — 'xero-oauth-start' refuses before it writes

- it refuses a caller with no Authorization header
- it refuses a bearer token that resolves to no user
- it refuses a caller with no app_users row
- it refuses anyone who is not admin, head_admin or a super admin
- it does every one of those checks BEFORE writing a nonce row
- it checks the server is configured before writing, so a failed click leaves no orphan

### accounting/'Zoho Books' — 'zoho-oauth-start' refuses before it writes

- it refuses a caller with no Authorization header
- it refuses a bearer token that resolves to no user
- it refuses a caller with no app_users row
- it refuses anyone who is not admin, head_admin or a super admin
- it does every one of those checks BEFORE writing a nonce row
- it checks the server is configured before writing, so a failed click leaves no orphan

### accounting/'Xero' — 'xero-oauth-start' hands out a usable state

- it writes tenant_id, the right provider literal, and who started it
- it puts the NONCE in the OAuth state, and never the tenant id
- it builds an authorize URL with response_type, client_id, redirect_uri, scope and state
- it never lets the client secret reach the response
- it is still JWT-verified at the gateway (unlike its callback)

### accounting/'Zoho Books' — 'zoho-oauth-start' hands out a usable state

- it writes tenant_id, the right provider literal, and who started it
- it puts the NONCE in the OAuth state, and never the tenant id
- it builds an authorize URL with response_type, client_id, redirect_uri, scope and state
- it never lets the client secret reach the response
- it is still JWT-verified at the gateway (unlike its callback)

### accounting/'Xero' — 'xero-oauth-start' live (Layer 2)

- it live: an unauthenticated caller is refused — skipped
- it live: a GET is refused with 405 — skipped
- it live: an admin is handed an authorize URL carrying a fresh, unguessable state — skipped

### accounting/'Zoho Books' — 'zoho-oauth-start' live (Layer 2)

- it live: an unauthenticated caller is refused — skipped
- it live: a GET is refused with 405 — skipped
- it live: an admin is handed an authorize URL carrying a fresh, unguessable state — skipped


## `tests/integrations/accounting/provider-asymmetry.test.ts`

**Layer:** L2 live, L3 executable · **17 tests** (16 passing, 1 skipped)

### accounting/asymmetry — region is Zoho's alone

- it zoho-oauth-start accepts a region; xero-oauth-start has no such concept
- it the six connectable regions are the ones the portal offers
- it zoho-oauth-start validates the region BEFORE it authenticates the caller
- it only Zoho persists the picked region on the state row, and only Zoho reads it back
- it only Zoho stores an external_region on the connection

### accounting/asymmetry — scopes are encoded differently on purpose

- it Xero joins scopes with spaces; Zoho joins them with commas
- it each provider still asks for the write scopes the sync path needs
- it refresh tokens are requested by a SCOPE on Xero and by URL PARAMS on Zoho
- it Xero builds its query string by hand, because URLSearchParams would break it

### accounting/asymmetry — the callbacks redeem their codes differently

- it Xero's token endpoint is a constant; Zoho's is chosen at request time
- it Zoho's callback prefers what Zoho SAYS over what the operator picked
- it Zoho's DC codes are mapped, not used raw
- it the callback can persist a region the start function would refuse
- it Zoho treats an HTTP 200 with an error body as a failure; Xero does not need to
- it each callback flips its own tenant flag
- it only Zoho distinguishes an organisations API failure from an empty account

### accounting/asymmetry — live (Layer 2)

- it live: zoho-oauth-start refuses a data centre it does not serve — skipped


## `tests/integrations/accounting/token-expiry.maths.test.ts`

**Layer:** unclassified · **12 tests** (12 passing)

### accounting/maths — expires_in becomes token_expires_at

- it a typical Xero grant (1800s) is stored 1770s ahead
- it a typical Zoho grant (3600s) is stored 3570s ahead
- it the skew always SHORTENS the recorded life, never lengthens it
- it a token granted for exactly the skew is stored as already due
- it a token granted for less than the skew is stored in the PAST, not clamped
- it the unit is seconds -> milliseconds, and one second moves it by exactly 1000ms
- it the stored value round-trips through UTC without drift

### accounting/maths — the two providers guard the input differently

- it Zoho falls back to one hour for any unusable expires_in
- it Zoho still honours a real expires_in rather than always using the fallback
- it Xero's form THROWS on a missing expires_in — after the code is already spent

### accounting/maths — the formula still matches the functions

- it both callbacks still subtract the same skew and multiply by 1000
- it only zoho-oauth-callback carries the 3600s fallback


## `tests/integrations/boldsign/mode.test.ts`

**Layer:** L1 contract · **18 tests** (18 passing)

### boldsign/mode — the key mapping, in all ten copies

- it supabase/functions/_shared/boldsign-client.ts maps live→LIVE and test→TEST
- it apps/portal/src/app/api/esign/route.ts maps live→LIVE and test→TEST
- it apps/portal/src/app/api/esign/sign/route.ts maps live→LIVE and test→TEST
- it apps/portal/src/app/api/esign/view/route.ts maps live→LIVE and test→TEST
- it apps/portal/src/app/api/esign/status/route.ts maps live→LIVE and test→TEST
- it apps/portal/src/app/api/esign/void/route.ts maps live→LIVE and test→TEST
- it apps/portal/src/app/api/esign/signing-redirect/route.ts maps live→LIVE and test→TEST
- it apps/booking/src/app/api/esign/route.ts maps live→LIVE and test→TEST
- it apps/booking/src/app/api/esign/sign/route.ts maps live→LIVE and test→TEST
- it apps/booking/src/app/api/esign/view/route.ts maps live→LIVE and test→TEST
- it the shared edge client refuses to guess when a key is missing

### boldsign/mode — the create path records the mode it used

- it both web send paths stamp the mode on the agreement and the rental
- it the mode is resolved once, at create time, from the tenant
- it a test-mode document tells the customer it is not binding

### boldsign/mode — every reader prefers the mode recorded on the row

- it the webhook reads the agreement's mode, then the rental's, then the tenant's
- it a recorded LIVE mode is never downgraded to test by a later read
- it WATCHDOG (finding 3): a recorded 'test' mode is treated as unset and re-resolved
- it every reader starts at 'test' when nothing at all is known


## `tests/integrations/boldsign/notify.test.ts`

**Layer:** L2 live · **16 tests** (13 passing, 3 skipped)

### boldsign/notify — notify-signing-completed's request contract

- it still declares the completion facts an operator email needs
- it is not exempted from JWT verification, unlike the function that replaced it

### boldsign/notify — the caller, and the chain that replaced it

- it nothing in the repository invokes notify-signing-completed
- it the deployed database carries both triggers that replaced it
- it the signing trigger raises a broadcast operator notification the dispatcher will pick up
- it the dispatcher forwards 'signing_completed' and gates it on the same category the old function used
- it the two paths key their dedupe on DIFFERENT ids — reviving the function double-notifies

### boldsign/notify — notify-signing-completed's own behaviour

- it gates the operator email on the master switch, the category and a real recipient — in that order
- it a tenant-less call is a total no-op that still answers 200 { success: true }
- it the bell it would raise carries the facts the live path does not

### boldsign/notify — the delivery gaps

- it BoldSign's Completed event writes exactly the status the trigger fires on
- it WATCHDOG: an agreement that ends at 'signed' also notifies the operator — skipped
- it WATCHDOG: the operator-email dispatch does not hardcode one project's URL — skipped
- it the dispatch is fire-and-forget and swallows every error — which is WHY a lost email is invisible

### boldsign/notify — live (Layer 2)

- it live: notify-signing-completed answers an unparseable body without notifying anyone — skipped

### boldsign/notify — the snapshot these assertions lean on

- it the deployed-schema snapshot still covers rental_agreements and notifications


## `tests/integrations/boldsign/resend.test.ts`

**Layer:** L2 live, L1 contract · **13 tests** (12 passing, 1 skipped)

### boldsign/resend — a resend is the same call as a send

- it the Resend button and the Send button build the same payload
- it the agreements-page Resend sends everything a rental-detail Send sends
- it the route has no resend-only branch — there is nothing for a resend to get wrong

### boldsign/resend — the prior document is killed so only one link is live

- it prior non-terminal agreements are revoked at BoldSign
- it the revoke NEVER touches the document it has just created
- it only non-terminal agreements are revoked — a signed one is never touched
- it each prior document is revoked with the key it was created under
- it a failed revoke never fails the send it belongs to

### boldsign/resend — resending does not lie, loop or duplicate

- it every resend re-records its own delivery outcome
- it a rate-limited send is retried rather than lost
- it the automation path refuses to create a second live document for one rental
- it the hourly credit-failed sweep cannot resend the same agreement forever

### boldsign/resend — live (Layer 2)

- it live: /api/esign refuses a resend with no rental and no customer — skipped


## `tests/integrations/boldsign/routes.test.ts`

**Layer:** L2 live · **26 tests** (17 passing, 9 skipped)

### boldsign/routes — which verbs each route answers

- it each route exports exactly the handlers it is meant to, and no others
- it the customer-facing link route is the only GET, and it is documented as public

### boldsign/routes — who is allowed to call them

- it every route runs as service_role, which bypasses every policy in the database
- it a missing service key degrades to the anon key, which silently breaks the agreement tables
- it the portal proxy never runs on /api, so no tenant context reaches these routes
- it WATCHDOG: an operator route establishes who is calling before it reaches for data — skipped

### boldsign/routes — tenant isolation

- it the tables these routes address are still the ones with no database net beneath them
- it WATCHDOG: a route scopes its primary lookup to a tenant — skipped
- it the send route still resolves the agreement row's tenant from the RENTAL, server-side
- it WATCHDOG: /api/esign charges credits to the tenant it resolved, not the one it was told — skipped
- it WATCHDOG: /api/esign/view will not download a BoldSign document it was simply handed — skipped
- it WATCHDOG: a failed send does not hand the caller part of the BoldSign API key — skipped

### boldsign/routes — /api/esign/void, the correct model

- it an already-signed agreement is refused on BOTH lookup paths, before anything is revoked
- it nothing is revoked without an identifier, a resolved document and a key
- it the rows are marked voided only AFTER BoldSign confirms, and only the right rows

### boldsign/routes — the guards the other routes do hold

- it /api/esign/sign will not re-open a signed document, or sign without a signer
- it /api/esign/signing-redirect hands the customer a redirect, never the link itself
- it /api/esign/status writes back only the rows the request actually named
- it every route answers with a JSON or text error rather than letting the handler throw
- it no route touches a tenant-owned table it has no business in

### boldsign/routes — arithmetic (Layer 3)

- it the status route's properties cache holds for sixty seconds, to the millisecond
- it a rate-limited send waits 15s then 30s, and gives up after three attempts

### boldsign/routes — live (Layer 2)

- it live: /api/esign/void refuses a request naming no agreement and no rental — skipped
- it live: /api/esign/status refuses a request that resolves to no document — skipped
- it live: /api/esign/signing-redirect refuses a GET with no agreement id — skipped
- it live: the operator routes reject the verbs they do not export — skipped


## `tests/integrations/boldsign/send.test.ts`

**Layer:** L2 live, L1 contract · **29 tests** (26 passing, 3 skipped)

### boldsign/send — LEG A: the BoldSign document is created

- it 'agreements page — Resend' sends a payload the route declares
- it 'AgreementTimeline — Resend' sends a payload the route declares
- it 'AgreementTimeline — Send (missing agr…' sends a payload the route declares
- it 'rental detail v2 — Send/Send again' sends a payload the route declares
- it 'generate-agreement dialog' sends a payload the route declares
- it 'AdminExtendRentalDialog' sends a payload the route declares
- it 'ExtensionRequestDialog' sends a payload the route declares
- it 'rental-create v2' sends a payload the route declares
- it 'rentals/new' sends a payload the route declares
- it 'booking checkout' sends a payload the route declares
- it the server-to-server caller (retry-credit-failed-agreements) sends the same payload
- it both routes still POST the document to BoldSign with the mode's key
- it the document carries a signer and a signature field, or nobody can sign it
- it credits are deducted BEFORE the send, and refunded when the send fails
- it a failed send is recorded on the rental, not swallowed
- it a successful send writes the document id and the mode it was created under
- it additional drivers get their own signer slot, indexed 1-based against a 0-based array

### boldsign/send — LEG B: the customer is actually emailed

- it BoldSign is told never to email the signer, on every send path
- it so send-signing-email is the only channel — and both web routes call it
- it what the routes send matches what send-signing-email declares
- it send-signing-email refuses to pretend: no recipient, no document, no tenant means 400
- it emailSent is measured, never asserted — the regression that hid total delivery failure
- it the portal records the delivery outcome, including the no-email-on-file case
- it leg A and leg B are reported separately to the caller
- it WATCHDOG: the automation send path returns emailSent:true and sends no email
- it WATCHDOG: the automation caller sends a lead payload the function cannot read

### boldsign/send — live (Layer 2)

- it live: create-boldsign-document refuses a body with no rentalId — skipped
- it live: send-signing-email refuses a body with no recipient — skipped
- it live: a real agreement is created for the fixture rental — skipped


## `tests/integrations/boldsign/view.test.ts`

**Layer:** L2 live, L1 contract · **21 tests** (18 passing, 3 skipped)

### boldsign/view — the request contract

- it 'agreements page — View' asks for the document by an identifier the route reads
- it 'agreements page — Download' asks for the document by an identifier the route reads
- it 'rental detail — View' asks for the document by an identifier the route reads
- it 'rental detail — Download' asks for the document by an identifier the route reads
- it 'rental detail v2 — View' asks for the document by an identifier the route reads
- it 'customer portal — View' asks for the document by an identifier the route reads
- it 'customer portal — Download' asks for the document by an identifier the route reads
- it the edge function reads the same identifiers as the route
- it both implementations refuse a request with no identifier at all

### boldsign/view — a signed document opens from storage, never from BoldSign

- it a stored signed PDF short-circuits the BoldSign download
- it a storage path is turned into a URL, and an http URL is passed through
- it a rental with no document at all says so, instead of failing at BoldSign
- it the live document is fetched with the mode recorded on the row
- it the PDF is base64-encoded in chunks, which is what makes a real agreement openable

### boldsign/view — opening the SIGNING page

- it an already-signed document cannot be opened for signing again
- it the signing link is fetched per click, not baked into the email
- it a BoldSign failure at click time is explained, not swallowed into a blank page
- it status reads prefer our own record and only then ask BoldSign

### boldsign/view — live (Layer 2)

- it live: get-boldsign-document refuses a request with no identifier — skipped
- it live: get-boldsign-document 404s on a rental that cannot exist — skipped
- it live: /api/esign/view refuses a request with no identifier — skipped


## `tests/integrations/boldsign/webhook.test.ts`

**Layer:** L2 live, L1 contract · **11 tests** (9 passing, 2 skipped)

### boldsign/webhook — who is allowed to call it

- it is declared verify_jwt = false, so the gateway does not authenticate it
- it WATCHDOG: verifies the caller before it writes anything — skipped
- it CONTAINMENT: a payload it cannot tie to a real document does nothing at all

### boldsign/webhook — what a completed signing actually does

- it downloads and stores the signed PDF only when the document is complete
- it signing does NOT hand over the keys — the rental stays pending
- it both the agreement row and the rental row are kept in step
- it the customer is told, once, when the agreement is signed
- it every BoldSign event type this platform relies on is still mapped

### boldsign/webhook — known defects, pinned

- it WATCHDOG (finding 5): an unrecognised event downgrades the agreement to 'pending'
- it WATCHDOG (finding 6): the additional-driver signing sync is dead code

### boldsign/webhook — live (Layer 2)

- it live: an unsigned payload reaches the function and is stopped only by the missing document id — skipped


## `tests/integrations/bonzah/balance-maths.test.ts`

**Layer:** L1 contract · **24 tests** (24 passing)

### bonzah/balance-maths — the spendable balance

- it allocated=0 broker=1234.50 spends "1234.50" — THE INCIDENT: allocation is 0 for every tenant on this platform, and the broker wallet is what policies actually draw on
- it allocated=null broker=1234.50 spends "1234.50" — /deposit did not answer at all
- it allocated=0.0000 broker=89.10 spends "89.10" — Bonzah's literal 0.0000, not a plain 0
- it allocated=75 broker=1234.50 spends "75" — a genuinely allocated sub-user balance IS preferred
- it allocated=75 broker=null spends "75" — allocation with no broker figure
- it allocated=0 broker=null spends "0" — broker unreadable, allocation zero — report the zero, not nothing
- it allocated=null broker=null spends "0" — nothing readable at all (the function 400s before this in practice)
- it agrees with the copy of the same rule inside bonzah-confirm-payment
- it sums the sub-user allocations without letting one bad row zero the total

### bonzah/balance-maths — the low-balance alert

- it balance 499.99 against a 500 threshold is "warning" — a cent under the threshold
- it balance 250.01 against a 500 threshold is "warning" — a cent above half
- it balance 250 against a 500 threshold is "critical" — EXACTLY half is critical — the comparison is <=, not <
- it balance 249.99 against a 500 threshold is "critical" — a cent under half
- it balance 0 against a 500 threshold is "critical" — empty wallet
- it balance -12.5 against a 500 threshold is "critical" — Bonzah can report a negative balance
- it balance 50 against a 100 threshold is "critical" — half of a different threshold
- it balance 50.01 against a 100 threshold is "warning" — just above half of a different threshold
- it balance 1 against a 1 threshold is "warning" — threshold of 1: half is 0.5, and 1 > 0.5
- it alerts strictly BELOW the threshold, not at it
- it resets the reminder to monitoring once the balance recovers
- it does not re-email on every poll while the balance stays low

### bonzah/balance-maths — the premium a chained purchase needs

- it adds up only the policies that still need buying
- it treats a missing premium as zero rather than poisoning the total
- it prices the chain in the same direction as the number of policies in it


## `tests/integrations/bonzah/download-pdf.test.ts`

**Layer:** L2 live, L1 contract · **17 tests** (15 passing, 2 skipped)

### bonzah/download-pdf — contract

- it agrees with the payload all three download buttons build
- it is built the same way by every caller, including the customer-facing one
- it WATCHDOG: policy_id is optional in the type and mandatory at runtime

### bonzah/download-pdf — guard order and the URL it builds

- it refuses missing ids before it authenticates or calls Bonzah
- it puts the auth token in the URL — and keeps it out of the logs
- it reads the body ONCE, and reads the binary branch first
- it answers with the two keys every caller reads
- it passes the upstream failure status through, and names the upstream
- it never applies the SELL gate — the customer has already paid

### bonzah/download-pdf — the base64 the browser gets back (Layer 3)

- it is not in supabase/config.toml, so the gateway keeps demanding a JWT
- it encodes the PDF magic bytes to the four characters every sniffer looks for
- it encodes a nine-byte PDF header exactly
- it is byte-exact on bytes that are not valid UTF-8 — which every real PDF contains
- it does not blow up on a real-sized PDF — the get-boldsign-document bug shape
- it WATCHDOG: the %PDF text fallback returns a CORRUPTED PDF

### bonzah/download-pdf — live (Layer 2)

- it live: downloads the fixture certificate and it really is a PDF — skipped
- it live: a missing pdf_id is refused before Bonzah is contacted — skipped


## `tests/integrations/bonzah/functional.test.ts`

**Layer:** L2 live, L1 contract, L3 executable · **36 tests** (32 passing, 4 skipped)

### bonzah/functional — bonzah-calculate-premium

- it agrees with the payload both booking widgets build
- it still requires the trip window
- it returns a zero premium with a full zero breakdown when nothing is selected
- it itemises exactly the four coverages the UI renders
- it takes a pickup_state it does not price on — and still demands it

### bonzah/functional — bonzah-create-quote

- it agrees with the portal's buy-insurance payload
- it checks whether this tenant may SELL before it does any Bonzah work
- it refuses a collapsed window instead of answering 200 with no policy
- it blocks a second policy over the same dates unless it is explicitly forced
- it asks Bonzah to finalize, so a payment_id comes back with the quote
- it sends a 5-digit ZIP, because ZIP+4 silently breaks finalization
- it rates on where the car is picked up, not where the renter lives

### bonzah/functional — bonzah-check-vehicle-eligibility

- it agrees with the booking hook's payload
- it fails OPEN on every AI failure path
- it asks the model deterministically
- it still carries the exclusion lists the answer depends on

### bonzah/functional — bonzah-confirm-payment

- it agrees with the portal's confirm payload
- it declares a stripe_payment_intent_id that it never reads
- it short-circuits when every policy in the chain is already active
- it classifies a low balance the same way in both code paths
- it stops the chain at the first balance failure instead of retrying every policy
- it answers 422 with the balance and the premium, not a bare 500

### bonzah/functional — bonzah-get-balance

- it agrees with the portal's balance hook
- it surfaces the original error only when BOTH balance endpoints failed
- it never claims an allocation is needed on the strength of a zero allocation

### bonzah/functional — _shared/bonzah-client.ts

- it points test mode at the sandbox and live mode somewhere else
- it normalises a ZIP+4 down to five digits
- it formats a date the way Bonzah requires (MM/DD/YYYY)
- it trims stray whitespace off stored live credentials
- it fails CLOSED when it cannot read whether selling is allowed
- it refuses a test-mode sale unless a super admin has overridden it
- it keeps servicing an existing policy working in every mode

### bonzah/functional — live (Layer 2)

- it live: the deployed estimator prices five days exactly the way this repo does — skipped
- it live: the estimator refuses a request with no trip window — skipped
- it live: bonzah-get-balance reads the fixture tenant's Bonzah balance — skipped
- it live: bonzah-confirm-payment buys the fixture policy from the sandbox balance — skipped


## `tests/integrations/bonzah/grade-quiz.maths.test.ts`

**Layer:** L2 live · **18 tests** (16 passing, 2 skipped)

### bonzah/grade-quiz — the pass mark (Layer 3)

- it is 80%, and the screen says 80%
- it passes EXACTLY 80% — the boundary, on four different quiz sizes
- it fails the marks just under it
- it a four-question quiz needs all four right

### bonzah/grade-quiz — the scoring pass, executed

- it scores four of five and marks the fifth wrong
- it counts an unanswered question as wrong rather than skipping it
- it ignores answers to questions that are not in the active set
- it compares STRICTLY, so a stringified index scores zero — and the caller knows it
- it never lets the score exceed the total

### bonzah/grade-quiz — contract and guards

- it agrees with the payload the portal hook builds
- it refuses an unauthenticated caller BEFORE it can read the answer key
- it returns the verdict, never the answer key
- it grades only ACTIVE questions
- it refuses an empty question bank instead of dividing by zero
- it only writes when a submissionId is supplied, and never fails the grade over it

### bonzah/grade-quiz — how the gateway sees it

- it is not in supabase/config.toml, so the gateway keeps demanding a JWT

### bonzah/grade-quiz — live (Layer 2)

- it live: refuses the anon key, which is not a user — skipped
- it live: grades an empty submission as zero without writing anything — skipped


## `tests/integrations/bonzah/partner-review.test.ts`

**Layer:** L2 live · **19 tests** (17 passing, 2 skipped)

### bonzah/partner-review — contract

- it agrees with the payloads Bonzah's console builds
- it takes NO tenant id off the request — the submission decides the tenant
- it is invoked by the Bonzah console for both actions

### bonzah/partner-review — the partner gate

- it refuses an unauthenticated caller, and an unresolvable one, with 401
- it checks is_bonzah_partner ABOVE every write and above the body
- it validates the action against a closed list
- it 404s an unknown submission before it writes

### bonzah/partner-review — reject

- it requires a reason, before it writes the rejection
- it records who reviewed it, and leaves an event and a notification

### bonzah/partner-review — approve, and the order that makes it real

- it demands credentials before it touches the tenant row
- it flips to LIVE mode BEFORE verifying — which is the only way the check is real
- it does not trust the HTTP status alone — it reads `valid`
- it rolls the mode back on a rejected verification and on a failed write
- it turns the SELL switch on only after a successful verification
- it leaves both audit events and does not let a failed email undo an activation
- it WATCHDOG: a thrown verification leaves the tenant stranded in live mode

### bonzah/partner-review — how the gateway sees it

- it is not in supabase/config.toml, so the gateway keeps demanding a JWT

### bonzah/partner-review — live (Layer 2)

- it live: refuses the anon key, which is not a user — skipped
- it live: refuses a signed-in non-partner before anything is written — skipped


## `tests/integrations/bonzah/premium-maths.test.ts`

**Layer:** L1 contract, L3 executable · **76 tests** (75 passing, 1 skipped)

### bonzah/premium-maths — the rate card

- it prices exactly four coverages: CDW, RCLI, SLI, PAI
- it charges the published per-24h rate for each one
- it keeps the estimator's rate card and the quote fallback's identical
- it wires each RATES key to the matching request field and premium variable
- it wires the quote fallback's coverage flags to the same rates

### bonzah/premium-maths — calculateDays()

- it counts 2026-03-01 → 2026-03-01 as 1 day(s) — zero-length window still bills one 24h period (Math.max floor)
- it counts 2026-03-01 → 2026-03-02 as 1 day(s) — one night
- it counts 2026-03-01 → 2026-03-06 as 5 day(s) — Ghulam's five-day case
- it counts 2026-03-01 → 2026-03-08 as 7 day(s) — a week
- it counts 2026-02-28 → 2026-03-01 as 1 day(s) — 2026 is not a leap year — Feb 28 to Mar 1 is one day
- it counts 2028-02-28 → 2028-03-01 as 2 day(s) — 2028 IS a leap year — Feb 29 exists, so it is two
- it counts 2026-01-31 → 2026-03-01 as 29 day(s) — across a short month
- it counts 2026-01-01 → 2026-02-15 as 45 day(s) — a long rental, past the 30-day policy limit
- it counts 2026-01-01 → 2026-12-31 as 364 day(s) — a year, to catch an off-by-one that only shows up at scale
- it counts 2026-03-10 → 2026-03-01 as 9 day(s) — reversed dates: Math.abs makes the count symmetric
- it counts 2026-03-07 → 2026-03-09 as 2 day(s) — spans US spring-forward (2026-03-08)
- it counts 2026-10-31 → 2026-11-02 as 2 day(s) — spans US fall-back (2026-11-01) — 49 local hours, still 2 days
- it rounds a part-day UP to a whole 24h period
- it never returns less than one day
- it counts days identically in the estimator and the quote function

### bonzah/premium-maths — rate × days

- it CDW for 1 day(s) is $26.95
- it CDW for 2 day(s) is $53.9
- it CDW for 3 day(s) is $80.85
- it CDW for 5 day(s) is $134.75
- it CDW for 7 day(s) is $188.65
- it CDW for 14 day(s) is $377.3
- it CDW for 30 day(s) is $808.5
- it CDW for 45 day(s) is $1212.75
- it RCLI for 1 day(s) is $23.18
- it RCLI for 2 day(s) is $46.36
- it RCLI for 3 day(s) is $69.54
- it RCLI for 5 day(s) is $115.9
- it RCLI for 7 day(s) is $162.26
- it RCLI for 14 day(s) is $324.52
- it RCLI for 30 day(s) is $695.4
- it RCLI for 45 day(s) is $1043.1
- it SLI for 1 day(s) is $20.18
- it SLI for 2 day(s) is $40.36
- it SLI for 3 day(s) is $60.54
- it SLI for 5 day(s) is $100.9
- it SLI for 7 day(s) is $141.26
- it SLI for 14 day(s) is $282.52
- it SLI for 30 day(s) is $605.4
- it SLI for 45 day(s) is $908.1
- it PAI for 1 day(s) is $6.9
- it PAI for 2 day(s) is $13.8
- it PAI for 3 day(s) is $20.7
- it PAI for 5 day(s) is $34.5
- it PAI for 7 day(s) is $48.3
- it PAI for 14 day(s) is $96.6
- it PAI for 30 day(s) is $207
- it PAI for 45 day(s) is $310.5
- it CDW for 5 day(s) totals $134.75 — Ghulam's case: 'pehli wali insurance', five days
- it CDW + RCLI + SLI + PAI for 5 day(s) totals $386.05 — all four at five days
- it CDW + RCLI + SLI + PAI for 1 day(s) totals $77.21 — all four, the one-day floor
- it CDW + SLI for 3 day(s) totals $141.39 — 80.85 + 60.54
- it CDW + PAI for 5 day(s) totals $169.25 — 134.75 + 34.50
- it RCLI + SLI + PAI for 7 day(s) totals $351.82 — 162.26 + 141.26 + 48.30
- it CDW + RCLI + SLI + PAI for 7 day(s) totals $540.47 — a week of everything
- it CDW + RCLI + SLI + PAI for 14 day(s) totals $1080.94 — a fortnight
- it CDW + RCLI + SLI + PAI for 30 day(s) totals $2316.3 — the 30-day single-policy maximum
- it CDW + RCLI + SLI + PAI for 45 day(s) totals $3474.45 — past the maximum — this one gets chunked
- it nothing for 5 day(s) totals $0 — no coverage selected costs nothing
- it bills the quote fallback at the same cent as the estimator

### bonzah/premium-maths — the rounding rule

- it rounds to the cent, half UP (Math.round), not down and not to even
- it actually applies the rounding — 3 days of RCLI is 69.54, not 69.53999999999999
- it rounds the total as well as each line
- it rounds the amount Bonzah itself returns before storing it as the premium

### bonzah/premium-maths — 30-day chunking is premium-neutral

- it 2026-03-06 → 2026-03-11 (5 days) splits into 1 policy(ies) covering every day once
- it 2026-03-06 → 2026-04-05 (30 days) splits into 1 policy(ies) covering every day once
- it 2026-03-06 → 2026-04-06 (31 days) splits into 2 policy(ies) covering every day once
- it 2026-03-06 → 2026-05-15 (70 days) splits into 3 policy(ies) covering every day once
- it 2026-01-01 → 2026-12-31 (364 days) splits into 13 policy(ies) covering every day once
- it prices a chunked rental exactly as if one policy could cover it
- it returns no chunks at all for a window that collapsed to a single day
- it places the chunk boundaries on the requested calendar dates (UTC runtimes only) — skipped


## `tests/integrations/bonzah/premium-parity.test.ts`

**Layer:** L2 live, L3 executable · **12 tests** (6 passing, 6 skipped)

### bonzah/premium-parity — the sandbox-only guard (Layer 1)

- it knows the two Bonzah worlds from the shipped client, not from a retyped constant
- it accepts the sandbox
- it refuses Bonzah's live API, with no override
- it refuses a host that merely looks like the sandbox
- it refuses something that is not a URL at all rather than assuming it is safe
- it sends the same fields to /Bonzah/quote that bonzah-create-quote sends

### bonzah/premium-parity — live against Bonzah's sandbox (Layer 2)

- it live: Bonzah's own quote for CDW alone over 5 days agrees with our rate card — skipped
- it live: Bonzah's own quote for RCLI alone over 5 days agrees with our rate card — skipped
- it live: Bonzah's own quote for SLI alone over 5 days agrees with our rate card — skipped
- it live: Bonzah's own quote for PAI alone over 5 days agrees with our rate card — skipped
- it live: Bonzah's own quote for all four over 5 days agrees with our rate card — skipped
- it live: the deployed bonzah-create-quote returns the same premium our rate card does — skipped


## `tests/integrations/bonzah/probe-pdf.test.ts`

**Layer:** L1 contract · **16 tests** (16 passing)

### bonzah/probe-pdf — what it is and who calls it

- it accepts exactly the ids bonzah-download-pdf accepts
- it has no caller in the product — it is a deployed, reachable orphan
- it builds every URL from the tenant's resolved apiUrl, never a hardcoded host
- it refuses missing ids before it authenticates or probes anything
- it survives a probe that throws, so one dead endpoint does not kill the diagnostic

### bonzah/probe-pdf — how the gateway sees it

- it is not in supabase/config.toml, so the gateway keeps demanding a JWT

### bonzah/probe-pdf — the couldBePdf verdict (executed)

- it recognises a PDF by its magic bytes, whatever the content-type says
- it needs all four magic bytes — three is not a PDF
- it recognises a PDF by content-type alone
- it recognises a base64 PDF inside JSON, by the JVBER prefix
- it does not call a plain JSON error promising
- it caps the preview at 300 characters
- it reports a thrown fetch as status 0 instead of failing the batch

### bonzah/probe-pdf — the summary counters (executed)

- it counts promising, 2xx and errors — and puts a 3xx in none of them

### bonzah/probe-pdf — why there is no live case

- it is not read-only: ten of its twenty-eight probes are POSTs
- it returns 300 characters of every upstream response to its caller


## `tests/integrations/bonzah/verify-credentials.test.ts`

**Layer:** L2 live, L1 contract · **19 tests** (17 passing, 2 skipped)

### bonzah/verify-credentials — contract

- it agrees with the payload the integrations panel builds
- it takes no `mode` off the request — the DB is the only source of it
- it verifies against the tenant it was told about, not against every tenant

### bonzah/verify-credentials — guard order

- it trims BEFORE it validates, so a space-only password cannot pass
- it validates the trimmed locals, not the raw body
- it refuses a missing tenantId before it touches the database
- it short-circuits test mode ABOVE the live API call, and says so with `platform: true`
- it never applies the SELL gate — servicing must work in every mode

### bonzah/verify-credentials — the answer both callers key on

- it is not in supabase/config.toml, so the gateway keeps demanding a JWT
- it answers HTTP 200 with `valid: false` when Bonzah rejects the login
- it the panel reads `valid`, not the transport error — asserted on both sides
- it WATCHDOG: the older Settings component still reports a short circuit as verified

### bonzah/verify-credentials — the token cache decides the verdict

- it WATCHDOG (executed): a cached token is handed out for the WRONG password
- it a genuinely rejected login throws BONZAH_AUTH_FAILED, cold
- it a token that is present but EXPIRED is re-authenticated

### bonzah/verify-credentials — which Bonzah world a live check reaches

- it live mode resolves to the LIVE insurance host
- it is refused unless BOTH rungs are asked for — the ladder, asserted offline

### bonzah/verify-credentials — live (Layer 2)

- it live: a test-mode tenant is short-circuited, and says so — skipped
- it live: a blank password is refused before the database is touched — skipped


## `tests/integrations/bonzah/view-policy.test.ts`

**Layer:** L2 live, L1 contract · **14 tests** (12 passing, 2 skipped)

### bonzah/view-policy — contract

- it agrees with the portal's refresh payload
- it still snake_cases both ids, because the caller does
- it is the caller's payload, checked from the caller's side too

### bonzah/view-policy — guard order and error handling

- it refuses a missing id before it fetches credentials or calls Bonzah
- it url-encodes the policy id into the query string
- it treats Insillion's `status !== 0` as a failure, not as a policy
- it says which side failed when the body will not parse

### bonzah/view-policy — read-only, and what that is worth

- it is not in supabase/config.toml, so the gateway keeps demanding a JWT
- it writes nothing, which is why it sits on the reads rung
- it never applies the SELL gate — servicing must work in every mode
- it WATCHDOG: the portal's Refresh button cannot refresh anything
- it WATCHDOG: any authenticated caller can name any tenant_id

### bonzah/view-policy — live (Layer 2)

- it live: reads the fixture policy back from Bonzah — skipped
- it live: a missing policy_id is refused before Bonzah is contacted — skipped


## `tests/integrations/harness/edge-contract.test.ts`

**Layer:** L1 contract · **9 tests** (9 passing)

THE CONTRACT PARSER ITSELF — tests/helpers/edge-contract.ts. Layer 3, executed.

### the parser reports the fields a function actually reads

*Use case: A wrong field list is invisible: every contract assertion built on it passes regardless of what the function really reads. This block is the reason the whole L1 layer can be trusted.*

- it reads a plain destructure without picking up an adjacent statement's fields
- it follows a body assigned to a hoisted variable and destructured afterwards
- it follows a body held in a differently-named, type-annotated local
- it still reads the annotated `body` shapes it always understood

### the parser sweep across every body-reading edge function

*Use case: The ceiling is the point. A new edge function using an unknown body shape pushes this over and fails the build, which forces the parser to be taught rather than the function to be silently uncoverable.*

- it never returns an empty field set for a function it claims to have parsed
- it parses the large majority of body-reading functions
- it holds the unparseable count to a ceiling that can only come down
- it throws with a message naming the function and what to do about it
- it caches a parsed shape rather than re-reading the file each time


## `tests/integrations/square/card-payment.test.ts`

**Layer:** L1 contract, L3 executable · **13 tests** (13 passing, 2 watchdog)

SQUARE — the card payment path and the adapter's failure handling. Layer 3 (executable, through the `@fn` alias) plus Layer 1 where the behaviour is structural.

### square card payment — what happens to the row when the charge fails

*Use case: A renter's card is declined, or Square times out, and the operator's payment link is silently killed. The debt is real and now unpayable, and nothing tells anyone.*

- it marks the payment row dead before it has looked at why the call failed
- it writes Reversed and cancelled, which is terminal for a payable link
- it should leave the row payable when the failure was a decline or a timeout — ⚠ watchdog

### square refunds — the handle the caller stores never arrives

*Use case: A refund is issued at Square and recorded here with a NULL handle, so the two can never be reconciled — and the payment reads as refunded. Their own comment shows this class of bug was already fixed once by another route.*

- it emits the refund handle under camelCase keys from the adapter
- it reads it back under snake_case keys the adapter never sends
- it still stamps refund_processed_at even when the handle came back null
- it should read the handle under the key the adapter actually emits — ⚠ watchdog
- it knows a refund is not settled when Square first accepts it

### square money conversion, executed

*Use case: Every amount crossing to Square is integer minor units. A rounding artifact is a cent wrong on every transaction; a null silently coerced to zero charges nothing while reporting success.*

- it converts whole and fractional major units to integer minor units
- it does not lose a cent on values floating point cannot represent exactly
- it returns null rather than zero for anything it cannot convert

### square payment note, executed

*Use case: The reference note is how an operator ties a Square payment in their own Square dashboard back to a rental here. Truncation past Square's limit would break that link silently.*

- it carries the Drive247 reference so a payment can be traced from Square's side
- it never exceeds Square's documented note length


## `tests/integrations/square/oauth-and-webhook.test.ts`

**Layer:** L1 contract · **16 tests** (16 passing)

SQUARE — credential binding and webhook authentication. Layer 1, offline.

### square webhook — authentication happens before anything else

*Use case: A webhook holding the service-role key that verifies its signature after touching the database is a write primitive for anyone who can guess the URL. The ORDER is the security property, not the presence of a check.*

- it reads the raw body before any parse, because the signature covers those exact bytes
- it verifies the signature before constructing the database client
- it states in source that no database is touched before verification passes
- it refuses a request carrying no signature header at all
- it reads the signature from Square's own header name
- it signs the notification URL together with the body, not the body alone
- it is registered as verify_jwt = false, since Square cannot present a project JWT

### square OAuth — the callback's state row is single-use by construction

*Use case: If a used or forged state row could be replayed, an attacker could bind their own Square account to a victim tenant and receive that tenant's rental payments. The single-use guarantee is the whole defence.*

- it consumes the state row with one DELETE that returns it, not a read then a write
- it treats a missing state row as forged or already used, and stops hard
- it rejects a state row that is past its expiry even though it deleted cleanly
- it runs with verify_jwt = false because Square redirects a browser here

### square OAuth — who is allowed to bind a tenant's credentials

*Use case: Without an in-function membership check, any holder of a project JWT could start a connect flow naming someone else's tenant — config.toml warns about this case by name.*

- it resolves the caller against app_users rather than trusting the request
- it records which app user started the flow on the state row itself
- it checks is_active, because a JWT outlives a deactivated admin
- it requires a JWT for both connect and disconnect, unlike the callback
- it re-checks authority inside disconnect rather than relying on the gateway alone


## `tests/integrations/square/refund-idempotency.test.ts`

**Layer:** L1 contract, L3 executable · **21 tests** (21 passing, 1 watchdog)

SQUARE — refund idempotency, the provider seam's fail-safe direction, and the capability binding rule. Layer 3 (executable) plus Layer 1 (source contract).

### square refunds — the retry-dedup seed the adapter was built around

*Use case: A retried refund that mints a fresh idempotency key sends real money out twice. The adapter was built to prevent exactly this and a per-attempt random id defeats it.*

- it gives the same idempotency key to a retry of the same refund, when seeded by prior-refunded
- it gives a different key to a genuine second refund once the first has banked
- it gives a DIFFERENT key to a retry once a random per-attempt id is used instead
- it mints a fresh per-attempt refund id, leaving the prior-refunded fallback dead code
- it is not rescued by any caller supplying a stable refundIdempotencyId, because none does
- it should derive the refund key from durable state so a retry cannot double-refund — ⚠ watchdog

### square refunds — minor-unit conversion, executed

*Use case: Every amount crossing to Square is integer minor units. A float artifact here is a cent lost or gained on every transaction, and a null coerced to 0 refunds nothing while reporting success.*

- it converts major units to integer minor units
- it does not lose a cent to floating point on a value that cannot be represented
- it returns null rather than zero for a value it cannot convert

### square seam — the fail-safe direction, executed

*Use case: When the tenant's provider cannot be determined the seam must degrade to Stripe, never to the unbuilt rail. A schema-lagging deploy must not throw on every Stripe checkout.*

- it routes a tenant whose provider column is missing to Stripe, never to Square
- it treats only the exact string 'square' as Square, so a stale enum value cannot route money
- it names the exact tenant columns the seam needs, so a hand-rolled select cannot drift
- it leaves squareMode null for a Stripe tenant even when a stale square_mode is set
- it defaults a Square tenant with no mode to test, never to live
- it lets a cron skip a Square row without aborting the whole batch
- it throws only on an explicit Square tenant, and passes everything else through

### square seam — capabilities, executed

*Use case: One flag, supportsStoredCredential, is what switches off installments, auto-extend and deposit holds for Square. If it flips, unattended charges are attempted on a rail that cannot store a card.*

- it reports that Square cannot store a credential for later unattended charging
- it reports that Square refunds settle asynchronously while Stripe's do not
- it reports that Square has no cancel URL and needs a location id
- it hands back the Stripe manifest for any provider it does not know
- it freezes both manifests so no request handler can mutate a capability at runtime


## `tests/integrations/square/seam-correlation.test.ts`

**Layer:** L3 executable · **40 tests** (40 passing)

SQUARE ADAPTER AND CLIENT — correlation, idempotency, timeouts, versioning.

### correlating a Square payment back to a rental

- it quick_pay carries ONLY the three fields Square documents
- it the FULL reference reaches payment_note — no 40-char truncation
- it order_id is returned as the column the caller must persist
- it the returned referenceId is the full value, never a truncation
- it buildSquarePaymentNote clamps to 500, not to 40

### Square idempotency key derivation

- it a TRUE retry of the same money de-duplicates
- it a CORRECTED amount mints a new key
- it a different currency mints a new key
- it currency CASE is not a difference
- it idempotencyScope separates two charges that share reference AND amount
- it an EMPTY reference never collapses two charges into one link
- it the key respects Square's length ceiling

### Square currency handling

- it checkout sends the LOCATION's currency, not the caller's casing
- it a MISMATCH fails pre-flight, before any Square call
- it an unknown location currency FAILS on checkout
- it an unknown location currency FAILS on refund too — one policy
- it refund sends the location currency and the real MAJOR-unit amount
- it checkout and refund agree by construction on the same connection

### Square client — which requests may carry an idempotency key

- it /oauth2/token never receives an injected idempotency_key
- it the whole /oauth2 namespace is idempotency-incapable
- it money writes DO still get the idempotency_key
- it a GET cannot express a body at all (compile-time)
- it a cast-in GET body is dropped rather than crashing fetch

### Square idempotency seed precedence

- it the request-level idempotency key beats a body key
- it a write with a key and no body still sends the key
- it a non-object body with a key throws instead of dropping it

### Square client — webhook verification fails closed

- it an empty signature key returns false, it does not throw
- it an unset/undefined key and an empty URL also fail closed
- it a genuine signature still verifies

### Square client — timeouts, rate limits and retryability

- it a hung Square call is aborted at its deadline
- it a timeout is classed retryable
- it a 429 surfaces as a distinct retryable error honouring Retry-After
- it a 429 with no Retry-After backs off conservatively
- it retry-After accepts both delta-seconds and an HTTP-date
- it a 4xx that is NOT a rate limit stays a plain SquareError

### Square client — the API version pin

- it a malformed version falls back instead of poisoning every call
- it an impossible calendar date is rejected
- it an unpublished future version warns but is NOT hard-failed
- it a long-stale version warns
- it the shipped pin is clean and unset falls back silently


## `tests/integrations/square/seam-dispatch.test.ts`

**Layer:** L3 executable · **25 tests** (25 passing)

SQUARE SEAM — routing, guards, capabilities and dispatch.

### the checkout seam — a Stripe tenant passes straight through

- it a Stripe tenant is never handled by the seam

### provider resolution from the tenant row

- it absent provider column degrades to stripe, never square
- it squareMode is null for stripe tenants

### the Stripe guard — which tenants it refuses

- it fails OPEN on an unselected column (protects Stripe at runtime)
- it blocks only an explicit square value

### query predicates that scope a read to one provider

- it applyStripeOnly emits .eq(payment_provider,'stripe')

### the capability manifest

- it square cannot store a credential, stripe can
- it square's tight correlation limits are recorded
- it country gate refuses unknown country for a constrained provider

### Square idempotency key derivation

- it long keys sharing a prefix do NOT collide after clamping
- it short keys pass through unchanged

### Square webhook signature verification

- it valid signature verifies; tampering fails

### Square status mapping

- it aPPROVED (authorised, uncaptured) must NOT read as Completed
- it a Square refund starts Pending, not Completed

### the checkout seam — skip results

- it is handled, is a skip, and carries a machine-readable reason

### adapter results served by Square

- it handled with a body and no skip flag

### the provider registry

- it exactly one native rail, and it is stripe

### Square OAuth scopes

- it scope list omits the app-fee scope and never relies on the default

### the checkout seam — routing and skip reasons

- it a STRIPE tenant passes through, untouched
- it a tenant-read ERROR degrades to Stripe, it does not throw
- it a MISSING tenant row degrades to Stripe
- it an UNKNOWN provider value degrades to Stripe, never to Square
- it a SQUARE tenant needing a stored credential SKIPS, and does not throw

### the refund seam — routing

- it a STRIPE payment record passes through regardless of tenant
- it a tenant-read error FAILS rather than silently using sandbox


## `tests/integrations/square/seam-refund-math.test.ts`

**Layer:** L3 executable · **18 tests** (18 passing)

SQUARE REFUND MATHS AND RESULT SHAPE.

### refund maths — the event sequence that produced a wrong total

- it the real 7-event sequence yields £20, not £50

### assorted seam behaviour

- it matches Square's own refunded_money for that payment
- it the £120 payment (two refunds, £40 + £80) totals £120
- it rEJECTED and FAILED refunds are excluded — no money moved
- it a refund that goes PENDING then REJECTED unwinds to zero
- it events for OTHER payments are never counted
- it returns null when nothing countable exists — caller must not guess
- it status and remaining are derived from the corrected total, never stale
- it over-refund cannot drive remaining negative
- it payments row has no amount_cents and no currency — guard against regression
- it majorToMinorUnits converts dollars to cents
- it majorToMinorUnits rounds — a bare multiply produces a non-integer Square rejects
- it majorToMinorUnits accepts numeric strings (PostgREST returns numeric as string)
- it majorToMinorUnits returns null rather than NaN for junk
- it reading the OLD column name yields null — the exact bug, now pinned
- it a full refund resolves an amount from the real row (no silent skip)

### refund maths — order independence

- it any permutation gives the same total

### refund maths — replay safety

- it replaying the same event 50 times does not inflate


## `tests/integrations/stripe/charge-capture.test.ts`

**Layer:** L2 live, L1 contract, L3 executable · **83 tests** (80 passing, 3 skipped, 19 watchdog)

### stripe/charge-capture — the capability that decides whether a card may be charged at all

- it says a Stripe tenant may store a card and charge it with nobody present
- it says a Square tenant has no stored card to charge and no hold to capture
- it answers for a provider it has never heard of by handing back the Stripe row
- it today no function that moves money in this family reads the capability table
- it charge-saved-card decides whether to charge off-session by asking the capability, not by comparing a provider name — ⚠ watchdog
- it sync-payment-intent refuses a Square payment row through the seam rather than a name comparison — ⚠ watchdog
- it turns a provider that cannot be charged away with a 200 skip, never an error
- it keeps the hold engine free of any provider branch, which is only safe because the hold is refused upstream

### stripe/charge-capture — charging the card on file with nobody present

- it reads exactly the eight fields the portal's payment dialog sends, and no others
- it refuses a caller with no bearer token before it has even parsed the body
- it lets head_admin and admin charge, and a manager only with an editor grant on the payments tab
- it gives SCA its own answer on both routes — the thrown decline and the returned status
- it reports an insufficient-funds decline as charge_failed 402 carrying Stripe's own decline code
- it writes an audit row for a decline, then returns above the payments insert so nothing is recorded
- it refuses a currency whose minor-unit rule is not encoded, before Stripe is called
- it converts an operator's typed amount to minor units by currency, so a zero-decimal charge is not multiplied
- it blocks a second identical amount on the same rental for ten minutes unless the operator confirms
- it refuses the charge when it cannot prove the payment is not a duplicate
- it today builds its Stripe idempotency key without the amount in it
- it binds the amount into the server's own idempotency key rather than trusting the client to — ⚠ watchdog
- it never unwinds a successful charge: an unrecordable payment is its own loud 500
- it recognises Stripe's idempotent replay and returns the existing payment instead of a second row
- it hands settlement to apply-payment and calls no settle RPC of its own

### stripe/charge-capture — approving a pending booking captures its authorisation

- it agrees with the payload the portal's approve-booking hook sends
- it ignores the rentalId the rental-detail screen also sends, which is harmless but not a contract
- it captures the whole authorisation or none of it: no amount is ever sent to Stripe
- it refuses a second capture on the stored capture_status before Stripe is called
- it today decides a PaymentIntent was already captured by matching words inside an error message
- it branches on the Stripe error code and answers from the PaymentIntent's real status — ⚠ watchdog
- it today captures money without checking who asked, and writes the caller's own claim into verified_by
- it authorises the caller against the payment's own tenant before capturing, and derives verified_by from that — ⚠ watchdog
- it today swallows the failure of the very update that stops the next double capture
- it surfaces a failed capture_status write instead of reporting success over it — ⚠ watchdog
- it today divides the captured amount by a hundred whatever the currency was
- it reports the captured amount through a currency-aware conversion — ⚠ watchdog

### stripe/charge-capture — capturing a security-deposit hold

- it agrees with the payload the portal's charge-deposit dialog sends
- it authorises the caller and refuses a body tenantId that disagrees with the rental
- it refuses a capture larger than the authorisation before any Stripe call
- it splits a partial capture into a captured amount and a remainder that adds back to the hold
- it keeps the remainder on the same authorisation when the card allows multicapture
- it replaces a released remainder with a fresh hold and re-anchors every provenance column with it
- it captures on an auto-extend rental but deliberately does not re-hold the remainder
- it answers a hold that is no longer capturable with an actionable code at HTTP 200
- it today calls an already-captured hold 'expired' and tells the operator the funds went back
- it distinguishes a captured hold from a released one from a lapsed one — ⚠ watchdog
- it refuses a second capture once the hold has been fully captured
- it today accepts an amount that is not a number, which walks straight through the ceiling
- it requires a finite positive amount, so the over-capture ceiling cannot be bypassed by a type — ⚠ watchdog
- it writes nothing at all when a newer authorisation has taken over the rental mid-capture
- it merges a second same-day capture into the existing Security Deposit charge instead of colliding
- it today converts the captured amount with a hardcoded hundred, on both the capture and the rollover
- it converts deposit money in a currency-aware way at every conversion site — ⚠ watchdog
- it today prices the rollover hold in the tenant's CURRENT currency, not the authorisation's
- it takes the rollover's currency from the authorisation it is replacing — ⚠ watchdog

### stripe/charge-capture — rejecting a pending booking releases its hold

- it agrees with the payload the portal's reject-booking hook sends
- it keeps all three refusals above the Stripe cancel and above every database write
- it changes nothing when Stripe refuses to release the hold
- it today reads Stripe's resource_missing as proof the hold is gone
- it refuses on resource_missing and re-reads the PaymentIntent on an unexpected state — ⚠ watchdog
- it today computes holdReleased and then never reads it, so the success message can be untrue
- it gates the release-shaped writes and the release-shaped message on an actual release — ⚠ watchdog
- it today aims its 'void the unpaid charges' step at a table that does not exist
- it voids the rental's outstanding ledger rows through the table the rest of the system writes — ⚠ watchdog
- it today lets the request body choose which tenant's Stripe account the cancel is aimed at
- it resolves the tenant from the payment record and 403s a body tenantId that disagrees — ⚠ watchdog

### stripe/charge-capture — reconciling a payment row against Stripe

- it today stamps a payment 'captured' on the strength of a session merely having a PaymentIntent
- it writes 'captured' only when Stripe says the money was actually taken — ⚠ watchdog
- it today cannot tell 'Stripe says not paid' from 'we could not reach Stripe'
- it distinguishes an unreachable Stripe from an unpaid session — ⚠ watchdog
- it today has no terminal-state guard, so a rejected or refunded payment can be re-stamped Completed
- it refuses to resurrect a payment that is already in a terminal state — ⚠ watchdog
- it refuses to allocate a checkout payment Stripe never captured
- it today accepts a paymentId and a set of target categories from anyone who can reach it
- it authorises its caller before reallocating settled money — ⚠ watchdog

### stripe/charge-capture — how the unattended retry engine reads a decline

- it puts insufficient funds and a bare card_declined on the slow ladder, not the dead-card path
- it treats an expired or lost card as a dead card, and our own database blip as transient
- it classifies in the order SCA, funds, dead card, transient, and calls anything else ambiguous
- it stops asking the issuer after eight attempts, on ladders that never shorten a funds decline
- it treats the fallback hold window as four days and labels anything derived from it a guess
- it rotates the replacement authorisation's idempotency key with the attempt and the amount

### stripe/charge-capture — live (Layer 2)

- it live: capture-booking-payment answers a payment id that cannot exist without capturing anything — skipped
- it live: capture-deposit-hold turns an anon caller away before it looks at any money — skipped
- it live: capture-deposit-hold refuses to capture more than the authorisation, before Stripe is called — skipped


## `tests/integrations/stripe/checkout-health.test.ts`

**Layer:** L2 live, L1 contract, L3 executable · **72 tests** (71 passing, 1 skipped, 16 watchdog)

### stripe/checkout — the health check: can a payment link be created at all

- it every rental checkout creator answers with both an identifier and a payable URL
- it the rental checkout takes one line item, in payment mode, and returns it with a 200
- it the live layer recognises the production project ref wherever it is written
- it the live layer throws rather than calling a target that names production
- it live: a checkout of an arbitrary amount comes back with a Stripe session id and a payable URL — skipped

### stripe/checkout — where the amount comes from

- it PINS TODAY'S BEHAVIOUR: the caller names the price, and it reaches Stripe unchecked
- it PINS TODAY'S BEHAVIOUR: no rental checkout creator asks who the caller is
- it the rental checkout amount is derived server-side, not taken from the request body — ⚠ watchdog
- it a rental checkout request is refused unless the caller can be tied to the rental — ⚠ watchdog
- it the deposit-hold checkout, which mints the same kind of link, authorises before it reads anything
- it the instalment upfront checkout reads the money out of the database, which is the shape the rental path needs
- it charging a card already on file requires an authenticated portal admin first

### stripe/checkout — currency, mode and the fields a webhook resolves on

- it every rental session is a one-off payment, never a subscription
- it the session currency is the tenant's configured currency, lower-cased
- it PINS TODAY'S BEHAVIOUR: the rental checkout falls back to GBP where every sibling falls back to USD
- it all rental creators share one fallback currency — ⚠ watchdog
- it every rental session stamps the rental id into its metadata
- it tenant_id reaches Stripe on every rental path, though the pre-auth path puts it on the PaymentIntent only
- it the rental checkout's metadata bag stays well inside Stripe's 50-key ceiling
- it client_reference_id carries the rental on the paths a return page has to reconcile
- it the success URL carries the session id template so the return page can find what was just paid
- it a cancel URL is always supplied, which Stripe honours and Square cannot
- it PINS TODAY'S BEHAVIOUR: the rental checkout's redirect fallback is a developer's laptop
- it the redirect-URL fallback is a production domain on every rental path — ⚠ watchdog
- it a caller-supplied success or cancel URL is validated before it reaches Stripe — ⚠ watchdog

### stripe/checkout — how long a rental payment link stays payable

- it no rental creator sets expires_at, so every link lives Stripe's default 24 hours
- it voiding a link is best-effort at Stripe precisely because a session older than a day is already dead

### stripe/checkout — the money arithmetic (Layer 3)

- it converting major to minor units rounds, so 19.99 becomes 1999 and never 1998
- it the values that silently become zero are refused instead of converted
- it an amount above zero but under Stripe's 50-cent minimum clears the only local guard we have
- it the capability table's Stripe limits are the numbers the gates are written against
- it the Stripe rail rounds to minor units at every one of its call sites, and to cents in the ledger row
- it PINS TODAY'S BEHAVIOUR: the pre-auth session can authorise more than its payments row records
- it the pre-auth session's line items sum to the amount its payments row records — ⚠ watchdog

### stripe/checkout — what a second click does

- it PINS TODAY'S BEHAVIOUR: no creator passes an idempotency key, so a repeat mints a second payable link
- it PINS TODAY'S BEHAVIOUR: the second call cannot adopt the first row, so it inserts another Pending payment
- it two identical checkout requests for one rental produce one session and one Pending row — ⚠ watchdog
- it a rental whose checkout has already been paid is refused a second link — ⚠ watchdog
- it the stored-card path refuses to move money without an idempotency key, and de-duplicates behind it
- it the Square rail folds the amount and currency into its key, which is the identity the Stripe rail needs

### stripe/checkout — the four ways money is taken, at the point the link is made

- it way 1: an auto charge on a stored card mints no checkout session at all
- it way 2: the on-screen 'pay via Stripe' checkout sends exactly the fields create-checkout-session reads
- it way 3: the emailed link is the SAME session, and send-invoice-email only mints one when none is handed to it
- it way 4: a manually recorded payment never touches Stripe, and cannot be allocated as if it had
- it PINS TODAY'S BEHAVIOUR: the instalment upfront row claims to be captured before anyone has paid
- it a payments row written before the customer pays never claims to be captured — ⚠ watchdog

### stripe/checkout — the refusals

- it a zero total is refused with an instruction, before any Stripe client is built
- it a negative or missing total is refused by that same guard
- it the excess-mileage link refuses a non-positive amount before it emails anybody
- it PINS TODAY'S BEHAVIOUR: the pre-auth path validates no amount whatsoever
- it the pre-auth path refuses a zero, negative or missing total before calling Stripe — ⚠ watchdog
- it PINS TODAY'S BEHAVIOUR: a live tenant with unfinished Connect onboarding is charged to the Drive247 platform account
- it a live managed tenant with no completed Connect onboarding is refused, not silently rerouted — ⚠ watchdog
- it an own-Stripe tenant going live with no OAuth connection fails loudly instead of charging the platform
- it a test-mode tenant is routed to the shared test Connect account
- it PINS TODAY'S BEHAVIOUR: voiding a link resolves Stripe from the tenant's CURRENT config, not the payment's
- it voiding a link expires it on the account the payment was created under — ⚠ watchdog
- it a payment carrying real money can never be voided as a link, and a mid-request payment is not either
- it a deposit of zero is a skip, never a zero-amount authorisation link
- it a per-rental deposit override of exactly zero is honoured as an opt-out rather than read as unset
- it get-stripe-config refuses a request that names no tenant, and 404s one that is not active
- it PINS TODAY'S BEHAVIOUR: get-stripe-config hands out the UK platform key whichever account the tenant charges on
- it get-stripe-config returns the publishable key of the account the tenant's charges are created on — ⚠ watchdog

### stripe/checkout — the provider seam, and what it does not protect

- it a Stripe tenant returns from the seam before it inspects amount, currency or idempotency
- it the vault requirement is computed from what this request will later need, never from the provider's name
- it PINS TODAY'S BEHAVIOUR: three creators gate a feature on the provider's NAME instead of a capability
- it a feature the provider cannot perform is refused because a capability is false — ⚠ watchdog
- it PINS TODAY'S BEHAVIOUR: every provider skip is explained to the operator as a saved-card problem
- it the operator-facing refusal is derived from the reason the seam actually raised — ⚠ watchdog
- it a provider failure becomes a non-2xx and a skip never masquerades as a created link
- it PINS TODAY'S BEHAVIOUR: a request that resolves no tenant at all is still served, on the platform account
- it a checkout request that resolves no tenant is refused — ⚠ watchdog


## `tests/integrations/stripe/checkout.test.ts`

**Layer:** L2 live, L1 contract, L3 executable · **8 tests** (6 passing, 2 skipped)

### stripe/checkout — the signup subscription

- it resolves the amount from the plan, never from the request
- it bills in the currency and interval the plan card advertised
- it creates the subscription as default_incomplete so nothing is charged before the card is confirmed
- it does not put a tenant_id on the Stripe objects — the tenant does not exist yet
- it hands the browser everything a card confirmation needs, and nothing more
- it reuses an incomplete subscription instead of spawning one per declined card

### stripe/checkout — live (Layer 2)

- it live: a declined test card leaves the subscription incomplete and charges nothing — skipped
- it live: a test-mode PaymentIntent confirms and the subscription becomes active — skipped


## `tests/integrations/stripe/partial-payment.test.ts`

**Layer:** L2 live, L1 contract · **9 tests** (6 passing, 3 skipped)

### stripe/partial-payment — the fields a partial refund stands on

- it expresses a partial refund as an amount plus a category
- it still distinguishes a partial refund from a full one
- it settles the security deposit LAST when money comes in — the order the cap is computed from
- it caps a partial refund at what THIS payment put into THIS category
- it flips a payment to Refunded only when the partials add up, and counts each one once
- it shrinks the ceiling by what has already been given back

### stripe/partial-payment — live (Layer 2)

- it live: a partial refund draws only from the category it names, up to what that category was paid — skipped
- it live: a partial refund that exceeds the remaining balance is refused — skipped
- it live: two partial refunds summing to the charge leave the payment fully refunded — skipped


## `tests/integrations/stripe/refund-edge-cases.test.ts`

**Layer:** L2 live, L1 contract, L3 executable · **43 tests** (42 passing, 1 skipped, 12 watchdog)

### stripe/refund-edge-cases — what is still refundable, and when the next partial is refused

- it anchors the model: the paid portion and the overdraw comparison are still written the way these cases assume
- it reads a fully paid category as fully refundable and an unpaid one as not refundable at all
- it shrinks the balance by each successive partial refund and refuses the one that would overdraw it
- it counts the fourth partial as refused only because the first three were each recorded once
- it refuses a zero-balance category with its own message rather than letting the processor answer
- it refuses an overdraw before a Stripe client is even constructed, not merely before the refund call
- it treats refundType as a label: a 'full' refund is still exactly the amount the operator typed

### stripe/refund-edge-cases — a partial refund of a payment that settled several categories

- it anchors the cap: the subtraction still uses the payment's own cross-category refund total
- it lets a deposit refund take only what the payment put into the deposit, never what paid the rental
- it records only what moved, and leaves the shortfall refundable instead of marking it settled
- it today allocates the REQUESTED amount across the contributing payments while recording only what MOVED
- it should distribute what actually moved across the payments, not what was requested — ⚠ watchdog
- it today clamps a legitimate deposit refund to zero on a mixed payment and then asks the processor for zero
- it should refuse or record ledger-only when the clamp leaves nothing to send the processor — ⚠ watchdog

### stripe/refund-edge-cases — where the settlement order actually lives

- it is not decided in the provider refund seam, which knows nothing about categories
- it today leaves Security Deposit out of the database's FIFO ranking entirely, so a paid deposit reads as unpaid
- it should rank every category a customer can actually pay, so a paid charge stays refundable — ⚠ watchdog
- it keeps the ledger's uniqueness key and the refund merge lookup keyed the same way

### stripe/refund-edge-cases — an uncaptured authorization is a void, not a refund

- it refuses to refund a pre-authorization and writes no ledger row for it
- it today tells the operator that the refusal SUCCEEDED, with the full request as the recorded amount
- it should report a refused refund as a failure, with nothing recorded — ⚠ watchdog
- it cancels the hold instead of refunding it when the rental itself is cancelled

### stripe/refund-edge-cases — a PaymentIntent with no headroom left

- it decides there is nothing left from Stripe's own figures, retrieved in this request
- it today records NOTHING on that path and still answers success, because its manual-refund fallback is unreachable
- it should record the ledger-only refund it says it is recording when the processor has nothing left — ⚠ watchdog

### stripe/refund-edge-cases — the payout and the ledger row are reported independently

- it keeps a ledger failure with no payout behind it retryable, and one with a payout behind it a reconciliation
- it today decides retryability from a Stripe-only handle, so a Square payout whose ledger write failed is offered as retryable
- it should decide retryability from whether the provider moved money, not from which handle column exists — ⚠ watchdog
- it does not ask the accounting queue to credit a ledger row that never landed
- it today finds that row by an exact reference string the same-day merge has already rewritten
- it should pass the id of the row this refund actually wrote to the accounting queue — ⚠ watchdog

### stripe/refund-edge-cases — the cancellation path's own idea of full and partial

- it today refunds the ENTIRE PaymentIntent for a 'partial' cancellation with no amount, and records nothing at all
- it should refuse a partial cancellation refund with no positive amount, before the processor is called — ⚠ watchdog
- it today records payment.amount for a full cancellation refund instead of the amount the processor returned
- it should record what the processor actually returned on a full cancellation refund — ⚠ watchdog
- it today throws before it can refund anything on a rental with two card payments, because the list is declared after it is filled
- it should declare unrefundedOtherPayments above the branch that fills it — ⚠ watchdog

### stripe/refund-edge-cases — the refund window

- it declares a 365-day window and a 20-refund ceiling for Square, and no ceiling at all for Stripe
- it today enforces neither: no refund function looks at a payment's age or at how many refunds it already has
- it should refuse a refund past the provider's window locally, before the provider is called — ⚠ watchdog
- it should refuse the 21st partial refund on a payment the provider caps at 20 — ⚠ watchdog
- it keeps the one refund capability that IS consulted on the only axis that can switch partials off

### stripe/refund-edge-cases — live (Layer 2)

- it live: a refund of zero is refused outright rather than being treated as a full refund — skipped


## `tests/integrations/stripe/refund.test.ts`

**Layer:** L2 live, L1 contract · **9 tests** (6 passing, 3 skipped)

### stripe/refund — the process-refund request contract

- it parses a destructured request body (a shape the signup functions never use)
- it agrees with the portal's refund payload
- it still requires an amount and a reason
- it refuses an over-large refund BEFORE any Stripe client is built
- it refuses an Extension refund with no extensionId before it reads anything
- it reports whether the ledger row landed, separately from whether Stripe paid out

### stripe/refund — live (Layer 2)

- it live: an Extension-category refund without extensionId is refused — skipped
- it live: refunding more than was captured is refused before Stripe is called — skipped
- it live: a full refund against a test-mode charge returns 200 and records one ledger row — skipped


## `tests/integrations/stripe/subscription-and-credits.test.ts`

**Layer:** L1 contract · **22 tests** (22 passing, 1 watchdog)

STRIPE — SUBSCRIPTIONS AND CREDITS. Layer 1, offline.

### subscription webhook — the lifecycle events it handles

*Use case: A subscription lifecycle event that is silently dropped leaves the tenant's access state wrong in one direction or the other — either a paying tenant is locked out, or a cancelled one keeps full access indefinitely.*

- it acts on checkout.session.completed rather than ignoring it
- it acts on customer.subscription.created rather than ignoring it
- it acts on customer.subscription.updated rather than ignoring it
- it acts on customer.subscription.deleted rather than ignoring it
- it acts on invoice.paid rather than ignoring it
- it acts on invoice.payment_failed rather than ignoring it
- it acts on invoice.voided rather than ignoring it
- it acts on invoice.marked_uncollectible rather than ignoring it
- it acts on invoice.deleted rather than ignoring it
- it covers both directions of failure, not just the happy path
- it runs with verify_jwt off, so its signature check is the only gate

### subscription trials

*Use case: A trial that is set wrong either bills a tenant on day one of a free trial, or gives away a month. Stripe rejects trial_period_days:0 with a 400, so the zero case is a real branch and not a hypothetical.*

- it passes Stripe an exact trial_end timestamp rather than a day count
- it sends neither trial key when the plan has no trial, because Stripe rejects zero

### subscription plans — where the price comes from

*Use case: Plan amounts must come from the plan record, never from the caller. This is the same class of hole found on the rental checkout rail, and here it is closed — worth pinning so it stays closed.*

- it creates a real Stripe Product and Price when a plan is configured
- it creates a replacement Price rather than mutating one, because Prices are immutable

### credits — which do involve Stripe Products, contrary to my earlier report

*Use case: The team lead named credits explicitly. Every purchase mints new Stripe objects, and a retry mints another set plus another payable session — the same missing-idempotency shape found across the rental checkout rail.*

- it creates a one-time Stripe Price for the exact credit amount
- it names the product after the credit quantity so it is identifiable in Stripe
- it buys credits as a one-time payment, never as a recurring subscription
- it carries the credit quantity in session metadata so the webhook can grant it
- it mints a brand-new Price and Product on every single purchase, reusing nothing
- it passes no idempotency key, so a retried purchase mints a second payable session
- it should make a repeated credit purchase idempotent — ⚠ watchdog


## `tests/integrations/stripe/webhook.test.ts`

**Layer:** L2 live, L1 contract, L3 executable · **69 tests** (68 passing, 1 skipped, 16 watchdog)

### stripe/webhook — health: can anyone tell whether Stripe is still being heard

- it declares all four Stripe webhooks open at the gateway, with the reason written beside them
- it keeps the reconciliation tail behind the gateway, so only Stripe's own deliveries are unauthenticated
- it PINS TODAY'S BEHAVIOUR: no Stripe booking webhook records a delivery anywhere
- it shows the Square rail doing it properly, which is why the Stripe gap is a gap and not a design
- it finds the claim table the booking forks need already in the schema, used by a different Stripe rail
- it every Stripe webhook platform records its deliveries, so health can be read per platform — ⚠ watchdog
- it PINS TODAY'S BEHAVIOUR: the only Stripe money-recovery cron writes no heartbeat
- it the every-minute Stripe recovery cron writes a heartbeat, so a dead job is visible — ⚠ watchdog

### stripe/webhook — signature verification, and that it fails closed

- it reads the stripe-signature header and verifies it through Stripe's own constructor, in every fork
- it never uses the synchronous constructEvent, which cannot work on Deno at all
- it never parses the request body into an event, which is the fail-open branch that was exploitable
- it answers 400 for a missing header and 500 for a missing secret, which are different faults
- it finishes verifying before it touches the database, so an unsigned POST can write nothing
- it refuses a present-but-wrong signature only after every candidate secret has been tried
- it builds its candidate secret list without ever calling Deno.env.get on an empty string

### stripe/webhook — live (Layer 2)

- it live: an unsigned POST is refused rather than acked — skipped

### stripe/webhook — which platform account a verified event is attributed to

- it PINS TODAY'S BEHAVIOUR: only one of the three UAE-capable secrets flips the account to uae
- it every UAE-named secret that can verify also resolves the platform account to uae — ⚠ watchdog

### stripe/webhook — a redelivery of the same event id

- it PINS TODAY'S BEHAVIOUR: verification runs straight into the dispatch switch with no event-id claim between
- it shows the claim-then-release shape the Stripe forks are missing, working on the Square rail
- it every Stripe booking webhook claims the event id before it dispatches — ⚠ watchdog
- it leans entirely on the FIFO allocator to keep a replayed rental payment from being applied twice
- it PINS TODAY'S BEHAVIOUR: a replayed payment_intent.succeeded rewrites the row's status unconditionally

### stripe/webhook — out-of-order delivery

- it PINS TODAY'S BEHAVIOUR: no Stripe status write is compared against the row it is overwriting
- it shows the Square rail moving a payments row forward only, and zeroing it when it goes terminal
- it Stripe status writes are monotonic against the row they are updating — ⚠ watchdog
- it PINS TODAY'S BEHAVIOUR: account.updated applies whatever the last delivery said, without reading event.created
- it account.updated applies a Connect health patch only when the event is newer than what is stored — ⚠ watchdog
- it PINS TODAY'S BEHAVIOUR: the legacy fork's PaymentIntent backfill re-captures capture_status on every redelivery

### stripe/webhook — an unrecognised event, and an internal failure

- it acks an unrecognised event type with a log line and a 200 rather than an error
- it answers 500 from the booking forks' outer catch, which is the only way to ask Stripe again
- it PINS TODAY'S BEHAVIOUR: the Connect fork answers 400 from its outer catch, telling Stripe not to retry
- it every Stripe webhook answers 500 on an internal failure, reserving 400 for a bad request — ⚠ watchdog

### stripe/webhook — which events are handled and which are dropped

- it handles exactly seven event types in each moded booking fork, no more and no fewer
- it handles six of those seven in the legacy fork, which never learned the pre-auth deadline event
- it handles exactly the two Connect account-lifecycle events, and no money events
- it PINS TODAY'S BEHAVIOUR: a disputed charge, a failed refund and an invoice event are dropped with a log line
- it PINS TODAY'S BEHAVIOUR: the forks' own prose names invoice.paid as an event they serve, and no such handler exists
- it a disputed charge reaches a handler rather than the default log line — ⚠ watchdog

### stripe/webhook — the test, live and legacy split

- it keys each moded fork to its own Stripe mode, from the API key to the signing secrets
- it PINS TODAY'S BEHAVIOUR: the legacy fork is mode-agnostic and keyed on the variable .env.example documents as a test key
- it PINS TODAY'S BEHAVIOUR: the legacy fork never allocates a rental payment and never stamps the platform account
- it the legacy fork either reaches parity on the simple-rental path or is retired — ⚠ watchdog
- it PINS TODAY'S BEHAVIOUR: one UAE Connect secret is offered to both the test and the live fork

### stripe/webhook — an expired checkout session

- it PINS TODAY'S BEHAVIOUR: the expired handler writes only the rentals table, in all three booking forks
- it does correctly refuse to cancel a rental that is no longer Pending
- it shows nothing downstream terminalising the row either, so Pending is genuinely permanent
- it finds the terminal status the expired branch needs already defined, and already meaning exactly this
- it an expired checkout session leaves its payments row terminal rather than Pending for ever — ⚠ watchdog
- it leaves a zero-minute overlap between a session's life and the recovery cron's window (Layer 3)

### stripe/webhook — a cancelled authorisation

- it recognises a cancelled security-deposit hold and never mistakes it for a cancelled booking
- it cancels only a rental still awaiting payment, and cancels nothing when the status read fails
- it PINS TODAY'S BEHAVIOUR: a never-captured authorisation is recorded 'Refunded' with its balance still allocatable
- it a cancelled, never-captured PaymentIntent is recorded Reversed with nothing left to allocate — ⚠ watchdog

### stripe/webhook — the lookups that decide whose money this is

- it PINS TODAY'S BEHAVIOUR: the simple-rental lookup throws its read error away and then inserts
- it shows the same fork doing the same lookup safely a few hundred lines earlier, so the unsafe form is not house style
- it no money-path lookup in a Stripe webhook discards its read error before inserting — ⚠ watchdog
- it PINS TODAY'S BEHAVIOUR: payments.stripe_checkout_session_id carries no unique index, though its Square counterpart does
- it payments.stripe_checkout_session_id is protected by a unique index, the way the Square key is — ⚠ watchdog
- it PINS TODAY'S BEHAVIOUR: the refund and cancel handlers resolve a row with .single() on a column that is not unique

### stripe/webhook — a declined card

- it PINS TODAY'S BEHAVIOUR: payment_intent.payment_failed rings the operator bell and tells the customer nothing
- it finds a deployed function built for exactly this and called by nothing in the repository
- it payment_intent.payment_failed invokes notify-payment-failed with the fields it declares — ⚠ watchdog

### stripe/webhook — the arithmetic (Layer 3)

- it converges on a replay, because Stripe's amount_refunded is cumulative and the handler SETS it
- it PINS TODAY'S BEHAVIOUR: measures full-vs-partial against the row's nominal amount, not against money captured
- it measures the full-vs-partial refund threshold against money actually captured — ⚠ watchdog
- it abandons its deposit-hold sync well inside Stripe's acknowledgement budget
- it PINS TODAY'S BEHAVIOUR: that budget is a hand-typed literal, where the Square rail derives its own from the manifest
- it derives the Stripe hold-sync budget from the capability manifest rather than typing it twice — ⚠ watchdog


## `tests/integrations/webhooks/health.test.ts`

**Layer:** L1 contract, L3 executable · **41 tests** (41 passing, 2 watchdog)

WEBHOOK HEALTH AND SENDER VERIFICATION — every platform we receive from. Layer 1, offline.

### sender verification — every money webhook authenticates who sent it

*Use case: A webhook that believes an unsigned request is a write primitive for anyone who learns the URL — and every one of these runs with verify_jwt off, so the signature is the ONLY thing standing between a stranger and the database.*

- it verifies the sender's signature before trusting anything in stripe-webhook-test
- it verifies the sender's signature before trusting anything in stripe-webhook-live
- it verifies the sender's signature before trusting anything in stripe-connect-webhook
- it verifies the sender's signature before trusting anything in square-webhook
- it verifies the sender's signature before trusting anything in subscription-webhook
- it runs every one of them with verify_jwt off, which is why the signature is load-bearing
- it accepts anything at all on the BoldSign webhook, which holds the service-role key
- it should verify the BoldSign sender before writing agreement state — ⚠ watchdog

### observability — every platform records its deliveries

*Use case: This is the gap the team lead named, and it is now closed. If a platform stops delivering, or we start rejecting it, webhook_deliveries is what makes that visible — these tests keep the recorder wired in.*

- it records delivery health for stripe-webhook-test
- it records delivery health for stripe-webhook-live
- it records delivery health for stripe-connect-webhook
- it records delivery health for square-webhook
- it records delivery health for subscription-webhook
- it records delivery health for the BoldSign webhook too, which verifies nothing
- it records an outcome on every terminal path, not only the happy one
- it builds its own client in the catch, where the handler's is out of scope
- it keeps Square's own event table, because that is its only replay defence

### the health recorder is fail-open by construction

*Use case: Observability must never cost a payment. If the recorder can throw, a full table or an unmigrated database turns a monitoring gap into an outage, because a 500 makes the processor retry.*

- it returns void rather than a success flag, so no caller can branch on it
- it swallows a rejected insert instead of propagating it
- it bounds the insert with a short deadline so it cannot eat a handler budget
- it never echoes a raw provider error, which can carry request fields
- it truncates over-long ids rather than letting the insert fail

### the health table migration

*Use case: The table is the thing an alert queries. If anon could read it, the public booking bundle's key would expose which processors we use and how often they fail; if it were unique on event_id, a genuine redelivery would be lost.*

- it is drafted as PENDING and not applied, so nothing reaches production unreviewed
- it is additive — one new table and one new view, altering nothing that exists
- it revokes the public and signed-in roles, because this is platform-ops data
- it creates no permissive policy, so a restored grant still reads nothing
- it does not make event_id unique, because a redelivery is a fact worth recording
- it allows a null event_id, because a rejected delivery is the most worth recording
- it answers 'when did this platform last reach us' as one query
- it ships a rollback that leaves the webhooks working, only unobservable

### the documented unauthenticated surface versus the real one

*Use case: CLAUDE.md is what a new engineer threat-models from. Understating the unauthenticated surface by a factor of seven means the endpoints that most need scrutiny are the ones nobody knows to look at.*

- it registers dozens of functions as verify_jwt = false, not the handful documented
- it still tells the reader there are ten of them
- it should state the real count of unauthenticated functions — ⚠ watchdog

### the health recorder, executed against clients that misbehave

*Use case: The fail-open guarantee is the whole safety argument for adding a database write to six money handlers. Asserting it from source text only proves the words are there; these EXECUTE the recorder against clients that misbehave in each of the ways a real one can.*

- it resolves without throwing when the insert returns an error
- it resolves without throwing when the insert REJECTS rather than returning an error
- it resolves without throwing when the client itself is missing or malformed
- it resolves without throwing when .from() throws synchronously
- it writes the delivery as one row with the fields an alert needs
- it truncates an over-long event id instead of letting the insert fail
- it normalises absent optional fields to null rather than undefined
- it refuses a non-finite duration rather than sending NaN to an integer column


## `tests/spine/onboarding/01-plan-select.test.ts`

**Layer:** L3 executable · **4 tests** (4 passing)

### 01 — plan select (the run is seeded with one fixed amount)

- it seeds the chain with starter at $99
- it charges what it advertises — the seeded plan costs the same on both sides
- it every plan matches field-for-field across the display and money catalogues
- it keeps the Stripe lookup key in step with the price


## `tests/spine/onboarding/02-account.test.ts`

**Layer:** L2 live, L1 contract · **5 tests** (3 passing, 2 skipped)

### 02 — account: the signup-begin payload contract (Layer 1)

- it sends exactly the fields signup-begin reads
- it carries the plan seeded in step 01, not one of its own
- it hard-validates the three fields the account form collects

### 02 — account: live status (Layer 2)

- it signup-begin is deployed and rejects a body it cannot price — skipped
- it signup-begin returns 200 for a complete payload — CREATES A REAL AUTH USER — skipped


## `tests/spine/onboarding/03-slug-check.test.ts`

**Layer:** L2 live, L1 contract · **4 tests** (2 passing, 2 skipped)

### 03 — slug check: payload contract (Layer 1)

- it sends exactly the fields signup-slug-check reads
- it refuses an unauthenticated caller before it touches the tenants table

### 03 — slug check: live status (Layer 2)

- it is deployed, and its auth gate answers 401 — no session, no writes — skipped
- it returns 200 for an available slug when a real signup session is supplied — skipped


## `tests/spine/onboarding/04-payment.test.ts`

**Layer:** L2 live, L1 contract · **5 tests** (4 passing, 1 skipped)

### 04 — payment: the signup-payment-intent contract (Layer 1)

- it sends exactly the fields signup-payment-intent reads
- it never lets the browser name the price
- it charges the amount seeded at step 01 — the 99 reaches the Stripe payload
- it declares a Stripe TEST card, never a live one

### 04 — payment: live status (Layer 2)

- it signup-payment-intent is deployed and its auth gate holds — skipped


## `tests/spine/onboarding/05-provision.test.ts`

**Layer:** L2 live, L1 contract · **6 tests** (4 passing, 2 skipped)

### 05 — provision: the signup-provision contract (Layer 1)

- it sends nothing signup-provision does not read, and reads nothing unexcused
- it names every field the function reads but the browser does not send
- it still refuses to provision without accepted terms
- it proves the drift detector actually detects drift

### 05 — provision: live status (Layer 2)

- it signup-provision is deployed and its auth gate holds — skipped
- it signup-provision returns 200 and creates a tenant — run this by hand, never in CI — skipped


## `tests/spine/rental/01-pricing-maths.test.ts`

**Layer:** L3 executable · **31 tests** (31 passing, 3 watchdog)

THE MOST IMPORTANT TEST IN THIS SUITE — Layer 3, pure maths, no network.

### rental pricing — the day count

*Use case: A wrong day count multiplies through every downstream figure — base rent, per-day extras, insurance premium and tax. This is the single number the whole invoice hangs off.*

- it counts a same-date rental as one day rather than zero
- it counts nights, not calendar days touched: Mar 1 -> Mar 4 is three days
- it is unaffected by pickup and return times, which are not inputs at all
- it survives a spring-forward DST boundary without gaining or losing a day
- it survives a fall-back DST boundary, the case local-midnight maths gets wrong

### rental pricing — tier selection at the boundaries

*Use case: Picking the wrong tier bills a month at the daily rate, or a week at the monthly rate. The boundaries at 7 and 30 days are where an off-by-one costs real money.*

- it prices 1 days on the daily tier as 89.00 x 1 = 89.00
- it prices 6 days on the daily tier as 89.00 x 6 = 534.00
- it prices 7 days on the weekly tier as 75.00 x 7 = 525.00
- it prices 8 days on the weekly tier as 75.00 x 8 = 600.00
- it prices 27 days on the weekly tier as 75.00 x 27 = 2025.00
- it prices 28 days on the weekly tier as 75.00 x 28 = 2100.00
- it prices 29 days on the weekly tier as 75.00 x 29 = 2175.00
- it prices 30 days on the monthly tier as 65.00 x 30 = 1950.00
- it prices 31 days on the monthly tier as 65.00 x 31 = 2015.00
- it switches to weekly at exactly 7 days, not 8
- it switches to monthly at exactly 30 days, not 31

### rental pricing — where the price goes DOWN as the rental gets longer

*Use case: These non-monotonic points are legitimate tier discounts, but an operator quoting by hand will hit them and conclude the system is wrong. Pinned so the shape is documented rather than disputed.*

- it makes a 7-day rental cheaper than a 6-day one, because the weekly rate lands
- it makes a 30-day rental cheaper than a 29-day one, because the monthly rate lands

### rental pricing — rounding

*Use case: Rounding order decides whether the invoice total and the amount charged agree to the cent. Rounding per-day and rounding once at the end give different answers.*

- it returns exactly the weekly rate for 7 days even though 500/7 does not divide
- it rounds the accumulated fraction once at the end for 8 days
- it never returns a value with more than two decimal places

### rental pricing — a vehicle with no monthly rate configured

*Use case: A live pricing defect: the tier fallback skips weekly for rentals of 30 days or more, so the renter is billed at the daily rate and one extra day costs 495.00 more.*

- it falls through to the DAILY rate at 30 days, making one extra day cost 495.00 more
- it should fall back to the weekly rate, not the daily rate, at 30 days — ⚠ watchdog

### rental pricing — a vehicle with no rates at all

*Use case: An unpriced vehicle must yield 0 and an empty breakdown, never NaN. NaN propagates silently into the invoice and the Stripe amount.*

- it returns zero and an empty breakdown rather than NaN
- it still reports the day count when it cannot price the rental

### rental pricing — inputs the engine cannot price safely

*Use case: Three inputs that produce a confident wrong number instead of an error — the worst failure mode for money code, because nothing downstream can tell it from a real price.*

- it returns a price of zero with a NaN day count when handed an ISO datetime
- it should price an ISO datetime the same as the date-only string it contains — ⚠ watchdog
- it silently bills a reversed date range as a single day instead of rejecting it
- it produces an infinite price when a tenant has monthly_tier_days set to zero
- it should never return a non-finite price, whatever monthly_tier_days holds — ⚠ watchdog
- it treats a negative monthly_tier_days the same hostile way


## `tests/spine/rental/02-invoice-maths.test.ts`

**Layer:** L1 contract, L3 executable · **25 tests** (25 passing)

THE SIMPLE-RENTAL INVOICE — Layer 3 maths plus a Layer 1 contract on the composition. No network.

### invoice — the base rent, executed for real

*Use case: The anchor figure the rest of the invoice is computed against. If this is wrong every proportional term (tax, service fee) is wrong with it.*

- it charges 89.00 x 3 = 267.00 for the three-day daily-tier rental

### invoice — extras

*Use case: Extras are the one line the operator edits most, and per_day versus per_trip is a single string comparison away from billing three times too much or a third too little.*

- it bills a per-day extra once for every rental day: 15.00 x 1 x 3 = 45.00
- it bills a per-trip extra exactly once regardless of length: 25.00 x 1 = 25.00
- it treats a missing billing_type as per-trip, which is the historical default
- it bills 'PER_DAY' in the wrong case as a flat per-trip charge, because the check is exact
- it sums the selected extras to 70.00 and ignores the one not selected
- it skips a zero or negative quantity rather than billing it
- it skips a selected id that is not in the catalogue instead of throwing
- it multiplies by quantity: two seats for three days is 15.00 x 2 x 3 = 90.00
- it floors a fractional day count and never bills fewer than one day
- it returns extras unrounded, leaving rounding entirely to the caller

### invoice — Bonzah insurance, both taken and declined

*Use case: The team lead asked for both paths by name. A declined coverage must contribute exactly 0 to the total, not absent and not NaN, because it is still a term in the sum.*

- it charges 26.95 x 3 = 80.85 for CDW alone on a three-day rental
- it charges nothing at all when the renter declines every coverage
- it prices all four coverages additively: 80.85 + 69.54 + 60.54 + 20.70 = 231.63
- it scales strictly linearly, with no multi-day discount

### invoice — the grand total, composed by hand from the real parts

*Use case: Proves the eight terms compose to the figure a human gets on paper, and quantifies what widening the tax base would cost (55.32 on one three-day rental).*

- it sums to 953.895 for the scenario at the top of this file
- it would be 55.32 higher if tax were charged on the whole invoice instead of the rent
- it carries a sub-cent residue, because nothing in the chain rounds to cents

### invoice — the composition contract, read from the shipped source

*Use case: The composition lives in a React component and cannot be imported, so its shape is asserted from source. Catches the change that actually happens: someone widens the tax base or adds a ninth term.*

- it computes tax on the discounted vehicle total, not on the whole invoice
- it computes a percentage service fee on the same narrow base as tax
- it builds the grand total from exactly the eight expected terms
- it does not round anywhere in the composition, which is why the residue survives
- it excludes the deposit from the total on the HOLD path and includes it on the CHARGED path
- it returns a zero deposit when the operator has turned deposits off entirely
- it drops the Bonzah premium to zero once the quote attempt has failed


## `tests/spine/rental/03-rental-create.test.ts`

**Layer:** L1 contract · **18 tests** (18 passing, 2 watchdog)

RENTAL CREATION — the first step of the team lead's spine. Layer 1, offline.

### rental create — the vehicle double-booking guard

*Use case: Two rentals on one vehicle for the same window means one renter arrives to find no car. The trigger is the only thing preventing it, so its blind spots are the risk.*

- it refuses a second rental for the same vehicle over an overlapping window
- it ignores rentals that are Cancelled, Rejected or Closed when looking for a clash
- it treats an open-ended rental as occupying the vehicle until the end of time
- it lets an extension push its own end date out without clashing with itself
- it cannot see a rental whose status is NULL, so such a rental blocks nothing
- it should guard the status comparison against NULL — ⚠ watchdog
- it takes no lock, so two simultaneous bookings of one vehicle can both commit

### rental create — the row both paths write

*Use case: RLS is off on the core tables, so tenant isolation and correct dates are entirely the application's job at insert time. A row written wrong here is wrong forever.*

- it stamps tenant_id on the portal insert, because RLS is off on this table
- it sets an explicit status on both insert paths rather than leaving it NULL
- it stores an open-ended pay-as-you-go rental with a null end_date
- it formats the picker date with format(), never toISOString(), on the portal path
- it has no dropoff_time column anywhere — the columns are pickup_time and return_time

### rental create — rentals.monthly_amount means two different things

*Use case: The same column holds an operator-entered monthly rate from the portal and a whole invoice total from the booking site. Anything that re-bills from it over-charges by the deposit and tax.*

- it stores the operator-entered monthly rate when the portal creates the rental
- it stores the entire invoice total when the booking site creates the rental
- it offers no discriminator on the row itself beyond which app wrote it

### rental create — availability rules that are not enforced at insert

*Use case: Tier toggles and minimum durations are advisory in the widget and re-checked nowhere, so a booking the operator disabled is still written to the database.*

- it does not check the vehicle tier-availability toggles on the customer path
- it does not check the tenant minimum rental duration on the customer path
- it should re-check tier availability where the rental row is written — ⚠ watchdog


## `tests/spine/rental/04-payment-methods.test.ts`

**Layer:** L1 contract · **13 tests** (13 passing, 2 watchdog)

THE SPINE'S PAYMENT STEP — the four ways money is taken. Layer 1, offline.

### method 1 — auto charge on a stored card

*Use case: An unattended charge that runs twice takes the renter's money twice, and a cron is exactly where a retry happens unseen. This is the only path in the whole payment surface that guards against it, so it is the reference standard.*

- it refuses to run without a caller-supplied request id
- it derives its Stripe idempotency key from the rental and that request id
- it persists the request id on the payment row so a duplicate can be recognised later

### method 2 — the on-screen checkout, and what it writes before payment

*Use case: A row written before the customer pays must not claim the money arrived. Anything reading capture_status to decide "is this paid?" would treat an unpaid link as settled.*

- it records a not-yet-paid checkout as requiring capture and pending verification
- it explains in source why capture_status is requires_capture on the Stripe path
- it stamps payment_date at link creation, which is not when the money arrived

### method 3 — the same checkout link, emailed

*Use case: The team lead was explicit that this is the SAME link, not a second payment mechanism. If it ever diverges, two operators doing what they believe is the same action produce different rows.*

- it accepts a payment URL created elsewhere rather than minting its own
- it can also create its own session, which is a second and differently-behaved path

### method 4 — a manually recorded payment

*Use case: A hand-entered payment is the operator asserting money arrived outside Stripe. It must be distinguishable from a Stripe-settled one, or reconciliation against the Stripe dashboard can never balance.*

- it records the operator-supplied payment date rather than inventing one
- it is not marked auto-approved, because a human is the one asserting it

### the creators disagree about a payment that has not happened yet

*Use case: Two creators write opposite values for the same situation. Whichever screen an operator happens to look at decides whether an unpaid rental looks paid — and one of them also skips the human verification queue entirely.*

- it marks an upfront checkout captured and auto-approved before the customer pays
- it should write the same not-yet-paid state as every other creator — ⚠ watchdog
- it should give every payment creator the idempotency guard auto-charge already has — ⚠ watchdog


## `tests/spine/rental/05-notifications.test.ts`

**Layer:** L1 contract · **14 tests** (14 passing, 2 watchdog)

THE SPINE'S EMAIL AND NOTIFICATION STEP — Layer 1, offline, source-of-record.

### the emailed-payment-link journey — does the operator get told?

*Use case: The team lead's own worked example. If this chain breaks, an operator emails a payment link and is never told the customer paid — so the rental sits unactioned while the money is already banked.*

- it raises the operator's portal bell from a database trigger on payments, not from the webhook
- it emits nothing from the webhook itself, and says so in its own comment
- it flips the pre-created payments row from Pending to Completed when Stripe settles
- it sends the operator's email through a second trigger on notifications, via pg_net

### the operator-email dispatch is pinned to one project

*Use case: A staging or branch database silently lacks the operator email entirely, so any Layer 2 run there would "prove" a path that only works in production. This is the assertion that stops that false confidence.*

- it posts to a hardcoded production URL rather than a per-database setting
- it should resolve its own project URL instead of naming one environment — ⚠ watchdog

### the two emailed-payment-link paths disagree about the customer's receipt

*Use case: The renter pays and never receives a receipt, so support fields "did my payment go through?" for every operator-emailed link. Two paths that look identical to the operator behave differently.*

- it attaches a receipt address when send-invoice-email creates the session itself
- it attaches no receipt address when the portal creates the session first
- it also suppresses the webhook's own customer notification for portal-initiated payments
- it should confirm the payment to the customer however the link was created — ⚠ watchdog

### the test and live webhooks stay in step on notification behaviour

*Use case: Both webhooks must behave identically. A notification that fires in test mode but not live — or the reverse — is the hardest class of bug to see, because every rehearsal passes.*

- it gates the customer notification the same way in both modes
- it leaves the operator bell to the database in both modes

### a failed notification never rolls back a settled payment

*Use case: A failed email must never undo a successful payment. If a sender throws inside the settlement path, Stripe has the money and our ledger does not.*

- it dispatches the operator email fire-and-forget, so a dead function cannot block the insert
- it reports success from aws-ses-email even when no message was sent


## `tests/spine/rental/06-agreement.test.ts`

**Layer:** L1 contract · **10 tests** (10 passing, 1 watchdog)

THE SPINE'S AGREEMENT STEP, and the sync back from the processor. Layer 1, offline.

### the agreement records which mode it was created under

*Use case: A document created in test mode but fetched with the live API key returns nothing, so the signed agreement silently never arrives. The mode must travel with the record, not be re-derived from whatever the tenant is set to now.*

- it reads the tenant's BoldSign mode and brand when the document is created
- it resolves the mode from the agreement first, then the rental, then the tenant
- it defaults to test rather than live when nothing records a mode
- it selects boldsign_mode on every rental and agreement read in the webhook

### the automation send path reports email delivery it never measured

*Use case: The operator sees a green "sent" for an email nobody received, so nobody chases the signature and the rental stalls with an unsigned agreement.*

- it tells BoldSign not to email the signer, because we send that mail ourselves
- it returns a hardcoded emailSent:true without invoking send-signing-email
- it should measure the signing email like the other two send paths do — ⚠ watchdog

### the sync back — what the rental may believe before the processor confirms

*Use case: The rental's payment state must come from the processor confirming settlement, never from us having asked for it. Anything that writes "paid" before the webhook lands turns an abandoned checkout into a free rental.*

- it promotes the payment to Completed only when the settlement event arrives
- it treats the expiry event as a distinct outcome from a completed one
- it never lets a Square submission response stand in for settlement

