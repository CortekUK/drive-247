import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { RentalAgreement } from "@/hooks/use-rental-agreements";

/**
 * "The signed agreement names a different car."
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * An operator swapped the vehicle on a rental whose agreement had already been
 * signed fourteen hours earlier, then reported the new vehicle as "not
 * populating in the rental agreement". Nothing was broken: a signed document is
 * a record of what the renter actually agreed to, so it does not — and must not
 * — rewrite itself afterwards. The swap was recorded correctly.
 *
 * What was missing was anyone telling them. The v2 stage
 * (rentals-v2/rental-detail/stage-agreement.tsx) computes exactly this drift and
 * raises a banner, but v1 said nothing at all, so the only way to notice was to
 * open the PDF and read the VIN. This is that warning, for the v1 screen.
 *
 * ── WHAT IT WILL AND WILL NOT CLAIM ─────────────────────────────────────────
 *
 * The swap log is authoritative about the car, and the send timestamp decides
 * which swaps count — a swap made BEFORE the document went out is already
 * reflected in it and is not drift. Of the swaps that follow, the first one's
 * `old_vehicle` is the car the document actually named; the rental's current
 * car is the other end. This mirrors the v2 rule rather than re-deriving it, so
 * the two screens cannot disagree about the same rental.
 *
 * If the swap query fails it renders NOTHING. A warning that cannot prove
 * itself is worse than silence here: it would send an operator to re-issue a
 * contract that was never wrong.
 */

type SwapVehicle = { reg: string | null; make: string | null; model: string | null } | null;

type VehicleSwap = {
  id: string;
  created_at: string | null;
  old_vehicle: SwapVehicle;
};

/** Same shape the v2 stage prints, so the two screens name a car identically. */
const carName = (v: SwapVehicle) => {
  if (!v) return "—";
  const name = [v.make, v.model].filter(Boolean).join(" ");
  return name && v.reg ? `${name} · ${v.reg}` : name || v.reg || "—";
};

export interface AgreementVehicleDriftProps {
  rentalId: string | undefined;
  tenantId: string | undefined;
  /** Every agreement on the rental; the newest `original` is the one that counts. */
  agreements: RentalAgreement[];
  /** The rental's CURRENT vehicle. */
  vehicle: { reg?: string | null; make?: string | null; model?: string | null } | null | undefined;
}

export function AgreementVehicleDrift({
  rentalId,
  tenantId,
  agreements,
  vehicle,
}: AgreementVehicleDriftProps) {
  const originals = agreements.filter((a) => a.agreement_type === "original");
  const current = originals.length ? originals[originals.length - 1] : null;

  // An unsent draft cannot have drifted from anything.
  const issuedAt =
    current?.envelope_sent_at ?? current?.envelope_created_at ?? current?.created_at ?? null;

  const { data: swaps } = useQuery({
    queryKey: ["rental-vehicle-swaps-v1", rentalId, tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rental_vehicle_swaps")
        .select("id, created_at, old_vehicle:old_vehicle_id ( reg, make, model )")
        .eq("rental_id", rentalId!)
        .eq("tenant_id", tenantId!)
        .order("created_at", { ascending: true });

      if (error) {
        // Logged, not surfaced — see the note above on refusing to guess.
        console.error("[agreement-vehicle-drift] swaps:", error);
        return [] as VehicleSwap[];
      }
      return (data ?? []) as unknown as VehicleSwap[];
    },
    enabled: !!rentalId && !!tenantId && !!issuedAt,
  });

  if (!current || !issuedAt) return null;

  const after = (swaps ?? []).filter(
    (s) => s.created_at && new Date(s.created_at) > new Date(issuedAt)
  );
  if (!after.length) return null;

  const was = carName(after[0].old_vehicle);
  const now = carName({
    reg: vehicle?.reg ?? null,
    make: vehicle?.make ?? null,
    model: vehicle?.model ?? null,
  });

  // Nothing to say if either end is unknown, or if they are the same car.
  if (was === "—" || now === "—" || was === now) return null;

  const signed =
    current.document_status === "completed" ||
    current.document_status === "signed" ||
    !!current.signed_document_id;

  return (
    <Alert className="border-amber-500/40 bg-amber-50 dark:bg-amber-950/30">
      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
      <AlertDescription className="text-sm text-amber-900 dark:text-amber-200">
        <span className="font-medium">
          This rental&rsquo;s vehicle changed after the agreement was {signed ? "signed" : "sent"}.
        </span>{" "}
        The agreement names <span className="font-medium">{was}</span>, and the rental is now on{" "}
        <span className="font-medium">{now}</span>.{" "}
        {signed
          ? "A signed agreement cannot be edited — it has to stay as the renter signed it. Send a new agreement to put the current vehicle on paper."
          : "Send the agreement again so it goes out with the current vehicle."}
      </AlertDescription>
    </Alert>
  );
}

export default AgreementVehicleDrift;
