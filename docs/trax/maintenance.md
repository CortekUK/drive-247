# Knowledge maintenance and local rollout

## Local commands

- node scripts/sync-fleet-quote.mjs --check
- node scripts/trax-knowledge.mjs --check
- node scripts/trax-knowledge.mjs --build (after reviewing affected documentation; local artifacts only)
- node node_modules/typescript/bin/tsc -p supabase/functions/trax-support/tsconfig.offline.json --pretty false
- node tests/trax/browser.mjs (actual TRAX components and handler, isolated offline fixtures)
- From apps/portal: npm.cmd run test -- src/__tests__/lib/trax-support.test.ts src/__tests__/lib/trax-session.test.ts src/__tests__/hooks/use-trax-support.test.tsx src/__tests__/lib/trax-knowledge.test.ts src/__tests__/lib/fleet-quote.test.ts src/__tests__/lib/fleet-quote-sync.test.ts

The fleet generator restores the checked-in source-to-Deno transformation. It validates known imports, an import-free price module and matching currency formatting before generating. --check never writes. CRLF/LF normalization does not trim or modify business logic.

See implementation-report.md for the complete test commands, observed results and full-portal type-check limitations. Browser screenshots are fixtures, not evidence of live tenant access.

## Change-driven review

When behavior, routes, permissions, tenant variants or workflow side effects change, update the relevant feature document and regression tests in the same change. Run --check to identify stale artifacts. Source hashes include referenced symbols/files, portal page bodies and navigation/policy sources. A new portal route or permission key must be catalogued even if its behavior remains requiring_confirmation.

Review missing/unverified modules in the coverage report. The report inventories other applications separately and always states completeApplicationCoverage=false. Six narrowly scoped features are initially verified; this does not certify all of their underlying operations.

--build prepares immutable runtime sections and generated policy copies. It does not call a model, index live records, contact Supabase, run migrations, deploy or publish knowledge. Generated artifacts and source docs remain in the same review. The source commit identifies the audited base; these working-tree additions remain a review candidate.

The application release is null because no verified deployed mapping was available. The artifact and runtime always report productionReleaseVerified=false in this phase. Package version 1.0.0, a branch name or a new build is not evidence of deployed parity. A future release-promotion mechanism needs separate review.

## Legacy sensitive data and deployment prerequisites

Existing rag_documents contains embedded customers, vehicles, rentals, payments, fines, plates and knowledge_articles. document-loaders.ts includes contact/licence information and record free text. rag_sync_queue drives existing refreshes. chat_messages stores older conversation content. No records are deleted, rebuilt or reindexed by this change.

V2's separate trax-support endpoint does not query those stores, match_documents, get_rag_metrics or get_chat_history and has no legacy fallback. It follows the existing V2 chrome rollout: Northwind now and future tenants when enrolled. V1's chat, rag-init and rag-sync handlers remain unchanged. None was invoked during this work.

The proposed access changes are retained only in `docs/trax/deferred/restrict-legacy-retrieval.sql`, outside deployable migrations. They are **not applied or part of the V2-only rollout** because global revocations would change V1. Inspect deployed grants, policies, function signatures and callers before separately approving legacy remediation. Existing legacy exposure persists. Sensitive-embedding removal/rebuild and historical chat retention also require separate approval.

Native financial/return endpoints, RLS on unrelated business tables, customer chat and pricing narrative functions are not certified or globally rewritten by Phase 1. Do not expose further tools until their own authorization and read-only behavior are verified.

## Outstanding environment decisions

- Target deployed release and actual policy/function definitions.
- Rental-finance versus whole-account funds permission matrix.
- Historical Stripe platform, environment and connected-account provenance.
- Restricted Stripe credentials provisioned through server secret management, never chat.
- Conversation/log retention and provider data-processing policy.
- Provider/model-assisted routing, if desired later; current answers use deterministic bilingual sections.
