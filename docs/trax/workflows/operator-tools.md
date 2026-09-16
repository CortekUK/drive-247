# Messages, reminders and website content

## Purpose, location and permissions

Messages connects staff with customer conversations. Reminders tracks follow-up work linked to records. Website Content manages public pages. Managers need the respective messages, reminders or cms grant; edit controls remain governed by the native workflow. Reminders is hidden for lean tenants through isAreaHidden. Website Content is shown as the Website area in V2.

## Workflows, states and side effects

Messages uses tenant/customer channels and separate customer-facing authentication. Open the relevant conversation in Messages; TRAX does not send messages or inspect their contents. Message delivery, consent and channel permissions remain outside this verified guidance scope.

The reminders list defaults to pending, sent and snoozed reminders. Its filters can include done, dismissed and expired. A reminder belongs to a related object and carries due/remind dates. Use the normal reminder UI to create or update one. The old TRAX create_reminder action is not in Phase 1's tool allowlist; reminder functionality elsewhere is unchanged.

Website pages are loaded from cms_pages. Publishing snapshots sections in cms_page_versions and marks the page published; unpublishing marks it draft. These changes affect the public site. TRAX only explains navigation; it does not publish, revert or edit content.

## Blockers and tenant variations

A missing grant or lean-area gate can remove a navigation action. A route existing does not prove the tenant has the feature. Realtime delivery errors are not proof a message was delivered; a CMS query error is not a published page. Provider-specific communication setup and the full CMS publishing workflow need further end-to-end verification.

<!-- trax:messages:en -->
Open **Messages** and choose the relevant customer conversation. Use the existing messaging controls for anything you intend to send. TRAX's application guidance does not read those conversations, send messages or confirm delivery.
<!-- /trax -->
<!-- trax:messages:ur-Latn -->
**Messages** kholein aur relevant customer conversation select karein. Jo message bhejna ho us ke liye existing messaging controls use karein. TRAX ki application guidance conversations nahi parhti, message nahi bhejti aur delivery confirm nahi karti.
<!-- /trax -->
<!-- trax:reminders:en -->
Where Reminders is enabled, open **Reminders** to review follow-ups. The default list shows pending, sent and snoozed items; filters let you review other states. Use the existing reminder form for its related record and dates. TRAX cannot create, complete or snooze reminders in this phase.
<!-- /trax -->
<!-- trax:reminders:ur-Latn -->
Jahan Reminders enabled hai, follow-ups ke liye **Reminders** kholein. Default list pending, sent aur snoozed items dikhati hai; filters se doosri states dekhi ja sakti hain. Related record aur dates ke liye existing reminder form use karein. Is phase mein TRAX reminders create, complete ya snooze nahi karta.
<!-- /trax -->
<!-- trax:website:en -->
Open **Website Content** (the **Website** area in V2) and choose the page you want to review. Publishing and unpublishing affect the customer-facing site, so use the existing preview and publishing workflow with the required permissions. TRAX does not edit or publish website content.
<!-- /trax -->
<!-- trax:website:ur-Latn -->
**Website Content** (V2 mein **Website** area) kholein aur page select karein. Publish aur unpublish karne se customer-facing site badalti hai; required permissions ke saath existing preview aur publishing workflow use karein. TRAX website content edit ya publish nahi karta.
<!-- /trax -->
<!-- trax:website_business_details:en -->
Business phone, email and address for your website are edited in the Website section, not in Settings. Switch the sidebar to **Website**, then choose **Site Settings**. In **Business details**, edit **Phone**, **Phone as shown**, **Email**, **Address line 1**, **Address line 2**, **City**, **State**, **ZIP**, **Country** and **Google Maps link**. Empty fields fall back to your business record. The same screen also holds **Logo**, **Footer** and **Social links**. **Business details** has no Save button; changes are written as you type. The Contact page keeps only notes such as **Phone hours**, **Reply time** and **WhatsApp**, and takes phone, email and address from Site settings. Editing needs Website Content edit permission; without it the editor is read-only. TRAX does not edit website details.
<!-- /trax -->
<!-- trax:website_business_details:ur-Latn -->
Website ke liye business phone, email aur address Settings mein nahi, Website section mein badalte hain. Sidebar ko **Website** par switch karein, phir **Site Settings** chunein. **Business details** mein **Phone**, **Phone as shown**, **Email**, **Address line 1**, **Address line 2**, **City**, **State**, **ZIP**, **Country** aur **Google Maps link** edit karein. Khali fields aap ke business record se value leti hain. Isi screen par **Logo**, **Footer** aur **Social links** bhi hain. **Business details** mein Save button nahi; likhte hi changes save hote hain. Contact page par sirf **Phone hours**, **Reply time** aur **WhatsApp** jaise notes hain; phone, email aur address Site settings se aate hain. Edit ke liye Website Content edit permission chahiye, warna editor read-only hai. TRAX website details edit nahi karta.
<!-- /trax -->
<!-- trax:website_vehicle_visibility:en -->
To show or hide a car on your website without taking it off the road, switch the sidebar to **Website**, open your **Fleet** page and scroll to **Vehicles on your website**. Each car shows **Visible** or **Hidden** with a switch; turning it off takes the car off your website only, and the line above the list counts how many cars are shown. A hidden car still appears everywhere in the portal and can still be rented, blocked and serviced; it is not paused or deleted. Changing the switch needs Website Content edit permission, and if the change cannot be saved an error appears. Being visible is not enough on its own: the car must also be unpaused and have at least one hire length switched on to be bookable, which you check in the car's **Availability** section. TRAX does not change website visibility.
<!-- /trax -->
<!-- trax:website_vehicle_visibility:ur-Latn -->
Gaari ko road se hataye baghair website par dikhane ya chhupane ke liye sidebar ko **Website** par switch karein, apna **Fleet** page kholein aur neeche **Vehicles on your website** tak jayein. Har gaari ke saath **Visible** ya **Hidden** aur ek switch hota hai; switch off karne se gaari sirf website se hat jati hai, aur list ke upar wali line batati hai ke kitni gaariyan dikh rahi hain. Chhupi hui gaari portal mein har jagah nazar aati hai aur us par rental, block aur servicing jari reh sakti hai; woh pause ya delete nahi hoti. Switch badalne ke liye Website Content edit permission chahiye, aur change save na ho to error aata hai. Sirf visible hona kaafi nahi: bookable hone ke liye gaari unpaused ho aur kam az kam ek hire length on ho, jo gaari ke **Availability** section mein dekhein. TRAX website visibility nahi badalta.
<!-- /trax -->

## Sources and tests

- `apps/portal/src/hooks/use-chat-channels.ts`: tenant conversation queries.
- `apps/portal/src/hooks/use-reminders.ts`: useReminders and object filters.
- `apps/portal/src/hooks/use-cms-pages.ts`: publication and version snapshots.
- `apps/portal/src/lib/lean-areas.ts`: hidden areas.
- `apps/portal/src/__tests__/lib/trax-support.test.ts`: disabled features, no business writes.
- `apps/portal/src/components/cms-v2/cms-spec.ts`
- `apps/portal/src/app/(dashboard)/cms/site-settings/page.tsx`
- `apps/portal/src/components/cms-v2/cms-page-editor.tsx`
- `apps/portal/src/components/cms-v2/website-vehicles-panel.tsx`
- `apps/portal/src/hooks/use-website-vehicles.ts`
- `apps/portal/src/app/(dashboard)/cms/fleet/page.tsx`
