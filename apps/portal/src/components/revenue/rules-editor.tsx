/**
 * RulesEditor — Phase 3 /revenue/rules surface.
 *
 * Lists per-vehicle and per-category rules with autopilot status. Each row
 * exposes Edit / Delete / Toggle autopilot. The add-rule dialog allows
 * choosing scope (vehicle or category) and the min/max bounds per tier.
 *
 * Autopilot constraint (Spec §13.7): a rule cannot enable autopilot unless
 * at least one tier has BOTH min and max set. We enforce client-side here
 * and server-side via no SQL constraint (intentionally — operators can save
 * partial rules first, then enable autopilot once they fill in the bounds).
 */
"use client";

import { useMemo, useState } from "react";
import { Pencil, Trash2, Plus, Pause, Play, Car, Layers, AlertTriangle } from "lucide-react";
import {
  useRevenueOptimiserRules,
  useCreateRule,
  useUpdateRule,
  useDeleteRule,
  useVehicleCategories,
  useVehicleList,
  type RevenueOptimiserRule,
  type RuleInsert,
} from "@/hooks/use-revenue-optimiser-rules";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";

const fmtMoney = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export function RulesEditor() {
  const rulesQuery = useRevenueOptimiserRules();
  const vehicles = useVehicleList();
  const categories = useVehicleCategories();
  const updateRule = useUpdateRule();
  const deleteRule = useDeleteRule();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RevenueOptimiserRule | null>(null);

  const vehicleById = useMemo(() => {
    const m = new Map<string, { reg: string | null; make: string | null; model: string | null }>();
    for (const v of vehicles.data ?? []) m.set(v.id, { reg: v.reg, make: v.make, model: v.model });
    return m;
  }, [vehicles.data]);

  if (rulesQuery.isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
      </div>
    );
  }

  const rules = rulesQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button
          onClick={() => { setEditing(null); setDialogOpen(true); }}
          className="bg-[#0f172a] text-white hover:bg-[#0f172a]/90"
          size="sm"
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> New rule
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#f1f5f9] bg-white p-10 text-center">
          <Layers className="mx-auto h-7 w-7 text-[#737373]" />
          <h3 className="mt-3 text-sm font-medium text-[#080812]">No rules yet</h3>
          <p className="mx-auto mt-1 max-w-md text-xs text-[#737373]">
            Rules bound recommendations to per-vehicle or per-category min/max prices.
            Add a rule, then enable autopilot per row to let Revenue Optimiser
            apply recommendations automatically within those bounds.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rules.map((r) => {
            const v = r.vehicle_id ? vehicleById.get(r.vehicle_id) : null;
            const title = r.vehicle_id
              ? (v ? `${v.make ?? ""} ${v.model ?? ""}${v.reg ? ` · ${v.reg}` : ""}` : "Vehicle removed")
              : `Category · ${r.category}`;
            const Icon = r.vehicle_id ? Car : Layers;
            const paused = r.paused_until && new Date(r.paused_until).getTime() > Date.now();
            return (
              <li key={r.id} className="rounded-lg border border-[#f1f5f9] bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className={`flex h-7 w-7 items-center justify-center rounded-md ${r.autopilot_enabled ? "bg-emerald-50 text-emerald-700" : "bg-[#f8fafc] text-[#737373]"}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-[#080812]">{title}</div>
                        <div className="flex items-center gap-2 text-[11px] text-[#737373]">
                          {r.autopilot_enabled ? (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                              Autopilot on
                            </span>
                          ) : (
                            <span className="rounded-full border border-[#f1f5f9] bg-[#f8fafc] px-2 py-0.5">
                              Autopilot off
                            </span>
                          )}
                          {paused && (
                            <span className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">
                              <Pause className="h-2.5 w-2.5" /> Paused until {new Date(r.paused_until!).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                      <BoundPill label="Daily" min={r.min_price_daily} max={r.max_price_daily} />
                      <BoundPill label="Weekly" min={r.min_price_weekly} max={r.max_price_weekly} />
                      <BoundPill label="Monthly" min={r.min_price_monthly} max={r.max_price_monthly} />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {paused && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateRule.mutate({ id: r.id, patch: { paused_until: null } })}
                        className="text-xs"
                      >
                        <Play className="mr-1 h-3 w-3" /> Resume
                      </Button>
                    )}
                    <Switch
                      checked={r.autopilot_enabled}
                      onCheckedChange={(v) => {
                        if (v && !hasMinMaxForAnyTier(r)) {
                          alert("Set at least one tier's min and max before enabling autopilot");
                          return;
                        }
                        updateRule.mutate({ id: r.id, patch: { autopilot_enabled: v } });
                      }}
                      aria-label="Toggle autopilot"
                    />
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setDialogOpen(true); }} aria-label="Edit rule">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600 hover:bg-red-50"
                      onClick={() => { if (confirm("Delete this rule?")) deleteRule.mutate(r.id); }}
                      aria-label="Delete rule"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <RuleDialog
        open={dialogOpen}
        rule={editing}
        vehicles={vehicles.data ?? []}
        categories={categories.data ?? []}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
      />
    </div>
  );
}

function BoundPill({ label, min, max }: { label: string; min: number | null; max: number | null }) {
  const empty = min == null && max == null;
  return (
    <div className={`rounded-md border px-2 py-1.5 ${empty ? "border-dashed border-[#f1f5f9] bg-[#fafafa] text-[#737373]" : "border-[#f1f5f9] bg-[#f8fafc] text-[#404040]"}`}>
      <div className="text-[9px] uppercase tracking-wide text-[#737373]">{label}</div>
      <div className="mt-0.5 tabular-nums">{fmtMoney(min)} – {fmtMoney(max)}</div>
    </div>
  );
}

function hasMinMaxForAnyTier(r: RevenueOptimiserRule): boolean {
  return (
    (r.min_price_daily != null && r.max_price_daily != null) ||
    (r.min_price_weekly != null && r.max_price_weekly != null) ||
    (r.min_price_monthly != null && r.max_price_monthly != null)
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Rule dialog
// ────────────────────────────────────────────────────────────────────────────

interface RuleDialogProps {
  open: boolean;
  rule: RevenueOptimiserRule | null;
  vehicles: Array<{ id: string; reg: string | null; make: string | null; model: string | null; category: string | null }>;
  categories: string[];
  onClose: () => void;
}

function RuleDialog({ open, rule, vehicles, categories, onClose }: RuleDialogProps) {
  const create = useCreateRule();
  const update = useUpdateRule();
  const isEdit = !!rule;

  const [scope, setScope] = useState<"vehicle" | "category">(rule?.vehicle_id ? "vehicle" : "category");
  const [vehicleId, setVehicleId] = useState<string>(rule?.vehicle_id ?? "");
  const [category, setCategory] = useState<string>(rule?.category ?? categories[0] ?? "");
  const [autopilot, setAutopilot] = useState<boolean>(rule?.autopilot_enabled ?? false);

  const [bounds, setBounds] = useState({
    min_price_daily: numOrNull(rule?.min_price_daily),
    max_price_daily: numOrNull(rule?.max_price_daily),
    min_price_weekly: numOrNull(rule?.min_price_weekly),
    max_price_weekly: numOrNull(rule?.max_price_weekly),
    min_price_monthly: numOrNull(rule?.min_price_monthly),
    max_price_monthly: numOrNull(rule?.max_price_monthly),
  });

  // Reset state on open
  useMemo(() => {
    if (open) {
      setScope(rule?.vehicle_id ? "vehicle" : "category");
      setVehicleId(rule?.vehicle_id ?? "");
      setCategory(rule?.category ?? categories[0] ?? "");
      setAutopilot(rule?.autopilot_enabled ?? false);
      setBounds({
        min_price_daily: numOrNull(rule?.min_price_daily),
        max_price_daily: numOrNull(rule?.max_price_daily),
        min_price_weekly: numOrNull(rule?.min_price_weekly),
        max_price_weekly: numOrNull(rule?.max_price_weekly),
        min_price_monthly: numOrNull(rule?.min_price_monthly),
        max_price_monthly: numOrNull(rule?.max_price_monthly),
      });
    }
  }, [open, rule, categories]);

  const validationError =
    scope === "vehicle" ? (!vehicleId ? "Pick a vehicle" : null)
    : (!category ? "Pick or type a category" : null);

  const minMaxError = ["daily", "weekly", "monthly"].reduce<string | null>((acc, tier) => {
    if (acc) return acc;
    const minK = `min_price_${tier}` as keyof typeof bounds;
    const maxK = `max_price_${tier}` as keyof typeof bounds;
    const min = bounds[minK];
    const max = bounds[maxK];
    if (min != null && max != null && min > max) return `${tier} min must be ≤ max`;
    return null;
  }, null);

  const onSubmit = () => {
    if (validationError || minMaxError) return;
    const payload: RuleInsert =
      scope === "vehicle"
        ? ({ vehicle_id: vehicleId, autopilot_enabled: autopilot, ...bounds })
        : ({ category, autopilot_enabled: autopilot, ...bounds });

    if (isEdit && rule) {
      update.mutate(
        { id: rule.id, patch: { autopilot_enabled: autopilot, ...bounds } },
        { onSuccess: onClose },
      );
    } else {
      create.mutate(payload, { onSuccess: onClose });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit rule" : "New rule"}</DialogTitle>
          <DialogDescription>
            Bounds clamp every recommendation. With autopilot on, recs falling
            inside bounds are applied automatically (within tenant safety rails).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!isEdit && (
            <div>
              <Label className="text-xs font-medium text-[#404040]">Scope</Label>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setScope("vehicle")}
                  className={`rounded-md border px-3 py-2 text-left text-sm transition-colors
                    ${scope === "vehicle" ? "border-indigo-300 bg-indigo-50 text-indigo-900" : "border-[#f1f5f9] bg-white text-[#404040] hover:border-indigo-200"}`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-medium"><Car className="h-3 w-3" /> Single vehicle</div>
                  <div className="mt-0.5 text-[10px] text-[#737373]">Bind to one specific vehicle.</div>
                </button>
                <button
                  type="button"
                  onClick={() => setScope("category")}
                  className={`rounded-md border px-3 py-2 text-left text-sm transition-colors
                    ${scope === "category" ? "border-indigo-300 bg-indigo-50 text-indigo-900" : "border-[#f1f5f9] bg-white text-[#404040] hover:border-indigo-200"}`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-medium"><Layers className="h-3 w-3" /> Category</div>
                  <div className="mt-0.5 text-[10px] text-[#737373]">Applies to all vehicles in that category.</div>
                </button>
              </div>
            </div>
          )}

          {scope === "vehicle" ? (
            <div>
              <Label className="text-xs font-medium text-[#404040]">Vehicle</Label>
              <Select value={vehicleId} onValueChange={setVehicleId} disabled={isEdit}>
                <SelectTrigger className="mt-1.5 h-9 text-sm">
                  <SelectValue placeholder="Pick a vehicle" />
                </SelectTrigger>
                <SelectContent className="max-h-[260px]">
                  {vehicles.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {[v.make, v.model].filter(Boolean).join(" ")}{v.reg ? ` · ${v.reg}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div>
              <Label className="text-xs font-medium text-[#404040]">Category</Label>
              <div className="mt-1.5 flex gap-2">
                <Select value={category} onValueChange={setCategory} disabled={isEdit}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Pick a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-[#737373]">No categories — type one in the field below.</div>
                    ) : categories.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!isEdit && (
                <Input
                  className="mt-1.5 h-9 text-sm"
                  placeholder="Or type a new category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
              )}
            </div>
          )}

          {/* Bounds per tier */}
          <div className="grid grid-cols-1 gap-3">
            <TierBoundsRow
              label="Daily"
              min={bounds.min_price_daily}
              max={bounds.max_price_daily}
              setMin={(v) => setBounds((b) => ({ ...b, min_price_daily: v }))}
              setMax={(v) => setBounds((b) => ({ ...b, max_price_daily: v }))}
            />
            <TierBoundsRow
              label="Weekly"
              min={bounds.min_price_weekly}
              max={bounds.max_price_weekly}
              setMin={(v) => setBounds((b) => ({ ...b, min_price_weekly: v }))}
              setMax={(v) => setBounds((b) => ({ ...b, max_price_weekly: v }))}
            />
            <TierBoundsRow
              label="Monthly"
              min={bounds.min_price_monthly}
              max={bounds.max_price_monthly}
              setMin={(v) => setBounds((b) => ({ ...b, min_price_monthly: v }))}
              setMax={(v) => setBounds((b) => ({ ...b, max_price_monthly: v }))}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border border-[#f1f5f9] bg-[#f8fafc] px-3 py-2">
            <div className="text-xs">
              <div className="font-medium text-[#080812]">Enable autopilot for this rule</div>
              <div className="text-[#737373]">Requires at least one tier with both min and max set.</div>
            </div>
            <Switch checked={autopilot} onCheckedChange={setAutopilot} />
          </div>

          {(validationError || minMaxError) && (
            <div className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {validationError ?? minMaxError}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={onSubmit}
            disabled={!!validationError || !!minMaxError || create.isPending || update.isPending}
            className="bg-[#0f172a] text-white hover:bg-[#0f172a]/90"
          >
            {isEdit ? "Save rule" : "Create rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TierBoundsRow({
  label, min, max, setMin, setMax,
}: {
  label: string; min: number | null; max: number | null;
  setMin: (v: number | null) => void; setMax: (v: number | null) => void;
}) {
  return (
    <div className="grid grid-cols-[80px_1fr_1fr] items-center gap-2">
      <Label className="text-xs font-medium text-[#404040]">{label}</Label>
      <div>
        <span className="block text-[10px] uppercase tracking-wide text-[#737373]">Min $</span>
        <Input
          type="number"
          min="0"
          step="1"
          value={min ?? ""}
          onChange={(e) => setMin(e.target.value === "" ? null : Number(e.target.value))}
          className="mt-0.5 h-9 text-sm"
        />
      </div>
      <div>
        <span className="block text-[10px] uppercase tracking-wide text-[#737373]">Max $</span>
        <Input
          type="number"
          min="0"
          step="1"
          value={max ?? ""}
          onChange={(e) => setMax(e.target.value === "" ? null : Number(e.target.value))}
          className="mt-0.5 h-9 text-sm"
        />
      </div>
    </div>
  );
}

function numOrNull(v: number | null | undefined): number | null {
  return v == null ? null : Number(v);
}
