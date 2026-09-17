# Dashboard

## Purpose

Prepared operator guidance for TRAX, verified against the portal source files listed below. Guidance describes existing screens only; TRAX performs none of these actions.
<!-- trax:dashboard:en -->
Open **Dashboard** for today at a glance. **New Rental**, beside the first section title, needs rentals edit permission. **On your desk** starts with a card for the new features Drive247 has announced to your company, when there are any: a picture, a heading and one line, several cards taking turns. Select the card (**See how it works**) to open a short slides dialog with **Back**, **Next** and **Got it**; on the last slide an optional button opens the page where the feature lives. With no feature announced there is no card, and the other two cards take the full width. A feature dialog can also open by itself on the dashboard; there **Don't show again** stops it opening by itself, and the card stays. Next come **Sit down with these once** feature guides and **Reminders**, where **Add a note** saves a note with an optional time. **Today** shows **Attention required now**, **Coming and going** (pickups and returns dated today for pending or active rentals, in your business timezone), **Money today** and **Everything else on today**. Vehicles not returned covers rentals up to 30 days past their end date, excluding pay-as-you-go and auto-extend; older ones count as rentals never closed off. In **How it's going**, **Who and what earns**, **Revenue and bookings** and most **Other stats** are sample figures, not your data. Card rows and footer links do not open pages yet. Managers see only items for areas they are granted. TRAX does not read or calculate these figures.
<!-- /trax -->
<!-- trax:dashboard:ur-Latn -->
**Dashboard** par aaj ka haal ek nazar mein milta hai. Pehle section title ke saath **New Rental** button hai; is ke liye rentals edit permission chahiye. **On your desk** mein pehle un naye features ka card hota hai jo Drive247 ne aap ki company ke liye announce kiye hon (agar koi ho): tasveer, heading aur ek line, zyada features hon to cards baari baari aate hain. Card (**See how it works**) par click karne se slides wala chhota dialog khulta hai jis mein **Back**, **Next** aur **Got it** hain; aakhri slide par ek optional button feature ke page par le jata hai. Koi feature announce na ho to card nahi hota aur baqi do cards poori width le lete hain. Feature dialog dashboard par khud bhi khul sakta hai; wahan **Don't show again** se woh khud nahi khulega, card phir bhi rehta hai. Us ke baad **Sit down with these once** guides aur **Reminders** hain; **Add a note** se note time ke saath bhi save hota hai. **Today** mein **Attention required now**, **Coming and going** (pending ya active rentals ke aaj ke pickups aur returns, business timezone ke mutabiq), **Money today** aur **Everything else on today** hain. Vehicles not returned mein woh rentals hain jin ki end date 30 din ke andar guzri ho (pay-as-you-go aur auto-extend nahi); purani rentals never closed off mein ginti hain. **How it's going** mein **Who and what earns**, **Revenue and bookings** aur zyada tar **Other stats** sample figures hain, aap ka data nahi. Card rows aur footer links abhi page nahi kholte. Managers ko sirf granted areas ke items dikhte hain. TRAX ye figures parhta ya calculate nahi karta.
<!-- /trax -->

## Sources and tests
- `apps/portal/src/app/(dashboard)/page.tsx`
- `apps/portal/src/components/dashboard-v2/dashboard-v2.tsx`
- `apps/portal/src/components/dashboard-v2/home/home-bands.tsx`
- `apps/portal/src/components/dashboard-v2/home/mock.ts`
- `apps/portal/src/hooks/use-today-operations.ts`
- `apps/portal/src/components/dashboard-v2/checklist-card.tsx`
- `apps/portal/src/components/dashboard-v2/reminders-card.tsx`
- `apps/portal/src/components/announcements/feature-announcement-deck.tsx`
- `apps/portal/src/components/announcements/feature-announcement-dialog.tsx`
- `apps/portal/src/components/dashboard-v2/setup-guide.tsx`
