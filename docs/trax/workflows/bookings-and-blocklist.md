# Blocked customers, Pending bookings

## Purpose

Prepared operator guidance for TRAX, verified against the portal source files listed below. Guidance describes existing screens only; TRAX performs none of these actions.
<!-- trax:pending_bookings:en -->
Open **Pending Bookings**; it appears under **Bookings** in the sidebar only when the account payment mode is manual. It lists website bookings whose card payment is on hold, with **Customer**, **Vehicle**, **Dates**, **Amount**, **Verification** and **Expiry** (time left on the hold). **Approve** and **Reject** appear only for staff with pending bookings edit permission. In **Approve Booking**, **Approve & Capture Payment** charges the held payment and sets the rental Active and the vehicle Rented; it is refused if another pending or active rental overlaps that vehicle's dates. In **Reject Booking**, **Rejection Reason (optional)** is saved with the payment, and **Reject & Release Hold** releases the hold, cancels the rental and its unpaid charges and sets the vehicle Available. If the hold cannot be released, nothing is changed. Use **Refresh** to reload. Bookings paid through the website checkout that captures immediately do not appear here. TRAX does not approve, reject, capture or release bookings or payments.
<!-- /trax -->
<!-- trax:pending_bookings:ur-Latn -->
**Pending Bookings** kholein; ye sidebar mein **Bookings** ke neeche sirf tab nazar aata hai jab account ka payment mode manual ho. Is list mein woh website bookings hain jin ki card payment hold par hai, saath **Customer**, **Vehicle**, **Dates**, **Amount**, **Verification** aur **Expiry** (hold ka baqi waqt). **Approve** aur **Reject** sirf pending bookings edit permission wale staff ko dikhte hain. **Approve Booking** mein **Approve & Capture Payment** held payment charge karta hai aur rental Active aur gaari Rented kar deta hai; agar usi gaari ki dates par koi aur pending ya active rental overlap ho to approval nahi hota. **Reject Booking** mein **Rejection Reason (optional)** payment ke saath save hota hai, aur **Reject & Release Hold** hold chhor deta hai, rental aur us ke unpaid charges cancel karta hai aur gaari Available kar deta hai. Agar hold release na ho sake to kuch change nahi hota. List dobara load karne ke liye **Refresh** dabayein. Jo website bookings checkout par foran charge ho jati hain woh yahan nahi aatin. TRAX bookings ya payments approve, reject, capture ya release nahi karta.
<!-- /trax -->
<!-- trax:blocked_customers:en -->
Open **Customers** and select **Blocked** to see **Blocked Customers**; the button needs blocked customers view permission. Blocked people are left out of the main customer list. The **Blocked Customers** tab offers **View** and **Unblock**; unblocking lets the person make new rentals again and deactivates blocklist entries for their licence and ID numbers. The **Blocked Identities** tab lists blocklisted numbers with **Remove**. Staff with blocked customers edit permission can choose **Add to Blocklist**: **Identity Type**, **Identity Number** and **Reason** are required, **Customer Name** and **Notes (optional)** are not. New customers or identity verifications with that identity will be blocked, and a licence or ID card entry also blocks existing customers with the same number. To block one person, open their record, go to **Account** and turn on **Block this customer with us** (customers edit permission); this also blocklists their licence and ID numbers. TRAX does not block, unblock or verify anyone.
<!-- /trax -->
<!-- trax:blocked_customers:ur-Latn -->
**Customers** kholein aur **Blocked** dabayein to **Blocked Customers** khulega; is button ke liye blocked customers ki view permission chahiye. Blocked log main customer list mein nahi dikhte. **Blocked Customers** tab mein **View** aur **Unblock** hain; unblock karne se woh dobara naye rentals le sakte hain aur un ke licence aur ID numbers ki blocklist entries inactive ho jati hain. **Blocked Identities** tab mein blocklisted numbers aur **Remove** hai. Blocked customers edit permission wale staff **Add to Blocklist** chun sakte hain: **Identity Type**, **Identity Number** aur **Reason** zaroori hain, **Customer Name** aur **Notes (optional)** zaroori nahi. Is identity wale naye customers ya identity verifications block honge, aur licence ya ID card entry usi number wale mojooda customers ko bhi block kar deti hai. Kisi ek shakhs ko block karne ke liye us ka record kholein, **Account** mein jayein aur **Block this customer with us** on karein (customers edit permission); is se un ke licence aur ID numbers bhi blocklist ho jate hain. TRAX kisi ko block, unblock ya verify nahi karta.
<!-- /trax -->

## Sources and tests
- `apps/portal/src/app/(dashboard)/pending-bookings/page.tsx`
- `apps/portal/src/hooks/use-booking-approval.ts`
- `supabase/functions/capture-booking-payment/index.ts`
- `apps/portal/src/components/shared/layout/app-sidebar-v2.tsx`
- `apps/portal/src/app/(dashboard)/blocked-customers/page.tsx`
- `apps/portal/src/components/customers-v2/customer-detail/section-account.tsx`
- `apps/portal/src/components/customers-v2/customer-detail/sections.ts`
- `apps/portal/src/hooks/use-customer-blocking.ts`
