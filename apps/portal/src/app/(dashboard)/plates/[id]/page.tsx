"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Calendar, Hash, Car, FileText, ExternalLink, PoundSterling } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";

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
      <div className="container mx-auto p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-muted rounded w-1/4"></div>
          <div className="h-64 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  if (error || !plate) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-destructive">Plate Not Found</h1>
          <p className="text-muted-foreground mt-2">
            The plate you're looking for doesn't exist or you don't have permission to view it.
          </p>
          <Button onClick={() => router.push("/plates")} className="mt-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Plates
          </Button>
        </div>
      </div>
    );
  }

  const getStatusVariant = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'assigned':
        return 'default';
      case 'available':
        return 'secondary';
      case 'ordered':
        return 'outline';
      default:
        return 'secondary';
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/plates")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Plates
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{plate.plate_number}</h1>
            <p className="text-muted-foreground">
              Plate Details
            </p>
          </div>
        </div>
        <Badge variant={getStatusVariant(plate.status)}>
          {plate.status || 'Unknown'}
        </Badge>
      </div>

      {/* Plate Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Hash className="h-5 w-5" />
            Plate Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <div className="text-sm text-muted-foreground">Plate Number</div>
              <div className="text-xl font-bold">{plate.plate_number}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Status</div>
              <Badge variant={getStatusVariant(plate.status)} className="mt-1">
                {plate.status || 'Unknown'}
              </Badge>
            </div>
            {plate.cost > 0 && (
              <div>
                <div className="text-sm text-muted-foreground">Cost</div>
                <div className="flex items-center gap-1">
                  <PoundSterling className="h-4 w-4 text-muted-foreground" />
                  ${plate.cost.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
              </div>
            )}
            {plate.order_date && (
              <div>
                <div className="text-sm text-muted-foreground">Order Date</div>
                <div className="flex items-center gap-1">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  {formatInTimeZone(new Date(plate.order_date), 'Europe/London', 'dd/MM/yyyy')}
                </div>
              </div>
            )}
          </div>

          {plate.supplier && (
            <div className="mt-4">
              <div className="text-sm text-muted-foreground">Supplier</div>
              <div>{plate.supplier}</div>
            </div>
          )}

          {plate.retention_doc_reference && (
            <div className="mt-4">
              <div className="text-sm text-muted-foreground">Retention Document Reference</div>
              <div className="font-mono text-sm">{plate.retention_doc_reference}</div>
            </div>
          )}

          {plate.notes && (
            <div className="mt-4">
              <div className="text-sm text-muted-foreground">Notes</div>
              <div className="whitespace-pre-wrap">{plate.notes}</div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Assigned Vehicle */}
      {plate.vehicles ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Car className="h-5 w-5" />
              Assigned Vehicle
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Registration</div>
                  <div className="font-medium">{plate.vehicles.reg}</div>
                </div>
                {plate.vehicles.make && (
                  <div>
                    <div className="text-sm text-muted-foreground">Make & Model</div>
                    <div>{plate.vehicles.make} {plate.vehicles.model}</div>
                  </div>
                )}
                {plate.vehicles.status && (
                  <div>
                    <div className="text-sm text-muted-foreground">Vehicle Status</div>
                    <Badge variant="outline">{plate.vehicles.status}</Badge>
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                onClick={() => router.push(`/vehicles/${plate.vehicles!.id}`)}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                View Vehicle Details
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Car className="h-5 w-5" />
              Vehicle Assignment
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8">
              <Car className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">This plate is not currently assigned to any vehicle.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Documents */}
      {(plate.document_name || plate.document_url) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Documents
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {plate.document_name && (
                <div>
                  <div className="text-sm text-muted-foreground">Document Name</div>
                  <div>{plate.document_name}</div>
                </div>
              )}
              {plate.document_url && (
                <Button
                  variant="outline"
                  asChild
                  className="w-full"
                >
                  <a href={plate.document_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    View Document
                  </a>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* System Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Hash className="h-4 w-4" />
            System Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Plate ID:</span>
              <span className="font-mono">{plate.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created:</span>
              <span>{formatInTimeZone(new Date(plate.created_at), 'Europe/London', 'dd/MM/yyyy HH:mm')}</span>
            </div>
            {plate.assigned_vehicle_id && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Assigned Vehicle ID:</span>
                <span className="font-mono">{plate.assigned_vehicle_id}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
