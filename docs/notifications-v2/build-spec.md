# Notifications v2 + Pricing cleanup: build spec

Branch `haseeb/notifications-v2`. v2 only: everything is gated behind `useV2('chrome')` (northwind). Other tenants see nothing change.

- Product spec: [meeting-transcript-en.md](meeting-transcript-en.md).
- Shared types: `apps/portal/src/lib/notifications-v2/types.ts`.
- Repo rules that apply (from `V2_PLAN.md`):
  - Never change an existing edge function or `_shared` helper. Add `-v2` functions and new helpers instead.
  - Database changes are additive only, and go in `ops/*.sql` marked NOT APPLIED.
  - v1 files stay byte-identical, except for one-line route/branch hand-offs.
  - Every query filters by `tenant_id`.

---

## Decisions taken (each is an interpretation to confirm with the lead)

| # | Decision | Why |
|---|---|---|
| D1 | Pricing group in the Settings index becomes: **Tax, fees and deposit** (new page `?tab=fees`), Promo codes, Extras, **Weekend and holiday pricing** (`?tab=pricing`, renamed, moved last). | 00:01–00:27: fees/tax/deposit become a rule inside Pricing, next to custom pricing, which gets a clearer name. 02:24: "we'll move it to the end". |
| D2 | The Tax and fees and Security deposit sections leave General for the new `fees` page. `?tab=fees` opens that page; `?tab=preauth` opens it at the deposit section. | D1 |
| D3 | "Monthly rate starts at" moves to General as its own section, **after Booking rules**. It keeps permTab `pricing`, so exactly the same people can edit it. | 00:33–01:24: "move it to General… under these headings". Keeping the permission avoids a silent access change. |
| D4 | General stays **headings**, not tabs. | 00:54 is ambiguous; everything after it describes headings. |
| D5 | Weekend/holiday UI tidy: compact empty state; settings tables lose the 24px blank bands and match the flat panel look; the Add holiday button is always in the header; the "Stack surcharges" row gets plain wording; the "All N shown" footer is hidden on short settings lists. The table fix is **scoped to settings tables** through an opt-in prop, so other v2 lists do not change. | 01:40–03:31 |
| D6 | Trax overlap: on v2 settings pages the content column and the sticky save bar step aside by `--trax-offset` while the Trax panel is open, so the panel and its suggestion chips no longer sit over the middle of a section. | 03:39–03:48. Also flagged: the lead may have meant the dialog open animation, a known Meeting 4 backlog item that is not done here. |
| D7 | One **Notifications** page (`?tab=notifications`) replaces the Team emails and Push notifications entries in the v2 index. `?tab=reminders` and `?tab=push` open it at the matching section. | 05:39 "one single page" |
| D8 | New index group **Templates**, containing Customer messages (moved) and Agreement templates. | 04:11. Unclear whether the lead meant this or a rename. |
| D9 | Page structure: setup cards (Email sender, Push on this device, In-app), then **two direction groups**: "Customer → Your team" and "Your team → Customer". Inside each: categories, then items. The system set (super admin) is **not** built yet. | 06:52, 07:30, 08:59, 17:30 |
| D10 | Each item row shows: name, tooltip, a plain-English "when / where / direction" line, and per-channel switches (Email, Push, In-app). Opening an item shows a large panel with a channel tab per enabled channel: editor + preview + Send test. | 09:58–13:42, 15:25 |
| D11 | "Draft and save" = edit on the page, then save with the existing sticky save bar and leave guard. There is no separate published/draft copy. | 14:15 "the same save thing we already have" |
| D12 | Defaults = what the system does **today** on each channel. No push is sent by any event today, so push defaults to off. | 14:24. Honest defaults, and no surprise sends when sending moves over. |
| D13 | Email sender settings: display name, address local part (fixed domain `@drive-247.com`, must start with the tenant slug), optional reply-to. **CC is not built**: the lead said to leave CC alone. | 19:35–19:59 |
| D14 | Push display options are what the web can actually do: stay until dismissed, silent, replace the previous one, and an "Open in app" button. Banner vs lock screen is the phone's decision, and the page says so. | 10:30, 17:12. The web cannot choose banner/lock screen. |
| D15 | Email preview = a Gmail-style message view (sender, to me, subject, date) wrapping the **exact HTML** the test send delivers. That HTML is built by one layout module used by both the browser and the edge function (byte-identical copies, enforced by test). The layout is Gmail-safe: table-based, inline styles, no gradients or shadows. | 11:40 "exactly as in Gmail" |
| D16 | Push preview = iPhone and Android notification mockups at real device widths, using CSS line clamping, so the "…" falls where it would on that device. It is labelled approximate because every phone's font and width differ slightly. | 13:14–13:35 |
| D17 | Editor = a light Notion-style Tiptap editor on the Tiptap packages already installed: `/` command menu, formatting bubble on selection, variables as chips (typed with `{{` or picked from a menu), no toolbar. **No new npm dependencies**, and it is lazy-loaded. | 11:36, 13:50–14:11 "must not get heavy" |
| D18 | **Sending does not switch over in this phase.** Settings are stored, and previews and Send test work, but live notifications keep sending exactly as today until the runtime phase (a new `notification-dispatch-v2`) is approved and deployed. The page says this in one line at the top, for the canary. | V2_PLAN §7: existing senders cannot be edited. The lead wants approval step by step. |

