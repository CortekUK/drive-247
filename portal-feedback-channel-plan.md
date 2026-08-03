# Portal Feedback Channel — Build Plan

## 0. Scope

Portal staff (tenant operators inside `apps/portal`) submit feedback about the Drive247 software itself — bug / improvement / feature request / note — from a permanent entry point in the portal. Drive247 super admin reviews everything from a new **Feedbacks** tab in `apps/admin`: email alerts on submission, AI-summarized themes, an ad-hoc chat over the feedback corpus, and open/resolved status tracking.

This is **not** customer/renter feedback about rentals — that's the existing `rental_reviews` table (staff rating customers), a separate feature.

**Tags** (final names — renamed from the original brief for clarity): 🐛 Bug (`#dc2626`) · 🔧 Improvement (`#d97706`) · ✨ Feature Request (`#6366f1`) · 📝 Note (`#737373`).

Repo conventions to follow throughout (root `CLAUDE.md`):
- Turborepo monorepo, Next.js App Router in all apps.
- Supabase Postgres + RLS; helpers used everywhere: `get_user_tenant_id()`, `is_super_admin()`.
- DB changes are real migration files in `supabase/migrations/`, named `YYYYMMDDHHMMSS_description.sql`, applied via Supabase MCP (not raw CLI).
- After any schema change, regenerate types and copy into **all three** apps:
  ```bash
  npx supabase gen types typescript --project-id hviqoaokxvlancmftwuo > apps/portal/src/integrations/supabase/types.ts
  cp apps/portal/src/integrations/supabase/types.ts apps/booking/src/integrations/supabase/types.ts
  cp apps/portal/src/integrations/supabase/types.ts apps/admin/src/integrations/supabase/types.ts
  ```
  `apps/admin` has `ignoreBuildErrors: false` — it will fail to build without this step.
- Never run `next dev` / `next build` directly — always the root npm scripts.

---

## 1. Database migration

New file: `supabase/migrations/<TIMESTAMP>_add_tenant_feedback.sql` (timestamp must sort after the current latest migration — check `ls supabase/migrations | tail -5` at build time).

Reference patterns to mirror:
- Table/RLS shape: `supabase/migrations/20260226100000_add_rental_reviews.sql`
- Storage bucket + `storage.objects` policies: `supabase/migrations/20260225120000_add_gig_driver.sql`
- `updated_at` trigger: use the existing `set_updated_at()` function (never `moddatetime`).

### 1.1 `tenant_feedback`

```sql
CREATE TABLE public.tenant_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  app_user_id uuid NOT NULL REFERENCES public.app_users(id),
  category text NOT NULL CHECK (category IN ('bug','improvement','feature_request','note')),
  message text NOT NULL,
  screenshot_url text,
  page_path text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Indexes: `tenant_id`, `status`, `created_at DESC` (admin list filters/sorts on these heavily).

RLS (enable, then):
- **INSERT**: `WITH CHECK (tenant_id = get_user_tenant_id() AND app_user_id IN (SELECT id FROM app_users WHERE auth_user_id = auth.uid()))`
- **SELECT**: `USING (tenant_id = get_user_tenant_id() OR is_super_admin())`
- **UPDATE**: `USING (is_super_admin())` — only super admin, and only in practice ever sends `status`/`resolved_at`/`resolved_by` (enforced at the app layer, not via column-level SQL policy — this repo doesn't use column privileges elsewhere).
- No DELETE policy.

### 1.2 `feedback_settings` (singleton — seed exactly one row)

```sql
CREATE TABLE public.feedback_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_enabled boolean NOT NULL DEFAULT true,
  force_login_triggered_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.feedback_settings (form_enabled) VALUES (true);
