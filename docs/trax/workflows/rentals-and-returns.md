# Rentals and return handover

## Purpose, location and permissions

Rentals connect a customer, vehicle, dates and fulfilment steps. Open Rentals, then the rental record. The main Calendar View remains an entry point on the Rentals list. In V2, the record's stages are Customer, Vehicle, When & where, Extras, Agreement, Insurance, Payments and Handover. The default stage is Customer; its heading does not turn this into the separate customer detail page.

Active head_admin, admin, ops and viewer staff can view ordinary rental guidance; managers need a rentals grant. Viewing does not permit editing. A viewer cannot complete return; a manager needs rentals/editor for an edit-oriented link. The existing native return mutation's deployed policies still require verification. Finance capabilities are withheld in TRAX regardless of rental access.

## Prerequisites and workflow

A record must belong to the current tenant. Select the correct customer and vehicle, establish the actual pickup/return window, and complete the requirements shown by the application. Approval, collection/payment, insurance and agreements are separate checks. Do not assume one status proves all prerequisites passed.

The giving handover writes a handover timestamp and can activate a rental when approval and payment requirements pass. It can place a deposit hold and send notifications. Receiving handover closes the rental, updates vehicle status and attempts hold release and completion notification. These operations are not one transaction; a failed hold release can leave a separate follow-up task after the keys were recorded.

PAYG closure also has a dedicated finalization flow. A manual status change is not a substitute for settling that workflow. Fixed rental periods and extensions must retain their original dates; the Payment Plan calendar includes explicitly unsaved frontend extension previews. A preview is not a persisted extension or a billing change.

## Blockers and safe troubleshooting

A car can remain occupied while an Active/Started rental is overdue and not released in the booking logic. Confirm the record before completing any return. A customer saying keys were returned is useful reported evidence, not proof of a saved handover. If return timestamps and rental state conflict, do not repeat an action blindly. Inspect the existing record and seek authorized operational review.

A successful return does not prove a deposit was released or that another booking/block/buffer no longer applies. The guidance below explains the workflow. The policy-gated local operational tool can read a scoped rental and its receiving records; it cannot complete a return or verify financial side effects.

## Prepared support sections

<!-- trax:rental_create:en -->
In **Rentals**, choose **New Rental**. The V2 intake asks for **Booking Mode**, **Customer**, then **Vehicle**, before opening **New Rental Agreement**. Select the real dates and complete the requirements the form shows. Fixed and pay-as-you-go bookings have different fields; do not invent an end date or a period rate. Review the agreement, insurance and verification requirements before **Create Rental**. The button can instead say **Verify or Waive to Continue**. If a payment-provider setup gate appears, review that gate in the native interface; TRAX cannot bypass it. Creating a rental can also create billing records, reminders and insurance requests. TRAX only explains these steps and does not submit the form.
<!-- /trax -->
<!-- trax:rental_create:ur-Latn -->
**Rentals** mein **New Rental** chunein. V2 mein pehle **Booking Mode**, phir **Customer** aur **Vehicle**, us ke baad **New Rental Agreement** khulta hai. Asal dates aur form ki requirements bharein. Fixed aur pay-as-you-go ke fields alag hain; end date ya rate khud se assume na karein. **Create Rental** se pehle agreement, insurance aur verification dekhein. Button **Verify or Waive to Continue** bhi dikha sakta hai. Payment-provider setup ki rukawat aaye to native screen par review karein; TRAX usay bypass nahi karta. Rental banane se billing records, reminders aur insurance requests bhi ban sakti hain. TRAX form submit nahi karta.
<!-- /trax -->

<!-- trax:payment_methods:en -->
For general payment-method guidance, the V2 rental has a **Payments** stage. Its existing payment dialog distinguishes collecting through the configured provider from recording money received outside the application. The manual method labels include **Cash**, **Card**, **Transfer**, **Zelle**, **Check** and **Other**. A manual Card entry is not evidence that a processor charged a card. Stripe and Square options depend on the tenant's configured provider and the dialog's eligibility checks. Use only controls your role permits. A missing or uncertain payment needs a verified investigation before another collection attempt. TRAX cannot inspect a balance, prove receipt, recommend a duplicate charge or perform a financial action in this version.
<!-- /trax -->
<!-- trax:payment_methods:ur-Latn -->
Payment method ki general guidance ke liye V2 rental ka **Payments** stage dekhein. Existing dialog configured provider se collection aur bahar receive huay paisay record karna alag rakhta hai. Manual labels **Cash**, **Card**, **Transfer**, **Zelle**, **Check** aur **Other** hain. Manual Card entry se processor charge prove nahi hota. Stripe ya Square options tenant setup aur dialog checks par depend karte hain. Sirf allowed controls use karein. Agar payment missing ya uncertain ho to dobara collection se pehle verified investigation zaroori hai. TRAX is version mein balance, receipt ya financial action verify ya execute nahi karta.
<!-- /trax -->

