"use client";

/**
 * The playground hub — DESIGN SANDBOX.
 *
 * Four doors into four fake screens. Nothing behind any of them touches a
 * real row: no Supabase, no tenant, no auth. This is where a flow gets tried
 * and argued about before any of it is built for real.
 */

import Link from "next/link";
import { Car, Key, Users, Globe, ArrowRight, FlaskConical } from "lucide-react";

const DOORS = [
  {
    href: "/playground/rental-create-fake",
    icon: Key,
    title: "Create new rental",
    blurb:
      "A rental that exists from the first click. No form, no submit — a rail of settings, and documents that notice when the settings move.",
    tag: "Designed",
  },
  {
    href: "/playground/vehicle-detail-fake",
    icon: Car,
    title: "Vehicle record",
    blurb:
      "Left rail: plain navigation, nine panels in four groups — the car, its pricing, its operations, and the record produced from them. Right rail: how the car is doing, and one click to whatever is amber.",
    tag: "Second pass",
  },
  {
    href: "/playground/cms-fake",
    icon: Globe,
    title: "Website content",
    blurb:
      "One renderer for the whole site instead of fourteen screens. No cards, no tabs, no Save button — a keystroke is the commit, and the only button publishes.",
    tag: "First pass",
  },
  {
    href: "/playground/customer-detail-fake",
    icon: Users,
    title: "Customer record",
    blurb:
      "Three columns. Left navigates the record, middle is where you work, right says whether you can hand them keys and what is stopping it — and moves as you type.",
    tag: "Designed",
  },
];

export default function PlaygroundHub() {
  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-3xl px-6 py-20">
        <div className="mb-12">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-light px-3 py-1 text-xs font-medium text-primary">
            <FlaskConical className="size-3.5" />
            Sandbox
          </span>
          <h1 className="mt-4 font-heading text-4xl font-semibold tracking-tight">Playground</h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Fake screens with fake data, built to argue about the flow before any of it is real.
            Nothing here reads or writes a live record.
          </p>
        </div>

        <div className="space-y-3">
          {DOORS.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              className="group flex items-start gap-5 rounded-4xl bg-card p-6 shadow-md ring-1 ring-foreground/5 transition-all hover:ring-primary/40 dark:ring-foreground/10"
            >
              <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-3xl bg-primary-light transition-colors group-hover:bg-primary">
                <d.icon className="size-5 text-primary transition-colors group-hover:text-primary-foreground" />
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2.5">
                  <span className="font-heading text-base font-semibold">{d.title}</span>
                  <span className="rounded-3xl bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {d.tag}
                  </span>
                </span>
                <span className="mt-1.5 block text-sm leading-relaxed text-muted-foreground">{d.blurb}</span>
              </span>

              <ArrowRight className="mt-3 size-4 shrink-0 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