## What needs approval before it goes live

1. Apply `ops/notifications_v2.sql` to prod through the Management API. Until then the page shows defaults and Save explains that storage isn't switched on yet.
2. Deploy the new edge function `notification-test-v2`.
3. Switch on `tenants.push_notifications_enabled` for northwind, if it is not already on. The seed script required it off on 2026-09-06, and the lead says it's on.
4. The runtime phase: route real sends through the per-notification settings, and build the super admin set.

---

## Module contracts

All paths below are under `apps/portal/src/` unless they start with `supabase/`, `ops/` or `docs/`.

### lib/notifications-v2/
| File | Exports |
|---|---|
| `types.ts` | The contract. Written, do not change its shapes without updating every consumer. |
| `variables.ts` | `NOTIFICATION_VARIABLES: NotificationVariable[]`; `getVariable(key)`; `exampleValues(brand?: Partial<EmailBrand>): Record<string,string>`; `fillVariables(text: string, values: Record<string,string>, opts?: {html?: boolean}): string` (escapes values when `html`; unknown `{{x}}` are left **visible** as `{{x}}` in previews); `extractVariables(text): string[]`; `unknownVariables(text, allowed: string[]): string[]` |
| `catalog.ts` | `NOTIFICATION_CATEGORIES: NotificationCategory[]`; `NOTIFICATION_CATALOG: NotificationItem[]`; `getNotificationItem(key)`; `itemsFor(direction, category)` |
| `email-layout.ts` | `renderNotificationEmailHtml({ bodyHtml, brand, preheader? }): string`, a full HTML document. `inlineEmailStyles(bodyHtml, brand): string` adds inline styles to p/h2/h3/ul/ol/li/a/blockquote/hr and `a[data-email-button]`. `sanitizeEmailBodyHtml(html): string` uses an allowlist of tags and attributes, drops `on*` and `javascript:`. **No imports** (so the same file runs in Deno). A byte-identical copy lives at `supabase/functions/_shared/notification-email-layout-v2.ts`, and a test enforces it. |
| `push-display.ts` | `PUSH_DEVICE_PROFILES` (iphone, android: width in px, title/body font, max lines collapsed/expanded); `PUSH_TITLE_MAX = 100`, `PUSH_BODY_MAX = 300` (`send-push` caps); `pushLengthWarnings(template)` |
| `settings-model.ts` | Pure functions: `effectiveChannel(item, channel, row?)`, `rowFromEdit(...)`, `diffEdits(saved, draft)`, `validateTemplate(channel, template, allowedVars)` returning `{ok, messages}`, `isValidLocalPart(local, slug)`, `senderAddress(settings, tenant)` |

### Hooks (hooks/)
| File | Exports |
|---|---|
| `use-notification-settings-v2.ts` | `useNotificationSettingsV2()` returns `{ rows, isLoading, error, tableMissing, saveRows(rows), resetRows(keys) }`. React Query key `["notification-settings-v2", tenant?.id]`. Every query uses `.eq('tenant_id', tenant.id)`. It **checks `{error}` and throws**. A missing table (PGRST205 / 42P01) gives `tableMissing: true`, not an error. |
| `use-email-sender-v2.ts` | `useEmailSenderV2()` returns `{ sender, isLoading, error, tableMissing, save(settings) }` on `tenant_email_sender` |
| `use-email-branding-v2.ts` | `useEmailBrandingV2()` returns `{ brand: EmailBrand }`, reading `company_name, logo_url, primary_color, accent_color, contact_email, contact_phone, phone, slug` from `tenants` for `tenant.id` |
| `use-notification-test-v2.ts` | `useNotificationTestV2()` returns `{ sendTest(req: NotificationTestRequest): Promise<NotificationTestResponse>, isSending }`. Unwraps edge errors (`lib/edge-error.ts` / `readEdgeFunctionError`). |

