# Strategy-call confirmation funnel runbook

This runbook covers deployment and verification for the Drive247 post-booking
education funnel at `/strategy-call/confirmation`. Do not enable the v2 page
until the release gates below are complete.

## Customer and data flow

```text
Qualifier form
  -> create_strategy_call_session (contact + opaque session, atomically)
  -> GHL calendar iframe (non-secret session UUID only when configured)
  -> browser completion message (navigation hint only)
  -> signed GHL webhook (booking source of truth)
  -> apply_strategy_call_booking_event (idempotent lifecycle update)
  -> confirmation/reminder email queue
  -> confirmation page reads a privacy-safe booking summary
  -> four vertically stacked preparation videos + non-PII events
```

The browser message never proves that a booking exists. Only a provider webhook
that passes raw-body signature verification can create or update a booking.

## Schema

Migration: `supabase/migrations/20260815120000_strategy_call_booking_funnel.sql`

```text
contact_requests 1---* strategy_call_sessions 1---* strategy_call_bookings
        |                         |                         |
        |                         +---* strategy_call_funnel_events
        |                                                   |
        +-----------------------* strategy_call_emails *----+
                                                            |
strategy_call_webhook_events *------------------------------+
```

- `strategy_call_sessions` stores only a hash of the opaque browser token and
  links the qualifier contact to the booking handoff.
- `strategy_call_bookings` stores the trusted GHL lifecycle, scheduled time,
  timezone, and allow-listed provider URLs.
- `strategy_call_webhook_events` supplies provider-event idempotency and
  redacted operational status; raw webhook bodies are not retained.
- `strategy_call_emails` is the idempotent confirmation, reminder, and
  follow-up queue.
- `strategy_call_funnel_events` stores allow-listed, rate-limited engagement
  events without name, email, phone, meeting URL, or raw IP address.
- All five tables use RLS and expose no direct `anon` or `authenticated` table
  access. The three mutation RPCs are service-role only.

## Environment variable names

Web application:

- `NEXT_PUBLIC_GHL_BOOKING_URL`
- `NEXT_PUBLIC_GHL_ALLOWED_ORIGINS`
- `NEXT_PUBLIC_GHL_SESSION_QUERY_PARAM` (optional; use only after GHL confirms
  the custom field/query contract)
- `STRATEGY_CALL_CONFIRMATION_V2`
- `STRATEGY_CALL_SESSION_PEPPER`
- `GHL_STRATEGY_CALL_ALLOWED_URL_HOSTS`
- existing Supabase URL, public key, and server service-role variables

Supabase Edge Functions:

- `GHL_STRATEGY_CALL_WEBHOOK_MODE` (`marketplace` for current GHL webhooks)
- `GHL_ED25519_PUBLIC_KEY` (optional official-key rotation override)
- `GHL_STRATEGY_CALL_ALLOWED_LOCATION_IDS`
- `GHL_STRATEGY_CALL_ALLOWED_CALENDAR_IDS`
- `GHL_STRATEGY_CALL_ALLOWED_URL_HOSTS`
- `GHL_PRIVATE_INTEGRATION_TOKEN`
- `GHL_STRATEGY_CALL_WORKFLOW_SECRET` (only for the explicitly selected
  `workflow_shared_secret` compatibility mode)
- `STRATEGY_CALL_CONFIRMATION_URL`
- `STRATEGY_CALL_FROM_EMAIL`
- `STRATEGY_CALL_REPLY_TO_EMAIL`
- `STRATEGY_CALL_EMAIL_LOGO_URL`
- existing Supabase URL/service-role and `RESEND_API_KEY` variables

Never put values in source, migrations, screenshots, tickets, or this document.
Use separate staging and production values.

## Media contract

The exact filenames, encoding expectations, and pre-enable checklist are in
`apps/web/public/strategy-call/README.md`. The feature flag must remain off if
any approved MP4, poster, synchronized WebVTT caption, or verbatim transcript
is missing. Do not commit the multi-hundred-megabyte source masters.

The supplied archive contains exactly four masters (3,070,153,030 bytes):

| Order | Source | Duration | Web-review candidate | Candidate size |
| --- | --- | ---: | --- | ---: |
| 1 | `fnl part1.mp4` | 2:56.13 | `01-marketplace-dependency.mp4` | 26,392,864 B |
| 2 | `fnl part2.mp4` | 6:41.79 | `02-drive247-system-walkthrough.mp4` | 33,340,530 B |
| 3 | `fnl part3.mp4` | 2:26.33 | `03-frequently-asked-questions.mp4` | 21,461,941 B |
| 4 | `part4 fnl.mp4` | 1:45.64 | `04-who-this-is-for.mp4` | 14,042,276 B |

