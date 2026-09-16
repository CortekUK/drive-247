// TRAX read-only Stripe bridge. Reads the existing Stripe secrets by name, like every
// other Stripe function, and performs only TRAX's fixed GET reads. Service-role callers only.
import { handleStripeReadRequest } from '../trax-support/support/stripe-read-function.ts';

Deno.serve((req: Request) => handleStripeReadRequest(req, (key) => Deno.env.get(key)));
