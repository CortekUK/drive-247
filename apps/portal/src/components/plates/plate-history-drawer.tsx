import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { History, Car, FileText, Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";

interface Plate {
  id: string;
  plate_number: string;
  supplier?: string;
  order_date?: string;
  cost?: number;
  status: string;
  retention_doc_reference?: string;
  notes?: string;
  document_url?: string;
  vehicle_id?: string;
  created_at: string;
  updated_at: string;
}

interface PlateEvent {
  id: string;
  event_type: string;
  summary: string;
  event_date: string;
  vehicle_id?: string;
  reference_id?: string;
  created_at: string;
}

interface PlateHistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plate: Plate | null;
}

export const PlateHistoryDrawer = ({
  open,
  onOpenChange,
  plate,
}: PlateHistoryDrawerProps) => {
  // Fetch plate events
  const { data: events, isLoading } = useQuery({
    queryKey: ["plate-events", plate?.id],
    queryFn: async () => {
      if (!plate?.id) return [];
      
      const { data, error } = await supabase
        .from("vehicle_events")
        .select("*")
        .eq("reference_id", plate.id)
        .eq("reference_table", "plates")
        .order("event_date", { ascending: false });
      
      if (error) throw error;
      return data as PlateEvent[];
    },
    enabled: !!plate?.id && open,
  });

  // Fetch current vehicle info if assigned
  const { data: currentVehicle } = useQuery({
    queryKey: ["vehicle", plate?.vehicle_id],
    queryFn: async () => {
      if (!plate?.vehicle_id) return null;
      
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, reg, make, model")
        .eq("id", plate.vehicle_id)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!plate?.vehicle_id && open,
  });

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case 'plate_created':
        return <Plus className="h-4 w-4 text-green-600" />;
      case 'plate_assigned':
        return <Car className="h-4 w-4 text-blue-600" />;
      case 'plate_unassigned':
        return <Car className="h-4 w-4 text-gray-600" />;
      case 'document_uploaded':
        return <FileText className="h-4 w-4 text-purple-600" />;
      case 'plate_deleted':
        return <Trash2 className="h-4 w-4 text-red-600" />;
      default:
        return <History className="h-4 w-4 text-gray-600" />;
    }
  };

  if (!plate) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[600px] sm:w-[600px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Plate History - {plate.plate_number}
          </SheetTitle>
          <SheetDescription>
            Complete timeline of all changes and assignments for this plate
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Current Status */}
          <div className="rounded-lg border bg-card p-4">
            <h3 className="font-semibold mb-3">Current Status</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Status:</span>
                <Badge variant="secondary" className="ml-2">
                  {plate.status}
                </Badge>
              </div>
              <div>
                <span className="text-muted-foreground">Vehicle:</span>
                <span className="ml-2">
                  {currentVehicle ? (
                    <Badge variant="outline">
                      {currentVehicle.reg}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">Not Assigned</span>
                  )}
                </span>
              </div>
              {plate.supplier && (
                <div>
                  <span className="text-muted-foreground">Supplier:</span>
                  <span className="ml-2">{plate.supplier}</span>
                </div>
              )}
              {plate.cost && (
                <div>
                  <span className="text-muted-foreground">Cost:</span>
                  <span className="ml-2">${Number(plate.cost).toFixed(2)}</span>
                </div>
              )}
              {plate.order_date && (
                <div>
                  <span className="text-muted-foreground">Order Date:</span>
                  <span className="ml-2">
                    {format(new Date(plate.order_date), "MM/dd/yyyy")}
                  </span>
                </div>
              )}
              {plate.retention_doc_reference && (
                <div>
                  <span className="text-muted-foreground">Retention Ref:</span>
                  <span className="ml-2">{plate.retention_doc_reference}</span>
                </div>
              )}
            </div>
            {plate.notes && (
              <div className="mt-3 pt-3 border-t">
                <span className="text-muted-foreground text-sm">Notes:</span>
                <p className="text-sm mt-1">{plate.notes}</p>
              </div>
            )}
          </div>

          <Separator />

          {/* Event Timeline */}
          <div>
            <h3 className="font-semibold mb-4">Timeline</h3>
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-muted rounded-full animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-muted rounded animate-pulse" />
                      <div className="h-3 bg-muted rounded w-1/2 animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            ) : events && events.length > 0 ? (
              <div className="space-y-4">
                {events.map((event) => (
                  <div key={event.id} className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-muted rounded-full flex items-center justify-center">
                      {getEventIcon(event.event_type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">{event.summary}</p>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(event.event_date), "MM/dd/yyyy HH:mm")}
                        </span>
                      </div>
                      {event.vehicle_id && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Vehicle ID: {event.vehicle_id}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No history events found for this plate</p>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};