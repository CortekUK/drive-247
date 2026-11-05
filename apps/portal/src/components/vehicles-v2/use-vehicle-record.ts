"use client";

/**
 * The vehicle screen's data layer.
 *
 * ONE query for the car itself, plus small companions for the things that live
 * in their own tables. Everything else on the screen reuses the hooks v1
 * already has (`useVehicleServices`, `useVehicleFiles`, `useBlockedDates`,
 * `useVehicleEvents`, …) rather than re-querying the same rows a second way.
 *
 * EVERY query filters on `tenant_id`. RLS is disabled on these tables — see
 * V2_PLAN §0 — so the `tenant_id` in the query IS the isolation. v1's own
 * vehicle detail page fetches the car by `.eq('id', id)` alone; that is a real
 * hole and it is not carried across here.
 *
 * ── Writing ─────────────────────────────────────────────────────────────
 * There is no Save button on this screen: a keystroke is the commit. Written
 * literally that is one round trip per character, so `patch()` does three
 * things instead:
 *
 *   1. updates the cached row immediately, so the UI never waits
 *   2. coalesces every field touched inside the debounce window into ONE
 *      `UPDATE`
 *   3. rolls the cache back and says so if the write fails
 *
 * The debounce is short enough that leaving the tab flushes anyway (the effect
 * cleanup does it), and `saving` is exposed so the rail can say "Saving…"
 * rather than leaving the operator to guess.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";

/** How long to wait after the last keystroke before writing. */
const WRITE_DEBOUNCE_MS = 700;

/* ══════════════════════════════════════════════════════════════════════════
 * Shape
 * ═════════════════════════════════════════════════════════════════════════ */

export interface VehicleRecord {
  id: string;
  tenant_id: string | null;

  /* identity */
  reg: string;
  make: string | null;
  model: string | null;
  year: number | null;
  colour: string | null;
  vin: string | null;
  fuel_type: string | null;
  category: string | null;
  description: string | null;
  photo_url: string | null;

  /* rates */
  daily_rent: number | null;
  weekly_rent: number | null;
  monthly_rent: number | null;
  security_deposit: number | null;
  available_daily: boolean;
  available_weekly: boolean;
  available_monthly: boolean;

  /* mileage */
  daily_mileage: number | null;
  weekly_mileage: number | null;
  monthly_mileage: number | null;
  excess_mileage_rate: number | null;
  unlimited_mileage_available: boolean;
  unlimited_mileage_price_daily: number | null;
  unlimited_mileage_price_weekly: number | null;
  unlimited_mileage_price_monthly: number | null;

  /* going out */
  status: string | null;
  is_paused: boolean;
  paused_reason: string | null;
  paused_at: string | null;
  pickup_location_id: string | null;
  garaging_state: string | null;
  lockbox_code: string | null;
  lockbox_instructions: string | null;

  /* compliance & upkeep */
  mot_due_date: string | null;
  tax_due_date: string | null;
  warranty_start_date: string | null;
  warranty_end_date: string | null;
  current_mileage: number | null;
  last_service_date: string | null;
  last_service_mileage: number | null;
  has_service_plan: boolean | null;

  /* custody */
  has_logbook: boolean;
  has_spare_key: boolean | null;
  spare_key_holder: string | null;
  spare_key_notes: string | null;
  has_tracker: boolean | null;
  has_remote_immobiliser: boolean | null;
  security_notes: string | null;

  /* money */
  acquisition_type: string | null;
  acquisition_date: string | null;
  purchase_price: number | null;
  monthly_payment: number | null;
  initial_payment: number | null;
  term_months: number | null;
  balloon: number | null;
  finance_start_date: string | null;

  /* retirement */
  is_disposed: boolean | null;
  disposal_date: string | null;
  sale_proceeds: number | null;
  disposal_buyer: string | null;
  disposal_notes: string | null;

  created_at: string | null;
  updated_at: string | null;
}

/** Only the columns this screen shows. Never `select('*')` — see below. */
const VEHICLE_COLUMNS = `
  id, tenant_id, reg, make, model, year, colour, vin, fuel_type, category, description, photo_url,
  daily_rent, weekly_rent, monthly_rent, security_deposit,
  available_daily, available_weekly, available_monthly,
  daily_mileage, weekly_mileage, monthly_mileage, excess_mileage_rate,
  unlimited_mileage_available, unlimited_mileage_price_daily, unlimited_mileage_price_weekly, unlimited_mileage_price_monthly,
  status, is_paused, paused_reason, paused_at, pickup_location_id, garaging_state, lockbox_code, lockbox_instructions,
  mot_due_date, tax_due_date, warranty_start_date, warranty_end_date,
  current_mileage, last_service_date, last_service_mileage, has_service_plan,
  has_logbook, has_spare_key, spare_key_holder, spare_key_notes, has_tracker, has_remote_immobiliser, security_notes,
  acquisition_type, acquisition_date, purchase_price, monthly_payment, initial_payment, term_months, balloon, finance_start_date,
  is_disposed, disposal_date, sale_proceeds, disposal_buyer, disposal_notes,
  created_at, updated_at
`;