```
RLS: SELECT for any `authenticated` role (global config, no tenant scoping). UPDATE `is_super_admin()` only. App layer reads via `.single()` since there's only ever one row.

### 1.3 `feedback_notification_recipients`

```sql
CREATE TABLE public.feedback_notification_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
```
RLS: SELECT/INSERT/DELETE all `is_super_admin()` only. Never exposed to portal.

### 1.4 `feedback_insights`

```sql
CREATE TABLE public.feedback_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  summary text NOT NULL,
  top_themes jsonb NOT NULL DEFAULT '[]',
  generated_at timestamptz NOT NULL DEFAULT now()
);
```
RLS: SELECT `is_super_admin()` only. Always insert a new row on regenerate (history preserved); admin UI reads latest by `generated_at DESC LIMIT 1`.

### 1.5 `app_users` alter

```sql
ALTER TABLE public.app_users ADD COLUMN feedback_last_prompted_at timestamptz;
```
One column drives both client-side throttles: the rental-completion cooldown and the forced-next-login comparison (see §3).

### 1.6 Storage bucket `feedback-screenshots`

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('feedback-screenshots', 'feedback-screenshots', true, 5242880, ARRAY['image/jpeg','image/png'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 5242880, allowed_mime_types = ARRAY['image/jpeg','image/png'];
```
- Public SELECT (read).
- **INSERT scoped to `authenticated` + tenant-folder prefix** (`storage.foldername(name)[1] = get_user_tenant_id()::text` or `is_super_admin()`). Path convention: `{tenant_id}/{file}`.
- This is tighter than the `gig-driver-images` bucket it's modeled on — that one allows anon/public insert because it serves an unauthenticated guest flow. Feedback screenshots only ever come from logged-in portal staff, so don't copy that part of the pattern.
- No public/anon DELETE — `service_role` only.

### 1.7 Apply + typegen

Apply via Supabase MCP against prod (`hviqoaokxvlancmftwuo`). Then run the typegen + triple-copy command from §0.

---

## 2. Edge functions (`supabase/functions/`, Deno)

Both use the standard shared-CORS pattern already used everywhere in this repo:
```ts
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  // ...
});
```
Neither needs `verify_jwt = false` — both stay on the default `verify_jwt = true`.

### 2.1 `notify-feedback-submission`

- Input: `{ feedbackId }`.
- Auth: two-client pattern — one bound to caller's JWT just to identify them, one service-role client for the data work (copy the exact structure from `generate-review-summary/index.ts`).
- Logic:
  1. Service-role client fetches the `tenant_feedback` row joined to tenant name + submitter name.
  2. Fetch all rows from `feedback_notification_recipients`. Empty list → `jsonResponse({ success: true, skipped: true })`, not an error.
  3. Send one email per recipient via `_shared/resend-service.ts`'s `sendResendEmail()` (reuse, don't hand-roll). Content: category, tenant, submitter, message excerpt (~200 chars), link to the admin Feedbacks tab.
     - Admin URL: copy the `ADMIN_APP_URL` env-var-with-fallback pattern from `onboarding-daily-digest/index.ts` (`https://admin.drive-247.com` fallback), target path `/admin/feedbacks`.
     - Plain internal email, not tenant-branded — skip `getTenantBranding`/`wrapWithBrandedTemplate`.
- Called by the portal client **fire-and-forget** right after a successful `tenant_feedback` insert — same shape as the existing `generate-review-summary` call after a rental review submission (find that call site, e.g. in `apps/portal/src/hooks/use-rental-review.ts`, and copy it 1:1 so it stays consistent).

### 2.2 `feedback-insights`

- Auth: super-admin gated **at the application layer** (copy the check from `admin-force-logout/index.ts`: JWT → `auth.getUser()` → look up `app_users` by `auth_user_id` → check `is_super_admin` → 403 otherwise). The DB's `is_super_admin()` RLS helper doesn't apply here since this function uses a service-role client that bypasses RLS entirely.
- Body: `{ action: 'summarize' | 'chat', messages?: ChatMessage[] }`.
- Shared context builder: `tenant_feedback` rows (tenant name, submitter name, category, message, status, created_at) via service-role client, `ORDER BY created_at DESC LIMIT 500 AND created_at > now() - interval '90 days'`. No embeddings/RAG at this volume — stuff directly into the prompt, same approach `generate-review-summary` already uses.
- **`summarize`**: call `chatCompletion()` from `_shared/openai.ts` (reuse), ask for a prose summary plus a fenced JSON block for `top_themes` (`[{theme, count}]`). Parse the JSON block out of the response text defensively (try/catch, default `[]` on failure — no structured-output/JSON-mode pattern exists elsewhere in this repo to copy, so this is the safe fallback). Insert a new `feedback_insights` row, return it.
- **`chat`**: same fresh context every call (stateless, no caching), pass `[{role:'system', content: context}, ...clientMessages]` to `chatCompletion()`, return `{ reply }`. **Never persist chat messages** — conversation lives in the admin page's component state only.
- Skip the `requireActiveSubscription` billing gate that `generate-review-summary` uses — this is Drive247-internal tooling, not tenant-billable. Easy to copy-paste in by habit; don't.

