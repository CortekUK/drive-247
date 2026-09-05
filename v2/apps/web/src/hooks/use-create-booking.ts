"use client";

import { useCallback, useRef, useState } from "react";

import { createBooking } from "@/lib/booking/create-booking";
import type {
  CreateBookingFailure,
  CreateBookingParams,
  CreateBookingResult,
  CreatedBooking,
} from "@/lib/booking/types";

/**
 * Commit the booking, and say honestly what is happening while it commits.
 *
 * A thin state machine over `createBooking`. It exists for two reasons that a
 * bare `await` in the click handler would not give:
 *
 *  1. THE BUTTON MUST NOT BE PRESSABLE TWICE. The write takes several
 *     round-trips (customer, vehicle, draft lookup, rental, extras, invoice,
 *     ledger), which is long enough for an impatient second click. Two
 *     concurrent runs would both miss the other's draft and race the overlap
 *     trigger, so one of them dies with "this vehicle is taken" — by the
 *     customer's own half-written booking. The in-flight guard here is what
 *     stops that, and it is a ref rather than state because state updates are
 *     asynchronous and the second click can land first.
 *
 *  2. The page needs three distinct things to say — creating, opening payment,
 *     failed-with-retry — and they are states, not a boolean.
 *
 * `create` also RETURNS the result, so the caller can act on it in the same
 * turn (open the payment dialog) instead of watching for a state transition in
 * an effect.
 */

export type CreateBookingState =
  | { status: "idle" }
  | { status: "creating" }
  | { status: "ready"; booking: CreatedBooking }
  | { status: "failed"; failure: CreateBookingFailure };

export interface UseCreateBookingResult {
  state: CreateBookingState;
  /** Safe to call again after a failure; a second call while one is in flight is ignored. */
  create: (params: CreateBookingParams) => Promise<CreateBookingResult | null>;
  /** Back to `idle`. Does NOT delete anything already written. */
  reset: () => void;
}

const UNEXPECTED: CreateBookingFailure = {
  kind: "write-failed",
  message:
    "Something went wrong before we could save your booking, so nothing has " +
    "been charged. Please try again.",
  retryable: true,
  detail: null,
};

export function useCreateBooking(): UseCreateBookingResult {
  const [state, setState] = useState<CreateBookingState>({ status: "idle" });
  const inFlight = useRef(false);

  const reset = useCallback(() => {
    // Only ever clears the UI state. The rental it created is still there and
    // still findable — that is the whole point of the draft lookup, and
    // pretending otherwise here would invite a second one.
    setState({ status: "idle" });
  }, []);

  const create = useCallback(
    async (params: CreateBookingParams): Promise<CreateBookingResult | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setState({ status: "creating" });

      try {
        const result = await createBooking(params);
        setState(
          result.ok
            ? { status: "ready", booking: result.booking }
            : { status: "failed", failure: result.failure },
        );
        return result;
      } catch (error: unknown) {
        // `createBooking` reports its own failures as values; reaching here
        // means something threw — a network fault inside supabase-js, or a bug.
        // Either way the customer gets the truth: nothing was charged.
        const detail =
          error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        const failure: CreateBookingFailure = { ...UNEXPECTED, detail };
        setState({ status: "failed", failure });
        return { ok: false, failure };
      } finally {
        inFlight.current = false;
      }
    },
    [],
  );

  return { state, create, reset };
}
