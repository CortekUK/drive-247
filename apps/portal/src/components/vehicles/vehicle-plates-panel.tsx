"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, ExternalLink, FileText } from "lucide-react";
import { AddPlateDialog } from "@/components/plates/add-plate-dialog";
import { format } from "date-fns";

interface Plate {
  id: string;
  plate_number: string;
  supplier: string;
  order_date: string;
  cost: number;
  status: string;
  retention_doc_reference: string;
  notes: string;
  created_at: string;
}

interface VehiclePlatesPanelProps {
  vehicleId: string;
  vehicleReg: string;
}

const getStatusBadgeVariant = (status: string) => {
  switch (status) {
    case 'ordered':
      return 'secondary';
    case 'received':
      return 'default';
    case 'fitted':
      return 'default';
    default:
      return 'secondary';
  }
};

const getStatusBadgeClass = (status: string) => {
  switch (status) {
    case 'ordered':
      return 'bg-muted text-muted-foreground';
    case 'received':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300';
    case 'fitted':
      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
    default:
      return 'bg-muted text-muted-foreground';
  }
};

export const VehiclePlatesPanel = ({ vehicleId, vehicleReg }: VehiclePlatesPanelProps) => {
  const router = useRouter();
  const [showAddDialog, setShowAddDialog] = useState(false);

  const { data: plates, isLoading, refetch } = useQuery({
    queryKey: ["vehicle-plates", vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plates")
        .select("*")
        .eq("vehicle_id", vehicleId)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data as Plate[];
    },
  });

  const handleManageInPlates = () => {
    router.push(`/plates?vehicle_id=${vehicleId}`);
  };

  if (isLoading) {
    return <div>Loading plates...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Plates for {vehicleReg}
              </CardTitle>
              <CardDescription>
                License plates associated with this vehicle
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleManageInPlates}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Manage in Plates
              </Button>
              <Button onClick={() => setShowAddDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Plate
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {plates && plates.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plate Number</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Order Date</TableHead>
                    <TableHead>Cost</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plates.map((plate) => (
                    <TableRow key={plate.id} className="hover:bg-muted/50">
                      <TableCell className="font-medium">{plate.plate_number}</TableCell>
                      <TableCell>{plate.supplier || "—"}</TableCell>
                      <TableCell>
                        {plate.order_date ? format(new Date(plate.order_date), "MM/dd/yyyy") : "—"}
                      </TableCell>
                      <TableCell>
                        {plate.cost > 0 ? `$${Number(plate.cost).toLocaleString()}` : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={getStatusBadgeVariant(plate.status)}
                          className={getStatusBadgeClass(plate.status)}
                        >
                          {plate.status.charAt(0).toUpperCase() + plate.status.slice(1)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8">
              <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No plates assigned</h3>
              <p className="text-muted-foreground mb-4">
                Add the first plate for this vehicle to get started
              </p>
              <Button onClick={() => setShowAddDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Plate
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AddPlateDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSuccess={() => refetch()}
        preSelectedVehicleId={vehicleId}
      />
    </div>
  );
};