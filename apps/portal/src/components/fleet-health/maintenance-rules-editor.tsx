"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarClock, Layers, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useMaintenanceRules, useMaintenanceRuleActions, type RuleFormData } from "@/hooks/use-maintenance-rules";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import { formatDistance, type DistanceUnit } from "@/lib/format-utils";
import { fromStoredMiles, toStoredMiles } from "@/lib/fleet-health-units";
import { SERVICE_TYPES, type MaintenanceRule } from "@/types/fleet-health";
import {
  maintenanceRuleSchema,
  type MaintenanceRuleFormValues,
} from "@/client-schemas/fleet-health/maintenance-rule";

const NONE = "__none";

interface MaintenanceRulesEditorProps {
  /** Undefined edits the tenant-wide defaults; set edits one vehicle's overrides. */
  vehicleId?: string;
}

type EditorTarget =
  | { mode: "create" }
  | { mode: "edit"; rule: MaintenanceRule }
  /** Copies a tenant default down onto this vehicle as a new, editable rule. */
  | { mode: "override"; rule: MaintenanceRule };

export function MaintenanceRulesEditor({ vehicleId }: MaintenanceRulesEditorProps) {
  const { tenant } = useTenant();
  const unit: DistanceUnit = tenant?.distance_unit ?? "miles";
  const { data: rules = [], isLoading } = useMaintenanceRules(vehicleId);
  const { upsertRule, removeRule, seedDefaults, isSaving, isSeeding, isRemoving } =
    useMaintenanceRuleActions();

  const [target, setTarget] = useState<EditorTarget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MaintenanceRule | null>(null);

  const isVehicleScope = !!vehicleId;

  const { defaults, overrides, overriddenTypes } = useMemo(() => {
    const defaults = rules.filter((r) => r.vehicle_id === null);
    const overrides = vehicleId ? rules.filter((r) => r.vehicle_id === vehicleId) : [];
    // A vehicle override supersedes the tenant default with the same service_type.
    const overriddenTypes = new Set(
      overrides.map((r) => r.service_type).filter((t): t is string => !!t)
    );
    return { defaults, overrides, overriddenTypes };
  }, [rules, vehicleId]);

  const isEmpty = defaults.length === 0 && overrides.length === 0;

  const toggleActive = (rule: MaintenanceRule, is_active: boolean) => {
    // On a vehicle page, an inherited row is the TENANT-WIDE default. Editing it in
    // place would silently turn that schedule off for every vehicle in the fleet —
    // the operator's intent is "not this car". So create a vehicle-scoped override
    // instead, dropping the id so upsert takes its insert branch.
    if (isVehicleScope && rule.vehicle_id === null) {
      const { id: _omit, ...form } = ruleToForm(rule);
      upsertRule({ ...form, vehicle_id: vehicleId!, is_active });
      return;
    }
    upsertRule({ ...ruleToForm(rule), is_active });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-medium text-foreground">Maintenance schedules</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {isVehicleScope
              ? "This vehicle inherits your fleet defaults. Override any of them if this car is different."
              : "Applied to every vehicle unless a vehicle has its own override. Schedules are optional — compliance dates are tracked without them."}
          </p>
        </div>
        {!isEmpty && (
          <Button size="sm" onClick={() => setTarget({ mode: "create" })}>
            <Plus className="mr-2 h-4 w-4" />
            Add schedule
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : isEmpty ? (
        <div className="rounded-md border border-[#f1f5f9] bg-[#f8fafc] p-6 text-center dark:border-border dark:bg-muted/40">
          <CalendarClock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">No schedules set up yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Start from the intervals most operators use, then adjust or remove anything that does
            not apply to your fleet.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Button onClick={() => seedDefaults()} disabled={isSeeding}>
              <Sparkles className="mr-2 h-4 w-4" />
              {isSeeding ? "Adding..." : "Add the standard schedules"}
            </Button>
            <Button variant="outline" onClick={() => setTarget({ mode: "create" })}>
              <Plus className="mr-2 h-4 w-4" />
              Add one myself
            </Button>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-[#f1f5f9] dark:border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#eef2ff] hover:bg-[#eef2ff] dark:bg-muted dark:hover:bg-muted">
                <TableHead>Schedule</TableHead>
                <TableHead>Every</TableHead>
                <TableHead>Warn me</TableHead>
                <TableHead className="w-[90px]">Active</TableHead>
                <TableHead className="w-[110px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overrides.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  unit={unit}
                  scope="override"
                  onToggleActive={toggleActive}
                  onEdit={() => setTarget({ mode: "edit", rule })}
                  onDelete={() => setPendingDelete(rule)}
                />
              ))}

              {defaults.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  unit={unit}
                  scope={isVehicleScope ? "inherited" : "tenant"}
                  supersededBy={
                    isVehicleScope && rule.service_type && overriddenTypes.has(rule.service_type)
                      ? "overridden"
                      : undefined
                  }
                  onToggleActive={toggleActive}
                  onEdit={() => setTarget({ mode: "edit", rule })}
                  onDelete={() => setPendingDelete(rule)}
                  onOverride={() => setTarget({ mode: "override", rule })}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <RuleFormDialog
        target={target}
        vehicleId={vehicleId}
        unit={unit}
        isSaving={isSaving}
        onClose={() => setTarget(null)}
        onSubmit={(form) => upsertRule(form, { onSuccess: () => setTarget(null) })}
      />

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{pendingDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.vehicle_id
                ? "This vehicle will go back to following your fleet default for this service."
                : "Every vehicle following this schedule will stop being tracked against it. Work already logged in service history is not affected."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isRemoving}
              onClick={() => {
                if (pendingDelete) removeRule(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RuleRow({
  rule,
  unit,
  scope,
  supersededBy,
  onToggleActive,
  onEdit,
  onDelete,
  onOverride,
}: {
  rule: MaintenanceRule;
  unit: DistanceUnit;
  scope: "tenant" | "inherited" | "override";
  supersededBy?: "overridden";
  onToggleActive: (rule: MaintenanceRule, active: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onOverride?: () => void;
}) {
  const inherited = scope === "inherited";
  const muted = inherited || !rule.is_active;

  return (
    <TableRow className={cn(muted && "text-muted-foreground")}>
      <TableCell>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("font-medium", inherited && "font-normal")}>{rule.name}</span>
          {scope === "override" && (
            <Badge variant="outline" className="border-indigo-200 text-[#6366f1]">
              This vehicle
            </Badge>
          )}
          {inherited && (
            <Badge variant="outline" className="text-muted-foreground">
              Fleet default
            </Badge>
          )}
          {supersededBy === "overridden" && (
            <Badge variant="outline" className="text-muted-foreground">
              Overridden
            </Badge>
          )}
          {rule.is_excluded && (
            <Badge variant="outline" className="text-muted-foreground">
              Exempt
            </Badge>
          )}
        </div>
        {rule.service_type && (
          <p className="mt-0.5 text-xs text-muted-foreground">{rule.service_type}</p>
        )}
      </TableCell>
      <TableCell className="text-sm">{describeInterval(rule, unit)}</TableCell>
      <TableCell className="text-sm">{describeLead(rule, unit)}</TableCell>
      <TableCell>
        <Switch
          checked={rule.is_active}
          onCheckedChange={(v) => onToggleActive(rule, v)}
          aria-label={`${rule.name} active`}
        />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          {inherited && onOverride && !supersededBy && (
            <Button variant="ghost" size="sm" onClick={onOverride} title="Override for this vehicle">
              <Layers className="mr-1 h-3.5 w-3.5" />
              Override
            </Button>
          )}
          {!inherited && (
            <>
              <Button variant="ghost" size="icon" onClick={onEdit} title="Edit">
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={onDelete} title="Remove">
                <Trash2 className="h-4 w-4 text-red-600" />
              </Button>
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function RuleFormDialog({
  target,
  vehicleId,
  unit,
  isSaving,
  onClose,
  onSubmit,
}: {
  target: EditorTarget | null;
  vehicleId?: string;
  unit: DistanceUnit;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (form: RuleFormData) => void;
}) {
  const unitShort = unit === "miles" ? "miles" : "km";

  const form = useForm<MaintenanceRuleFormValues>({
    resolver: zodResolver(maintenanceRuleSchema),
    defaultValues: {
      name: "",
      service_type: NONE,
      interval_miles: undefined,
      interval_months: undefined,
      lead_miles: 500,
      lead_days: 14,
      is_active: true,
      is_excluded: false,
    },
  });

  useEffect(() => {
    if (!target) return;
    const rule = target.mode === "create" ? null : target.rule;
    form.reset({
      name: rule?.name ?? "",
      service_type: rule?.service_type ?? NONE,
      // `interval_miles` and `lead_miles` are stored in miles, as the column
      // names say. The form works in the tenant's unit, so both cross the
      // boundary here and again in handleSubmit. Without this a km tenant was
      // shown a mile figure under a "km" label and it round-tripped unchanged,
      // which is how a 10,000 km service interval became a 10,000 mile one.
      interval_miles: fromStoredMiles(rule?.interval_miles, unit) ?? undefined,
      interval_months: rule?.interval_months ?? undefined,
      lead_miles: fromStoredMiles(rule?.lead_miles, unit) ?? 500,
      lead_days: rule?.lead_days ?? 14,
      is_active: rule?.is_active ?? true,
      is_excluded: target.mode === "override" ? false : (rule?.is_excluded ?? false),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  if (!target) return null;

  const isOverride = target.mode === "override";
  const editingRule = target.mode === "edit" ? target.rule : null;
  // An override only supersedes its default when the service_type matches exactly.
  const lockServiceType = isOverride;

  const handleSubmit = (values: MaintenanceRuleFormValues) => {
    onSubmit({
      id: editingRule?.id,
      vehicle_id: editingRule ? editingRule.vehicle_id : (vehicleId ?? null),
      name: values.name.trim(),
      service_type: values.service_type === NONE ? null : (values.service_type ?? null),
      interval_miles:
        values.interval_miles == null ? null : toStoredMiles(values.interval_miles, unit),
      interval_months: values.interval_months ?? null,
      lead_miles: toStoredMiles(values.lead_miles, unit),
      lead_days: values.lead_days,
      is_active: values.is_active,
      is_excluded: values.is_excluded ?? false,
      sort_order: target.mode === "create" ? 0 : (target.rule.sort_order ?? 0),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {isOverride
              ? `Override “${target.rule.name}” for this vehicle`
              : editingRule
                ? "Edit schedule"
                : "Add schedule"}
          </DialogTitle>
          <DialogDescription>
            {isOverride
              ? "The fleet default stays as it is — this copy applies to this vehicle only."
              : "Set a mileage interval, a time interval, or both. Whichever comes first wins."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Name <span className="text-red-500">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Oil change" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="service_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Service type</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value ?? NONE}
                    disabled={lockServiceType}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Not set" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>Not set</SelectItem>
                      {SERVICE_TYPES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription className="text-xs">
                    {lockServiceType
                      ? "Locked so this override stays matched to the fleet default it replaces."
                      : "Completed work is matched back to this schedule by service type."}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <NumberField
                control={form.control}
                name="interval_miles"
                label={`Every N ${unitShort}`}
                placeholder="5000"
              />
              <NumberField
                control={form.control}
                name="interval_months"
                label="Every N months"
                placeholder="6"
              />
              <NumberField
                control={form.control}
                name="lead_miles"
                label={`Warn me ${unitShort} before`}
                placeholder="500"
              />
              <NumberField
                control={form.control}
                name="lead_days"
                label="Warn me days before"
                placeholder="14"
              />
            </div>

            <FormField
              control={form.control}
              name="is_active"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border border-[#f1f5f9] p-3 dark:border-border">
                  <div>
                    <FormLabel>Active</FormLabel>
                    <FormDescription className="text-xs">
                      Inactive schedules stop appearing in Fleet Health.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            {(vehicleId || editingRule?.vehicle_id) && (
              <FormField
                control={form.control}
                name="is_excluded"
                render={({ field }) => (
                  <FormItem>
                    <label className="flex cursor-pointer items-start gap-2">
                      <FormControl>
                        <Checkbox
                          checked={!!field.value}
                          onCheckedChange={(v) => field.onChange(v === true)}
                          className="mt-0.5"
                        />
                      </FormControl>
                      <span className="text-sm">
                        This vehicle is exempt from this schedule
                        <span className="block text-xs text-muted-foreground">
                          Keeps the record, but stops it counting towards this vehicle&apos;s health.
                        </span>
                      </span>
                    </label>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "Saving..." : isOverride ? "Create override" : "Save schedule"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function NumberField({
  control,
  name,
  label,
  placeholder,
}: {
  control: any;
  name: keyof MaintenanceRuleFormValues;
  label: string;
  placeholder: string;
}) {
  return (
    <FormField
      control={control}
      name={name as any}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder={placeholder}
              value={(field.value as number | undefined) ?? ""}
              onChange={(e) =>
                field.onChange(e.target.value === "" ? undefined : e.target.valueAsNumber)
              }
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function ruleToForm(rule: MaintenanceRule): RuleFormData {
  return {
    id: rule.id,
    vehicle_id: rule.vehicle_id,
    name: rule.name,
    service_type: rule.service_type,
    interval_miles: rule.interval_miles,
    interval_months: rule.interval_months,
    lead_miles: rule.lead_miles,
    lead_days: rule.lead_days,
    is_active: rule.is_active,
    is_excluded: rule.is_excluded,
    sort_order: rule.sort_order,
  };
}

function describeInterval(rule: MaintenanceRule, unit: DistanceUnit): string {
  const parts: string[] = [];
  // Stored miles -> the tenant's unit before the unit label is attached.
  if (rule.interval_miles)
    parts.push(formatDistance(fromStoredMiles(rule.interval_miles, unit)!, unit));
  if (rule.interval_months)
    parts.push(`${rule.interval_months} month${rule.interval_months === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" or ") : "—";
}

function describeLead(rule: MaintenanceRule, unit: DistanceUnit): string {
  const parts: string[] = [];
  if (rule.lead_miles) parts.push(formatDistance(fromStoredMiles(rule.lead_miles, unit)!, unit));
  if (rule.lead_days) parts.push(`${rule.lead_days} day${rule.lead_days === 1 ? "" : "s"}`);
  return parts.length ? `${parts.join(" / ")} before` : "No warning";
}
