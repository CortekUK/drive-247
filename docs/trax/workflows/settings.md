# Settings and navigation

## Purpose, roles and prerequisites

Settings configures business details, booking rules, communications and integrations. Managers need settings plus the corresponding settings sub-grant. V1 and V2 share settings tab mappings but lean tenants can be directed to the Integrations board instead of old provider tabs. Never derive a permission from the URL supplied by the user.

TRAX currently offers General and Templates guidance. Other settings, credentials, financial controls and ambiguous role combinations remain outside its navigation allowlist. Native editing is separate from permission to read instructions.

## Workflow and side effects

Open Settings and the appropriate visible tab. General contains business configuration; Templates contains communication templates. Review existing values in the native interface and use native save/preview controls. Settings changes can affect subsequent bookings and communications; TRAX does not save settings or evaluate a live configuration.

If a tab is missing, check the account's feature availability and manager settings grants. Do not work around a missing grant by guessing a URL. A template's display name is not evidence of delivery, and provider integration status requires a separate authorized check.

<!-- trax:settings:en -->
Open **Settings → General** for business configuration. Available tabs depend on your account and permissions. Managers need Settings access and the relevant sub-tab grant. Review and change values through the existing settings controls; TRAX does not save configuration.
<!-- /trax -->
<!-- trax:settings:ur-Latn -->
Business configuration ke liye **Settings → General** kholein. Tabs aap ke account aur permissions par depend karte hain. Manager ko Settings aur relevant sub-tab ka grant chahiye. Values existing settings controls se review aur change karein; TRAX configuration save nahi karta.
<!-- /trax -->
<!-- trax:templates:en -->
Look in **Settings → Templates** for communication templates. If that tab is unavailable, ask an account administrator to review your settings permissions. Use the existing template workflow to edit or preview; changing a template does not itself confirm a message was sent.
<!-- /trax -->
<!-- trax:templates:ur-Latn -->
Communication templates ke liye **Settings → Templates** dekhein. Agar tab available nahi hai to account administrator se settings permissions review karwayein. Edit ya preview ke liye existing template workflow use karein; template badalne se message bheja jana confirm nahi hota.
<!-- /trax -->

## Sources and tests

- `apps/portal/src/lib/permissions.ts`: SETTINGS_VALUE_TO_KEY and ROUTE_TO_TAB.
- `apps/portal/src/components/shared/layout/app-sidebar-v2.tsx`: settingsTabGroups.
- `apps/portal/src/lib/lean-areas.ts`: isSettingsTabHidden and settingsTabBoardCard.
- `apps/portal/src/__tests__/lib/trax-support.test.ts`: parent/sub-grant and route validation.

