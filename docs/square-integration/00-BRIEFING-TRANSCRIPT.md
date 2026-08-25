# Team Lead Briefing — Square Payment Integration

**Source:** voice super-cut, ~10 min (Urdu/Hindi + English), transcribed and restructured into English.
**Date captured:** 2026-08-25
**Branch:** `feature/square`

> **Transcription note:** the original is a stream-of-consciousness voice note. It has been reorganised
> into logical sections rather than kept in strict chronological order. Where the lead **corrects
> himself later in the recording**, the correction is treated as authoritative and the superseded
> statement is marked. The most important such correction is at [§8](#8-late-scope-correction--subscriptions-are-out).

---

## 1. Framing and urgency

- This briefing covers **only today's item**. The lead is packed and is deliberately not covering the rest of the backlog.
- The task is assigned to **two engineers working together**.
- Timeline pressure: it needs to be done **by end of day / AOD**. Tomorrow is an off-day, so a two-day gap is not tolerable here.
- Commercial driver: **two customers are waiting on this**. If it slips, **both sales are lost**.

## 2. The task

> "Square integration hai — jaise hamare paas Stripe integration hai na, usi ke same pattern par hamne Square ko bhi integrate karna hai."

**Integrate Square as a second payment provider, following exactly the same pattern as the existing Stripe integration.**

The good news, in the lead's words: **you already know all the relevant paths.** Whatever we currently do through Stripe is precisely what must now also be doable through Square.

**No invention.** Explicitly:

> "Bas wahi — kuch addition nahi, kuch out-of-the-box cheez nahi aap logon ne sochni. Wahi-wahi cheez hamne Square se bhi karwa leni hai."

Do not design new behaviour. Mirror what exists.

## 3. Provider choice is made once, at tenant creation — there is no toggle

This is a hard product rule and the lead was emphatic about it.

| Rule | Detail |
|---|---|
| **Who gets Square** | **New tenants only.** |
| **Existing tenants** | Stay on Stripe. Nothing changes for them. |
| **Runtime switching** | **Never.** "Yeh hum kabhi bhi nahi denge." |
| **When the decision is made** | At the very start of onboarding. The operator decides up front: **either Stripe or Square.** |
| **Why no toggle** | A live switch is *"phir sabse mushkil baat hai"* — the hardest part, and **not a one-day job**. Scoping to choose-at-creation is what makes this deliverable today. |

So the flow is: a new tenant arrives → during onboarding they choose **Stripe** (the existing, fully built flow) **or Square** → that choice is fixed.

## 4. Every payment provider needs two separate link mechanisms

The lead generalised the model — this holds for Stripe, for Square, and for any third provider added later:

> "Kisi bhi payment method ke andar do cheezein karni padengi."

**Mechanism 1 — tenant ↔ customer (the money the renter pays).**
- This is **OAuth**.
- Stripe: **Stripe OAuth**. Square: **Square OAuth**.
- Effect: the customer's payment lands **directly in the tenant's own account**.

**Mechanism 2 — tenant ↔ platform (the money the tenant pays us).**
- This is **subscriptions**.
- Stripe: **Stripe Subscriptions**. Square: *would have been* Square Subscriptions — **but see [§8](#8-late-scope-correction--subscriptions-are-out), this is cancelled.**

### Important historical note on Stripe Connect vs Stripe OAuth

> "Pehle hum Stripe par Stripe Connect wali ek cheez use karte the, lekin uske baad hum Stripe OAuth par aa gaye hain."

- We **used to** use **Stripe Connect** (connected accounts).
- We have **since migrated to Stripe OAuth**.
- Therefore on Square you must build **Square OAuth**, not a Connect-style model.
- The lead's read: *"Mere khayal se uska toh connect wala model hi nahi hai"* — **Square probably has no Connect equivalent at all.** ⚠️ *Flagged for verification during research.*
- **Connected accounts and OAuth are not the same thing** — do not conflate them.

## 5. The engineering approach — one function, branching internally

This is the core architectural instruction.

**Step 1 — find the Stripe edge functions.**
> "Aapne sirf yehi dekhna hai ki bhai kaun se edge function Stripe wale hain."

**Step 2 — map the Stripe path first, then make it dynamic.**
> "Pehle Stripe ka path map karo, phir usko dynamic kar do."

**Step 3 — DO NOT build parallel duplicate functions.**
> "Obviously hum do-do edge function nahi banayenge — yeh Stripe wale edge function alag, yeh Square wale. Aap usko thoda dynamic karoge kisi ek key ID par."

There must be **one function per capability**, made dynamic on **a single key** read from the database.

**Step 4 — rename away from provider-specific names.**

Worked example given verbatim:

| Before | After |
|---|---|
| `stripe-checkout` | `checkout` |

> "Ab woh Stripe checkout nahi rahega, ab woh checkout hi ho jaayega. Aur checkout mein aage phir ab do branches hongi, jismein woh ab yeh faisla karega ki usne kahan jaana hai."

**Step 5 — the branch is decided by a DB value.**
> "Yeh jo faisla hai, yahan par woh jo apna payment method usne select kiya hoga — jo ki **DB se value aa rahi hogi** — wahan select karega: bhai yeh branch maine leni hai ya yeh branch maine leni hai."

**Step 6 — this makes a third provider cheap.**
> "Iske baad yahan par teesri branch banana bhi... mushkil kaam nahi hoga, since ki hum upar hi behaviour se decide kar rahe hain."

Because the decision happens **once, at the top**, adding provider #3 later is a small change.

```
                 ┌─────────────┐
   (was:         │  checkout   │   ← provider-neutral name
 stripe-checkout)└──────┬──────┘
                        │ read provider key from DB
              ┌─────────┴─────────┬──────────────┐
              ▼                   ▼              ▼
          Stripe branch      Square branch   (3rd later)
          UNTOUCHED             new           cheap to add
```

## 6. 🔴 THE PRIME DIRECTIVE — Stripe must not break

The single most emphasised point of the entire briefing.

> "Make sure ek cheez — jo isme important hai — ki **Square daalne se hamara Stripe na phate.**"
>
> "**Square agar phat raha hai, theek hai** — woh samajh mein aati hai, naya feature hai. **Stripe kisi bhi soorat mein risk par nahi aana chahiye.**"
>
> "Badi mushkil se hamne payments ko thoda sa stable kiya hai. Square daalne ka yeh matlab nahi hoga ki hum apna Stripe wala nizaam kharaab kar baithe."

**The asymmetry is explicit and deliberate:**

| Outcome | Acceptable? |
|---|---|
| A bug in the new Square path | ✅ Acceptable — it's a new feature, that's understandable |
| Any regression in the existing Stripe path | ❌ **Unacceptable, under any circumstances** |

Rationale: payments were stabilised with great difficulty. Adding Square must not undo that.

## 7. Recommended working method — "if it were me"

The lead gave his own suggested method, and warned against delegating blindly.

**7.1 — Pick one path first.** Don't start everywhere at once. He uses *subscriptions* as his worked example (before later removing it from scope — the *method* still stands, apply it to a path that is in scope).

**7.2 — Trace and write down the path.**
> "Dekho ki yaar woh kaun-kaun se edge functions hokar jaata hai. Thoda sa woh path apne paas likh lo."

Map it concretely: the user enters a card number → this function runs → then this edge function → then this → then this. Write the sequence down.

**7.3 — ⚠️ Do not hand this to Claude blindly.**
> "Usse blindly isko nahi bol dena hai Claude ko hamne."

Understand the path yourself **first**. Then use the tooling.

**7.4 — Then ask for the Square counterpart of that specific mapped path.**
> "Phir aapne bas yehi kehna ki yaar Square wala bhi agar main implement karna chah raha hoon, toh woh kis tarah map hoga?"

**7.5 — Expect ~95% to be a clean 1:1 mapping.**
> "95% of the time one-on-one map hi ho raha hoga."

**7.6 — 🎯 The real work is the other 5%.** This is the highest-value instruction in the briefing:

> "Lekin usme aap keh lo ki yeh wali jo cheez hai — yeh ek cheez hai jo ki change hai, **jo ki Square mein hai Stripe mein nahi**, ya phir **Stripe mein hai Square mein nahi**. Toh bas **yeh woh jagah hai jahan par code bhi phat jaayega.** Toh aapne isko handle karna hai."

Wherever a capability exists on one side and not the other, **that is exactly where the code will tear.** Those points must be found and handled.

**7.7 — Handle them gracefully, and the same discipline applies to provider #3.**
> "Teesra payment method agar aata hai toh hum usko bhi itna hi handle karenge. Lekin make sure ki **gracefully handle ho.**"

## 8. Late scope correction — subscriptions are OUT

Near the end of the recording the lead stops himself and **removes subscriptions from scope entirely.** This supersedes everything said earlier about Square Subscriptions.

> "Achha maazrat, maazrat, maazrat. I just realised ki **aap logon ko toh subscription bhi karne ki zaroorat nahi hai na.**"

**The reasoning:**

- Subscription is the money **we** take **from the tenant**.
- That relationship is **platform ↔ tenant**, and **we always stay on Stripe.**
  > "Hum Stripe par hi rahenge hamesha... Main aapko bata deta hoon ki **hamne hamesha Stripe par hi rehna hai.**"
- What actually moves to Square is only the **tenant ↔ customer** relationship.
  > "Woh toh uski aur customer ke darmiyan jo sab tamasha hai, woh hum shift karenge — tenant–customer ke darmiyan."

**Direct consequences stated by the lead:**

1. > "**Subscriptions toh aapne sort hi nahi karni phir. Subscriptions toh aapka issue hi nahi hai.**"
2. The scope narrows sharply:
   > "Toh phir toh aur cheez narrow ho gayi hai ki aapne **sirf auth wala connection hi dekhna hai. Auth, aur phir checkout / payments.**"
3. Super-admin invoicing is untouched:
   > "Toh phir iska matlab aapko **super admin mein bhi kuch change nahi karna padega** — jo invoice wagairah wahan par generate hoti hai, jo aapne abhi feature roll out bhi kiya, wahan par kuch bhi change nahi karna padega."
4. > "**Toh best hai phir toh.**"

Also noted earlier and consistent with this: the super-admin link-generation flow is unaffected — *"wahan par jo hamare links generate ho rahe hain, usse koi farq nahi padta."*

## 9. Final scope — what must actually be built

The lead enumerated the match points, then narrowed them. Net result:

### ✅ IN SCOPE

| # | Capability | Notes from the briefing |
|---|---|---|
| 1 | **Account connection (OAuth)** | Square OAuth, mirroring the Stripe OAuth model. **The primary remaining item.** |
| 2 | **Checkout** | *"Checkout toh jahan se marzi ho."* The main payment path. |
| 3 | **Payment links** | *"Payment links wali cheez hai."* Currently essentially the same as checkout — *"kuch checkout hi hota hai filhal toh."* |
| 4 | **Deposits** | *"Deposits mein kuch nahi hai, woh phir payment hi hai."* Deposit is just another payment — same code shape. |
| 5 | **Refunds + partial refunds** | *"Refunds aur partial refunds. Bas aur kuch bhi nahi hai."* |

### ❌ OUT OF SCOPE

| Item | Reason |
|---|---|
| **Platform subscriptions** | Platform ↔ tenant billing **stays on Stripe forever**. See §8. |
| **Authorization holds / preauth** | Explicit: *"**Authorization hold nahi daalni hai. Aapne deposit tak hi raho.**"* Stop at deposit-as-a-charge. |
| **Super-admin invoicing & link generation** | Unaffected — no changes needed. |
| **Runtime provider switching** | Explicitly refused, permanently. See §3. |
| **Existing tenants' migration** | They remain on Stripe. |

### On the count of items

> "Toh yeh ek, do, teen... mere khayal se shayad main ek kadam miss kar raha hoon. Lekin aapne sirf **paanch, chaar ya paanch points** match karne hain."

The lead acknowledges he may have missed a step — he estimates **4–5 match points**. *(Independent verification of the true list is part of the mapping deliverable.)*

## 10. Team split and execution

> "**Strategy ek bana lena, aur uske baad yeh points aapas mein baant lena.** Agar aap do-do bhi karte ho, toh teen-teen agar karte ho toh yeh inhi mein khatm ho jaana hai."

- **Agree a strategy first**, then divide the points.
- **Two engineers, ~2–3 points each.**
- The work should be fully covered by that split.
- Both engineers work on this together: *"Aap dono ne milkar hi yeh wala kaam karna hai."*

---

## Appendix A — Verbatim quotes worth keeping

| Topic | Quote |
|---|---|
| No new thinking | *"Kuch addition nahi, kuch out-of-the-box cheez nahi aap logon ne sochni."* |
| No toggle, ever | *"Yeh hum kabhi bhi nahi denge. Shuru mein hi us bande ko faisla karna padega — ya toh woh Stripe hai ya toh Square hai."* |
| One function, not two | *"Obviously hum do-do edge function nahi banayenge."* |
| Rename | *"Ab woh Stripe checkout nahi rahega, ab woh checkout hi ho jaayega."* |
| Branch on DB value | *"Jo ki DB se value aa rahi hogi."* |
| **Prime directive** | *"Stripe kisi bhi soorat mein risk par nahi aana chahiye."* |
| Asymmetric risk | *"Square agar phat raha hai, theek hai. Naya feature hai."* |
| Hard-won stability | *"Badi mushkil se hamne payments ko thoda sa stable kiya hai."* |
| **The 5% that tears** | *"Bas yeh woh jagah hai jahan par code bhi phat jaayega. Toh aapne isko handle karna hai."* |
| Graceful | *"Make sure ki gracefully handle ho."* |
| Don't delegate blindly | *"Usse blindly isko nahi bol dena hai Claude ko hamne."* |
| Subscriptions cancelled | *"Subscriptions toh aapka issue hi nahi hai."* |
| Platform stays Stripe | *"Hamne hamesha Stripe par hi rehna hai."* |
| Holds excluded | *"Authorization hold nahi daalni hai. Aapne deposit tak hi raho."* |

## Appendix B — Open questions the briefing raises

These were asserted by the lead but need verification, and are carried into the research phase:

1. **Does Square have any Connect equivalent?** The lead believes not (*"uska toh connect wala model hi nahi hai"*). If true, the platform loses application-fee collection and on-behalf-of routing — needs a stated replacement.
2. **What is the single DB key that drives the branch?** The lead says "a key ID from the DB" but does not name a column. Must be chosen and made to default to Stripe for every existing row.
3. **Which step did he miss?** He explicitly suspects the 4–5 point list is incomplete.
4. **Does Square support everything the in-scope five need** — off-session/stored-card charges (for installments and auto-extend), partial refunds, partial capture, hosted checkout on behalf of an OAuth-connected merchant?
5. **Square country/currency coverage** vs our tenant geography (an active UK→UAE Stripe migration is in flight).
