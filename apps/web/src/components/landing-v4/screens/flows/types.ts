import type { ReactNode } from "react";

/*
 * One renter flow in "How it works" (the flow picker, interactive.tsx).
 * `Screen` draws the phone's page for one step (0-based) at the 390 × 820
 * phone size; the picker shows step after step, each for its `ms`, with its
 * caption under the phone ("Step 2 of 4: …").
 */
export type FlowStep = { caption: string; ms: number };
export type Flow = {
  id: string;
  /** the flow's name in the picker, from the renter's side ("Book a car") */
  title: string;
  /** one line under the name: what the renter gets done */
  blurb: string;
  /** shown under the blurb when the flow depends on a setting (e.g. lockbox) */
  note?: string;
  steps: FlowStep[];
  Screen: (props: { step: number }) => ReactNode;
};
