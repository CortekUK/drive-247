"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { EnhancedAddPlateDialog } from "@/components/plates/enhanced-add-plate-dialog";
import { EnhancedAssignPlateDialog } from "@/components/plates/enhanced-assign-plate-dialog";
import { PlateStatusBadge } from "@/components/plates/plate-status-badge";
import { PlateHistoryDrawer } from "@/components/plates/plate-history-drawer";
import { useToast } from "@/hooks/use-toast";
import { 
  Plus, 
  ExternalLink, 
  MoreHorizontal, 
  Edit, 
  History, 
  UserX,
  FileText
} from "lucide-react";
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
  created_at: string;
  updated_at: string;
}

interface EnhancedVehiclePlatesPanelProps {
  vehicleId: string;
  vehicleReg: string;
}

export const EnhancedVehiclePlatesPanel = ({ vehicleId, vehicleReg }: EnhancedVehiclePlatesPanelProps) => {
  const [addPlateOpen, setAddPlateOpen] = useState(false);
  const [assignPlateOpen, setAssignPlateOpen] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [editPlateOpen, setEditPlateOpen] = useState(false);
  const [selectedPlate, setSelectedPlate] = useState<Plate | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  // Fetch plates for this vehicle (current and historical)
  const { data: plates, isLoading, refetch } = useQuery({
    queryKey: ["vehicle-plates", vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plates")
        .select("*")
        .eq("vehicle_id", vehicleId)
        .order("updated_at", { ascending: false });
      
      if (error) throw error;
      return data as Plate[];
    },
    enabled: !!vehicleId,
  });

  // Get current assigned plate
  const currentPlate = plates?.find(p => p.status === 'assigned' || p.status === 'fitted');

  const handleUnassignPlate = async (plate: Plate) => {
    try {
      const { error } = await supabase
        .from("plates")
        .update({ 
          vehicle_id: null, 
          status: 'received',
          updated_at: new Date().toISOString()
        })
        .eq("id", plate.id);

      if (error) throw error;

      // Log event
      await supabase.from("vehicle_events").insert({
        vehicle_id: vehicleId,
        event_type: "expense_added",
        summary: `Plate ${plate.plate_number} unassigned`,
        reference_id: plate.id,
        reference_table: "plates"
      });

      toast({
        title: "Success",
        description: `Plate ${plate.plate_number} unassigned`,
      });

      refetch();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to unassign plate",
        variant: "destructive",
      });
    }
  };

  const handleEditPlate = (plate: Plate) => {
    setSelectedPlate(plate);
    setEditPlateOpen(true);
  };

  const handleViewHistory = (plate: Plate) => {
    setSelectedPlate(plate);
    setHistoryDrawerOpen(true);
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-lg">License Plates</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/plates")}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Manage in Plates
            </Button>
            <Button
              size="sm"
              onClick={() => setAddPlateOpen(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Plate
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="flex items-center justify-between p-3 border rounded animate-pulse">
                  <div className="space-y-1">
                    <div className="h-4 bg-muted rounded w-24" />
                    <div className="h-3 bg-muted rounded w-32" />
                  </div>
                  <div className="h-6 bg-muted rounded w-16" />
                </div>
              ))}
            </div>
          ) : plates && plates.length > 0 ? (
            <>
              {/* Current Plate Highlight */}
              {currentPlate && (
                <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <code className="font-mono font-semibold text-green-800">
                          {currentPlate.plate_number}
                        </code>
                        <Badge className="bg-green-100 text-green-800">
                          Current
                        </Badge>
                      </div>
                      <div className="text-sm text-green-600 mt-1">
                        {currentPlate.supplier && `Supplier: ${currentPlate.supplier}`}
                        {currentPlate.order_date && ` • Ordered: ${format(new Date(currentPlate.order_date), "MM/dd/yyyy")}`}
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEditPlate(currentPlate)}>
                          <Edit className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleViewHistory(currentPlate)}>
                          <History className="h-4 w-4 mr-2" />
                          View History
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleUnassignPlate(currentPlate)}>
                          <UserX className="h-4 w-4 mr-2" />
                          Unassign
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              )}

              {/* All Plates Table */}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plate Number</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Order Date</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead>Document</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plates.map((plate) => (
                    <TableRow key={plate.id}>
                      <TableCell>
                        <code className="font-mono">{plate.plate_number}</code>
                      </TableCell>
                      <TableCell>
                        <PlateStatusBadge status={plate.status} showTooltip />
                      </TableCell>
                      <TableCell>{plate.supplier || "-"}</TableCell>
                      <TableCell>
                        {plate.order_date ? format(new Date(plate.order_date), "MM/dd/yyyy") : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {plate.cost ? `$${Number(plate.cost).toFixed(2)}` : "-"}
                      </TableCell>
                      <TableCell>
                        {plate.document_url ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => window.open(plate.document_url, '_blank')}
                          >
                            <FileText className="h-4 w-4" />
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">None</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEditPlate(plate)}>
                              <Edit className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleViewHistory(plate)}>
                              <History className="h-4 w-4 mr-2" />
                              View History
                            </DropdownMenuItem>
                            {(plate.status === 'assigned' || plate.status === 'fitted') && (
                              <DropdownMenuItem onClick={() => handleUnassignPlate(plate)}>
                                <UserX className="h-4 w-4 mr-2" />
                                Unassign
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <div className="mb-4">No plates assigned to this vehicle</div>
              <Button onClick={() => setAddPlateOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add First Plate
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <EnhancedAddPlateDialog
        open={addPlateOpen}
        onOpenChange={setAddPlateOpen}
        onSuccess={refetch}
        preSelectedVehicleId={vehicleId}
      />
      
      <EnhancedAddPlateDialog
        open={editPlateOpen}
        onOpenChange={setEditPlateOpen}
        onSuccess={refetch}
        editPlate={selectedPlate}
      />

      <EnhancedAssignPlateDialog
        open={assignPlateOpen}
        onOpenChange={setAssignPlateOpen}
        plate={selectedPlate}
        onSuccess={refetch}
      />

      <PlateHistoryDrawer
        open={historyDrawerOpen}
        onOpenChange={setHistoryDrawerOpen}
        plate={selectedPlate}
      />
    </>
  );
};