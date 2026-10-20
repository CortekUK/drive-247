"use client";

// Lives in shared/portal-v2/timeline/timeline-board.tsx (the customer portal's
// Rentals calendar draws it too). The stylesheet is imported here as well as
// by the board's other operator users; the customer site compiles it into its
// own stylesheet (styles/site.css).
import "../../../../../shared/portal-v2/timeline/timeline.css";

export {
  Status,
  TimelineBoard,
  initialTimelineView,
  type TimelineBoardProps,
  type TimelineRange,
  type TimelineView,
} from "../../../../../shared/portal-v2/timeline/timeline-board";
