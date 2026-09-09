# `integrations/boldsign`

E-signatures. The second ring around the spine, after `integrations/stripe`, and
built to the same two-layer rule.

```
                    Bonzah
                      |
        Square  ---  SPINE  ---  Stripe
                      |
                   BoldSign
```

## The cases

Three, named out loud:

> "ek toh yeh hoga ki **AGREEMENT JA RAHA HAI KI NAHI JA RAHA** — toh status
> humein maalum ho jayega… uske baad kya woh **RESEND** hota hai ki nahi hota…
> haan **VIEW** wala khulta hai ki nahi khulta."

and the coverage bar that goes with them: *"koi bhi cheez humse test mein chhoot
na jaaye."* This is a **functional** integration — there is no money arithmetic
in it, so there is no maths layer. See "Deliberately not here" at the bottom.

## "Agreement ja raha hai" is TWO questions, and they have different answers

This is the ambiguity that shapes the whole folder, so it is worth stating
before the file list.

| | what it means | how you check it |
|---|---|---|
| **LEG A** | the BoldSign **document** was created | `POST /v1/document/send` returned a `documentId`, the `rental_agreements` row exists, `rentals.docusign_envelope_id` points at it |
| **LEG B** | the **customer was actually told** | an email left our system with a link they can sign at |

Neither implies the other, because **`DisableEmails` is set to `'true'` on every
send**. BoldSign is explicitly instructed never to email the signer. Our own
`send-signing-email` edge function is the only delivery channel there is — the
portal route says so in its own words:

> "DisableEmails is set to `'true'` on the BoldSign request above, so BoldSign
> never emails the customer. This request is the ONLY delivery channel — if it
> fails, the customer receives nothing at all."

So a test that asserts leg A and calls it "the agreement went out" passes while
every customer of a tenant receives nothing. `send.test.ts` has two `describe`
blocks for exactly this reason, and every failure message names its leg.

The two legs are already observably different in production code: the portal and
booking routes report `emailSent` honestly (derived from the response), while
**`create-boldsign-document` returns a hardcoded `emailSent: true` and never
sends an email at all** — finding 1 below.

## There are THREE send paths, not one

All three are covered, because "the agreement went out" has to be true for all
three or the sentence means nothing:

| path | who triggers it | leg B |
|---|---|---|
| `apps/portal/src/app/api/esign/route.ts` | an operator pressing Send / Resend | calls `send-signing-email`, reports the real outcome |
| `apps/booking/src/app/api/esign/route.ts` | a customer finishing checkout | same |
| `supabase/functions/create-boldsign-document` | the automation `generate_doc` step | **no email path at all** (finding 1) |

## Files

