"use client";

/**
 * Inshur — DESIGN SANDBOX. A "coming soon" screen for fleet cover, for the
 * landing page's Insurance story.
 *
 * Built from the portal's own pieces (the v2 kit's Surface, the Integrations
 * StatusChip, the app's wash) and the Inshur panel's own words
 * (`_panels/inshur.tsx`). The fleet list on the right is a preview with demo
 * cars, marked as one: Inshur is not available yet, and nothing here reads or
 * writes anything.
 */

import { Bell, CalendarClock, Car, MapPin, Receipt, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Surface } from "@/components/rentals-v2/rental-detail/_kit";
import { StatusChip } from "@/app/(dashboard)/integrations/_panels/_kit";

const WASH = [
  "radial-gradient(40rem 26rem at 105% -10%, hsl(var(--v2-wash) / 0.30), transparent 62%)",
  "radial-gradient(34rem 24rem at -8% -6%, hsl(var(--chart-3) / 0.24), transparent 58%)",
  "radial-gradient(36rem 22rem at 50% 118%, hsl(var(--v2-wash) / 0.20), transparent 62%)",
  "linear-gradient(180deg, hsl(var(--v2-wash) / 0.08) 0%, transparent 45%)",
].join(", ");

/** The Inshur panel's four promises (_panels/inshur.tsx), said shorter. */
const WILL = [
  { Icon: CalendarClock, title: "Cover between rentals", body: "Parked, being moved or out on hire, every car is covered." },
  { Icon: ShieldCheck, title: "Checked before you commit", body: "Each car is checked against Inshur's rules up front." },
  { Icon: Receipt, title: "You or the renter pays", body: "Set it once, and I apply it to every rental." },
  { Icon: MapPin, title: "State by state", body: "I keep the states you can write cover in up to date." },
];

/** A preview of the fleet with Inshur on: demo cars only. */
const FLEET: { car: string; plate: string; where: string; cover: string; tone: "bonzah" | "inshur" }[] = [
  { car: "Honda Accord", plate: "6HNA118", where: "Out on hire", cover: "Bonzah", tone: "bonzah" },
  { car: "Toyota Camry", plate: "8TCM204", where: "On the lot", cover: "Inshur", tone: "inshur" },
  { car: "Tesla Model 3", plate: "3TSL771", where: "Being moved", cover: "Inshur", tone: "inshur" },
  { car: "Kia Sportage", plate: "5KSP390", where: "In for service", cover: "Inshur", tone: "inshur" },
];

export default function InshurFake() {
  return (
    <main className="flex min-h-screen items-stretch justify-center bg-app-gradient sm:items-center sm:p-10">
      <div
        className="w-full max-w-5xl bg-background px-5 pb-8 pt-8 sm:rounded-[28px] sm:p-8 sm:shadow-xl sm:ring-1 sm:ring-foreground/5"
        style={{ backgroundImage: WASH }}
      >
        {/* Logo top-left, status top-right: the Integrations dialog's standard. */}
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://img.logo.dev/inshur.com?token=pk_EmodMTbiSPiHDa2fIPUo3w&size=128&format=png"
            alt="Inshur"
            className="size-10 rounded-xl object-contain"
          />
          <span className="font-heading text-base font-semibold sm:text-lg">Inshur fleet cover</span>
          <div className="ml-auto [&>*]:inline-flex [&>*]:h-6 [&>*]:items-center [&>*]:rounded-full [&>*]:px-2.5 [&>*]:text-[11px] [&>*]:font-medium [&>*]:normal-case [&>*]:tracking-normal">
            <StatusChip state="disconnected" label="Coming soon" />
          </div>
        </div>

        {/* On a phone: the headline, the fleet, then the button; the four promises stay for wider screens. */}
        <div className="mt-6 flex flex-col gap-6 sm:mt-8 sm:grid sm:grid-cols-[1fr_1.1fr] sm:gap-8">
          {/* What it is, and what it will do. */}
          <div className="flex flex-col">
            <h2 className="font-heading text-2xl font-semibold leading-tight tracking-tight sm:text-[28px]">
              Cover for every car, not just the ones out on hire.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Bonzah covers a rental while the renter has the car. Inshur will be the policy underneath your whole fleet.
            </p>
            <div className="mt-6 hidden grid-cols-2 gap-x-5 gap-y-4 sm:grid">
              {WILL.map(({ Icon, title, body }) => (
                <div key={title} className="flex gap-2.5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="size-3.5" />
                  </span>
                  <div>
                    <p className="text-[13px] font-semibold leading-snug">{title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{body}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="order-last mt-auto hidden items-center gap-3 pt-8 sm:flex">
              <Button className="h-10 rounded-2xl px-5">
                <Bell className="size-4" />
                Tell me when it&rsquo;s ready
              </Button>
              <span className="text-xs text-muted-foreground">Your Bonzah cover is unaffected.</span>
            </div>
          </div>

          {/* A preview of the fleet with Inshur on. */}
          <Surface className="relative p-5">
            <div className="flex items-center gap-2">
              <h3 className="font-heading text-sm font-semibold">Your fleet</h3>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Preview</span>
              <span className="ml-auto text-xs text-muted-foreground">4 cars · all covered</span>
            </div>
            <div className="mt-4 divide-y divide-foreground/5 overflow-hidden rounded-3xl bg-muted/40 ring-1 ring-foreground/5">
              {FLEET.map((f) => (
                <div key={f.plate} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-foreground/5">
                    <Car className="size-4 text-muted-foreground" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{f.car}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {f.plate} · {f.where}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium",
                      f.tone === "bonzah" ? "bg-[#d6336c]/10 text-[#b0245a]" : "bg-primary/10 text-primary"
                    )}
                  >
                    <ShieldCheck className="size-3" />
                    {f.cover}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Inshur isn&rsquo;t available yet. When it is, I&rsquo;ll switch it on here, and every car on your lot is covered the same as
              one that&rsquo;s out.
            </p>
          </Surface>

          <Button className="h-11 w-full rounded-2xl sm:hidden">
            <Bell className="size-4" />
            Tell me when it&rsquo;s ready
          </Button>
        </div>
      </div>
    </main>
  );
}
