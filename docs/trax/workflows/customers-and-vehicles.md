# Customers and vehicles

## Purpose and user-facing location

Customers hold the person/business record linked to rentals. Vehicles hold fleet records and rental configuration. Open Customers or Vehicles and select a record. V2 uses separate customer and vehicle section rails; do not interpret rental workflow headings as customer detail routes. Below the width where a side column fits, a record's rails are not in the sidebar at all — the rail is the round button in the middle of the record's own dock (`components/ui-v2/record-dock.tsx`), with the context panel and the way back to the list either side of it, and the sidebar goes back to being the navigation.

## Access, prerequisites and workflow

An active staff membership and the corresponding view permission are required. Managers need customers or vehicles grants independently. Viewers cannot edit. Record IDs must be revalidated against the tenant even if they came from the current page.

A customer record connects rental history and verification information. Review requirements on the actual rental/customer screen; a displayed identity check does not independently prove every booking requirement has passed. Keep identity documents and licence values in their native, permission-controlled workflow.

The Customers list offers **Add Customer** to staff with customers edit permission. Search first, then use the existing form's actual required fields to avoid duplicate records. Do not paste identity documents or contact details into TRAX. Creation and verification are separate operations; the assistant does neither.

A vehicle record connects configuration, bookings and availability. Website publication, paused state and applicable rental-duration flags participate in public booking filtering. Editing a record can change what customers can find, so staff should review the native controls and their permissions. A vehicle's display status does not by itself decide availability for a date range.

## Variations, blockers and limits

V1 and V2 share record routes but use different contextual sections. Missing records, cross-tenant links and absent manager permissions must not produce record suggestions. Phase 1 reads only id and tenant_id to validate links; it does not fetch customer details, verification findings, rates or vehicle state.

