# A payment is missing or disagrees with Stripe

Developer/support planning reference; not indexed in Phase 1.

First establish whether the question is about one rental's charges or account-level funds. Obtain the authorized internal rental/payment identity. Keep pending authorization holds separate from captured/received funds.

A future read-only adapter must validate payment applications, extension/PAYG composition, currency units and exact Stripe links in the historical platform/account/mode. A missing link is not permission to search by amount or customer name. Partial pagination is not a complete balance. Stripe failures must not become a zero amount.

When verified records disagree, show the independently observed internal and Stripe states and their observation times. Do not silently repair records or invoke verify-deposit-hold, fetch-payment-intent, apply-payment, refunds or capture. Their names do not establish read-only behavior.

Phase 1 answers that finance checks are unavailable. It does not expose financial navigation while the finance-read role policy is unresolved. See ../developer/finances.md for sources and prerequisites.

