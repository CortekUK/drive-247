"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { useTenant } from "@/contexts/TenantContext";
import { PlateStatusBadge } from "@/components/plates/plate-status-badge";
import { PlateHistoryDrawer } from "@/components/plates/plate-history-drawer";
import { EnhancedAddPlateDialog } from "@/components/plates/enhanced-add-plate-dialog";
import { EnhancedAssignPlateDialog } from "@/components/plates/enhanced-assign-plate-dialog";
import {
  Plus,
  Search,
  MoreHorizontal,
  Car,
  Edit,
  History,
  UserX,
  Clock,
  Trash2,
  FileText,
  Download,
  Copy,
  Filter,
  X
} from "lucide-react";
import { format } from "date-fns";

interface Plate {
  id: string;
  plate_number: string;
  vehicle_id?: string;
  supplier?: string;
  order_date?: string;
  cost?: number;
  status: string;
  retention_doc_reference?: string;
  notes?: string;
  document_url?: string;
  document_name?: string;
  created_at: string;
  updated_at: string;
  vehicles?: {
    id: string;
    reg: string;
    make: string;
    model: string;
  };
}

// Helper function to get filename from document URL
const getDocumentFilename = (url: string | undefined, name: string | undefined): string => {
  if (name) return name;
  if (!url) return 'Document';

  try {
    const urlPath = url.split('/').pop();
    return urlPath || 'Document';
  } catch {
    return 'Document';
  }
};