export const vehicleKey = (tenantId: string | undefined, id: string) =>
  ["vehicle-v2", tenantId, id] as const;

/** The row as last read from or written to the database, without edits not yet saved. */
const savedKey = (tenantId: string | undefined, id: string) => ["vehicle-v2-saved", tenantId, id] as const;

const FIELD_LABELS: Record<string, string> = {
  make: "the make", model: "the model", year: "the year", colour: "the colour", reg: "the plate",
  vin: "the VIN", description: "the description", fuel_type: "the fuel", category: "the class",
};
const labelFor = (k: string) => FIELD_LABELS[k] ?? k.replace(/_/g, " ");

/**
 * The car's own rules, the same ones the Add Vehicle form applies
 * (client-schemas/vehicles/add-vehicle-dialog.ts). A value that breaks one stays
 * on screen with this message and is not written.
 */
export function vehicleFieldError(field: string, value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : value;
  switch (field) {
    case "make":
      return text ? null : "Make is required, so this wasn't saved.";
    case "model":
      return text ? null : "Model is required, so this wasn't saved.";
    case "reg":
      return text ? null : "A plate is required, so this wasn't saved.";
    case "year": {
      const max = new Date().getFullYear() + 1;
      const y = Number(value);
      return value != null && Number.isInteger(y) && y >= 1900 && y <= max
        ? null
        : `Year must be between 1900 and ${max}, so this wasn't saved.`;
    }
    default:
      return null;
  }
}

/** What is written for a field: plates in capitals, and no stray spaces on names. */
export function cleanForSave(field: string, value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (field === "reg") return value.trim().toUpperCase();
  if (field === "make" || field === "model" || field === "colour") return value.trim();
  return value;
}

/* ══════════════════════════════════════════════════════════════════════════
 * The record
 * ═════════════════════════════════════════════════════════════════════════ */

