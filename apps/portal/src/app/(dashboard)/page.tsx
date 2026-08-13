"use client";

// ── MOCK dashboard — "Today" horizontal timeline (static data, no wiring) ─────

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Plus, Car, KeyRound, DollarSign, Check, Pencil, TrendingUp } from "lucide-react";
import { useAuth } from "@/stores/auth-store";
import { BonzahPendingAlert } from "@/components/dashboard/bonzah-pending-alert";
import { BonzahStatusBanner } from "@/components/dashboard/bonzah-status-banner";
import { LowCreditsBanner } from "@/components/dashboard/low-credits-banner";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  LabelList,
  Pie,
  PieChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  XAxis,
  YAxis,
} from "recharts";
import { CreditBalance } from "@/components/shared/layout/credit-balance";

// ── timeline config ──────────────────────────────────────────────────────────
const START = 7; // 7am
const END = 22; // 10pm
const SPAN = END - START;
const pct = (t: number) => ((t - START) / SPAN) * 100;
const ticks = [7, 9, 11, 13, 15, 17, 19, 21];
const hourLabel = (h: number) => (h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`);
const timeLabel = (t: number) => {
  const h = Math.floor(t);
  const m = Math.round((t - h) * 60);
  const ap = h < 12 ? "a" : "p";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${m ? ":" + String(m).padStart(2, "0") : ""}${ap}`;
};

type Op = { t: number; kind: "pickup" | "return"; vehicle: string; who: string; overdue?: boolean };
type Pay = { t: number; amount: number; who: string; auto?: boolean };

const ops: Op[] = [
  { t: 9, kind: "pickup", vehicle: "Tesla Model 3", who: "A. Rivera" },
  { t: 10.5, kind: "return", vehicle: "Honda Civic", who: "M. Lee", overdue: true },
  { t: 13.5, kind: "pickup", vehicle: "BMW X5", who: "D. Khan" },
  { t: 16, kind: "return", vehicle: "Tesla Model Y", who: "S. Patel" },
];
const pays: Pay[] = [
  { t: 9, amount: 320, who: "Iniko D.", auto: true },
  { t: 14, amount: 640, who: "Giovante K." },
  { t: 17, amount: 280, who: "Kris D." },
];

const fmt = (n: number) => `$${n.toLocaleString()}`;