| File | Layer 1 — contract, no network, always runs | Layer 2 — live, opt-in |
|---|---|---|
| `send.test.ts` | **Leg A**: all ten `/api/esign` callers (nine screens + the booking checkout) plus the server-to-server sweep, each diffed against the route's own `ESignRequest`/`EnvelopeRequest`; the BoldSign request itself (signer, text tags, signature field); credits deducted **before** the send and refunded **after** a failure; a failed send recorded rather than swallowed; the document id and mode written back; the 1-based `SignerIndex` arithmetic for additional drivers. **Leg B**: `DisableEmails` on all three paths; `send-signing-email` called and its contract matched; `emailSent` derived, never a literal; delivery outcome persisted; both legs reported separately. Plus findings 1 and 2, pinned. | `create-boldsign-document` refusing a body with no `rentalId`; `send-signing-email` refusing a body with no recipient; and one gated case that creates a real sandbox document. |
| `resend.test.ts` | Resend **is** send — the same route, the same payload, no resend-only branch; prior non-terminal agreements revoked with **their own** recorded key; the `.neq('id', agreementId)` that stops a resend revoking the document it just created; signed agreements never revoked; per-attempt delivery recording; the 429 retry; the automation dedup guard; the hourly sweep's idempotency. | `/api/esign` refusing an empty body (needs a portal target). |
| `view.test.ts` | The request contract for seven view call sites against the route's destructure, and the edge function agreeing with it; a stored signed PDF short-circuiting **above** the BoldSign download; storage-path vs http URL; "no document for this rental" instead of a 500; the mode read from the row; the `0x8000` chunked base64 (an un-chunked `fromCharCode.apply` throws on every real PDF); an already-signed document refused for signing; the status route's terminal short-circuit and 60s cache. | `get-boldsign-document` with no identifier (400) and with an impossible rental (404); `/api/esign/view` with no identifier (400). |
| `mode.test.ts` | The live/test key mapping in **all ten copies** of `getBoldSignApiKey`; the legacy fallback in both branches; the create path stamping `boldsign_mode` on both rows; resolve → key → send ordering; the test-mode "not legally binding" banner; the webhook's agreement → rental → tenant precedence; a recorded `live` never downgraded. Plus finding 3, pinned. | — (mode resolution needs a tenant row, and Layer 2 holds no database credentials by design) |
| `webhook.test.ts` | `verify_jwt = false` in `config.toml`; a **watchdog** that skips with finding 4 while no verification exists and starts asserting order the moment one appears; the containment that currently limits a forged payload; signed-PDF download gated on completion; signing **not** activating the rental or the vehicle; the full status map. Plus findings 5 and 6, pinned. | one unsigned payload, stopped only by the missing document id — finding 4 in observable form. |
| `routes.test.ts` | The **perimeter** of the six portal routes: the exported HTTP verbs of each, read off the exports (that list IS the method contract — Next 405s a verb with no handler); the `service_role` client and the anon-key fallback that silently 404s every agreement on an RLS-on table; the portal proxy's matcher excluding `/api`, so `x-tenant-slug` never arrives; the guards that **do** hold — void's dual already-signed refusal, its ladder, and rows marked voided only after BoldSign confirms; sign's already-signed and signer checks above the link call; signing-redirect issuing a 3xx rather than handing out the sign link; status writing back only the rows the request named. Plus **Layer 3**: the 60s properties cache and its exclusive-expiry boundary, and the 15s/30s/45s 429 backoff, all lifted from source and executed against hand-typed literals. Findings 7–10 as **watchdogs**. | void, status and signing-redirect each refusing an empty request, and a `GET /api/esign/void` observed as 405. |
| `notify.test.ts` | **Leg C** — the agreement came back signed and the OPERATOR was told. `notify-signing-completed`'s `NotifyRequest` contract; a repo-wide caller sweep (with a control function to prove the sweep works) showing it has **none**; the trigger chain that replaced it, asserted link by link from the **deployed-schema snapshot** rather than from migration files; `notify-operator-email` still being `verify_jwt = false`, without which the pg_net dispatch 401s and every operator email stops; the two paths' clashing dedupe keys; and the orphan's own guard order and unconditional `success: true`. Findings 11 and 12 as watchdogs. | one unparseable body answered by the outer catch, above every branch that could email or write. |

`boldsign-source.ts` is this folder's own helper. `tests/helpers/` is shared and
was not edited; it knows three request-parsing shapes and throws on a fourth, so
the two shapes used here that it does not know (`const body = await req.json() as
T`, `const data: T = await req.json()`) and the Next route handlers are parsed
locally instead — with the same rule kept: **every parser throws rather than
returning an empty set**, because a parser that silently finds nothing makes
every assertion against it pass for the wrong reason.

`route-source.ts` is the second local helper, and it answers the questions a
Next route raises that an edge function does not: which HTTP methods it exports
(that list is the method contract), whether it establishes who is calling, and
every `supabase.from(...)` chain with its tenant scoping. It also reads
`scripts/v1-check/baseline.json` — the snapshot taken **from the running
database** — because two of the delivery paths asserted here are triggers, and a
migration file states an intention while only the snapshot states a fact. Same
rule: every parser throws rather than returning empty.

## Findings — read these before trusting the green

