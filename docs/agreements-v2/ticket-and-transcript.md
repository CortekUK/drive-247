# Agreements v2: ticket and transcript (as given by the team lead, Sep 21 2026)

Video: "Agreements v2: templates, the half-and-half editor, and sending agreements" (22:57).
The transcript has gaps. Timestamps point to the video.

## Ticket items
- Agreements tab: Use the existing Agreements tab. Agreement templates live there, not in Settings. (00:21, 00:49)
- Not just BoldSign: An agreement doesn't have to mean BoldSign. Keep it simple. (02:23)
- Two kinds: Individual agreements (not linked to a rental) are sent straight from this tab. Rental agreements go out from the rental flow. Both must work. (02:52, 05:06)
- Create template card: A card with a catchy name, like "Create your template", to start a new template. (04:00)
- Browse templates: Show every template in one section, searchable by name, with a proper empty state. No "Shared with me / Created by me". (06:46)
- Editor: Half and half: editing on one side, a proper preview of the agreement on the other. (03:50)
- Side panel: The editor's panel slides out over the preview instead of taking up space. (09:56)
- Branding: Use each tenant's existing branding in the agreement. (08:24)
- Signature fields: Drag and drop where the signature goes, like BoldSign. Support initials too. (10:18, 12:18)
- Operator's signature: Keep the operator's own signature here. They can upload it or draw it, then "Save and use". (10:35, 11:54)
- Variables: Each variable has a tooltip with a short description and an example of what it turns into. (12:45)
- Send dialog: Send agreement opens a dialog: recipient name and email, CC (multiple emails), an optional message, then pick a template or create a new one, then preview, with an Edit button. (07:59, 15:22)
- Document title: A default title that the operator can edit. (08:05)
- Message: Work out what happens to the message when the agreement isn't going by email. (08:12)
- One-off edits: Editing while sending changes only this agreement, never the template. "Create new" from the dialog opens the editor and sends on the spot without saving a new template. (15:58, 16:37)
- Overview: Show total agreements, how many are signed, the recently signed ones, and the failed ones. (13:12)
- Graphs: Meaningful graphs, not necessarily line graphs, covering about 75% of that area. (15:02)
- List columns: Customer, customer email, sent date (with AM/PM), and status: Signed, Pending signature or Failed. Status replaces the separate signed column. Remove columns that aren't used. (17:08)
- Signed document: Show the agreement that was sent instead of "No document". After signing, the signed version can be downloaded. (17:51, 18:10)
- Resend: Add a resend option. (18:15)
- Filters: Proper filters like the Rentals list: customer, date range, and every column, so anything can be found. (18:26)
- Rental flow: Inside a rental's Agreements area, show the current terms. Edit opens the same half-and-half editor. (20:37)

## Notes
- The two things to get genuinely right are the editor and the preview. (22:18)
- Think carefully about individual versus rental-linked agreements. (22:12)
- Keep everything else minimal; don't overbuild. (07:55)
- Rental flow edits: Ghulam says an Edit there changes the template for this tenant only, which is different from the send dialog, where edits never touch the template. Confirm with Ghulam before building it. (21:44) — Haseeb, Sep 21: "yes, implement that".
- Unclear in the transcript: 04:22 and 14:38 ("here we will put an extension"). Watch the video there.
- v2 only: northwind gets it, and every other tenant keeps the current Agreements.

