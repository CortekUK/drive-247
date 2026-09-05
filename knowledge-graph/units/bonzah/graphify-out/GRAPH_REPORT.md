# Graph Report - bonzah  (2026-09-04)

## Corpus Check
- 41 files · ~67,858 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 43 nodes · 59 edges · 10 communities detected
- Extraction: 68% EXTRACTED · 31% INFERRED · 2% AMBIGUOUS · INFERRED: 18 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]

## God Nodes (most connected - your core abstractions)
1. `bonzah_onboarding_submissions table - operator insurance application, AI verdict, quiz result and review outcome in one row` - 12 edges
2. `Operator onboarding review queue - stat-card filters, search, and status-filtered submission table` - 7 edges
3. `bonzah-partner-review edge function - server-authoritative approve/activate and reject for onboarding submissions` - 6 edges
4. `Approve & activate - partner hands over the operator's Bonzah username/password plus a welcome message` - 5 edges
5. `Bonzah partner session store - a third auth identity alongside portal staff and booking customers` - 5 edges
6. `Canonical 8-section underwriting application taxonomy (business, operations, contacts, banking, insurance, policies, underwriting, signature) used to render the export` - 4 edges
7. `Client access gate: is_bonzah_partner OR is_super_admin, otherwise sign out with 'Access denied'` - 4 edges
8. `Bonzah Partner Console - standalone insurance-partner app at bonzah.drive-247.com` - 3 edges
9. `Partner console email/password login` - 3 edges
10. `Hand-mirrored Submission / SubmissionEvent DB shapes - this app ships no generated Supabase types` - 3 edges

## Surprising Connections (you probably didn't know these)
- `Bonzah Partner Console - standalone insurance-partner app at bonzah.drive-247.com` --governs--> `Client access gate: is_bonzah_partner OR is_super_admin, otherwise sign out with 'Access denied'`  [EXTRACTED]
  apps/bonzah/README.md → apps/bonzah/store/authStore.ts
- `Phased rollout: Phase 3 review-only, Phase 4 wires approve/reject (README still says ACTIVATION_ENABLED=false while code now sets it true - doc drift)` --references--> `bonzah-partner-review edge function - server-authoritative approve/activate and reject for onboarding submissions`  [EXTRACTED]
  apps/bonzah/README.md → apps/bonzah/components/console/BonzahQueue.tsx
- `Rationale: partners are scoped to Bonzah data only, so the tenants table is deliberately never joined - the operator's own business name is shown instead` --conceptually_related_to--> `'bonzah' is a reserved subdomain in portal + booking middleware so it is never resolved as a tenant slug`  [INFERRED]
  apps/bonzah/components/console/BonzahQueue.tsx → apps/bonzah/README.md
- `Rationale: SSR-safe storage getter - a storage-less client evaluated during SSR can leak into the browser, leaving auth.uid() null so is_super_admin() is false and every RLS-gated INSERT fails` --governs--> `Bonzah partner session store - a third auth identity alongside portal staff and booking customers`  [INFERRED]
  apps/bonzah/lib/supabase.ts → apps/bonzah/store/authStore.ts
- `Bonzah Partner Console - standalone insurance-partner app at bonzah.drive-247.com` --governs--> `Operator onboarding review queue - stat-card filters, search, and status-filtered submission table`  [EXTRACTED]
  apps/bonzah/README.md → apps/bonzah/components/console/BonzahQueue.tsx

## Communities

### Community 0 - "Community 0"
Cohesion: 0.36
Nodes (9): bonzah_onboarding_submissions table - operator insurance application, AI verdict, quiz result and review outcome in one row, Drive247 AI underwriting verdict card - recommendation, confidence, reasons, red flags, Rationale: the verdict auto-generates on first open when no stored verdict exists, so the table column reads 'on open' until then, Banking + card-on-file review fields (routing, account, card number, CVC) rendered as plain text to the partner reviewer, Tabbed submission detail view re-declaring the same 8-section field taxonomy for the screen, Client-side ZIP export of every submission image plus the preparer signature data URL, Client-side structured PDF export - fetches storage files as blobs and embeds images inline via jsPDF, Canonical 8-section underwriting application taxonomy (business, operations, contacts, banking, insurance, policies, underwriting, signature) used to render the export (+1 more)

