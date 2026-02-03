"use client";

import { useState, useMemo, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronLeft, Car, FileText, DollarSign, Wrench, Calendar, TrendingUp, TrendingDown, Plus, Shield, Clock, Trash2, Receipt, Users, Eye, EyeOff, Pencil, Ban, Upload } from "lucide-react";
import { getContractTotal } from "@/lib/vehicle-utils";
import { format } from "date-fns";
import { startOfMonth, endOfMonth, parseISO } from "date-fns";
import { AcquisitionBadge } from "@/components/vehicles/acquisition-badge";
import { MOTTaxStatusChip } from "@/components/vehicles/mot-tax-status-chip";
import { WarrantyStatusChip } from "@/components/vehicles/warranty-status-chip";
import { ServicePlanChip } from "@/components/vehicles/service-plan-chip";
import { SpareKeyChip } from "@/components/vehicles/spare-key-chip";
import { MetricCard, MetricItem, MetricDivider } from "@/components/vehicles/metric-card";
import { VehicleStatusBadge } from "@/components/vehicles/vehicle-status-badge";
import { EmptyState } from "@/components/shared/data-display/empty-state";
import { TruncatedCell } from "@/components/shared/data-display/truncated-cell";
import { useVehicleServices } from "@/hooks/use-vehicle-services";
import { useVehicleFiles } from "@/hooks/use-vehicle-files";
import { AddServiceRecordDialog } from "@/components/vehicles/add-service-record-dialog";
import { EditVehicleDialogEnhanced as EditVehicleDialog } from "@/components/vehicles/edit-vehicle-dialog-enhanced";
import { VehicleFileUpload } from "@/components/vehicles/vehicle-file-upload";
import { VehicleDisposalDialog } from "@/components/vehicles/vehicle-disposal-dialog";
import { VehicleUndoDisposalDialog } from "@/components/vehicles/vehicle-undo-disposal-dialog";
import { AddFineDialog } from "@/components/shared/dialogs/add-fine-dialog";
import { DateRangeFilter } from "@/components/vehicles/date-range-filter";
import { PLBreadcrumb } from "@/components/shared/data-display/pl-breadcrumb";
import { VehiclePhotoGallery } from "@/components/vehicles/vehicle-photo-gallery";
import { BlockedDatesManager } from "@/components/blocked-dates/blocked-dates-manager";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuditLog } from "@/hooks/use-audit-log";

interface Vehicle {
  id: string;
  reg: string;
  make: string;
  model: string;
  year?: number;
  colour: string;
  fuel_type?: string;
  status: string;
  purchase_price: number;
  acquisition_date: string;
  acquisition_type: string;
  created_at: string;
  // Finance fields
  monthly_payment?: number;
  initial_payment?: number;
  term_months?: number;
  balloon?: number;
  finance_start_date?: string;
  // Rent fields
  daily_rent?: number;
  weekly_rent?: number;
  monthly_rent?: number;
  // Mileage allowance
  allowed_mileage?: number | null;
  // MOT & TAX fields
  mot_due_date?: string;
  tax_due_date?: string;
  // Warranty fields
  warranty_start_date?: string;
  warranty_end_date?: string;
  // Service fields
  last_service_date?: string;
  last_service_mileage?: number;
  // Security fields
  has_ghost?: boolean;
  ghost_code?: string;
  has_tracker?: boolean;
  has_remote_immobiliser?: boolean;
  security_notes?: string;
  // Logbook field
  has_logbook?: boolean;
  // Service plan and spare key fields
  has_service_plan?: boolean;
  has_spare_key?: boolean;
  spare_key_holder?: string | null;
  spare_key_notes?: string | null;
  // Disposal fields
  is_disposed?: boolean;
  disposal_date?: string;
  sale_proceeds?: number;
  disposal_buyer?: string;
  disposal_notes?: string;
  // Photo field
  photo_url?: string;
  vehicle_photos?: any[];
  // Description field
  description?: string;
  // VIN field
  vin?: string;
}

interface PLEntry {
  id: string;
  entry_date: string;
  side: string;
  category: string;
  amount: number;
  source_ref: string;
}

interface Rental {
  id: string;
  customer_id: string;
  start_date: string;
  end_date: string;
  monthly_amount: number;
  status: string;
  customers: {
    name: string;
  };
}

