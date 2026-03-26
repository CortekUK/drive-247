"use client";

import { useEffect, useState } from "react";

// Map observed element IDs to the nav link they represent
const SECTION_MAP: Record<string, string> = {
  features: "features",
  "features-renter": "features",
  "features-booking": "features",
  timeline: "timeline",
  pricing: "pricing",
  faq: "faq",
};

// Nav link priority order (first visible in this order wins)
const NAV_ORDER = ["features", "timeline", "pricing", "faq"];

export function useActiveSection() {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    // Track by element ID, not nav ID — avoids stale deletion
    const visibleElements = new Set<string>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibleElements.add(entry.target.id);
          } else {
            visibleElements.delete(entry.target.id);
          }
        }

        // Derive active nav link: check if ANY element for each nav link is visible
        const active =
          NAV_ORDER.find((navId) =>
            [...visibleElements].some((elId) => SECTION_MAP[elId] === navId)
          ) ?? null;
        setActiveId(active);
      },
      { rootMargin: "-80px 0px -20% 0px" }
    );

    for (const id of Object.keys(SECTION_MAP)) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  return activeId;
}
