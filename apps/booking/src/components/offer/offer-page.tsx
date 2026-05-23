"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, Car, Calendar } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

interface OfferVehicle {
  vehicleId: string;
  priceOverride?: number;
}

interface VehicleDetail {
  id: string;
  make: string | null;
  model: string | null;
  photo_url: string | null;
  daily_rate: number | null;
  weekly_rate: number | null;
  monthly_rate: number | null;
  category: string | null;
}

interface OfferData {
  id: string;
  shortCode: string;
  leadId: string;
  vehicles: OfferVehicle[];
  customMessage: string | null;
  defaultStartDate: string;
  defaultEndDate: string;
  dateFlexDays: number;
  depositAmount: number | null;
  showPrices: boolean;
  expiresAt: string;
}

interface ViewResponse {
  status: "valid" | "expired" | "not_found";
  offer?: OfferData;
  vehicleDetails?: VehicleDetail[];
}

export function OfferPage({ shortCode }: { shortCode: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [resp, setResp] = useState<ViewResponse | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data } = await supabase.functions.invoke<ViewResponse>("view-offer", {
        body: { shortCode },
      });
      if (cancelled) return;
      setResp(data ?? { status: "not_found" });
      if (data?.status === "valid" && data.offer) {
        setStartDate(data.offer.defaultStartDate);
        setEndDate(data.offer.defaultEndDate);
        setSelectedVehicleId(data.offer.vehicles[0]?.vehicleId ?? null);
      }
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [shortCode]);

  const handleAccept = async () => {
    if (!resp?.offer || !selectedVehicleId) return;
    setAccepting(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ status: string }>("accept-offer", {
        body: { shortCode, vehicleId: selectedVehicleId, startDate, endDate },
      });
      if (error) throw error;
      if (data?.status === "accepted") {
        router.push(`/offer/${shortCode}/accepted`);
        return;
      }
      if (data?.status === "vehicle_unavailable") {
        toast.error("That vehicle was just taken. Please pick another.");
      } else if (data?.status === "expired") {
        toast.error("This offer has expired.");
      } else {
        toast.error("Couldn't accept. Try again.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't accept offer.");
    } finally {
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!resp || resp.status === "not_found") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="rounded-lg border bg-card p-8 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
          <h1 className="mt-3 text-lg font-semibold">Offer not found</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This link may have been mistyped.
          </p>
        </div>
      </main>
    );
  }

  if (resp.status === "expired") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="rounded-lg border bg-card p-8 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-amber-600" />
          <h1 className="mt-3 text-lg font-semibold">This offer has expired</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Reach out to your rental contact for a fresh offer.
          </p>
        </div>
      </main>
    );
  }

  const offer = resp.offer!;
  const details = resp.vehicleDetails ?? [];

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-muted/30 px-4 py-8">
      {offer.customMessage && (
        <div className="mb-5 rounded-lg border bg-card p-4 text-sm text-foreground">
          {offer.customMessage}
        </div>
      )}

      <h1 className="text-2xl font-semibold tracking-tight">Pick your vehicle</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {details.length} option{details.length === 1 ? "" : "s"} for{" "}
        <span className="font-medium">{offer.defaultStartDate}</span> →{" "}
        <span className="font-medium">{offer.defaultEndDate}</span>
      </p>

      <ul className="mt-5 space-y-3">
        {offer.vehicles.map((v) => {
          const detail = details.find((d) => d.id === v.vehicleId);
          if (!detail) return null;
          const isSelected = selectedVehicleId === v.vehicleId;
          const weekly = detail.weekly_rate ?? 0;
          return (
            <li
              key={v.vehicleId}
              className={`cursor-pointer rounded-lg border bg-card p-4 transition-all ${
                isSelected ? "border-primary ring-2 ring-primary/30" : "hover:border-muted-foreground"
              }`}
              onClick={() => setSelectedVehicleId(v.vehicleId)}
            >
              <div className="flex items-start gap-3">
                {detail.photo_url ? (
                  <img
                    src={detail.photo_url}
                    alt=""
                    className="h-20 w-28 shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-28 shrink-0 items-center justify-center rounded bg-muted">
                    <Car className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-base font-medium">
                    {detail.make} {detail.model}
                  </div>
                  {detail.category && (
                    <div className="text-xs text-muted-foreground">{detail.category}</div>
                  )}
                  {offer.showPrices && weekly > 0 && (
                    <div className="mt-1 text-sm font-medium">${weekly}/week</div>
                  )}
                </div>
                <input
                  type="radio"
                  checked={isSelected}
                  onChange={() => setSelectedVehicleId(v.vehicleId)}
                  className="mt-1"
                />
              </div>
            </li>
          );
        })}
      </ul>

      {offer.dateFlexDays > 0 && (
        <div className="mt-6 rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Calendar className="h-4 w-4" /> Adjust dates (±{offer.dateFlexDays} days)
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Pickup</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Return</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
        </div>
      )}

      <Button
        size="lg"
        className="mt-6 w-full"
        onClick={handleAccept}
        disabled={accepting || !selectedVehicleId}
      >
        {accepting ? (
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Confirming…</>
        ) : (
          "Confirm my pick"
        )}
      </Button>

      <p className="mt-3 text-center text-[11px] text-muted-foreground">
        Expires {new Date(offer.expiresAt).toLocaleString()}
      </p>
    </main>
  );
}
