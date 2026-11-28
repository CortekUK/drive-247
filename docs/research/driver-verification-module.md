# Research: driver verification module

| | |
|---|---|
| Status | Research. Nothing here is built or decided unless it says "decided". |
| Owner | Ghulam. Haris builds it. |
| Started | 26 Nov 2026 |
| Last updated | 28 Nov 2026 (decisions added in section 6a) |
| Prices | Published list prices, read on 26 to 28 Nov 2026. Check again before signing anything. |

## 1. The question

Haris is building a full driver verification module in Drive247. This research answers four things:

1. What do we check today?
2. What is the full list of checks a rental company needs?
3. Who should do each check (Drive247 itself or a provider), and what does it cost?
4. What could Drive247 do that other rental software does not?

## 2. What Drive247 does today

The renter gets a link, photographs the licence, and takes a selfie.

| Step | How it works today |
|---|---|
| Reading the licence | An AI model reads the photo (GPT-4o). |
| Face match | AWS Rekognition compares the selfie with the licence photo. 90 or more passes, 70 to 89 asks for a retry, under 70 fails. |
| Expiry date | Checked for secondary drivers only, and only against today's date. |
| Name match | Checked for secondary drivers only. |
| Blocked list | By document only (`blocked_identities`), not by face. |
| Own car insurance | Modives, already built (`cmd-create-verification`). |
| Real or fake licence | Not checked. |
| Live person (not a photo of a photo) | Not checked. |
| Age | Not checked. |
| Licence active with the state | Not checked. |

Code: `create-ai-verification-session`, `process-ai-verification`, `ai-document-ocr`, `ai-face-match`, `customer-start-verification`, `send-verification-link-v2`. Results are kept in `identity_verifications`.

Production, last 90 days (read on 27 Nov 2026):

| Result | Count |
|---|---|
| Passed | 330 |
| Failed | 13 |
| Asked to retry | 5 |
| Never finished | 189 |

About one in three people who start never finish. That is the biggest problem today.

Two more problems found:

- ID photos and selfies sit in a storage bucket that is open to the public (`customer-documents`). This must be closed in round 1.
- Only the licence number and date of birth are saved on the customer. Address, state, expiry and licence type are read and then thrown away.

## 3. Every feature, in one table

Rows 1 to 14 are the checks from Haris's research. Rows 15 to 23 are features that would put Drive247 ahead of other rental software.

| Round | Meaning |
|---|---|
| Round 1 | Build now |
| Round 2 | After a provider is chosen |
| Round 3 | Optional, the rental company switches it on and pays |
| USP | Ahead of the market |

### Must have: every renter

