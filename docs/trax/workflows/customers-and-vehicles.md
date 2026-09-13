# Customers and vehicles

## Purpose and user-facing location

Customers hold the person/business record linked to rentals. Vehicles hold fleet records and rental configuration. Open Customers or Vehicles and select a record. V2 uses separate customer and vehicle section rails; do not interpret rental workflow headings as customer detail routes.

## Access, prerequisites and workflow

An active staff membership and the corresponding view permission are required. Managers need customers or vehicles grants independently. Viewers cannot edit. Record IDs must be revalidated against the tenant even if they came from the current page.

A customer record connects rental history and verification information. Review requirements on the actual rental/customer screen; a displayed identity check does not independently prove every booking requirement has passed. Keep identity documents and licence values in their native, permission-controlled workflow.

A vehicle record connects configuration, bookings and availability. Website publication, paused state and applicable rental-duration flags participate in public booking filtering. Editing a record can change what customers can find, so staff should review the native controls and their permissions. A vehicle's display status does not by itself decide availability for a date range.

## Variations, blockers and limits

V1 and V2 share record routes but use different contextual sections. Missing records, cross-tenant links and absent manager permissions must not produce record suggestions. Phase 1 reads only id and tenant_id to validate links; it does not fetch customer details, verification findings, rates or vehicle state.

<!-- trax:customers:en -->
Open **Customers** and select the customer to review their record and associated rental history. Verification information belongs to that customer's existing workflow; check the requirements shown on the relevant rental as well. The Customer stage inside a rental is different from the separate customer profile. TRAX can open an authorized profile, but this guidance does not verify anyone's identity or account state.
<!-- /trax -->
<!-- trax:customers:ur-Latn -->
**Customers** kholein aur customer select karke unka record aur rental history dekhein. Verification us customer ke existing workflow mein hoti hai; relevant rental ki requirements bhi dekhein. Rental ke andar Customer stage aur alag customer profile mukhtalif hain. TRAX authorized profile khol sakta hai, lekin ye guidance kisi ki identity ya account state verify nahi karti.
<!-- /trax -->
<!-- trax:vehicles:en -->
Open **Vehicles** and select the vehicle. Review its configuration and booking history in the existing record. Website visibility, pause state and enabled rental durations affect customer booking, while actual availability also depends on dates and other records. Use the native edit controls only if your role permits changes.
<!-- /trax -->
<!-- trax:vehicles:ur-Latn -->
**Vehicles** kholein aur gaari select karein. Existing record mein configuration aur booking history dekhein. Website visibility, pause state aur enabled rental durations customer booking par asar dalte hain; asal availability dates aur doosre records par bhi depend karti hai. Native edit controls sirf apni role ki ijazat ke mutabiq use karein.
<!-- /trax -->

## Sources and tests

- `apps/portal/src/components/customers-v2/customer-detail/sections.ts`: customer section navigation.
- `apps/portal/src/components/vehicles-v2/sections.ts`: vehicle section navigation.
- `apps/portal/src/components/rentals-v2/rental-detail/use-rental-detail-v2.ts`: tenant-scoped rental relationships.
- `apps/booking/src/app/booking/vehicles/page.tsx`: publication and booking filters.
- `apps/portal/src/hooks/use-manager-permissions.ts`: view/edit distinctions.
- `apps/portal/src/__tests__/lib/trax-support.test.ts`: entity ownership and denied links.
- Full verification/provider and customer-state transitions: **requiring confirmation**, not included in runtime knowledge.

