"use client";

import { useMemo, useState } from "react";
import { Search, Check, CarFront, Gauge, Banknote, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export interface VehicleLite {
  id: string;
  make?: string;
  model?: string;
  reg?: string;
  status?: string;
  daily_rent?: number | null;
  weekly_rent?: number | null;
  monthly_rent?: number | null;
  security_deposit?: number | null;
  daily_mileage?: number | null;
}

const money = (v: number | null | undefined, currency: string) =>
  v == null ? "—" : `${currency}${Number(v).toLocaleString()}`;

interface VehicleListProps {
  selected: string | null;
  onSelect: (vehicleId: string) => void;
  vehicles?: VehicleLite[];
  currency?: string;
}

export function VehicleList({ selected, onSelect, vehicles, currency = "$" }: VehicleListProps) {
  // No mock fallback — see the note in customer-step.tsx. A fleet with no
  // vehicles shows an empty state rather than five invented cars.
  const data = vehicles ?? [];
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter((v) =>
      `${v.make ?? ""} ${v.model ?? ""} ${v.reg ?? ""}`.toLowerCase().includes(q)
    );
  }, [data, search]);

  const current = data.find((v) => v.id === selected) || null;

  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[3fr_7fr] gap-4">
      {/* ── Left (30%): search + list ─────────────────────────── */}
      <div className="min-h-0 rounded-2xl border bg-card flex flex-col overflow-hidden">
        <div className="shrink-0 p-3 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search vehicles"
              className="w-full rounded-xl border bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
              {search.trim()
                ? `No vehicles match “${search}”.`
                : "No vehicles in the fleet yet. Add one first."}
            </div>
          ) : (
            filtered.map((v) => {
              const isActive = selected === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onSelect(v.id)}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors",
                    isActive ? "bg-primary/10" : "hover:bg-muted"
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      isActive ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/60"
                    )}
                  >
                    <CarFront className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">
                      {v.make} {v.model}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{v.reg}</p>
                  </div>
                  {isActive && (
                    <motion.span
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.18 }}
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
                    >
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </motion.span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right (70%): selected vehicle info ─────────────────── */}
      <div className="min-h-0 rounded-2xl border bg-card overflow-y-auto">
        {!current ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <CarFront className="h-7 w-7" />
            </span>
            <p className="text-sm text-muted-foreground">Select a vehicle to see its details</p>
          </div>
        ) : (
          <VehicleInfo vehicle={current} currency={currency} />
        )}
      </div>
    </div>
  );
}

function VehicleInfo({ vehicle, currency }: { vehicle: VehicleLite; currency: string }) {
  const available = (vehicle.status ?? "Available").toLowerCase() === "available";

  const rates = [
    { label: "Daily", value: vehicle.daily_rent },
    { label: "Weekly", value: vehicle.weekly_rent },
    { label: "Monthly", value: vehicle.monthly_rent },
  ];

  return (
    <div className="p-6">
      {/* Image placeholder */}
      <div className="relative h-40 rounded-xl bg-gradient-to-br from-primary/10 to-muted flex items-center justify-center">
        <CarFront className="h-16 w-16 text-primary/40" />
        {vehicle.reg && (
          <span className="absolute left-3 top-3 rounded-md bg-white/90 px-2 py-1 text-xs font-semibold text-foreground shadow-sm">
            {vehicle.reg}
          </span>
        )}
        <span
          className={cn(
            "absolute right-3 top-3 rounded-full px-2 py-0.5 text-[11px] font-medium",
            available ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
          )}
        >
          {vehicle.status ?? "Available"}
        </span>
      </div>

      {/* Title */}
      <div className="mt-4">
        <h2 className="text-xl font-semibold text-foreground">
          {vehicle.make} {vehicle.model}
        </h2>
        <p className="text-sm text-muted-foreground">Registration {vehicle.reg ?? "—"}</p>
      </div>

      {/* Rates */}
      <div className="mt-5 grid grid-cols-3 gap-3">
        {rates.map((r) => (
          <div key={r.label} className="rounded-xl border p-3 text-center">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{r.label}</p>
            <p className="mt-1 text-base font-semibold text-foreground">{money(r.value, currency)}</p>
          </div>
        ))}
      </div>

      {/* Details */}
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border p-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Deposit</p>
          <p className="mt-1 flex items-center gap-2 text-sm font-medium text-foreground">
            <Banknote className="h-4 w-4 text-muted-foreground shrink-0" />
            {money(vehicle.security_deposit, currency)}
          </p>
        </div>
        <div className="rounded-xl border p-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Daily mileage</p>
          <p className="mt-1 flex items-center gap-2 text-sm font-medium text-foreground">
            <Gauge className="h-4 w-4 text-muted-foreground shrink-0" />
            {vehicle.daily_mileage != null ? `${vehicle.daily_mileage} mi` : "—"}
          </p>
        </div>
        <div className="rounded-xl border p-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Insurance</p>
          <p className="mt-1 flex items-center gap-2 text-sm font-medium text-emerald-600">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            Eligible
          </p>
        </div>
      </div>
    </div>
  );
}
