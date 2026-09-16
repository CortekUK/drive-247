# Bonzah setup in V2

Scope: repository-verified setup guidance only. Policy issuance, eligibility, live connection status, provider balance and actual coverage are not checked by TRAX.

Open the V2 **Integrations** board, then **Bonzah**. This destination maps to `settings.integrations` and requires the V2 `appearance` gate in addition to TRAX's `chrome` gate. Managers need the integration grant. Provider credentials and submissions stay in the native panel; they never enter shared knowledge or TRAX tools.

The existing panel derives Apply, Review, Activate and Sell stages from the tenant integration and application. An application can await review, need corrections, be approved without credentials, remain in test mode, be live but disabled, or be live and enabled. TRAX must not infer the current stage from documentation. The native **Test connection** action contacts the provider; TRAX does not invoke it. Actual activation and approval depend on Bonzah and authorized administrators. Do not tell an operator that submitting an application immediately activates cover.

Rental creation offers insurance only when the existing prerequisites permit it. PAYG and disabled/test/incomplete configuration can change that flow. Choosing and submitting insurance can request a quote and activate a policy; these are native business actions, not support tools. Provider errors, insufficient provider balance and underwriting decisions require authorized review, not repeated speculative issuance.

<!-- trax:bonzah:en -->
Open **Integrations → Bonzah** in V2. The setup panel shows **Apply**, **Review**, **Activate** and **Sell**. Apply with the details requested there, then follow the panel's actual review status. Approval, saved credentials, live activation and enabling cover are distinct steps; an application alone does not make insurance available. **Test connection** belongs to the native integration panel. Keep credentials there, not in chat. Rental insurance options depend on eligibility, rental type and the tenant's setup; pay-as-you-go does not use the same selection flow. TRAX can explain this workflow but has not checked your provider connection, policy or coverage and cannot activate insurance.
<!-- /trax -->
<!-- trax:bonzah:ur-Latn -->
V2 mein **Integrations → Bonzah** kholein. Panel **Apply**, **Review**, **Activate** aur **Sell** stages dikhata hai. Required details se apply karein aur panel ka asal review status follow karein. Approval, credentials save karna, live activation aur cover enable karna alag steps hain. Sirf application se insurance available nahi hota. **Test connection** native panel mein hai. Credentials wahin rakhein, chat mein nahi. Rental type, eligibility aur tenant setup insurance options badalte hain; pay-as-you-go ka flow alag hai. TRAX connection, policy ya coverage verify ya activate nahi karta.
<!-- /trax -->

Sources: `apps/portal/src/app/(dashboard)/integrations/page.tsx` V2 gate; `integrations-board.tsx` panel selection; `_panels/bonzah.tsx` `deriveStage`, `BonzahPanel`, `BonzahStatus`; `apps/portal/src/components/rentals-v2/rental-create-v2.tsx` insurance prerequisites. Tests: TRAX knowledge catalog and support guidance/permission tests. Native provider end-to-end behavior remains unverified.
