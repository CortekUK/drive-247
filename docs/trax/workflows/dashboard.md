# Dashboard

## Purpose

Prepared operator guidance for TRAX, verified against the portal source files listed below. Guidance describes existing screens only; TRAX performs none of these actions.
<!-- trax:dashboard:en -->
Open **Dashboard** for today at a glance. **New Rental**, beside the first section title, needs rentals edit permission. **On your desk** holds announcements (**Read more**, **Got it, hide this**), **Sit down with these once** feature guides and **Reminders**, where **Add a note** saves a note with an optional time. **Today** shows **Attention required now**, **Coming and going** (pickups and returns dated today for pending or active rentals, in your business timezone), **Money today** and **Everything else on today**. Vehicles not returned covers rentals up to 30 days past their end date, excluding pay-as-you-go and auto-extend; older ones count as rentals never closed off. In **How it's going**, **Who and what earns**, **Revenue and bookings** and most **Other stats** are sample figures, not your data. Card rows and footer links do not open pages yet. Managers see only items for areas they are granted. TRAX does not read or calculate these figures.
<!-- /trax -->
<!-- trax:dashboard:ur-Latn -->
**Dashboard** par aaj ka haal ek nazar mein milta hai. Pehle section title ke saath **New Rental** button hai; is ke liye rentals edit permission chahiye. **On your desk** mein announcements (**Read more**, **Got it, hide this**), **Sit down with these once** guides aur **Reminders** hain; **Add a note** se note time ke saath bhi save hota hai. **Today** mein **Attention required now**, **Coming and going** (pending ya active rentals ke aaj ke pickups aur returns, business timezone ke mutabiq), **Money today** aur **Everything else on today** hain. Vehicles not returned mein woh rentals hain jin ki end date 30 din ke andar guzri ho (pay-as-you-go aur auto-extend nahi); purani rentals never closed off mein ginti hain. **How it's going** mein **Who and what earns**, **Revenue and bookings** aur zyada tar **Other stats** sample figures hain, aap ka data nahi. Card rows aur footer links abhi page nahi kholte. Managers ko sirf granted areas ke items dikhte hain. TRAX ye figures parhta ya calculate nahi karta.
<!-- /trax -->

## Sources and tests
- `apps/portal/src/app/(dashboard)/page.tsx`
- `apps/portal/src/components/dashboard-v2/dashboard-v2.tsx`
- `apps/portal/src/components/dashboard-v2/home/home-bands.tsx`
- `apps/portal/src/components/dashboard-v2/home/mock.ts`
- `apps/portal/src/hooks/use-today-operations.ts`
- `apps/portal/src/components/dashboard-v2/checklist-card.tsx`
- `apps/portal/src/components/dashboard-v2/reminders-card.tsx`
- `apps/portal/src/components/dashboard-v2/announcement-carousel.tsx`
- `apps/portal/src/components/dashboard-v2/setup-guide.tsx`
