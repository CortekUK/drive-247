"use client";

// Lives in shared/portal-v2/page-search-slot.tsx (the customer portal's shell
// takes a list page's search the same way). Re-exported so every page keeps
// its import.
export {
  PageSearchProvider,
  usePageSearch,
  usePageSearchSlot,
  type PageFilterRegistration,
  type PageSearchRegistration,
} from "../../../../../../shared/portal-v2/page-search-slot";