<!-- trax:rentals:en -->
Open **Rentals**, then select the rental. Review the customer, vehicle, dates and the requirements shown on that record. Approval, agreement, insurance, payment and handover are separate steps; completing one does not prove the others are finished. In V2 these are contextual stages, starting with Customer. Use the existing controls for changes you are permitted to make.
<!-- /trax -->
<!-- trax:rentals:ur-Latn -->
**Rentals** kholein aur rental select karein. Customer, gaari, dates aur record par dikhayi gayi requirements dekhein. Approval, agreement, insurance, payment aur handover alag steps hain; aik step complete hone se baqi complete nahi hote. V2 mein ye stages hain aur pehla Customer hai. Tabdeeli sirf apni ijazat ke mutabiq existing controls se karein.
<!-- /trax -->
<!-- trax:returns:en -->
To record a returned car, open the rental and its **Handover** stage in V2, or the existing key-handover section in the other layout. Authorized staff confirm receipt there. This can close the rental, update the vehicle and attempt deposit-hold release and a completion notification. If the record already shows receipt or contains conflicting states, review it before repeating the action. Physical return and the system's recorded return are separate facts.
<!-- /trax -->
<!-- trax:returns:ur-Latn -->
Wapas aayi gaari record karne ke liye rental kholein. V2 mein **Handover** stage, aur doosre layout mein key-handover section dekhein. Authorized staff wahin receipt confirm kare. Is se rental close, vehicle update aur deposit hold release aur notification ki koshish ho sakti hai. Agar receipt pehle se recorded hai ya states mukhtalif hain, action dohrane se pehle review karein. Gaari ka wapas aana aur system mein return record hona alag baatein hain.
<!-- /trax -->

## Source and test references

- `apps/portal/src/components/rentals-v2/rental-detail/stages.ts`: STAGES, readStage, stageHref.
- `apps/portal/src/components/rentals-v2/rental-create-v2.tsx`: RentalCreateV2, guided intake, rentalCreationBlocked and onSubmit. Full transactional creation guarantees remain unverified.
- `apps/portal/src/components/rentals-v2/rental-detail/payments-actions.tsx`: PaymentActions reuses the existing money dialogs; guidance does not grant finance access.
- `apps/portal/src/components/shared/dialogs/add-payment-dialog.tsx`: PAYMENT_METHODS, AddPaymentDialog. Reference only; TRAX never calls its mutations.
- `apps/portal/src/hooks/use-key-handover.ts`: useKeyHandover, markKeyHanded.
- `supabase/functions/finalize-payg-rental/index.ts`: dedicated PAYG closure.
- `docs/rental-period-calendar.md`: original and preview extension periods.
- `apps/portal/src/__tests__/lib/trax-support.test.ts`: guidance, ownership and navigation restrictions.
- Native return workflow end-to-end/transaction guarantees: **not verified**.


## Read-only return evidence

`getRentalSupportContext` selects the rental number, status, actual start/end, vehicle relation and PAYG closure indicators. `returnEvidence` reads at most three tenant-scoped receiving records from rental_key_handovers (id, rental_id, tenant_id, handover_type, handed_at). No notes, photos, signatures or identity material is fetched. The parent rental must be accessible. A query-limit result cannot prove receiving is absent.

