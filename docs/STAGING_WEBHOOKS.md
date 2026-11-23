# Staging webhooks: setup guide

**For:** Haris and his Claude · **Time needed:** about 20 minutes

## Goal

Staging (`drive-247-staging`) already has the database, edge functions and keys.
It is missing webhooks: Stripe has to be told staging's addresses, and each
address gets its own signing secret, which staging has to know.

Staging uses **one Stripe account only: the UAE account, in test mode.**
No other Stripe account is touched.

| | |
|---|---|
| Staging ref | `csjouxrkblpsoihyejel` |
| Production ref (read only, never changed) | `hviqoaokxvlancmftwuo` |

## Haris: three things to do

1. **Get the UAE test key.** Stripe dashboard, UAE account, **Test mode** on,
   **Developers**, **API keys**, copy the secret key. It must start with `sk_test_`.
2. **Start Claude Code with both keys in the environment**, so they are never
   typed into the chat:

   ```bash
   export SUPABASE_ACCESS_TOKEN=sbp_...      # your Supabase token
   export STRIPE_UAE_TEST_KEY=sk_test_...    # from step 1
   claude
   ```

3. **Paste the prompt below into Claude**, then send Ghulam the table Claude
   prints at the end.

## The prompt for Claude

```text
Set up Stripe webhooks for the Drive247 STAGING Supabase project.
Follow docs/STAGING_WEBHOOKS.md in this repo exactly. Summary:

Staging ref: csjouxrkblpsoihyejel. Production ref: hviqoaokxvlancmftwuo.
Keys are in the environment: SUPABASE_ACCESS_TOKEN and STRIPE_UAE_TEST_KEY.

Hard rules:
- Stop if STRIPE_UAE_TEST_KEY does not start with "sk_test_".
- Never create, change or delete anything on production, and never change or
  delete a Stripe endpoint whose URL contains the production ref.
- Never print a secret value. Not in chat, not in a file, not in git.
- One secret per request, and verify each one before the next.

Steps:
1. List the UAE account's test-mode webhook endpoints (GET /v1/webhook_endpoints).
   Show me url, status, whether it is a Connect endpoint, and its events.
2. For every ENABLED endpoint that points at production, create a twin on
   staging: same URL with the ref swapped, same Connect setting, same events,
   description "Drive247 STAGING". If production has no endpoint for a row of
   the table in the guide, create that row from the guide's defaults.
   Skip any twin that already exists.
3. Save each new endpoint's signing secret on staging under the name the guide
   gives, then verify it by fingerprint.
4. Prove each one works with a signed test request, as the guide describes.
5. Print the results table from the guide, with no secret values.

If anything does not match the guide (for example two Connect endpoints), stop
and tell me instead of guessing.
```

## Details Claude needs

### Which endpoints, and which secret name

| # | Endpoint URL | Connect | Events | Save the secret as |
|---|---|---|---|---|
| 1 | `https://csjouxrkblpsoihyejel.supabase.co/functions/v1/stripe-webhook-test` | no | List A | `STRIPE_UAE_TEST_WEBHOOK_SECRET` |
| 2 | `https://csjouxrkblpsoihyejel.supabase.co/functions/v1/stripe-connect-webhook` | yes | List B | `STRIPE_UAE_CONNECT_WEBHOOK_SECRET` |
| 3 | `https://csjouxrkblpsoihyejel.supabase.co/functions/v1/subscription-webhook` | no | List C | `STRIPE_UAE_SUBSCRIPTION_TEST_WEBHOOK_SECRET` |

**Production wins over this table.** Nobody has read the UAE account's webhook
list for this guide, so step 1 is a real check. If production's test-mode
endpoints use a different URL, Connect setting or event list, copy production.

The secret name is decided by the endpoint, not by the table row:

| Endpoint | Secret name |
|---|---|
| Not Connect, URL ends `stripe-webhook-test` | `STRIPE_UAE_TEST_WEBHOOK_SECRET` |
| Not Connect, URL ends `subscription-webhook` | `STRIPE_UAE_SUBSCRIPTION_TEST_WEBHOOK_SECRET` |
| Connect, any URL | `STRIPE_UAE_CONNECT_WEBHOOK_SECRET` |

There is only one name for a Connect secret. If production has **two** Connect
endpoints in test mode, stop and ask Ghulam.

**List A:** `checkout.session.completed`, `checkout.session.expired`,
`payment_intent.succeeded`, `payment_intent.canceled`,
`payment_intent.payment_failed`, `charge.refunded`

**List B:** `account.updated`, `account.application.deauthorized`

**List C:** `checkout.session.completed`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`,
`invoice.payment_failed`, `invoice.voided`, `invoice.marked_uncollectible`,
`invoice.deleted`, `charge.refunded`, `charge.dispute.created`,
`charge.dispute.updated`, `charge.dispute.closed`

### Creating an endpoint (Stripe API)

```bash
curl https://api.stripe.com/v1/webhook_endpoints -u "$STRIPE_UAE_TEST_KEY:" \
  -d url="https://csjouxrkblpsoihyejel.supabase.co/functions/v1/stripe-webhook-test" \
  -d description="Drive247 STAGING" \
  -d "enabled_events[]"=checkout.session.completed \
  -d "enabled_events[]"=charge.refunded
  # add  -d connect=true  for a Connect endpoint
```

The response contains `secret` (`whsec_...`) **once only**. Capture it in a
variable in the same script and use it straight away. Do not echo it.

### Saving a secret on staging (Supabase API)

```bash
curl -X POST https://api.supabase.com/v1/projects/csjouxrkblpsoihyejel/secrets \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36" \
  -d '[{"name":"STRIPE_UAE_TEST_WEBHOOK_SECRET","value":"<the secret>"}]'
```

- The browser `User-Agent` is required. Without it Cloudflare answers error 1010.
- One secret per request.
- **Verify:** `GET` the same URL. Each secret comes back as `name` plus the
  SHA-256 of its value. The fingerprint must equal the SHA-256 of what you sent.

### Proving it works

For each endpoint, send staging a request signed the way Stripe signs:

1. Body: `{"id":"evt_staging_check","object":"event","type":"staging.check","livemode":false,"data":{"object":{}}}`
2. Header: `Stripe-Signature: t=<unix time>,v1=<hex HMAC-SHA256 of "<t>.<body>" using the whsec secret>`
3. `POST` it to the endpoint's staging URL.

| Answer | Meaning |
|---|---|
| `200` | The signature was accepted. Done. |
| `400` or `401` mentioning the signature | Staging holds a different secret. Save it again and re-verify. |
| Anything else | Show Haris the status and the response text. |

The event type is made up on purpose, so no function acts on it.

## Rules

1. **UAE account, test mode only.** No other Stripe account, no live mode.
2. **Production is never changed.** It is only read, to copy its event lists.
3. **No secret values anywhere** except Stripe's response and Supabase's API.
4. **Stop and ask Ghulam** if something does not match this guide.

## When you are done

Send Ghulam this table. No secret values.

| # | Endpoint | Created | Secret saved and verified | Signed test returned 200 |
|---|---|---|---|---|
| 1 | `stripe-webhook-test` | | | |
| 2 | `stripe-connect-webhook` | | | |
| 3 | `subscription-webhook` | | | |

Also tell him anything in the UAE account that differed from this guide.

## Already done, nothing to do

- The auth email hook and its secret (`SEND_EMAIL_HOOK_SECRET`) are set on staging.
- `MODIVES_WEBHOOK_SECRET` and `VERIFF_WEBHOOK_SECRET` are not needed. No function reads them.

## Not in this task

Square, Twilio, BoldSign, Resend inbound, GoHighLevel and Meta lead webhooks.