---

## 3. Portal UI (`apps/portal/src`)

Light theme — DM Sans, `#6366f1` indigo accent, flat 1px-border cards, per the existing Figma design system.

### 3.1 `stores/feedback-store.ts`
Zustand: `isOpen`, `prefillCategory`, `open(category?)`, `close()`. No persistence needed. Lets the sidebar button and both automatic triggers open the same dialog with no prop drilling.

### 3.2 `hooks/use-feedback-settings.ts`
React Query, key `["feedback-settings"]` — **no `tenant.id`** in the key, deliberately, since this is a platform-wide singleton not tenant data (documented exception to the usual convention). Returns `{ formEnabled, forceLoginTriggeredAt, isLoading }`.

### 3.3 `hooks/use-tenant-feedback.ts`
Submit mutation:
1. Optional screenshot upload first → `feedback-screenshots` bucket, path `${tenant.id}/${crypto.randomUUID()}.${ext}`.
2. Insert `tenant_feedback` (`tenant_id` from `useTenant()`, `app_user_id` from `useAuth()`'s `appUser.id`, `page_path` from `usePathname()`).
3. Fire-and-forget `supabase.functions.invoke('notify-feedback-submission', { body: { feedbackId } })` — don't await/block the UI on it.
4. On success, update `app_users.feedback_last_prompted_at = now()` (submitting counts as "seen").
5. Toast via `@/hooks/use-toast`.

### 3.4 `components/feedback/feedback-dialog.tsx`
Design tokens: `#080812` headings / `#404040` body / `#737373` muted, `#6366f1` primary accent, `#f1f5f9` 1px card borders, no shadows, DM Sans (Inter for buttons only).

| Category | Icon (lucide) | Color |
|---|---|---|
| Bug | `Bug` | `#dc2626` |
| Improvement | `Wrench` | `#d97706` |
| Feature Request | `Sparkles` | `#6366f1` |
| Note | `StickyNote` | `#737373` |

Single-select chips, required message textarea, optional screenshot (drag/drop or click, preview thumbnail, client-side validate ≤5MB + jpeg/png before upload), Cancel/Submit footer (indigo Submit). Pre-select `prefillCategory` from the store if set.

### 3.5 Sidebar — `components/shared/layout/app-sidebar.tsx`
Persistent **Feedback** trigger (button, not a route link), icon `MessageSquarePlus`, calls `useFeedbackStore().open()`. Placement: near the bottom, above/near the account/footer area. No active-route highlight (it's never "the current page"). Gate entirely on `use-feedback-settings()`'s `formEnabled` — render nothing (not disabled) when `false`.

### 3.6 Rental-completion trigger — `app/(dashboard)/rentals/[id]/page.tsx`
Locate where `setShowReviewDialog(true)` fires (the existing `rental_reviews` trigger). Add a companion check that opens the feedback dialog from that dialog's close handler (sequenced, never stacked):

```
formEnabled &&
(feedback_last_prompted_at == null || daysSince(feedback_last_prompted_at) > 7)
```

Update `feedback_last_prompted_at = now()` **at display time**, not only on submit — a dismiss still resets the cooldown, so it never nags.

### 3.7 Forced next-login trigger — `app/(dashboard)/layout.tsx`
Alongside the existing `PolicyAcceptanceGate` / `SubscriptionGateDialog` wiring, once `appUser` is loaded:

```
force_login_triggered_at != null &&
(feedback_last_prompted_at == null || feedback_last_prompted_at < force_login_triggered_at)
```

**Must not block dashboard access** — this is a dismissible modal on top of a fully usable dashboard, not a hard gate like the policy gate. Just conditionally trigger `open()` in a `useEffect`, don't reuse the gate's blocking-render pattern.

---

## 4. Admin UI (`apps/admin`)

> **Note:** admin runs a **dark theme** (`bg-dark-card`, `border-dark-border`, `text-white`/`text-gray-400`, `bg-primary-600` — see `components/admin/Sidebar.tsx` and `app/admin/(protected)/announcements/page.tsx`), distinct from the portal's light Figma system. Follow the Announcements page as the closest structural sibling — not the portal design tokens above, those are portal-only.

### 4.1 Sidebar — `components/admin/Sidebar.tsx`
Add to the "Management" group's `items` array (alongside Announcements):
```ts
{ name: 'Feedbacks', href: '/admin/feedbacks', icon: MessageSquareText }
```

### 4.2 `app/admin/(protected)/feedbacks/page.tsx`
Client component, same shape as `announcements/page.tsx` — existing UI primitives only (`Card`, `Dialog`, `Button`, `Input`, `Textarea`, `Select`, `Badge`, `Tabs`), no new ones needed.

1. **Stat cards** — total open, submitted this week, top category this week.
2. **AI Insights card** — latest `feedback_insights.summary` + `top_themes` as tag/count chips, a **Regenerate** button (`feedback-insights` / `action: 'summarize'`), and an inline chat box below it (message list + input, conversation held in local component state only — never written to a table) calling `feedback-insights` / `action: 'chat'`.
3. **Filter bar** — category (4-way), status (open/resolved), tenant, date range.
4. **Table** — tenant, submitter, category pill (same colors as §3.4), message excerpt, status, date, actions (Mark Resolved / Reopen — direct `UPDATE tenant_feedback` from the admin client, no edge function needed since RLS already gates it to `is_super_admin()`).
5. **Settings panel** (collapsible section or gear-icon dialog):
   - Toggle `feedback_settings.form_enabled` (direct update).
   - Email chip-manager for `feedback_notification_recipients` (add validates email format + inserts; remove deletes by id) — copy the add/remove-chip interaction from the existing `notification_emails` editor in `settings/page.tsx` (lines ~144–176), not its underlying storage (that one's a text array on `admin_settings`, this is a proper table).
   - **"Force show on next login"** button → `UPDATE feedback_settings SET force_login_triggered_at = now()`, simple confirming toast (reversible/low-risk, no type-to-confirm needed).
   - **Reuse, don't rebuild**, the existing Force Logout All Users control — copy the block from `settings/page.tsx` (state: `showGlobalLogoutConfirm`, `globalLogoutConfirmText`, `globalLogoutLoading`; handler `handleGlobalForceLogout` → `admin-force-logout` edge function; the type-`"LOGOUT ALL"`-to-confirm dialog) into this settings panel so both controls live together.

---

## 5. Build & deploy checklist

1. Apply migration via Supabase MCP against prod (`hviqoaokxvlancmftwuo`).
2. Regenerate + copy types to all 3 apps (before touching admin code — it won't typecheck otherwise).
3. Write + deploy the 2 edge functions.
4. Build portal pieces (store, 2 hooks, dialog, sidebar edit, 2 trigger call-sites).
5. Build admin pieces (sidebar item, Feedbacks page).
6. `npm run build` for portal and admin via root scripts (never `next build` directly), then `npm run lint`.
7. Stage only touched files, one commit, customer-experience tone (e.g. `feat(portal): add staff feedback channel + admin review tab`), push directly to `main` (matches this repo's existing direct-to-main flow — no PR).
8. Confirm the Vercel deploy actually succeeds post-push before calling it done.

---

## Open judgment calls (flagged, not blocking)

- `tenant_feedback` UPDATE restriction to status/resolved fields is enforced at the app layer, not via SQL column privileges — consistent with how the rest of this repo handles it.
- `feedback-screenshots` bucket is authenticated + tenant-folder scoped, tighter than the public `gig-driver-images` bucket it's modeled on.
- `feedback_settings`'s React Query key deliberately excludes `tenant.id` (global singleton).
- `top_themes` extraction uses prose + fenced-JSON-block parsing rather than OpenAI JSON mode, since no existing usage in this repo demonstrates a structured-output pattern to copy.
- `feedback-insights` skips the tenant billing/subscription gate used elsewhere — internal tool, not tenant-billable.
- Admin's Feedbacks page follows the dark-theme Announcements page, not the portal's light design tokens in CLAUDE.md.