Twelve defects were found while reading the code. Findings 1–3, 5 and 6 are
**pinned**: a test asserts what the code does today, worded so that FIXING the
defect turns the test red and the correct response is to delete the test.
Findings 4 and 7–12 are **watchdogs**: the case SKIPS with the finding printed
in full, asserts nothing about today's behaviour, and converts itself into a
real assertion the moment a fix lands. A watchdog is the honest shape wherever
pinning would amount to writing the defect down as expected.

1. **`create-boldsign-document` reports an email it never sends.** It sets
   `DisableEmails: 'true'`, never calls `send-signing-email`, and returns
   `{ ok: true, emailSent: true }`. The automation `generate_doc` step reads that
   as success. Leg A happens, leg B does not, and nobody is told.
   *Pinned in `send.test.ts`.*
2. **The automation caller cannot work at all.** `automation-execute-step`
   invokes `create-boldsign-document` with `{ tenantId, leadId, customerName,
   customerEmail, customerPhone, vehicleId, startDate, endDate }`. The function
   reads `{ rentalId, customerEmail, customerName }` and hard-refuses with
   `400 rentalId is required`. Every generate-agreement automation run fails.
   *Pinned in `send.test.ts`.*
3. **A recorded `test` mode is treated as "unset" and re-resolved from the
   tenant.** `boldsign-webhook`'s `resolveMode` (and four of the five portal
   readers) fall back to the tenant's *current* mode whenever the recorded mode
   is falsy **or `'test'`**. For a tenant that has since switched to live, a
   sandbox-era agreement is then fetched with the LIVE key. That is exactly the
   failure `_shared/lean-tenants.ts` warns about — *"a document created in the
   BoldSign sandbox must keep being read with the sandbox key or it 404s"* —
   leaving a signed agreement nobody can retrieve. `/api/esign/void` in the same
   folder does it correctly, which is what makes this a defect rather than a
   design choice. *Pinned in `mode.test.ts`.*
4. **`boldsign-webhook` authenticates nobody.** `verify_jwt = false`, and the
   function checks no signature, no shared secret and no header before acting on
   the payload with the **service-role** key. Anyone who learns a BoldSign
   `documentId` can flip that agreement's `document_status` (to `completed`,
   `declined` or `voided`), trigger a PDF download and a `customer_documents`
   insert, and push a "Rental Agreement Signed" notification to the customer.
   `stripe-webhook-live` verifies its signature; this one has nothing to verify
   with. **No test blesses this.** `webhook.test.ts` carries a watchdog that
   *skips*, loudly, with the finding — and converts itself into a real
   before-the-first-write ordering assertion the moment any verification appears.
5. **An unrecognised BoldSign event downgrades a completed agreement to
   `pending`.** `mapBoldSignStatus` returns `'pending'` for any unknown event and
   the result is written unconditionally. BoldSign adds event types over time;
   the first new one to arrive for a completed agreement makes a signed contract
   show as outstanding and offers to resend it. *Pinned in `webhook.test.ts`.*
6. **The additional-driver signing sync is dead code.**
   `handleBoldSignWebhook(supabaseClient, event)` reads
   `(payload as any)?.document?.signerDetails` — `payload` is not declared in
   that scope or anywhere in the file. Every webhook throws a `ReferenceError`
   into the surrounding `try/catch`, which warns and continues, so
   `rental_additional_drivers.signing_status` never advances past the `'sent'`
   the send path stamps. An additional driver who HAS signed still shows as
   pending. *Pinned in `webhook.test.ts`.*
7. **All six portal e-sign routes authenticate nobody, and scope nothing to a
   tenant.** No `supabase.auth`, no session, no cookie, no `Authorization`
   header, no `app_users` lookup, no role check — in any of them. Each builds a
   `service_role` client (which bypasses every policy) and addresses rows by an
   id read straight from the request. The portal proxy's matcher excludes
   `/api`, so `x-tenant-slug` never arrives either. `/api/esign/view` returns
   another tenant's signed agreement PDF; `/api/esign/void` revokes another
   tenant's outstanding agreement, irreversibly; `/api/esign` issues an
   agreement against any rental; `/api/esign/sign` mints a signing link for any
   unsigned one; `/api/esign/status` writes `document_status` on any row. Under
   V2_PLAN §5 (RLS off on `rentals`/`customers`/`customer_documents`) that is
   data-loss-grade. The missing tenant filter is downstream of the missing auth
   and not separately fixable: there is no tenant to filter by.
   *Two watchdogs in `routes.test.ts`.*
