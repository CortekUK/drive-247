/**
 * /booking — v2. The flow is vehicle-first, so there is nothing to book here
 * without a car: this forwards to the fleet with the query intact. It is the
 * current site's route, re-used rather than copied, so the forwarding rule
 * lives in one place.
 */
export { default } from "../../../../(northwind)/northwind-site/(booking)/booking/page";