### Components (components/settings-v2/notifications-v2/)
| File | What |
|---|---|
| `template-editor.tsx` | `NotificationTemplateEditor({ value, onChange, variables, placeholder, readOnly })`: a Notion-like Tiptap editor producing the HTML described in `types.ts` (EmailTemplate). |
| `editor-extensions.ts` | Variable chip node (serialises to `{{key}}`), slash-command plugin, email button node. |
| `variable-text-input.tsx` | Single-line / multi-line plain inputs (subject, push title/body, in-app) with an Insert variable menu. |
| `email-preview-gmail.tsx` | `EmailPreviewGmail({ subject, html, fromName, fromAddress, toAddress })`: a Gmail message view. `html` is the full document from `renderNotificationEmailHtml`, which the caller renders, so this component has no dependency on the layout module. The email sits in a sandboxed `iframe srcdoc` (`sandbox="allow-same-origin"`, never `allow-scripts`), with auto height and a desktop/phone width toggle. |
| `push-preview-phone.tsx` | `PushPreviewPhone({ title, body, appName, iconUrl, options })`: iPhone lock-screen and Android shade mockups with a collapsed/expanded toggle and line-clamped text. |
| `inapp-preview.tsx` | `InAppPreview({ title, body, audience })`: the portal bell row (team) or the customer-portal bell row (customer). |
| `send-test-box.tsx` | Button, then an inline box underneath. Email: recipient pre-filled with the signed-in user's email and editable. Push: "Send to my devices". Shows the result inline. |
| `email-sender-settings-v2.tsx` | From name, from address (`local@drive-247.com`), reply-to, and the live `From:` preview line. Also the existing team recipient and master switch (reusing `use-email-notification-prefs`). |
| `push-setup-v2.tsx` | Setup steps that reuse `usePushNotifications`/`usePwaInstall`/`lib/push`: 1) install the app (Android button or browser menu; iOS Share → Add to Home Screen), 2) allow notifications (switch), 3) send a test to this device. When the tenant flag is off it shows a clear "not switched on for your account yet" state. |
| `notifications-page-v2.tsx` | The page. It composes everything, keeps the edit state, and registers one save with the page's sticky save bar (`registerSave('notifications', save, discard)`). |

### Push service worker
- `public/service-worker-v2.js` is a copy of `service-worker.js` plus:
  - `actions` (the "Open in app" button)
  - `silent`
  - `renotify` as its own field
  - `notificationclick` branching on `event.action`
  - same-origin URL check
  - a safe `navigate` fallback to `openWindow`
- `components/push/service-worker-registrar.tsx`: a one-line branch that registers `/service-worker-v2.js` when `useV2('chrome')`.

### Edge function `supabase/functions/notification-test-v2/` (new, NOT deployed)
- Auth: Bearer JWT, then `app_users` (active). Allowed callers:
  - super admin
  - head_admin or admin
  - a manager with editor on `settings.reminders`
- Tenant comes from `app_users.tenant_id`. For super admins only, it comes from `tenantSlug` in the body.
- Rate limit: 20 tests per user per rolling hour, counted in `notification_test_sends_v2`.
- **Email:**
  - validate a single recipient
  - sanitise `bodyHtml`
  - render with `_shared/notification-email-layout-v2.ts`, using tenant branding read on the server
  - subject `"[Test] " + subject`
  - From is `tenant_email_sender`, or `{company} <{slug}@drive-247.com>`
  - send through Resend REST
- **Push:**
  - the caller's own active staff subscriptions in the tenant
  - requires `tenants.push_notifications_enabled`
  - payload adds `actions`, `silent`, `renotify` and `tag` according to the options
  - sent with `_shared/web-push.ts` `sendWebPush`, imported (the helper is not edited)
- Logs one row in `notification_test_sends_v2` per send.

### SQL `ops/notifications_v2.sql` (NOT APPLIED)
- Tables:
  - `tenant_notification_settings`, PK (tenant_id, notification_key, channel)
  - `tenant_email_sender`, PK tenant_id
  - `notification_test_sends_v2`
- All additive, re-runnable. RLS **on** for the new tables only:
  - `REVOKE ALL FROM anon, authenticated`
  - explicit grants
  - a staff policy through `app_users.auth_user_id = auth.uid() AND is_active AND tenant_id = row.tenant_id`, or `is_super_admin()`
  - a service_role policy
- No triggers on existing tables. It ends with `NOTIFY pgrst, 'reload schema'`.
- It carries a read-only pre-flight block and a read-only verify block.
