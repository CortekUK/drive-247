"use client";

/**
 * Add a vehicle — the v2 dialog.
 *
 * Oct 6 2026: the same pattern as the add-customer dialog (customers-v2/
 * customer-form-dialog-v2.tsx) — a narrow dialog, one small idea per screen,
 * stacked and centred:
 *
 *   picture  →  what Trax is asking, in one line  →  exactly two rows of fields
 *
 *    1. Which car is it?        make, model, year, colour
 *    2. Plate and VIN           plate, VIN, fuel
 *    3. How you got it          bought / financed, date, price or contract total
 *    4. What you charge         day, week, month (Trax's price under each), pre-auth
 *    5. How far they can drive  miles per day / week / month, extra mile rate
 *    6. When it's bookable      by the day / week / month, pickup location
 *    7. Keeping it legal        inspection, registration, warranty start / end
 *    8. Paperwork and security  logbook, service plan, tracker, immobilizer
 *    9. Keys and notes          spare key, who holds it, key notes, security notes
 *   10. On your booking site    the description customers read
 *   11. Photos                  at least one, the first is the cover
 *
 * ONE LAYOUT RULE for every screen: the same picture size, a line reserved for
 * two lines of text, and EXACTLY TWO ROWS of fields in a two-column grid — a
 * lone field spans the row, a group that needs more becomes another screen.
 * Every screen is the same height; nothing jumps, scrolls or slides under the
 * footer.
 *
 * SAVES EXACTLY LIKE v1's `AddVehicleDialog` (components/vehicles/
 * add-vehicle-dialog.tsx, untouched): the same schema
 * (`addVehicleDialogSchema`), the same `vehicles` insert with the finance
 * mapping, the same photo upload into `vehicle-photos` + `vehicle_photos`, the
 * same Inspection / Registration reminders, the same audit log entry, the same
 * duplicate-plate message and the same cache keys. Only the presentation is new.
 */