8. **`/api/esign` trusts `body.tenantId` for the money and the contract text,
   while explicitly distrusting it for the row it writes.** The file's own
   comment explains why the caller's value is unsafe — and the resolution
   (`resolvedTenantId = rental.tenant_id || body.tenantId`) happens *after* the
   `agreement_templates` lookup that decides WHICH CONTRACT TEXT the customer
   signs, and after the `deduct_credits` RPC that spends a real wallet. 23
   uses of `body.tenantId` against 3 of `resolvedTenantId`. The `credit_failed`
   and `send_failed` inserts use the caller's value while the success insert
   uses the server's, so the same route files the same row under two different
   tenants depending on whether it worked. *Watchdog in `routes.test.ts`.*
9. **`/api/esign/view` downloads a caller-supplied BoldSign document id.** When
   `envelopeId` is in the body no row is read at all — the route goes straight
   to `/v1/document/download` with the tenant's key and returns base64. The
   other two identifiers at least pass through a database row.
   *Watchdog in `routes.test.ts`.*
10. **`/api/esign` returns the first eight characters of the BoldSign API key**
    in its failure body (`apiKeyPrefix`), on a route with no authentication,
    alongside the raw BoldSign error text. Debugging aid; log it, do not return
    it. *Watchdog in `routes.test.ts`.*
11. **The operator's signing bell fires on `'completed'` only, while the whole
    codebase treats `'signed'` as equally terminal.** `boldsign-webhook` maps
    BoldSign's per-signer `Signed` event to `'signed'`; every e-sign read path
    is written `status === 'completed' || status === 'signed'`. An agreement
    whose last delivered event is `Signed` reads as fully signed everywhere —
    void refuses it, sign refuses it, the timeline ticks — and the operator gets
    no bell and no email. Nothing turns red. (Related: the edge function
    `notify-signing-completed`, which composed a far richer operator email, has
    **zero callers** and was superseded by the trigger; the coverage survived,
    the vehicle, reg, signed-at time and document link did not.)
    *Watchdog in `notify.test.ts`.*
12. **The operator-email dispatch trigger hardcodes the production project
    URL.** `PERFORM net.http_post(url := 'https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/notify-operator-email', …)`
    is baked into the trigger body, so every database branched or restored from
    these migrations dispatches its operator emails **into production**. And the
    call is doubly silent: `PERFORM` discards the result, and the trigger wraps
    itself in `EXCEPTION WHEN OTHERS THEN RETURN NEW` — correct for the INSERT,
    but it means nothing anywhere observes a dropped operator email.
    *Watchdog in `notify.test.ts`.*

## Layer 2, and the gates

Default is **off**: every live case skips, the whole folder runs offline in under
a second, and the same run passes inside an empty network namespace
(`unshare -rn`).

Turning it on inherits the spine's ladder unchanged — `tests/helpers/live-call.ts`
carries the production refusal and **there is no override flag**.

```bash
# the read-only probes: five cases, all of them input-validation refusals
D247_LIVE_TESTS=1 \
D247_LIVE_FUNCTIONS_URL=https://<non-prod-ref>.supabase.co/functions/v1 \
D247_LIVE_ANON_KEY=<that project's anon key> \
npm run test:spine
```