<!-- trax:customers:en -->
Open **Customers** and search for the customer before adding a duplicate. Staff with edit permission can use **Add Customer** and complete the existing form's required fields. Select a customer to review their record and rental history. Verification belongs to the existing workflow; also check requirements on the relevant rental. The Customer stage inside a rental differs from the separate customer profile. Keep identity documents in the native workflow. TRAX can open an authorized profile but does not create customers or verify identity or account state.
<!-- /trax -->
<!-- trax:vehicle_listing:en -->
Open **Vehicles**, choose the vehicle, then **Listing** in its V2 section rail (on a phone the rail is the round button in the middle of the bar at the bottom of the record). There is no separate **Publish** action: the booking site reads the saved vehicle configuration. Listing summarizes the public information and points to the sections that own the displayed blockers. Review **Vehicle**, **Rates & mileage**, **Extras & surcharges** and **Availability** as applicable. Website visibility, pause state and enabled durations matter, alongside dates, bookings and blocks. Editing the native configuration can affect customer booking. General guidance does not mean TRAX checked your vehicle; request a live diagnosis for a specific vehicle and booking window.
<!-- /trax -->
<!-- trax:vehicle_listing:ur-Latn -->
**Vehicles** mein gaari chunein, phir V2 rail mein **Listing** kholein (phone par ye rail record ke neeche wali bar ke beech wale gol button se khulti hai). Alag **Publish** action nahi hai: booking site saved vehicle configuration parhti hai. Listing public information aur blockers ke relevant sections dikhata hai. Zaroorat ke mutabiq **Vehicle**, **Rates & mileage**, **Extras & surcharges** aur **Availability** dekhein. Visibility, pause, duration, dates, bookings aur blocks asar dalte hain. Native configuration badalne se customer booking badal sakti hai. Ye general guidance gaari ka live check nahi; specific gaari aur dates ke liye diagnosis poochein.
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
<!-- trax:vehicle_create:en -->
Open **Vehicles** and choose **Add Vehicle**; it is shown only to staff with vehicles edit permission. The **Add New Vehicle** form requires **License Plate Number**, **Make**, **Model**, **Year**, **Color**, **Fuel Type**, **Acquisition Date**, **Acquisition Type** and the **Daily**, **Weekly** and **Monthly** rent. A purchased vehicle also needs **Purchase Price**; a financed vehicle needs **Contract Total**. Upload at least one vehicle photo. Year cannot be later than the acquisition year, and inspection or registration due dates cannot be in the past. Mileage limits, **Pickup Location**, warranty, key and security details are optional; **Daily Booking**, **Weekly Booking** and **Monthly Booking** choose which durations the vehicle offers. Select **Add Vehicle** to save, then review the vehicle's **Listing** to see what the booking site will show. TRAX does not create vehicles.
<!-- /trax -->
<!-- trax:vehicle_create:ur-Latn -->
**Vehicles** kholein aur **Add Vehicle** chunein; ye sirf vehicles edit permission wale staff ko dikhta hai. **Add New Vehicle** form mein **License Plate Number**, **Make**, **Model**, **Year**, **Color**, **Fuel Type**, **Acquisition Date**, **Acquisition Type** aur **Daily**, **Weekly**, **Monthly** rent zaroori hain. Purchase gaari ke liye **Purchase Price** aur finance gaari ke liye **Contract Total** bhi zaroori hai. Kam az kam ek photo upload karein. Year acquisition year se baad ka nahi ho sakta, aur inspection ya registration due date guzri hui nahi ho sakti. Mileage, **Pickup Location**, warranty, key aur security details optional hain; **Daily Booking**, **Weekly Booking** aur **Monthly Booking** se durations chunein. Save ke liye **Add Vehicle** dabayein, phir gaari ki **Listing** dekhein ke booking site kya dikhayegi. TRAX khud gaari add nahi karta.
<!-- /trax -->
<!-- trax:customer_documents:en -->
Customer files are on the customer record: open **Customers**, select the customer, then **Documents** in the section rail (on a phone the rail is the round button in the middle of the bar at the bottom of the record). Staff with customers edit permission see **Add document**, which opens **Add Document**. **Document Type** and **Document Name** are required; **Vehicle (Optional)**, **Upload File (Optional)** and **Notes** are optional. **Insurance Certificate** adds **Insurance Provider** and **Policy Number** and labels the dates **Policy Start Date** and **Policy End Date**; the start date cannot be in the future. Select **Add Document** to save. Each file shows its scan result and expiry. Use **Download**, the pencil to edit, or the bin to remove the file at once, with no confirmation. When the scanner flags a file, editors can choose **Accept anyway**. Licence photos and selfies from the verification provider stay on **Verification** and cannot be replaced here. TRAX does not upload, accept or delete documents, and identity documents should not be pasted into TRAX.
<!-- /trax -->
<!-- trax:customer_documents:ur-Latn -->
Customer ki files customer record par hain: **Customers** kholein, customer chunein, phir section rail mein **Documents** (phone par ye rail record ke neeche wali bar ke beech wale gol button se khulti hai). Customers edit permission wale staff ko **Add document** dikhta hai jo **Add Document** kholta hai. **Document Type** aur **Document Name** zaroori hain; **Vehicle (Optional)**, **Upload File (Optional)** aur **Notes** optional hain. **Insurance Certificate** chunne par **Insurance Provider** aur **Policy Number** aate hain aur dates **Policy Start Date** aur **Policy End Date** ban jati hain; start date aane wali tareekh nahi ho sakti. Save ke liye **Add Document** dabayein. Har file ka scan result aur expiry dikhta hai. **Download**, edit ke liye pencil, ya file hatane ke liye bin use karein; bin foran hata deta hai, koi confirmation nahi. Scanner file flag kare to editors **Accept anyway** chun sakte hain. Verification provider ki licence photos aur selfie **Verification** par rehti hain aur yahan replace nahi hotin. TRAX documents upload, accept ya delete nahi karta, aur identity documents TRAX mein paste na karein.
<!-- /trax -->
<!-- trax:vehicle_pause:en -->
Open **Vehicles**, select the car, then **Availability** in its section rail (on a phone the rail is the round button in the middle of the bar at the bottom of the record). The top of the panel says **Bookable** or **Not bookable** and lists what is in the way, such as **Paused**, **No hire length is switched on** or **Retired from the fleet**. In **Pause**, type a reason (it is kept on the record) and select **Pause**; this takes the car off the booking site without deleting anything, and rentals already under way carry on. A paused car shows **Paused** with its reason and date; select **Resume** to put it back. **Blocked periods** are dates the car is unavailable while it stays on the booking site: add one with a start date, end date and reason, and use **Unblock** to remove it. Staff without vehicles edit permission see these controls read-only. Hiding a car only from your website is a different switch in the Website section. TRAX does not pause, resume or block vehicles.
<!-- /trax -->
<!-- trax:vehicle_pause:ur-Latn -->
**Vehicles** kholein, gaari chunein, phir section rail mein **Availability** kholein (phone par ye rail record ke neeche wali bar ke beech wale gol button se khulti hai). Panel ke upar **Bookable** ya **Not bookable** likha hota hai aur rukawat ki wajah dikhti hai, jaise **Paused**, **No hire length is switched on** ya **Retired from the fleet**. **Pause** mein wajah likhein (record par mehfooz rehti hai) aur **Pause** dabayein; is se gaari booking site se hat jati hai, kuch delete nahi hota, aur jo rentals chal rahe hain woh jari rehte hain. Paused gaari par **Paused**, wajah aur date dikhti hai; wapas lane ke liye **Resume** dabayein. **Blocked periods** woh dates hain jab gaari booking site par rehte hue bhi dastiyab nahi hoti: start date, end date aur wajah ke saath period add karein, aur hatane ke liye **Unblock** use karein. Vehicles edit permission ke baghair staff ko ye controls sirf dekhne ke liye milte hain. Gaari sirf website se chhupana alag switch hai jo Website section mein hai. TRAX gaari pause, resume ya block nahi karta.
<!-- /trax -->

## Sources and tests

- `apps/portal/src/components/customers-v2/customer-detail/sections.ts`: customer section navigation.
- `apps/portal/src/components/vehicles-v2/sections.ts`: vehicle section navigation.
- `apps/portal/src/components/vehicles-v2/tab-listing.tsx`: ListingTab, links to owning sections; no publish snapshot.
- `apps/portal/src/app/(dashboard)/customers/page.tsx`: handleAddCustomer and customers edit gate.
- `apps/portal/src/components/rentals-v2/rental-detail/use-rental-detail-v2.ts`: tenant-scoped rental relationships.
- `apps/booking/src/app/booking/vehicles/page.tsx`: publication and booking filters.
- `apps/portal/src/hooks/use-manager-permissions.ts`: view/edit distinctions.
- `apps/portal/src/__tests__/lib/trax-support.test.ts`: entity ownership and denied links.
- Full verification/provider and customer-state transitions: **requiring confirmation**, not included in runtime knowledge.
- `apps/portal/src/components/customers-v2/customer-detail/section-documents.tsx`
- `apps/portal/src/components/customers/add-customer-document-dialog.tsx`
- `apps/portal/src/client-schemas/customers/add-customer-document.ts`
- `apps/portal/src/app/(dashboard)/documents/page.tsx`
- `apps/portal/src/components/vehicles-v2/tab-availability.tsx`
- `apps/portal/src/components/vehicles-v2/vehicle-detail-v2.tsx`
