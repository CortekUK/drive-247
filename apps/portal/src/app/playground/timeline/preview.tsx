"use client";

import { useState } from "react";
import { CalendarDays, Car, ChevronRight, KeyRound, Moon, Sun, Users } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { TimelineBoard, type TimelineRange } from "@/components/timeline-v2/timeline-board";
import { ContextTabs, ResponsiveContextRail } from "@/components/timeline-v2/context-rail";
import { RentalPlanView } from "@/components/timeline-v2/rental-plan";
import { VehicleTimelinePricing } from "@/components/timeline-v2/vehicle-pricing";
import { BlockDatesDialog } from "@/components/timeline-v2/timeline-dialogs";
import { EMPTY_TIMELINE, type TimelineData } from "@/components/timeline-v2/model";
import { DENSE_BOOKINGS, FIXTURE_DATA, PREVIEW_TODAY, VEHICLES } from "./fixtures";
import { RENTAL_PERIOD_CASES } from "./rental-period-fixtures";

export function TimelinePreview() {
  const [surface, setSurface] = useState("main");
  const [state, setState] = useState("ready");
  const [dark, setDark] = useState(false);
  const [range, setRange] = useState<TimelineRange>({ start: "2026-09-08", days: 14, period: "fortnight" });
  const [blocks, setBlocks] = useState(FIXTURE_DATA.blocks);
  const [blockOpen, setBlockOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [rentalCase, setRentalCase] = useState("original");
  const sourceBookings = state === "dense" ? DENSE_BOOKINGS : FIXTURE_DATA.bookings;
  const choose = (next: string) => { setSurface(next); setRange({ start: "2026-09-08", days: next === "main" ? 14 : 7, period: next === "main" ? "fortnight" : "week" }); };
  const data: TimelineData = state === "empty" ? EMPTY_TIMELINE : {
    ...FIXTURE_DATA, blocks: surface === "customer" || surface === "rental" ? [] : blocks,
    bookings: surface === "vehicle" ? sourceBookings.filter(b => b.vehicle.id === VEHICLES[0].id) : surface === "customer" ? sourceBookings.filter(b => b.customer.name === "Alex Morgan") : sourceBookings,
    vehicles: surface === "vehicle" ? [VEHICLES[0]] : VEHICLES,
  };
  const props = { data, range, onRange: setRange, today: PREVIEW_TODAY, currency: "USD", timezone: "America/New_York", error: state === "error" ? "We couldn't load this timeline. Your records have not changed." : null, loading: state === "loading", onRetry: () => setState("ready") };
  const board = <><TimelineBoard {...props} compact={surface !== "main"} fixedPerspective={surface !== "main"} perspective={surface === "vehicle" ? "vehicle" : surface === "customer" ? "customer" : "rental"} onExpand={surface !== "main" ? () => setExpanded(true) : undefined} onBlock={surface === "main" || surface === "vehicle" ? () => setBlockOpen(true) : undefined} /></>;
  const plan = <RentalPlanView key={rentalCase} data={state === "empty" ? EMPTY_TIMELINE : RENTAL_PERIOD_CASES[rentalCase]} today={PREVIEW_TODAY} currency="USD" timezone="America/New_York" canPreview={rentalCase !== "readonly"} unsupported={rentalCase === "unsupported"} loading={state === "loading"} error={state === "error" ? "The rental periods could not be loaded." : undefined} onRetry={() => setState("ready")} />;
  return <div className="min-h-screen bg-background text-foreground">
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/40 px-5 py-3 text-xs">
      <strong className="text-primary">Drive247 · Timeline V2</strong><span className="text-muted-foreground">Development fixtures · isolated from live records</span>
      <div className="ml-auto flex gap-2"><select aria-label="Preview state" value={state} onChange={e => setState(e.target.value)} className="rounded-lg border border-border bg-background px-2"><option value="ready">Ready</option><option value="dense">Dense & short bookings</option><option value="empty">Empty</option><option value="loading">Loading</option><option value="error">Error</option></select><Button size="icon-sm" variant="outline" aria-label="Toggle preview theme" onClick={() => { document.documentElement.classList.toggle("dark", !dark); setDark(!dark); }}>{dark ? <Sun size={14} /> : <Moon size={14} />}</Button></div>
    </div>
    <nav className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3" aria-label="Preview surface">{([['main', 'Main calendar', CalendarDays], ['rental', 'Rental', KeyRound], ['customer', 'Customer', Users], ['vehicle', 'Vehicle', Car]] as const).map(([id, label, Icon]) => <Button key={id} size="sm" variant={surface === id ? "secondary" : "ghost"} onClick={() => choose(id)}><Icon size={14} />{label}</Button>)}{surface === "rental" && <select aria-label="Rental example" value={rentalCase} onChange={event => setRentalCase(event.target.value)} className="ml-auto rounded-md border border-border bg-background p-2 text-xs"><option value="original">Original rental</option><option value="recorded">Recorded extensions</option><option value="long">Across months & years</option><option value="readonly">Read-only permission</option><option value="unsupported">Open-ended rental</option></select>}</nav>
    {surface === "main" ? <main className="flex min-w-0"><aside className="hidden w-56 shrink-0 border-r border-border p-5 lg:block"><p className="text-sm font-semibold">Drive247</p><p className="mt-1 text-xs text-muted-foreground">Preview workspace</p><div className="mt-8 space-y-5 text-xs text-muted-foreground"><p>Dashboard</p><p>Customers</p><p>Vehicles</p><p className="text-primary">Rentals</p></div></aside><div className="min-w-0 flex-1 p-4"><div className="mb-5 flex items-center gap-2 text-xs text-muted-foreground">Rentals <ChevronRight size={13} /><span className="text-foreground">Calendar View</span></div>{board}</div></main> : <main className="flex h-[calc(100svh-110px)] min-h-0">
      <div className="hidden w-48 shrink-0 border-r border-border p-5 md:block"><p className="mb-7 text-xs text-muted-foreground">← {surface === "rental" ? "Rentals" : surface === "customer" ? "Customers" : "Vehicles"}</p>{(surface === "rental" ? ['Customer', 'Vehicle', 'When', 'Extras', 'Agreement', 'Insurance', 'Payments', 'Handover'] : surface === "customer" ? ['Identity', 'Licence', 'Verification', 'Account', 'Rentals', 'Documents'] : ['Identity', 'Listing', 'Pricing', 'Operations', 'Maintenance', 'Documents']).map((label, i) => <div key={label} className={`mb-1 rounded-lg px-3 py-2.5 text-xs ${i === 0 ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}>{label}</div>)}</div>
      <div className="min-w-0 flex-1 p-6 lg:p-10"><span className="text-xs text-muted-foreground">{surface === "rental" ? "Rental RNT-2026-0841" : surface === "customer" ? "Customer record" : "Vehicle record"}</span><h1 className="mt-3 font-heading text-3xl font-semibold">{surface === "vehicle" ? "Toyota RAV4 Hybrid" : "Alex Morgan"}</h1><p className="mt-3 max-w-lg text-sm text-muted-foreground">{surface === "rental" ? "Fixed rental · September 10–12, 2026" : surface === "customer" ? "Booking history, current rental and upcoming trips." : "PREVIEW 01 · daily, weekly and monthly rates"}</p><div className="mt-9 max-w-xl rounded-2xl border border-border p-6"><p className="text-sm font-medium">Context panel preview</p><p className="mt-2 text-xs leading-relaxed text-muted-foreground">The right-hand panel renders the shared production timeline at its real detail-panel width. The surrounding record is a fixture for layout review.</p></div></div>
      <ResponsiveContextRail label={surface === "rental" ? "Payment Plan & activity" : "Timeline & overview"} breakpoint={surface === "customer" ? 1400 : 1280} width={surface === "vehicle" ? 336 : surface === "customer" ? 344 : 360}>
        <ContextTabs key={surface} label="Record context" defaultValue={surface === "rental" ? "payment-plan" : "timeline"} tabs={surface === "rental" ? [
          { id: "payment-plan", label: "Payment Plan", content: plan, keepMounted: true }, { id: "messages", label: "Messages", content: <p className="text-xs text-muted-foreground">Fixture preview. Live messages remain on the rental record.</p> }, { id: "activity", label: "Activity", content: <p className="text-xs text-muted-foreground">Fixture preview. Live activity remains on the rental record.</p> },
        ] : [{ id: "overview", label: surface === "customer" ? "At a glance" : "Overview", content: <p className="text-xs text-muted-foreground">Existing overview remains in the live record.</p> }, ...(surface === "vehicle" ? [{ id: "activity", label: "Activity", content: <p className="text-xs text-muted-foreground">Existing vehicle activity is preserved.</p> }] : []), { id: "timeline", label: "Timeline", content: <>{surface === "vehicle" && <VehicleTimelinePricing vehicle={VEHICLES[0]} currency="USD" />}{board}</> }]} />
      </ResponsiveContextRail>
    </main>}
    <Dialog open={expanded} onOpenChange={setExpanded}><DialogContent className="w-[calc(100vw-2rem)] rounded-2xl sm:max-w-[1180px] max-h-[90svh] overflow-auto"><DialogHeader><DialogTitle>Booking timeline</DialogTitle><DialogDescription>Development fixtures · expanded detail view.</DialogDescription></DialogHeader><TimelineBoard {...props} fixedPerspective perspective={surface === "vehicle" ? "vehicle" : "customer"} /></DialogContent></Dialog>
    {blockOpen && <BlockDatesDialog vehicles={data.vehicles} vehicleId={surface === "vehicle" ? VEHICLES[0].id : undefined} start={PREVIEW_TODAY} previewOnly onClose={() => setBlockOpen(false)} onConfirm={async input => { setBlocks(b => [...b, { id: `fixture-block-${b.length}`, vehicleId: input.vehicleId, start: input.startDate, end: input.endDate, reason: input.reason, preview: true }]); }} />}
  </div>;
}
