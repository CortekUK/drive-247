"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Gauge, CalendarCheck, ArrowRight, CheckCircle2 } from "lucide-react";
import { useVehiclesNeedingOdometer } from "@/hooks/use-vehicle-odometer";
import { useFleetHealthStats } from "@/hooks/use-fleet-health";
import { RecordOdometerDialog } from "@/components/fleet-health/record-odometer-dialog";

interface FleetHealthSetupProps {
  /** Lets the operator dismiss the setup screen and look at the list anyway. */
  onSkip?: () => void;
}

/**
 * The zero/low-coverage experience.
 *
 * This screen exists because of a measured problem, not a hypothetical one: across
 * real tenants only ~20% of vehicles have an odometer reading, and several sizeable
 * fleets have none at all. Rendering the normal table for those tenants shows a
 * screen of "Unknown", which reads as broken software rather than as missing input —
 * and until now there was no control anywhere in the product that let a human type
 * an odometer value, so the operator could not have fixed it even if motivated.
 *
 * Two deliberate choices:
 *  - Progress is finite and visible ("7 of 22 set up") so the work feels bounded.
 *  - It leads with what already works with zero input (compliance dates), so the
 *    tenant gets value before finishing — or without ever finishing.
 */
export function FleetHealthSetup({ onSkip }: FleetHealthSetupProps) {
  const { data: pending = [], isLoading } = useVehiclesNeedingOdometer();
  const stats = useFleetHealthStats();
  const [active, setActive] = useState<{ id: string; reg: string } | null>(null);

  const done = stats.seeded;
  const total = stats.total;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  if (isLoading || stats.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-56" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg font-medium">
            <Gauge className="h-5 w-5 text-[#6366f1]" />
            Set up Fleet Health
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="max-w-3xl text-sm text-[#404040]">
            Registration and inspection dates are already being tracked — those work with
            no setup at all, and any vehicle that is out of date is shown below the moment
            you finish here. Mileage-based schedules (oil, tyres, brakes) need one extra
            thing: a starting odometer reading for each vehicle. It is one number per car.
          </p>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-[#080812]">
                {done} of {total} vehicle{total === 1 ? "" : "s"} set up
              </span>
              <span className="text-[#737373]">{pct}%</span>
            </div>
            <Progress value={pct} className="h-2" />
          </div>

          <div className="flex flex-wrap gap-2">
            {pending.length > 0 && (
              <Button
                className="bg-[#6366f1] hover:bg-[#4f46e5]"
                onClick={() => setActive({ id: pending[0].id, reg: pending[0].reg })}
              >
                Start with {pending[0].reg}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
            {onSkip && (
              <Button variant="outline" onClick={onSkip}>
                Skip for now
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">
            Vehicles needing a reading
            <span className="ml-2 text-sm font-normal text-[#737373]">
              ({pending.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {pending.length === 0 ? (
            <div className="flex items-center gap-2 p-6 text-sm text-[#404040]">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              Every vehicle has a reading. Mileage schedules are active.
            </div>
          ) : (
            <ul className="divide-y divide-[#f1f5f9]">
              {/* Ordered by urgency: vehicles carrying a compliance date first. */}
              {pending.map((v: any) => (
                <li
                  key={v.id}
                  className="flex items-center justify-between gap-4 px-6 py-3"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/vehicles/${v.id}`}
                      className="text-sm font-medium text-[#080812] hover:text-[#6366f1]"
                    >
                      {v.reg}
                    </Link>
                    <div className="truncate text-xs text-[#737373]">
                      {[v.make, v.model].filter(Boolean).join(" ") || "—"}
                      {(v.mot_due_date || v.tax_due_date) && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[#404040]">
                          <CalendarCheck className="h-3 w-3" />
                          has compliance dates
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setActive({ id: v.id, reg: v.reg })}
                  >
                    Record reading
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {active && (
        <RecordOdometerDialog
          vehicleId={active.id}
          vehicleLabel={active.reg}
          currentMileage={null}
          open={!!active}
          onOpenChange={(open) => {
            if (!open) setActive(null);
          }}
        />
      )}
    </div>
  );
}