// ── chart mock data + configs (shadcn) ───────────────────────────────────────
const revenueData = [
  { label: "Mon", thisWeek: 820, lastWeek: 600 },
  { label: "Tue", thisWeek: 940, lastWeek: 720 },
  { label: "Wed", thisWeek: 1100, lastWeek: 880 },
  { label: "Thu", thisWeek: 980, lastWeek: 1010 },
  { label: "Fri", thisWeek: 1450, lastWeek: 1200 },
  { label: "Sat", thisWeek: 1720, lastWeek: 1500 },
  { label: "Sun", thisWeek: 1300, lastWeek: 1150 },
];
const revenueConfig = {
  thisWeek: { label: "This week", color: "hsl(var(--chart-3))" },
  lastWeek: { label: "Last week", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;

const bookingsData = [
  { label: "Mon", bookings: 4 },
  { label: "Tue", bookings: 5 },
  { label: "Wed", bookings: 6 },
  { label: "Thu", bookings: 5 },
  { label: "Fri", bookings: 8 },
  { label: "Sat", bookings: 9 },
  { label: "Sun", bookings: 7 },
];
const bookingsConfig = {
  bookings: { label: "Bookings", color: "hsl(var(--chart-2))" },
} satisfies ChartConfig;

const splitData = [
  { plan: "daily", label: "Daily", value: 5200, fill: "hsl(var(--chart-3))" },
  { plan: "weekly", label: "Weekly", value: 3100, fill: "hsl(var(--chart-1))" },
  { plan: "monthly", label: "Monthly", value: 1800, fill: "hsl(var(--chart-5))" },
];
const splitTotal = splitData.reduce((s, d) => s + d.value, 0);
const splitConfig = {
  value: { label: "Revenue" },
  daily: { label: "Daily", color: "hsl(var(--chart-3))" },
  weekly: { label: "Weekly", color: "hsl(var(--chart-1))" },
  monthly: { label: "Monthly", color: "hsl(var(--chart-5))" },
} satisfies ChartConfig;

// fleet utilisation radial gauge
const utilisation = 72;
const utilisationData = [{ name: "used", value: utilisation, fill: "hsl(var(--chart-3))" }];
const utilisationConfig = { value: { label: "Utilisation" } } satisfies ChartConfig;

// top vehicles by revenue (horizontal bars)
const topVehicles = [
  { vehicle: "Tesla Model 3", revenue: 4200 },
  { vehicle: "BMW X5", revenue: 3100 },
  { vehicle: "Honda Civic", revenue: 2600 },
  { vehicle: "Tesla Model Y", revenue: 2100 },
  { vehicle: "Toyota Corolla", revenue: 1500 },
];
const topVehiclesConfig = { revenue: { label: "Revenue", color: "hsl(var(--chart-1))" } } satisfies ChartConfig;

// pickups vs returns by day (stacked bars)
const opsByDay = [
  { label: "Mon", pickups: 3, returns: 2 },
  { label: "Tue", pickups: 4, returns: 3 },
  { label: "Wed", pickups: 2, returns: 4 },
  { label: "Thu", pickups: 5, returns: 2 },
  { label: "Fri", pickups: 6, returns: 4 },
  { label: "Sat", pickups: 5, returns: 5 },
  { label: "Sun", pickups: 3, returns: 6 },
];
const opsConfig = {
  pickups: { label: "Pickups", color: "hsl(var(--chart-3))" },
  returns: { label: "Returns", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;

function getGreeting(hour: number): { text: string; emoji: string } {
  if (hour < 5) return { text: "Working late", emoji: "🦉" };
  if (hour < 12) return { text: "Good morning", emoji: "☕" };
  if (hour < 17) return { text: "Good afternoon", emoji: "🌤️" };
  if (hour < 21) return { text: "Good evening", emoji: "🌇" };
  return { text: "Good night", emoji: "✨" };
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className={`size-2 rounded-full ${className}`} /> {label}
    </span>
  );
}

export default function DashboardPage() {
  const { appUser } = useAuth();
  /** First name only — "Good morning, Michael" reads better than the full name. */
  const firstName = (appUser?.name || '').trim().split(/\s+/)[0];

  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000); // tick the "now" line live
    return () => clearInterval(id);
  }, []);
  const greeting = getGreeting(now ? now.getHours() : 8);
  const dateStr = now ? now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : "";
  const timeStr = now ? now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";

  // Public availability (mock business hours 9am–6pm) — reflects what customers
  // see on the booking side. Wire to tenant working_hours per weekday later.
  const OPEN_H = 9;
  const CLOSE_H = 18;
  const hr = now ? now.getHours() : 12;
  const withinHours = true; // forced ON for preview — real: !!now && hr >= OPEN_H && hr < CLOSE_H
  const fmt12 = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;
  const tzAbbr = now ? now.toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ").pop() : "";
  const tzName = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";

  // Temporary booking pause (manual override) + availability editor dialog.
  const [paused, setPaused] = useState(false);
  const [confirmPause, setConfirmPause] = useState(false);
  const [availOpen, setAvailOpen] = useState(false);
  const isOpen = withinHours && !paused;
  const statusLabel = paused ? "Paused" : isOpen ? "Open" : "Closed";
  const toneCls = paused
    ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
    : isOpen
    ? "border-success/30 bg-success/10 text-success hover:bg-success/15"
    : "border-border bg-muted/60 text-muted-foreground hover:bg-muted";
  const dotCls = paused ? "bg-amber-500" : isOpen ? "bg-success" : "bg-muted-foreground/40";

  // turning ON asks for confirmation; turning OFF resumes immediately
  const handlePauseToggle = (checked: boolean) => {
    if (checked) setConfirmPause(true);
    else setPaused(false);
  };
  const nowT = now ? now.getHours() + now.getMinutes() / 60 : 13;
  const nowLeft = Math.min(100, Math.max(0, pct(nowT)));
  const nowLabel = now ? timeLabel(nowT) : "";

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6 px-1 pb-1">
      {/*
        Operational alerts stay above the redesign. These are the banners that
        tell a tenant their credits are running out, or that Bonzah has made a
        decision on their onboarding — losing them to a visual refresh would be
        a functional regression, not a style change.
      */}
      <LowCreditsBanner />
      <BonzahStatusBanner />
      <BonzahPendingAlert />

      {/* Editorial hero */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">
            {greeting.text}
            {firstName ? `, ${firstName}` : ''}.{' '}
            <span className="align-middle">{greeting.emoji}</span>
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{dateStr}{timeStr && ` · ${timeStr}`}</span>
            {now && (
              <HoverCard openDelay={100} closeDelay={80}>
                <HoverCardTrigger asChild>
                  <span
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${toneCls}`}
                  >
                    <span className={`size-1.5 rounded-full ${dotCls}`} />
                    {statusLabel}
                  </span>
                </HoverCardTrigger>
                <HoverCardContent align="start" className="w-72">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">Booking availability</span>
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${toneCls}`}>
                        <span className={`size-1.5 rounded-full ${dotCls}`} />
                        {paused ? "Paused" : isOpen ? "Open now" : "Closed"}
                      </span>
                    </div>

                    {paused ? (
                      <p className="text-xs text-muted-foreground">
                        Bookings are paused — customers can&apos;t book until you resume.
                      </p>
                    ) : (
                      <div className="space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">{isOpen ? "Closes" : "Opens"}</span>
                          <span className="font-medium">{isOpen ? fmt12(CLOSE_H) : fmt12(OPEN_H)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Today&apos;s hours</span>
                          <span className="font-medium">{fmt12(OPEN_H)} – {fmt12(CLOSE_H)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Timezone</span>
                          <span className="font-medium">{tzName} ({tzAbbr})</span>
                        </div>
                      </div>
                    )}

                    {/* Pause bookings toggle */}
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-xs font-medium">Pause bookings</div>
                        <div className="text-[11px] text-muted-foreground">Temporarily stop new bookings</div>
                      </div>
                      <Switch checked={paused} onCheckedChange={handlePauseToggle} />
                    </div>

                    <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => setAvailOpen(true)}>
                      <Pencil className="size-3.5" /> Edit availability
                    </Button>
                  </div>
                </HoverCardContent>
              </HoverCard>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CreditBalance />
          <Button size="lg" className="gap-2 rounded-full">
            <Plus className="size-4" /> New Rental
          </Button>
        </div>
      </div>

      {/* Today timeline — hidden for now */}
      {false && (
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Today</CardTitle>
          <div className="flex items-center gap-3">
            <LegendDot className="bg-primary" label="Pickup" />
            <LegendDot className="bg-teal-500" label="Return" />
            <LegendDot className="bg-amber-500" label="Payment" />
          </div>
        </CardHeader>

        <CardContent className="overflow-x-auto">
          <div className="relative min-w-[680px]">
            {/* now time label row */}
            <div className="relative h-6">
              {now && (
                <div
                  className="absolute -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground shadow-sm"
                  style={{ left: `${nowLeft}%` }}
                >
                  Now
                </div>
              )}
            </div>

            {/* timeline body */}
            <div className="relative">
              {/* hour labels */}
              <div className="relative h-5">
                {ticks.map((h) => (
                  <div key={h} className="absolute -translate-x-1/2 text-[11px] text-muted-foreground/70" style={{ left: `${pct(h)}%` }}>
                    {hourLabel(h)}
                  </div>
                ))}
              </div>

              {/* gridlines + now line span the lanes below the labels */}
              <div className="pointer-events-none absolute inset-x-0 top-5 bottom-0">
                {ticks.map((h) => (
                  <div key={h} className="absolute top-0 bottom-0 w-px bg-border/40" style={{ left: `${pct(h)}%` }} />
                ))}
                {now && (
                  <div className="absolute top-0 bottom-0 z-10 -translate-x-1/2" style={{ left: `${nowLeft}%` }}>
                    <div className="size-2.5 -translate-x-[3px] rounded-full bg-primary ring-4 ring-primary/15" />
                    <div className="absolute top-1 bottom-0 left-1/2 w-px -translate-x-1/2 bg-primary" />
                  </div>
                )}
              </div>

            {/* Lane: Operations */}
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Pickups & returns</div>
              <div className="relative h-14">
                {ops.map((o, i) => {
                  const pickup = o.kind === "pickup";
                  const color = o.overdue
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : pickup
                    ? "border-primary/20 bg-primary/10 text-primary"
                    : "border-teal-500/20 bg-teal-500/10 text-teal-600 dark:text-teal-400";
                  return (
                    <div key={i} className="absolute top-1 -translate-x-1/2" style={{ left: `${pct(o.t)}%` }}>
                      <div className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium ${color}`}>
                        {pickup ? <Car className="size-3" /> : <KeyRound className="size-3" />}
                        {timeLabel(o.t)} · {o.vehicle}
                      </div>
                      <div className="mt-0.5 text-center text-[10px] text-muted-foreground">
                        {o.overdue ? "⚠ overdue · " : ""}{o.who}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Lane: Payments */}
            <div className="mt-2">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Payments coming in</div>
              <div className="relative h-12">
                {pays.map((p, i) => (
                  <div key={i} className="absolute top-1 -translate-x-1/2" style={{ left: `${pct(p.t)}%` }}>
                    <div
                      className={`flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                        p.auto
                          ? "border-border bg-muted text-muted-foreground"
                          : "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      }`}
                    >
                      {p.auto ? <Check className="size-3 text-success" /> : <DollarSign className="size-3" />}
                      {fmt(p.amount)}
                    </div>
                    <div className="mt-0.5 text-center text-[10px] text-muted-foreground">{p.who}</div>
                  </div>
                ))}
              </div>
            </div>
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {/* Analytics graphs */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="text-base">Revenue</CardTitle>
            <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">$8,310</span> this week
              <span className="inline-flex items-center gap-0.5 text-success">
                <TrendingUp className="size-3.5" /> 12%
              </span>
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-full border bg-card p-0.5 text-xs">
            <button className="rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground">7d</button>
            <button className="rounded-full px-3 py-1 text-muted-foreground hover:text-foreground">30d</button>
            <button className="rounded-full px-3 py-1 text-muted-foreground hover:text-foreground">90d</button>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Revenue — this week vs last week, gradient areas */}
          <ChartContainer config={revenueConfig} className="h-[260px] w-full">
            <AreaChart data={revenueData} margin={{ left: 4, right: 12, top: 8 }}>
              <defs>
                <linearGradient id="fillThisWeek" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-thisWeek)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--color-thisWeek)" stopOpacity={0.04} />
                </linearGradient>
                <linearGradient id="fillLastWeek" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-lastWeek)" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="var(--color-lastWeek)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
              <Area dataKey="lastWeek" type="natural" stroke="var(--color-lastWeek)" strokeWidth={2} strokeDasharray="4 4" fill="url(#fillLastWeek)" stackId="a" />
              <Area dataKey="thisWeek" type="natural" stroke="var(--color-thisWeek)" strokeWidth={2.5} fill="url(#fillThisWeek)" stackId="b" />
              <ChartLegend content={<ChartLegendContent />} />
            </AreaChart>
          </ChartContainer>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Bookings — gradient rounded bars */}
            <div>
              <div className="mb-3 text-sm font-medium">Bookings this week</div>
              <ChartContainer config={bookingsConfig} className="h-[220px] w-full">
                <BarChart data={bookingsData} margin={{ top: 8 }}>
                  <defs>
                    <linearGradient id="fillBookings" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-bookings)" stopOpacity={1} />
                      <stop offset="100%" stopColor="var(--color-bookings)" stopOpacity={0.45} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} />
                  <ChartTooltip cursor={{ fillOpacity: 0.1 }} content={<ChartTooltipContent />} />
                  <Bar dataKey="bookings" fill="url(#fillBookings)" radius={[8, 8, 0, 0]} barSize={26} />
                </BarChart>
              </ChartContainer>
            </div>

            {/* Revenue by plan — donut with center total */}
            <div>
              <div className="mb-3 text-sm font-medium">Revenue by plan</div>
              <div className="flex items-center gap-2">
                <ChartContainer config={splitConfig} className="mx-auto aspect-square h-[200px]">
                  <PieChart>
                    <ChartTooltip cursor={false} content={<ChartTooltipContent nameKey="label" hideLabel />} />
                    <Pie data={splitData} dataKey="value" nameKey="label" innerRadius={58} outerRadius={84} strokeWidth={4} paddingAngle={3}>
                      {splitData.map((entry) => (
                        <Cell key={entry.plan} fill={entry.fill} className="stroke-card" />
                      ))}
                      <Label
                        content={({ viewBox }) => {
                          if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                            return (
                              <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                                <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-xl font-semibold">
                                  {fmt(splitTotal)}
                                </tspan>
                                <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 20} className="fill-muted-foreground text-xs">
                                  total
                                </tspan>
                              </text>
                            );
                          }
                          return null;
                        }}
                      />
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <div className="space-y-2 pr-2">
                  {splitData.map((entry) => (
                    <div key={entry.plan} className="flex items-center gap-2 text-sm">
                      <span className="size-2.5 rounded-full" style={{ background: entry.fill }} />
                      <span className="text-muted-foreground">{entry.label}</span>
                      <span className="ml-auto font-medium tabular-nums">{fmt(entry.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Fleet utilisation — radial gauge */}
            <div>
              <div className="mb-3 text-sm font-medium">Fleet utilisation</div>
              <div className="flex items-center gap-4">
                <div className="relative mx-auto h-[200px] w-[200px] shrink-0">
                  <ChartContainer config={utilisationConfig} className="h-full w-full">
                    <RadialBarChart data={utilisationData} innerRadius={72} outerRadius={102} startAngle={90} endAngle={-270}>
                      <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
                      <RadialBar dataKey="value" background={{ fill: "hsl(var(--muted))" }} cornerRadius={14} />
                    </RadialBarChart>
                  </ChartContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-semibold">{utilisation}%</span>
                    <span className="text-xs text-muted-foreground">on the road</span>
                  </div>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="font-medium">18 of 25 vehicles</div>
                  <div className="text-muted-foreground">7 available now</div>
                </div>
              </div>
            </div>

            {/* Top vehicles — horizontal bars */}
            <div>
              <div className="mb-3 text-sm font-medium">Top vehicles by revenue</div>
              <ChartContainer config={topVehiclesConfig} className="h-[220px] w-full">
                <BarChart data={topVehicles} layout="vertical" margin={{ left: 0, right: 40, top: 4 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                  <YAxis dataKey="vehicle" type="category" tickLine={false} axisLine={false} width={104} fontSize={12} />
                  <XAxis type="number" hide />
                  <ChartTooltip cursor={{ fillOpacity: 0.1 }} content={<ChartTooltipContent />} />
                  <Bar dataKey="revenue" fill="var(--color-revenue)" radius={6} barSize={18}>
                    <LabelList dataKey="revenue" position="right" offset={8} className="fill-muted-foreground" fontSize={11} formatter={(v: number) => fmt(v)} />
                  </Bar>
                </BarChart>
              </ChartContainer>
            </div>

            {/* Pickups vs returns — stacked bars */}
            <div>
              <div className="mb-3 text-sm font-medium">Pickups vs returns</div>
              <ChartContainer config={opsConfig} className="h-[220px] w-full">
                <BarChart data={opsByDay} margin={{ top: 8 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="pickups" stackId="a" fill="var(--color-pickups)" radius={[0, 0, 4, 4]} barSize={26} />
                  <Bar dataKey="returns" stackId="a" fill="var(--color-returns)" radius={[4, 4, 0, 0]} barSize={26} />
                </BarChart>
              </ChartContainer>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Confirm before pausing bookings */}
      <AlertDialog open={confirmPause} onOpenChange={setConfirmPause}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause all bookings?</AlertDialogTitle>
            <AlertDialogDescription>
              Customers will not be able to make any kind of booking on your booking site until you
              resume. Are you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => setPaused(true)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Yes, pause bookings
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit availability — big dialog (mock of the availability page) */}
      <Dialog open={availOpen} onOpenChange={setAvailOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit availability</DialogTitle>
            <DialogDescription>Set the hours customers can book on your booking site.</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-1">
            {/* Pause + timezone */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 p-4">
              <div>
                <div className="text-sm font-medium">Pause bookings</div>
                <div className="text-xs text-muted-foreground">Temporarily stop all new bookings, regardless of hours</div>
              </div>
              <Switch checked={paused} onCheckedChange={handlePauseToggle} />
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Timezone</span>
              <span className="font-medium">{tzName} ({tzAbbr})</span>
            </div>

            {/* Weekly hours */}
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Weekly hours</div>
              <div className="divide-y rounded-xl border">
                {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => {
                  const closedDay = day === "Sunday";
                  return (
                    <div key={day} className="flex items-center gap-3 px-4 py-2.5">
                      <Switch defaultChecked={!closedDay} />
                      <span className="w-24 text-sm font-medium">{day}</span>
                      {closedDay ? (
                        <span className="text-sm text-muted-foreground">Closed</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Input type="time" defaultValue="09:00" className="h-8 w-36" />
                          <span className="text-muted-foreground">–</span>
                          <Input type="time" defaultValue="18:00" className="h-8 w-36" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAvailOpen(false)}>Cancel</Button>
            <Button onClick={() => setAvailOpen(false)}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