export default function VehicleDetail() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { logAction } = useAuditLog();
  const [showAddFineDialog, setShowAddFineDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDisposeDialog, setShowDisposeDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get date filtering from URL params
  const monthParam = searchParams.get('month');
  const selectedMonth = monthParam;
  const fromMonthlyDrilldown = searchParams.get('from') === 'monthly';

  // Parse month parameter if present (format: YYYY-MM)
  const dateFilter = useMemo(() => {
    if (monthParam) {
      const monthDate = parseISO(`${monthParam}-01`);
      return {
        startDate: startOfMonth(monthDate),
        endDate: endOfMonth(monthDate)
      };
    }
    return null;
  }, [monthParam]);

  // Service management hook
  const {
    serviceRecords,
    isLoading: isLoadingServices,
    addService,
    editService,
    deleteService,
    isAdding: isAddingService,
    isEditing: isEditingService,
    isDeleting: isDeletingService,
  } = useVehicleServices(id!);

  // Files management hook
  const {
    files,
    isLoading: isLoadingFiles,
    uploadFile,
    deleteFile,
    downloadFile,
    isUploading: isUploadingFile,
    isDeleting: isDeletingFile,
  } = useVehicleFiles(id!);

  // Fetch vehicle details
  const { data: vehicle, isLoading: vehicleLoading } = useQuery({
    queryKey: ["vehicle", id],
    queryFn: async () => {
      if (!id) throw new Error("Vehicle ID required");
      const { data, error } = await supabase
        .from("vehicles")
        .select(`
          *,
          vehicle_photos(id, photo_url, display_order)
        `)
        .eq("id", id)
        .single();

      if (error) throw error;

      // Debug logging
      console.log('Vehicle data from database:', data);
      console.log('Finance fields:', {
        acquisition_type: data?.acquisition_type,
        initial_payment: data?.initial_payment,
        monthly_payment: data?.monthly_payment,
        term_months: data?.term_months,
        balloon: data?.balloon
      });

      return data as unknown as Vehicle;
    },
    enabled: !!id,
  });

  // Fetch P&L entries with optional date filtering
  const { data: plEntries } = useQuery({
    queryKey: ["plEntries", id, dateFilter?.startDate, dateFilter?.endDate],
    queryFn: async () => {
      if (!id) return [];

      let query = supabase
        .from("pnl_entries")
        .select("*")
        .eq("vehicle_id", id);

      // Apply date filtering if present
      if (dateFilter?.startDate) {
        query = query.gte("entry_date", dateFilter.startDate.toISOString().split('T')[0]);
      }
      if (dateFilter?.endDate) {
        query = query.lte("entry_date", dateFilter.endDate.toISOString().split('T')[0]);
      }

      const { data, error } = await query.order("entry_date", { ascending: false });

      if (error) throw error;
      return data as PLEntry[];
    },
    enabled: !!id,
  });

  // Fetch rentals
  const { data: rentals } = useQuery({
    queryKey: ["vehicle-rentals", id],
    queryFn: async () => {
      if (!id) return [];
      const { data, error } = await supabase
        .from("rentals")
        .select(`
          *,
          customers!rentals_customer_id_fkey(name)
        `)
        .eq("vehicle_id", id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Rental[];
    },
    enabled: !!id,
  });

  // Fetch fines
  const { data: fines } = useQuery({
    queryKey: ["vehicle-fines", id],
    queryFn: async () => {
      if (!id) return [];
      const { data, error } = await supabase
        .from("fines")
        .select(`
          *,
          customers!fines_customer_id_fkey(name)
        `)
        .eq("vehicle_id", id)
        .order("issue_date", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Calculate P&L summary
  const plSummary = plEntries?.reduce(
    (acc, entry) => {
      const amount = Number(entry.amount);
      if (entry.side === 'Revenue') {
        acc.totalRevenue += amount;
        if (entry.category === 'Rental') acc.revenue_rental += amount;
        if (entry.category === 'Initial Fees') acc.revenue_initial_fees += amount;
        if (entry.category === 'Disposal') acc.revenue_disposal += amount;
        if (entry.category === 'Other') acc.revenue_other += amount;
      } else if (entry.side === 'Cost') {
        acc.totalCosts += amount;
        if (entry.category === 'Acquisition') acc.cost_acquisition += amount;
        if (entry.category === 'Service') acc.cost_service += amount;
        if (entry.category === 'Fines') acc.cost_fines += amount;
        if (entry.category === 'Plates') acc.cost_plates += amount;
        if (entry.category === 'Disposal') acc.cost_disposal += amount;
        if (entry.category === 'Other') acc.cost_other += amount;
      }
      return acc;
    },
    {
      totalRevenue: 0,
      revenue_rental: 0,
      revenue_initial_fees: 0,
      revenue_disposal: 0,
      revenue_other: 0,
      totalCosts: 0,
      cost_acquisition: 0,
      cost_service: 0,
      cost_plates: 0,
      cost_fines: 0,
      cost_disposal: 0,
      cost_other: 0,
    }
  ) || {
    totalRevenue: 0,
    revenue_rental: 0,
    revenue_initial_fees: 0,
    revenue_disposal: 0,
    revenue_other: 0,
    totalCosts: 0,
    cost_acquisition: 0,
    cost_service: 0,
    cost_plates: 0,
    cost_fines: 0,
    cost_disposal: 0,
    cost_other: 0,
  };

  const netProfit = plSummary.totalRevenue - plSummary.totalCosts;

  // Context-aware back navigation
  const getBackLink = () => {
    if (selectedMonth && fromMonthlyDrilldown) {
      return `/pl-dashboard/monthly/${selectedMonth}`;
    }
    if (selectedMonth) {
      return `/pl-dashboard/monthly/${selectedMonth}`;
    }
    return '/vehicles';
  };

  const getBackLabel = () => {
    if (selectedMonth && fromMonthlyDrilldown) {
      return `Back to ${format(new Date(selectedMonth + '-01'), 'MMMM yyyy')}`;
    }
    if (selectedMonth) {
      return `Back to ${format(new Date(selectedMonth + '-01'), 'MMMM yyyy')}`;
    }
    return 'Back to Vehicles';
  };

  // Breadcrumb items
  const getBreadcrumbItems = () => {
    const items = [];

    if (selectedMonth) {
      items.push(
        { label: "Global P&L Dashboard", href: "/pl-dashboard" },
        { label: format(new Date(selectedMonth + '-01'), 'MMMM yyyy'), href: `/pl-dashboard/monthly/${selectedMonth}` }
      );
    }

    items.push({
      label: `${vehicle?.reg} (${vehicle?.make} ${vehicle?.model})`,
      current: true
    });

    return items;
  };

  if (vehicleLoading) {
    return <div>Loading vehicle details...</div>;
  }

  if (!vehicle) {
    return <div>Vehicle not found</div>;
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {selectedMonth && <PLBreadcrumb items={getBreadcrumbItems()} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => router.push(getBackLink())}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{getBackLabel()}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <div>
            <h1 className="text-3xl font-bold">{vehicle.reg}</h1>
            <p className="text-muted-foreground">
              {vehicle.make} {vehicle.model} • {vehicle.colour}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <VehicleStatusBadge status={vehicle.status} showTooltip />
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowEditDialog(true)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Edit Vehicle</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {!vehicle.is_disposed && (
            <>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setShowDisposeDialog(true)}
                    >
                      <Ban className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Dispose Vehicle</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setShowDeleteDialog(true)}
                      disabled={rentals && rentals.some(r => r.status === 'Active')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{rentals && rentals.some(r => r.status === 'Active') ? 'Cannot delete (active rentals)' : 'Delete Vehicle'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="mt-6">
          {/* Vehicle Photo Gallery Section */}
          <div className="mb-6">
            <VehiclePhotoGallery
              vehicleId={vehicle.id}
              vehicleReg={vehicle.reg}
              fallbackPhotoUrl={vehicle.photo_url}
            />
          </div>

          {/* Vehicle Details Section */}
          <div className="mt-6">
            <Card className="shadow-card rounded-lg">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Car className="h-5 w-5" />
                  Vehicle Details
                </CardTitle>
                <CardDescription>Basic vehicle information and specifications</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
            {/* Basic Information */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                <Car className="h-4 w-4" />
                Basic Information
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-8 gap-y-3">
                <MetricItem label="Registration" value={vehicle.reg} />
                {vehicle.vin && <MetricItem label="VIN" value={vehicle.vin} />}
                <MetricItem label="Make" value={vehicle.make} />
                <MetricItem label="Model" value={vehicle.model} />
                {vehicle.year && <MetricItem label="Year" value={vehicle.year} />}
                <MetricItem label="Color" value={vehicle.colour} />
                {vehicle.fuel_type && <MetricItem label="Fuel Type" value={vehicle.fuel_type === 'Petrol' ? 'Gas' : vehicle.fuel_type} />}
                <MetricItem
                  label="Allowed Mileage"
                  value={vehicle.allowed_mileage ? `${vehicle.allowed_mileage.toLocaleString()} mi/month` : 'Unlimited'}
                />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Acquisition:</span>
                  <AcquisitionBadge acquisitionType={vehicle.acquisition_type} />
                </div>
              </div>
              {vehicle.description && (
                <div className="col-span-full">
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground mb-1">Description</span>
                    <p className="text-sm whitespace-pre-wrap">{vehicle.description}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Finance Information - Only show for financed vehicles */}
            {vehicle.acquisition_type === 'Finance' && (
              <>
                <MetricDivider />
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Finance Information
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-8 gap-y-3">
                    {vehicle.monthly_payment && (
                      <MetricItem label="Monthly Payment" value={Number(vehicle.monthly_payment)} isAmount />
                    )}
                    {vehicle.initial_payment && vehicle.initial_payment > 0 && (
                      <MetricItem label="Initial Payment" value={Number(vehicle.initial_payment)} isAmount />
                    )}
                    {vehicle.term_months && (
                      <MetricItem label="Term" value={`${vehicle.term_months} months`} />
                    )}
                    {vehicle.balloon && vehicle.balloon > 0 && (
                      <MetricItem label="Balloon Payment" value={Number(vehicle.balloon)} isAmount />
                    )}
                    {vehicle.finance_start_date && (
                      <MetricItem label="Finance Start" value={format(new Date(vehicle.finance_start_date), "dd/MM/yyyy")} />
                    )}
                    <MetricItem
                      label="Contract Total"
                      value={getContractTotal(vehicle)}
                      isAmount
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">
                    Finance costs are recorded upfront in P&L when vehicle is added
                  </p>
                </div>
              </>
            )}

          </div>
              </CardContent>
            </Card>
          </div>

          {/* P&L Summary Section */}
          <div className="mt-8">
            <Card className="shadow-card rounded-lg">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg font-semibold flex items-center gap-2">
                      <TrendingUp className="h-5 w-5" />
                      P&L Summary
                    </CardTitle>
                    <CardDescription>Financial performance overview</CardDescription>
                  </div>
                  <Badge
                    variant={netProfit >= 0 ? "default" : "destructive"}
                    className="text-sm"
                  >
                    {netProfit >= 0 ? "Profitable" : "Loss"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <MetricCard title="Total Revenue" icon={TrendingUp}>
                    <div className="space-y-2">
                      <div className="text-3xl font-bold text-emerald-600">
                        ${plSummary.totalRevenue.toLocaleString()}
                      </div>
                      <p className="text-xs text-muted-foreground">All rental income</p>
                    </div>
                  </MetricCard>

                  <MetricCard title="Total Costs" icon={Receipt}>
                    <div className="space-y-2">
                      <div className="text-3xl font-bold text-orange-600">
                        ${plSummary.totalCosts.toLocaleString()}
                      </div>
                      <p className="text-xs text-muted-foreground">All vehicle expenses</p>
                    </div>
                  </MetricCard>

                  <MetricCard title="Net Profit" icon={TrendingUp}>
                    <div className="space-y-2">
                      <div className={`text-3xl font-bold ${netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        ${Math.abs(netProfit).toLocaleString()}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {netProfit >= 0 ? 'Total profit' : 'Total loss'}
                      </p>
                    </div>
                  </MetricCard>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Services Section */}
          <div className="mt-8">
            <Card className="shadow-card rounded-lg">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg font-semibold flex items-center gap-2">
                      <Wrench className="h-5 w-5" />
                      Service History
                    </CardTitle>
                    <CardDescription>Maintenance and service records</CardDescription>
                  </div>
                  <AddServiceRecordDialog
                    onSubmit={addService}
                    isLoading={isAddingService}
                  />
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingServices ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>Loading service records...</p>
                  </div>
                ) : serviceRecords && serviceRecords.length > 0 ? (
                  <div className="h-[300px] overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Mileage</TableHead>
                          <TableHead className="text-right">Cost</TableHead>
                          <TableHead>Notes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {serviceRecords.map((service) => (
                          <TableRow key={service.id} className="hover:bg-muted/50">
                            <TableCell className="whitespace-nowrap">
                              {format(new Date(service.service_date), "dd/MM/yyyy")}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{service.service_type}</Badge>
                            </TableCell>
                            <TableCell>{service.mileage?.toLocaleString() || '-'}</TableCell>
                            <TableCell className="text-right font-medium">
                              ${service.cost.toLocaleString()}
                            </TableCell>
                            <TableCell className="max-w-[200px]">
                              <TruncatedCell content={service.description || '-'} maxLength={30} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <EmptyState
                    icon={Wrench}
                    title="No service records yet"
                    description="Track maintenance and service records for this vehicle"
                  />
                )}
              </CardContent>
            </Card>
          </div>

          {/* Files Section */}
          <div className="mt-8">
            {/* Hidden file input for upload */}
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              multiple
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
              onChange={(e) => {
                const selectedFiles = e.target.files;
                if (selectedFiles) {
                  Array.from(selectedFiles).forEach(file => uploadFile(file));
                }
                e.target.value = '';
              }}
            />
            <Card className="shadow-card rounded-lg">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg font-semibold flex items-center gap-2">
                      <FileText className="h-5 w-5" />
                      Documents & Files {files.length > 0 && `(${files.length})`}
                    </CardTitle>
                    <CardDescription>Upload and manage documents</CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingFile}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Upload
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-[300px] overflow-y-auto">
                  <VehicleFileUpload
                    files={files}
                    onUpload={uploadFile}
                    onDelete={deleteFile}
                    onDownload={downloadFile}
                    isUploading={isUploadingFile}
                    isDeleting={isDeletingFile}
                    canUpload={true}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Blocked Dates Section */}
          <div className="mt-8">
            <Card className="shadow-card rounded-lg">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg font-semibold flex items-center gap-2">
                      <Calendar className="h-5 w-5" />
                      Blocked Dates
                    </CardTitle>
                    <CardDescription>Manage vehicle availability blocking</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-[300px] overflow-y-auto">
                  <BlockedDatesManager vehicle_id={id} />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

      {/* Add Fine Dialog */}
      {rentals?.some((r: any) => r.status === 'Active') && (
        <AddFineDialog
          open={showAddFineDialog}
          onOpenChange={setShowAddFineDialog}
          vehicle_id={id}
          customer_id={rentals?.find((r: any) => r.status === 'Active')?.customer_id}
        />
      )}

      {/* Edit Vehicle Dialog */}
      <EditVehicleDialog
        vehicle={vehicle}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
      />

      {/* Dispose Vehicle Dialog */}
      {!vehicle.is_disposed && (
        <VehicleDisposalDialog
          vehicle={vehicle}
          open={showDisposeDialog}
          onOpenChange={setShowDisposeDialog}
        />
      )}

      {/* Undo Disposal Dialog */}
      {vehicle.is_disposed && (
        <VehicleUndoDisposalDialog
          vehicle={vehicle}
        />
      )}

      {/* Delete Vehicle Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Vehicle</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this vehicle? This action cannot be undone.
              {rentals && rentals.some(r => r.status === 'Active') && (
                <span className="text-destructive font-medium block mt-2">
                  This vehicle has active rentals and cannot be deleted.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  // Delete related records first to avoid foreign key constraints
                  // Delete P&L entries
                  await supabase.from('pnl_entries').delete().eq('vehicle_id', vehicle.id);

                  // Delete vehicle photos
                  await supabase.from('vehicle_photos').delete().eq('vehicle_id', vehicle.id);

                  // Delete vehicle expenses
                  await supabase.from('vehicle_expenses').delete().eq('vehicle_id', vehicle.id);

                  // Delete service records
                  await supabase.from('vehicle_services').delete().eq('vehicle_id', vehicle.id);

                  // Now delete the vehicle
                  const { error } = await supabase
                    .from('vehicles')
                    .delete()
                    .eq('id', vehicle.id);

                  if (error) throw error;

                  // Audit log for vehicle deletion
                  logAction({
                    action: "vehicle_deleted",
                    entityType: "vehicle",
                    entityId: vehicle.id,
                    details: { reg: vehicle.reg, make: vehicle.make, model: vehicle.model }
                  });

                  toast({
                    title: "Vehicle deleted",
                    description: "The vehicle and all related records have been permanently deleted.",
                  });

                  router.push('/vehicles');
                } catch (error: any) {
                  toast({
                    title: "Error",
                    description: error.message,
                    variant: "destructive",
                  });
                }
              }}
              disabled={rentals && rentals.some(r => r.status === 'Active')}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
