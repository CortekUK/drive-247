import { FLOW_BOOK } from "./book";
import { FLOW_INSURANCE } from "./insurance";
import { FLOW_PAY } from "./pay";
import { FLOW_BOOKINGS } from "./bookings";
import { FLOW_EXTEND } from "./extend";
import { FLOW_PAY_DUE } from "./pay-due";
import { FLOW_MESSAGES } from "./messages";
import { FLOW_KEYS, FLOW_SIGN, FLOW_VERIFY } from "./existing";
import type { Flow } from "./types";

/*
 * The renter flows "How it works" plays, in the order a renter meets them:
 * booking, cover, ID, payment, the agreement, the keys, then their account.
 * Every one is a real flow of the ORIGINAL booking design that every new
 * tenant gets. Left out because the product doesn't have them for those
 * tenants: cancelling a booking, returning the car, paying a fine, and the
 * lockbox code inside the portal.
 */
export const FLOWS: Flow[] = [
  FLOW_BOOK,
  FLOW_INSURANCE,
  FLOW_VERIFY,
  FLOW_PAY,
  FLOW_SIGN,
  FLOW_KEYS,
  FLOW_BOOKINGS,
  FLOW_EXTEND,
  FLOW_PAY_DUE,
  FLOW_MESSAGES,
];
export type { Flow } from "./types";