## Transcript key passages (English gist of the Hindi/Urdu, with timestamps)
- 00:21–01:12 Templates were going to be in Settings as "agreement templates", but instead use the Agreements tab we already have. They were part of settings; they should be there (the tab).
- 01:58 Same approach as the other tabs: one graph and one card.
- 02:23–02:59 "Agreement" doesn't necessarily mean BoldSign; keep it simple. Agreements must work independently AND via rental (the ones we already send).
- 03:05–04:11 A "generate agreement" and a template button/card. Pressing the card opens a proper template setup. The editing part on one side, the other side a proper preview. Card name catchy, like "Create your template".
- 04:22–04:43 A 100vw view: 50vw for creating the template, the rest preview. The preview must be very good — "we've suffered a lot in v1 on this, quality must be very high".
- 04:56–05:45 BoldSign has its own platform. Two kinds: individual (not related to a rental) sent straight from this tab; and rental-specific ones going through the whole rental flow.
- 06:06–07:13 Button words: "Send agreement". Then a flow. No "create new document / new bulk". A "browse templates" section — multiple templates, all shown; search e.g. "Ghulam" shows that template; an empty state like theirs; no "shared with me / created by me" (all are created by me). Search by template name, select a template.
- 07:27–07:59 Recipient name and email — only these two. One recipient. We can add multiple emails — that's the CC. No email/SMS choice. Nothing else — it would be too much.
- 08:05 Document title: a default, and he can edit it.
- 08:12 The message: what happens when it doesn't go by email.
- 08:24 Branding — every tenant has its own branding, which we've already configured. We have no "tags" system.
- 09:33–10:08 The editor: not like BoldSign's PDF editor — we follow our half-and-half. A panel comes out like this, on the preview area; it comes over it and doesn't take up space.
- 10:18–10:35 Give a place for the signature like BoldSign — it lets you drop the place. I'll drop it here. Drop my own signature.
- 10:55–11:16 We'll keep: signature, initial, and date signed. Nothing else. All our variables will be here too — proper variables; we have the whole space since we're previewing here.
- 11:37–12:08 I'll drop the signature like this. And my own signature — we'll maintain that here too: he'll upload his signature; draw option too (not hard); upload or draw; "Save and use".
- 12:14–12:18 "We will do detailing to this extent. Agreements are very important for us." Also keep initials.
- 12:29–12:58 The thing that can do a lot of damage is our variables. Every variable must have a tooltip: a little description of the variable, and an example of what it comes out as. Otherwise people don't understand.
- 13:12–14:31 Total agreements; how many signed; the recently signed ones; the failed ones too.
- 14:38 "Here we will put an extension." (unclear)
- 15:02–15:18 A graph telling meaningful things — not necessarily a line graph, other types — the same 75% covered by graphs. And here (the card) a template.
- 15:22–16:09 Flow again: Send agreement → dialog: recipient name + email, CC, any message → select template → either select a template or create new. Create new opens the half-and-half editor; I change it on the spot; that template is NOT created new; I can send it on the spot.
- 16:10–16:55 Selected a template → preview; if I don't like something, Edit. While editing, the template is NEVER edited — only this specific thing I'm sending, only for this case.
- 17:08–17:51 List: customer; the agreement; customer's email; date (better, with AM/PM); status — the "signed" column is covered by status: Signed / Pending signature / Failed. "This column isn't being used" — remove.
- 17:51–18:15 Instead of "No document", the agreement I sent. After signing, download the signed/updated version.
- 18:15–18:26 Resend — resend does nothing special: a duplicate agreement goes out; another row is made here.
- 18:43–19:27 Proper filter, like inside rentals: by customer, every possible date range, every column — a dedicated section so they can find things comprehensively.
- 19:43–20:17 Among multiple templates, one is the DEFAULT template; mention properly that whatever your default template is, when you send from a rental, the default template goes.
- 20:37–21:32 Rental flow: inside the rental's Agreements: "The terms as they stand now" — (what is this mess) — here it will say "Selected template". By default the default template is selected; tell him "click here to change": all templates open; pick any; it gets selected here. Next to it a Preview button — preview shows in a dialog. An Edit button opens the same half-and-half editor.
- 21:44–21:54 Editing there activates only for this particular tenant — the template is edited. He can make whatever templates he wants.
- 22:12–22:27 Think about individual vs rental-associated agreements. The thing to genuinely nail: the editor and preview experience — all the templating.
- 22:35–22:50 "Should we build a separate system from BoldSign for sending? No need — an agreement is sent under some authority."