import { useRef, useState, type ComponentType } from "react";
import { useForm, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ImagePlus, Plus, Star, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { usePickupLocations } from "@/hooks/use-pickup-locations";
import { useAuditLog } from "@/hooks/use-audit-log";
import { useAuditLogOnOpen } from "@/hooks/use-audit-log-on-open";
import { cn } from "@/lib/utils";
import { parseLocalDate } from "@/lib/date-utils";
import { getCurrencySymbol } from "@/lib/format-utils";
import { addVehicleDialogSchema, type AddVehicleDialogFormValues } from "@/client-schemas/vehicles/add-vehicle-dialog";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui-v2/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui-v2/select";
import { useTraxPrice } from "@/hooks/use-trax-price";
import { TraxIcon } from "@/components/chat/TraxIcon";
import { Cell, CONTROL, Segmented, StepFooter, ToggleTile } from "@/components/shared/form-grid-v2";
import {
  AddVehicleBookingArt,
  AddVehicleCarArt,
  AddVehicleKeysArt,
  AddVehicleListingArt,
  AddVehicleMilesArt,
  AddVehicleOwnedArt,
  AddVehiclePapersArt,
  AddVehiclePhotosArt,
  AddVehiclePlateArt,
  AddVehicleRatesArt,
  AddVehicleUpkeepArt,
} from "@/components/illustrations-v2/scenes/add-vehicle";
import { BonzahDateField } from "@/app/(dashboard)/integrations/_panels/bonzah-date-field";

type Values = AddVehicleDialogFormValues;

/* ─────────────────────────────── the screens ─────────────────────────────── */

type Step = {
  /** Short name, for the step dots' tooltip. */
  name: string;
  art: ComponentType<{ className?: string }>;
  title: string;
  line: string;
  fields: FieldPath<Values>[];
};

const STEPS: Step[] = [
  {
    name: "The car",
    art: AddVehicleCarArt,
    title: "Which car is it?",
    line: "The basics first. I'll use them to suggest what to charge for it.",
    fields: ["make", "model", "year", "colour"],
  },
  {
    name: "Plate and VIN",
    art: AddVehiclePlateArt,
    title: "Its plate and VIN",
    line: "The plate is how I tell your cars apart. The VIN can wait if you don't have it.",
    fields: ["reg", "vin", "fuel_type"],
  },
  {
    name: "How you got it",
    art: AddVehicleOwnedArt,
    title: "How did you get it?",
    line: "Bought or financed. I count what it cost you against what it earns.",
    fields: ["acquisition_type", "acquisition_date", "purchase_price", "contract_total"],
  },
  {
    name: "Rates",
    art: AddVehicleRatesArt,
    title: "What do you charge?",
    line: "I check the market for this car and suggest a price under each rate.",
    fields: ["daily_rent", "weekly_rent", "monthly_rent", "security_deposit"],
  },
  {
    name: "Mileage",
    art: AddVehicleMilesArt,
    title: "How far can they drive?",
    line: "Leave a box empty for unlimited miles. I charge the extra rate for anything over.",
    fields: ["daily_mileage", "weekly_mileage", "monthly_mileage", "excess_mileage_rate"],
  },
  {
    name: "Booking",
    art: AddVehicleBookingArt,
    title: "When can they book it?",
    line: "Choose the rental lengths you offer, and where they pick it up.",
    fields: ["available_daily", "available_weekly", "available_monthly", "pickup_location_id"],
  },
  {
    name: "Due dates",
    art: AddVehicleUpkeepArt,
    title: "Keeping it on the road",
    line: "I'll remind you before the inspection or registration is due.",
    fields: ["mot_due_date", "tax_due_date", "warranty_start_date", "warranty_end_date"],
  },
  {
    name: "Paperwork",
    art: AddVehiclePapersArt,
    title: "Paperwork and security",
    line: "What comes with the car, and what keeps it safe.",
    fields: ["has_logbook", "has_service_plan", "has_tracker", "has_remote_immobiliser"],
  },
  {
    name: "Keys",
    art: AddVehicleKeysArt,
    title: "Keys and notes",
    line: "If there's a spare key, tell me who holds it.",
    fields: ["has_spare_key", "spare_key_holder", "spare_key_notes", "security_notes"],
  },
  {
    name: "Listing",
    art: AddVehicleListingArt,
    title: "On your booking site",
    line: "A line or two customers read before they book. Optional.",
    fields: ["description"],
  },
  {
    name: "Photos",
    art: AddVehiclePhotosArt,
    title: "Show it off",
    line: "Add at least one photo. The first is the cover on your booking site.",
    fields: [],
  },
];

/**
 * Trax's market price for a rate, in ONE line under the field: "Trax suggests
 * $50/day · Use". The full card (seasonal markups, the "Why?") lives on the
 * vehicle's own page; here it would push the row out of the grid.
 */
function TraxHint({
  tier,
  make,
  model,
  year,
  current,
  currency,
  onUse,
}: {
  tier: "daily" | "weekly" | "monthly";
  make?: string;
  model?: string;
  year?: number;
  current?: number;
  currency: string;
  onUse: (price: number) => void;
}) {
  const { data, isLoading } = useTraxPrice({ tier, make, model, year });
  const unit = tier === "daily" ? "day" : tier === "weekly" ? "week" : "month";
  if (!make?.trim() || !model?.trim()) return null;
  if (isLoading)
    return (
      <span className="inline-flex items-center gap-1">
        <TraxIcon size={12} /> Trax is checking the market…
      </span>
    );
  const price = data?.suggested_price;
  if (!price) return null;
  const rounded = Math.round(price);
  return (
    <span className="inline-flex items-center gap-1">
      <TraxIcon size={12} />
      Trax suggests{" "}
      <span className="font-medium text-foreground">
        {currency}
        {rounded.toLocaleString()}/{unit}
      </span>
      {current !== rounded && (
        <>
          {" "}·{" "}
          <button
            type="button"
            onClick={() => onUse(rounded)}
            className="font-medium text-primary hover:underline dark:text-[hsl(var(--v2-link,var(--primary)))]"
          >
            Use
          </button>
        </>
      )}
    </span>
  );
}

/* ──────────────────────────────── the dialog ─────────────────────────────── */

export function AddVehicleDialogV2({ open, onOpenChange }: { open?: boolean; onOpenChange?: (o: boolean) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const currentOpen = open !== undefined ? open : isOpen;
  const setOpen = (o: boolean) => (onOpenChange ? onOpenChange(o) : setIsOpen(o));

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const { activeLocations } = usePickupLocations();
  const { logAction } = useAuditLog();
  const currency = getCurrencySymbol(tenant?.currency_code || "USD");

  useAuditLogOnOpen({
    open: currentOpen,
    action: "vehicle_form_dialog_shown",
    entityType: "vehicle",
    entityId: "new",
    details: { mode: "create" },
  });

  const form = useForm<Values>({
    resolver: zodResolver(addVehicleDialogSchema),
    mode: "onSubmit",
    reValidateMode: "onChange",
    defaultValues: {
      reg: "",
      vin: "",
      make: "",
      model: "",
      colour: "",
      fuel_type: "Petrol",
      acquisition_date: new Date(),
      acquisition_type: "Purchase",
      has_logbook: false,
      has_service_plan: false,
      has_spare_key: false,
      spare_key_notes: "",
      has_tracker: false,
      has_remote_immobiliser: false,
      security_notes: "",
      description: "",
      available_daily: true,
      available_weekly: true,
      available_monthly: true,
      pickup_location_id: "",
    },
  });

  const v = form.watch();
  const errors = form.formState.errors;
  const err = (k: FieldPath<Values>) => (errors as Record<string, { message?: string } | undefined>)[k]?.message;
  const set = (k: FieldPath<Values>, value: unknown) =>
    form.setValue(k, value as never, { shouldDirty: true, shouldValidate: !!err(k) });

  /** A number input bound to the form: empty is `undefined`, never 0 or NaN. */
  const num = (k: FieldPath<Values>, opts: { placeholder?: string; step?: string; prefix?: string } = {}) => (
    <div className="relative">
      {opts.prefix && (
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{opts.prefix}</span>
      )}
      <input
        type="number"
        inputMode="decimal"
        step={opts.step ?? "any"}
        min={0}
        value={(v[k] as number | undefined) ?? ""}
        placeholder={opts.placeholder}
        aria-invalid={!!err(k) || undefined}
        onChange={(e) => set(k, e.target.value === "" ? undefined : Number(e.target.value))}
        className={cn(CONTROL, opts.prefix && "pl-8", "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none")}
      />
    </div>
  );
  const text = (k: FieldPath<Values>, placeholder: string, extra?: { upper?: boolean }) => (
    <input
      value={(v[k] as string | undefined) ?? ""}
      placeholder={placeholder}
      aria-invalid={!!err(k) || undefined}
      onChange={(e) => set(k, extra?.upper ? e.target.value.toUpperCase() : e.target.value)}
      className={cn(CONTROL, extra?.upper && "[&:not(:placeholder-shown)]:font-mono [&:not(:placeholder-shown)]:tracking-wide")}
      autoComplete="off"
    />
  );
  const date = (k: FieldPath<Values>) => {
    const d = v[k] as Date | undefined;
    return (
      <BonzahDateField
        value={d ? format(d, "yyyy-MM-dd") : ""}
        invalid={!!err(k)}
        triggerClassName={CONTROL}
        onChange={(s) => set(k, s ? parseLocalDate(s) : undefined)}
      />
    );
  };

  const reset = () => {
    form.reset();
    setStep(0);
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    setPhotos([]);
    setPhotoError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  /* ── navigation ─────────────────────────────────────────────────────── */

  const next = async () => {
    const ok = await form.trigger(STEPS[step].fields);
    if (ok) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const picked: { file: File; url: string }[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) {
        setPhotoError(`${f.name} isn't an image.`);
        continue;
      }
      if (f.size > 5 * 1024 * 1024) {
        setPhotoError(`${f.name} is over 5 MB.`);
        continue;
      }
      picked.push({ file: f, url: URL.createObjectURL(f) });
    }
    if (picked.length) setPhotoError(null);
    setPhotos((p) => [...p, ...picked]);
  };

  /* ── save (v1's, step for step) ──────────────────────────────────────── */

  const save = form.handleSubmit(
    async (data) => {
      if (photos.length === 0) {
        setPhotoError("Add at least one photo of the car.");
        return;
      }
      setLoading(true);
      try {
        const reg = data.reg.toUpperCase().trim();
        const vehicleData: Record<string, unknown> = {
          reg,
          vin: data.vin || null,
          make: data.make,
          model: data.model,
          year: data.year,
          colour: data.colour,
          fuel_type: data.fuel_type,
          acquisition_type: data.acquisition_type,
          acquisition_date: format(data.acquisition_date, "yyyy-MM-dd"),
          daily_rent: data.daily_rent,
          weekly_rent: data.weekly_rent,
          monthly_rent: data.monthly_rent,
          mot_due_date: data.mot_due_date ? format(data.mot_due_date, "yyyy-MM-dd") : undefined,
          tax_due_date: data.tax_due_date ? format(data.tax_due_date, "yyyy-MM-dd") : undefined,
          warranty_start_date: data.warranty_start_date ? format(data.warranty_start_date, "yyyy-MM-dd") : undefined,
          warranty_end_date: data.warranty_end_date ? format(data.warranty_end_date, "yyyy-MM-dd") : undefined,
          has_logbook: data.has_logbook,
          has_service_plan: data.has_service_plan,
          has_spare_key: data.has_spare_key,
          spare_key_holder: data.has_spare_key ? data.spare_key_holder : null,
          spare_key_notes: data.has_spare_key ? data.spare_key_notes : null,
          has_tracker: data.has_tracker,
          has_remote_immobiliser: data.has_remote_immobiliser,
          security_notes: data.security_notes || null,
          description: data.description || null,
          security_deposit: data.security_deposit || null,
          daily_mileage: data.daily_mileage || null,
          weekly_mileage: data.weekly_mileage || null,
          monthly_mileage: data.monthly_mileage || null,
          excess_mileage_rate: data.excess_mileage_rate || null,
          available_daily: data.available_daily,
          available_weekly: data.available_weekly,
          available_monthly: data.available_monthly,
          pickup_location_id: data.pickup_location_id || null,
        };
        if (data.acquisition_type === "Purchase") {
          vehicleData.purchase_price = data.purchase_price;
        } else {
          // v1's finance mapping: the triggers read the contract total from these.
          vehicleData.initial_payment = data.contract_total;
          vehicleData.monthly_payment = 1;
          vehicleData.term_months = 1;
        }

        const { data: inserted, error } = await supabase
          .from("vehicles")
          .insert({ ...vehicleData, tenant_id: tenant?.id || null } as never)
          .select()
          .single();
        if (error) throw error;

        if (inserted?.id) {
          logAction({
            action: "vehicle_created",
            entityType: "vehicle",
            entityId: inserted.id,
            details: { reg, make: data.make, model: data.model },
          });
        }

        // Photos — same bucket, table and naming as v1.
        let uploaded = 0;
        for (let i = 0; i < photos.length; i++) {
          const file = photos[i].file;
          const path = `${inserted.id}-${Date.now()}-${i}.${file.name.split(".").pop()}`;
          const { error: upErr } = await supabase.storage.from("vehicle-photos").upload(path, file);
          if (upErr) continue;
          const {
            data: { publicUrl },
          } = supabase.storage.from("vehicle-photos").getPublicUrl(path);
          const { error: rowErr } = await supabase
            .from("vehicle_photos")
            .insert({ vehicle_id: inserted.id, photo_url: publicUrl, display_order: i, tenant_id: tenant?.id || null });
          if (rowErr) {
            await supabase.storage.from("vehicle-photos").remove([path]);
            continue;
          }
          uploaded++;
        }
        if (uploaded < photos.length) {
          toast({
            title: uploaded === 0 ? "Photo upload warning" : "Some photos didn't upload",
            description:
              uploaded === 0
                ? "The car was added, but its photos didn't upload. You can add them from the vehicle's page."
                : `Added with ${uploaded} of ${photos.length} photos.`,
          });
        }

        // Inspection / Registration reminders — v1's rules, unchanged.
        const today = format(new Date(), "yyyy-MM-dd");
        const remind = async (due: Date, kind: "MOT" | "TAX") => {
          const days = Math.ceil((new Date(due).getTime() - Date.now()) / 86_400_000);
          const code = days <= 0 ? `${kind}_0D` : days <= 7 ? `${kind}_7D` : days <= 14 ? `${kind}_14D` : `${kind}_30D`;
          const severity = days <= 0 ? "critical" : days <= 7 ? "warning" : "info";
          const dueStr = format(due, "yyyy-MM-dd");
          const what = kind === "MOT" ? "Inspection" : "Registration";
          try {
            await supabase.from("reminders").insert({
              rule_code: code,
              object_type: "Vehicle",
              object_id: inserted.id,
              title: `${what} due soon — ${reg} (${days > 0 ? `${days} days` : "overdue"})`,
              message:
                kind === "MOT"
                  ? `Inspection for ${reg} (${data.make} ${data.model}) due on ${dueStr}. Please schedule inspection.`
                  : `Registration for ${reg} (${data.make} ${data.model}) due on ${dueStr}. Please renew.`,
              due_on: dueStr,
              remind_on: today,
              severity,
              context: { vehicle_id: inserted.id, reg, make: data.make, model: data.model, due_date: dueStr, days_until: Math.max(0, days) },
              status: "pending",
              tenant_id: tenant?.id || null,
            } as never);
          } catch {
            /* a missing reminder never blocks the car */
          }
        };
        if (data.mot_due_date) await remind(data.mot_due_date, "MOT");
        if (data.tax_due_date) await remind(data.tax_due_date, "TAX");

        toast({ title: "Vehicle added", description: `${data.make} ${data.model} (${reg}) is now in your fleet.` });
        reset();
        setOpen(false);
        for (const key of ["reminders", "reminder-stats", "vehicles-list", "vehicles-pl", "vehicle-count", "vehicle-pl-entries"]) {
          queryClient.invalidateQueries({ queryKey: [key] });
        }
      } catch (error: any) {
        const dup = `${error?.message ?? ""} ${error?.details ?? ""}`;
        const message =
          error?.code === "23505" && dup.includes("vehicles_reg_key")
            ? `A vehicle with plate '${data.reg}' already exists. If you're re-adding it, the original may still be in your fleet — check your vehicles list, or delete the old one first.`
            : error?.code === "23505"
              ? "This plate is already in use. Check it and try again."
              : error?.message || "Couldn't add the vehicle. Please try again.";
        toast({ title: "Couldn't add the vehicle", description: message, variant: "destructive" });
      } finally {
        setLoading(false);
      }
    },
    // A field on an earlier screen failed: go to the first screen holding one.
    (errs) => {
      const first = STEPS.findIndex((s) => s.fields.some((f) => f in errs));
      if (first >= 0) setStep(first);
    },
  );

  const last = step === STEPS.length - 1;
  const screen = STEPS[step];
  const selectTrigger = cn(CONTROL, "data-[size=default]:h-11");

  /* ── render ────────────────────────────────────────────────────────────── */

  return (
    <Dialog
      open={currentOpen}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setStep(0);
      }}
    >
      {open === undefined && (
        <DialogTrigger asChild>
          <Button className="bg-gradient-primary text-primary-foreground hover:opacity-90">
            <Plus className="size-4" />
            Add Vehicle
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-[600px]"
        showCloseButton={false}
        // Open on the first field to type in, not on the first button —
        // focusing the first toggle drew a focus ring round it.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.querySelector<HTMLInputElement>("input:not([type=hidden]):not([type=file])")?.focus();
        }}
      >
        <DialogTitle className="sr-only">Add a vehicle</DialogTitle>
        <DialogDescription className="sr-only">{screen.title}</DialogDescription>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (last) void save();
            else void next();
          }}
          className="flex flex-col"
        >
          {/* One screen: picture, what Trax is asking, two rows of fields.
              Same height on every step, so nothing jumps and nothing scrolls. */}
          <div
            key={step}
            className="flex h-[456px] flex-col items-center overflow-hidden px-10 pt-8 duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none"
          >
            <screen.art className="max-w-[240px]" />
            <h3 className="mt-4 text-center text-xl font-medium leading-snug text-foreground [text-wrap:balance]">{screen.title}</h3>
            <p className="mx-auto mt-1.5 min-h-[2lh] max-w-[24rem] text-center text-sm leading-relaxed text-muted-foreground [text-wrap:balance]">
              {screen.line}
            </p>

            <div className="mt-5 grid w-full grid-cols-2 gap-x-5 gap-y-1">
              {step === 0 && (
                <>
                  <Cell label="Make" required error={err("make")}>{text("make", "e.g. Toyota")}</Cell>
                  <Cell label="Model" required error={err("model")}>{text("model", "e.g. Corolla")}</Cell>
                  <Cell label="Year" required error={err("year")}>{num("year", { placeholder: String(new Date().getFullYear()), step: "1" })}</Cell>
                  <Cell label="Color" required error={err("colour")}>{text("colour", "e.g. Pearl White")}</Cell>
                </>
              )}

              {step === 1 && (
                <>
                  <Cell label="License plate" required error={err("reg")}>{text("reg", "e.g. 7KX 204", { upper: true })}</Cell>
                  <Cell label="VIN" error={err("vin")} hint="17 characters, optional">{text("vin", "Vehicle identification no.", { upper: true })}</Cell>
                  <Cell label="Fuel" required className="col-span-2" error={err("fuel_type")}>
                    <Segmented
                      value={v.fuel_type}
                      options={[
                        { value: "Petrol", label: "Gas" },
                        { value: "Diesel", label: "Diesel" },
                        { value: "Hybrid", label: "Hybrid" },
                        { value: "Electric", label: "Electric" },
                      ]}
                      onChange={(x) => set("fuel_type", x)}
                    />
                  </Cell>
                </>
              )}

              {step === 2 && (
                <>
                  <Cell label="How you got it" error={err("acquisition_type")}>
                    <Segmented
                      value={v.acquisition_type}
                      options={[
                        { value: "Purchase", label: "Bought" },
                        { value: "Finance", label: "Financed" },
                      ]}
                      onChange={(t) => set("acquisition_type", t)}
                    />
                  </Cell>
                  <Cell label={v.acquisition_type === "Finance" ? "Finance start date" : "Date bought"} required error={err("acquisition_date")}>
                    {date("acquisition_date")}
                  </Cell>
                  {v.acquisition_type === "Finance" ? (
                    <Cell label="Contract total" required className="col-span-2" error={err("contract_total")}>
                      {num("contract_total", { placeholder: "0.00", prefix: currency })}
                    </Cell>
                  ) : (
                    <Cell label="Purchase price" required className="col-span-2" error={err("purchase_price")}>
                      {num("purchase_price", { placeholder: "0.00", prefix: currency })}
                    </Cell>
                  )}
                </>
              )}

              {step === 3 && (
                <>
                  {(
                    [
                      ["daily_rent", "Daily rate", "daily"],
                      ["weekly_rent", "Weekly rate", "weekly"],
                      ["monthly_rent", "Monthly rate", "monthly"],
                    ] as const
                  ).map(([k, label, tier]) => (
                    <Cell
                      key={k}
                      label={label}
                      required
                      error={err(k)}
                      hint={
                        <TraxHint
                          tier={tier}
                          make={v.make}
                          model={v.model}
                          year={Number(v.year) || undefined}
                          current={Number(v[k]) || undefined}
                          currency={currency}
                          onUse={(price) => set(k, price)}
                        />
                      }
                    >
                      {num(k, { placeholder: "0.00", prefix: currency })}
                    </Cell>
                  ))}
                  <Cell label="Pre-authorization" error={err("security_deposit")} hint="Held on the card at booking">
                    {num("security_deposit", { placeholder: "0.00", prefix: currency })}
                  </Cell>
                </>
              )}

              {step === 4 && (
                <>
                  <Cell label="Miles included / day" error={err("daily_mileage")}>{num("daily_mileage", { placeholder: "Unlimited", step: "1" })}</Cell>
                  <Cell label="Miles included / week" error={err("weekly_mileage")}>{num("weekly_mileage", { placeholder: "Unlimited", step: "1" })}</Cell>
                  <Cell label="Miles included / month" error={err("monthly_mileage")}>{num("monthly_mileage", { placeholder: "Unlimited", step: "1" })}</Cell>
                  <Cell label="Extra mile rate" error={err("excess_mileage_rate")} hint="Per mile over the allowance">
                    {num("excess_mileage_rate", { placeholder: "0.00", prefix: currency, step: "0.01" })}
                  </Cell>
                </>
              )}

              {step === 5 && (
                <>
                  <Cell label="Book by the day">
                    <ToggleTile label="Book by the day" checked={v.available_daily !== false} onChange={(x) => set("available_daily", x)} />
                  </Cell>
                  <Cell label="Book by the week">
                    <ToggleTile label="Book by the week" checked={v.available_weekly !== false} onChange={(x) => set("available_weekly", x)} />
                  </Cell>
                  <Cell label="Book by the month">
                    <ToggleTile label="Book by the month" checked={v.available_monthly !== false} onChange={(x) => set("available_monthly", x)} />
                  </Cell>
                  <Cell label="Pickup location">
                    <Select value={v.pickup_location_id || "__any__"} onValueChange={(x) => set("pickup_location_id", x === "__any__" ? "" : x)}>
                      <SelectTrigger className={selectTrigger}>
                        <SelectValue placeholder="Any location" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__any__">Any location</SelectItem>
                        {activeLocations.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Cell>
                </>
              )}

              {step === 6 && (
                <>
                  <Cell label="Inspection due" error={err("mot_due_date")}>{date("mot_due_date")}</Cell>
                  <Cell label="Registration due" error={err("tax_due_date")}>{date("tax_due_date")}</Cell>
                  <Cell label="Warranty starts" error={err("warranty_start_date")}>{date("warranty_start_date")}</Cell>
                  <Cell label="Warranty ends" error={err("warranty_end_date")}>{date("warranty_end_date")}</Cell>
                </>
              )}

              {step === 7 && (
                <>
                  <Cell label="Logbook">
                    <ToggleTile label="Has a logbook" checked={!!v.has_logbook} onChange={(x) => set("has_logbook", x)} />
                  </Cell>
                  <Cell label="Service plan">
                    <ToggleTile label="Has a service plan" checked={!!v.has_service_plan} onChange={(x) => set("has_service_plan", x)} />
                  </Cell>
                  <Cell label="Tracker">
                    <ToggleTile label="Has a tracker" checked={!!v.has_tracker} onChange={(x) => set("has_tracker", x)} />
                  </Cell>
                  <Cell label="Remote immobilizer">
                    <ToggleTile label="Remote immobilizer" checked={!!v.has_remote_immobiliser} onChange={(x) => set("has_remote_immobiliser", x)} />
                  </Cell>
                </>
              )}

              {step === 8 && (
                <>
                  <Cell label="Spare key">
                    <ToggleTile
                      label="Spare key"
                      checked={!!v.has_spare_key}
                      onChange={(x) => {
                        set("has_spare_key", x);
                        if (!x) set("spare_key_holder", undefined);
                      }}
                    />
                  </Cell>
                  <Cell label="Who holds it" required={!!v.has_spare_key} error={err("spare_key_holder")}>
                    <Select value={v.spare_key_holder ?? ""} onValueChange={(x) => set("spare_key_holder", x)} disabled={!v.has_spare_key}>
                      <SelectTrigger className={selectTrigger}>
                        <SelectValue placeholder={v.has_spare_key ? "Choose" : "No spare key"} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Company">Your company</SelectItem>
                        <SelectItem value="Customer">The customer</SelectItem>
                      </SelectContent>
                    </Select>
                  </Cell>
                  <Cell label="Spare key notes" error={err("spare_key_notes")}>
                    <input
                      value={v.spare_key_notes ?? ""}
                      disabled={!v.has_spare_key}
                      placeholder={v.has_spare_key ? "e.g. In the office safe" : "No spare key"}
                      onChange={(e) => set("spare_key_notes", e.target.value)}
                      className={CONTROL}
                    />
                  </Cell>
                  <Cell label="Security notes" error={err("security_notes")}>{text("security_notes", "e.g. Tracker by Bouncie")}</Cell>
                </>
              )}

              {step === 9 && (
                <Cell label="Description" className="col-span-2" error={err("description")}>
                  <textarea
                    value={v.description ?? ""}
                    placeholder="e.g. Seats 5, Apple CarPlay, great on gas. Perfect for a weekend away."
                    onChange={(e) => set("description", e.target.value)}
                    className={cn(CONTROL, "h-[142px] resize-none py-3 leading-relaxed")}
                  />
                </Cell>
              )}

              {step === 10 && (
                <div className="col-span-2 flex flex-col gap-1.5">
                  <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} />
                  {photos.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        addPhotos(e.dataTransfer.files);
                      }}
                      className={cn(
                        "flex h-[168px] flex-col items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed bg-muted/20 transition-colors duration-200 hover:border-primary/50 hover:bg-primary/[0.03] motion-reduce:transition-none",
                        photoError ? "border-destructive/50" : "border-foreground/20",
                      )}
                    >
                      <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
                        <ImagePlus className="size-5" />
                      </span>
                      <span className="text-sm font-medium text-foreground">Drop photos here, or click to choose</span>
                      <span className="text-xs text-muted-foreground">JPG, PNG or WebP, up to 5 MB each</span>
                    </button>
                  ) : (
                    <div className="grid h-[168px] grid-cols-5 grid-rows-2 gap-2">
                      {photos.slice(0, 9).map((p, i) => (
                        <div
                          key={p.url}
                          className="group relative overflow-hidden rounded-xl border border-foreground/10 bg-muted/30 duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.url} alt="" className="size-full object-cover" />
                          {i === 0 && (
                            <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-full bg-background/90 px-1.5 py-0.5 text-[9px] font-medium text-foreground">
                              <Star className="size-2.5 fill-current text-amber-500" /> Cover
                            </span>
                          )}
                          <button
                            type="button"
                            aria-label="Remove photo"
                            onClick={() => {
                              URL.revokeObjectURL(p.url);
                              setPhotos((ps) => ps.filter((x) => x.url !== p.url));
                            }}
                            className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-background/90 text-foreground opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="flex flex-col items-center justify-center gap-1 rounded-xl border-[1.5px] border-dashed border-foreground/20 text-[11px] text-muted-foreground transition-colors duration-200 hover:border-primary/50 hover:text-foreground motion-reduce:transition-none"
                      >
                        <Plus className="size-4" />
                        {photos.length > 9 ? `+${photos.length - 9}` : "Add"}
                      </button>
                    </div>
                  )}
                  <span className={cn("min-h-[18px] px-0.5 text-[11px] leading-[18px]", photoError ? "text-destructive" : "text-muted-foreground")}>
                    {photoError ?? (photos.length ? `${photos.length} photo${photos.length === 1 ? "" : "s"} · the first is the cover` : "")}
                  </span>
                </div>
              )}
            </div>
          </div>

          <StepFooter
            compact
            steps={STEPS.map((x) => x.name)}
            step={step}
            loading={loading}
            onBack={() => setStep(step - 1)}
            onCancel={() => setOpen(false)}
            finishLabel="Add vehicle"
            busyLabel="Adding…"
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