The 95,237,611-byte review set is 720p/30fps H.264 with AAC, fast-start MP4,
plus WebP poster and draft WebVTT files. It is prepared outside Git for review;
use the approved media CDN rather than committing binary masters/candidates.

Current source-review blockers (15 August 2026):

- Video 1 contains specific commission, customer-result, time-period, and
  savings claims. These require evidence and product/legal approval; its stated
  commission range also differs from existing website copy.
- Video 2 describes the walkthrough as an existing client's live system and
  visibly includes contact/back-office data. Do not publish it or a derived
  poster until documented client consent and a frame-by-frame privacy review
  exist. A sanitized demo-tenant re-recording is the safest option.
- Video 3 contains a seven-day/no-charge promise, named customer stories,
  percentage and savings claims, and statements about insurance/ID handling.
  Each needs evidence, legal/product approval, and customer consent before use.
- Video 4 says the call is about 45 minutes while the page currently says 20,
  gives a two-week/first-month-free guarantee that conflicts with Video 3, and
  tells an already-booked viewer to use a booking button. Product must provide
  one approved duration, offer, guarantee, and post-booking CTA.
- Offline speech recognition produced draft caption candidates for review, but
  it contains obvious wording errors. Automatic output is not an approved
  transcript or an accessibility acceptance result.

## Release sequence

1. Rotate any credentials previously committed to Git and move operational
   scripts to environment/vault configuration.
2. Apply the additive migration to staging.
3. Deploy `ghl-strategy-call-webhook`, `send-strategy-call-email`, and
   `dispatch-strategy-call-emails` with their documented JWT settings.
4. Configure a staging GHL webhook and the exact allowed location/calendar IDs.
5. Run one real create, reschedule, cancel, complete, and no-show lifecycle.
6. Verify the booking, webhook ledger, queued email times, and one delivered
   confirmation email using redacted evidence.
7. Upload all four approved web-optimized media sets and verify their URLs.
8. Deploy the web app with `STRATEGY_CALL_CONFIRMATION_V2=false`.
9. Enable the flag for an internal booking, complete accessibility/mobile/error
   checks, then enable production traffic.
10. Monitor the queries below through the first business day.

## Monitoring queries

These queries contain identifiers, so run them only in the protected Supabase
admin environment and redact evidence before sharing it.

```sql
-- Webhook failures and unmatched appointments in the last 24 hours.
select processing_status, failure_code, count(*)
from public.strategy_call_webhook_events
where created_at >= now() - interval '24 hours'
group by processing_status, failure_code
order by count(*) desc;

-- Bookings whose confirmation email has not been sent after five minutes.
select b.id, b.status, b.scheduled_start_at
from public.strategy_call_bookings b
left join public.strategy_call_emails e
  on e.booking_id = b.id and e.email_type = 'confirmation'
where b.created_at < now() - interval '5 minutes'
  and b.status in ('scheduled', 'rescheduled')
  and coalesce(e.delivery_status, 'missing') <> 'sent';

-- Upcoming bookings without both active reminder rows.
select b.id, count(e.id) as active_reminders
from public.strategy_call_bookings b
left join public.strategy_call_emails e
  on e.booking_id = b.id
 and e.email_type in ('reminder_24h', 'reminder_1h')
 and e.delivery_status in ('pending', 'sending', 'sent')
where b.status in ('scheduled', 'rescheduled')
  and b.scheduled_start_at > now()
group by b.id
having count(e.id) < 2;

-- Privacy-safe funnel counts by content version and event.
select content_version, event_name, video_slug, count(*)
from public.strategy_call_funnel_events
where created_at >= now() - interval '7 days'
group by content_version, event_name, video_slug
order by content_version, event_name, video_slug;
```

## Required staging evidence

- Mobile and desktop screenshots in light and dark themes.
- Keyboard and screen-reader smoke results.
- A screen recording showing only one active player, genuine watched-coverage
  progress, reload resume, media-error fallback, and all four videos.
- Redacted correlation between one signed webhook event, booking row,
  confirmation email, and reminder rows.
- A forged/tampered webhook rejection and unmatched-booking observation.
- Unit/component test, explicit type-check, lint, build, and migration output.
- George/Ghulam approval for final copy, claims, titles, posters, captions,
  transcripts, and video order.

## Rollback

Set `STRATEGY_CALL_CONFIRMATION_V2=false` to restore the legacy page. Leave the
additive booking and webhook records in place unless a reviewed incident
requires disabling the provider webhook. Do not drop the new tables during an
urgent rollback, and do not restore the old pre-booking “confirmation” email.
