# Square — Console steps, secrets, and deploy runbook

Everything here needs a human: a browser session in the Square Developer Console, or a
deploy. The code side is done and guardrail-verified; these are the gaps between
"code exists" and "a Square tenant can take one real payment".

Work top to bottom. Each step says who does it and how to verify it worked.

---

## 1. Square Console — OAuth redirect URL  *(you, browser)*

Developer Console → your app → **OAuth** → Sandbox tab → *Redirect URL* → **Update**:

```
https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/square-oauth-callback
```

Currently shows `None`, which makes the OAuth flow fail at the redirect step.

Repeat on the **Production** tab when going live — Sandbox and Production are separate
environments and do not share this value.

**Verify:** the OAuth page shows the URL instead of `None`.

---

## 2. Square Console — webhook subscription  *(you, browser)*

⚠️ **Deploy `square-webhook` BEFORE creating the subscription** (step 4). Square probes
the notification URL for reachability at create time; if it 404s or 401s, creation fails.
`verify_jwt = false` is already set for this function in `supabase/config.toml`.

Developer Console → your app → **Webhooks → Subscriptions** → *Add subscription*:

| Field | Value |
|---|---|
| Notification URL | `https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/square-webhook` |
| API version | `2026-08-19` (must match `SQUARE_VERSION`) |
| Events | `payment.created`, `payment.updated`, `refund.created`, `refund.updated` |

Then copy the **Signature Key** it generates.

> The notification URL is part of the signed HMAC message, so it must match **byte for
> byte** what you register — a trailing slash or a different host silently fails every
> event. This is why the function reads it from an env var instead of reconstructing it
> from the request.

**Verify:** the subscription lists as Enabled and shows a Signature Key.

---

## 3. Secrets  *(you, one command)*

From step 2's signature key:

```bash
supabase secrets set \
  SQUARE_TEST_WEBHOOK_SIGNATURE_KEY='<signature key from step 2>' \
  SQUARE_TEST_WEBHOOK_NOTIFICATION_URL='https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/square-webhook' \
  SQUARE_OAUTH_REDIRECT_URL='https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/square-oauth-callback' \
  --project-ref hviqoaokxvlancmftwuo
```

Use `~/.local/bin/supabase` — `npx supabase` resolves to an unrelated stale package (v0.5.0).

Already set: `SQUARE_TEST_APP_ID`, `SQUARE_TEST_ACCESS_TOKEN`, `SQUARE_TEST_APP_SECRET`,
`SQUARE_TEST_BASE_URL`, `SQUARE_ENV`, `SQUARE_VERSION`.

> A blank signature key is **discarded**, not defaulted to `""` — an empty HMAC key is a
> publicly known key. So a typo here fails closed (all events rejected) rather than open.
> That is the intended behaviour, but it means a missing key looks like "no events arriving".

**Verify:** `supabase secrets list --project-ref hviqoaokxvlancmftwuo | grep SQUARE`

---

## 4. Deploy the functions  *(you)*

```bash
supabase functions deploy square-oauth-start    --project-ref hviqoaokxvlancmftwuo
supabase functions deploy square-oauth-callback --project-ref hviqoaokxvlancmftwuo
supabase functions deploy square-webhook        --project-ref hviqoaokxvlancmftwuo
supabase functions deploy refresh-square-tokens --project-ref hviqoaokxvlancmftwuo
```

No existing function needs redeploying for the seam to exist — but any function that
receives the checkout/refund preamble **does** need a redeploy for that wiring to take
effect.

**Verify:** `curl -s -o /dev/null -w '%{http_code}' https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/square-webhook`
→ expect **401** (fails closed, no signature). A 404 means it did not deploy.

---

## 5. Schedule the token-refresh cron  *(you or me, after step 4)*

Square access tokens **expire after 30 days**. Without this cron, every connected tenant
silently dies a month after connecting.

```sql
select cron.schedule(
  'refresh-square-tokens',
  '0 */6 * * *',
  $$ select net.http_post(
       url     := 'https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/refresh-square-tokens',
       headers := jsonb_build_object('Authorization','Bearer <SERVICE_ROLE_KEY>',
                                     'Content-Type','application/json'),
       body    := '{}'::jsonb
     ) $$
);
```

**Verify — do not skip this:**
```sql
select jobid, jobname, schedule, active from cron.job where jobname = 'refresh-square-tokens';
```

> This repo has history of a refresh cron that may never have been scheduled. Scheduling it
> and *verifying it against `cron.job`* are two separate steps, and only the second one is
> evidence.

---

## 6. Staging parity  *(you — I was permission-blocked)*

Production has the Square schema; **staging (`ksmreaadhbirzakkxqrq`) does not**, so a
developer running locally against staging hits `42703` the moment the seam resolves a
provider. `scripts/db-switch.mjs` points local apps at staging by default.

Apply, in order:
1. `docs/square-integration/migration-01-provider-columns.sql`
2. The `square_connections_and_vault_rpcs` migration (see `supabase/migrations` history on prod)

Staging is a clone and uses the same **column-level** anon grant model, so the
`GRANT SELECT (payment_provider, square_mode, country) ON tenants TO anon` line is equally
mandatory there. Omitting it 403s the whole TenantContext select and blanks staging booking sites.

> ⚠️ **Do not point the Square webhook at staging.** Project history records that staging
> shares prod's Stripe test account and its webhooks fire into PROD. Square must not repeat
> that: one app-level subscription serves all merchants, so a staging subscription pointed at
> a prod URL would cross-contaminate. Keep sandbox → staging and production → prod strictly separate.

---

## 7. Regenerate TypeScript types  *(after all DDL is on both projects)*

```bash
supabase gen types typescript --project-id hviqoaokxvlancmftwuo > apps/portal/src/integrations/supabase/types.ts
cp apps/portal/src/integrations/supabase/types.ts apps/booking/src/integrations/supabase/types.ts
cp apps/portal/src/integrations/supabase/types.ts apps/admin/src/integrations/supabase/types.ts
```

Then build **admin** and **web** specifically — booking and portal set
`ignoreBuildErrors: true` and will mask a type break that admin/web will not.

---

## 8. End-to-end pilot  *(the definition of "it works")*

On one sandbox Square tenant:

1. Create a tenant with `payment_provider='square'` and a supported `country` (e.g. `GB`).
2. Portal → Settings → Square → **Connect** → complete consent in the Square sandbox.
3. Confirm `square_connections` has an `active` row with `merchant_id`, `location_id`, `location_currency`.
4. Portal → a rental → **Add payment** → raise a payment link.
5. Pay it with a Square sandbox test card.
6. Confirm the webhook fired: a row in `square_webhook_events`, and the `payments` row moved to `Completed`.
7. Issue a **partial** refund. Confirm it lands `PENDING` and only becomes `Completed` on `refund.updated`.

Only after all seven is the pilot proven, and only then generalise to the remaining
checkout creators.

---

## Standing decisions (do not re-litigate)

| Rule | Why |
|---|---|
| Never edit `_shared/stripe-client.ts` | Frozen at `f1c38aed…`; CI-gated |
| Never rename `payments.stripe_*` columns | 348 reference sites |
| Only `.eq('payment_provider','stripe')` | Column is `NOT NULL DEFAULT 'stripe'`; `.neq`/`.is null` match zero rows |
| No `=== 'square'` outside `_shared/payments/` | Behaviour lives in `capabilities.ts` so provider #3 stays cheap |
| Run `./scripts/square-guardrails/verify.sh` before every push | It is the only artifact that proves Stripe is untouched |
