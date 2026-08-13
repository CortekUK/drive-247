"use client";

import { type ReactNode } from "react";
import { format } from "date-fns";
import { CalendarIcon, X, RotateCcw, Activity, ShieldCheck, Inbox } from "lucide-react";
import { RentalFilters } from "@/hooks/use-enhanced-rentals";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

// logo.dev — publishable key (safe for client-side img.logo.dev)
const LOGO_TOKEN = "pk_EmodMTbiSPiHDa2fIPUo3w";
const logoSrc = (domain: string) => `https://img.logo.dev/${domain}?token=${LOGO_TOKEN}&size=64&format=png`;

interface Props {
  filters: RentalFilters;
  onChange: (next: RentalFilters) => void;
  onClear: () => void;
  onClose: () => void;
}

const STATUS_OPTIONS = [
  { value: "all", label: "All", color: null },
  { value: "active", label: "Active", color: "#16a34a" },
  { value: "upcoming", label: "Upcoming", color: "#2563eb" },
  { value: "pending", label: "Pending", color: "#d97706" },
  { value: "completed", label: "Completed", color: "#64748b" },
  { value: "cancelled", label: "Cancelled", color: "#dc2626" },
];

const PAYMENT_OPTIONS = [
  { value: "all", label: "All" },
  { value: "regular", label: "Regular" },
  { value: "payg", label: "Pay-as-you-go" },
];

const INSURANCE_OPTIONS = [
  { value: "all", label: "Any" },
  { value: "active", label: "Insured" },
  { value: "quoted", label: "Quoted" },
  { value: "insufficient_balance", label: "Insufficient balance" },
];

const normalizeDate = (date: Date | undefined) =>
  date ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0) : undefined;

function Chip({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color?: string | null;
  onClick: () => void;
  children: ReactNode;
}) {
  const style =
    active && color ? { backgroundColor: `${color}1a`, color, borderColor: `${color}55` } : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      className={cn(
        "cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? color
            ? ""
            : "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function Section({
  icon,
  tint,
  title,
  badge,
  className,
  children,
}: {
  icon: ReactNode;
  tint: string;
  title: string;
  badge?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-1.5">
        <span className={cn("flex size-5 items-center justify-center rounded", tint)}>{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        {badge}
      </div>
      <div>{children}</div>
    </div>
  );
}

function BrandBadge({ domain, localSrc, name }: { domain?: string; localSrc?: string; name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5">
      {localSrc ? (
        <img src={localSrc} alt={name} className="h-3 w-auto" />
      ) : (
        <img src={logoSrc(domain!)} alt={name} className="size-3.5 object-contain" />
      )}
      <span className="text-[10px] font-medium text-muted-foreground">{name}</span>
    </span>
  );
}

export function RentalsFilterPanel({ filters, onChange, onClear, onClose }: Props) {
  const set = (key: keyof RentalFilters, value: any) =>
    onChange({ ...filters, [key]: value, page: 1 });

  const toggle = (key: keyof RentalFilters) =>
    onChange({ ...filters, [key]: filters[key] ? undefined : true, page: 1 });

  const statusValue = filters.status || "all";
  const paymentValue = filters.paymentType || "all";
  const insuranceValue = filters.bonzahStatus || "all";

  const dateBtn = (
    value: Date | undefined,
    placeholder: string,
    onSelect: (d: Date | undefined) => void
  ) => (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("h-8 w-full justify-start text-xs font-normal", !value && "text-muted-foreground")}
        >
          <CalendarIcon className="mr-1.5 size-3.5 shrink-0 text-blue-600" />
          {value ? format(value, "MMM d, yyyy") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={value} onSelect={(d) => onSelect(normalizeDate(d))} />
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
      {/* Compact action bar */}
      <div className="flex shrink-0 items-center justify-end gap-1.5 px-3 pt-2">
        <Button variant="ghost" size="sm" onClick={onClear} className="h-7 px-2 text-xs text-muted-foreground">
          <RotateCcw className="mr-1 size-3" />
          Reset
        </Button>
        <Button variant="outline" size="icon" onClick={onClose} aria-label="Close filters" className="size-7 rounded-md">
          <X className="size-3.5" />
        </Button>
      </div>

      {/* Sections — laid out in columns to fill the wide/short box without scrolling */}
      <div className="grid flex-1 content-center gap-x-8 gap-y-3 px-5 pb-4 pt-1 sm:grid-cols-2 lg:grid-cols-4">
        {/* Status */}
        <Section
          icon={<Activity className="size-3.5 text-primary" />}
          tint="bg-primary/10"
          title="Status"
          className="lg:col-span-2"
        >
          <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                active={statusValue === o.value}
                color={o.color}
                onClick={() => set("status", o.value === "all" ? undefined : o.value)}
              >
                {o.label}
              </Chip>
            ))}
          </div>
        </Section>

        {/* Payment */}
        <Section
          icon={<img src={logoSrc("stripe.com")} alt="Stripe" className="size-3.5 object-contain" />}
          tint="bg-[#635bff]/10"
          title="Payment"
          badge={<BrandBadge domain="stripe.com" name="Stripe" />}
        >
          <div className="flex flex-wrap gap-2">
            {PAYMENT_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                active={paymentValue === o.value}
                onClick={() => set("paymentType", o.value === "all" ? undefined : o.value)}
              >
                {o.label}
              </Chip>
            ))}
          </div>
        </Section>

        {/* Insurance */}
        <Section
          icon={<ShieldCheck className="size-3.5 text-emerald-600" />}
          tint="bg-emerald-500/10"
          title="Insurance"
          badge={<BrandBadge localSrc="/bonzah-logo.svg" name="Bonzah" />}
        >
          <div className="flex flex-wrap gap-2">
            {INSURANCE_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                active={insuranceValue === o.value}
                onClick={() => set("bonzahStatus", o.value === "all" ? undefined : o.value)}
              >
                {o.label}
              </Chip>
            ))}
          </div>
        </Section>

        {/* Dates */}
        <Section
          icon={<CalendarIcon className="size-3.5 text-blue-600" />}
          tint="bg-blue-500/10"
          title="Start date range"
          className="lg:col-span-2"
        >
          <div className="grid grid-cols-2 gap-3">
            {dateBtn(filters.startDateFrom, "From", (d) => set("startDateFrom", d))}
            {dateBtn(filters.startDateTo, "To", (d) => set("startDateTo", d))}
          </div>
        </Section>

        {/* Requests */}
        <Section
          icon={<Inbox className="size-3.5 text-amber-600" />}
          tint="bg-amber-500/10"
          title="Requests"
          className="lg:col-span-2"
        >
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => toggle("extensionRequested")}
              className={cn(
                "cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                filters.extensionRequested
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-700"
                  : "border-border bg-background text-muted-foreground hover:border-amber-500/30 hover:text-foreground"
              )}
            >
              Extension requested
            </button>
            <button
              type="button"
              onClick={() => toggle("cancellationRequested")}
              className={cn(
                "cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                filters.cancellationRequested
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-700"
                  : "border-border bg-background text-muted-foreground hover:border-amber-500/30 hover:text-foreground"
              )}
            >
              Cancellation requested
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}
