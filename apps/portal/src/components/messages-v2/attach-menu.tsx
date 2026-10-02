"use client";

/**
 * The composer's ONE attachment control.
 *
 * ── why this exists ─────────────────────────────────────────────────────────
 *
 * The first version of the composer rendered two paperclips side by side: its
 * own file button, and `BookingPicker`, which draws a paperclip of its own. Two
 * identical icons an inch apart, doing different things, with no way to tell
 * which was which. That is the bug this replaces.
 *
 * One button, one popover, two actions. The popover has two states rather than
 * spawning a second overlay: a menu, and — if you pick "Attach booking" — the
 * searchable rental list in the same surface. Nesting a Popover inside a
 * DropdownMenu item is the obvious alternative and it is fragile, because the
 * menu closes on select and takes the popover's anchor with it.
 *
 * ── what is reused ──────────────────────────────────────────────────────────
 *
 * `useCustomerRentals` — the same tenant-scoped query `BookingPicker` uses, so
 * this shares its cache and adds no request — and `BookingReference`, so what
 * this produces is byte-identical to what `ChatMessageBubble` already knows how
 * to render. The LIST MARKUP is not reused: BookingPicker draws a plain popover
 * with hardcoded status colours that predate this design system, and the whole
 * point here was to stop the composer looking assembled from spare parts.
 *
 * `BookingPicker` itself is untouched and still used by CustomerChatInput.
 */

import { useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { Paperclip, Search, Upload } from "lucide-react";
import { SteeringWheel } from "@/components/ui/steering-wheel";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui-v2/popover";
import { useCustomerRentals, type CustomerRental } from "@/hooks/use-customer-rentals";
import { AutoSkeleton } from "@/components/skeleton-v2/auto-skeleton";
import { skeletonRows } from "@/lib/skeleton-data";
import { useSkeletonLoading } from "@/hooks/use-skeleton-loading";
import type { BookingReference } from "@/components/chat/BookingPicker";

/** Same derivation BookingPicker uses, so a rental reads the same in both. */
const rentalNumber = (id: string) => `RNT-${id.slice(0, 6).toUpperCase()}`;

const STATUS_TONE: Record<string, string> = {
  active: "bg-green-500/10 text-green-700 dark:text-green-300",
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  reserved: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  completed: "bg-muted text-muted-foreground",
  ended: "bg-muted text-muted-foreground",
  closed: "bg-muted text-muted-foreground",
  cancelled: "bg-destructive/10 text-destructive",
};

/** Placeholder bookings for the picker's skeleton: only their shapes are seen. */
const SKELETON_RENTALS: CustomerRental[] = skeletonRows(3, (f) => ({
  id: f.id,
  start_date: f.date(),
  end_date: f.date(-7),
  monthly_amount: 0,
  status: f.pick(["Active", "Completed", "Pending"]),
  approval_status: null,
  schedule: "",
  created_at: f.date(),
  vehicle: { id: f.id, reg: f.word(6, 8), make: f.word(4, 8), model: f.text(1, 2) },
}));

export function AttachMenu({
  customerId,
  onFiles,
  onBooking,
  disabled,
}: {
  customerId: string;
  onFiles: (files: File[]) => void;
  onBooking: (booking: BookingReference) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"menu" | "booking">("menu");
  const [query, setQuery] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: loadedRentals = [], isLoading: rentalsLoading } = useCustomerRentals(customerId);
  const isLoading = useSkeletonLoading(rentalsLoading);
  // While loading, placeholder bookings render through the real rows below.
  const rentals = isLoading ? SKELETON_RENTALS : loadedRentals;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || isLoading) return rentals;
    return rentals.filter((r) => {
      const vehicle = `${r.vehicle?.make ?? ""} ${r.vehicle?.model ?? ""}`.toLowerCase();
      return (
        vehicle.includes(q) ||
        (r.vehicle?.reg ?? "").toLowerCase().includes(q) ||
        rentalNumber(r.id).toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q)
      );
    });
  }, [rentals, query, isLoading]);

  function close() {
    setOpen(false);
    // Reset to the menu AFTER the popover has gone, or the list visibly
    // flips back to the menu while it is still fading out.
    window.setTimeout(() => {
      setView("menu");
      setQuery("");
    }, 150);
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          if (picked.length) onFiles(picked);
          e.target.value = "";
          close();
        }}
      />

      <Popover open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label="Attach"
            title="Attach a file or a booking"
            className="h-11 w-11 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
          >
            <Paperclip className="h-[18px] w-[18px]" />
          </Button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          side="top"
          sideOffset={10}
          className="w-[320px] overflow-hidden rounded-2xl p-0 ring-1 ring-foreground/5"
        >
          {view === "menu" ? (
            <div className="p-1.5">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[hsl(var(--v2-hover,var(--accent)_/_0.6))]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
                  <Upload className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">Upload file</span>
                  <span className="block text-[11px] text-muted-foreground">
                    Up to 10MB, sent with the message
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => setView("booking")}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[hsl(var(--v2-hover,var(--accent)_/_0.6))]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
                  <SteeringWheel className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">Attach booking</span>
                  <span className="block text-[11px] text-muted-foreground">
                    Link one of this customer&apos;s rentals
                  </span>
                </span>
              </button>
            </div>
          ) : (
            <div>
              <div className="border-b border-border/60 p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search bookings"
                    className="h-9 rounded-full pl-9 text-[13px]"
                  />
                </div>
              </div>

              <div className="max-h-[280px] overflow-y-auto no-scrollbar p-1.5">
                {!isLoading && filtered.length === 0 ? (
                  <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">
                    {rentals.length === 0
                      ? "This customer has no rentals yet."
                      : "No bookings match that search."}
                  </p>
                ) : (
                  <AutoSkeleton loading={isLoading}>
                  {filtered.map((r) => {
                    const tone = STATUS_TONE[r.status.toLowerCase()] ?? "bg-muted text-muted-foreground";
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => {
                          onBooking({
                            id: r.id,
                            rentalNumber: rentalNumber(r.id),
                            status: r.status,
                            startDate: r.start_date,
                            endDate: r.end_date,
                            vehicle: {
                              make: r.vehicle?.make || "",
                              model: r.vehicle?.model || "",
                              reg: r.vehicle?.reg || "",
                            },
                          });
                          close();
                        }}
                        className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[hsl(var(--v2-hover,var(--accent)_/_0.6))]"
                      >
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <SteeringWheel className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-[13px] font-medium">
                              {r.vehicle?.make} {r.vehicle?.model}
                            </span>
                            <span
                              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${tone}`}
                            >
                              {r.status}
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                            {rentalNumber(r.id)} · {r.vehicle?.reg}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            {format(new Date(r.start_date), "d MMM yyyy")}
                            {r.end_date ? ` – ${format(new Date(r.end_date), "d MMM yyyy")}` : ""}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                  </AutoSkeleton>
                )}
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}
