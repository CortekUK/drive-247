import { BookingFlowSkeleton } from "@nw/site-v2/book/booking-flow-page";

/** /booking while it loads: the flow's own skeleton, not a blank page. */
export default function BookingFlowLoadingV2() {
  return <BookingFlowSkeleton />;
}
