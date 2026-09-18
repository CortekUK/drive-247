# Incident: the project's JWT signing secret was disclosed into a session transcript

**Status: not remediated.** The secret is still in use. No credential has been rotated, created, or revoked. Rotation requires the project owner and is not something to do silently.

**No secret value appears in this document, and none should ever be added to it.** Nothing here needs the value to be actionable.

## 1. What happened

On 2026-09-18, while verifying the project's backup position for the isolation review, an assistant called the Supabase Management API endpoint `GET /v1/projects/{ref}/postgrest` and printed the whole response body. That endpoint returns the project's **legacy JWT signing secret** in a `jwt_secret` field alongside the PostgREST settings that were being checked.

The value was therefore written into the session transcript. It was **not** written to any file in this repository, not committed, and not sent anywhere else. The script that made the call was immediately changed to select only the three fields needed (`db_schema`, `max_rows`, `db_extra_search_path`).

Cause: an over-broad read. The endpoint mixes configuration with a credential, and the whole body was logged instead of the fields in use.

## 2. What that secret controls — verified, 2026-09-18

Read from the Management API, metadata only:

| | |
|---|---|
| API keys on the project | `anon` and `service_role`, both **`type: legacy`** |
| Asymmetric JWT signing keys | **none configured** (`config/auth/signing-keys` returns an empty set) |

With no asymmetric keys, the legacy shared **HS256** secret is the single trust root for the project. It signs, and is used to verify:

- the **`anon`** key (public by design — its exposure is not the incident);
- the **`service_role`** key, which **bypasses row-level security**;
- **every end-user session JWT** issued by Auth, for staff and customers alike.

The practical consequence, stated plainly: anyone holding this secret can **mint a valid token for any role and any user**, including `service_role`, and any `sub`/tenant claim they choose. That is a complete authentication and authorisation bypass for the REST API, Realtime and Storage. It does not require the `exec_sql` finding, the anonymous table grants, or any application bug — those are separate, additive problems.

A forged token is **indistinguishable from a legitimate one** in request logs, because it verifies correctly. This matters for §5.

## 3. Blast radius: which credentials are affected, and which are not

Verified by listing edge-function secret **names** on the project (107 configured; no value was read).

**Invalidated by rotating the signing secret — must be replaced everywhere they are configured:**