| variable | why it exists |
|---|---|
| `D247_LIVE_TESTS=1` | the master switch, shared with the spine |
| `D247_LIVE_FUNCTIONS_URL` | the edge-function target. Never inferred. Production is refused. |
| `D247_LIVE_ANON_KEY` | gets past the gateway on the `verify_jwt = true` functions, and is the second production guard |
| `D247_LIVE_PORTAL_URL` | **new here.** Send, resend, view, status and void are Next route handlers, not edge functions, so `liveCall()` cannot reach them. Any host under `drive-247.com` is refused outright, as is any URL mentioning the production Supabase ref — a preview deployment wired to the production database is production. |
| `D247_LIVE_ALLOW_WRITES=1` | a send writes the agreement row, the rental's envelope id and the credit ledger |
| `D247_LIVE_ALLOW_MONEY_MOVEMENT=1` | **the send rung.** A send calls `deduct_credits` against `tenant_credit_wallets` — a balance the operator paid for — before it calls BoldSign, and the document itself counts against a real account's quota. Neither has a `DELETE`. |
| `D247_LIVE_BOLDSIGN_MODE=test` | **new here**, and the same argument as `D247_LIVE_STRIPE_MODE`. The Supabase guards prove which *database* this is; they prove nothing about BoldSign, because `tenants.boldsign_mode` is a per-tenant column and a non-production project can hold a tenant on the LIVE key. A declaration, not a detection. Unset is refused. |
| `D247_LIVE_BOLDSIGN_RENTAL_ID` | the rental a live send may issue an agreement for. Never inferred — guessing a rental to send a legal document for is the e-sign version of guessing a project ref. |

Every rung has been exercised in the refusing direction, all of them failing
before a socket is opened: the send rung with Layer 2 off, a send run aimed at
the production Supabase ref, `ALLOW_MONEY_MOVEMENT` without `ALLOW_WRITES`,
without `D247_LIVE_BOLDSIGN_MODE`, without the fixture, `D247_LIVE_TESTS=1` with
no target, and `D247_LIVE_PORTAL_URL` pointed at a `*.portal.drive-247.com` host.

**Nobody has run the enabled path yet** — there are no keys for a non-production
project in this repo — so there is no "expected" live tally to quote, and
inventing one would be worse than leaving the gap.

## Deliberately not here

- **No maths layer.** This integration has no arithmetic to get wrong: no
  premiums, no proration, no ledger. The one near-miss — the 1-based
  `SignerIndex` against the 0-based `Signers[]` array, and the `{{@sigN}}` tag
  numbering — is asserted structurally in `send.test.ts`, because the mapping
  lives in the function and replicating it in a test would only prove the test
  can copy.
- **The lean-tenant gate.** `isLeanTenant` / `resolveBoldSignMode` semantics, the
  three-runtime mirror and "every resolution point imports the gate" are already
  covered thoroughly by `apps/portal/src/__tests__/lib/lean-boldsign.test.ts`
  (`cd apps/portal && npm run test`). Re-asserting them here would be two tests
  that fail together and say the same thing twice.
- **The agreement's CONTENT.** Template variables, the Bonzah addendum, deposit
  wording, mileage and the date/timezone handling are a large surface with its
  own existing tests, and none of it is send/resend/view.
- **A live case for the happy path of `send-signing-email`.** It would put a real
  email in a real person's inbox. Only its refusal path is automated; the happy
  path stays a human decision.
- **Browser automation.** Ruled out for the whole suite: *"obviously hum browser
  wala test nahi chala rahe."* Opening the signing page end to end is BoldSign's
  own UI in a browser, so `view.test.ts` stops at the link being issued and the
  already-signed refusal.
- **Extension-agreement period matching and the credit wallet itself.** Real
  surfaces, not among the three cases named, and each deserves its own file when
  the scope widens. (Void is no longer on this list: `routes.test.ts` covers its
  guard ladder, because it turned out to be the one route in the folder that
  resolves the test/live mode correctly and is therefore the model the other
  five should be fixed to.)
- **Running the six portal routes.** `routes.test.ts` reads them; it does not
  execute them. Whether the auth that is missing would actually stop a request,
  and whether a cross-tenant read really returns another operator's PDF, are
  questions only a live call against a non-production portal can answer — and
  the four Layer 2 cases here stop at input validation on purpose, because
  every case beyond that reads or writes somebody's agreement.
- **The `notify-signing-completed` → operator email content.** The trigger chain
  is asserted end to end, but what `notify-operator-email` finally renders — the
  branded template, the escaping, the same-origin link check — has its own
  surface and is not e-signature.