export function useVehicleRecord(id: string) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const key = vehicleKey(tenant?.id, id);

  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<VehicleRecord | null> => {
      if (!tenant?.id) return null;
      const { data, error } = await supabase
        .from("vehicles")
        .select(VEHICLE_COLUMNS)
        // Both, always. `id` alone would happily return another operator's car:
        // RLS is off on this table and the id is in the URL.
        .eq("id", id)
        .eq("tenant_id", tenant.id)
        .maybeSingle();
      if (error) throw error;
      const row = (data as unknown as VehicleRecord) ?? null;
      queryClient.setQueryData(savedKey(tenant.id, id), row);
      return row;
    },
    enabled: !!tenant?.id && !!id,
  });

  /* ── the debounced writer ─────────────────────────────────────────────── */

  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  /** Fields holding a value that breaks a rule: shown under the field, never written. */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /** Bumped when the screen is put back to the database's values, so open inputs show them. */
  const [revision, setRevision] = useState(0);
  /** Writes run one after another, so each one checks against the row the last one left. */
  const chain = useRef<Promise<void>>(Promise.resolve());

  /** Put fields back to what the database holds, then re-read it. */
  const backToSaved = useCallback(
    async (fields: string[]) => {
      const saved = queryClient.getQueryData<VehicleRecord | null>(savedKey(tenant?.id, id));
      if (saved) {
        queryClient.setQueryData(key, (old: VehicleRecord | null | undefined) => {
          if (!old) return old;
          const next = { ...old } as unknown as Record<string, unknown>;
          for (const f of fields) next[f] = (saved as unknown as Record<string, unknown>)[f];
          return next as unknown as VehicleRecord;
        });
      }
      await queryClient.invalidateQueries({ queryKey: key });
      setRevision((r) => r + 1);
    },
    [queryClient, key, tenant?.id, id],
  );

  /** One write: everything queued so far, in one UPDATE. Safe to call with nothing queued. */
  const write = useCallback(async () => {
    const queued = pending.current;
    pending.current = {};
    if (!tenant?.id || Object.keys(queued).length === 0) return;

    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(queued)) fields[k] = cleanForSave(k, v);
    const saved = queryClient.getQueryData<VehicleRecord | null>(savedKey(tenant.id, id)) as unknown as
      | Record<string, unknown>
      | null
      | undefined;

    setSaving(true);
    // Only write if every field being changed still holds what this screen last
    // read. Another tab or another person may have changed it since, and writing
    // anyway would replace their change without either of you knowing.
    let query = supabase
      .from("vehicles")
      .update(fields as never)
      .eq("id", id)
      .eq("tenant_id", tenant.id);
    if (saved) {
      for (const k of Object.keys(fields)) {
        if (!(k in saved)) continue;
        const was = saved[k];
        if (was === null || was === undefined) query = query.is(k, null);
        else if (["string", "number", "boolean"].includes(typeof was)) query = query.eq(k, was as never);
      }
    }
    const { data, error } = await query.select("id");
    setSaving(false);

    if (error) {
      const text = `${error.message ?? ""} ${(error as { details?: string }).details ?? ""}`;
      const takenPlate = (error as { code?: string }).code === "23505" && /reg/i.test(text);
      const oldPlate = saved?.reg ? String(saved.reg) : "the old plate";
      toast({
        title: "That change didn't save",
        description: takenPlate
          ? `The plate ${String(fields.reg)} is already used by another car. It's back to ${oldPlate}.`
          : error.message,
        variant: "destructive",
      });
      await backToSaved(Object.keys(fields));
      return;
    }

    if (!data || data.length === 0) {
      toast({
        title: "That change didn't save",
        description: `This car was changed in another tab or by someone else since you opened it, so ${Object.keys(
          fields,
        )
          .map(labelFor)
          .join(", ")} wasn't saved. The latest version is now showing.`,
        variant: "destructive",
      });
      await backToSaved(Object.keys(fields));
      return;
    }

    queryClient.setQueryData(savedKey(tenant.id, id), (old: VehicleRecord | null | undefined) =>
      old ? ({ ...old, ...fields } as VehicleRecord) : old,
    );
    setLastSavedAt(new Date());
    // The vehicles LIST and anything else keyed on this car reads the same row.
    // The list page itself is keyed ["vehicles-list", tenantId], which the
    // ["vehicles"] prefix does not reach.
    queryClient.invalidateQueries({ queryKey: ["vehicles"] });
    queryClient.invalidateQueries({ queryKey: ["vehicles-list"] });
    queryClient.invalidateQueries({ queryKey: ["vehicle", id] });
  }, [tenant?.id, id, toast, queryClient, backToSaved]);

  /** Write everything queued, after any write already running. */
  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    chain.current = chain.current.then(write, write);
    return chain.current;
  }, [write]);

  /**
   * Write a field (or several) through to the record.
   *
   * The cache moves now; the database catches up on the timer. Calling this
   * from an input's `onChange` is the intended use — that is what makes the
   * screen have no Save button. A value that breaks one of the car's rules is
   * shown with its message and kept out of the write.
   */
  const patch = useCallback(
    (fields: Partial<VehicleRecord>) => {
      queryClient.setQueryData(key, (old: VehicleRecord | null | undefined) =>
        old ? { ...old, ...fields } : old,
      );
      const errors: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(fields)) {
        const problem = vehicleFieldError(k, v);
        errors[k] = problem;
        if (problem) delete pending.current[k];
        else pending.current[k] = v;
      }
      setFieldErrors((prev) => {
        const next = { ...prev };
        for (const [k, problem] of Object.entries(errors)) {
          if (problem) next[k] = problem;
          else delete next[k];
        }
        return next;
      });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush();
      }, WRITE_DEBOUNCE_MS);
    },
    [queryClient, key, flush],
  );

  /** Write immediately — for a switch or a button, where waiting reads as lag. */
  const patchNow = useCallback(
    (fields: Partial<VehicleRecord>) => {
      patch(fields);
      void flush();
    },
    [patch, flush],
  );

  // Navigating away mid-word must not lose the word. The cleanup runs on
  // unmount, and `pagehide` covers a closed tab or a hard reload, which React
  // never gets to see.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const onHide = () => void flushRef.current();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      void flushRef.current();
    };
  }, []);

  return {
    vehicle: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    /** True when the tenant resolved and the car genuinely is not theirs. */
    notFound: !query.isLoading && !!tenant?.id && query.data === null,
    patch,
    patchNow,
    flush,
    saving,
    lastSavedAt,
    fieldErrors,
    revision,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Photos
 *
 * `vehicle_photos` is the gallery; `vehicles.photo_url` is the cover, which the
 * booking site and every list in the portal read. Making the FIRST photo the
 * cover means "set cover" and "reorder" are the same gesture, and it keeps
 * `photo_url` in step with the gallery instead of drifting to a photo that was
 * deleted months ago.
 * ═════════════════════════════════════════════════════════════════════════ */

export interface VehiclePhoto {
  id: string;
  photo_url: string;
  display_order: number | null;
}

export function useVehiclePhotos(vehicleId: string) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const key = ["vehicle-v2-photos", tenant?.id, vehicleId] as const;

  const { data: photos = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: async (): Promise<VehiclePhoto[]> => {
      if (!tenant?.id) return [];
      const { data, error } = await supabase
        .from("vehicle_photos")
        .select("id, photo_url, display_order")
        .eq("vehicle_id", vehicleId)
        .eq("tenant_id", tenant.id)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data as VehiclePhoto[]) ?? [];
    },
    enabled: !!tenant?.id && !!vehicleId,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: vehicleKey(tenant?.id, vehicleId) });
    queryClient.invalidateQueries({ queryKey: ["vehicles"] });
    // The vehicles list shows the first photo on hover. It is keyed
    // ["vehicles-list", tenantId], which ["vehicles"] does not prefix, so
    // without this a new cover or order showed there only after 60s.
    queryClient.invalidateQueries({ queryKey: ["vehicles-list"] });
  };

  /** Keep `display_order` dense and `photo_url` pointing at whatever is first. */
  const persistOrder = async (ordered: VehiclePhoto[]) => {
    if (!tenant?.id) return;
    await Promise.all(
      ordered.map((p, i) =>
        supabase
          .from("vehicle_photos")
          .update({ display_order: i })
          .eq("id", p.id)
          .eq("tenant_id", tenant.id),
      ),
    );
    await supabase
      .from("vehicles")
      .update({ photo_url: ordered[0]?.photo_url ?? null })
      .eq("id", vehicleId)
      .eq("tenant_id", tenant.id);
  };

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      if (!tenant?.id) throw new Error("No tenant");
      const accepted = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
      const start = photos.length;

      for (const [i, file] of files.entries()) {
        if (!accepted.includes(file.type)) {
          throw new Error(`${file.name} is not a JPG, PNG or WebP.`);
        }
        if (file.size > 10 * 1024 * 1024) {
          throw new Error(`${file.name} is over 10MB.`);
        }
        // Flat object names at the bucket root, exactly as v1's gallery writes
        // them. The delete path below (and v1's) recovers the object name from
        // the LAST segment of the URL, so a nested key would upload fine and
        // then leak the file forever when the row was removed.
        const ext = file.name.split(".").pop() || "jpg";
        const objectName = `${vehicleId}-${Date.now()}-${i}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("vehicle-photos")
          .upload(objectName, file, { cacheControl: "3600" });
        if (upErr) throw upErr;

        const {
          data: { publicUrl },
        } = supabase.storage.from("vehicle-photos").getPublicUrl(objectName);

        const { error: rowErr } = await supabase.from("vehicle_photos").insert({
          vehicle_id: vehicleId,
          tenant_id: tenant.id,
          photo_url: publicUrl,
          display_order: start + i,
        } as never);
        if (rowErr) {
          // Don't leave an orphan in the bucket that nothing points at.
          await supabase.storage.from("vehicle-photos").remove([objectName]);
          throw rowErr;
        }

        // The very first photo becomes the cover, so a car is never listed
        // with a gallery and no thumbnail.
        if (start + i === 0) {
          await supabase
            .from("vehicles")
            .update({ photo_url: publicUrl })
            .eq("id", vehicleId)
            .eq("tenant_id", tenant.id);
        }
      }
    },
    onSuccess: refresh,
    onError: (e: Error) =>
      toast({ title: "Photo not added", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (photoId: string) => {
      if (!tenant?.id) throw new Error("No tenant");
      const doomed = photos.find((p) => p.id === photoId);
      const { error } = await supabase
        .from("vehicle_photos")
        .delete()
        .eq("id", photoId)
        .eq("tenant_id", tenant.id);
      if (error) throw error;

      // Row first, file second. A failed storage delete leaves a stray object;
      // a failed row delete after a successful file delete leaves a gallery
      // entry pointing at a 404, which is the worse of the two.
      if (doomed?.photo_url) {
        const objectName = doomed.photo_url.split("/").pop();
        if (objectName) await supabase.storage.from("vehicle-photos").remove([objectName]);
      }
      await persistOrder(photos.filter((p) => p.id !== photoId));
    },
    onSuccess: refresh,
    onError: (e: Error) =>
      toast({ title: "Photo not removed", description: e.message, variant: "destructive" }),
  });

  const makeCover = useMutation({
    mutationFn: async (photoId: string) => {
      const picked = photos.find((p) => p.id === photoId);
      if (!picked) return;
      await persistOrder([picked, ...photos.filter((p) => p.id !== photoId)]);
    },
    onSuccess: refresh,
    onError: (e: Error) =>
      toast({ title: "Cover not changed", description: e.message, variant: "destructive" }),
  });

  return {
    photos,
    isLoading,
    upload: (files: File[]) => upload.mutate(files),
    remove: (photoId: string) => remove.mutate(photoId),
    makeCover: (photoId: string) => makeCover.mutate(photoId),
    isUploading: upload.isPending,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Rentals & money
 * ═════════════════════════════════════════════════════════════════════════ */

export interface VehicleRental {
  id: string;
  customer_id: string | null;
  customer_name: string;
  start_date: string;
  end_date: string;
  status: string;
  total: number;
}

export function useVehicleRentals(vehicleId: string) {
  const { tenant } = useTenant();

  const { data = [], isLoading } = useQuery({
    queryKey: ["vehicle-v2-rentals", tenant?.id, vehicleId],
    queryFn: async (): Promise<VehicleRental[]> => {
      if (!tenant?.id) return [];
      const { data, error } = await supabase
        .from("rentals")
        .select(
          "id, customer_id, start_date, end_date, status, monthly_amount, customers!rentals_customer_id_fkey(name)",
        )
        .eq("vehicle_id", vehicleId)
        .eq("tenant_id", tenant.id)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return ((data as unknown as Record<string, any>[]) ?? []).map((r) => ({
        id: r.id,
        customer_id: r.customer_id,
        customer_name: r.customers?.name || "Customer removed",
        start_date: r.start_date,
        end_date: r.end_date,
        status: r.status,
        // `monthly_amount` is the rental's agreed amount — the column is
        // misnamed, it carries the figure for the hire whatever its length.
        // What the car actually EARNED is the P&L, not this; see `useVehiclePL`.
        total: Number(r.monthly_amount ?? 0),
      }));
    },
    enabled: !!tenant?.id && !!vehicleId,
  });

  return { rentals: data, isLoading };
}

export interface VehiclePL {
  revenue: number;
  costs: number;
  net: number;
  byCategory: { side: string; category: string; amount: number }[];
}

/**
 * The car's P&L, straight from `pnl_entries`.
 *
 * This is the ledger the rest of the product posts to — rentals, servicing,
 * fines, acquisition, disposal — so it is the honest answer to "is this car
 * ahead?", rather than a sum this screen invents from the fields it happens to
 * show.
 */
export function useVehiclePL(vehicleId: string) {
  const { tenant } = useTenant();

  const { data, isLoading } = useQuery({
    queryKey: ["vehicle-v2-pl", tenant?.id, vehicleId],
    queryFn: async (): Promise<VehiclePL> => {
      const empty: VehiclePL = { revenue: 0, costs: 0, net: 0, byCategory: [] };
      if (!tenant?.id) return empty;
      const { data, error } = await supabase
        .from("pnl_entries")
        .select("side, category, amount")
        .eq("vehicle_id", vehicleId)
        .eq("tenant_id", tenant.id);
      if (error) throw error;

      const rows = (data as unknown as { side: string; category: string; amount: number }[]) ?? [];
      const bucket = new Map<string, { side: string; category: string; amount: number }>();
      let revenue = 0;
      let costs = 0;
      for (const r of rows) {
        const amount = Number(r.amount) || 0;
        if (r.side === "Revenue") revenue += amount;
        else costs += amount;
        const k = `${r.side}:${r.category}`;
        const existing = bucket.get(k);
        if (existing) existing.amount += amount;
        else bucket.set(k, { side: r.side, category: r.category, amount });
      }
      return {
        revenue,
        costs,
        net: revenue - costs,
        byCategory: [...bucket.values()].sort((a, b) => b.amount - a.amount),
      };
    },
    enabled: !!tenant?.id && !!vehicleId,
  });

  return { pl: data ?? { revenue: 0, costs: 0, net: 0, byCategory: [] }, isLoading };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Small derived helpers shared by the shell and the tabs
 * ═════════════════════════════════════════════════════════════════════════ */

export function useVehicleName(vehicle: VehicleRecord | null) {
  return useMemo(
    () =>
      vehicle ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ").trim() : "",
    [vehicle?.year, vehicle?.make, vehicle?.model],
  );
}