### Community 1 - "Community 1"
Cohesion: 0.4
Nodes (5): Rationale: status/stat colour classes are declared as static maps because Tailwind JIT cannot see dynamically built class strings, Co-branded partner chrome - Bonzah logo header with 'Powered by Drive247' footer attribution, Root shell carrying Bonzah pink (#d6004f) progress bar and toast host, Bonzah console theme tokens - success/warning/destructive semantic colours the queue's status system depends on, Rationale: dark-* tokens are literal hex because they were previously undefined and only 'looked' dark by rendering transparent over a dark backdrop, hiding broken elements

### Community 2 - "Community 2"
Cohesion: 0.5
Nodes (5): Operator onboarding review queue - stat-card filters, search, and status-filtered submission table, Realtime channel 'bonzah-onboarding-admin' refetches the whole queue on any submission change, Rationale: partners are scoped to Bonzah data only, so the tenants table is deliberately never joined - the operator's own business name is shown instead, Bonzah Partner Console - standalone insurance-partner app at bonzah.drive-247.com, 'bonzah' is a reserved subdomain in portal + booking middleware so it is never resolved as a tenant slug

### Community 3 - "Community 3"
Cohesion: 0.5
Nodes (4): Bonzah partner session store - a third auth identity alongside portal staff and booking customers, Per-app Zustand auth store re-implemented from scratch (store/authStore.ts mirrors the admin app's shape rather than sharing a package), Console route-group auth guard: checkAuth on mount, redirect to /login when no partner user, USD-default currency formatter copied per app instead of shared

### Community 4 - "Community 4"
Cohesion: 0.5
Nodes (4): app_users table - staff identity carrying is_bonzah_partner and is_super_admin flags, Manual provisioning steps: separate Vercel project, DNS, and a hand-created is_bonzah_partner app_users row, Shared Supabase project client with hardcoded project ref + anon key fallback, so the console talks to the same database as portal/booking/admin, Rationale: SSR-safe storage getter - a storage-less client evaluated during SSR can leak into the browser, leaving auth.uid() null so is_super_admin() is false and every RLS-gated INSERT fails

### Community 5 - "Community 5"
Cohesion: 0.67
Nodes (4): bonzah-partner-review edge function - server-authoritative approve/activate and reject for onboarding submissions, ACTIVATION_ENABLED kill switch gating every approve/reject control (now true - Phase 4 shipped), Send-back / reject with a mandatory reason shown to the operator, Phased rollout: Phase 3 review-only, Phase 4 wires approve/reject (README still says ACTIVATION_ENABLED=false while code now sets it true - doc drift)

### Community 6 - "Community 6"
Cohesion: 0.5
Nodes (4): bonzah_submission_events table - append-only audit trail of customer/partner/system actions on a submission, Submission activity timeline attributing each event to customer / partner / system actors, Hand-mirrored Submission / SubmissionEvent DB shapes - this app ships no generated Supabase types, Rationale: TypeScript build errors are ignored because the console reuses loosely typed shared shapes

### Community 7 - "Community 7"
Cohesion: 0.67
Nodes (3): Partner console email/password login, Onboarding Reviews dashboard - the console's only working surface, Root entry redirects straight to /login (console has no public landing page)

### Community 8 - "Community 8"
Cohesion: 0.67
Nodes (3): bonzah-verify-credentials edge function - validates the Bonzah operator credentials issued at activation, Approve & activate - partner hands over the operator's Bonzah username/password plus a welcome message, Operator training quiz result badge (score/total/passed) surfaced as a review signal

### Community 9 - "Community 9"
Cohesion: 1.0
Nodes (2): Client access gate: is_bonzah_partner OR is_super_admin, otherwise sign out with 'Access denied', Rationale: super admins get read access for oversight, but partner-only approve/reject is additionally gated server-side by is_bonzah_partner()

## Ambiguous Edges - Review These
- `Approve & activate - partner hands over the operator's Bonzah username/password plus a welcome message` → `bonzah-verify-credentials edge function - validates the Bonzah operator credentials issued at activation`  [AMBIGUOUS]
  apps/bonzah/components/console/BonzahQueue.tsx · relation: conceptually_related_to

## Knowledge Gaps
- **7 isolated node(s):** `Console route-group auth guard: checkAuth on mount, redirect to /login when no partner user`, `Co-branded partner chrome - Bonzah logo header with 'Powered by Drive247' footer attribution`, `Root entry redirects straight to /login (console has no public landing page)`, `USD-default currency formatter copied per app instead of shared`, `Rationale: TypeScript build errors are ignored because the console reuses loosely typed shared shapes` (+2 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 9`** (2 nodes): `Client access gate: is_bonzah_partner OR is_super_admin, otherwise sign out with 'Access denied'`, `Rationale: super admins get read access for oversight, but partner-only approve/reject is additionally gated server-side by is_bonzah_partner()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Approve & activate - partner hands over the operator's Bonzah username/password plus a welcome message` and `bonzah-verify-credentials edge function - validates the Bonzah operator credentials issued at activation`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `bonzah_onboarding_submissions table - operator insurance application, AI verdict, quiz result and review outcome in one row` connect `Community 0` to `Community 2`, `Community 4`, `Community 5`, `Community 6`, `Community 8`?**
  _High betweenness centrality (0.571) - this node is a cross-community bridge._
- **Why does `Operator onboarding review queue - stat-card filters, search, and status-filtered submission table` connect `Community 2` to `Community 0`, `Community 1`, `Community 7`?**
  _High betweenness centrality (0.403) - this node is a cross-community bridge._
- **Why does `bonzah-partner-review edge function - server-authoritative approve/activate and reject for onboarding submissions` connect `Community 5` to `Community 8`, `Community 0`, `Community 6`, `Community 9`?**
  _High betweenness centrality (0.245) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `bonzah_onboarding_submissions table - operator insurance application, AI verdict, quiz result and review outcome in one row` (e.g. with `Banking + card-on-file review fields (routing, account, card number, CVC) rendered as plain text to the partner reviewer` and `summarize-bonzah-submission edge function - LLM underwriting assistant producing recommendation, confidence, reasons and red flags`) actually correct?**
  _`bonzah_onboarding_submissions table - operator insurance application, AI verdict, quiz result and review outcome in one row` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `bonzah-partner-review edge function - server-authoritative approve/activate and reject for onboarding submissions` (e.g. with `bonzah_onboarding_submissions table - operator insurance application, AI verdict, quiz result and review outcome in one row` and `bonzah_submission_events table - append-only audit trail of customer/partner/system actions on a submission`) actually correct?**
  _`bonzah-partner-review edge function - server-authoritative approve/activate and reject for onboarding submissions` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `Approve & activate - partner hands over the operator's Bonzah username/password plus a welcome message` (e.g. with `Operator training quiz result badge (score/total/passed) surfaced as a review signal` and `Submission activity timeline attributing each event to customer / partner / system actors`) actually correct?**
  _`Approve & activate - partner hands over the operator's Bonzah username/password plus a welcome message` has 2 INFERRED edges - model-reasoned connections that need verification._