"use client";

/**
 * Trax — a tab of the right rail, about THIS rental.
 *
 * The same TRAX the floating panel and `/trax` run (`TraxSupportThread`:
 * verified answers, Check again, payment cards, the Support handoff), but its
 * own conversation (`TraxScopedSupportProvider`), so asking about this rental
 * neither lands in nor disturbs the operator's main Trax thread. The rental
 * reaches the server through `pageContext`, which `useTraxSupport` reads from
 * the URL — on `/rentals/<id>` that is `{ kind: "rental", id }` — and the
 * starter prompts name the rental, so the first question is already scoped.
 *
 * The tab is kept mounted (so switching to Activity and back keeps the thread)
 * but activated lazily: no request is made until the tab is first shown.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CreditCard, FileText, ShieldCheck } from "lucide-react";
import { TraxSupportThread } from "@/components/trax/support/TraxSupportThread";
import { TraxScopedSupportProvider } from "@/components/trax/support/trax-support-context";
import { supportHref } from "@/lib/support-route";
import type { RentalDetailV2 } from "./use-rental-detail-v2";

/** True while the element is laid out — the tab strip hides inactive tabs with
 *  `display: none`, which gives them no box. */
function useShown<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setShown(el.offsetWidth > 0 || el.offsetHeight > 0);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, shown] as const;
}

export function RailTrax({ detail }: { detail: RentalDetailV2 }) {
  const router = useRouter();
  const [ref, shown] = useShown<HTMLDivElement>();
  const ref_ = detail.rentalNumber ? `rental ${detail.rentalNumber}` : "this rental";

  const suggestions = [
    { icon: FileText, label: "Summarise this rental", prompt: `Summarise ${ref_} for me.` },
    { icon: CreditCard, label: "What's still owed?", prompt: `What is still owed on ${ref_}?` },
    { icon: CalendarClock, label: "When is it due back?", prompt: `When is ${ref_} due back, and is anything scheduled around it?` },
    { icon: ShieldCheck, label: "Is the customer verified?", prompt: `Is the customer on ${ref_} verified, and is anything missing before handover?` },
  ];

  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col">
      <TraxScopedSupportProvider active={shown}>
        <TraxSupportThread
          density="sheet"
          compact
          suggestions={suggestions}
          intro={`Ask anything about ${ref_}.`}
          onOpenSupport={(target) => router.push(supportHref(target))}
        />
      </TraxScopedSupportProvider>
    </div>
  );
}

export default RailTrax;
