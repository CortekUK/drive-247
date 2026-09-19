# Deployed edge functions with no source in this repository

Found 2026-09-18 while looking for a free Supabase secret slot. Not part of TRAX;
recorded here because it is the same class of problem as
`incident-jwt-signing-secret.md` and `containment-review.md`, and it was found by
the same method. **Nothing here has been changed.** Every statement below comes from
the Supabase Management API against project `hviqoaokxvlancmftwuo`.

## 1. What is deployed

360 functions are deployed. 336 directories exist under `supabase/functions`. **33
functions are deployed and ACTIVE with no source in this repository** — their code
was deleted locally while the deployment stayed live. A deployed function keeps
serving after its source is removed; nothing in this repo reviews, typechecks or
tests it.

## 2. The part that is an exposure

Three of them run DDL and do not look at the caller at all:

| Function | `verify_jwt` | Reads the caller | Checks a role | Runs DDL |
|---|---|---|---|---|
| `run-migration` | true | no | no | **yes** |
| `cleanup-rls` | true | no | no | **yes** |
| `fix-rls-v2` | true | no | no | **yes** |
| `fix-notifications-rls-final` | true | no | role names appear in DDL text only | **yes** |
| `fix-notifications-update-rls` | true | no | role names appear in DDL text only | **yes** |
| `debug-notifications` | true | no | no | no |
| `revoke-customer-session` | true | yes | yes | no |
| `zz-test-clock` | true | yes | no | no |

`verify_jwt: true` means the platform rejects a call with no valid project JWT. It
does **not** mean the caller is staff: every signed-in customer holds a valid
project JWT. Since these five neither read the caller's identity nor require a
separate admin credential, the effective audience for functions that alter RLS
policies and run migrations is **any authenticated user of any tenant**.

This has not been exercised against production — doing so would alter real policies,
which is exactly what must not be done to demonstrate a write exposure. The evidence
is the deployed source and the platform's own `verify_jwt` setting, not a probe.

Severity note, stated honestly: this is gated by *some* authentication, unlike
`public.exec_sql(text)`, which `anon` can call with the published key. That one
remains the more urgent item.

## 3. Why they cannot simply be deleted as "unused"

While looking for a deletable secret, 20 of the project's 107 secrets turned out to
be referenced nowhere in this repository. Twelve of those are read by these
orphaned-but-live functions:

| Secret | Read by |
|---|---|
| `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_BASE_URL`, `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_PRIVATE_KEY`, `DOCUSIGN_USER_ID` | `create-docusign-envelope`, `docusign-webhook`, `get-docusign-document` |
| `VERIFF_API_SECRET`, `VERIFF_BASE_URL` | `create-veriff-session`, `veriff-webhook`, `fetch-veriff-media` |
| `META_WHATSAPP_APP_ID`, `META_WHATSAPP_APP_SECRET`, `META_WHATSAPP_CONFIG_ID` | `send-collection-whatsapp`, `send-signing-whatsapp`, `manage-whatsapp-meta` |
| `BONZAH_EXTERNAL_API_KEY` | `push-bonzah-submission` |
| `TWILIO_WHATSAPP_NUMBER` | `test-whatsapp` |

Deleting those secrets on the evidence of this repository alone would have broken
document signing, identity verification, WhatsApp messaging and insurance
submission in production. **Repo absence is not disuse while 33 functions are
deployed from deleted source.**

Eight are referenced by neither the repo nor any deployed function:
`DOCUSIGN_WEBHOOK_SECRET`, `MODIVES_APIM_URL`, `MODIVES_DEALER_GUID_ID`,
`STRIPE_SUBSCRIPTION_MODE`, `TESLA_PRIVATE_KEY`, and the Supabase-managed
`SUPABASE_JWKS`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS` (platform
values, not ours to remove).

`DOCUSIGN_WEBHOOK_SECRET` being unread is its own observation: `docusign-webhook`
is live and no code in it references the webhook secret, so it does not appear to
verify DocuSign's signature. Not investigated further.

## 4. What I did not verify

- Whether anything outside Supabase (another repo, a cron, a partner) calls these.
- Whether the five DDL functions are idempotent one-shot scripts that have already
  run, or still do something. Their names suggest one-shot fixes; that is an
  inference, not a finding.
- Whether the secret limit is enforced on creation. Supabase documents a cap of 100
  secrets per project and does not raise it per project; this project holds 107, so
  the cap appears to be enforced on new secrets and not retroactively. I could not
  test it — writes to the secret store are blocked in this environment.

## 5. Suggested order, for a human to decide

1. Restore the 33 functions' source into the repo, or delete the deployments. Right
   now neither review nor rollback is possible for any of them.
2. For the five DDL functions specifically: if they are spent one-shot scripts,
   delete the deployments. If any is still needed, require an admin credential the
   platform check cannot satisfy — `verify_jwt` is not authorization.
3. Only then reconsider the secret inventory, with the restored source as evidence.
