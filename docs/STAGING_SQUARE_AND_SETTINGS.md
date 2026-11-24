# Staging: Square webhook and two settings

**For:** Haris and his Claude · **Time needed:** about 15 minutes

## Goal

Three small things are still missing on staging (`drive-247-staging`):

| # | What | Why it is missing |
|---|---|---|
| 1 | Square sandbox webhook and its signature key | Square only sends events to an address registered with it, and issues the key when it is registered |
| 2 | `PORTAL_URL` | Production's value is the live portal address, so it was not copied |
| 3 | `ONBOARDING_CALL_NOTIFY_EMAILS` | Production's value is the support inbox, so it was not copied |

| | |
|---|---|
| Staging ref | `csjouxrkblpsoihyejel` |
| Production ref (read only, never changed) | `hviqoaokxvlancmftwuo` |

## Haris: three things to do

1. **Get the Square sandbox access token.** Square Developer dashboard, the
   Drive247 application, **Credentials**, **Sandbox** tab, copy the
   **Sandbox Access token**.
2. **Start Claude Code with both keys in the environment**, so they are never
   typed into the chat:

   ```bash
   export SUPABASE_ACCESS_TOKEN=sbp_...           # your Supabase token
   export SQUARE_SANDBOX_TOKEN=EAAA...            # from step 1
   claude
   ```

3. **Paste the prompt below into Claude**, then send Ghulam the table Claude
   prints at the end.

## The prompt for Claude

```text
Finish three staging settings for Drive247.
Follow docs/STAGING_SQUARE_AND_SETTINGS.md in this repo exactly. Summary:

Staging ref: csjouxrkblpsoihyejel. Production ref: hviqoaokxvlancmftwuo.
Keys are in the environment: SUPABASE_ACCESS_TOKEN and SQUARE_SANDBOX_TOKEN.

Hard rules:
- Square sandbox only. Every Square call goes to connect.squareupsandbox.com.
- Never create, change or delete anything on production, and never change or
  delete a Square subscription whose URL contains the production ref.
- Never print a secret value. Not in chat, not in a file, not in git.
- One secret per request, and verify each one before the next.

Steps:
1. Part 1: create the Square sandbox webhook for staging, save its signature
   key on staging, verify it, and send Square's own test event.
2. Part 2: set PORTAL_URL on staging and verify it.
3. Part 3: set ONBOARDING_CALL_NOTIFY_EMAILS on staging and verify it.
4. Print the results table from the guide, with no secret values.

If anything does not match the guide, stop and tell me instead of guessing.
```

## Part 1: Square sandbox webhook

All calls use these headers:

```
Authorization: Bearer $SQUARE_SANDBOX_TOKEN
Square-Version: 2026-08-19
Content-Type: application/json
```

**1. Look first.** `GET https://connect.squareupsandbox.com/v2/webhooks/subscriptions`

- If a subscription already points at the staging URL below, do not create a
  second one. Tell Haris: its signature key cannot be read back from a list, so
  he decides whether to rotate it.
- If a subscription points at production, read its `event_types` and
  `api_version` and use the same for staging. Do not change it.

**2. Create it.** `POST https://connect.squareupsandbox.com/v2/webhooks/subscriptions`

```json
{
  "idempotency_key": "<a new UUID>",
  "subscription": {
    "name": "Drive247 STAGING",
    "enabled": true,
    "notification_url": "https://csjouxrkblpsoihyejel.supabase.co/functions/v1/square-webhook",
    "api_version": "2026-08-19",
    "event_types": [
      "payment.created",
      "payment.updated",
      "refund.created",
      "refund.updated",
      "oauth.authorization.revoked"
    ]
  }
}
```

- The URL must match character for character. Square signs every event with
  the URL, and staging is already set to expect exactly this one
  (`SQUARE_WEBHOOK_NOTIFICATION_URL`).
- The five events are the ones `square-webhook` handles. Production's list wins
  if it differs.
- The response holds `subscription.id` and `subscription.signature_key`.
  Capture the key in a variable in the same script and use it straight away.
  Do not echo it.

**3. Save the key** on staging as `SQUARE_TEST_WEBHOOK_SIGNATURE_KEY` and verify
it (see "Saving a secret" below).

**4. Prove it works.** Ask Square to send its own test event:

`POST https://connect.squareupsandbox.com/v2/webhooks/subscriptions/<subscription id>/test`

```json
{ "event_type": "payment.created" }
```

| `subscription_test_result.status_code` | Meaning |
|---|---|
| `200` | Staging accepted Square's signature. Done. |
| `401` | Staging holds a different key, or the URL differs. Save the key again and re-test. |
| Anything else | Show Haris the status and the response text. |

## Part 2: `PORTAL_URL`

Set it on staging to:

```
https://portal.staging.drive-247.com
```

It is used when a super admin opens a tenant's portal from the admin site. This
is not a secret, but it is saved and verified the same way.

## Part 3: `ONBOARDING_CALL_NOTIFY_EMAILS`

Set it on staging to:

```
ilyasghulam35+staging@gmail.com
```

It is who gets the notice when a staging signup books an onboarding call. One
or more addresses, separated by commas. Never the production support inbox.

## Saving a secret on staging (Supabase API)

```bash
curl -X POST https://api.supabase.com/v1/projects/csjouxrkblpsoihyejel/secrets \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36" \
  -d '[{"name":"PORTAL_URL","value":"https://portal.staging.drive-247.com"}]'
```

- The browser `User-Agent` is required. Without it Cloudflare answers error 1010.
- One secret per request.
- **Verify:** `GET` the same URL. Each secret comes back as `name` plus the
  SHA-256 of its value. The fingerprint must equal the SHA-256 of what you sent.

## Rules

1. **Square sandbox only.** Never the production Square host, never live mode.
2. **Production is never changed.** It is only read, to copy its event list.
3. **No secret values anywhere** except Square's response and Supabase's API.
4. **Stop and ask Ghulam** if something does not match this guide.

## When you are done

Send Ghulam this table. No secret values.

| # | Item | Done | Verified by fingerprint | Test |
|---|---|---|---|---|
| 1 | Square webhook and `SQUARE_TEST_WEBHOOK_SIGNATURE_KEY` | | | Square test event returned 200: |
| 2 | `PORTAL_URL` | | | n/a |
| 3 | `ONBOARDING_CALL_NOTIFY_EMAILS` | | | n/a |

Also tell him anything in the Square account that differed from this guide.

## Good to know

- **Square logins on staging need one more thing.** A tenant connecting Square
  on staging is sent back to
  `https://csjouxrkblpsoihyejel.supabase.co/functions/v1/square-oauth-callback`.
  That address has to be allowed in the Square application under **OAuth**,
  **Sandbox Redirect URL**. Square allows one sandbox redirect URL, so adding
  staging's would replace production's sandbox one. Do not change it; ask Ghulam
  which side should have it.
- **Not in this task:** Twilio, BoldSign, Resend inbound, GoHighLevel and Meta
  lead webhooks.
