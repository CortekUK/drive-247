"use client";

import { useMemo, useState } from "react";
import { Search, Link2, Check, Mail, Phone, UserRound, ShieldCheck, CalendarDays, CarFront } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export interface CustomerLite {
  id: string;
  name: string;
  email?: string;
  phone?: string;
}

// MOCK fallback customers so the step always renders something to preview.
const MOCK_CUSTOMERS: CustomerLite[] = [
  { id: "c1", name: "Marcus Bennett", email: "marcus.bennett@gmail.com", phone: "+1 (303) 555-0142" },
  { id: "c2", name: "Aisha Thompson", email: "aisha.t@outlook.com", phone: "+1 (904) 555-0198" },
  { id: "c3", name: "Diego Ramirez", email: "diego.ramirez@yahoo.com", phone: "+1 (312) 555-0177" },
  { id: "c4", name: "Sofia Nguyen", email: "sofia.nguyen@gmail.com", phone: "+1 (504) 555-0163" },
  { id: "c5", name: "James O'Connor", email: "james.oconnor@gmail.com", phone: "+1 (201) 555-0119" },
  { id: "c6", name: "Priya Patel", email: "priya.patel@gmail.com", phone: "+1 (203) 555-0150" },
];

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

interface CustomerListProps {
  selected: string | null;
  onSelect: (customerId: string) => void;
  onInvite?: () => void;
  customers?: CustomerLite[];
}

export function CustomerList({ selected, onSelect, onInvite, customers }: CustomerListProps) {
  const data = customers && customers.length > 0 ? customers : MOCK_CUSTOMERS;
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.phone?.toLowerCase().includes(q)
    );
  }, [data, search]);

  const current = data.find((c) => c.id === selected) || null;

  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[3fr_7fr] gap-4">
      {/* ── Left (30%): search + list ─────────────────────────── */}
      <div className="min-h-0 rounded-2xl border bg-card flex flex-col overflow-hidden">
        <div className="shrink-0 p-3 border-b space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customers"
              className="w-full rounded-xl border bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
            />
          </div>
          <button
            type="button"
            onClick={onInvite}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/20 transition-colors"
          >
            <Link2 className="h-4 w-4" />
            Invite new customer
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
              No customers match “{search}”.
            </div>
          ) : (
            filtered.map((c) => {
              const isActive = selected === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors",
                    isActive ? "bg-primary/10" : "hover:bg-muted"
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                      isActive ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/70"
                    )}
                  >
                    {initials(c.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                    {c.email && <p className="text-xs text-muted-foreground truncate">{c.email}</p>}
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

      {/* ── Right (70%): selected customer info ────────────────── */}
      <div className="min-h-0 rounded-2xl border bg-card overflow-y-auto">
        {!current ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <UserRound className="h-7 w-7" />
            </span>
            <p className="text-sm text-muted-foreground">
              Select a customer to see their details
            </p>
          </div>
        ) : (
          <CustomerInfo customer={current} />
        )}
      </div>
    </div>
  );
}

function CustomerInfo({ customer }: { customer: CustomerLite }) {
  // MOCK enrichment — these would come from the customer record in the real flow.
  const stats = [
    { icon: ShieldCheck, label: "Verification", value: "Verified", accent: "text-emerald-600" },
    { icon: CalendarDays, label: "Member since", value: "Jan 2025" },
    { icon: CarFront, label: "Total rentals", value: "3" },
  ];

  return (
    <div className="p-6">
      {/* Identity */}
      <div className="flex items-center gap-4">
        <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-lg font-semibold text-white">
          {initials(customer.name)}
        </span>
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-foreground truncate">{customer.name}</h2>
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
            <ShieldCheck className="h-3 w-3" />
            Verified customer
          </span>
        </div>
      </div>

      {/* Contact */}
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl border p-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Email</p>
          <p className="mt-1 flex items-center gap-2 text-sm text-foreground">
            <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="truncate">{customer.email || "—"}</span>
          </p>
        </div>
        <div className="rounded-xl border p-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Phone</p>
          <p className="mt-1 flex items-center gap-2 text-sm text-foreground">
            <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="truncate">{customer.phone || "—"}</span>
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="rounded-xl border p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <p className={cn("mt-1 flex items-center gap-2 text-sm font-medium", s.accent ?? "text-foreground")}>
                <Icon className="h-4 w-4 shrink-0" />
                {s.value}
              </p>
            </div>
          );
        })}
      </div>

      {/* Recent activity (mock) */}
      <div className="mt-6">
        <p className="text-sm font-semibold text-foreground">Recent rentals</p>
        <div className="mt-2 rounded-xl border divide-y">
          {[
            { car: "Tesla Model 3", period: "Mar 2 – Mar 9, 2025", status: "Completed" },
            { car: "Toyota Camry", period: "Jan 14 – Jan 21, 2025", status: "Completed" },
          ].map((r, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{r.car}</p>
                <p className="text-xs text-muted-foreground">{r.period}</p>
              </div>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {r.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
