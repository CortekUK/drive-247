# Settings and navigation

## Purpose, roles and prerequisites

Settings configures business details, booking rules, communications and integrations. Managers need settings plus the corresponding settings sub-grant. V1 and V2 share settings tab mappings but lean tenants can be directed to the Integrations board instead of old provider tabs. Never derive a permission from the URL supplied by the user.

TRAX currently offers General and Templates guidance. Other settings, credentials, financial controls and ambiguous role combinations remain outside its navigation allowlist. Native editing is separate from permission to read instructions.

## Workflow and side effects

Open Settings and the appropriate visible tab. General contains business configuration; Customer messages contains communication templates. Since 2026-09-24 the V2 settings index no longer lists a Templates card: each message is edited from the screen that sends it (Lockbox links to the lockbox message), and `/settings?tab=templates` still opens the page, which is what the Open Templates navigation target uses. Review existing values in the native interface and use native save/preview controls. Settings changes can affect subsequent bookings and communications; TRAX does not save settings or evaluate a live configuration.

If a tab is missing, check the account's feature availability and manager settings grants. Do not work around a missing grant by guessing a URL. A template's display name is not evidence of delivery, and provider integration status requires a separate authorized check.

<!-- trax:settings:en -->
Open **Settings → General** for business configuration. Available tabs depend on your account and permissions. Managers need Settings access and the relevant sub-tab grant. Review and change values through the existing settings controls; TRAX does not save configuration.
<!-- /trax -->
<!-- trax:settings:ur-Latn -->
Business configuration ke liye **Settings → General** kholein. Tabs aap ke account aur permissions par depend karte hain. Manager ko Settings aur relevant sub-tab ka grant chahiye. Values existing settings controls se review aur change karein; TRAX configuration save nahi karta.
<!-- /trax -->
<!-- trax:templates:en -->
Use **Open Templates** to reach the customer message templates. In the app they are opened from the screen that sends the message — **Settings → Lockbox** has a **Templates** link to the lockbox message — and older layouts list a **Templates** tab in Settings. If it is unavailable, ask an account administrator to review your settings permissions. Use the existing template workflow to edit or preview; changing a template does not itself confirm a message was sent.
<!-- /trax -->
<!-- trax:templates:ur-Latn -->
Customer message templates tak pahunchne ke liye **Open Templates** use karein. App mein ye us screen se khulte hain jahan se message jata hai — **Settings → Lockbox** par **Templates** link lockbox message kholta hai — aur purane layout mein Settings ke andar **Templates** tab hota hai. Agar ye available nahi hai to account administrator se settings permissions review karwayein. Edit ya preview ke liye existing template workflow use karein; template badalne se message bheja jana confirm nahi hota.
<!-- /trax -->

## Sources and tests

- `apps/portal/src/lib/permissions.ts`: SETTINGS_VALUE_TO_KEY and ROUTE_TO_TAB.
- `apps/portal/src/app/(dashboard)/settings/page.tsx`: V2_SETTINGS_PAGES (the `templates` tab, titled **Customer messages**) and V2_LOCKBOX_MESSAGES_HREF (Lockbox's link into it).
- `apps/portal/src/components/settings-v2/business-rules-pages.tsx`: `templatesHref` (the **Templates** link on the Lockbox page).
- `apps/portal/src/lib/lean-areas.ts`: isSettingsTabHidden and settingsTabBoardCard.
- `apps/portal/src/__tests__/lib/trax-support.test.ts`: parent/sub-grant and route validation.

