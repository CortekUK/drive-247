/**
 * Square integration — the Stripe adapter, deliberately almost empty.
 *
 * READ THIS BEFORE ADDING ANYTHING HERE.
 *
 * Stripe is the NATIVE RAIL. It is not adapted, wrapped, delegated to, or
 * translated. Every checkout creator and every refunder keeps its own Stripe code
 * byte-for-byte, and the seam simply returns handled:false so that code runs
 * exactly as it did before Square existed.
 *
 * That is not laziness — it is the entire safety argument. "Zero Stripe diff" is
 * verifiable with one checksum command precisely because no Stripe logic was ever
 * moved in here to be re-expressed. The moment someone "tidies" a Stripe call
 * into this file, the prime directive stops being checkable and becomes a hope.
 *
 * If you are about to add a function here that calls the Stripe API: don't. Put
 * the branch at the call site with the 5-line preamble instead.
 */

import { PASSTHROUGH, ProviderOutcome } from "./types.ts";

/** Always passthrough. See the module comment for why this is the whole file. */
export function stripeCheckout(): ProviderOutcome { return PASSTHROUGH; }
export function stripeRefund(): ProviderOutcome { return PASSTHROUGH; }
