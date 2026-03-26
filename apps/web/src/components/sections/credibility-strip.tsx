const METRICS = [
  { value: "50+", label: "Operators onboarded" },
  { value: "$2M+", label: "Bookings processed" },
  { value: "98%", label: "Uptime SLA" },
  { value: "4.9/5", label: "Operator satisfaction" },
  { value: "0%", label: "Booking commissions" },
  { value: "~7 days", label: "Average go-live" },
  { value: "24/7", label: "Platform monitoring" },
  { value: "3-in-1", label: "Integrated platform" },
];

function MetricItem({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex shrink-0 items-center gap-6 px-8">
      <div className="h-1 w-1 rounded-full bg-indigo-600/30 dark:bg-indigo-400/30" />
      <div className="flex items-center gap-2.5">
        <span className="text-lg font-extrabold tracking-tight text-indigo-600 dark:text-indigo-400 sm:text-xl">
          {value}
        </span>
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
      </div>
    </div>
  );
}

// Repeat enough times to guarantee seamless coverage on wide screens
const REPEATED = [...METRICS, ...METRICS, ...METRICS, ...METRICS];

export function CredibilityStrip() {
  return (
    <div className="relative overflow-hidden border-y py-4">
      {/* Fade edges */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-background to-transparent" />

      <div className="flex animate-marquee" style={{ width: "max-content" }}>
        {REPEATED.map((m, i) => (
          <MetricItem key={`${m.label}-${i}`} value={m.value} label={m.label} />
        ))}
      </div>
    </div>
  );
}
