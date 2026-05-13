const METRICS = [
  { value: "0%", label: "Booking commissions — ever" },
  { value: "7 days", label: "From kickoff to live bookings" },
  { value: "$2M+", label: "In direct bookings processed" },
  { value: "100%", label: "You own your customer data" },
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