| # | Feature | What it is | Who does it | Cost per renter | Drive247 today | Other rental software | When |
|---|---|---|---|---|---|---|---|
| 1 | Real licence | Genuine, not edited or fake. Barcode and tampering checks. | Identity provider | Inside the base check | No | Yes, through their provider | Round 1 |
| 2 | Not expired, through the return date | Valid for the whole rental, and checked again on an extension. | Provider reads the date. Drive247 compares it. | $0 extra | Secondary drivers only, today's date only | Turo asks hosts to check by hand | Round 1 |
| 3 | Face match | The selfie is the person on the licence. | Identity provider (today: Drive247's own) | Inside the base check | Yes | Yes, standard | Round 1 |
| 4 | Live person | A real person, not a photo of a photo or a screen. | Identity provider | Inside the base check | No | Yes, through their provider | Round 1 |
| 5 | Old enough | Meets the company's minimum age. A young-driver fee is added by itself. | Drive247 (new setting per company) | $0 | No | Not seen as automatic | Round 1 |
| 6 | Name matches the booking | The name on the licence is the name on the booking. | Drive247 | $0 | Secondary drivers only | Turo asks hosts to check by hand | Round 1 |
| 7 | Save the details | Name, date of birth, licence number, state, expiry and address go onto the customer. | Provider reads. Drive247 saves. | $0 extra | Licence number and date of birth only | Yes, common | Round 1 |

### Recommended: stops most fraud and bad drivers

| # | Feature | What it is | Who does it | Cost per renter | Drive247 today | Other rental software | When |
|---|---|---|---|---|---|---|---|
| 8 | Licence active with the state | Not suspended, revoked or cancelled. | Open: Checkr Trust, RentID or the identity provider's DMV check | RentID $2.99 a credit plus a state fee. Others not published. | No | Rent Centric says real-time verification; Turo reported to check | Round 2 |
| 9 | Right type of licence | A full car licence, not a learner's permit or provisional. | Provider reads the type. Drive247 decides. | $0 extra | No | Turo asks hosts to check by hand | Round 1 |
| 10 | Blocked or repeat person | This face or licence was used under another name, or is on the company's blocked list. | Provider's face search and blocklist, plus Drive247's list | Free inside the check (Didit) | By document only, not by face | Some offer a blacklist | Round 1 |

### Optional: the company switches it on and pays per check

| # | Feature | What it is | Who does it | Cost per renter | Drive247 today | Other rental software | When |
|---|---|---|---|---|---|---|---|
| 11 | Driving record | Points, DUIs, accidents, past suspensions. | Checkr Trust or RentID | About $12 to $30 a report, plus a state fee of about $2 to $25 | No | Turo reported to review it | Round 3 |
| 12 | Criminal record | Any criminal history. | Checkr Trust or RentID | Not published | No | Rare | Round 3 |
| 13 | Renter's own insurance | An active car insurance policy. | Modives, already built | Already in place | Yes | Fleetwire, through Axle | Fit it into the module |
| 14 | Foreign renters | A passport or a foreign licence in place of a US licence. | Identity provider | Same as the base check | Read and face match only | Depends on their provider | Round 1 |

### USP: what would put Drive247 ahead

| # | Feature | What it is | Who does it | Cost per renter | Drive247 today | Other rental software | When |
|---|---|---|---|---|---|---|---|
| 15 | A check people finish | No QR code when already on a phone, resume where they stopped, reminders, live progress for the company. | Drive247 | $0 | One in three never finish | Everyone has drop-off; nobody sells completion | USP first |
| 16 | The key only opens for the verified face | At pickup, a fresh selfie at the car's location is matched to the verified person. Only then is the lockbox code shown. | Drive247 lockbox, plus a face match | About $0.05 to $0.15 a pickup | Lockbox exists; no check at pickup | None found. One patent describes it. | USP second |
| 17 | Dispute pack and police pack | One click builds the evidence: verified ID, selfie, signed agreement, device, handover photos, card name match. For a chargeback or a stolen car. | Drive247, with Stripe | $0 | No | None found bundling it | USP third |
| 18 | Risk score that sets the deposit | One score from the ID result, phone and email age, device, card and booking pattern. Trax explains it. A riskier renter is asked for a bigger deposit by itself. | Drive247, with signals from the provider and Stripe | About $0.03 to $0.10 | No | Fraud tools score; none tie it to the deposit | USP fourth |
| 19 | Licence watch during the rental | For weekly, monthly and rideshare rentals: a suspension mid-rental alerts the company and blocks an extension. | A monitoring provider (SambaSafety, Embark, Checkr) | $1.50 to $3.75 per driver a month | No | Truck fleets have it; rental software does not | USP |
| 20 | Rideshare driver proof | The renter connects their Uber or Lyft account to prove they are an active driver, with rating and trips. | Argyle or similar | Not published | Proof photos uploaded by hand | Lenders use it; rental software does not | USP |
| 21 | Wallet ID, one tap | The digital licence in Apple or Google Wallet. Signed by the state, so it cannot be edited. Takes seconds. | Apple and Google, through a provider | Not published | No | Turo reported to be piloting. About 20 states. | USP, hard |
| 22 | Verified once, rent anywhere on Drive247 | A renter verified at one company is recognised at the next, with their consent, and books in seconds. | Drive247 network | $0 for the second company | No | None found | USP, long term |
| 23 | Drive247 network shield | A licence, face, phone, card or device that stole a car, charged back or failed at one company raises a flag at every other. | Drive247 network | $0 | No | None across companies. Big brands share only inside their own group. | USP, long term, needs a lawyer |

"None found" means not seen on the public pages that could be read. It is not proof that nobody does it.

## 4. The story: from adding a customer to getting the car back

How it would work for one renter. The names, prices and numbers are examples. Numbers in brackets point to rows in the table above.

| # | Step | Who | What they see |
|---|---|---|---|
| 1 | You add the customer | Staff, in the portal | The usual add-customer dialog. Its last screen is new: "Save without verifying" or "Next: verify". |
| 2 | You choose the checks | Staff | The standard check is always on and included. Paid extras show their price before you tick them: licence active with the state, driving record, criminal record. A running total for this renter. [1 to 14] |
| 3 | You send it | Staff | Text him, email, copy link, or show a code to scan if he is at the desk. The link works for 24 hours and he can stop and carry on later. [15] |
| 4 | The renter verifies on a phone | Renter | Three short steps, about a minute: front of the licence, back, a short selfie. Where the state offers it, one tap with the licence in the phone's wallet. [1, 3, 4, 21] |
| 5 | You watch it happen | Staff | Live progress: opened the link, licence done, selfie now. A "Send a reminder" button if he stops. [15] |
| 6 | You get the result | Staff | One line per check (pass, check, fail), and one sentence from Trax on what it means and what to do. Example: "Low risk. The licence runs out in 6 weeks, so I will stop a rental that ends after 12 Jan." [1 to 10, 18] |
| 7 | You create the rental | Staff | The verification does work for you: licence valid through the return date, name matches the booking, deposit set by risk ($250 low risk, $500 higher risk). [2, 5, 6, 18] |
| 8 | Pickup: the key opens for him only | Renter, at the car | A fresh selfie at the car is matched to the verified person. Only then is the lockbox code shown, and it works for 15 minutes. [16] |
| 9 | During the rental | Staff | On a long or rideshare rental the licence keeps being watched. If it is suspended, Trax tells you and holds any extension. [19] |
| 10 | If something goes wrong | Staff | A chargeback or a car not returned. One click gathers the verified licence and selfie, signed agreement, pickup photos and card name match, for a Stripe dispute or a police report. [17] |
| 11 | Next time, at another company | Renter | He is already verified on Drive247. With his consent and a quick selfie, the next company gets it in seconds. A renter who caused trouble elsewhere is flagged. [22, 23] |

## 5. Providers compared

Identity check (licence photo, selfie, live person):

| Provider | Price per finished check | Monthly minimum | Contract | Notes |
|---|---|---|---|---|
| Didit | $0.33 ($0.15 ID, $0.10 liveness, $0.05 face match, $0.03 device and IP) | None. $10 free a month. | None | Face search and blocklist free. Stores data in the EU today. Company size and funding not found; its certificates are from its own pages only. |
| Veriff | $0.80 automated, $1.39 with human review, $1.89 top plan | $49, $99, $209 | Monthly | Established. Human reviewer behind the decision, which helps worn but genuine licences. A reported image theft in 2025 needs a first-hand account. |
| Sumsub | $1.35 | $149 | Not stated | |
| Stripe Identity | About $1.50 | None, first 50 free | None | Easiest to build. Open questions on keeping the images, resale wording and the account's country. |
| Persona | $250 a month for 500, then $1.50 | $250 | 12 months | |
| IDScan.net | $0.40 to $0.50 on list tiers | $200 | Monthly or yearly | Its DMV check matches data in 40 or more states. |
| RentID | $2.99 a credit (credits per check not published) | None | None | Licence status in 15 states plus DC only. No public developer documents. Its parent company sells a competing rental platform. |

Licence status, driving record and criminal record:

| Provider | What | Price |
|---|---|---|
| Checkr Trust | Licence status, driving and criminal records by API | Needs a sales call |
| RentID | Licence status, driving record, criminal record | $2.99 a credit plus state fees |
| Driving record in general | A full report | About $12 to $30 plus a state fee of about $2 to $25 |
| Continuous monitoring (SambaSafety, Embark, Checkr) | Alerts when a licence changes | $1.50 to $3.75 per driver a month |

None of these providers charges for a check the renter never finishes.

## 6. Open decision: which identity provider

Two rounds of research reached different first choices. This is not decided.

| | First report, 26 Nov | Second pass, 27 to 28 Nov |
|---|---|---|
| First choice | Veriff (Plus plan, $1.39, $99 minimum) | Didit ($0.33, no minimum) |
| Why | Established company, human review, monthly terms, clear partner and resale terms | A quarter of the price, free face search and blocklist, about $40 a month at today's volume |
| Runner-up | Didit | Veriff |
| RentID | Drop it: it is a competitor, covers 15 states, hides its unit cost | Usable only for licence status, and only in its states |

Both agree on three things:

1. Identity and licence status are two separate purchases. No identity provider proves a licence is currently valid everywhere.
2. No provider publishes how many people finish. A short pilot on real renters is the only real evidence.
3. Build one internal provider interface, so the provider can be swapped later, and keep only the extracted details and the decision in Drive247's own tables.

Suggested way to settle it: run a few hundred real renters through both Veriff and Didit and compare how many finish on a phone.

## 6a. Decided on 28 Nov 2026

Ghulam settled the shape of the first build. The full list (D1 to D20) and the build brief are in `docs/team/haris/2026-11-28-saturday-driver-verification-part-1.md`.

| Decision | Detail |
|---|---|
| Provider for the standard check | Didit, at about $0.33 a customer. This closes the open decision in section 6 for now. Veriff stays the fallback if a pilot shows Didit is not good enough. |
| The standard check is free | For every company. Drive247 carries the cost. |
| Premium checks | Licence active with the state, driving record, criminal record. Done by RentID. The company pays our cost plus $0.50. |
| Coming soon | Licence watch during the rental, rideshare driver proof. Shown, not live. |
| One account for everyone | Drive247 has one Didit account and one RentID account. Every rental company uses them. No company connects an account or enters a key. Drive247 pays the providers and charges the company with a margin on top. |
| How it is charged | Added to the company's next subscription bill, shown in the Billing tab. Only finished checks are charged. |
| Where it starts | Add customer no longer verifies. A Verify button on the customer's row and page opens one dialog: what to check, how to send, live progress. |
| One status | Not verified, Link sent, In progress, Verified, Failed, Expired. |

Didit facts read from its developer documents on 28 Nov 2026: the checks are set by a workflow built in Didit's console and named by `workflow_id`; a session is made with `POST https://verification.didit.me/v3/session/` and returns a hosted `url`; results come by webhook (`X-Signature-V2`, HMAC-SHA256) and from `GET /v3/session/{id}/decision/`; there is a free sandbox with its own key; `multi_account_segment` keeps duplicate-face matching inside one company.

Still open after today: RentID's credits per check and state fees, RentID's state coverage (licence status in 15 states plus DC), the consent wording for driving and criminal records, and the questions Q1 to Q9 in the brief.

## 7. What to keep in mind

- Round 1 is rows 1 to 7, 9, 10 and 14: one identity check plus Drive247's own rules.
- Rows 11 and 12 (driving and criminal records) are regulated in the US. They need the renter's consent and a set process when someone is refused.
- Row 23 (network shield) can make Drive247 a regulated reporting agency. It needs a lawyer before any design.
- Selfies are biometric data. Illinois, Texas and Washington have their own consent rules. The consent wording and who keeps the consent record must be agreed with the provider in writing.
- Didit stores data in the EU today. Confirm whether that suits US rental companies.
- Close the public storage of ID photos and selfies in round 1.

## 8. Not done yet

- No provider has been contacted. Every price is from a public page.
- No pilot has been run.
- Haris's task brief was written on 28 Nov 2026: `docs/team/haris/2026-11-28-saturday-driver-verification-part-1.md`.
- UK licence checking (the DVLA check code) is covered in Appendix A only; it is not in the table above.

## 9. Sources

Public pages read: Didit pricing, Veriff plans, Sumsub pricing, Stripe Identity, Persona help, IDScan.net pricing and DMV check, RentID, Checkr Trust, Fleetwire, Rent Centric, Turo host guide, IDScan fake ID report, Embark Safety, MVRcheck pricing. Haris's own research (14 checks, Didit against Veriff) was the starting point.

The first report (26 Nov 2026) and its working notes are below as appendices, kept as they were written, with every claim linked to its source.

| Appendix | What |
|---|---|
| A | First report: provider choice, 26 Nov 2026 |
| B | Notes: general identity verification vendors |
| C | Notes: licence status, driving records and fraud |
| D | Notes: platform fit and compliance |
| E | Notes: RentID and rental-specific vendors |

---

## Appendix A. First report: provider choice, 26 Nov 2026

### Drop RentID; verify renters with Veriff

Drive247 should not build on RentID. It should run the identity step (licence authenticity, selfie liveness, face match) on **Veriff**, with **Didit** as runner-up, and buy licence validity separately: the DVLA check in the UK and a Checkr Trust licence status check in the US. RentID's advertised $2.99 is the price of one "credit", not of a check; the vendor publishes no table of credits per product, bills state DMV fees on top, covers licence status in only 15 states plus DC, shows no UK support, no public API documentation, no SOC 2 claim and no biometric-consent language ([rent-id.io](https://rent-id.io/); [rentid.io/privacy](https://www.rentid.io/privacy)). Its parent, Rentid, Inc., also sells a white-label booking engine, payments and insurance to independent rental operators, which makes it a direct competitor that would receive Drive247's operator list and renter identities ([rentid.io/enterprise](https://www.rentid.io/enterprise)). Established identity vendors publish prices of **$0.33 to $1.50** per completed document-plus-selfie check with no annual contract, and none of them bills for abandoned sessions, which matters when 43% of started verifications are never finished. No identity vendor, RentID included, proves a licence is currently valid everywhere Drive247 operates; that is a second, separate purchase. No vendor publishes a start-to-finish completion rate, so the choice must be confirmed by a short pilot on real renters before any commitment. Several facts below come from vendor pages or third-party sites and are marked unverified where they were not confirmed at a primary source.

#### RentID's $2.99 buys a credit from a two-person competitor

The headline price does not survive a reading of RentID's own page. Pay-as-you-go is **$2.99 per credit**, bulk credits are $2.69 (or $2.54 with a subscription), and a $29.99 monthly plan includes "$35.88 of included monthly credits"; the page says "Additional tax and state fees may apply" and "state DMV fees are billed separately" ([rent-id.io](https://rent-id.io/)). RentID sells five separate products (identification and biometrics, licence validity, DMV criminal record, motor vehicle report, insurance validation) and says customers "apply credits to any services", but its "View credit pricing" link is a placeholder and no table states how many credits each product costs ([rent-id.io](https://rent-id.io/)). The true cost of a full screen per renter is therefore unknown until Rentid puts a credit table in writing. Every RentID total in this report assumes one credit per identity check, which is unverified and is a lower bound.

Coverage is narrower than the pitch suggests. Licence status against the state DMV is "currently available only" in CT, DC, FL, GA, ID, KS, MN, MO, NE, NJ, ND, RI, TX, WA, WV and WI, which leaves out California, New York and Illinois ([rent-id.io](https://rent-id.io/)). The Terms require hosts to "own a valid business entity located in the United States", data is "processed and stored in the United States", and neither the UK nor UK GDPR is mentioned anywhere ([rentid.io/terms](https://www.rentid.io/terms); [rentid.io/privacy](https://www.rentid.io/privacy)). UK operators appear unsupported; this is an inference from those pages, not a statement by the vendor.

Maturity is the larger problem. The About page names one person, founder and CEO Vishaal Pandya ([rentid.io/about-us](https://www.rentid.io/about-us)); a data aggregator lists the company at **2 employees** (unverified, aggregators conflict on titles) ([RocketReach](https://rocketreach.co/rentid-profile_b6ecb669c6e33a1b)). The verification product's domain was registered on 24 October 2025, about 13 months before this report ([WHOIS rent-id.io](https://www.whois.com/whois/rent-id.io)). The product site loads a placeholder analytics ID, its privacy and terms paths return the home page, and it states "there are no refunds, no warranty or expressed guarantees" ([rent-id.io](https://rent-id.io/)). No public API reference, SDK, webhook documentation or sandbox exists; the only statement is that "technology partners can gain access to our APIs" through sales ([rentid.io/enterprise](https://www.rentid.io/enterprise)). The privacy policy and terms contain no mention of biometrics, BIPA or SOC 2 even though the product matches selfies to ID photos ([rentid.io/privacy](https://www.rentid.io/privacy)). No underlying identity provider is named, so sub-processors and data flows are unknown, and no independent review, forum thread or named customer of the verification product was found.

The commercial conflict stands on its own. Rentid's main site is titled "Car Rental Platform, Insurance & Back Office, All In One Place", sells a white-labelled booking engine, runs pages aimed at hosts leaving Turo and Getaround, and advertises a partner programme covering "white-label booking flows, operator onboarding, payments and payouts, embedded insurance and verification" ([rentid.io sitemap](https://www.rentid.io/sitemap.xml); [rentid.io/enterprise](https://www.rentid.io/enterprise)). Where peer platforms disclose a vendor, they use a general identity provider instead: Fleetwire uses Stripe Identity, Outdoorsy uses Persona, and Turo moved to ComplyCube per a vendor press release ([Fleetwire](https://fleetwire.io/features/id-verification/); [Persona case study](https://withpersona.com/customers/outdoorsy); [ComplyCube press release](https://www.einpresswire.com/article/906961905/complycube-sets-new-standard-in-peer-to-peer-car-sharing-with-turo)). No platform was found relying on RentID.

#### The identity step costs $0.33 to $1.50 everywhere else

Four vendors publish a self-serve price for document plus selfie with no annual contract, and all four sit below RentID's credit price. **Didit** charges $0.33 per finished session ([Didit pricing](https://didit.me/pricing)). **Veriff** charges $0.80 (automated, $49 monthly minimum), $1.39 (adds human review specialists, $99 minimum) or $1.89 ($209 minimum) ([Veriff plans](https://www.veriff.com/plans)). **Sumsub** charges $1.35 with a $149 monthly minimum ([Sumsub pricing](https://sumsub.com/pricing/)). **Stripe Identity** charges $1.50 with no minimum and the first 50 free ([Stripe Identity](https://stripe.com/identity)). Authenticate.com publishes $2 for government ID with face match and liveness free on top, no minimum ([Authenticate pricing](https://authenticate.com/pricing)). Persona starts at $250 a month for 500 "services" on an annual contract, then $1.50 each ([Persona help](https://help.withpersona.com/articles/6oZbzp7jb7AWGClF5vpY3K.md)). IDScan.net's DIVE runs $200 a month for 400 checks up to $795 for 2,000 ([IDScan.net pricing](https://idscan.net/pricing)).

The totals below are list price times volume, or the monthly minimum where higher. They cover the identity step only; licence status and driving records are priced in a later section.

| Vendor and plan | Unit price | Monthly minimum | 500 / month | 2,000 / month | 5,000 / month | Contract | Confidence |
|---|---|---|---|---|---|---|---|
| Didit (Free plan) | $0.33 | none | $165 | $660 | $1,650 | none | vendor page |
| Didit with per-operator branding (+$0.10) | $0.43 | none | $215 | $860 | $2,150 | none | vendor page |
| Veriff Essential (automated) | $0.80 | $49 | $400 | $1,600 | $4,000 | monthly | vendor page |
| Veriff Plus (human review) | $1.39 | $99 | $695 | $2,780 | $6,950 | monthly | vendor page |
| Sumsub Basic | $1.35 | $149 | $675 | $2,700 | $6,750 | not stated | vendor page |
| Stripe Identity | $1.50 | none | $750 | $3,000 | $7,500 (custom pricing above 2,000) | none | vendor page |
| Authenticate.com | $2.00 | none | $1,000 | $4,000 | $10,000 | none | vendor page |
| Persona Essential, if one check is one "service" | $250 incl. 500, then $1.50 | $250 | $250 | $2,500 | $7,000 | annual | unit unverified |
| Persona Essential, if document and selfie are two "services" | same | $250 | $1,000 | $5,500 | $14,500 | annual | unit unverified |
| IDScan.net DIVE (list tiers) | $0.40 to $0.50 | $200 | $450 (1,000-check tier) | $795 | quote | monthly or annual | vendor page |
| IDScan.net DIVE, World ICRA member offer | "from $0.20" | none | $100 | $400 | $1,000 | none | unverified: page does not say what $0.20 includes |
| Trust Swiftly | $0.25 reported | $1,000 reported, billed annually | $1,000 | $1,000 | $1,250 | annual | unverified, sources conflict |
| Onfido / Entrust | quote only | not public | n/a | n/a | n/a | usually annual | no public price |
| Checkr | no identity-only price | n/a | n/a | n/a | n/a | n/a | sells status and MVR checks, see below |
| RentID, one credit per check | $2.99 | none | $1,495 | $5,980 | $14,950 | none | credits per check unverified |
| RentID, best published credit rate | $2.54 | $29.99 plan | $1,270 | $5,080 | $12,700 | none | credits per check unverified |

Sources: [Didit pricing](https://didit.me/pricing); [Didit resellers](https://didit.me/solutions/resellers/); [Veriff plans](https://www.veriff.com/plans); [Sumsub pricing](https://sumsub.com/pricing/); [Stripe Identity](https://stripe.com/identity); [Authenticate pricing](https://authenticate.com/pricing); [Persona help](https://help.withpersona.com/articles/6oZbzp7jb7AWGClF5vpY3K.md); [IDScan.net pricing](https://idscan.net/pricing); [IDScan.net World ICRA page](https://idscan.net/world-icra-digital-identity-verification); [Trust Swiftly comparison](https://trustswiftly.com/blog/identity-verification-pricing-comparison-and-alternatives/); [rent-id.io](https://rent-id.io/).

Three readings matter more than the unit prices. First, **billing basis decides the real cost at a 43% abandonment rate**. Stripe bills only when a verification report completes, Veriff states "you only pay for IDV decisions, not retries", Didit bills only finished checks (a caught fake counts as finished), and Sumsub says it charges only for successful verifications ([Stripe support](https://support.stripe.com/questions/billing-for-stripe-identity); [Veriff plans](https://www.veriff.com/plans); [Didit pricing](https://didit.me/pricing); [Sumsub pricing](https://sumsub.com/pricing/)). RentID's flow has the operator pay before the driver starts, and credits are non-refundable ([rent-id.io](https://rent-id.io/)). Second, at volumes below 500 a month the differences between Didit, Veriff and Stripe are a few hundred dollars, so integration effort and vendor reliability outweigh price; the gap only becomes material near 5,000 a month. Third, the cheap-looking outliers are the least certain: Trust Swiftly's figures range from $0.10 pay-as-you-go on review sites to a $1,000 monthly minimum on its own blog ([G2](https://www.g2.com/products/trust-swiftly/pricing)), and Onfido's only public figure is a UK public-sector listing of £0.43 to £2.12 per transaction ([UK Digital Marketplace](https://www.applytosupply.digitalmarketplace.service.gov.uk/g-cloud-14/services/168785180660845)).

#### Reseller rights and biometric consent separate the field

On the core check, the established vendors are close to equal. Every vendor named covers US state licences, UK photocard licences and passports; this is not a differentiator. What differs is independent certification of liveness, duplicate-renter detection, how much of the result Drive247 can keep, and whether the contract allows a platform to verify on behalf of 60 operators and charge them for it.

| | Liveness certification | Duplicate renter detection | Hosted flow, API, webhooks | Platform and re-billing position | Security and biometric consent |
|---|---|---|---|---|---|
| RentID | none published | claimed ("duplicate identities") | portal only; no public docs | partner programme in name, terms by sales | no SOC 2 claim; no biometric language |
| Veriff | iBeta Level 2 (vendor-reported) | "CrossLinks" (third-party report; tier unverified) | redirect, embedded flow, mobile SDKs, decision and media API, HMAC-signed webhooks, test mode | partner programme allows "integrate, whitelabel, resell"; terms not public | SOC 2 Type II, ISO 27001 (search summary); Illinois consent mechanism not found |
| Didit | iBeta Level 1 and 2 (vendor-reported) | device and IP analysis included; face duplicates unverified | hosted, iframe, SDKs, sandbox, HMAC webhooks | documented: one application per client, own keys, webhooks, branding; resale price is yours | SOC 2 Type 2, ISO 27001; claims explicit consent for Illinois, Texas, Colorado |
| Stripe Identity | none published | none documented | modal or hosted URL, existing Stripe webhooks, test mode | resale "as an independent ID verification service" unsupported; Connect documented only for onboarding | collects biometric consent and keeps the record; biometric data kept one year |
| Persona | iBeta Level 2 (third party) | known-face detection; fraud tooling on Growth plan | docs versioned; details not confirmed | resale prohibited outside Reseller Partner Program | SOC 2 Type II, ISO 27001 (search summary); customers sued under BIPA |
| Sumsub | iBeta Level 2 | cross-applicant face match (third party) | permalinks, WebSDK, mobile SDKs, sandbox | resale forbidden without prior written consent | SOC 2 Type II, ISO 27001; permanent delete endpoint not found |
| Onfido / Entrust | not researched | "Known Faces" report | hosted link, SDKs, signed webhooks | nothing published | US biometric consent notices built in; $28.5M BIPA settlement |
| Authenticate.com | iBeta Level 2 logo shown, no detail | not found | hosted flow, iframe, mock APIs; webhook signing not mentioned | nothing published | FCRA and DPPA consent material; nothing on BIPA |
| IDScan.net DIVE | "liveness/anti-spoofing", no certification named | risk scoring | SMS link flow, API, SDKs | multi-tenancy only on quote-only tier | SOC 2 Type II (2022, vendor); biometric policy cites BIPA |
| Checkr / Checkr Trust | NIST PAD Level 2 claimed | not found | API; partner staging account | each customer connects its own Checkr account by OAuth | not confirmed |
| Trust Swiftly | not researched | not found | magic link, REST, signed webhook; no sandbox found | branding removable; no sub-accounts found | none found |

Sources: [Veriff plans](https://www.veriff.com/plans); [Veriff iBeta](https://www.veriff.com/identity-verification/news/veriff-achieves-ibeta-level-2-compliance); [Veriff docs index](https://devdocs.veriff.com/llms.txt); [Veriff partner programme](https://prnewswire.com/news-releases/veriff-launches-global-partner-program-to-give-partners-a-simple-and-effective-path-to-growth-and-increased-revenues-301611537.html); [Didit resellers](https://didit.me/solutions/resellers/); [Didit docs index](https://docs.didit.me/llms.txt); [Stripe use cases](https://docs.stripe.com/identity/use-cases); [Stripe selfie checks](https://docs.stripe.com/identity/verification-checks.md?type=selfie); [Persona pricing](https://withpersona.com/pricing/); [Sumsub terms](https://sumsub.com/terms-and-conditions/); [Entrust docs index](https://documentation.identity.entrust.com/llms.txt); [Authenticate docs](https://docs.authenticate.com/); [IDScan.net pricing](https://idscan.net/pricing); [Checkr partner docs](https://docs.checkr.com/partners/); [Trust Swiftly docs](https://docs.trustswiftly.com/llms-full.txt); [beverified.org](https://beverified.org/compare/persona-vs-veriff/).

**Re-billing is where standard terms bite.** Charging operators a per-check fee or a paid add-on is closer to resale than internal use. Sumsub's terms bar making the service available "to any third party without the Service Provider's prior written consent" ([Sumsub terms](https://sumsub.com/terms-and-conditions/)). Persona states resale "is prohibited" outside its Reseller Partner Program ([Persona pricing](https://withpersona.com/pricing/)). Stripe lists as unsupported "resale, provision, or further distribution of identity verification services or data to third parties", with the example "your primary business is selling ID verification to other businesses" ([Stripe use cases](https://docs.stripe.com/identity/use-cases)). Drive247's primary business is rental software and Fleetwire already runs Stripe Identity inside a rental platform, so bundling is arguably permitted, but a separately priced per-check line is a grey area. Didit is the only vendor that documents the model outright: "create one application per client", each with its own keys, webhooks and branding, at a resale price the reseller sets ([Didit resellers](https://didit.me/solutions/resellers/)). Veriff permits it through its partner programme, whose minimums and terms are not public.

**Stripe Identity is the smallest build and the tightest box.** It needs no new vendor account, SDK or webhook endpoint, and Stripe is the most substantial company on the list. The limits are specific. Date of birth, licence number, expiry and images require a restricted key, and after 48 hours an IP-restricted key ([Stripe: access verification results](https://docs.stripe.com/identity/access-verification-results)); whether Supabase edge functions can present a fixed IP was not checked. Image links "must expire within 30 seconds" and Stripe advises "don't make copies of the file contents" ([Stripe: access verification results](https://docs.stripe.com/identity/access-verification-results)), which conflicts with a rental operator's need to hand police a licence copy and a clear face photo after a theft. Stripe publishes no liveness certification and documents no duplicate detection ([Stripe selfie checks](https://docs.stripe.com/identity/verification-checks.md?type=selfie)). Identity is generally available only to businesses based in the US, UK and Japan, with fees set by the Stripe account's location ([Stripe use cases](https://docs.stripe.com/identity/use-cases); [Stripe support](https://support.stripe.com/questions/billing-for-stripe-identity)), which matters while Drive247 is moving between Stripe accounts. Stripe documents Identity with Connect only for verifying a connected account's own people during onboarding; no Stripe source says renter checks can be billed to a connected account ([Stripe changelog](https://docs.stripe.com/changelog/basil/2025-06-30/identity-related-person)).

**No vendor takes Illinois liability off Drive247.** Plaintiffs have sued the vendor (Onfido paid $28.5 million over checks it ran for OfferUp; Veriff settled for $4 million) and the business that required the check (a proposed class action against Sonder, and one against Anthropic, both over checks run by Persona; both early stage with no finding of liability) ([Bloomberg Law](https://news.bloomberglaw.com/privacy-and-data-security/id-verifier-onfido-to-pay-28-5-million-over-biometric-claims); [Top Class Actions](https://topclassactions.com/lawsuit-settlements/closed-settlements/veriff-facial-scans-4m-class-action-settlement/); [ClassAction.org](https://www.classaction.org/news/sonder-illegally-captures-facial-scans-of-illinois-renters-class-action-alleges); [ID Tech Wire](https://idtechwire.com/anthropic-faces-illinois-biometric-privacy-claims-over-claude-id-checks/)). For an Illinois renter there are three possible defendants: the vendor, Drive247 and the operator. A vendor flow that collects explicit biometric consent and keeps the record (documented for Stripe and Entrust, claimed by Didit) reduces build work but does not transfer the risk, and the same exposure exists today for the in-house OpenAI face-match flow. Storing only extracted text fields and the pass or fail result, and leaving face images with the vendor under a short retention period, keeps Drive247's own biometric footprint small. This is a reading of vendor statements and reported cases, not legal advice.

**Completion and accuracy cannot be ranked from public evidence.** Veriff claims 95% of users pass on the first try and Sumsub reports pass rates of 91.64% in the US and 95.86% in the UK, both self-reported and both measured among people who submit, not among people who start ([Veriff](https://www.veriff.com/about/why-veriff); [Sumsub](https://sumsub.com/kyc-compliance/)). Drive247's 43% figure is start-to-finish, so the numbers are not comparable. The US Department of Homeland Security's remote identity tests anonymise vendors, and trade press summarised the latest document-validation round as showing "most ID document validation disastrously ineffective" ([Biometric Update](https://www.biometricupdate.com/202602/dhs-rivr-results-suggest-most-id-document-validation-disastrously-ineffective)). Third-party sites report unexplained instant rejections at Stripe and false declines at Veriff and Persona; all of this is second-hand and unverified ([apibenchmarks](https://apibenchmarks.com/kyc/compare/stripe-identity-vs-veriff); [verifier.org](https://verifier.org/stripe-identity-alternatives)). Incident history is similarly unverified at primary sources: a third-party site reports government-ID images of 8,583 people taken from Veriff's systems in November 2025, and a breach tracker reports a 2024 Sumsub intrusion disclosed in 2026 ([settlementinsight.com](https://settlementinsight.com/veriff-data-breach-lawsuit); [Zyphe tracker](https://www.zyphe.com/resources/blog/kyc-idv-breach-tracker)).

#### A genuine licence is not a valid licence

Document verification says the card looks real and the face matches. It does not say the holder is allowed to drive today. In the US there are three distinct products. A data match against the issuing state through AAMVA's DLDV service confirms "that the DL/ID exists" and returns true or false per attribute, but it does not return the state's data, does not validate the physical document, and AAMVA's own description mentions no valid or suspended status ([AAMVA DLDV overview](https://www.aamva.org/getmedia/cb603635-3454-4331-b2c6-288d894f7fc4/AAMVA-DLDV-Overview-for-Customers.pdf)). It covers 44 jurisdictions and about 73% of the US population per one reseller's documentation, and Pennsylvania requires written consent first ([PingOne Verify docs](https://docs.pingidentity.com/pingone/identity_verification_using_pingone_verify/p1_verify_aamva_dldv.html)). Persona, IDScan.net and Entrust resell it at unpublished prices, on higher tiers.

A **licence status check** answers the rental question directly. Checkr Trust sells one built for "vehicle rental fleets and peer-to-peer vehicle sharing" that confirms a licence is "valid and active" in under two seconds without state fees ([Checkr Trust Driver Checks](https://trust.checkr.com/products/driver-checks)). Its price was advertised at **$5 per check**, but that page now redirects, so the figure is unverified, as is state coverage. A full **motor vehicle report** costs $9.50 at Checkr plus a state fee passed through at cost ([Checkr pricing](https://checkr.com/pricing)), and $5 plus state fees at Authenticate.com, where it is an FCRA-regulated report ([Authenticate pricing](https://authenticate.com/pricing)). Verisk puts the average state fee at $10.65 (search summary, unverified) ([Verisk](https://www.verisk.com/blog/average-motor-vehicle-report-fees-continue-to-climb/)). A full record on every rental would cost roughly $12 to $25, several times the identity check, so it belongs on higher-risk rentals only. US courts cited by trade press have generally not required a DMV check where the licence is facially valid, though one California federal case applied a presumption of negligence where the licence was in fact suspended ([Auto Rental News](https://www.autorentalnews.com/articles/investigating-renters-verifying-licenses-with-the-dmv)). An MVR bought from a reseller is generally treated as a consumer report, so written renter consent and an adverse action notice on refusal are the conservative pattern; Checkr's standard partner model also has each customer connect its own account, the opposite of one platform account for all operators ([Checkr partner docs](https://docs.checkr.com/partners/)).

In the UK the answer is cheap, authoritative and effectively mandatory. The renter generates a free DVLA check code, valid 21 days and usable once, which shows entitlements, penalty points and disqualifications ([GOV.UK](https://www.gov.uk/check-driving-information)). DVLA's Access to Driver Data API costs **£0.60 per successful enquiry** and requires a contract and a signed driver declaration ([DVLA ADD FAQ](https://developer-portal.driver-vehicle-licensing.api.gov.uk/apis/driver-view/driver-view-faq.html)); resellers charge about £1.60 to £1.95 per check ([Checkedsafe](https://checkedsafe.com/pricing/); [G-Cloud 15 pricing document](https://assets.applytosupply.digitalmarketplace.service.gov.uk/g-cloud-15/documents/720983/546580219450771-pricing-document-2025-10-30-1253.pdf)). Self-drive hire insurers make it a condition of cover: a broker's Allianz guidance requires an online licence check on every hire and warns that without adequate checks "you may find your insurance is invalid" ([Allianz SDH referencing leaflet](https://webcontent.alanboswell.com/pdf-leaflets/sdh-referencing-requirements-allianz.pdf)). None of the identity vendors in this comparison was confirmed to resell a DVLA record check, and RentID has no UK product at all.

On fraud, the dominant route is renting with a fake or stolen identity and never returning the car, and a police panel reported that about half the time a stolen rental cannot be listed as stolen because the operator lacks a copy of the licence, the demand letter or follow-up ([Auto Rental News](https://www.autorentalnews.com/articles/inside-the-fight-to-catch-rental-car-thieves)). Selfie match and liveness address stolen identities; a data match or DVLA record addresses fabricated ones; a status check addresses suspended drivers. US do-not-rent lists are "not shared industry-wide" ([CBS Sacramento](https://www.cbsnews.com/sacramento/news/rental-car-blacklisting)), so duplicate-renter detection is only valuable if every operator's checks run through one Drive247 vendor account. That argues for a single platform account whichever vendor is chosen. A shared banned-renter list across operators would need legal review first, because a list used to deny service starts to resemble a consumer reporting function.

#### Veriff first, Didit second, nothing signed before a pilot

**Recommendation: Veriff**, starting on the Plus plan at $1.39 with a $99 monthly minimum. It is the only option that combines an established company (last priced round a $100M Series C, per secondary sources ([Tech Insider](https://tech-insider.org/igt-regtech-consolidation-2026-ma-in-igaming-kyc-vendors-en-d187/))), a published monthly price with no long-term contract, a human reviewer behind the automated decision, vendor-reported iBeta Level 2 liveness, an API that returns both the decision and the media, signed webhooks, a redirect flow that runs in a phone browser, returning-user face re-verification, and a partner programme that explicitly covers white-labelling and resale. The human review tier is the usual remedy for genuine but worn licences being rejected, which is the failure most likely to hurt completion. Veriff's weaknesses are real: the reported 2025 image theft, the $4 million BIPA settlement, an Illinois consent mechanism this research could not locate, and partner terms that are not public.

**Runner-up: Didit.** It costs a quarter of Veriff, documents Drive247's exact multi-tenant model, lists SOC 2 Type 2, ISO 27001 and iBeta Level 2, processes data in the EU by default and claims explicit biometric consent for Illinois. It ranks second because its company size and funding were not found, no independent reviews exist, and its certifications and consent claims come only from its own pages. It differs from RentID in the ways that count: public documentation, a free sandbox, published prices and audits, and no competing rental product. Stripe Identity is third despite being the easiest to build, because of the image-handling limits, the missing liveness certification and duplicate detection, the resale wording and the account-location question; it becomes the better choice only if Stripe answers those points favourably in writing. Persona and Onfido are priced and contracted for larger buyers, Sumsub forbids resale by default, and Authenticate.com, IDScan.net and Trust Swiftly publish too little on platform rights, liveness certification or data retrieval to rank higher.

The licence layer sits beside whichever identity vendor wins: collect the DVLA check code on every UK hire now and automate it through a reseller once volume justifies it, and add a US licence status check on new renters, risk-based at first, with full motor vehicle reports reserved for high-value vehicles, long rentals and unattended lockbox handovers.

Before committing, the following must be confirmed in writing.

| With | What to confirm in writing |
|---|---|
| Veriff | That one Drive247 account may verify renters on behalf of all operators and re-bill them; partner programme minimums and revenue terms; whether the monthly minimum is drawn down by usage or charged on top; that abandoned and retried sessions are not billed; whether duplicate-face detection is in Essential or Plus; the Illinois, Texas and Washington consent text and who holds the consent record; default and configurable retention; a data processing agreement, sub-processor list and UK GDPR transfer terms; a first-hand account of the November 2025 incident; export of data on termination |
| Didit | Legal entity, headcount and funding; the SOC 2 Type 2 report and ISO 27001 certificate themselves; the iBeta letter; whether face-duplicate detection is in the $0.33 price; the exact biometric consent wording; reseller terms in a signed agreement, not a marketing page; uptime history and support hours |
| Stripe (only if pursued) | Whether a separately priced verification charge to operators counts as resale; whether Identity is available and at what price on the destination Stripe account's country; whether retries inside one session create multiple billable reports; whether copying licence images to Drive247 storage is permitted; whether Identity fees can be attributed to connected accounts |
| RentID (only if kept in consideration) | Credits per product and the state fee schedule; which providers perform the ID, DMV, criminal and insurance checks; UK licence support; API reference, webhooks, sandbox and uptime commitment; SOC 2 status, biometric consent text and retention period; a contractual bar on using Drive247's operator and renter data for Rentid's own platform |
| Checkr Trust | Current price and state coverage of the licence status check; whether Drive247 can hold one credential for all operators or each operator must be credentialed; whether a status-only check is treated as a consumer report requiring adverse action notices |
| DVLA or a UK reseller | Whether a software platform can hold one Access to Driver Data contract for many hire operators; the commercial per-check price outside the public-sector framework |
| Bonzah and UK hire insurers | What licence checks are required for cover to stand, and how licence validity is tested when a claim is made |

#### Conclusion

The question began as RentID versus alternatives and ends as two separate purchases. Identity verification is a commodity with published prices, strong documentation and little to choose between the leading vendors on paper; licence validity is jurisdiction-specific data that no identity vendor delivers across both of Drive247's markets. RentID's appeal was bundling the two under one price, but the bundle covers 15 states, omits the UK, hides its unit cost and comes from a competitor. Buying the layers separately costs less, covers more and keeps each piece replaceable.

The 43% abandonment problem will not be settled by a vendor's brochure, because no vendor publishes a start-to-finish rate. The decisive evidence is a pilot: route a few hundred real renters through Veriff and Didit behind one internal provider interface, measure started-to-verified on phones, and store only extracted fields and decisions in Drive247's own tables. That design makes the winner easy to adopt, the loser free to drop, and any future vendor a single adapter away.

---

## Appendix B. Notes: general identity verification vendors

### General-purpose identity verification vendors (driver's licence + selfie), November 2026

Scope: Stripe Identity, Veriff, Persona, Didit, Sumsub, Onfido (Entrust), Trust Swiftly, plus iDenfy, Vouched, Ondato, Plaid, Socure, Jumio, Incode, Microblink, ID.me, AuthenticID. Car-rental-specific vendors (RentID, Authenticate.com, IDScan) are out of scope.

How to read the evidence labels used below:
- **[VENDOR, opened]** = I opened the vendor's own page on 2026-11-26 and read the figure there.
- **[VENDOR, via search]** = a vendor page surfaced in search results; the figure comes from the search summary, the page itself was not opened (several vendor sites return HTTP 403 to automated fetches).
- **[THIRD PARTY]** = a competitor blog, aggregator or review site. Many of these are written by competitors (Didit, Trust Swiftly, Signzy, HyperVerge) and should be treated as leads, not facts.

Pages that refused to load (HTTP 403): withpersona.com/pricing, trustswiftly.com/pricing, trustswiftly.com blog comparison, idenfy.com/pricing.

#### 1. Price per document + selfie verification, minimums, contracts, free tier, billing of failed/abandoned attempts, totals at 500 / 2,000 / 5,000 a month

##### Takeaway
Four vendors publish a usable self-serve price with no annual contract: Didit ($0.33), Veriff ($0.80 to $1.89, $49 to $209 monthly minimum), Sumsub ($1.35, $149 minimum) and Stripe Identity ($1.50, no minimum). All four are below RentID's $2.99, and none of them bills for abandoned sessions according to their own pages. Persona is $250 a month on an annual contract; Onfido/Entrust, Jumio, Incode, ID.me, AuthenticID and Plaid are quote-only.

##### Cited Findings

**Stripe Identity [VENDOR, opened]**
- $1.50 per ID document + selfie verification, billed "when a user completes verification". ID number (US SSN) lookup is $0.50 extra. First 50 verifications free. No minimum stated. Volumes above 2,000 identities a month, or unusual business models, go to custom pricing via sales. — [Stripe Identity](https://stripe.com/identity)
- A verification is billed only once a VerificationReport completes with status `verified` or `unverified`: "You will not be billed until the VerificationReport is complete." Fees depend on verification type and the location of the Stripe account, not of the person verified. The page does not say explicitly how retries inside one session are counted. — [Stripe support: Billing for Stripe Identity](https://support.stripe.com/questions/billing-for-stripe-identity)

**Veriff [VENDOR, opened]**
- Self-serve plans: Essential $0.80 per verification with $49 monthly minimum (fully automated decisions); Plus $1.39 with $99 minimum (automation plus human review specialists); Premium $1.89 with $209 minimum. — [Veriff plans](https://www.veriff.com/plans)
- "You only pay for IDV decisions, not retries." No long-term contract; monthly subscription billed at start of period, pay-as-you-go overage. No setup fee. No refunds for unused services. — [Veriff plans](https://www.veriff.com/plans)
- Free trial: 15 days of Premium, up to 50 live verifications, no credit card. — [Veriff plans](https://www.veriff.com/plans)
- Self-serve caps: 15 sessions a minute, 10,000 sessions a month. Enterprise (custom, order form) is aimed at more than 5,000 verifications a month; no per-verification rate published. — [Veriff plans](https://www.veriff.com/plans)
- Add-ons per verification: extended 2-year data retention +$0.30; extra extracted fields +$0.30 (Plus/Premium); PEP and sanctions +$0.64. Default retention is 3 months (Essential) or 6 months (Plus/Premium). Database verification is Enterprise-only. — [Veriff plans](https://www.veriff.com/plans)

**Persona [VENDOR, opened: help centre; pricing page blocked]**
- Essential plan: starts at $250 a month, includes 500 "services" a month (unused ones expire each cycle), $1.50 per service beyond 500, **annual** contract. Growth and Enterprise are custom quotes. — [Persona help: Plans Overview](https://help.withpersona.com/articles/6oZbzp7jb7AWGClF5vpY3K.md)
- Free trial on Essential: 60 days, up to 50 services, no credit card; production access needs a business verification review. A one-year Startup Program exists with a limited monthly allotment (amount not stated). — [Persona help: Plans Overview](https://help.withpersona.com/articles/6oZbzp7jb7AWGClF5vpY3K.md)
- [THIRD PARTY, competitor] Didit's comparison says Essential carries a 12-month minimum term; another source describes it as "pay per successful verification". Neither was confirmed on Persona's own pages. — [Didit vs Persona](https://didit.me/blog/didit-vs-persona-differences/)

**Didit [VENDOR, opened]**
- Full ID check (document + liveness + face match + device and IP analysis): $0.33 per finished session on the Free plan. Components: document $0.15, passive liveness $0.10, active liveness $0.15, face match $0.05, AML $0.20. — [Didit pricing](https://didit.me/pricing)
- Growth plan $99 a month gives 4% off ($0.3168); Scale $299 a month gives 10% off ($0.297). No spend commitment or term on Free, Growth, Scale. Enterprise is an annual agreement from $15,000 a year. — [Didit pricing](https://didit.me/pricing)
- Work-email sign-ups get $10 monthly credit (about 30 full checks). Sandbox is free. — [Didit pricing](https://didit.me/pricing)
- Billing: only finished checks are billed; a check that catches a fake ID counts as finished (so declined results are billed, abandoned ones are not). — [Didit pricing](https://didit.me/pricing)

**Sumsub [VENDOR, opened]**
- Basic plan $1.35 per verification, $149 monthly minimum commitment; includes ID verification, liveness and face match. Compliance plan $1.85, $299 minimum (adds AML screening, address verification). Custom plan is quote-only and is where database validation and fraud prevention sit. — [Sumsub pricing](https://sumsub.com/pricing/)
- FAQ says customers are charged only for successful verifications. 14-day trial with 50 free checks. Credit card only. Contract length is not stated. — [Sumsub pricing](https://sumsub.com/pricing/)

**Onfido / Entrust IDV — quote-only**
- [THIRD PARTY] Entrust lists no public per-check rate; sales contact only, with annual commitment. Estimates in circulation conflict: $250 to $500 monthly minimums (Didit, a competitor), versus "$50,000+ a year" and $2.00 to $4.00 per check effective (an iGaming comparison). — [Didit vs Onfido](https://didit.me/blog/didit-vs-onfido/); [tech-insider iGaming comparison](https://tech-insider.org/igt-sumsub-vs-onfido-vs-jumio-vs-veriff-for-igaming-kyc-202-en-d181/)
- [VENDOR, via search; UK public-sector listing] UK G-Cloud 14 listing shows £0.43 to £2.12 per transaction, with contracts built on an agreed number of checks at a negotiated unit cost. — [UK Digital Marketplace, G-Cloud 14](https://www.applytosupply.digitalmarketplace.service.gov.uk/g-cloud-14/services/168785180660845)

**Trust Swiftly — figures conflict; vendor pricing page could not be opened**
- [VENDOR, via search] Its own October 2026 comparison blog is reported as listing $0.25 per verification with a $1,000 a month minimum billed annually. — [Trust Swiftly pricing comparison blog](https://trustswiftly.com/blog/identity-verification-pricing-comparison-and-alternatives/)
- [THIRD PARTY] G2 shows pay-as-you-go from $0.10 per verification and a $99 a month Starter plan; TrustRadius shows $99 a month Starter and $0.10 per verification (set-up fee not included). — [G2](https://www.g2.com/products/trust-swiftly/pricing); [TrustRadius](https://www.trustradius.com/products/trust-swiftly/pricing)

**iDenfy**
- [VENDOR, via search] iDenfy says it charges only for approved (successful) verifications; its calculator shows 100 verifications × $1.35 = $270 a month on Basic; enterprise best rate shown as $0.55. — [iDenfy price page](https://idenfy.com/identity-verification-price/); [iDenfy pay-per-approved blog](https://idenfy.com/blog/kyc-pricing-pay-approved-users/)
- [THIRD PARTY] Trust Swiftly's table lists iDenfy at $1.35 with a $135 monthly minimum; G2 lists enterprise from $0.65 on annual terms. These do not reconcile with the $270 figure above. — [Trust Swiftly comparison](https://trustswiftly.com/blog/identity-verification-pricing-comparison-and-alternatives/)

**Vouched**
- [THIRD PARTY] $300 a month plus $0.75 per verification on the monthly "Self Starter" plan; $0.70 per verification with $3,000 billed annually. Vouched's own page headline is "Only Pay for What You Use" but the rates were not retrieved. — [Trust Swiftly comparison](https://trustswiftly.com/blog/identity-verification-pricing-comparison-and-alternatives/); [Vouched pricing](https://www.vouched.id/pricing)

**Ondato**
- [VENDOR, via search] Identity verification €1.40 down to €0.50 per verification depending on volume; AML screening €0.45 to €0.04 per check. — [Ondato pricing](https://ondato.com/identity-verification-pricing/)

**Plaid Identity Verification — price not published**
- [VENDOR, opened] Identity Verification is available on Pay as You Go ("no minimum spend or commitment", month to month), but the pricing page gives no per-check rate and points to sales or the billing docs. — [Plaid pricing](https://plaid.com/pricing/)
- [THIRD PARTY] Plaid is described as charging a base fee per attempt plus add-ons for selfie and document, with user retries billed as new sessions. Not confirmed in Plaid's docs. — [Didit vs Plaid](https://didit.me/blog/didit-vs-plaid-identity-kyc-comparison/)

**Socure, Jumio, Incode, Microblink, ID.me, AuthenticID**
- [THIRD PARTY] Socure "Launch" tier: DocV (document verification) $0.80; DocV + watchlist $0.90; KYC + fraud + watchlist with DocV step-up $1.00. Enterprise is custom. — [Signzy US KYC pricing](https://www.signzy.com/blogs/kyc-pricing-us-cost-per-verification)
- [THIRD PARTY] Jumio is quote-only; estimates range $2.50 to $7.00 per full verification (HyperVerge, a competitor) or about $3 to $5 (another comparison). — [HyperVerge: Jumio pricing](https://hyperverge.co/blog/jumio-pricing/); [Vendr Jumio guide](https://www.vendr.com/buyer-guides/jumio)
- [THIRD PARTY] Incode and ID.me are quote-based with no rate card. Microblink publishes self-serve plans for BlinkID scanning only; the rest is quoted. No AuthenticID pricing was found. — [Microblink: best IDV platforms 2026](https://microblink.com/resources/blog/best-identity-verification-platforms)

##### Inferences

Monthly totals, calculated from the list prices above (verifications × unit price, or the monthly minimum if higher). RentID at $2.99 is shown for reference.

| Vendor / plan | Unit price | Monthly floor | 500 / month | 2,000 / month | 5,000 / month | Contract | Source quality |
|---|---|---|---|---|---|---|---|
| Didit (Free plan) | $0.33 | none | $165 | $660 | $1,650 | none | vendor, opened |
| Veriff Essential (automated) | $0.80 | $49 | $400 | $1,600 | $4,000 | monthly | vendor, opened |
| Veriff Plus (human review) | $1.39 | $99 | $695 | $2,780 | $6,950 | monthly | vendor, opened |
| Veriff Premium | $1.89 | $209 | $945 | $3,780 | $9,450 | monthly | vendor, opened |
| Sumsub Basic | $1.35 | $149 | $675 | $2,700 | $6,750 | not stated | vendor, opened |
| Stripe Identity | $1.50 | none | $750 | $3,000 | $7,500 (custom pricing applies above 2,000) | none | vendor, opened |
| Persona Essential (if 1 verification = 1 service) | $250 incl. 500, then $1.50 | $250 | $250 | $2,500 | $7,000 | annual | vendor help centre, opened |
| Persona Essential (if document and selfie count as 2 services) | same | $250 | $1,000 | $5,500 | $14,500 | annual | my calculation; unit not confirmed |
| iDenfy Basic | $1.35 | $135 or $270 (conflict) | $675 | $2,700 | $6,750 | not confirmed | mixed |
| Vouched Self Starter | $300 + $0.75 | $300 | $675 | $1,800 | $4,050 | monthly | third party |
| Socure Launch DocV | $0.80 | unknown | $400 | $1,600 | $4,000 | unknown | third party |
| Trust Swiftly | $0.25 (reported) | $1,000 (reported, annual) | $1,000 | $1,000 | $1,250 | annual (reported) | low confidence, conflicting |
| Ondato | €1.40 to €0.50 | unknown | up to €700 | €1,000 to €2,800 | €2,500 to €7,000 | unknown | vendor via search |
| Onfido/Entrust, Jumio, Incode, ID.me, AuthenticID, Plaid | quote-only | — | — | — | — | usually annual | — |
| RentID (reference) | $2.99 | — | $1,495 | $5,980 | $14,950 | — | from the brief |

- "Billed on what" differs and matters with a 43% abandonment rate. Abandoned sessions appear free at Stripe (no completed report), Veriff (per decision), Didit (per finished check), Sumsub and iDenfy (per successful verification). Declined results are billed at Didit and, by the wording, at Stripe and Veriff; Sumsub and iDenfy say they bill only successes.
- Didit's Growth and Scale plans do not pay for themselves at these volumes on the published discount alone: at 5,000 checks the 10% saving is $165 against a $299 fee, unless the plan fee is itself usable credit (the page says "plan credit resets monthly", which suggests it may be; not confirmed).
- Stripe's free 50 and Didit's $10 credit are too small to change any of the totals.
- Drive247 already runs Stripe (Connect and subscriptions), so Stripe Identity adds no new vendor contract, but note Stripe prices by the account's location, and Drive247 is mid-migration between Stripe accounts.

##### Gaps
- Persona: whether a government ID check plus a selfie check counts as one "service" or two, and whether failed or abandoned inquiries consume services. The pricing page was blocked; the two-row range above reflects this uncertainty.
- Stripe: UK-account price in GBP, and whether several submission attempts within one session produce several billable reports.
- Trust Swiftly: no reliable current price. Sources range from $0.10 pay-as-you-go to a $1,000 monthly annual minimum.
- Plaid, Onfido/Entrust, Jumio, Incode, ID.me, AuthenticID: no vendor-published price exists; a written quote is the only way to fill these cells.
- Veriff: whether the "monthly minimum" is a prepaid floor that usage draws down (assumed in the table) or a fee on top of usage.

#### 2. What is checked: document authenticity, liveness and its certification, face match, deepfake/injection detection, age and expiry extraction

##### Takeaway
All the named vendors do document authenticity, face match and some form of liveness; the differences are in what is independently certified. Veriff, Sumsub, Persona and Didit are reported to hold iBeta Level 2 presentation-attack letters; Stripe publishes no liveness certification at all.

##### Cited Findings
- Stripe document check: AI models plus heuristics plus manual reviewers; checks images against a frequently updated database of fraudulent document templates; decodes barcodes and other machine-readable features "where available" and checks printed data against them; warns the user in real time if the document is expired; uses computer vision to confirm a physical document was captured (not a photo of a photo). — [Stripe docs: document checks](https://docs.stripe.com/identity/verification-checks.md?type=document)
- Stripe selfie check: compares face geometry between the ID photo and a picture of the user's face. Error codes include `selfie_face_mismatch`, `selfie_manipulated` ("the captured face image was manipulated") and `document_expired`. The report returns name, address, issue and expiry dates, document type and issuing country. The docs do not use the word "liveness" and name no certification. — [Stripe docs: selfie checks](https://docs.stripe.com/identity/verification-checks.md?type=selfie)
- Stripe does not extract fields written in Arabic, Chinese, Cyrillic, Greek, Hebrew, Korean, Tamil or Thai script. — [Stripe docs: document checks](https://docs.stripe.com/identity/verification-checks.md?type=document)
- Veriff: Essential plan includes "iBeta-conformant" liveness; decision engine lists document verification, biometric comparison of document photo to selfie, and liveness detection. Veriff reports passing iBeta Level 2 for passive liveness with 0% impostor attack presentation accept rate. — [Veriff plans](https://www.veriff.com/plans); [Veriff: iBeta Level 2](https://www.veriff.com/identity-verification/news/veriff-achieves-ibeta-level-2-compliance)
- Sumsub: liveness passed iBeta Level 2 in 2025 with zero attack presentation classification errors per iBeta's confirmation letter. [THIRD PARTY] Later comparisons claim a Level 3 letter dated September 2026 filed under its holding company name; I could not verify that letter. — [Biometric Update, May 2025](https://www.biometricupdate.com/202505/sumsubs-biometric-liveness-detection-passes-ibeta-level-2-compliance-test); [beverified.org comparison](https://beverified.org/compare/persona-vs-veriff/)
- Persona: [THIRD PARTY] liveness holds an iBeta Level 2 letter. — [beverified.org: Persona vs Veriff](https://beverified.org/compare/persona-vs-veriff/)
- Didit: lists iBeta Level 1 and Level 2 (ISO/IEC 30107-3), SOC 2 Type 2 and ISO 27001 on its pricing page; offers both passive and active liveness, and optional NFC chip reading. — [Didit pricing](https://didit.me/pricing)
- Injection-attack testing is new: iBeta launched injection attack detection testing against CEN/TS 18099 in mid-2026, up to Level 3; iProov was evaluated to that standard by Ingenium. No result for any vendor on this list was found. — [Biometric Update, June 2026](https://www.biometricupdate.com/202606/ibeta-launches-injection-attack-detection-testing-against-cens-ts-18099)

##### Inferences
- Stripe's `selfie_manipulated` code shows it screens for tampered selfies, but with no published liveness standard or certification it is the weakest on paper for spoof resistance among the four self-serve options.
- iBeta Level 2 covers presentation attacks (masks, screens, printed photos) only. It says nothing about deepfakes injected through a virtual camera, which is the newer attack; no vendor here has a published independent result for that.
- All vendors return date of birth and expiry, so age and expiry rules can be applied on Drive247's side regardless of vendor.

##### Gaps
- No primary iBeta letter was opened for any vendor; certification claims come from vendor pages and trade press.
- Onfido/Entrust, Trust Swiftly, iDenfy, Vouched: liveness certification level not researched.
- Whether each vendor's liveness is passive or active by default in the hosted mobile-browser flow (only Didit states both, and Veriff states passive).

#### 3. Coverage of US state driver's licences, UK photocard licences, and passports

##### Takeaway
US and UK licences and passports are covered by every vendor named; this is not a differentiator. What differs is whether the US licence barcode is cross-checked and whether the licence can be confirmed against the issuing DMV.

##### Cited Findings
- Stripe: document and selfie checks are available for US and GB among 100+ countries; driver's licences, national IDs and passports; "passports are widely supported"; 53 interface languages. — [Stripe docs: document checks](https://docs.stripe.com/identity/verification-checks.md?type=document); [Stripe Identity](https://stripe.com/identity)
- Stripe lets the integrator restrict accepted document types (for example driving licence only) via `allow_document_types`. — [Stripe docs: selfie checks](https://docs.stripe.com/identity/verification-checks.md?type=selfie)
- Veriff: 230+ countries and territories, 12,500+ document specimens. — [Veriff plans](https://www.veriff.com/plans)
- [THIRD PARTY] Persona can check US driver's licence records through AAMVA (the DMV network); iDenfy lists direct AAMVA licence verification too. — [beverified.org: Persona vs Veriff](https://beverified.org/compare/persona-vs-veriff/); [iDenfy: best IDV software](https://idenfy.com/blog/best-identity-verification-software/)

##### Inferences
- An AAMVA lookup confirms the licence number exists and matches the DMV record, which is the closest a general vendor gets to what car-rental-specific vendors sell. It is a paid add-on on higher plans (Persona Growth, Veriff Enterprise database verification, Sumsub Custom), not part of the entry prices in section 1.
- None of these checks confirms a UK licence is currently valid or shows endorsements; that needs the DVLA check-code service, which is separate from all of these vendors.

##### Gaps
- No vendor page was found stating state-by-state US licence coverage or PDF417 barcode parsing in so many words (Stripe's "decodes barcodes where available" is the nearest).
- Didit, Sumsub, Trust Swiftly: document-count and country-count figures not captured.
- Whether any vendor checks licence class or validity-to-drive (as opposed to identity) was not found.

#### 4. Fraud signals: duplicate face/identity, blocklists, device and network risk, synthetic identity, database checks

##### Takeaway
Duplicate-face detection across earlier verifications is offered by Veriff, Sumsub and Persona; Stripe documents none. Database checks (SSN, address) are cheap at Stripe ($0.50) but locked to enterprise or custom tiers at Veriff and Sumsub.

##### Cited Findings
- Stripe: ID number check ($0.50) validates name, date of birth and US SSN against databases; address checks are invite-only. The marketing page mentions no duplicate-identity detection. — [Stripe Identity](https://stripe.com/identity); [Stripe docs: verification checks](https://docs.stripe.com/identity/verification-checks)
- Didit: the $0.33 full check includes device and IP analysis. — [Didit pricing](https://didit.me/pricing)
- [THIRD PARTY] Veriff: "CrossLinks" cross-session intelligence and biometric duplicate detection. Sumsub: face matching across applicants and ID portraits. Persona: known-face detection plus visual, device and network signals. — [aifintechindex: Sumsub vs Veriff](https://aifintechindex.com/compare/sumsub-vs-veriff); [beverified.org: Persona vs Veriff](https://beverified.org/compare/persona-vs-veriff/)
- Persona: Growth plan adds fraud-prevention configuration, third-party data reports and "Graph" for linking bad actors; not in Essential. — [Persona help: Plans Overview](https://help.withpersona.com/articles/6oZbzp7jb7AWGClF5vpY3K.md)
- Veriff: database verification is Enterprise-only. Sumsub: database validation and fraud prevention are in the Custom plan only. — [Veriff plans](https://www.veriff.com/plans); [Sumsub pricing](https://sumsub.com/pricing/)
- [THIRD PARTY] Socure bundles KYC + fraud + watchlist with document step-up at about $1.00; its fraud module is estimated to add $0.20 to $0.60 per transaction. — [Signzy US KYC pricing](https://www.signzy.com/blogs/kyc-pricing-us-cost-per-verification)

##### Inferences
- For a multi-tenant product, duplicate detection is only useful if it works across all 60 operators' verifications in one vendor account. That argues for one Drive247-level account rather than one per operator, and it needs confirming with whichever vendor is chosen.
- A shared "banned renter" signal across operators is something Drive247 could build itself on top of any vendor's face or document identifiers, subject to biometric-consent law (see section 6).

##### Gaps
- Whether duplicate-face detection is included in Veriff Essential, Sumsub Basic and Didit's $0.33 price or is a higher-tier feature.
- Synthetic-identity detection: no vendor-published specifics found for the self-serve tiers.
- Blocklist features (custom deny lists of faces or documents) were not confirmed per vendor.

#### 5. Mobile experience and completion: completion/pass rates, time to complete, desktop-to-phone hand-off, auto-capture, languages, native app or browser

##### Takeaway
Only vendor self-reported numbers exist: Veriff claims 95% of users pass first try and a 6-second decision; Sumsub reports 91.64% US and 95.86% UK pass rates. No independent like-for-like completion benchmark was found, so a live trial on real renters is the only way to compare against Drive247's current 57% finish rate.

##### Cited Findings
- Veriff (self-reported): 95% of users complete verification on their first try; most verifications are processed in about 6 seconds. — [Veriff: why Veriff](https://www.veriff.com/about/why-veriff)
- Sumsub (self-reported, its own customers): pass rate United States 91.64%, United Kingdom 95.86%, France 96.39%. — [Sumsub KYC](https://sumsub.com/kyc-compliance/)
- Persona publishes no first-try figure and argues a very high pass rate can indicate false passes. — [Persona blog: pass rate metrics](https://withpersona.com/blog/identity-verification-pass-rate-metrics)
- Stripe: mobile and web capture, 53 languages, AI-guided high-definition capture of front and back with real-time legibility warnings. — [Stripe Identity](https://stripe.com/identity); [Stripe docs: document checks](https://docs.stripe.com/identity/verification-checks.md?type=document)
- [THIRD PARTY] An industry blog puts a typical "good" pass rate at 70 to 95%; definitions vary between "pass rate" (of those who attempt) and "conversion" (of those who start). — [Didit: pass rate benchmarks](https://didit.me/blog/what-is-a-good-identity-verification-pass-rate-benchmarks-optimization/)

##### Inferences
- Vendor "pass rates" are measured among people who submit; Drive247's 43% figure is people who start and never finish. The two are not comparable. The fair comparison is start-to-verified on the same renter population.
- All four self-serve vendors offer a hosted web flow that runs in a mobile browser with no native app, based on their product pages (Stripe's is documented; the others are standard for hosted flows but were not individually confirmed in this pass).

##### Gaps
- Median time to complete, desktop-to-phone hand-off (QR or SMS link) and auto-capture were not confirmed per vendor from primary docs.
- Language counts for Veriff, Persona, Didit and Sumsub not captured.
- No published abandonment (start-to-finish) rate from any vendor.

#### 6. Published accuracy and independent tests; outages, breaches, lawsuits, regulatory actions

##### Takeaway
Independent testing does not identify a winner: the US DHS tests anonymise vendors, and the latest round found most document validation performs poorly. On incidents, Veriff (ID images taken, November 2025), Sumsub (2024 intrusion disclosed in 2026) and Persona (exposed code, several lawsuits) all have recent entries; Onfido and Jumio face Illinois biometric-privacy suits.

##### Cited Findings
- DHS S&T ran the Remote Identity Validation Technology Demonstration (2024) and the follow-up Remote Identity Validation Rally (2025, results early 2026) across document validation, selfie-to-ID match and liveness. Vendors are anonymised in published results; only some (Paravision, ID R&D, Idemia, HyperVerge, Incode) have disclosed their own. — [DHS S&T RIVTD](https://www.dhs.gov/science-and-technology/remote-identity-validation-technology-demonstration); [Biometric Update, March 2025](https://www.biometricupdate.com/202503/understanding-the-results-of-dhs-sts-rivtd-biometrics-assessment)
- Trade press on the 2025 rally's document track: results "suggest most ID document validation disastrously ineffective". — [Biometric Update, February 2026](https://www.biometricupdate.com/202602/dhs-rivr-results-suggest-most-id-document-validation-disastrously-ineffective)
- Incode says it was one of five systems (of 16) meeting all DHS goals in the selfie-match-to-document track. Vendor claim. — [Incode blog](https://www.incode.com/blog/incode-meets-dhs-st-goals)
- Veriff: [THIRD PARTY] a Total Wireless notice says an unauthorised party took government-ID images of 8,583 people from Veriff's systems around 18 November 2025; Veriff reportedly attributes it to a phished client-employee login; class complaints pending, no settlement announced as of late November 2026. — [settlementinsight.com: Veriff](https://settlementinsight.com/veriff-data-breach-lawsuit)
- Sumsub: [THIRD PARTY] disclosed in February 2026 an intrusion dating from July 2024, found in January 2026; the company said biometric data, document images and government ID information were not accessed. — [Zyphe KYC breach tracker](https://www.zyphe.com/resources/blog/kyc-idv-breach-tracker)
- Persona: [THIRD PARTY] around 19 February 2026 researchers found roughly 2,500 files (53MB) of its government dashboard code on a public server; a federal court denied Persona's motion to dismiss an identity-theft suit on 11 March 2026; a further Illinois biometric-privacy suit was reported in October 2026. Four cases, no settlement. — [settlementinsight.com: Persona](https://settlementinsight.com/persona-age-verification-lawsuit); [Consumer Rights Wiki: Persona](https://consumerrights.wiki/w/Persona)
- Onfido: Sosa v. Onfido, an Illinois Biometric Information Privacy Act class action, has a settlement website; Onfido denies wrongdoing. Settlement amount not captured. — [Sosa v. Onfido settlement site](https://onfidobipasettlement.com/)
- Jumio: [THIRD PARTY] Davis v. Jumio, a putative Illinois biometric-privacy class action, with a motion to dismiss denied in 2023. No confirmed public breach for Onfido, Jumio or Socure per one tracker. — [Zyphe KYC breach tracker](https://www.zyphe.com/resources/blog/kyc-idv-breach-tracker)
- IDScan (out of scope here, covered by the other researcher) had a 2026 incident that drew attention to the sector. — [tech-insider: IDScan breach](https://tech-insider.org/idscan-breach-kyc-vendor-risk-reckoning-2026/)

##### Inferences
- Illinois biometric-privacy suits name the verification vendor and can also name the business that deployed it. Drive247 has US operators, so explicit biometric consent text and a retention policy matter whichever vendor is chosen, and matter today for the in-house OpenAI flow.
- Short default retention (Veriff 3 to 6 months; Stripe supports redaction) limits exposure if a vendor is breached.

##### Gaps
- No vendor on this list could be mapped to a named result in NIST face recognition testing or the DHS tests. Stripe, Veriff, Persona, Didit and Sumsub have no independently published accuracy figures that I found.
- The breach and lawsuit items come from trackers and legal-marketing sites, not court dockets or the vendors' own notices; dates and counts should be confirmed before being quoted to anyone outside the team.
- No Stripe Identity or Didit breach or lawsuit was found; absence in this search is not proof of none.
- Outage history (status pages) was not checked.

#### 7. What independent reviewers and developers say about false rejections and support

##### Takeaway
I found no Reddit or Hacker News threads in this pass; what exists is secondary comparison sites. Their common theme: Stripe is easiest to integrate but opaque when it rejects someone, and no vendor publishes independently verified false-rejection rates.

##### Cited Findings
- [THIRD PARTY] Stripe Identity: "frequent end-user complaints of instant, unexplained rejections with only generic, template support replies", while its developer experience is rated above Veriff's; Stripe publishes no accuracy or fraud-detection rates. — [apibenchmarks: Stripe Identity vs Veriff](https://apibenchmarks.com/kyc/compare/stripe-identity-vs-veriff); [Kanopy Labs comparison](https://kanopylabs.com/blog/stripe-identity-vs-onfido-vs-veriff)
- [THIRD PARTY] Veriff: some user reviews report false declines; Veriff and iDenfy are described as the only vendors that put accuracy numbers on their sites, neither independently benchmarked. — [rfp.wiki: Persona vs Veriff](https://www.rfp.wiki/it-security/identity-verification/persona/veriff); [verifier.org](https://verifier.org/stripe-identity-alternatives)
- [THIRD PARTY] Persona: publishes no false-accept or false-reject rates; Trustpilot end users are said to report repeated rejections, camera failures and unhelpful error messages (the source page is thin). — [verifier.org](https://verifier.org/stripe-identity-alternatives)
- G2 hosts side-by-side review pages for Sumsub, Veriff and Entrust IDV (formerly Onfido); scores were not extracted. — [G2: Sumsub vs Veriff](https://www.g2.com/compare/sumsub-vs-veriff)

##### Inferences
- Veriff Plus ($1.39) is the cheapest published option that puts a human reviewer behind the automated decision, which is the usual remedy for false rejections of genuine but worn or unusual licences.
- Because the evidence here is thin and second-hand, the report should not rank vendors on false rejections. A two-vendor pilot on a few hundred real renters, measuring start-to-verified rate, would give Drive247 its own number.

##### Gaps
- No first-hand Reddit, Hacker News or G2 review text was read; G2 star ratings and review counts per vendor are missing.
- No information on support response times for self-serve plans (Persona Essential is email-only per third-party summaries; others unknown).
- Didit and Trust Swiftly: no independent reviewer commentary found.

---

## Appendix C. Notes: licence status, driving records and fraud

### Licence status checks, driving record checks, and rental fraud (US and UK), as of November 2026

Reader notes:
- Research date 2026-11-26. Not legal advice; this reports what sources say.
- "Fetched" = I opened the page and read it. "Search summary" = the fact came from a search-result summary of that page and the page itself was not opened; treat as lower confidence.
- Prices are tagged **[vendor-published]** or **[third-party]**.

#### 1. United States: document verification vs licence validity check (AAMVA DLDV) vs full MVR; who sells them, price, speed

##### Takeaway
There are three different products: (a) document verification says the card looks genuine; (b) AAMVA DLDV says the data on the card matches the issuing state's file (true/false per field, about 44 jurisdictions, no driving history and no explicit valid/suspended field in AAMVA's own description); (c) an MVR is the state driving record (status, suspensions, violations, crashes) and costs a vendor fee plus a state fee that averages about $10. A middle product now exists for rental specifically: a "driver's licence status check" from Checkr Trust that returns valid/active in under 2 seconds without the state MVR fee.

##### Cited Findings

**What DLDV is and is not (primary source)**
- DLDV gives "commercial and government entities ... the real-time capability to verify DL/ID information against data from the issuing agency." It verifies "1) that the DL/ID exists; and 2) whether or not the DL/ID presented is attached to the attributes on the credential." (fetched PDF) — [AAMVA DLDV Overview for Customers](https://www.aamva.org/getmedia/cb603635-3454-4331-b2c6-288d894f7fc4/AAMVA-DLDV-Overview-for-Customers.pdf)
- DLDV returns a True/False indicator for each attribute submitted. Attributes that can be submitted: document number, state code, first/middle/last name, suffix, street, city, state, zip, issue date, expiration date, eye colour, height, weight, gender. (fetched PDF) — [AAMVA DLDV Overview](https://www.aamva.org/getmedia/cb603635-3454-4331-b2c6-288d894f7fc4/AAMVA-DLDV-Overview-for-Customers.pdf)
- DLDV "does not: 1) return to the requestor the actual data maintained by the Jurisdiction; 2) validate that the physical document is genuine; 3) provide a verification of photo or signature; or 4) store the verification request data." (fetched PDF) — [AAMVA DLDV Overview](https://www.aamva.org/getmedia/cb603635-3454-4331-b2c6-288d894f7fc4/AAMVA-DLDV-Overview-for-Customers.pdf)
- The AAMVA overview describes two access routes: a "Direct DLDV Partner" and a "DLDV Gateway Partner" (an identity management solution sitting between the business and AAMVA). (fetched PDF, diagram) — [AAMVA DLDV Overview](https://www.aamva.org/getmedia/cb603635-3454-4331-b2c6-288d894f7fc4/AAMVA-DLDV-Overview-for-Customers.pdf)
- "AAMVA must approve all customers before implementing DLDV." DLDV is fee-based and AAMVA shares revenue with participating jurisdictions. No rates are published: "Private entities must sign a non-disclosure agreement with AAMVA prior to receiving rate information." The participating-jurisdiction list is shown only as a map graphic on the page. (fetched) — [AAMVA DLDV page](https://www.aamva.org/DLDV/)
- AAMVA's own description of DLDV does not mention returning a licence status (valid / suspended / revoked). (fetched) — [AAMVA DLDV page](https://www.aamva.org/DLDV/)

**DLDV coverage and state quirks (third-party vendor documentation)**
- Ping Identity's documentation (revision dated 12 January 2026) says DLDV covers 44 US jurisdictions, about 73% of the US population; "Coverage and specific fields returned vary by state"; fields matched in its integration are name, date of birth, state and document number. (fetched) — [PingOne Verify AAMVA DLDV docs](https://docs.pingidentity.com/pingone/identity_verification_using_pingone_verify/p1_verify_aamva_dldv.html)
- Same source: Pennsylvania requires explicit written consent from the user before the check; New York carries a significantly higher transaction fee (amount not given). (fetched) — [PingOne Verify AAMVA DLDV docs](https://docs.pingidentity.com/pingone/identity_verification_using_pingone_verify/p1_verify_aamva_dldv.html)
- Same source says the service detects documents that have been revoked, reported lost or stolen. This is a vendor claim and goes further than AAMVA's own description, which only describes per-attribute true/false. (fetched) — [PingOne Verify docs](https://docs.pingidentity.com/pingone/identity_verification_using_pingone_verify/p1_verify_aamva_dldv.html); not stated in [AAMVA DLDV Overview](https://www.aamva.org/getmedia/cb603635-3454-4331-b2c6-288d894f7fc4/AAMVA-DLDV-Overview-for-Customers.pdf)
- Surepass's US driver licence API checks against AAMVA DLDV records and states it "does not provide the driver's full DMV record, photo or address." (search summary) — [Surepass](https://surepass.io/global/usa/driver-license-verification-api/)

**Who resells DLDV and at what price**
- IDScan.net sells a "DMV API" (DLDV); "Calls to the DMV API have a per-scan cost. Contact us for a price quote based on your expected volume." No public price. (search summary) **[vendor-published, quote only]** — [IDScan.net DMV API](https://idscan.net/dmv-api)
- Persona lists "DMV (AAMVA)" as an authoritative-database verification type on its pricing page but publishes no per-check rate for it. (search summary) — [Persona pricing](https://withpersona.com/pricing); API reference exists at [Persona AAMVA verifications](https://docs.withpersona.com/2025-12-08/api-reference/verifications/aamva-verifications)
- Entrust (which owns Onfido) offers an AAMVA data-verification integration; no public price found. (search summary) — [Entrust AAMVA](https://www.entrust.com/products/identity-verification/aamva)
- Base identity-verification prices reported by third-party comparison pages (checked Aug–Oct 2026 per the search summary; exact page per figure not individually verified): Vouched $300/month plus $0.75 per verification (Self Starter monthly) or $0.70 on annual ($3,000/yr); Veriff $0.80 per verification with $49/month minimum (Essential), $1.39 ($99 min, Plus), $1.89 ($209 min, Premium); Persona Essential from $250/month on a 12-month minimum with roughly $1.50 overage (flagged by the source itself as third-party reported). None of these list a separate AAMVA/DMV line price. **[third-party]** — [Signzy KYC pricing comparison](https://www.signzy.com/blogs/kyc-pricing-us-cost-per-verification); [Trust Swiftly pricing comparison](https://trustswiftly.com/blog/identity-verification-pricing-comparison-and-alternatives/); vendor pages [Vouched pricing](https://www.vouched.id/pricing), [Persona pricing](https://withpersona.com/pricing)

**Licence status check (between DLDV and MVR)**
- Checkr Trust sells two "Driver Checks" aimed explicitly at vehicle rental fleets and peer-to-peer vehicle sharing: a "driver's license status check" that verifies a licence is "valid and active" without the state fees of a full MVR, and a full MVR (licence type, violations, suspensions, crash data). Stated result speed: "<2 seconds." Delivered through a single API (docs.checkrtrust.com). No list price on the product page; it claims "Up to 100% savings on MVR fees with driver's license status checks." (fetched) **[vendor-published]** — [Checkr Trust Driver Checks](https://trust.checkr.com/products/driver-checks)
- A Checkr Trust marketing page advertised the licence status check at $5 per check versus about $25 for a full MVR ("Stop paying $25 for an MVR when you only need a license check"), with volume discounts. The page now redirects to the Checkr Trust home page, so the $5 figure could not be re-confirmed. (search summary only) **[vendor-published, unconfirmed]** — [Checkr Trust (redirects)](https://www.checkrtrust.com/?p=4378)

**Full MVR: price and structure**
- Checkr (employment-screening side) publishes: MVR add-on $9.50 per check; continuous MVR monitoring $2.50 per enrolled driver per month; Commercial MVR with CDLIS search $14.50. State DMV access fees are extra, "vary by location, passed through at cost with no markup." Packages start at $29.99 (Basic), $59.99 (Essential), $94.99 (Complete). No minimum stated. No MVR turnaround time stated. (fetched) **[vendor-published]** — [Checkr pricing](https://checkr.com/pricing)
- State MVR fees vary widely: a Checkr Trust state fee chart lists California at $2.00 and Arkansas at $14.20. (search summary; page now redirects) **[vendor-published, unconfirmed]** — [Checkr Trust state DMV fees (redirects)](https://www.checkrtrust.com/?p=1917)
- Verisk reports the national average state MVR fee has risen to $10.65, up more than 25% over the past decade. (search summary; which of Verisk's fee posts carries the figure, and its date, not verified) **[third-party]** — [Verisk: average MVR fees continue to climb](https://www.verisk.com/blog/average-motor-vehicle-report-fees-continue-to-climb/)
- Example of vendor fee plus state fee: a HireRight schedule shows Texas state fee $6.50, total Texas MVR $9.50 (undated university page). **[third-party]** — [LSU HireRight MVR fee schedule](https://complaints.lsu.edu/riskmgt/vehicleuse/mvr-fee-schedule.php)
- SambaSafety publishes compliance forms and tells resellers they must confirm MVRs are used only for FCRA permissible purposes; no public per-report pricing found. (search summary) — [SambaSafety compliance](https://sambasafety.com/compliance/)
- MVRcheck: "The vendor has not provided pricing information" on G2. (search summary) — [G2 MVR Check pricing](https://www.g2.com/products/mvr-check/pricing)

**What peers do**
- Turo's help centre says it may decline a trip based on criminal background, driving record or any other reason. (search summary) — [Turo account verification guide](https://help.turo.com/en_us/account-verification-guide-SycgNVlV9.md)
- Getaround's FAQ (as republished by Comparably; not confirmed on Getaround's site) says it runs a driver record check in real time for every new renter through a DMV integration, with eligibility limits such as 2 or fewer minor violations or at-fault accidents in the past 3 years. (search summary) **[third-party]** — [Comparably Getaround FAQs](https://www.comparably.com/companies/getaround/faqs)
- Avis bars renters with DUI citations within 48 months and lists further restrictions for reckless driving. (search summary) — [Avis DUI policy](https://www.avis.com/en/help/usa-faqs/dui-policy)

##### Inferences
- A document-plus-selfie provider (the RentID class of product) does not by itself tell an operator that the licence is currently valid. DLDV closes the "does this licence number exist with this name and DOB" gap (strong against fabricated and altered licences) but by AAMVA's own description does not return suspension status or history. Only a status check or MVR answers "is this person allowed to drive today."
- Because AAMVA requires approval of every customer and an NDA before even quoting rates, a platform of Drive247's size will realistically buy DLDV through a gateway/reseller (Persona, IDScan.net, Entrust/Onfido, Ping, Vouched, Veriff and similar), not directly.
- Indicative cost stack per US renter, from the figures above: licence status check about $5 (unconfirmed) versus full MVR about $9.50 vendor fee plus roughly $2–$14 state fee, so $12–$25 all-in. A full MVR on every rental would cost four to eight times the $2.99 RentID check; a status check roughly doubles it.
- Real-time (<2 s) is published only for Checkr Trust. Classic employment-style MVR vendors do not publish turnaround; instant return is typical for most states but should be confirmed per vendor and state.

##### Gaps
- The definitive list of DLDV participating and non-participating states: AAMVA shows it only as a map image; I could not extract it. Whether California and New York participate in November 2026 is unconfirmed (New York appears to, given the "higher fee" note; California unverified).
- AAMVA's per-transaction DLDV rate: under NDA, not public. No reseller publishes a per-DLDV-call price either.
- No published 2026 pricing, minimums or turnaround found for SambaSafety, Verisk/IIX DL Verify, Authenticate.com, Socure, Trust Swiftly (driver checks), Embark Safety, MVRcheck or Certn. All appear to be quote-only for this product; needs direct sales contact.
- Whether Checkr Trust's licence status check covers all states and what its minimum commitment is: not on the public page.

#### 2. United States law: FCRA, DPPA, consent, adverse action, platform vs operator credentialing, state limits

##### Takeaway
An MVR bought from a third-party reseller is generally treated as a consumer report under the FCRA, and the underlying DMV data is governed by the DPPA, so the safe pattern is: written renter consent, a documented permissible purpose, and an adverse action notice when a renter is refused because of it. No source found says a state forbids rental companies from checking or refusing on driving record; case law says they are generally not obliged to check beyond a facially valid licence. Whether a platform can hold one credential for all its operators is not answered by any public source found.

##### Cited Findings

**DPPA (18 U.S.C. 2721) – statute text (fetched)**
- (b)(3): disclosure is permitted "For use in the normal course of business by a legitimate business or its agents, employees, or contractors, but only (A) to verify the accuracy of personal information submitted by the individual to the business ...; and (B) if such information as so submitted is not correct or is no longer correct, to obtain the correct information, but only for the purposes of preventing fraud by, pursuing legal remedies against, or recovering on a debt or security interest against, the individual." — [18 U.S.C. 2721, Cornell LII](https://www.law.cornell.edu/uscode/text/18/2721)
- (b)(13): "For use by any requester, if the requester demonstrates it has obtained the written consent of the individual to whom the information pertains." — [18 U.S.C. 2721](https://www.law.cornell.edu/uscode/text/18/2721)
- (b)(6): use by any insurer, insurance support organization or self-insured entity, or its agents or contractors, for claims investigation, antifraud, rating or underwriting. — [18 U.S.C. 2721](https://www.law.cornell.edu/uscode/text/18/2721)
- (b)(14): any other use specifically authorized by the law of the state holding the record, if related to operation of a motor vehicle or public safety. — [18 U.S.C. 2721](https://www.law.cornell.edu/uscode/text/18/2721)
- (c) Resale: an authorized recipient "may resell or redisclose the information only for a use permitted under subsection (b)" and any recipient that resells or rediscloses "must keep for a period of 5 years records identifying each person or entity that receives information and the permitted purpose for which the information will be used," available to the motor vehicle department on request. — [18 U.S.C. 2721](https://www.law.cornell.edu/uscode/text/18/2721)
- Civil liability: a person who knowingly obtains, discloses or uses personal information from a motor vehicle record for a purpose not permitted is liable to the individual. (search summary of statute) — [18 U.S.C. chapter 123, govinfo](https://www.govinfo.gov/content/pkg/USCODE-2023-title18/html/USCODE-2023-title18-partI-chap123.htm)
- EPIC's summary says the DPPA's definition of "personal information" does not include information on a driver's traffic violations, licence status or accidents. (search summary; secondary source) — [EPIC DPPA summary](https://epic.org/the-drivers-privacy-protection-act-dppa-and-the-privacy-of-your-state-motor-vehicle-record/)
- A search result reported that Arkansas, Michigan and Virginia added a state permissible purpose specifically for rental car businesses "rather than rely on one of the more elastic federal permissible purposes to cover rental car agencies." (search summary; originating page not individually verified, likely the Vermont legislature DPPA overview) — [Vermont legislature DPPA overview](https://legislature.vermont.gov/Documents/2020/WorkGroups/Senate%20Government%20Operations/Public%20Records/W~Michael%20Smith~DPPA%20Overview%20for%20SGO~1-23-2020.pdf)

**FCRA**
- Trade press: the FCRA "covers not only credit reports, but all consumer and investigative reports conducted by third parties, including motor vehicle reports." (search summary; written about employment use) — [Automotive Fleet](https://www.automotive-fleet.com/articles/you-may-be-violating-federal-law-when-using-motor-vehicle-records-in-hiring-decisions)
- Driving history "secured by the employer through its own investigation will generally not be considered a consumer report under the FCRA" (i.e. direct-from-state pulls differ from reseller reports; written about employers). (search summary) — [Auto Rental News: how to conduct background checks](https://www.autorentalnews.com/articles/how-to-conduct-background-checks-the-right-way)
- FTC: written permission from the consumer is one way to establish permissible purpose; a report obtained for one purpose may not be used for another. (search summary) — [FTC: what tenant background screening companies need to know](https://search.ftc.gov/business-guidance/resources/what-tenant-background-screening-companies-need-know-about-fair-credit-reporting-act)
- FTC advisory opinion: the "business transaction initiated by the consumer" purpose (Section 604(a)(3)(F)) has limits (it did not cover a landlord pulling a report to consider legal action against a tenant), while authorization obtained at application gives a permissible purpose under Section 604(a)(2). (search summary) — [FTC advisory opinion to Long, 2000](https://www.ftc.gov/policy/advisory-opinions/advisory-opinion-long-07-06-00)
- Adverse action (FTC guidance written for landlords; same statute): if adverse action is taken "based partly or completely on information in a consumer report," notice is required; it must include the name, address and phone number of the reporting agency (including toll-free number) and an explanation of the right to dispute; required "even if the report was only a minor factor"; oral notice is allowed but written is best practice. (search summary) — [FTC: Using consumer reports, what landlords need to know](https://ftc.gov/business-guidance/resources/using-consumer-reports-what-landlords-need-know)
- California's ICRAA defines "consumer report" more strictly than the FCRA. (search summary; employer context) — [Checkr California MVR page](https://checkr.com/background-check/mvr/california)
- Pennsylvania requires explicit written consent before a DLDV check. — [PingOne Verify docs](https://docs.pingidentity.com/pingone/identity_verification_using_pingone_verify/p1_verify_aamva_dldv.html)

**Is there a duty to check, and may a company refuse? (Auto Rental News legal article, 2012, fetched)**
- No state was identified that requires a DMV database check. California, Nevada and Mississippi are given as examples of states requiring the rental employee to visually inspect the licence, compare the signature, and keep a record. — [Auto Rental News: Investigating Renters](https://www.autorentalnews.com/articles/investigating-renters-verifying-licenses-with-the-dmv)
- Flores v. Enterprise Rent-A-Car Co. (Cal. Ct. App. 2010): no duty to investigate the driving record of a renter with a valid licence; the company can apply its own guidelines. — [Auto Rental News](https://www.autorentalnews.com/articles/investigating-renters-verifying-licenses-with-the-dmv)
- Osborn v. Hertz Corp. (Cal. Ct. App. 1988): where the state lets someone keep a licence, a rental company should not be held to a stricter standard. — [Auto Rental News](https://www.autorentalnews.com/articles/investigating-renters-verifying-licenses-with-the-dmv)
- Snyder v. Enterprise (federal district court, California, 2005): despite statutory compliance, a presumption of negligence applied because the licence was actually suspended (the article notes the court did not say this explicitly). — [Auto Rental News](https://www.autorentalnews.com/articles/investigating-renters-verifying-licenses-with-the-dmv)
- Cousin v. Enterprise Leasing (Mississippi, 2007): no duty to check suspension status. Nunez v. A & M Rentals (Massachusetts, 2005): viewing a facially valid licence was sufficient. — [Auto Rental News](https://www.autorentalnews.com/articles/investigating-renters-verifying-licenses-with-the-dmv)
- Negligent entrustment claims typically come from injured third parties arguing the renter's bad record or suspension should have been caught; this is distinct from vicarious liability, which the Graves Amendment addresses. — [Auto Rental News](https://www.autorentalnews.com/articles/investigating-renters-verifying-licenses-with-the-dmv)
- Florida statute 322.38 bars renting a motor vehicle to a person who is not duly licensed. (search summary) — [Florida Statutes 322.38](https://www.flsenate.gov/Laws/Statutes/2025/0322.38)
- New York GBL 391-g prohibits refusing to rent to drivers 18 and over solely based on age (surcharges allowed); described in a 2012 article as the only state doing so by statute. This is an age rule, not a driving-record rule. (search summary; dated) — [Auto Rental News: age restrictions](https://www.autorentalnews.com/articles/car-rental-age-restrictions-negligence-and-the-law)

##### Inferences
- Two DPPA routes fit a renter check: (b)(3) (verify what the renter submitted, to prevent fraud) and (b)(13) (written consent). Written consent captured in the booking flow is the cleanest basis and also satisfies the FCRA "written instructions" purpose, and Pennsylvania's DLDV rule.
- If EPIC's reading is right, licence status and violations are not themselves DPPA "personal information," which may be why a status-only product can be sold more freely than an MVR. This is an inference from a secondary summary, not a confirmed legal position.
- Because DPPA (c) requires resellers to record every recipient and its permitted purpose for 5 years, MVR vendors normally credential the end user. A platform should expect vendors to ask either for each operator to be onboarded as an end user or for Drive247 to sign as a reseller/agent with per-operator records. Which one applies is a vendor contract question; no public source settles it.
- No evidence was found that California or New York restrict refusing a renter on driving record. The California cases point the other way (company may set its own standards; not obliged to check). The practical state-specific constraints found are procedural: licence inspection and signature comparison statutes, Pennsylvania consent, New York age rule, California ICRAA disclosure rules.
- If an operator refuses a renter because of an MVR or status result bought from a reseller, an FCRA adverse action notice naming the vendor is the conservative default. The platform could generate this automatically.

##### Gaps
- No FTC/CFPB guidance or case found that directly addresses MVRs or licence-status checks on rental customers (all guidance found is for employment or tenancy). Whether a status-only check is a "consumer report" is unresolved in the sources.
- Whether a SaaS platform can be the credentialed party for 60 operators, or each operator must be credentialed: no public source; must be asked of each vendor (Checkr Trust, SambaSafety, Verisk).
- I did not verify the current text of California Civil Code 1939.xx or any New York provision for record-check restrictions; the search found none, which is not proof of absence.
- The ARN case-law article is from 2012; later decisions were not checked.

#### 3. United Kingdom: DVLA licence checks (share code, ADD API), resellers, price, consent, insurer expectations

##### Takeaway
The UK has a cheap, authoritative, real-time source: DVLA. The free route is the renter's one-time check code (valid 21 days, single use); the API route is DVLA's Access to Driver Data (ADD) at £0.60 per successful enquiry, which requires an ADD contract and a signed driver declaration (D906/ADD, valid up to 3 years), or a reseller at roughly £1.60–£3 per check. UK self-drive hire insurers make an online DVLA licence check a condition of cover.

##### Cited Findings

**Check code ("View or share your driving licence")**
- The checker needs the last 8 characters of the driving licence number and a check code from the driver; sees vehicles they can drive, penalty points and disqualifications. The code must be used within 21 days and can only be used once. No online fee is stated. Postal alternative costs £5 with form D888/1. "It's a criminal offence to obtain someone else's personal information without their permission." (fetched) — [GOV.UK: Check someone's driving licence information](https://www.gov.uk/check-driving-information)
- To generate the code the driver needs their driving licence number, National Insurance number and postcode. (search summary) — [GOV.UK: View or share your driving licence information](https://www.gov.uk/view-driving-licence)
- The 21-day validity replaced a 72-hour limit from 10 July 2015. (search summary) — [DVLA digital blog](https://dvladigital.blog.gov.uk/2015/07/10/share-driving-licence-changes-to-the-check-code/)
- GOV.UK tells hirers that a car hire company needs their permission in the form of a code to see endorsements. (search summary) — [GOV.UK: Hiring a vehicle](https://www.gov.uk/government/news/hiring-a-vehicle)

**Access to Driver Data (ADD) API (DVLA developer portal, fetched)**
- ADD is "a real time access service to organisations who have a demonstrable business need to check the driving entitlement and endorsement record of drivers." — [DVLA ADD FAQ](https://developer-portal.driver-vehicle-licensing.api.gov.uk/apis/driver-view/driver-view-faq.html)
- Cost: "The only applicable costs will be a £0.60p fee per successful enquiry, this is reviewed annually." Billed monthly by direct debit only. **[official, DVLA-published]** — [DVLA ADD FAQ](https://developer-portal.driver-vehicle-licensing.api.gov.uk/apis/driver-view/driver-view-faq.html)
- It is a cloud REST/JSON API with no DVLA front end; the customer builds its own system. Real-time, 24/7, throttle 10 enquiries per second. Requires a JWT from the DVLA Authentication API plus an API key. — [DVLA ADD FAQ](https://developer-portal.driver-vehicle-licensing.api.gov.uk/apis/driver-view/driver-view-faq.html); [ADD API description](https://developer-portal.driver-vehicle-licensing.api.gov.uk/apis/driver-view/driver-view-description.html)
- Enquiries are permitted only on "legitimate drivers where you are in receipt of a signed data protection declaration"; DVLA recommends its standard "Data Protection Declaration (D906/ADD)". Data must not be used for identity checks. Staff must not check their own record. Business changes affecting ADD must be notified in advance under the ADD Contract. — [DVLA ADD FAQ](https://developer-portal.driver-vehicle-licensing.api.gov.uk/apis/driver-view/driver-view-faq.html)
- Returns entitlements (categories), endorsements, disqualification ("disqualifiedUntil" is the longest current disqualification). Suppressed records return error ENQ037. — [DVLA ADD FAQ](https://developer-portal.driver-vehicle-licensing.api.gov.uk/apis/driver-view/driver-view-faq.html)

**Consent / declaration rules**
- "A Data Protection declaration lasts no longer than three years but may be shortened by DVLA or authority may be withdrawn by the Driver." (search summary of a reseller's published DVLA ADD terms) — [RAM Tracking: DVLA ADD terms](https://www.ramtracking.com/gdpr/terms-dvla)
- "The DVLA D906 form is valid for 3 years from the date it is signed." (search summary) — [Nottingham City Council PN 366](https://www.nottinghamcity.gov.uk/media/oqupccfj/pn-366-driving-licence-checking.pdf)
- Since GDPR (2018): "Consent will no longer be the basis upon which DVLA releases data"; requests "must be supported by a completed and signed D906 Fair Processing Declaration," and the checker must be able to evidence the sign-off with date and time. (search summary) — [Fleet News, May 2018](https://www.fleetnews.co.uk/news/fleet-industry-news/2018/05/21/three-months-to-get-licence-checking-consents-up-to-date)

**Resellers and prices (2026)**
- DAVIS (Licence Check Ltd), G-Cloud 15 pricing: UK electronic driving licence check £1.95 per check; foreign licence check £16.95; Northern Ireland check £14.00; all ex VAT. Uses DVLA ADD for GB licences. (search summary of G-Cloud pricing document dated 2025-10-30; document-to-vendor mapping taken from the search summary) **[vendor-published]** — [G-Cloud 15 pricing document](https://assets.applytosupply.digitalmarketplace.service.gov.uk/g-cloud-15/documents/720983/546580219450771-pricing-document-2025-10-30-1253.pdf); [G-Cloud Driving Licence Checking listing](https://www.applytosupply.digitalmarketplace.service.gov.uk/g-cloud/services/348985891126661)
- Civica DriverCare, G-Cloud 15: driving licence check about £3.10–£3.16 per credit for 2026 at the lowest volume band (two search summaries gave slightly different figures), lower at volume. **[vendor-published]** — [G-Cloud 15 pricing document, Jan 2026](https://assets.applytosupply.digitalmarketplace.service.gov.uk/g-cloud-15/documents/92935/926505821423325-pricing-document-2026-01-30-0838.pdf)
- Experian, G-Cloud 15 (January 2026): driving licence check £8.00 falling to £5.00 at volume, plus a standard API integration fee of £3,000, ex VAT. (search summary; which of the listed G-Cloud documents is Experian's was not verified) **[vendor-published]** — [G-Cloud 15 pricing document, Jan 2026](https://assets.applytosupply.digitalmarketplace.service.gov.uk/g-cloud-15/documents/700542/504112102135282-pricing-document-2026-01-16-2001.pdf)
- Checkedsafe: driving licence checks £1.60 per check, data from DVLA ADD. (search summary) **[vendor-published]** — [Checkedsafe pricing](https://checkedsafe.com/pricing/)
- OptiCheck: from £0.50 per driver per month subscription; says it is directly registered with DVLA ADD (vendor's own claim). (search summary) **[vendor-published]** — [OptiCheck](https://opti-fleet.pages.dev/opticheck-landing)
- GBG publishes additional terms for a "UK Entitlement to Drive Check" inside its ID3global product, i.e. GBG resells a DVLA entitlement check by API. No price found. (search summary) — [GBG ID3global additional terms 0337](https://www.gbgplc.com/legal-and-regulatory/additional-terms-v5/id3global/0337-uk-entitlement-to-drive-check-id-number-200032)
- Logistics UK also runs a driver licence checking service. (search summary) — [Logistics UK](https://logistics.org.uk/services/driver-licence-checking-service)

**Insurer expectations for hire fleets (broker guide, fetched)**
- Alan Boswell (self-drive hire broker): "it is very important that all your self-drive hires are appropriately referenced. If you fail to complete adequate hirer/driver checks you may find your insurance is invalid." — [Alan Boswell: Allianz SDH referencing leaflet](https://webcontent.alanboswell.com/pdf-leaflets/sdh-referencing-requirements-allianz.pdf)
- Allianz requirements per hire: copy of photocard licence (address and ID up to date); online licence check via GOV.UK "check someone's driving licence information"; two proofs of address from separate sources (one primary plus one secondary, or two primary; dated within 90 days; name and address must match the licence); a cleared traceable security deposit; signed rental agreement. — [Allianz SDH referencing leaflet](https://webcontent.alanboswell.com/pdf-leaflets/sdh-referencing-requirements-allianz.pdf)
- Allianz additional criteria: within policy age limits; at least 2 years' driving experience (full UK or EU; AU and NZ accepted with £500 excess); two 3-point convictions acceptable without referral; a single 6-point SP30, SP50 or CU80 acceptable with an additional £1,000 excess; all other 6+ point offences referred; 9 points from three 3-point offences attracts £500 excess; any ban or disqualification must be referred; no more than one fault or outstanding claim in the last three years. — [Allianz SDH referencing leaflet](https://webcontent.alanboswell.com/pdf-leaflets/sdh-referencing-requirements-allianz.pdf)
- "DVLA licence checks can only be carried out on driving licences issued from mainland UK." EU licence holders under 70 resident over 12 months are covered as standard; under 12 months need two proofs plus passport; anything else is referred. — [Allianz SDH referencing leaflet](https://webcontent.alanboswell.com/pdf-leaflets/sdh-referencing-requirements-allianz.pdf)
- If the person paying is not the driver: "Payment via a cleared & traceable method must be obtained by the primary driver/hirer/renter unless otherwise agreed by the insurers." — [Allianz SDH referencing leaflet](https://webcontent.alanboswell.com/pdf-leaflets/sdh-referencing-requirements-allianz.pdf)
- Markerstudy (same broker): same photocard, online licence check and two-proofs rules; a single 4-point offence accepted without referral; accepts full UK, EU, AU, US, CA, NZ and SA licences with at least two years' experience; single 6-point MS90 or IN10 referred. — [Alan Boswell: driver referencing](https://www.alanboswell.com/business-insurance/commercial-motor-insurance/self-drive-hire-insurance/driver-referencing/)

##### Inferences
- In the UK the licence check is effectively mandatory for an insured hire fleet, and the insurer's acceptance rules (points, offence codes, bans, years held) need the endorsement detail that only the DVLA record gives. A document-and-selfie check alone does not satisfy the Allianz or Markerstudy referencing lists.
- Cheapest compliant path for Drive247: collect the renter's check code in the booking flow (free; operator or platform redeems it on GOV.UK, manual). Automated path: a reseller API at about £1.60–£1.95 per check, or direct ADD at £0.60 if DVLA will contract with Drive247 or with each operator.
- The D906/ADD declaration (up to 3 years) was designed for employers re-checking staff. For a one-off hire, the check code fits better; the ADD route needs an e-signed declaration captured per renter, which would then also cover repeat rentals for up to three years.
- The insurer lists also ask for two proofs of address and a traceable payment from the actual driver, which are anti-fraud controls (identity, straw hirer) that a verification product could collect in the same flow.
- Northern Ireland and foreign licences are the expensive exceptions (£14–£17 via DAVIS) and are outside DVLA's online check; insurers refer these.

##### Gaps
- DVLA's ADD eligibility criteria and application route, and whether a software platform can hold one ADD contract on behalf of many hire operators (or must use an approved intermediary): not stated on the developer portal pages read.
- The "older ADD service" versus the new API: the FAQ refers to a "new API service" but I did not find a retirement date for the legacy service.
- No API pricing or product confirmation found for Yoti, Onfido/Entrust, Licence Bureau, Driver Check or FleetCheck for DVLA entitlement checks. Not confirmed that Yoti or Onfido resell a DVLA record check at all.
- The DAVIS/Experian/Civica prices are G-Cloud (public sector framework) list prices; commercial quotes for a hire platform may differ. The mapping of each G-Cloud PDF to its vendor comes from search summaries and should be re-checked before quoting.
- BVRLA guidance on licence checking for members was not retrieved (BVRLA pages returned 404 to the fetcher).

#### 4. Insurance: do rental/fleet insurers or damage-cover providers require or reward checks?

##### Takeaway
UK self-drive hire insurers clearly require specific hirer checks as a condition of cover (see section 3). For the US, no public source was found showing that Bonzah or fleet insurers require or price-reward an MVR or licence status check; the only Bonzah eligibility facts found are age 21+ and a valid domestic or international licence.

##### Cited Findings
- UK: failure to complete adequate hirer/driver checks "may find your insurance is invalid"; requirements split by insurer (Allianz, Markerstudy). — [Alan Boswell: driver referencing](https://www.alanboswell.com/business-insurance/commercial-motor-insurance/self-drive-hire-insurance/driver-referencing/)
- UK: insurer rules turn on points and offence codes (excess loadings of £500–£1,000, referrals for bans and most 6-point offences), which can only be applied with DVLA record data. — [Allianz SDH referencing leaflet](https://webcontent.alanboswell.com/pdf-leaflets/sdh-referencing-requirements-allianz.pdf)
- US, Bonzah: minimum age 21; "Valid for drivers with a domestic or international driver's license or international driver's permit"; eligible vehicles are private passenger vehicles seating 8 or fewer with exclusions. (search summary; text came from a non-Bonzah mirror domain, low reliability) **[third-party]** — [Bonzah FAQ mirror](https://8637bf1485.pages.dev/faq)
- US: the DPPA separately permits insurers and self-insured entities to obtain motor vehicle record data for claims investigation, antifraud, rating or underwriting. — [18 U.S.C. 2721(b)(6)](https://www.law.cornell.edu/uscode/text/18/2721)
- US: an unauthorized driver in an accident can void the authorized renter's coverage, leaving the rental company liable for damage. (search summary) — [Auto Rental News: Identity Theft and Car Rental](https://www.autorentalnews.com/articles/identity-theft-and-car-rental)
- US: a suspended licence can create a presumption of negligence against the rental company even where the statutory visual check was done (Snyder v. Enterprise, as described by ARN). — [Auto Rental News: Investigating Renters](https://www.autorentalnews.com/articles/investigating-renters-verifying-licenses-with-the-dmv)

##### Inferences
- Bonzah's "valid licence" condition means a claim involving a suspended or fake licence is a plausible denial point, so a status check protects the cover the operator has already paid for. This is an inference; no Bonzah document was found stating how licence validity is tested at claim time.
- In the US the insurance incentive is indirect (negligent entrustment exposure, claim denial risk), not a published discount.

##### Gaps
- Bonzah's official policy wording on driver eligibility, excluded drivers and operator obligations was not found on a Bonzah-controlled page. Drive247 has a direct Bonzah relationship and should ask.
- No source found on US commercial fleet/rental insurers (for example on underwriting questionnaires) requiring MVR checks on renters or offering premium credit for them.
- No source found on Inshur or other off-trip fleet covers.

#### 5. Fraud in car rental: patterns, loss size, which check stops which, shared blocklists

##### Takeaway
The dominant theft route is renting with a fake or stolen identity and never returning the car; no reliable industry-wide loss total for rental exists in public sources. In the US there is no shared do-not-rent database open to independents; in the UK the BVRLA runs RISC (about 7,000 risk records) for its members.

##### Cited Findings

**Patterns**
- Las Vegas police detective (International Car Rental Show panel, April 2025; article 7 August 2025): renters use fake IDs to obtain vehicles, which bypasses the more complex embezzlement process. Red flags: one-day rentals with no luggage, sometimes by suspected gang members from other cities, targeting Jeep Wrangler, Dodge Charger and Dodge Ram. "If it's $30 to $40 bucks a day, their intent is to steal your vehicle." (fetched) — [Auto Rental News: Inside the fight to catch rental car thieves](https://www.autorentalnews.com/articles/inside-the-fight-to-catch-rental-car-thieves)
- Same panel: kiosk/self-service counters are weak points because staff assume the renter's information was already collected at reservation. A prosecutor declined a case for lack of evidence because the renter wore a mask at the counter and no unmasked photo existed. Recommended: video surveillance, ID scanner check systems, GPS/telematics. (fetched) — [Auto Rental News](https://www.autorentalnews.com/articles/inside-the-fight-to-catch-rental-car-thieves)
- Same panel: about 50% of the time a rental vehicle is not listed as stolen because the operator lacks the 10-day demand letter, a copy of the driver's licence, or required follow-up. A vehicle only counts as stolen once it has an NCIC number. Recovering a vehicle from Mexico costs $4,500–$7,500 on average. (fetched) — [Auto Rental News](https://www.autorentalnews.com/articles/inside-the-fight-to-catch-rental-car-thieves)
- Identity theft through loyalty accounts: one woman in Orange County, California engineered the theft of 42 rental vehicles from a major rental company in 2012 through a loyalty rewards programme. (search summary) — [Police Magazine](https://www.policemag.com/articles/investigating-identity-theft-and-car-rental); [Auto Rental News](https://www.autorentalnews.com/articles/identity-theft-and-car-rental)
- California Highway Patrol investigator (2014): rental car schemes were rising faster than any other auto fraud trend; offenders "use multiple fraudulent or stolen identities and rent multiple cars." (search summary; dated) — [Claims Journal, 2014](https://amp.claimsjournal.com/news/national/2014/03/12/245815.htm)
- NICB: criminals use fake or stolen IDs to rent cars that are then used in crimes or sold to chop shops; one renter rented six to seven cars from the same company; NICB investigators said it would help if rental agencies shared information about drivers using fake IDs. (search summary) — [NICB Fraud Files: Fake IDs and phony claims](https://www.nicb.org/node/11842)
- Renting for someone else: when a criminal borrows a car from a legitimate renter, police trace the plate to the rental company, not the driver. (search summary) — [Auto Rental News: Identity Theft and Car Rental](https://www.autorentalnews.com/articles/identity-theft-and-car-rental)
- IDScan.net reported a surge in fake ID presentments at rental companies and dealerships in 2025 (vendor press release). (search summary) **[vendor claim]** — [IDScan.net press release](https://idscan.net/press-release/rising-tide-fake-id-presentments-to-dealerships-car-rental-companies/)
- Sumsub (vendor, April 2026): rental fraud schemes lead to losses through chargebacks and stolen assets. No figures. (search summary) **[vendor claim]** — [Sumsub](https://sumsub.com/blog/fraud-prevention-idv-mobility/)
- UK: BVRLA lists the hire-sector risk categories it tracks as identity theft, customer fraud, vehicle theft and poor payment records, and says members can struggle to persuade police to accept crime reports for theft of hire and lease vehicles. (search summary) — [BVRLA RISC Database](https://www.bvrla.co.uk/product/risc-database.html); [BVRLA stolen vehicle reporting](https://www.bvrla.co.uk/fleet-services/stolen-vehicle-reporting.html)
- UK conversion fraud: BVRLA says over half a million vehicles have been found for sale online with live finance agreements, most prevalent on hire purchase (industry-body claim; date and method not verified; relates to finance more than daily rental). (search summary) — [BVRLA: Protection from conversion fraud](https://bvrla.co.uk/resource/protection-from-conversion-fraud.html)

**Loss size**
- No rental-specific national loss total was found in Auto Rental News, NICB or ACRA material. The ARN 2025 panel article gave no loss totals, theft counts or recovery rates. — [Auto Rental News](https://www.autorentalnews.com/articles/inside-the-fight-to-catch-rental-car-thieves)
- Adjacent benchmark (auto lending, not rental): NICB estimates US auto finance fraud exposure at $10.4 billion, expected to rise in 2026, with first-party fraud nearly 70% of vehicle finance fraud. (search summary) — [Insurance Business](https://www.insurancebusinessmag.com/us/news/breaking-news/auto-finance-fraud-reaches-10-4-billion-as-criminals-shift-from-theft-nicb-594148.aspx)
- Federal crime definitions exclude vehicles obtained by fraud and forgery from motor vehicle theft statistics, so official theft figures understate fraud-based acquisition. (search summary) — [Insurance Business](https://www.insurancebusinessmag.com/us/news/breaking-news/auto-finance-fraud-reaches-10-4-billion-as-criminals-shift-from-theft-nicb-594148.aspx)
- Adjacent benchmark (dealerships, not rental): in an eLEND Solutions survey at the 2026 NADA Show, 48% of dealers reported losing four or more vehicles to identity fraud and 24% ten or more. (search summary; exact source page not verified) — [CBT News](https://www.cbtnews.com/?p=236569)
- A "$20 billion annually" rental fraud figure appears in a fraud-prevention vendor blog with no source; not reliable. (search summary) — [FraudFighter blog](https://blog.fraudfighter.com/the-hidden-dangers-of-fraud-in-the-car-rental-industry)

**Shared blocklists / do-not-rent databases**
- US: do-not-rent lists are "not shared industry-wide, it's kept by individual companies," though brands under one parent share (for example Enterprise, National, Alamo). (search summary) — [CBS Sacramento](https://www.cbsnews.com/sacramento/news/rental-car-blacklisting); [AutoSlash](https://blog.autoslash.com/the-rental-car-company-do-not-rent-list-a-notation-no-driver-wants)
- US independents such as Fox, Rent-A-Wreck and Sixt keep their own lists. (search summary) — [First Quarter Finance](https://firstquarterfinance.com/do-not-rent-list/)
- UK: BVRLA RISC is a risk tool for rental and leasing firms holding details of over 7,000 individuals and companies identified as a potential risk; BVRLA states it "is not a 'do-not-rent' database; it provides information to assist in customer qualification decisions." A 2012 BVRLA newsletter cited over 9,000 records. (search summary; BVRLA page returned 404 to direct fetch) — [BVRLA RISC Database](https://www.bvrla.co.uk/product/risc-database.html); [BVRLA: Share data to fight vehicle hire fraud](https://www.bvrla.co.uk/resource/share-data-to-fight-vehicle-hire-fraud.html)
- New Zealand precedent only: rental companies created a shared database of dangerous drivers. (search summary) — [Auto Rental News](https://www.autorentalnews.com/news/car-rental-companies-create-blacklist-for-drivers-in-new-zealand)

##### Inferences
Which check addresses which pattern (my mapping, built from the findings above):

| Pattern | What stops or deters it | Evidence basis |
|---|---|---|
| Fake or altered licence | Document check plus DLDV data match (US) or DVLA record (UK) | DLDV confirms the DL exists and attributes match; it does not judge the physical card |
| Stolen real identity | Selfie/face match and liveness (other researchers), plus payment card in the driver's name; DLDV alone passes a stolen genuine licence | DLDV has no photo check |
| Synthetic identity | DLDV/DVLA (a made-up licence number will not match), proof of address (UK insurers require two) | Allianz referencing list |
| Suspended, revoked, disqualified driver | Licence status check or MVR (US); DVLA check (UK). Not caught by document checks or DLDV as AAMVA describes it | Snyder; ADD returns disqualification |
| Renting for someone else (straw renter) | Payment from the actual driver, face match at handover, additional-driver verification, telematics | Allianz "payment must be obtained by the primary driver" |
| Repeat offenders moving between operators | A cross-tenant blocklist; none exists for US independents | CBS/AutoSlash; NICB wish for sharing |
| Theft / conversion (non-return) | Retained licence copy and unmasked photo, signed agreement, 10-day demand letter process, GPS | ARN 2025 panel |
| Chargebacks | Evidence pack: ID match, signed agreement, traceable deposit, 3-D Secure | Not directly sourced for rental |

- Drive247 already spans about 60 operators, so it could itself be the shared blocklist that US independents lack: a cross-tenant "flagged renter" signal keyed on licence number plus face/ID hash. NICB explicitly says such sharing would help. Legal design matters: in the US a shared list used to deny service starts to look like a consumer reporting function under the FCRA; in the UK, BVRLA positions RISC as decision-support, not a ban list, and UK GDPR applies. This needs legal review before building.
- Half of stolen rentals not being reportable for lack of paperwork suggests the cheapest loss reduction is not another paid check but guaranteed retention of the licence image, a clear face photo, the signed agreement and an automated demand-letter workflow.

##### Gaps
- No credible total for US or UK daily-rental fraud or theft losses, and no ACRA figures, were found. The ARN and NICB material is anecdotal or dated (2012–2014) apart from the 2025 panel.
- No rental-specific chargeback rate found.
- RISC access terms: whether non-BVRLA members or a software platform can query it, its cost, and whether it has an API, were not retrievable (BVRLA pages 404 to the fetcher).
- No statutes on theft-by-conversion timelines (for example state "failure to return" periods) were collected.
- No evidence found of a US commercial shared renter-risk database aimed at independents; absence in search results is not proof none exists.

#### 6. Which checks are worth paying for on every rental and which only on higher-risk rentals

##### Takeaway
No source prescribes a tiering. From the costs and risks above, a defensible reading is: UK, a DVLA check on every hire (it is cheap or free and an insurer condition); US, a document check plus a data match or status check on every new renter, with the full MVR reserved for higher-risk rentals because it costs roughly $12–$25.

##### Cited Findings
- UK DVLA check is free by check code or £0.60 direct / about £1.60–£1.95 via reseller, and is an insurer condition for self-drive hire. — [GOV.UK](https://www.gov.uk/check-driving-information); [DVLA ADD FAQ](https://developer-portal.driver-vehicle-licensing.api.gov.uk/apis/driver-view/driver-view-faq.html); [Checkedsafe](https://checkedsafe.com/pricing/); [Allianz SDH leaflet](https://webcontent.alanboswell.com/pdf-leaflets/sdh-referencing-requirements-allianz.pdf)
- US MVR costs $9.50 plus state fee at Checkr; national average state fee about $10.65 (Verisk); a licence-status check is marketed as avoiding state fees, at about $5 (unconfirmed). — [Checkr pricing](https://checkr.com/pricing); [Verisk](https://www.verisk.com/blog/average-motor-vehicle-report-fees-continue-to-climb/); [Checkr Trust Driver Checks](https://trust.checkr.com/products/driver-checks)
- US courts cited by ARN have generally not required a DMV check where the licence is facially valid, but a suspended licence produced a presumption of negligence in Snyder. — [Auto Rental News](https://www.autorentalnews.com/articles/investigating-renters-verifying-licenses-with-the-dmv)
- Risk markers named by police: short one-day rentals, no luggage, out-of-area renters, unusually cheap daily rate, high-theft models (Wrangler, Charger, Ram), kiosk/unattended pick-up. — [Auto Rental News](https://www.autorentalnews.com/articles/inside-the-fight-to-catch-rental-car-thieves)
- Getaround reportedly runs a real-time driver record check on every new renter; Turo reserves the right to decline on driving record. — [Comparably Getaround FAQs](https://www.comparably.com/companies/getaround/faqs); [Turo](https://help.turo.com/en_us/account-verification-guide-SycgNVlV9.md)
- Continuous MVR monitoring is priced at $2.50 per enrolled driver per month (Checkr), relevant for long or subscription-style rentals. — [Checkr pricing](https://checkr.com/pricing)

##### Inferences
Suggested tiering (inference, to be tested with operators and counsel):

| Check | US | UK |
|---|---|---|
| Document + selfie (RentID class, about $2.99) | Every new renter | Every new renter |
| Data match with issuer | DLDV on every new renter if the IDV vendor bundles it cheaply (44 jurisdictions; fall back to document-only elsewhere) | Covered by the DVLA check |
| Licence currently valid | Status check (about $5, unconfirmed) on every new renter where the operator wants negligent-entrustment protection; otherwise risk-based | DVLA check on every hire (insurer condition; free or under £2) |
| Full driving record | MVR only on higher-risk rentals: under-25s, high-value or high-theft models, long or monthly rentals, gig-driver rentals, lockbox/unattended handover, first-time local renters paying by debit card | Already included in the DVLA result (points, codes, bans) |
| Ongoing monitoring | Only for rentals of a month or more | Re-check per hire or within the 3-year declaration |
| Cross-tenant flag list | Every rental; no per-check cost | Every rental; consider RISC if accessible |

- Re-verification frequency matters to cost: a renter verified once could be re-used across later rentals for identity, but licence status can change, so status is the piece worth refreshing (UK insurers imply per hire; the check code is single-use).
- Lockbox (unattended) handover in Drive247 matches the "kiosk" weak point the prosecutors described, so it is a natural trigger for the stricter tier and for mandatory unmasked face capture.

##### Gaps
- No published operator data on how much fraud or loss each added check actually prevents (no measured lift), so the tiering cannot be justified by return on spend from public sources.
- No source on how independents currently tier checks.
- RentID's own coverage of DLDV, licence status or DVLA checks was outside my scope and was not researched; whether the $2.99 includes any issuer data match changes this table materially.

---

## Appendix D. Notes: platform fit and compliance

### Platform fit, integration and compliance of identity verification vendors for Drive247 (as of 26 Nov 2026)

Scope: RentID, Stripe Identity, Veriff, Persona, Didit, Sumsub, Onfido (Entrust), Authenticate.com, Checkr, Trust Swiftly, IDScan.net. Prices and accuracy are out of scope. Not legal advice.

Reading notes for the report writer:
- "Search snippet" means the claim came from a search result summary and the page itself was not opened; treat as lower confidence.
- Several vendor pages blocked automated fetching (Persona security page, Entrust privacy notice PDF: HTTP 403) or were too long to reach the relevant section (Stripe Services Terms). These are listed under Gaps.
- Most "platform model" facts come from vendor marketing or docs, not from signed contracts. Master agreements and DPAs are mostly not public.

#### 1. Integration: hosted page, embed, SDKs, API, webhooks, sandbox, docs, time to integrate, retrieving results

##### Takeaway
Stripe Identity, Veriff, Persona, Didit, Sumsub and Onfido (Entrust) all publish full developer docs with a hosted link, web embed, mobile SDKs, REST API, signed webhooks and a test mode; Stripe is the smallest lift for Drive247 because the Stripe SDK, keys and webhook handling already exist. Trust Swiftly, Authenticate.com, IDScan.net and Checkr are usable but thinner or shaped for another use (hiring), and RentID publishes no developer documentation at all.

##### Cited Findings

**Stripe Identity**
- Stripe Identity "allows you to: Verify the authenticity of government-issued ID documents from more than 120 countries… Match government-issued photo IDs with selfies, and validate Social Security numbers (SSNs)… Access collected images, and extracted data from government-issued ID documents." — [Stripe Identity docs](https://docs.stripe.com/identity)
- After creating a session you "display a verification modal using the session `client_secret` or send your users to the session's `url`" (so both an embedded modal and a hosted redirect). "If your API key is in test mode, verification checks won't actually process, though everything else will occur as if in live mode." — [Create a VerificationSession](https://docs.stripe.com/api/identity/verification_sessions/create)
- Session events delivered by Stripe webhooks: `identity.verification_session.created`, `.processing`, `.verified`, `.requires_input`, `.canceled`, `.redacted`. — [Verification Sessions API](https://docs.stripe.com/identity/verification-sessions)
- Name, address, document type, issuing country and status are readable with the normal secret key. Date of birth, document number, expiry date, ID number, document images and face images are not: "Access to more sensitive fields require restricted API keys." — [Access verification results](https://docs.stripe.com/identity/access-verification-results)
- "Restricted keys — Allow access to sensitive verification results for verifications processed in the last 48 hours. IP restricted keys - Allow access to sensitive verification results for all verifications." — [Access verification results](https://docs.stripe.com/identity/access-verification-results)
- Images: "FileLinks for document and selfie files must expire within 30 seconds. We recommend not downloading the file contents on your server, instead send the FileLink URL to the client to display the image." Stripe also says "don't make copies of the file contents, and redact sessions and collected images when you're done using them." — [Access verification results](https://docs.stripe.com/identity/access-verification-results)
- Sessions accept `metadata`, `client_reference_id` ("can be used to reconcile this verification with your internal systems"), `related_customer`, `related_customer_account`, `related_person`, `return_url`, and `verification_flow` (a reusable configuration from the Dashboard). — [Create a VerificationSession](https://docs.stripe.com/api/identity/verification_sessions/create)

**Veriff**
- Docs index lists: a redirect guide ("Redirect users to Veriff web flow with session management"), InContext ("Embed verification flow directly within your web application"), a JavaScript SDK, and iOS, Android, React Native and Flutter SDKs. — [Veriff developer docs index](https://devdocs.veriff.com/llms.txt)
- API covers sessions, decision ("Access session decisions via the API"), person data, media, and deletion ("Request session deletion with Veriff's API"). Security: "Implement secure API and webhook communication with HMAC signatures." Test and live integrations are separate ("Learn about Veriff's test and live integrations, how to create and test them"). — [Veriff developer docs index](https://devdocs.veriff.com/llms.txt)
- Getting-started flow: "Set up webhooks to get replies from Veriff" and "Receive the webhook with session result and verified data"; a Postman collection and demos are linked. — [Veriff getting started](https://devdocs.veriff.com/docs/getting-started)

**Persona**
- Persona says data "can be exported or deleted programmatically via API or through the dashboard" and offers "field-level redaction" to permanently delete specific PII fields "like a government ID number or selfie image, while preserving the verification record" (search snippet of Persona's security page). — [Persona security](https://withpersona.com/security)
- Persona has white-label theming for web flows through a Theme Editor, with separate theming docs for mobile SDKs (search snippet). — [Persona theming docs](https://docs.withpersona.com/v2021-05-14/docs/theming)
- Persona's docs are versioned by date (default version 2026-09-29) and expose an MCP server for AI coding tools. — [Persona docs index](https://docs.withpersona.com/llms.txt)

**Didit**
- Docs index lists a hosted flow ("Verify a user's identity with Didit's hosted flow"), web integration as "JavaScript, redirect, iframe, WebView", and native SDKs "iOS, Android, React Native, Flutter". — [Didit docs index](https://docs.didit.me/llms.txt)
- API: `POST /v3/session/` to create; decision retrieval returns the "full decision payload"; a PATCH endpoint edits OCR-extracted fields; session deletion "returns a per-session face_retention_outcome". Webhooks use "HMAC signature verification". Sandbox: "Test every outcome without real data or billing." — [Didit docs index](https://docs.didit.me/llms.txt)
- Didit labels its quickstart "Integrate in 5 min" (vendor claim). — [Didit resellers page](https://didit.me/solutions/resellers/)

**Sumsub**
- Docs index lists permalinks ("Create permalinks to share with your applicants without complex integration"), WebSDK (2.0), iOS and Android SDKs, and React Native, Flutter, Capacitor and Cordova plugins. — [Sumsub docs index](https://docs.sumsub.com/llms.txt)
- API: "Get applicant data", "Get applicant data by externalUserId", "Get document images", "Reset applicant profile", "Deactivate applicant profile". Sandbox: "Test your integration in an isolated environment before going live"; production needs "Request production access to go live." — [Sumsub docs index](https://docs.sumsub.com/llms.txt)
- The index lists webhooks, a webhook manager and webhook logs with resend, but the signature header was not named in the index. — [Sumsub docs index](https://docs.sumsub.com/llms.txt)

**Onfido (Entrust)**
- "Following the acquisition, Onfido is now known as Entrust." Docs list Smart Capture Link ("light integration", the hosted option), a Web SDK, iOS, Android, React Native and Flutter SDKs, Workflow Studio, an Autofill (data extraction) product, and "Manual webhook signature verification". — [Entrust IDV docs index](https://documentation.identity.entrust.com/llms.txt)
- The API lets you "generate SDK tokens, create applicants, create and retrieve Studio workflow runs"; webhooks can be configured in the dashboard or by API (search snippet). — [Entrust API reference](https://documentation.identity.entrust.com/api/latest/)
- A third-party guide says Onfido webhooks are signed with an `X-SHA2-Signature` header and that a circuit breaker can disable an unreliable webhook receiver. — [Hookdeck guide (third party)](https://hookdeck.com/webhooks/platforms/guide-to-onfido-webhooks-features-and-best-practices)

**Trust Swiftly**
- "Trust Swiftly uses a secure, unique Magic Link for this process." Mobile is handled with WebView samples, not a native SDK. REST endpoints shown: `POST /api/users`, `GET /api/users`, `GET /api/users/{id}`, `POST /api/verify-credentials`. A `verification.completed` webhook exists with a signing secret under Settings > Webhooks. — [Trust Swiftly developer docs](https://docs.trustswiftly.com/llms-full.txt)
- In the portion of the docs read (first 100,000 of about 242,000 characters), no sandbox was described and the Users API returned verification statuses, not extracted data or images. — [Trust Swiftly developer docs](https://docs.trustswiftly.com/llms-full.txt)

**Authenticate.com**
- Medallion is the pre-built hosted flow; the docs list "Get User JWT for Medallion", an "Embed within an IFrame" page, mobile WebView guidance, and a "Mock APIs" section that "mimics" production endpoints for testing. Webhooks: "The client has to code this `webhookURL` on their end to receive any asynchronous data." No webhook signing is mentioned in the index. — [Authenticate.com docs](https://docs.authenticate.com/)
- Coverage beyond ID: "Knowledge Based Authentication, Photo ID & Passport Verification, Age, Employment, Education & Criminal Background Checks, MVR & DMV Records" (search snippet). — [Authenticate.com identity product](https://authenticate.com/products/identity)

**Checkr**
- Checkr's partner integration lets partners "seamlessly connect your customers' Checkr accounts"; partners get "a staging account"; the average implementation timeline is stated as 2 weeks. — [Checkr partner docs](https://docs.checkr.com/partners/)
- Checkr Trust "offers PII validation and document verification through a flexible API" and lists "vehicle rental and sharing" among its industries. — [Checkr Trust Identity Checks](https://trust.checkr.com/products/identity-checks)

**IDScan.net**
- Two paths: "The DIVE API option allows you to build a web application of your own design where end users will collect images of their documents"; DIVE Online is a ready portal. SDKs are available for native integration (search snippet). — [IDScan DIVE API manual](https://docs.idscan.net/dive/dive-api/api-v4-manual.html)

**RentID**
- RentID is a pre-rental driver verification product for "rental operators, rideshare fleets, dealerships and mobility programs", with results delivered "in a web interface". The public site mentions no API, SDK, webhooks, sandbox or developer docs. The Enterprise tier says only "Plug-In & Play: Drop effortless driver + insurance checks into your workflow." — [RentID](https://rent-id.io)
- Licence status checks with the state DMV are limited to CT, DC, FL, GA, ID, KS, MN, MO, NE, NJ, ND, RI, TX, WA, WV and WI. — [RentID](https://rent-id.io)

##### Inferences
- Stripe Identity is the only vendor that needs no new vendor account, SDK or webhook endpoint for Drive247, but storing licence images in Drive247's own storage runs against Stripe's stated guidance ("don't make copies of the file contents"), and reading DOB, licence number, expiry or images after 48 hours needs an IP-restricted key. Whether Supabase edge functions can present a fixed IP for that key was not checked and should be confirmed before choosing Stripe.
- For Drive247's need to keep name, DOB, licence number, expiry and images in its own database, the vendors with a documented API for both extracted fields and images are Veriff, Persona, Didit, Sumsub and Onfido. Trust Swiftly's and Authenticate.com's public docs did not show extracted-field or image retrieval in what was read.
- RentID looks like a dashboard product, not a developer platform; an integration would depend on a private Enterprise arrangement.
- Checkr's core partner model (each customer holds its own Checkr account, connected by OAuth) is the opposite of "one Drive247 account for all operators".

##### Gaps
- Typical integration time: only Didit ("5 min" quickstart) and Checkr ("2 weeks") publish a figure. No vendor-neutral figures or developer-forum reports (Hacker News, Reddit, GitHub) were gathered; this source type was not searched.
- Persona's integration detail (hosted link, embedded flow, mobile SDKs, webhook signing, sandbox) was not confirmed from its docs; only the top-level docs index was reachable.
- Onfido docs index did not list a sandbox page or a documents-download page; not confirmed either way.
- The second half of Trust Swiftly's docs was not read, so sandbox, data retrieval and deletion may exist there.
- RentID: no public API or docs found. Whether one exists privately is unknown.

#### 2. Platform model: one account for many businesses, resale and re-billing, partner programmes, per-operator branding and usage reporting

##### Takeaway
Didit is the only vendor found that openly documents the exact model Drive247 wants (one application per client with its own keys, webhooks and branding, resale price up to you). Veriff and Persona have formal partner or reseller programmes but require joining them; Sumsub's and Persona's standard terms forbid resale without consent; Stripe forbids "reselling as an independent ID verification service".

##### Cited Findings

**Didit**
- "Create one application per client"; each application has its own workflows, API keys and webhooks. "The decision goes to the webhook set on that client's application." Reselling is described as "offering identity checks to your clients while Didit runs them", and pricing to clients is up to the reseller. — [Didit resellers page](https://didit.me/solutions/resellers/)
- "Logo, colours and texts are set per application on every plan, at $0.10 per finished session." "A client's own domain needs Scale or Enterprise." — [Didit resellers page](https://didit.me/solutions/resellers/)
- Custom domains use a CNAME to Didit with an auto-provisioned TLS certificate; the white-label add-on must be enabled by sales (search snippet). — [Didit white label](https://didit.me/products/white-label/)
- Docs list a Billing page covering "plans, usage, receipts and auto top-up" and a Billing API for balance and top-ups. — [Didit docs index](https://docs.didit.me/llms.txt)

**Veriff**
- Veriff's partner programme is called R.E.V. (Revenue Expansion with Veriff). Its framework "allows partners to integrate, whitelabel, resell, refer, implement, or any combination of these". One of three partner types covers "technology partners who typically integrate our technology into theirs, and white label it." Launched 2022. — [Veriff press release](https://prnewswire.com/news-releases/veriff-launches-global-partner-program-to-give-partners-a-simple-and-effective-path-to-growth-and-increased-revenues-301611537.html)
- Veriff's End-User Terms forbid users to "sublicense, sell, resell, timeshare, or similarly exploit the Service". Note these are the terms for people being verified, not the customer contract. — [Veriff End-User Terms](https://www.veriff.com/end-user-terms)

**Persona**
- "Reselling Persona products and services as part of the Startup Program or the above plans is prohibited and can present a bad experience for your clients and customers. If interested in reselling services, you'll need to join our Reseller Partner Program." — [Persona pricing](https://withpersona.com/pricing/)
- Persona's Connect feature shares data between organisations through an "Organization Bridge"; it was described as Closed Beta on the page (search snippet). — [Persona Organization Bridges](https://docs.withpersona.com/organization-bridges)

**Sumsub**
- "The Customer is not allowed to resell, sublicense, redistribute, or otherwise make the System and/or the Services (or any materials or results derived therefrom) available to any third party without the Service Provider's prior written consent." — [Sumsub Terms and Conditions](https://sumsub.com/terms-and-conditions/)
- Docs offer applicant tags ("Quickly locate applicants in your applicant list using tags"), source keys ("Identify your customers by using unique source keys"), branding ("Customize the look and feel of your brand"), a customisable consent screen, and domain management. A Partner Hub page exists. — [Sumsub docs index](https://docs.sumsub.com/llms.txt)

**Stripe Identity**
- Unsupported use: "Reselling as an independent ID verification service or selling or renting the data you receive from Stripe Identity: Resale, provision, or further distribution of identity verification services or data to third parties. For example, your primary business is selling ID verification to other businesses." — [Stripe Identity use cases](https://docs.stripe.com/identity/use-cases)
- Per-operator tagging is possible with `metadata` and `client_reference_id`; metadata "is also available in common reports." — [Verification Sessions API](https://docs.stripe.com/identity/verification-sessions)

**Onfido (Entrust)**
- Docs cover "Smart Capture SDK language and UI customization" and a UI customisation guide for mobile SDKs. The docs index lists no sub-account, multi-account or white-label page. — [Entrust IDV docs index](https://documentation.identity.entrust.com/llms.txt)

**Trust Swiftly**
- Branding can be removed and a custom domain used (Settings > Branding). Templates define which verifications are required. `reference_id` carries your internal user ID. Sub-accounts or multi-tenant features are not mentioned in the portion read. — [Trust Swiftly developer docs](https://docs.trustswiftly.com/llms-full.txt)

**Checkr**
- "Checkr partner integrations authenticate on behalf of customer accounts using OAuth"; connected accounts can be billed "as a consolidated invoice, or individually to each customer"; there is a "revenue share program"; new partner accounts must support Account Hierarchy (search snippets plus partner page). — [Checkr partner docs](https://docs.checkr.com/partners/)

**IDScan.net**
- The DIVE Product Addendum has no express resale or service-bureau clause: "The Product is licensed on a per-Verification basis." Those terms would sit in the Master Services Agreement, which is not on the page. — [IDScan DIVE Product Addendum](https://idscan.net/dive-product-addendum/)

**Authenticate.com**
- The docs index shows no sub-account, companyId or white-label material; the only related items are a "company admin" role and a company webhook endpoint. — [Authenticate.com docs](https://docs.authenticate.com/)

**RentID**
- No white-label, multi-location, partner or reseller programme is mentioned on the site. — [RentID](https://rent-id.io)
- A related domain describes "Rentid — The rental operating system for independent hosts" and "Car Rental Platform, Insurance & Back Office, All In One Place", plus a "Rentid Enterprise — Mobility platform and marketplace APIs" page (search result titles; the enterprise page returned only its headline). — [Rentid](https://www.rentid.io/), [Rentid Enterprise](https://www.rentid.io/enterprise)

##### Inferences
- Drive247 charging operators a per-check fee or a monthly add-on is closer to "resale" than to internal use. Under the wording found, that needs written consent from Sumsub, the Reseller Partner Program at Persona, and partner status at Veriff. Didit permits it by design.
- Stripe's ban is worded around a business whose "primary business is selling ID verification to other businesses". Drive247's primary business is rental software, so bundling verification is arguably outside the ban, but a separately priced per-check line item is a grey area. This should be put to Stripe in writing.
- If rent-id.io and rentid.io are the same company (the rent-id.io footer says "Rentid, Inc."), RentID is also a rental-management platform for independent hosts, which would make it a direct competitor of Drive247 holding Drive247's renter data. This link is not confirmed.
- Per-operator usage reporting is achievable with any vendor that takes a tag, metadata or reference field (Stripe, Sumsub, Trust Swiftly, Didit applications), because Drive247 can count its own sessions by operator in its own database; vendor-side sub-accounts are a convenience, not a requirement.

##### Gaps
- No vendor's master services agreement was read, so "verify on behalf of downstream businesses" wording is unconfirmed for every vendor except the snippets quoted above.
- Terms for Veriff's and Persona's partner programmes (minimums, revenue share, who contracts with the end business) are not public.
- Onfido/Entrust, Authenticate.com, Trust Swiftly, IDScan.net, Checkr Trust and RentID: nothing published on reseller rights was found. Treat as "publishes nothing".
- Whether per-operator consent text can be set was confirmed only for Sumsub (customisable consent screen) and Didit ("texts are set per application"). Not confirmed for the others.
- Veriff's vendorData / per-integration tagging was not confirmed from the docs index.

#### 3. Stripe Identity specifically: Connect, restrictions, platform access to data and images

##### Takeaway
Stripe documents Identity with Connect only for verifying the people who own a connected account (onboarding), not for running or billing renter verifications on each operator's connected account; no Stripe source found says per-connected-account billing of Identity is possible. The platform can read verified data and images, but under tight key and time limits, and several use-case restrictions touch a car rental business.

##### Cited Findings
- Connect link that is documented: "Use the related_person parameter to associate the session with a person from one of your connected accounts who's required to provide a document or proof_of_liveness" (API version 2025-06-30). This is for a connected account's own Person during onboarding. — [Stripe changelog: related person](https://docs.stripe.com/changelog/basil/2025-06-30/identity-related-person)
- The Identity overview's only Connect link is "Additional verifications for Connect: Collect additional identity verification as part of Connect onboarding." — [Stripe Identity docs](https://docs.stripe.com/identity)
- The create call also accepts `related_customer` ("Customer ID") and `related_customer_account` ("The ID of the Account representing a customer."). The reference page itself says nothing about connected accounts or the `Stripe-Account` header. — [Create a VerificationSession](https://docs.stripe.com/api/identity/verification_sessions/create)
- Availability: "Stripe Identity is generally available for businesses based in" GB, JP and US; other listed countries are in self-serve public beta. — [Stripe Identity use cases](https://docs.stripe.com/identity/use-cases)
- "Eligibility to use Stripe Identity depends on a combination of your business location, how you plan to use Stripe Identity, and the type of business you operate." — [Stripe Identity use cases](https://docs.stripe.com/identity/use-cases)
- Unsupported uses include: reselling ID verification or its data to third parties; "Eligibility for Credit, Employment, Housing, or Insurance or any 'Permissible Purpose' under the US Fair Credit Reporting Act (FCRA)… This only applies to businesses that are using Identity for an activity that is covered by the US FCRA"; government or law-enforcement use; "Verifying anyone considered a minor or who is under the age of 16"; verifying residents of Russia or China. — [Stripe Identity use cases](https://docs.stripe.com/identity/use-cases)
- "for the purpose of using Stripe Identity as a stand-alone service and only in the US or UK, the following restricted business categories may use Stripe Identity without pre-approval: Financial products and services… Tobacco, Travel". — [Stripe Identity use cases](https://docs.stripe.com/identity/use-cases)
- Data access by the account holder: DOB, document number, expiry, ID number, document images and face images need a restricted key with "Identity Verification Results" and "Recent Detailed Verification Results" permissions; beyond 48 hours the key needs IP restrictions and the "All Detailed Verification Results" permission. — [Access verification results](https://docs.stripe.com/identity/access-verification-results)
- Stripe keeps verification data "in your Stripe Dashboard for 7 years" by default; a session can be redacted sooner. — [Stripe legal considerations](https://support.stripe.com/questions/legal-considerations-for-handling-id-verification-data-for-your-business)
- Stripe's Identity terms let a business offer an alternative verification method to anyone who declines selfie verification, and require the business's privacy policy not to contradict Stripe's rights to use Submitted Data (search snippet; clause text not retrieved). — [Stripe Identity Terms](https://stripe.com/legal/identity)

##### Inferences
- The safe reading is: Drive247 would run Identity on its own platform account, pay Stripe itself, and recover the cost from operators through its existing subscription or Connect billing. "Billed to each connected account" is not something Stripe documents.
- If the session is created on the platform account, the platform holds the data and images; operators would see them only through Drive247's portal. That fits Drive247's current design.
- The FCRA exclusion matters if verification output is used to decide insurance eligibility (Drive247 sells Bonzah insurance in the booking flow). Using Identity only to confirm who the renter is, and not to decide insurance eligibility, appears to stay outside it, but this is a legal question to confirm.
- Car rental may fall in Stripe's "Travel" restricted category; the page says Travel businesses in the US or UK may use Identity stand-alone without pre-approval. Whether Drive247 or each operator is the "business" for this test is unclear.

##### Gaps
- The Stripe Identity section of the Stripe Services Terms could not be read (the page is about 670,000 characters and the section was not reached). Exact clauses on permitted use, consent duties and Connect are therefore unquoted.
- No Stripe page was found that says yes or no to: creating a VerificationSession with the `Stripe-Account` header for a connected account's end customers; charging Identity fees to a connected account; whether Standard, Express or Custom account types differ here. This needs a written answer from Stripe support.
- Stripe sources conflict on timings: redaction "may take up to 4 days" ([support](https://support.stripe.com/questions/legal-considerations-for-handling-id-verification-data-for-your-business)) versus "can take up to 7 days" ([docs](https://docs.stripe.com/identity/verification-sessions)).

#### 4. Reuse: recognising a returning renter, and sharing one verification across operators

##### Takeaway
Because Drive247 would hold one vendor account, "sharing across operators" is mostly Drive247's own decision about its own stored result, limited by consent and data-protection rules, not by vendor features. Vendor reuse features exist at Persona, Sumsub, Didit, Veriff, Onfido and Authenticate.com, and usually take the form of a cheaper selfie-only re-check against the first verification.

##### Cited Findings
- **Veriff**: "Verify returning users through facial biometric matching. Available via API, web flow, and SDKs." Selfie2Selfie compares a live face with a reference image. — [Veriff developer docs index](https://devdocs.veriff.com/llms.txt)
- **Persona**: reverification compares a new selfie with the biometric reference from the original verification, so users need not repeat the full flow (search snippet). — [Persona reverification blog](https://withpersona.com/blog/reverify)
- **Persona**: a Reusable Persona lets a user keep verified identity information protected by a passkey and reuse it with other services (search snippet). — [Persona reusable personas blog](https://withpersona.com/blog/reusable-personas)
- **Sumsub**: Reusable KYC Share moves a verified applicant's data from a donor client to a recipient client via a share token; Sumsub "runs fresh checks against the recipient's level settings". "Clients can configure multiple sharing partners in the Dashboard." Same-key reuse is documented only for testing: "the same Sandbox client key can act as both the donor and the recipient." — [Sumsub Reusable KYC Share](https://docs.sumsub.com/docs/reusable-kyc-share)
- **Sumsub**: also lists Face authentication ("Verify applicants with the help of the biometric-based technology"), Sumsub ID, and Copy Applicant. — [Sumsub docs index](https://docs.sumsub.com/llms.txt)
- **Didit**: Reusable KYC is listed as "Free, share KYC across partners"; marketing describes a server-to-server share with a short-lived token and a per-import fee paid by the receiving partner (search snippet; the two statements on cost differ). — [Didit docs index](https://docs.didit.me/llms.txt), [Didit reusable KYC](https://www.didit.me/products/reusable-kyc)
- **Didit**: Biometric Templates are "image-free face templates retained after session deletion (opt-in)". — [Didit docs index](https://docs.didit.me/llms.txt)
- **Onfido (Entrust)**: docs list "Biometric Authentication" and a "Known Faces report". — [Entrust IDV docs index](https://documentation.identity.entrust.com/llms.txt)
- **Authenticate.com**: "ReAuthenticate offers a seamless solution for users previously verified through Medallion" (Beta), with an eligibility endpoint, a link endpoint and a session status endpoint. — [Authenticate.com docs](https://docs.authenticate.com/)
- **Stripe Identity**: reuse in the docs means resuming the same session: "attempt to reuse the same VerificationSession instead of creating a new one." Separately, "If you save your identity information to your Link account, Stripe will retain that information for longer." — [Verification Sessions API](https://docs.stripe.com/identity/verification-sessions), [Stripe Identity FAQ](https://support.stripe.com/questions/stripe-identity-faq)
- **Trust Swiftly**: magic links can be regenerated and follow-up verifications requested; no dedicated returning-user flow in the portion read. — [Trust Swiftly developer docs](https://docs.trustswiftly.com/llms-full.txt)
- **RentID**: reusable verification is not mentioned. — [RentID](https://rent-id.io)

##### Inferences
- With one platform account, Drive247 can skip a new check for a renter it already verified by looking up its own record (for example by customer and licence expiry), with any vendor. The vendor only needs to be involved if Drive247 wants a fresh proof that the same person is present, which is what selfie re-authentication provides.
- Reusing operator A's verification for operator B means sharing personal and biometric-derived data between two separate businesses. The consent text shown at the first check would need to cover that, and each operator is likely a separate controller. This is a legal design question more than a technical one.
- Keeping a face template for re-authentication extends biometric retention, which increases exposure under Illinois, Texas and Washington rules (see section 5).

##### Gaps
- Whether Stripe lets a business accept a Link-saved identity instead of a full new check, and at what price, was not found.
- No price for any re-authentication product was gathered (out of scope).
- IDScan.net and Checkr: no returning-user feature found.

#### 5. Compliance: certifications, GDPR and UK GDPR roles, residency, biometric consent (Illinois, Texas, Washington), retention and deletion, BIPA litigation

##### Takeaway
The large vendors (Stripe, Veriff, Persona, Sumsub, Entrust, Didit) hold SOC 2 Type II and ISO 27001 and act mainly as processors, while keeping a controller role for some of their own uses of biometric data; the smaller ones publish little. Collecting consent inside the vendor's flow does not move liability off the business that required the check: both vendors (Onfido $28.5M, Veriff $4M) and their customers (Sonder and Anthropic via Persona) have been sued under BIPA.

##### Cited Findings

**Certifications and data location**
- Veriff's Trust Center lists a SOC 2 Type II attestation and ISO/IEC 27001:2022, extended to 27017 and 27018, plus GDPR, CCPA, Cyber Essentials and the UK DIATF framework (search snippet). — [Veriff Trust Center](https://veriff.com/trust-center)
- Persona lists a SOC 2 Type II report (security, availability, confidentiality) and ISO 27001; data can be hosted in the US or EU, "processed and stored in the region the customer selects" (search snippet). — [Persona security](https://withpersona.com/security)
- Sumsub: SOC 2 Type II (audited by BARR Advisory), ISO/IEC 27001, 27017, 27018, 22301 and 29003, PCI DSS; a support page cites ISO 27701 and EU and UK GDPR principles; a processors page mentions data storage in Germany; docs list "Local Data Processing" (search snippets). — [Sumsub security and compliance](https://sumsub.com/security-compliance), [Sumsub SOC 2 Type II announcement](https://sumsub.com/newsroom/sumsub-receives-soc-2-type-ii-attestation/), [Sumsub third-party processors](https://docs.sumsub.com/docs/third-party-processors-and-affiliates)
- Didit: "Didit holds SOC 2 Type 1 and Type 2 reports and ISO/IEC 27001 certification." "Data is processed in the EU by default and encrypted in transit and at rest." — [Didit resellers page](https://didit.me/solutions/resellers/)
- IDScan.net says it obtained a SOC 2 Type I report in January 2021 and completed a Type II audit in October 2022 (search snippet). — [IDScan SOC 2 announcement](https://idscan.net/blog/idscan-net-announces-full-soc-2-compliance/)
- Checkr Trust cites NIST PAD Level 2 and IAL 2 compliance for its identity checks (vendor claim). — [Checkr Trust Identity Checks](https://trust.checkr.com/products/identity-checks)
- Trust Swiftly, Authenticate.com and RentID: no certification statements were found on the pages read. — [Trust Swiftly docs](https://docs.trustswiftly.com/llms-full.txt), [Authenticate.com docs](https://docs.authenticate.com/), [RentID](https://rent-id.io)

**Controller, processor and who carries consent**
- Stripe acts as the business's data processor and "does not know your legal obligations and when acting as your data processor, cannot delete data on your behalf." Stripe is also "an independent controller of their personal data". — [Stripe legal considerations](https://support.stripe.com/questions/legal-considerations-for-handling-id-verification-data-for-your-business)
- Stripe "is a data controller of your biometric data as well for fraud and security purposes, and also for improving our biometric verification technology where you've provided consent" (search snippet). — [Stripe: managing your ID verification information](https://support.stripe.com/questions/managing-your-id-verification-information)
- Stripe Identity helps by "obtaining consent prior to the use of their biometric information for the verification" and keeps "a record of the consent (where applicable)". If a customer does not consent, the business may need to offer an alternative such as manual review. The page does not name Illinois, Texas or Washington law, and says there "may be additional obligations that apply to your retention, use, and deletion of this data." — [Stripe legal considerations](https://support.stripe.com/questions/legal-considerations-for-handling-id-verification-data-for-your-business)
- Persona says it primarily acts as a data processor, and may be a controller in limited cases such as Persona Wallet; it says verification data is not sold or used to train AI models (search snippet). — [Persona security](https://withpersona.com/security)
- Entrust "acts as a service provider/processor" when providing the identity services, and is controller "when using Biometric Data directly to improve its Services" (search snippet). — [Entrust product privacy notice](https://www.entrust.com/sites/default/files/documentation/licensingandagreements/product-privacy-notice-onfido-identity-services.pdf)
- Entrust has a US-specific "Facial Scan and Audio Recording Policy": it will not "sell, lease, trade, or… otherwise profit from Biometric Data"; without consent it "will not extract Biometric Data from your photos/videos". Its docs include "Onfido US Biometric Privacy Laws notices and consent (US)" and a migration guide for "collecting US end user consent for identity journeys". — [Entrust facial scan policy](https://www.entrust.com/legal-compliance/data-privacy/facial-scan-policy-and-release), [Entrust IDV docs index](https://documentation.identity.entrust.com/llms.txt)
- IDScan.net's Biometric Data Policy cites the "Illinois Biometric Information Privacy Act, 740 ILCS § 14/1, et seq.", says data is disclosed "to the customer on whose behalf we collected the biometric data", and also says IDScan uses biometric data for its own research and product development. It does not say whether IDScan or the customer collects consent. — [IDScan biometric policy](https://idscan.net/biometric-policy/)
- Didit's compliance material lists "Explicit biometric consent" for Illinois, Texas and Colorado as covered (vendor claim). — [Didit resellers page](https://didit.me/solutions/resellers/)
- Authenticate.com publishes FCRA and Driver's Privacy Protection Act consent material ("Using Regulated Services: Your FCRA Obligations"; a Driving Record Consent exhibit "required for every motor vehicle record request") but nothing on BIPA or biometric consent in the docs index. — [Authenticate.com docs](https://docs.authenticate.com/)
- Rentid's privacy page says users "expressly consent to have your personal data transferred to, processed, and stored in the United States"; no biometric consent flow is described (search snippet; link to rent-id.io unconfirmed). — [Rentid privacy](https://www.rentid.io/privacy)

**Retention and deletion**
- Stripe: "Stripe retains biometric data for one year and non-biometric data for seven years." Sessions can be redacted by API (`POST /v1/identity/verification_sessions/{id}/redact`); "Redaction can take up to 7 days"; metadata is removed too. — [Stripe Identity FAQ](https://support.stripe.com/questions/stripe-identity-faq), [Verification Sessions API](https://docs.stripe.com/identity/verification-sessions)
- A different Stripe page gives about three years for non-biometric identity information (search snippet), which conflicts with the seven-year figure above. — [Stripe: managing your ID verification information](https://support.stripe.com/questions/managing-your-id-verification-information)
- Entrust keeps biometric data "for a maximum of three-hundred and sixty five (365) days" or a shorter period set by the customer; longer options exist through the account manager; a data deletion guide exists (search snippets). — [Entrust facial scan policy](https://www.entrust.com/legal-compliance/data-privacy/facial-scan-policy-and-release), [Entrust data deletion guide](https://documentation.identity.entrust.com/guide/data-deletion/)
- Persona: customers set deletion timelines by user population or data type, with redaction by API or dashboard (search snippet). — [Persona security](https://withpersona.com/security)
- Didit: "You choose how long sessions are kept, up to your plan's maximum"; session deletion by API "supports privacy_erasure instructions". — [Didit resellers page](https://didit.me/solutions/resellers/), [Didit docs index](https://docs.didit.me/llms.txt)
- Veriff: "Request session deletion with Veriff's API." — [Veriff developer docs index](https://devdocs.veriff.com/llms.txt)
- Sumsub: the docs index lists deactivate and reset for applicants and documents; no permanent-delete endpoint appears in the index. — [Sumsub docs index](https://docs.sumsub.com/llms.txt)
- IDScan.net: biometric data kept until the purpose is fulfilled or "three years have passed since your last interaction with us"; Texas identifiers destroyed "no later than one year after the purpose… has expired". The DIVE portal lets admins set retention days, with "31 Days (Maximum)" (search snippet). — [IDScan biometric policy](https://idscan.net/biometric-policy/), [IDScan DIVE portal settings](https://docs.idscan.net/dive/dive-api/web-portal-settings.html)

**BIPA litigation**
- Onfido: Sosa v. Onfido, No. 20-cv-4247 (N.D. Ill.). An OfferUp user sued over face checks Onfido ran for OfferUp. The court refused to send the case to arbitration and rejected a First Amendment defence; Onfido agreed to pay $28.5 million, preliminarily approved 5 May 2023. — [Bloomberg Law](https://news.bloomberglaw.com/privacy-and-data-security/id-verifier-onfido-to-pay-28-5-million-over-biometric-claims), [Orrick InfoBytes](https://infobytes.orrick.com/2023-05-11/id-verifier-pay-285-million-settle-bipa-allegations/), [Biometric Update](https://www.biometricupdate.com/202304/rebuffed-on-arbitration-onfido-calls-it-quits-in-bipa-lawsuit)
- Veriff: McGowan v. Veriff Inc., No. 2021-cv-06706 (N.D. Ill.), $4 million settlement with no admission of wrongdoing; class period 12 Nov 2016 to 5 Dec 2022; final approval reported May 2023. — [Top Class Actions](https://topclassactions.com/lawsuit-settlements/closed-settlements/veriff-facial-scans-4m-class-action-settlement/), [Biometric Update](https://www.biometricupdate.com/202303/veriff-settles-bipa-claim-for-4m-defendants-reaching-for-victory-strategies)
- Persona's customers: a proposed class action alleges Sonder's check-in captured Illinois residents' facial scans without consent, with Persona acting "as contractor for Sonder". — [ClassAction.org](https://www.classaction.org/news/sonder-illegally-captures-facial-scans-of-illinois-renters-class-action-alleges)
- Persona's customers: a Claude user sued Anthropic under BIPA over government ID and selfie checks run by Persona; the complaint argues Anthropic is liable because it required the verification, chose the vendor and set purposes and retention. Early stage, no class certified, no finding of liability. — [ID Tech Wire](https://idtechwire.com/anthropic-faces-illinois-biometric-privacy-claims-over-claude-id-checks/), [Courthouse News](https://courthousenews.com/articles/chatbot-user-files-class-action-against-anthropic-over-biometric-data-policy)
- Other identity vendors sued under BIPA: Jumio, Incode (Aspel v. Incode Technologies), OCR Labs (Yard v. OCR Labs), and Mitek over verification it provided to HyreCar, a car-sharing company (dismissed without prejudice September 2023). — [FindBiometrics](https://findbiometrics.com/as-idv-specialist-settles-bipa-suit-lawyers-aim-at-airbnb-identity-news-digest/), [Aspel complaint](https://www.classaction.org/media/aspel-v-incode-technologies-inc.pdf), [Yard complaint](https://truthinadvertising.org/wp-content/uploads/2024/03/Yard-v-OCR-Labs-complaint.pdf), [Mitek 10-K](https://www.sec.gov/Archives/edgar/data/807863/000095012324002926/mitk-20230930.htm)
- Plaintiff lawyers were reported to be gathering Illinois residents who used Airbnb's identity verification, to pursue mass arbitration. — [FindBiometrics](https://findbiometrics.com/as-idv-specialist-settles-bipa-suit-lawyers-aim-at-airbnb-identity-news-digest/)
- Illinois BIPA is the only biometric privacy law giving "aggrieved" individuals a private right of action (search snippet of law-firm commentary). — [Proskauer](https://www.proskauer.com/blog/wow-illinois-biometric-privacy-suits-proliferate)

##### Inferences
- The cases show plaintiffs suing whichever party they can reach: the vendor (Onfido, Veriff, Mitek) and the business that required the check (Sonder, Anthropic). In Drive247's set-up there are three possible defendants for an Illinois renter: the vendor, Drive247, and the operator. No vendor page found promises to carry that liability for its customer.
- Under UK GDPR and GDPR the likely chain is operator as controller, Drive247 as processor, vendor as sub-processor, with the vendor also an independent controller for its own fraud and improvement uses (stated by Stripe and Entrust). Drive247 would need a DPA with the vendor and to list the vendor in its operator DPAs. This is a reading of the vendors' statements, not a legal conclusion.
- Stripe's and Entrust's flows collect biometric consent themselves and keep a record, which reduces Drive247's build work. Drive247 and operators would still need their own privacy notice and, for Illinois, a published retention schedule covering any biometric data they hold or copy.
- Copying selfies or face images into Drive247's own storage makes Drive247 a holder of biometric-related data in its own right. Storing only extracted text fields and the vendor's pass/fail result keeps that exposure lower.
- Sumsub's standard API appears to deactivate rather than permanently delete; deletion on request may need a support process. To be confirmed with Sumsub.
- Vendors with a published short biometric retention default (Stripe 1 year, Entrust up to 365 days, IDScan DIVE portal maximum 31 days) fit the Texas one-year destruction rule more comfortably than vendors with no stated default.

##### Gaps
- No DPA was read for any vendor. Processor or controller wording above comes from privacy notices, support pages and marketing.
- Washington (My Health My Data Act / biometric statute) and Texas CUBI are not named on most vendor pages read; only IDScan names Texas and Didit names Texas. No vendor statement on Washington was found.
- UK-specific data residency: no vendor page read offers UK-only hosting. Persona offers US or EU; Didit defaults to EU; Sumsub mentions Germany and "Local Data Processing"; Stripe, Veriff, Entrust, IDScan, Trust Swiftly, Authenticate.com, Checkr and RentID: not found.
- No BIPA case naming Stripe Identity, Sumsub, Didit, Authenticate.com, Checkr, Trust Swiftly, IDScan.net or RentID was found. This is absence of search results, not a docket search; PACER or CourtListener was not checked.
- Final approval and payout of the Onfido settlement, and the current status of the Sonder and Anthropic cases, were not confirmed.
- SOC 2 and ISO status for Entrust's identity verification business, Stripe (generally known but not fetched here), Checkr, Authenticate.com and Trust Swiftly were not confirmed from a primary page.
- Veriff's retention period and its Illinois consent mechanism after the settlement were not found; the Veriff data-retention page returned only navigation text.

#### 6. Reliability and vendor risk: uptime, status pages, support, company size and funding, switching cost

##### Takeaway
Stripe, Persona, Sumsub, Veriff and Entrust are large, well-funded companies; Didit, Trust Swiftly, Authenticate.com, IDScan.net and RentID are much smaller and publish little about themselves. Uptime history and support quality were not researched in depth, so this section is thin.

##### Cited Findings
- Persona raised a $200M Series D in April 2025 at a $2B valuation, co-led by Founders Fund and Ribbit Capital; total disclosed funding about $417.5M; founded 2018 in San Francisco (secondary sources). — [Start With Identity](https://startwithidentity.com/vendors/identity-verification/persona/)
- Sumsub is reported to have joined the WEF Unicorn Community in January 2026 at a valuation above $1 billion, with headcount estimates of roughly 990 to 1,050 (secondary sources; another lists 571). — [Tech Insider](https://tech-insider.org/igt-sumsub-vs-onfido-vs-jumio-vs-veriff-for-igaming-kyc-202-en-d177/), [Growjo](https://growjo.com/company/Sumsub)
- Veriff's last priced round was a $100M Series C at a $1.5B valuation in 2022; secondary-market estimates put it nearer $715M by late 2023; it is reported to have acquired Vespia in February 2026 (secondary sources). — [Tech Insider](https://tech-insider.org/igt-regtech-consolidation-2026-ma-in-igaming-kyc-vendors-en-d187/)
- Onfido was acquired by Entrust, completed April 2024, reported at a $650M valuation; the docs still use the Onfido name in the API, dashboard and webhook headers. — [Tech Insider](https://tech-insider.org/igt-regtech-consolidation-2026-ma-in-igaming-kyc-vendors-en-d171/), [Entrust API reference](https://documentation.identity.entrust.com/api/latest/)
- Entrust says existing Classic API integrations remain supported but recommends moving to Workflow Studio for its latest products. — [Entrust classic to Studio migration](https://documentation.identity.entrust.com/getting-started/classic-to-studio-migration/)
- Authenticate.com's docs list a Status Page. — [Authenticate.com docs](https://docs.authenticate.com/)
- RentID: footer names "Rentid, Inc." (copyright 2026); no address, leadership or founding details on the page; terms state "there are no refunds, no warranty or expressed guarantees." — [RentID](https://rent-id.io)
- Sumsub requires a request step before live use ("Request production access to go live"). — [Sumsub docs index](https://docs.sumsub.com/llms.txt)
- Stripe says Identity changes can come with eligibility conditions: "Eligibility to use Stripe Identity depends on a combination of your business location, how you plan to use Stripe Identity, and the type of business you operate." — [Stripe Identity use cases](https://docs.stripe.com/identity/use-cases)

##### Inferences
- Switching cost is driven by two things: what Drive247 stores itself, and whether the vendor holds the only copy of images. If Drive247 stores the extracted fields and decision in its own tables behind one internal "verification provider" interface, any vendor can be swapped with a new adapter. With Stripe Identity the images effectively stay with Stripe (30-second links, guidance against copying), so historic images would be lost on leaving.
- Any re-authentication feature that relies on a face template held by the vendor (Veriff, Persona, Sumsub, Onfido, Didit, Authenticate.com) does not transfer; returning renters would need a full new check after a switch.
- Vendor-risk ranking by company substance, from what was found: Stripe, then Persona, Sumsub, Entrust and Veriff, then Checkr, then the small vendors. RentID carries the most unknowns (no docs, no company details, possible competitor).
- Being an acquired product (Onfido inside Entrust) brings rebranding and migration churn, as the Classic to Studio guidance shows.

##### Gaps
- Status pages and historical uptime were not checked for any vendor. No uptime figures are reported here.
- Support quality: no review-site, Hacker News, Reddit or GitHub evidence was gathered.
- Company size and funding for Didit, Authenticate.com, Trust Swiftly, IDScan.net, Checkr and RentID were not found. Funding figures above for Persona, Sumsub and Veriff come from secondary blogs, not primary announcements.
- Contract terms that affect exit (minimum commitments, data export on termination) are not public for any vendor.

---

## Appendix E. Notes: RentID and rental-specific vendors

### RentID and car-rental-specific driver verification vendors (as of 26 November 2026)

Method note for the report writer: RentID's two sites are JavaScript apps, so their text was read from the pages and their public script bundles on 2026-11-26 (rent-id.io home page; rentid.io bundle `static/js/main.72f7db2b.js`, which carries the Privacy Policy, Terms and About text). Domain ages are from WHOIS run the same day. Prices are marked "vendor page" or "third party". The task brief said "rent-id.io"; the company's main site is the separate domain rentid.io.

#### 1. RentID: who runs it, maturity, what $2.99 buys, API, coverage, compliance, partner terms

##### Takeaway
RentID is the verification product of Rentid, Inc., a very small US startup (founder and CEO Vishaal Pandya; one aggregator lists 2 employees) whose main business is a full car rental platform (booking engine, marketplace, insurance "powered by INSHUR") that competes directly with Drive247. $2.99 buys one "credit", not a defined check: the site never says how many credits each product costs, state DMV fees are billed on top, licence-status checks cover only 15 states plus DC, and there is no public API documentation, no named verification provider, no SOC 2 claim, no biometric (BIPA) language in the privacy policy, and no evidence of UK document support.

##### Cited Findings

**Company and people**
- Legal entity is "Rentid, Inc." / "Rentid Inc." (footer "© 2026 Rentid, Inc."; page metadata author "Rentid Inc"). No street address, state of incorporation or founding year is shown on either site. — [rent-id.io](https://rent-id.io/); [rentid.io](https://www.rentid.io/)
- The About page names "Vishaal Pandya, Founder, CEO" and quotes him: the idea "was born while working with independent car rental hosts on complex insurance issues". No other team member is named. — [rentid.io/about-us](https://www.rentid.io/about-us)
- RocketReach describes RentID as a software development company with 2 employees, lists Vishaal Pandya as "SVP Corporate Strategy" and names Abdel Guizani as founder; SignalHire lists Pandya as "Founder & CEO at rentid" (profile updated 15 Nov 2026). These are data aggregators and they conflict with each other on titles. — [RocketReach RentID profile](https://rocketreach.co/rentid-profile_b6ecb669c6e33a1b); [RocketReach management](https://rocketreach.co/rentid-management_b6ecb669c6e33a1b); [SignalHire](https://www.signalhire.com/profiles/vishaal-pandya's-email/56259706)
- Domain ages (WHOIS, 2026-11-26): rentid.io created 2022-03-26; rent-id.io (the verification product site) created 2025-10-24, so the standalone verification site is about 13 months old. Both are registered through Name.com with privacy protection. — [WHOIS rentid.io](https://www.whois.com/whois/rentid.io); [WHOIS rent-id.io](https://www.whois.com/whois/rent-id.io)
- Rentid exhibited at Terrapinn's MOVE America, where it is described as "AI-native commerce infrastructure for modern car rental" covering "storefronts, payments, operations, insurance, trust & safety". The rentid.io site also has an `/icrs` page for the International Car Rental Show with a booth floor plan. — [Terrapinn exhibitor listing](https://www.terrapinn.com/exhibition/move-America/exhibitor-rentid.stm); [rentid.io sitemap](https://www.rentid.io/sitemap.xml)

**Rentid is a competing rental platform, not only a verification vendor**
- The rentid.io site title is "Car Rental Platform, Insurance & Back Office, All In One Place". Its sitemap lists products RentDirect (branded, white-labelled booking engine), RentShield (insurance), RentID (driver screening), RentAcademy, RentSuccess, RentAI, plus `/marketplace`, `/turo-alternative` and `/getaround` pages aimed at hosts leaving Turo, Getaround and HyreCar. — [rentid.io sitemap](https://www.rentid.io/sitemap.xml); [rentid.io/getaround](https://www.rentid.io/getaround)
- RentShield is branded "RentShield powered by INSHUR" and the site carries an "INSHUR x Rentid" landing section. — [rentid.io](https://www.rentid.io/)
- The site states "Enterprise level APIs to build your platform. Technology partners can gain access to our APIs for bookings, verifications, and insurance", and advertises a "Partner program: Platforms and marketplaces" (status "Now accepting") that includes "White-label booking flows, Operator onboarding, Payments and payouts, Embedded insurance and verification". — [rentid.io/enterprise](https://www.rentid.io/enterprise)
- A third-party rental agreement form (Everlasting Flow Ventures) tells renters their own insurance "will be verified through RentID before final approval", which is one independent sign of an operator using it. — [Jotform rental agreement](https://form.jotform.com/261269006448055)

**Named customers and reviews**
- The only customers shown are first-name testimonials on rentid.io for the platform as a whole: "Meshak F., Texas, 26 vehicles" and "Logan M., Missouri, 177 vehicles" ("With our 177-car fleet, Rentid and INSHUR gave us independence"). No company names, logos or case studies for the verification product. — [rentid.io](https://www.rentid.io/)

**Pricing (vendor page, rent-id.io, read 2026-11-26)**
- Pay-As-You-Go: $2.99 per credit, 10% off the first 30 days, no annual contract. "Additional tax and state fees may apply." — [rent-id.io](https://rent-id.io/)
- Bulk Credits: $2.69 per credit (10% off), minimum order 10 credits, credits expire 1 year after purchase; "15% off with Basic Plan - $2.54/credit". — [rent-id.io](https://rent-id.io/)
- Subscription: $29.99/month, "$35.88 of included monthly credits", "2 FREE credits every month", automatic 15% off bundles; subscription credits do not roll over and are non-refundable. ($35.88 = 12 x $2.99, so the plan appears to give 12 credits for $29.99, about $2.50 each; this arithmetic is mine, the page does not state a credit count.) — [rent-id.io](https://rent-id.io/)
- Enterprise: custom, "Contact Sales". — [rent-id.io](https://rent-id.io/)
- Footnotes: "there are no refunds, no warranty or expressed guarantees"; "Discounts apply to RentID service fees only; state DMV fees are billed separately". — [rent-id.io](https://rent-id.io/)
- The page says "Mix and match services" and "Apply credits to any services" but its "View credit pricing" link is a placeholder and no table shows how many credits each product costs. — [rent-id.io](https://rent-id.io/)

**What the products cover (vendor claims)**
- Five separately selectable products: Identification & Biometrics; Driver License Validity; DMV Criminal Record Check; Motor Vehicle Report (MVR); Personal Insurance Validation. A sixth, "Driver IQ Score", is marked "Coming Soon". — [rent-id.io](https://rent-id.io/)
- Identification & Biometrics: ID plus selfie, selfie-to-document match, liveness detection, and detection of "impersonation, document tampering, and duplicate identities". — [rent-id.io](https://rent-id.io/)
- Driver's Licence Status: validated "with the state DMV" (active / inactive / provisional / suspended), "currently available only in the following states: CT, DC, FL, GA, ID, KS, MN, MO, NE, NJ, ND, RI, TX, WA, WV, and WI". — [rent-id.io](https://rent-id.io/)
- Insurance validation: active personal auto policy, coverage limits, credit card rental coverage, via "direct integration with major insurance providers" (none named). — [rent-id.io](https://rent-id.io/)
- Criminal record check: "state DMV and national data sources", "400+ data points", returns detected / not detected. MVR: violations, accidents, points, suspensions, DUI/DWI. — [rent-id.io](https://rent-id.io/)
- Speed claim: "Most checks complete in under ten seconds". Flow: the operator selects products, enters the driver's email and phone, pays, and reviews statuses in a portal; results are green / yellow / red. — [rent-id.io](https://rent-id.io/)
- Disclaimer: results "supplement—not replace—your independent screening judgment" and Rentid "disclaims all responsibility and liability". — [rent-id.io](https://rent-id.io/)
- The rentid.io platform site also advertises a shared blocklist of repeat offenders and a "DriverIQ" risk score. — [rentid.io/getaround](https://www.rentid.io/getaround)

**API, documentation, technical signs**
- No public API reference, SDK, webhook documentation or developer portal was found on either site; the only API statement is the "Technology partners can gain access to our APIs" line, behind a sales contact. The rent-id.io app's route list includes a `/webhooks` path and the sitemap lists `/api`, so some API surface exists, undocumented. — [rentid.io/enterprise](https://www.rentid.io/enterprise); [rent-id.io sitemap](https://rent-id.io/sitemap.xml)
- The rent-id.io home page loads Google Analytics with the placeholder ID `G-1234567`, its `/privacy` and `/terms` paths return the home page, and its footer links to rentid.io for Terms and Privacy. — [rent-id.io](https://rent-id.io/)
- No underlying identity vendor (Persona, Veriff, Onfido, Stripe Identity, Checkr, etc.) is named anywhere in either site's pages or script bundles. — [rent-id.io](https://rent-id.io/); [rentid.io](https://www.rentid.io/)

**Compliance and privacy (vendor's own policy)**
- The Privacy Policy mentions GDPR and CCPA in general terms ("compliance with the General Data Protection Regulation (GDPR) for users in the European Economic Area and the California Consumer Privacy Act"), with no mention of the UK or UK GDPR. — [rentid.io/privacy](https://www.rentid.io/privacy)
- Data is "processed and stored in the United States"; users outside the US "expressly consent" to that transfer. — [rentid.io/privacy](https://www.rentid.io/privacy)
- Retention is open-ended: "as long as is reasonably necessary to fulfill the purposes... and for any applicable statute of limitations periods". No fixed period. — [rentid.io/privacy](https://www.rentid.io/privacy)
- The words "biometric", "BIPA" and "SOC 2" do not appear in the Privacy Policy or Terms text, even though the product performs selfie face matching. — [rentid.io/privacy](https://www.rentid.io/privacy); [rentid.io/terms](https://www.rentid.io/terms)
- The Terms require hosts to "own a valid business entity located in the United States". — [rentid.io/terms](https://www.rentid.io/terms)
- Security claim on the product site: "encryption, strict access controls, and audit logging". — [rent-id.io](https://rent-id.io/)

##### Inferences
- "$2.99 per check" is not what the vendor page says. It is $2.99 per credit with an unpublished credit cost per product and DMV fees extra. A full screen (ID + licence status + MVR + insurance) may cost several credits plus state fees; the real per-renter cost is unknown until Rentid gives a credit table in writing.
- Rentid is small and early: one named executive, a 2-employee aggregator figure, a 13-month-old product domain, a placeholder analytics tag, missing legal pages on the product site, no public docs, no named customers. Continuity and support risk is high for a platform sending 60 operators' renters through it.
- Rentid sells the same thing Drive247 sells (white-label booking, payments, insurance, verification, to independent operators and ex-Turo hosts) and has a formal INSHUR tie-up. Sending Drive247's operators and renter data to it means handing a direct competitor the operator list and renter identities. That is a commercial risk on top of the vendor-size risk.
- Because a 2-person company is unlikely to have built document forensics, liveness, DMV, MVR, criminal and insurance data connections itself, RentID almost certainly resells other providers. Which ones is undisclosed, so data flows and subprocessors are unknown.
- Licence status in only 15 states plus DC leaves out California, New York, Illinois and most large rental markets. UK use looks unsupported: US-entity requirement in the Terms, US state DMV sources only, no UK mention.
- Selfie biometrics with no biometric consent or retention language is a BIPA exposure for any Illinois renter, and likely falls on the operator and platform as well as the vendor.

##### Gaps
- Funding, investors, incorporation state, founding year, headcount from a primary source: not found (no Crunchbase, LinkedIn or state registry result surfaced; LinkedIn was not reachable through search).
- Credits per product; state DMV fee schedule; whether MVR or criminal checks are FCRA consumer reports and who the consumer reporting agency is: not published.
- Which underlying providers power ID/liveness, DMV, MVR, criminal and insurance checks: not disclosed.
- Supported document countries, and UK licences specifically (including any DVLA check): not stated anywhere.
- API reference, SDKs, hosted-flow embedding, webhook events, sandbox, SLAs, uptime history: none public.
- SOC 2, penetration testing, DPA, subprocessor list, biometric consent text, retention periods: none found.
- Partner/reseller economics for a multi-tenant platform: a partner programme exists in name; terms are sales-only.
- Independent reviews (G2, Capterra, Trustpilot, Reddit, Auto Rental News): none found for RentID.

#### 2. Authenticate.com (driver verification)

##### Takeaway
Authenticate publishes a full pay-as-you-go price list: government ID verification is $2 with face match and liveness free on top, and DMV/MVR is $5 plus state fees, with no monthly minimum. It is US-centric for the driving-record products, and its MVR is an FCRA-regulated report.

##### Cited Findings
- Government ID Verification $2; Facial Recognition & Liveness Detection free once the same person has passed a paid ID, KBA or SSN check; Authoritative Database Identity Verification free on the same condition; KBA $1; SSN verification $1; email and phone verification free; Risk Score $0.50. (vendor page) — [Authenticate pricing](https://authenticate.com/pricing)
- "DMV & MVR Verification" $5 plus state DMV fees at cost; listed under regulated FCRA consumer reports requiring a certified permissible purpose. There is no separate, cheaper licence-status-only line. (vendor page) — [Authenticate pricing](https://authenticate.com/pricing)
- Criminal: US Criminal Database Search free after a paid ID check; Sex Offender Check Pro $1; 7-Year Criminal Activity Verification $5; county and federal searches from $5 plus court fees; Global Watchlist $1; continuous monitoring $5 per person per year. (vendor page) — [Authenticate pricing](https://authenticate.com/pricing)
- No setup fee, no monthly minimum, no long-term contract; prepaid credit from $100, non-refundable, expires after 12 months; volume pricing with a committed monthly spend is by quote. (vendor page) — [Authenticate pricing](https://authenticate.com/pricing)
- Insurance verification is not on the price list. — [Authenticate pricing](https://authenticate.com/pricing)
- Authenticate says it retrieves MVRs directly from state DMVs and that DMV fees vary by state. — [Authenticate DMV/MVR page](https://info.authenticate.com/dmv-mvr)
- The pricing page shows NIST, AICPA, HIPAA, PCI and iBeta Level 2 logos without detail. — [Authenticate pricing](https://authenticate.com/pricing)
- G2 lists no pricing detail supplied by the vendor. (third party) — [G2](https://www.g2.com/products/authenticate/pricing)

##### Inferences
- For ID + selfie + liveness alone, Authenticate at $2 undercuts RentID's $2.99 credit, with a published, itemised price list. Adding an MVR takes it to $7 plus state fees, which is in line with Checkr's $9.50 MVR and is the realistic cost of a true driving record from any vendor.

##### Gaps
- State-by-state MVR fee table, UK licence/DVLA coverage, partner or reseller terms, and API quality (docs, webhooks, SDKs) were not verified in this pass. No independent rental-operator reviews were found.

#### 3. IDScan.net and the World ICRA DIVE offer

##### Takeaway
IDScan.net's DIVE product is a genuine remote, phone-based flow (SMS link, ID capture, selfie, liveness) and not only a counter scanner. List price is subscription-based from $200/month for 400 checks ($0.50 each), with an ICRA-member pay-as-you-go offer "starting at $0.20/scan" and no minimums. DMV checks are a separately priced add-on.

##### Cited Findings
- DIVE tiers (vendor page): Scout $200/month for 400 verifications ("as low as $0.50"); Explorer $450/month for 1,000 ($0.45); Voyager $795/month for 2,000 ($0.40); Navigator (adds multi-tenancy) by quote. Every tier includes ID parsing, ID validation and tamper checks, selfie face match, liveness/anti-spoofing and multi-source risk scoring. — [IDScan.net pricing](https://idscan.net/pricing)
- ICRA offer (vendor page): DIVE "starting at $0.20/scan exclusively for ICRA members", "No monthly minimums or contracts", pay-as-you-go; the same page quotes a public DIVE API tier "starting at $0.89/scan". The page does not itemise which features the $0.20 covers. — [IDScan.net World ICRA page](https://idscan.net/world-icra-digital-identity-verification)
- Remote flow: the customer gets a unique link by SMS and completes ID and selfie capture on their phone, claimed under 30 seconds. — [IDScan.net World ICRA page](https://idscan.net/world-icra-digital-identity-verification)
- Document coverage claim: 10,700+ identity documents from 140+ countries; third-party checks (DMV and similar) are offered for North American customers. — [IDScan.net World ICRA page](https://idscan.net/world-icra-digital-identity-verification)
- DMV API and third-party checks have no published price. — [IDScan.net pricing](https://idscan.net/pricing)
- In-person products: VeriScan $35 to $155 per device per month; the top "ID Authentication" tier (UV, IR, hologram checks) needs specialty hardware and Windows. — [IDScan.net pricing](https://idscan.net/pricing)
- DIVE is sold on a monthly or annual subscription under its product addendum. — [DIVE product addendum](https://idscan.net/dive-product-addendum/)
- IDScan.net has a rental-software precedent: Quipli (equipment rental software) launched licence scanning and fraud verification with IDScan.net as partner. (third party) — [CB Insights, Quipli](https://www.cbinsights.com/company/quipli)

##### Inferences
- The $0.20 ICRA figure is most likely the barcode/ID-parsing-only rate; the full ID + selfie + liveness check is probably nearer the $0.40 to $0.89 list range. Even so it is several times cheaper than a $2.99 RentID credit for the identity step.
- The "Navigator" multi-tenancy tier is the one that fits a platform serving 60 operators, and it is quote-only.

##### Gaps
- What the ICRA $0.20 rate includes; DMV check price and state coverage; whether UK licences get authenticity checks or only data extraction; ICRA membership cost and whether a software platform (rather than a rental operator) qualifies; independent accuracy or drop-off data.

#### 4. What competing rental platforms use, and other rental-specific vendors

##### Takeaway
Where a vendor is disclosed, rental platforms use general identity providers, not rental-specific ones: Fleetwire uses Stripe Identity, Outdoorsy uses Persona, Turo uses ComplyCube (and has used Mitek), Getaround used Onfido. No platform in the list was found to use RentID. Rental-specific data products (Checkr Trust Driver Checks, Rent Centric's AAMVA check) add licence status or driving records on top.

##### Cited Findings
- Fleetwire: licence verification "powered by Stripe Identity"; Fleetwire says it never stores raw ID images. — [Fleetwire ID verification](https://fleetwire.io/features/id-verification/)
- Outdoorsy: Persona verifies identity and licence validity; renters upload selfies and a licence photo after booking (help page is several years old). — [Outdoorsy help](https://www.outdoorsy.com/help/what-is-a-dmv-check-and-do-i-have-to-do-one); [Persona case study](https://withpersona.com/customers/outdoorsy)
- Turo: an April 2026 vendor press release says Turo moved driver's licence verification and risk management to ComplyCube; Mitek earlier published a Q&A with Turo's trust and safety lead about its ID verification. Both are vendor-published. — [ComplyCube press release](https://www.einpresswire.com/article/906961905/complycube-sets-new-standard-in-peer-to-peer-car-sharing-with-turo); [Mitek Q&A](https://www.miteksystems.com/blog/innovator-qa-mike-wilkins-senior-director-trust-safety-at-turo)
- Turo's own disclosures say it "cannot conclusively verify the identity" of all guests. — [Fortune](https://fortune.com/2025/01/03/turo-car-rental-app-new-orleans-attack-las-vegas-cybertruck-explosion)
- Getaround used Onfido (document check, motion, known faces); the case study is dated and Getaround closed US operations in February 2025 per the search summary. — [Onfido case study](https://onfido.com/customer/getaround/)
- Rent Centric: sells its own "Real-time License Verification" add-on that runs a DMV (AAMVA) check for suspension. — [Rent Centric](https://rentcentric.com/products/technology-add-ons/drivers-license-verification)
- Coastr: a third-party comparison says onboarding includes biometric ID verification; no vendor named. (third party) — [Levy Fleets comparison guide](https://fleets.levyelectric.com/blog/best-car-rental-car-sharing-software)
- Checkr Trust "Driver Checks" is built for vehicle rental and sharing companies; Checkr lists a driver's licence status check at $5 per check with no pass-through fees and a standard MVR at $9.50 plus state fees (search summary of Checkr's pages). — [Checkr Trust Driver Checks](https://trust.checkr.com/products/driver-checks); [Checkr pricing](https://checkr.com/pricing)
- Trust Swiftly: its own blog quotes $0.25 per verification with a $1,000 monthly minimum billed annually. (vendor blog, self-published comparison) — [Trust Swiftly](https://trustswiftly.com/blog/identity-verification-pricing-comparison-and-alternatives/)
- Older counter-era rental tools cost $1 to $3 per scan or inquiry (Dragnet Intercept, VerX Direct). (trade press, dated) — [Auto Rental News](https://www.autorentalnews.com/articles/new-verification-systems-prevent-id-fraud)
- 365id and Klippa market ID verification specifically to car rental (mainly Europe). — [365id](https://365id.com/en/segments/car-rentals/); [Klippa](https://www.klippa.com/en/identity-verification/car-rentals)

##### Inferences
- The market norm for a rental SaaS is a general identity provider for document + selfie, plus an optional US driving-data add-on. RentID's pitch (everything in one credit system) is unusual, and no peer platform was found relying on it.

##### Gaps
- No vendor disclosure found for HQ Rental Software, RentSyst, Rently, TSD, Record360, Booqable, Wheelbase or Levy Fleets. Verisk/IIX DL Verify, Digisure and Rentall were not found in searches. Checkr Trust figures come from search summaries, not a full read of the page, and should be re-confirmed.

#### 5. Independent reviews and operator forums on accuracy, false rejections and drop-off

##### Takeaway
No independent reviews, forum threads or trade-press coverage were found for RentID at all, and nothing vendor-specific on false rejections or renter drop-off for Authenticate.com or IDScan.net in a rental setting.

##### Cited Findings
- A targeted search for Reddit and operator discussion of RentID, Authenticate.com, IDScan and Stripe Identity in rental returned no relevant threads; results were general Turo coverage. The only verification-related facts were Turo's own statement that approval is usually instant but can require licence photos, a selfie holding the licence, or a passport. — [AOL / Turo explainer](https://www.aol.com/turo-explainer-car-rental-app-222148586.html)
- G2 carries a listing for Authenticate but no vendor-supplied pricing; review content was not retrieved. — [G2](https://www.g2.com/products/authenticate/pricing)

##### Inferences
- Absence of any third-party footprint for RentID is itself a maturity signal: there is no outside evidence of pass rates, false rejections or completion rates, so Drive247 would be relying entirely on vendor claims.

##### Gaps
- Reddit (r/turo, r/carrental), Facebook groups, Trustpilot and Capterra were not directly readable through search in this pass; a manual look is needed. No pass-rate, false-rejection or drop-off numbers were found for any vendor in scope.
