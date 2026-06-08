"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowLeft, Calendar, Hash, Car, FileText, ExternalLink } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { formatCurrency } from "@/lib/format-utils";
import { useTenant } from "@/contexts/TenantContext";
import {
  Tile,
  SectionCard,
  StatusPill,
  statusTone,
  Eyebrow,
  Money,
  ErrorState,
  Shimmer,
} from "@/components/bento";

interface PlateDetailData {
  id: string;
  plate_number: string;
  status: string;
  cost: number;
  supplier: string;
  order_date: string;
  retention_doc_reference: string;
  notes: string;
  document_name: string;
  document_url: string;
  created_at: string;
  vehicles?: {
    id: string;
    reg: string;
    make?: string;
    model?: string;
    status?: string;
  };
  assigned_vehicle_id?: string;
}

export default function PlateDetail() {
  const params = useParams();
  const router = useRouter();
  const { tenant } = useTenant();
  const id = params.id as string;

  const { data: plate, isLoading, error } = useQuery({
    queryKey: ["plate-detail", id],
    queryFn: async () => {
      if (!id) throw new Error("Plate ID is required");

      const { data, error } = await supabase
        .from("plates")
        .select(`
          id,
          plate_number,
          status,
          cost,
          supplier,
          order_date,
          retention_doc_reference,
          notes,
          document_name,
          document_url,
          created_at,
          assigned_vehicle_id,
          vehicles!assigned_vehicle_id(
            id,
            reg,
            make,
            model,
            status
          )
        `)
        .eq("id", id)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <Shimmer className="h-8 w-1/4" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Tile key={i} noMotion className="flex flex-col gap-3">
              <Shimmer className="h-3 w-20" />
              <Shimmer className="h-8 w-24" />
            </Tile>
          ))}
        </div>
        <Shimmer className="h-64 w-full rounded-tile" />
      </div>
    );
  }

  if (error || !plate) {
    return (
      <div className="container mx-auto p-6">
        <ErrorState
          title="Plate Not Found"
          description="The plate you're looking for doesn't exist or you don't have permission to view it."
          onRetry={() => router.push("/plates")}
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => router.push("/plates")}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Back to Plates</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight font-mono">{plate.plate_number}</h1>
            <p className="text-muted-foreground text-sm">Plate Details</p>
          </div>
        </div>
        <StatusPill tone={statusTone(plate.status)} dot>
          {plate.status || "Unknown"}
        </StatusPill>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile className="flex flex-col gap-1.5">
          <Eyebrow>Plate Number</Eyebrow>
          <div className="text-xl font-extrabold tracking-tight font-mono tabular-nums">
            {plate.plate_number}
          </div>
        </Tile>
        <Tile className="flex flex-col gap-1.5">
          <Eyebrow>Status</Eyebrow>
          <div className="mt-0.5">
            <StatusPill tone={statusTone(plate.status)}>{plate.status || "Unknown"}</StatusPill>
          </div>
        </Tile>
        {plate.cost > 0 && (
          <Tile className="flex flex-col gap-1.5">
            <Eyebrow>Cost</Eyebrow>
            <Money className="text-xl font-bold">
              {formatCurrency(plate.cost, tenant?.currency_code || "USD")}
            </Money>
          </Tile>
        )}
        {plate.order_date && (
          <Tile className="flex flex-col gap-1.5">
            <Eyebrow>Order Date</Eyebrow>
            <div className="flex items-center gap-1.5 text-sm font-mono tabular-nums">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              {formatInTimeZone(new Date(plate.order_date), "America/New_York", "MM/dd/yyyy")}
            </div>
          </Tile>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: plate info + vehicle */}
        <div className="lg:col-span-2 space-y-6">
          <SectionCard
            icon={<Hash className="h-4 w-4" />}
            title="Plate Information"
            description="Supplier, retention reference and notes"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-1">
              {plate.supplier && (
                <div>
                  <Eyebrow>Supplier</Eyebrow>
                  <div className="mt-1">{plate.supplier}</div>
                </div>
              )}
              {plate.retention_doc_reference && (
                <div>
                  <Eyebrow>Retention Document Reference</Eyebrow>
                  <div className="mt-1 font-mono text-sm tabular-nums">
                    {plate.retention_doc_reference}
                  </div>
                </div>
              )}
            </div>
            {plate.notes && (
              <div className="mt-5">
                <Eyebrow>Notes</Eyebrow>
                <div className="mt-1 whitespace-pre-wrap text-sm text-[color:var(--bento-text-2)]">
                  {plate.notes}
                </div>
              </div>
            )}
            {!plate.supplier && !plate.retention_doc_reference && !plate.notes && (
              <p className="pt-1 text-sm text-muted-foreground">No additional details recorded.</p>
            )}
          </SectionCard>

          {plate.vehicles ? (
            <SectionCard
              icon={<Car className="h-4 w-4" />}
              title="Assigned Vehicle"
              action={
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => router.push(`/vehicles/${plate.vehicles!.id}`)}
                >
                  <ExternalLink className="h-4 w-4" />
                  View Vehicle
                </Button>
              }
            >
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-1">
                <div>
                  <Eyebrow>Registration</Eyebrow>
                  <div className="mt-1 font-mono font-medium tabular-nums">{plate.vehicles.reg}</div>
                </div>
                {plate.vehicles.make && (
                  <div>
                    <Eyebrow>Make &amp; Model</Eyebrow>
                    <div className="mt-1">
                      {plate.vehicles.make} {plate.vehicles.model}
                    </div>
                  </div>
                )}
                {plate.vehicles.status && (
                  <div>
                    <Eyebrow>Vehicle Status</Eyebrow>
                    <div className="mt-1">
                      <StatusPill tone={statusTone(plate.vehicles.status)}>
                        {plate.vehicles.status}
                      </StatusPill>
                    </div>
                  </div>
                )}
              </div>
            </SectionCard>
          ) : (
            <SectionCard icon={<Car className="h-4 w-4" />} title="Vehicle Assignment">
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full [background:var(--bento-tile-2)] text-muted-foreground">
                  <Car className="h-5 w-5" />
                </div>
                <p className="text-sm text-muted-foreground">
                  This plate is not currently assigned to any vehicle.
                </p>
              </div>
            </SectionCard>
          )}
        </div>

        {/* Right: documents + system info */}
        <div className="space-y-6">
          {(plate.document_name || plate.document_url) && (
            <SectionCard icon={<FileText className="h-4 w-4" />} title="Documents">
              <div className="space-y-3 pt-1">
                {plate.document_name && (
                  <div>
                    <Eyebrow>Document Name</Eyebrow>
                    <div className="mt-1 text-sm">{plate.document_name}</div>
                  </div>
                )}
                {plate.document_url && (
                  <Button variant="outline" asChild className="w-full gap-2">
                    <a href={plate.document_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                      View Document
                    </a>
                  </Button>
                )}
              </div>
            </SectionCard>
          )}

          <SectionCard icon={<Hash className="h-4 w-4" />} title="System Information">
            <div className="space-y-2 pt-1 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Plate ID</span>
                <span className="font-mono text-xs tabular-nums truncate">{plate.id}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Created</span>
                <span className="font-mono text-xs tabular-nums">
                  {formatInTimeZone(new Date(plate.created_at), "America/New_York", "MM/dd/yyyy HH:mm")}
                </span>
              </div>
              {plate.assigned_vehicle_id && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Assigned Vehicle ID</span>
                  <span className="font-mono text-xs tabular-nums truncate">
                    {plate.assigned_vehicle_id}
                  </span>
                </div>
              )}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