| Credential | Known locations |
|---|---|
| `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase edge-function secrets; Vercel env for `portal`, `admin`, `booking`, `web`, `bonzah`; the fallback literal hard-coded in `apps/booking/src/integrations/supabase/client.ts:19` and its siblings; local `.env` files |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase edge-function secrets (**present**, verified); Vercel env for the apps whose API routes use it (the esign routes read it, with an anon-key fallback — see §6) |

**Not derived from this secret, and no evidence of exposure in this incident** — 55 of the configured secrets, including `STRIPE_*` (live and test), `OPENAI_API_KEY`, `DOCUSIGN_*`, `VERIFF_*`, `AWS_*`, `RESEND_API_KEY`, `BONZAH_*`. These are independent credentials. They were not returned by the endpoint that leaked, they are not signed by the JWT secret, and rotating it does not affect them. **Do not rotate them as part of this incident and do not describe them as compromised** — there is no evidence for that.

One thing to confirm separately, because it is adjacent and not part of this incident: the Supabase **personal access token** used by the verification scripts lives in the session scratchpad (`.sb-token`) and is not in the repository. Its handling should be reviewed on its own terms.

## 4. Replacement plan, for the owner to approve and perform

This is written to be executed by the project owner in the Supabase dashboard. Sequence matters: the goal is that legitimate access keeps working **and** the old secret stops being accepted. Creating a new key is not completion.

### Option A — migrate to asymmetric signing keys, then retire the legacy secret (recommended)

Supabase's current guidance separates *introducing* a new key from *retiring* the old one, which is exactly the property needed here.

1. **Enable JWT signing keys** on the project. A new asymmetric key becomes the signer; the legacy secret remains a valid **verifier** during migration. Nothing breaks at this point, and **nothing is contained yet** — the disclosed secret still verifies.
2. **Publish new API keys.** Move every consumer to the new publishable/secret keys (or the re-issued `anon`/`service_role`), one environment at a time: Supabase edge-function secrets, then each Vercel project's Production **and** Preview environments, then any local/CI configuration. Remove the hard-coded anon-key fallbacks in `apps/*/src/integrations/supabase/client.ts` rather than updating them — a literal in source is how this recurs.
3. **Verify legitimate access** (§7) before going further.
4. **Revoke the legacy secret** so it is no longer an accepted verifier. **This is the step that actually contains the incident.** Everything before it is preparation.
5. **Verify the old credential is rejected** (§7).

### Option B — rotate the legacy secret in place

Faster, blunter, and it signs everyone out. Regenerating the JWT secret re-issues `anon` and `service_role` and invalidates every existing session JWT immediately. Use only if Option A is unavailable, and in a planned window.

### Consequences to plan for, either way

- **Sessions.** Every signed-in staff member and customer is logged out when the old secret stops being accepted. Under Option A that happens at step 4, not step 1, so it can be scheduled.
- **Verifier caches.** PostgREST, Realtime, Storage and the Auth service each need to pick up the new configuration; treat "the dashboard shows the new key" as insufficient and re-check the endpoints in §7. Allow for propagation before declaring success.
- **Dependent services.** Anything holding a long-lived `service_role` key — edge functions, Vercel API routes, cron jobs, webhook handlers, scripts, BI tools, the Bonzah and admin apps — fails the moment the old key stops verifying. The inventory in §3 is the checklist; extend it with anything not in this repository.
- **Webhooks.** `config.toml` carries two `verify_jwt = false` exemptions for webhook functions. Those paths do not validate a JWT at all, so they are unaffected by rotation — and they are worth reviewing separately, since they authenticate by signature secret instead.

**Do not** disable JWT verification, loosen a policy, or grant a role extra privileges to make the new credentials work. If something fails after rotation, it is misconfigured, and the fix is configuration.

## 5. Evidence, and its limits

| Question | Answer |
|---|---|
| Was the secret used by an unauthorised party? | **Unknown, and unlikely to be knowable.** A token forged with this secret verifies correctly and appears in logs as an ordinary authenticated or service-role request. There is no log field that distinguishes it. |
| What request logs exist? | Roughly **24 hours** of retention. 192,393 requests were present in the window read on 2026-09-18. |
| Anything suspicious in that window? | No `exec_sql` calls, and no calls to `admin_revoke_user_sessions`, `app_login` or `approve_payment`. Traffic matched the expected application mix. |
| Does that clear the project? | **No.** The window covers less than a day; the underlying grants are months old, and the secret's disclosure gives no log signature to search for. This is *evidence unavailable*, not *no misuse*. |

Classification, to keep the distinction the review asked for:

- **Confirmed misuse:** none identified.
- **Suspicious activity:** none identified in the 24-hour window.
- **Evidence unavailable:** the entire period before that window, and any use of a forged token at any time.

Actions to preserve what evidence exists, before retention expires:
1. Export the available request, Auth and Postgres logs now, and store them with the incident record.
2. If a longer retention or log-drain option is available on the plan, enable it before rotation, so the rotation window itself is observable.
3. After rotation, watch for authentication failures from unexpected sources — a client that breaks and is not on the §3 inventory is worth understanding.

## 6. Adjacent hardening that belongs to this incident

- **The anon-key fallback.** `apps/booking/src/app/api/esign/route.ts:32` and the portal equivalents construct their client as `SUPABASE_SERVICE_ROLE_KEY || NEXT_PUBLIC_SUPABASE_ANON_KEY`. A server route that silently degrades to the public key is both a correctness and a security problem, and it is the reason three privileged functions are still granted to `anon` (see `00b-…sql`, group B). Replace the fallback with a startup failure: if the service key is absent, the route must refuse, not proceed with lesser credentials. Check presence without printing the value, for example `[ -n "$SUPABASE_SERVICE_ROLE_KEY" ] && echo present || echo ABSENT`, or in the route `if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('service credential missing')`.
- **Hard-coded anon keys in source.** Remove the literals in `apps/*/src/integrations/supabase/client.ts`; require the environment variable.
- **The leaking endpoint.** Never call `GET /v1/projects/{ref}/postgrest` without selecting fields. The scratchpad helper now does this; anything new must too.

## 7. Verification — what "done" looks like

Rotation is complete only when **both** of these hold.

**Legitimate access works:**
- staff sign-in to the portal, and a page that reads tenant data;
- customer sign-in to the booking portal, and a booking page;
- a public booking placed end to end, including the checkout writes;
- an edge function that uses the service role (for example TRAX support messaging);
- a webhook delivery from Stripe;
- the admin app.

**The old credential is refused** — the check that actually proves containment:
- a request carrying a token signed with the **old** secret is rejected (401/403) by the REST API, Realtime and Storage. Keep one such token for the test, in a password manager, and destroy it afterwards; do not put it in a ticket;
- the old `service_role` key no longer authorises a read that bypasses RLS;
- an old, still-unexpired user session is no longer accepted.

If the old credential is still accepted anywhere, the incident is **open**, regardless of how many new keys exist.

## 8. Handling this record

- Restrict access to the session transcript containing the disclosure using whatever controls the platform offers, and treat it as a secret-bearing artefact.
- Keep this sanitized record as the shareable one. Do not paste the secret into a ticket, a commit message, a chat, or any document — including this one.
- Reference the value only by where it lives (the Supabase dashboard) and never by content.

---

## 9. Second disclosure, same transcript: a Supabase personal access token

On 2026-09-18, in the same session, the project owner pasted a Supabase **personal
access token** (`sbp_…`) into the chat in order to authorize a deployment. No value
is recorded here, and none should be added.

**Why this is more serious than it looks.** A personal access token is scoped to the
*account*, not to one project. It authenticates the Management API, which can read
and modify every project the account can reach: run SQL, change configuration,
read secrets, create and delete projects. It is not limited to `hviqoaokxvlancmftwuo`.

**Required action, independent of everything else in this document:**

1. **Revoke it** — Supabase dashboard → Account → Access Tokens → revoke the token
   issued on 2026-09-18. Revocation is immediate and breaks nothing that is not
   already using it.
2. **Issue a replacement** only if a token is genuinely needed, and keep it in an
   environment variable or a secret manager. Never in chat, a commit, a ticket, or
   a script's source.
3. **Review recent Management API activity** for the account, not just the project,
   for the period the token existed.

**Preventive note for future deployments.** A deploy does not need a token pasted
into a conversation. `scripts/trax-deploy.mjs` reads `SUPABASE_ACCESS_TOKEN` from the
environment precisely so the value never appears in a transcript, a shell history
or a file.

Both disclosures in this session share one cause: a credential travelling through a
conversation. The fix in both cases is the same — rotate, then change the path so
the value never needs to be spoken.