export default function PlatesListEnhanced() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const { tenant } = useTenant();

  // UI State
  const [addPlateOpen, setAddPlateOpen] = useState(false);
  const [assignPlateOpen, setAssignPlateOpen] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [editPlateOpen, setEditPlateOpen] = useState(false);
  const [selectedPlate, setSelectedPlate] = useState<Plate | null>(null);

  // Filter State from URL
  const searchTerm = searchParams.get("search") || "";
  const statusFilter = searchParams.get("status") || "all";
  const documentFilter = searchParams.get("documents") || "all";
  const currentPage = parseInt(searchParams.get("page") || "1");
  const pageSize = parseInt(searchParams.get("size") || "50");

  // Debounced search
  const debouncedSearch = useDebounce(searchTerm, 300);

  // Update URL params
  const updateFilters = (updates: Record<string, string | number>) => {
    const newParams = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value === "" || value === "all" || value === 1) {
        newParams.delete(key);
      } else {
        newParams.set(key, value.toString());
      }
    });
    router.push(`?${newParams.toString()}`);
  };

  // Fetch plates data
  const { data: plates, isLoading, refetch } = useQuery({
    queryKey: ["plates-enhanced", tenant?.id, debouncedSearch, statusFilter, documentFilter],
    queryFn: async () => {
      let query = supabase
        .from("plates")
        .select(`
          *,
          vehicles!plates_vehicle_id_fkey (
            id,
            reg,
            make,
            model
          )
        `)
        .order("created_at", { ascending: false });

      // Filter by tenant
      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      // Apply filters
      if (debouncedSearch) {
        query = query.or(`plate_number.ilike.%${debouncedSearch}%,supplier.ilike.%${debouncedSearch}%,retention_doc_reference.ilike.%${debouncedSearch}%,vehicles.reg.ilike.%${debouncedSearch}%`);
      }

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      if (documentFilter === "yes") {
        query = query.not("document_url", "is", null);
      } else if (documentFilter === "no") {
        query = query.is("document_url", null);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as any;
    },
  });

  // Paginated and filtered data
  const { paginatedPlates, totalCount } = useMemo(() => {
    if (!plates) return { paginatedPlates: [], totalCount: 0 };

    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;

    return {
      paginatedPlates: plates.slice(startIndex, endIndex),
      totalCount: plates.length
    };
  }, [plates, currentPage, pageSize]);

  const totalPages = Math.ceil(totalCount / pageSize);

  // Handlers
  const handleSearch = (value: string) => {
    updateFilters({ search: value, page: 1 });
  };

  const handleStatusFilter = (value: string) => {
    updateFilters({ status: value, page: 1 });
  };

  const handleDocumentFilter = (value: string) => {
    updateFilters({ documents: value, page: 1 });
  };

  const clearFilters = () => {
    router.push('/plates');
  };

  const hasActiveFilters = searchTerm || statusFilter !== "all" || documentFilter !== "all";

  const handleAssignPlate = (plate: Plate) => {
    setSelectedPlate(plate);
    setAssignPlateOpen(true);
  };

  const handleUnassignPlate = async (plate: Plate) => {
    try {
      let query = supabase
        .from("plates")
        .update({
          vehicle_id: null,
          status: 'received',
          updated_at: new Date().toISOString()
        })
        .eq("id", plate.id);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { error } = await query;

      if (error) throw error;

      // Log event
      if (plate.vehicle_id) {
        await supabase.from("vehicle_events").insert({
          vehicle_id: plate.vehicle_id,
          event_type: "expense_added",
          summary: `Plate ${plate.plate_number} unassigned`,
          reference_id: plate.id,
          reference_table: "plates",
          tenant_id: tenant?.id || null,
        });
      }

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

  const handleMarkExpired = async (plate: Plate) => {
    try {
      let query = supabase
        .from("plates")
        .update({
          status: 'expired',
          updated_at: new Date().toISOString()
        })
        .eq("id", plate.id);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { error } = await query;

      if (error) throw error;

      // Log event
      if (plate.vehicle_id) {
        await supabase.from("vehicle_events").insert({
          vehicle_id: plate.vehicle_id,
          event_type: "expense_added",
          summary: `Plate ${plate.plate_number} marked as expired`,
          reference_id: plate.id,
          reference_table: "plates",
          tenant_id: tenant?.id || null,
        });
      }

      toast({
        title: "Success",
        description: `Plate ${plate.plate_number} marked as expired`,
      });

      refetch();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update plate status",
        variant: "destructive",
      });
    }
  };

  const handleDeletePlate = async (plate: Plate) => {
    if (plate.vehicle_id) {
      toast({
        title: "Cannot Delete",
        description: "Cannot delete an assigned plate. Unassign it first.",
        variant: "destructive",
      });
      return;
    }

    try {
      let query = supabase
        .from("plates")
        .delete()
        .eq("id", plate.id);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { error } = await query;

      if (error) throw error;

      toast({
        title: "Success",
        description: `Plate ${plate.plate_number} deleted`,
      });

      refetch();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete plate",
        variant: "destructive",
      });
    }
  };

  const copyPlateNumber = (plateNumber: string) => {
    navigator.clipboard.writeText(plateNumber);
    toast({
      title: "Copied",
      description: "Plate number copied to clipboard",
    });
  };

  const handleEditPlate = (plate: Plate) => {
    setSelectedPlate(plate);
    setEditPlateOpen(true);
  };

  const handleViewHistory = (plate: Plate) => {
    setSelectedPlate(plate);
    setHistoryDrawerOpen(true);
  };

  const exportToCSV = () => {
    if (!plates || plates.length === 0) {
      toast({
        title: "No Data",
        description: "No plates to export",
        variant: "destructive",
      });
      return;
    }

    const csvData = plates.map(plate => ({
      'Plate Number': plate.plate_number,
      'Vehicle': plate.vehicles?.reg || 'Not Assigned',
      'Supplier': plate.supplier || '',
      'Order Date': plate.order_date ? format(new Date(plate.order_date), 'MM/dd/yyyy') : '',
      'Cost': plate.cost || '',
      'Status': plate.status,
      'Retention Ref': plate.retention_doc_reference || '',
      'Notes': plate.notes || '',
      'Has Document': plate.document_url ? 'Yes' : 'No',
      'Created': format(new Date(plate.created_at), 'MM/dd/yyyy')
    }));

    const csvContent = [
      Object.keys(csvData[0]).join(','),
      ...csvData.map(row => Object.values(row).map(val => `"${val}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `plates-export-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    toast({
      title: "Success",
      description: "Plates exported to CSV",
    });
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Plates Management</h1>
          <p className="text-muted-foreground">
            Manage license plates, assignments, and documentation
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={exportToCSV}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <Button onClick={() => setAddPlateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Plate
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search plates, vehicles, suppliers..."
                value={searchTerm}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={handleStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="ordered">Ordered</SelectItem>
                <SelectItem value="received">Received</SelectItem>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="fitted">Fitted (Legacy)</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
              </SelectContent>
            </Select>
            <Select value={documentFilter} onValueChange={handleDocumentFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Documents" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Documents</SelectItem>
                <SelectItem value="yes">Has Document</SelectItem>
                <SelectItem value="no">No Document</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-sm text-muted-foreground flex items-center">
              Showing {paginatedPlates.length} of {totalCount} plates
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plate Number</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Order Date</TableHead>
                <TableHead className="text-left">Cost</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Document</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(pageSize)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                  </TableRow>
                ))
              ) : paginatedPlates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-12">
                    <div className="text-muted-foreground">
                      {hasActiveFilters ? (
                        <>
                          No plates match your filters.{" "}
                          <Button variant="link" onClick={clearFilters} className="p-0">
                            Clear filters
                          </Button>
                        </>
                      ) : (
                        <>
                          No plates found.{" "}
                          <Button variant="link" onClick={() => setAddPlateOpen(true)} className="p-0">
                            Add your first plate
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedPlates.map((plate) => (
                  <TableRow key={plate.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <code
                          className="font-mono cursor-pointer hover:bg-muted px-1 rounded"
                          onClick={() => copyPlateNumber(plate.plate_number)}
                          title="Click to copy"
                        >
                          {plate.plate_number}
                        </code>
                        <Copy className="h-3 w-3 text-muted-foreground" />
                      </div>
                    </TableCell>
                    <TableCell>
                      {plate.vehicles ? (
                        <Button
                          variant="link"
                          className="p-0 h-auto"
                          onClick={() => router.push(`/vehicles/${plate.vehicles?.id}`)}
                        >
                          {plate.vehicles.reg}
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">Not Assigned</span>
                      )}
                    </TableCell>
                    <TableCell>{plate.supplier || "-"}</TableCell>
                    <TableCell>
                      {plate.order_date ? format(new Date(plate.order_date), "MM/dd/yyyy") : "-"}
                    </TableCell>
                    <TableCell className="text-left">
                      {plate.cost ? `$${Number(plate.cost).toFixed(2)}` : "-"}
                    </TableCell>
                    <TableCell>
                      <PlateStatusBadge status={plate.status} showTooltip />
                    </TableCell>
                    <TableCell>
                      <div className="max-w-32 truncate" title={plate.notes || ""}>
                        {plate.notes || "-"}
                      </div>
                    </TableCell>
                    <TableCell>
                      {plate.document_url ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => window.open(plate.document_url, '_blank')}
                          title={getDocumentFilename(plate.document_url, plate.document_name)}
                        >
                          <FileText className="h-4 w-4 mr-1" />
                          <span className="text-xs hidden md:inline">
                            {plate.document_name ?
                              (plate.document_name.length > 15 ?
                                plate.document_name.substring(0, 15) + '...' :
                                plate.document_name
                              ) :
                              'View'
                            }
                          </span>
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
                          <DropdownMenuSeparator />
                          {!plate.vehicle_id ? (
                            <DropdownMenuItem onClick={() => handleAssignPlate(plate)}>
                              <Car className="h-4 w-4 mr-2" />
                              Assign
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => handleUnassignPlate(plate)}>
                              <UserX className="h-4 w-4 mr-2" />
                              Unassign
                            </DropdownMenuItem>
                          )}
                          {plate.status !== 'expired' && (
                            <DropdownMenuItem onClick={() => handleMarkExpired(plate)}>
                              <Clock className="h-4 w-4 mr-2" />
                              Mark Expired
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleDeletePlate(plate)}
                            className="text-destructive"
                            disabled={!!plate.vehicle_id}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={currentPage === 1}
              onClick={() => updateFilters({ page: currentPage - 1 })}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={currentPage === totalPages}
              onClick={() => updateFilters({ page: currentPage + 1 })}
            >
              Next
            </Button>
            <Select
              value={pageSize.toString()}
              onValueChange={(value) => updateFilters({ size: parseInt(value), page: 1 })}
            >
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Dialogs */}
      <EnhancedAddPlateDialog
        open={addPlateOpen}
        onOpenChange={setAddPlateOpen}
        onSuccess={refetch}
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
    </div>
  );
}
