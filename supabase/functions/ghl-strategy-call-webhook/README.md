# GHL strategy-call webhook deployment contract

This handler defaults to `marketplace` mode. It verifies `X-GHL-Signature`
against HighLevel's published Ed25519 public key over the untouched request
body. The Supabase gateway must leave JWT verification off for this external
endpoint; authentication happens inside the handler before JSON parsing.

Required production configuration:

- `GHL_STRATEGY_CALL_WEBHOOK_MODE=marketplace`
- `GHL_STRATEGY_CALL_ALLOWED_LOCATION_IDS`
- `GHL_STRATEGY_CALL_ALLOWED_CALENDAR_IDS`
- `GHL_STRATEGY_CALL_ALLOWED_URL_HOSTS`
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`

The official Marketplace `AppointmentCreate` fixture contains `contactId`, but
does not normally contain the prospect email or Drive247 session UUID. Therefore
one of these must be proven in a redacted staging fixture before release:

1. GHL echoes `strategy_call_session_id` custom tracking into the signed event;
2. the signed event includes the normalized email; or
3. `GHL_PRIVATE_INTEGRATION_TOKEN` is configured so the handler can fetch the
   signed event's `contactId` and match its email to exactly one recent,
   unbooked strategy-call session.

If none succeeds, the handler fails closed with `422`, records only a redacted
`unmatched` delivery row, and sends no email. Do not enable the v2 funnel until
a real signed staging booking creates one booking row, one confirmation job,
and the correct reminder jobs.

`workflow_shared_secret` is a separate compatibility mode for a deliberately
configured GHL Workflow custom webhook. It requires
`GHL_STRATEGY_CALL_WORKFLOW_SECRET` in the
`x-strategy-call-workflow-secret` header. It is never attempted as a fallback
for a missing or invalid Marketplace signature.

Never save raw fixtures containing names, emails, phone numbers, meeting URLs,
or secrets in this repository. Redact them before adding a test fixture.

