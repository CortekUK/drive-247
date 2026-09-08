"use client";

/**
 * Website vehicles — which of the tenant's real cars a visitor can see.
 *
 * ── it lists the Portal fleet, and copies nothing ───────────────────────────
 *
 * Every row here is a real `vehicles` record. The name, photo, price and
 * status shown are read straight from it, and the only thing this screen
 * writes is one boolean. Nothing is re-entered, so nothing can drift out of
 * sync with the fleet the operator actually runs.
 *
 * ── hiding is not removing, and the copy says so ────────────────────────────
 *
 * An operator looking at a switch labelled only "visible" reasonably worries
 * they are about to take a car off the road. The footnote states plainly that
 * a hidden vehicle keeps working everywhere in the Portal — because the
 * alternative is that nobody dares touch it.
 */

import { Car, Eye, EyeOff, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui-v2/switch";
import { useWebsiteVehicles } from "@/hooks/use-website-vehicles";
import { toast } from "sonner";

function money(value: number | null): string | null {
  if (value == null) return null;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function WebsiteVehiclesPanel({ canEdit }: { canEdit: boolean }) {
  const { vehicles, visibleCount, isLoading, error, setVisibility } = useWebsiteVehicles();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/60" />
        ))}
      </div>
    );
  }

  /* A failed read is not an empty fleet, and must not render as one — an
     operator seeing "no vehicles" would go looking for deleted cars. */
  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
        Could not load your vehicles. {(error as Error).message}
      </div>
    );
  }

  if (vehicles.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center">
        <Car className="mx-auto mb-3 size-8 text-muted-foreground" />
        <p className="text-[13px] font-medium">No vehicles yet</p>
        <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-muted-foreground">
          Vehicles you add to your fleet appear here, and you can choose which of them show on
          your website.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[12px] text-muted-foreground">
          {visibleCount} of {vehicles.length} shown on your website
        </p>
      </div>

      <div className="divide-y divide-border/50 overflow-hidden rounded-2xl border border-border">
        {vehicles.map((v) => {
          const name = [v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle";
          const price = money(v.daily_rent);

          return (
            <div key={v.id} className="flex items-center gap-3 px-4 py-2.5">
              {v.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={v.photo_url}
                  alt=""
                  className="size-10 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Car className="size-4 text-muted-foreground" />
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {[v.reg, price ? `${price}/day` : null, v.status]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>

              <span
                className={`hidden shrink-0 items-center gap-1 text-[11px] sm:inline-flex ${
                  v.show_on_website ? "text-muted-foreground" : "text-muted-foreground/60"
                }`}
              >
                {v.show_on_website ? (
                  <>
                    <Eye className="size-3" />
                    Visible
                  </>
                ) : (
                  <>
                    <EyeOff className="size-3" />
                    Hidden
                  </>
                )}
              </span>

              <Switch
                checked={v.show_on_website}
                disabled={!canEdit || setVisibility.isPending}
                aria-label={`Show ${name} on the website`}
                onCheckedChange={(next) =>
                  setVisibility.mutate(
                    { id: v.id, visible: next },
                    {
                      /* Never silent: the toggle is optimistic, so a failure
                         that said nothing would leave the switch showing a
                         state the database does not have. */
                      onError: (e: Error) =>
                        toast.error("Could not change website visibility", {
                          description: e.message,
                        }),
                    },
                  )
                }
              />
            </div>
          );
        })}
      </div>

      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Hiding a vehicle only removes it from your website. It stays in your fleet, can still be
        rented from the Portal, and keeps its existing bookings.
      </p>

      {setVisibility.isPending && (
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Saving…
        </p>
      )}
    </div>
  );
}