A blocking Active/Started rental with no receiving completion can offer the registry's rental_return action to an editor. Pending/Upcoming records get review guidance, not a claim that a return is due. If receiving or PAYG closure exists while status remains open, show a conflict and the rental review link; do not offer repeat return. Viewers and restricted managers never receive the edit-oriented return action. TRAX does not verify physical return and does not reconcile or repair status.
<!-- trax:agreement_send:en -->
Open the rental and choose **Agreement** in its stage rail. A rental created in the portal sends its agreement automatically; if one has none yet, send it from here. **Selected template** shows which template will be sent, the default unless you **Change** it; **Preview** shows it with this rental's details, and **Edit** opens the template editor, where **Save to template** updates that template for future agreements. Select **Send the agreement**. Later sends read **Send an updated agreement** and email a fresh document built from the rental as it stands, which is how you re-issue after changing terms. The button stays disabled until the customer has a name and email address. **The terms as they stand now** shows what the next document will state. After sending, use **Open the document** or **Open the signed copy**, and **Check for a signature** to refresh the status from BoldSign. If dates or the car changed after sending, a banner offers **Send an updated agreement** / **Resend with the new terms** or **Keep the signed one** / **Keep as sent**; keeping only hides the notice in your browser. Older sends appear under **Earlier versions**. Sending needs e-sign credits, and BoldSign allows 50 sends an hour. TRAX does not send, void or sign agreements and cannot confirm a signature.
<!-- /trax -->
<!-- trax:agreement_send:ur-Latn -->
Rental kholein aur stage rail mein **Agreement** chunein. Portal mein bani rental ka agreement khud chala jata hai; agar abhi koi nahi gaya to yahan se bhejein. **Selected template** batata hai ke kaunsa template jayega, jab tak aap **Change** na karein default wala; **Preview** use is rental ki tafseel ke saath dikhata hai, aur **Edit** template editor kholta hai jahan **Save to template** us template ko aane wale agreements ke liye update karta hai. **Send the agreement** dabayein. Baad mein button **Send an updated agreement** ban jata hai aur rental ki maujooda terms se naya document email karta hai; terms badalne ke baad dobara bhejne ka yehi tareeqa hai. Customer ka naam aur email na ho to button disabled rehta hai. **The terms as they stand now** batata hai ke agla document kya likhega. Bhejne ke baad **Open the document** ya **Open the signed copy** kholein, aur BoldSign se status taaza karne ke liye **Check for a signature** dabayein. Agar bhejne ke baad dates ya gaari badli ho to banner **Send an updated agreement** / **Resend with the new terms** ya **Keep the signed one** / **Keep as sent** deta hai; keep karne se notice sirf aapke browser mein chhupta hai. Purane versions **Earlier versions** mein milte hain. Bhejne ke liye e-sign credits chahiye, aur BoldSign ek ghante mein 50 sends allow karta hai. TRAX agreement bhejta, void ya sign nahi karta aur signature confirm nahi kar sakta.
<!-- /trax -->
- `apps/portal/src/components/rentals-v2/rental-detail/stage-agreement.tsx`
- `apps/portal/src/components/rentals-v2/rental-detail/rental-detail-v2.tsx`
- `apps/portal/src/components/rentals-v2/rental-detail/stage-insurance.tsx`
- `apps/portal/src/components/rentals/buy-insurance-dialog.tsx`
<!-- trax:rental_insurance:en -->
Open the rental and choose **Insurance** in its stage rail; cover is optional. **Add cover**, or **Re-quote and replace** when a policy is active, opens **Select Insurance Coverage**; finish with **Purchase Insurance**. The premium is charged to the rental and the screen moves to **Payments**. The button is disabled, with the reason shown, when Bonzah is unavailable, the make and model is not covered, no insurable days remain, or the rental lacks a car or customer. If the dates move after purchase, a banner flags the mismatch and offers **Re-quote and replace** or **Keep the current policy** (this hides it only in your browser). If **Already insured for these dates** appears, **Issue anyway** charges your Bonzah balance again for the same period. **The customer's own policy** lists uploaded certificates. **Upload a certificate**, **Download the certificate** and **Retry this policy** are disabled on this stage; upload the customer's certificate from Insurances **AI Verifications**. TRAX does not buy or replace cover and cannot confirm a car is insured.
<!-- /trax -->
<!-- trax:rental_insurance:ur-Latn -->
Rental kholein aur stage rail mein **Insurance** chunein; cover lena optional hai. **Add cover** (ya policy active ho to **Re-quote and replace**) **Select Insurance Coverage** kholta hai; aakhir mein **Purchase Insurance** dabayein. Premium rental par charge ho jata hai aur screen **Payments** par chali jati hai. Agar Bonzah dastiyab na ho, make aur model covered na ho, insure karne ke din baqi na hon, ya rental mein gaari ya customer na ho to button disabled hota hai aur wajah dikhati hai. Khareedne ke baad dates badlein to banner farq batata hai aur **Re-quote and replace** ya **Keep the current policy** deta hai (yeh sirf aapke browser mein chhupata hai). **Already insured for these dates** aaye to **Issue anyway** usi muddat ke liye Bonzah balance se dobara charge karta hai. **The customer's own policy** mein upload shuda certificates hain. **Upload a certificate**, **Download the certificate** aur **Retry this policy** is stage par disabled hain; customer ka certificate Insurances ke **AI Verifications** se upload karein. TRAX cover khareedta ya replace nahi karta aur gaari insured hone ki tasdeeq nahi kar sakta.
<!-- /trax -->
