import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Plus, Edit, Trash2, CheckCircle2, AlertCircle, Car, Calendar, PoundSterling, FileText, RefreshCcw, Upload, Download, Loader2, AlertTriangle, Clock } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface MaintenanceRecord {
  id: string;
  vehicle_id: string;
  maintenance_type: string;
  scheduled_date: string;
  completed_date: string | null;
  status: string;
  cost: number | null;
  notes: string | null;
  document_url: string | null;
  is_overdue: boolean;
  created_at: string;
}

interface Vehicle {
  id: string;
  name: string;
}

const FleetMaintenance = () => {
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<MaintenanceRecord[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState<MaintenanceRecord | null>(null);
  const [editingRecord, setEditingRecord] = useState<MaintenanceRecord | null>(null);
  const [uploading, setUploading] = useState(false);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentPreviewUrl, setDocumentPreviewUrl] = useState<string | null>(null);

  // Filters
  const [vehicleFilter, setVehicleFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  
  const [formData, setFormData] = useState({
    vehicle_id: "",
    maintenance_type: "Service",
    scheduled_date: "",
    completed_date: "",
    status: "upcoming",
    cost: "",
    notes: "",
    document_url: "",
  });

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [records, vehicleFilter, typeFilter, statusFilter]);

  // Clean up preview URL on unmount
  useEffect(() => {
    return () => {
      if (documentPreviewUrl) {
        URL.revokeObjectURL(documentPreviewUrl);
      }
    };
  }, [documentPreviewUrl]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [recordsRes, vehiclesRes] = await Promise.all([
        supabase.from("fleet_maintenance").select("*").order("scheduled_date", { ascending: false }),
        supabase.from("vehicles").select("id, name").eq("is_active", true),
      ]);

      if (recordsRes.error) throw recordsRes.error;
      if (vehiclesRes.error) throw vehiclesRes.error;

      // Auto-update overdue status
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const updatedRecords = (recordsRes.data || []).map(record => {
        const isOverdue = !record.completed_date && 
                          record.status !== 'completed' && 
                          new Date(record.scheduled_date) < today;
        return {
          ...record,
          is_overdue: isOverdue,
          status: record.completed_date ? 'completed' : (isOverdue ? 'overdue' : record.status)
        };
      });

      setRecords(updatedRecords as any);
      setVehicles(vehiclesRes.data || []);
    } catch (error: any) {
      toast.error("Failed to load maintenance records: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...records];

    if (vehicleFilter !== "all") {
      filtered = filtered.filter(r => r.vehicle_id === vehicleFilter);
    }

    if (typeFilter !== "all") {
      filtered = filtered.filter(r => r.maintenance_type === typeFilter);
    }

    if (statusFilter !== "all") {
      filtered = filtered.filter(r => r.status === statusFilter);
    }

    setFilteredRecords(filtered);
  };

  const clearFilters = () => {
    setVehicleFilter("all");
    setTypeFilter("all");
    setStatusFilter("all");
  };

  const uploadDocument = async (file: File): Promise<string | null> => {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = fileName;

      const { error: uploadError } = await supabase.storage
        .from('maintenance-documents')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        throw uploadError;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('maintenance-documents')
        .getPublicUrl(filePath);

      return publicUrl;
    } catch (error) {
      console.error('Error uploading document:', error);
      toast.error('Failed to upload document');
      return null;
    }
  };

  const deleteDocument = async (documentUrl: string) => {
    try {
      const path = documentUrl.split('/maintenance-documents/')[1];
      if (path) {
        await supabase.storage.from('maintenance-documents').remove([path]);
      }
    } catch (error) {
      console.error('Error deleting document:', error);
    }
  };

  const handleDocumentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error('File must be under 10MB');
        return;
      }

      const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
      if (!validTypes.includes(file.type)) {
        toast.error('Please upload PDF, JPG, PNG, or WEBP');
        return;
      }

      // Clean up previous preview URL if exists
      if (documentPreviewUrl) {
        URL.revokeObjectURL(documentPreviewUrl);
      }

      // Create preview URL for images
      if (file.type.startsWith('image/')) {
        const previewUrl = URL.createObjectURL(file);
        setDocumentPreviewUrl(previewUrl);
      } else {
        setDocumentPreviewUrl(null);
      }

      setDocumentFile(file);
      toast.success('Document selected');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploading(true);

    try {
      let documentUrl = formData.document_url;

      // Upload new document if selected
      if (documentFile) {
        // Delete old document if updating
        if (editingRecord?.document_url) {
          await deleteDocument(editingRecord.document_url);
        }
        
        documentUrl = await uploadDocument(documentFile);
        if (!documentUrl) {
          setUploading(false);
          return;
        }
      }

      const maintenanceData = {
        vehicle_id: formData.vehicle_id,
        maintenance_type: formData.maintenance_type,
        scheduled_date: formData.scheduled_date,
        completed_date: formData.completed_date || null,
        status: formData.completed_date ? 'completed' : formData.status,
        cost: formData.cost ? parseFloat(formData.cost) : null,
        notes: formData.notes || null,
        document_url: documentUrl || null,
      };

      if (editingRecord) {
        const { error } = await supabase
          .from("fleet_maintenance")
          .update(maintenanceData)
          .eq("id", editingRecord.id);

        if (error) {
          toast.error("Failed to update maintenance record");
          setUploading(false);
          return;
        }
        toast.success("Maintenance record updated successfully");
      } else {
        const { error } = await supabase
          .from("fleet_maintenance")
          .insert(maintenanceData);

        if (error) {
          toast.error("Failed to create maintenance record");
          setUploading(false);
          return;
        }
        toast.success("Maintenance record created successfully");
      }

      setDialogOpen(false);
      resetForm();
      loadData();
    } catch (error) {
      toast.error("An error occurred");
      console.error(error);
    } finally {
      setUploading(false);
    }
  };

  const handleEdit = (record: MaintenanceRecord) => {
    setEditingRecord(record);
    setFormData({
      vehicle_id: record.vehicle_id,
      maintenance_type: record.maintenance_type,
      scheduled_date: record.scheduled_date,
      completed_date: record.completed_date || "",
      status: record.status,
      cost: record.cost?.toString() || "",
      notes: record.notes || "",
      document_url: record.document_url || "",
    });
    setDialogOpen(true);
  };

  const handleDeleteClick = (record: MaintenanceRecord) => {
    setRecordToDelete(record);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!recordToDelete) return;

    try {
      // Delete document if exists
      if (recordToDelete.document_url) {
        await deleteDocument(recordToDelete.document_url);
      }

      const { error } = await supabase
        .from("fleet_maintenance")
        .delete()
        .eq("id", recordToDelete.id);

      if (error) {
        toast.error("Failed to delete maintenance record");
        return;
      }

      toast.success("Maintenance record deleted successfully");
      setDeleteDialogOpen(false);
      setRecordToDelete(null);
      loadData();
    } catch (error) {
      toast.error("An error occurred");
      console.error(error);
    }
  };

  const resetForm = () => {
    setEditingRecord(null);
    setDocumentFile(null);

    // Clean up preview URL
    if (documentPreviewUrl) {
      URL.revokeObjectURL(documentPreviewUrl);
      setDocumentPreviewUrl(null);
    }

    setFormData({
      vehicle_id: "",
      maintenance_type: "Service",
      scheduled_date: "",
      completed_date: "",
      status: "upcoming",
      cost: "",
      notes: "",
      document_url: "",
    });
  };

  const getStatusBadge = (record: MaintenanceRecord) => {
    const statusConfig = {
      completed: { bg: "bg-green-500/20", text: "text-green-400", border: "border-green-500/30", icon: CheckCircle2, label: "Completed" },
      overdue: { bg: "bg-red-500/20", text: "text-red-400", border: "border-red-500/30", icon: AlertCircle, label: "Overdue" },
      in_progress: { bg: "bg-amber-500/20", text: "text-amber-400", border: "border-amber-500/30", icon: Clock, label: "In Progress" },
      upcoming: { bg: "bg-blue-500/20", text: "text-blue-400", border: "border-blue-500/30", icon: Calendar, label: "Upcoming" },
    };

    const config = statusConfig[record.status as keyof typeof statusConfig] || statusConfig.upcoming;
    const Icon = config.icon;

    return (
      <Badge className={cn(config.bg, config.text, config.border)}>
        <Icon className="w-3 h-3 mr-1" />
        {config.label}
      </Badge>
    );
  };

  const overdueCount = records.filter(r => r.status === 'overdue').length;
  const upcomingSevenDays = records.filter(r => {
    if (r.status === 'completed' || r.status === 'overdue') return false;
    const scheduledDate = new Date(r.scheduled_date);
    const today = new Date();
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(today.getDate() + 7);
    return scheduledDate >= today && scheduledDate <= sevenDaysFromNow;
  }).length;

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex justify-between items-start gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-gradient-metal mb-2">
              Fleet Maintenance
            </h1>
            <p className="text-muted-foreground">
              Track vehicle maintenance, MOT, inspections, and service records for your fleet.
            </p>
          </div>
          <div className="flex gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={loadData} variant="outline" className="gap-2">
                  <RefreshCcw className="w-4 h-4" />
                  Refresh
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reload maintenance data</TooltipContent>
            </Tooltip>
            
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DialogTrigger asChild>
                    <Button className="gradient-accent shadow-glow" onClick={resetForm}>
                      <Plus className="w-4 h-4 mr-2" />
                      Add Maintenance
                    </Button>
                  </DialogTrigger>
                </TooltipTrigger>
                <TooltipContent>Add new maintenance record</TooltipContent>
              </Tooltip>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="text-2xl font-display">
                    {editingRecord ? "Edit Maintenance Record" : "Add Maintenance Record"}
                  </DialogTitle>
                  <DialogDescription>
                    Log fleet maintenance, service, MOT, or inspection activity
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold border-b pb-2">Basic Information</h3>
                    
                    <div className="space-y-2">
                      <Label htmlFor="vehicle">
                        Vehicle <span className="text-destructive">*</span>
                      </Label>
                      <Select
                        value={formData.vehicle_id}
                        onValueChange={(value) => setFormData({ ...formData, vehicle_id: value })}
                        required
                      >
                        <SelectTrigger id="vehicle" className="focus:ring-accent">
                          <SelectValue placeholder="Select vehicle" />
                        </SelectTrigger>
                        <SelectContent>
                          {vehicles.map(v => (
                            <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="type">
                          Maintenance Type <span className="text-destructive">*</span>
                        </Label>
                        <Select
                          value={formData.maintenance_type}
                          onValueChange={(value) => setFormData({ ...formData, maintenance_type: value })}
                        >
                          <SelectTrigger id="type" className="focus:ring-accent">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Service">Service</SelectItem>
                            <SelectItem value="MOT">MOT</SelectItem>
                            <SelectItem value="Repair">Repair</SelectItem>
                            <SelectItem value="Inspection">Inspection</SelectItem>
                            <SelectItem value="Insurance Renewal">Insurance Renewal</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="status">
                          Status <span className="text-destructive">*</span>
                        </Label>
                        <Select
                          value={formData.status}
                          onValueChange={(value) => setFormData({ ...formData, status: value })}
                        >
                          <SelectTrigger id="status" className="focus:ring-accent">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="upcoming">Upcoming</SelectItem>
                            <SelectItem value="in_progress">In Progress</SelectItem>
                            <SelectItem value="completed">Completed</SelectItem>
                            <SelectItem value="overdue">Overdue</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 pt-4 border-t">
                    <h3 className="text-lg font-semibold border-b pb-2">Schedule & Cost</h3>

                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="scheduled">
                          Scheduled Date <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id="scheduled"
                          type="date"
                          value={formData.scheduled_date}
                          onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })}
                          className="focus-visible:ring-accent"
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="completed">Completed Date</Label>
                        <Input
                          id="completed"
                          type="date"
                          value={formData.completed_date}
                          onChange={(e) => setFormData({ ...formData, completed_date: e.target.value })}
                          className="focus-visible:ring-accent"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="cost">Cost ($)</Label>
                      <Input
                        id="cost"
                        type="number"
                        step="0.01"
                        value={formData.cost}
                        onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
                        className="focus-visible:ring-accent"
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  <div className="space-y-4 pt-4 border-t">
                    <h3 className="text-lg font-semibold border-b pb-2">Details & Documentation</h3>

                    <div className="space-y-2">
                      <Label htmlFor="notes">Notes / Description</Label>
                      <Textarea
                        id="notes"
                        value={formData.notes}
                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                        className="focus-visible:ring-accent"
                        placeholder="Describe the maintenance work, findings, or recommendations..."
                        rows={3}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="document">
                        Upload Document (Invoice / Report)
                      </Label>

                      {/* Show preview for newly selected image file */}
                      {documentFile && documentPreviewUrl && (
                        <div className="mb-3 p-4 border border-border rounded-lg bg-muted/20">
                          <p className="text-sm font-medium mb-2 text-green-500">New Document Selected:</p>
                          <div className="space-y-2">
                            <img
                              src={documentPreviewUrl}
                              alt="Document Preview"
                              className="max-w-full h-auto max-h-64 rounded-lg border border-border object-contain bg-background"
                            />
                            <p className="text-xs text-muted-foreground">Preview - will be uploaded when you save</p>
                          </div>
                        </div>
                      )}

                      {/* Show preview for newly selected PDF file */}
                      {documentFile && !documentPreviewUrl && (
                        <div className="mb-3 p-4 border border-border rounded-lg bg-muted/20">
                          <p className="text-sm font-medium mb-2 text-green-500">New PDF Document Selected:</p>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <FileText className="w-8 h-8" />
                            <div>
                              <p className="font-medium">{documentFile.name}</p>
                              <p className="text-xs">PDF - will be uploaded when you save</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Show existing uploaded document if no new file selected */}
                      {formData.document_url && !documentFile && (
                        <div className="mb-3 p-4 border border-border rounded-lg bg-muted/20">
                          <p className="text-sm font-medium mb-2">Current Document:</p>
                          {formData.document_url.match(/\.(jpg|jpeg|png|webp)$/i) ? (
                            <div className="space-y-2">
                              <img
                                src={formData.document_url}
                                alt="Maintenance Document"
                                className="max-w-full h-auto max-h-64 rounded-lg border border-border object-contain bg-background"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => window.open(formData.document_url, '_blank')}
                                className="w-full"
                              >
                                <Download className="w-4 h-4 mr-2" />
                                View Full Size
                              </Button>
                            </div>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => window.open(formData.document_url, '_blank')}
                              className="w-full"
                            >
                              <FileText className="w-4 h-4 mr-2" />
                              View PDF Document
                            </Button>
                          )}
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Input
                          id="document"
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.webp"
                          onChange={handleDocumentChange}
                          className="focus-visible:ring-accent"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        PDF, JPG, PNG, or WEBP (max 10MB)
                        {documentFile && ` • ${documentFile.name} selected`}
                        {formData.document_url && !documentFile && ' • Upload a new file to replace'}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <Button 
                      type="submit" 
                      className="gradient-accent shadow-glow flex-1"
                      disabled={uploading}
                    >
                      {uploading ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {documentFile ? 'Uploading...' : 'Saving...'}
                        </>
                      ) : (
                        <>{editingRecord ? "Save Changes" : "Create Record"}</>
                      )}
                    </Button>
                    <Button 
                      type="button" 
                      variant="outline" 
                      onClick={() => setDialogOpen(false)}
                      disabled={uploading}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Alerts */}
        <div className="grid md:grid-cols-2 gap-4">
          {overdueCount > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-red-500">
                  {overdueCount} Overdue Maintenance {overdueCount === 1 ? 'Item' : 'Items'}
                </p>
                <p className="text-sm text-muted-foreground">Immediate attention required</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStatusFilter("overdue")}
              >
                View
              </Button>
            </div>
          )}

          {upcomingSevenDays > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-amber-500">
                  {upcomingSevenDays} Upcoming {upcomingSevenDays === 1 ? 'Task' : 'Tasks'} (7 Days)
                </p>
                <p className="text-sm text-muted-foreground">Schedule preparation needed</p>
              </div>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4">
          <Select value={vehicleFilter} onValueChange={setVehicleFilter}>
            <SelectTrigger className="w-[200px] focus:ring-accent">
              <SelectValue placeholder="All Vehicles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Vehicles</SelectItem>
              {vehicles.map(v => (
                <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[200px] focus:ring-accent">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="Service">Service</SelectItem>
              <SelectItem value="MOT">MOT</SelectItem>
              <SelectItem value="Repair">Repair</SelectItem>
              <SelectItem value="Inspection">Inspection</SelectItem>
              <SelectItem value="Insurance Renewal">Insurance Renewal</SelectItem>
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[200px] focus:ring-accent">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="upcoming">Upcoming</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>

          {(vehicleFilter !== "all" || typeFilter !== "all" || statusFilter !== "all") && (
            <Button variant="outline" onClick={clearFilters}>
              Clear Filters
            </Button>
          )}
        </div>

        {/* Maintenance Table */}
        {records.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-4 border border-border/50 rounded-lg bg-card/50">
            <Car className="w-16 h-16 text-muted-foreground/50 mb-4" />
            <h3 className="text-xl font-display font-semibold mb-2">No maintenance tasks logged yet</h3>
            <p className="text-muted-foreground text-center max-w-md mb-6">
              Add your first record to track fleet servicing, MOTs, or inspections.
            </p>
            <Button className="gradient-accent shadow-glow" onClick={() => setDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Maintenance
            </Button>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-4 border border-border/50 rounded-lg bg-card/50">
            <AlertCircle className="w-16 h-16 text-muted-foreground/50 mb-4" />
            <h3 className="text-xl font-display font-semibold mb-2">No records match your filters</h3>
            <p className="text-muted-foreground text-center max-w-md mb-6">
              Try adjusting your filter criteria.
            </p>
            <Button variant="outline" onClick={clearFilters}>
              Clear Filters
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border border-border/50 overflow-hidden shadow-metal bg-card/50">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Scheduled Date</TableHead>
                  <TableHead>Completed Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecords.map((record) => (
                  <TableRow 
                    key={record.id}
                    className={cn(
                      record.status === 'overdue' && "bg-red-500/5 hover:bg-red-500/10"
                    )}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Car className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium">
                          {vehicles.find(v => v.id === record.vehicle_id)?.name || "Unknown"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{record.maintenance_type}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        {format(new Date(record.scheduled_date), "dd MMM yyyy")}
                      </div>
                    </TableCell>
                    <TableCell>
                      {record.completed_date ? (
                        format(new Date(record.completed_date), "dd MMM yyyy")
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(record)}
                    </TableCell>
                    <TableCell>
                      {record.cost ? (
                        <div className="flex items-center gap-1">
                          <PoundSterling className="w-3 h-3" />
                          {record.cost.toFixed(2)}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">N/A</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {record.notes ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1 cursor-help">
                              <FileText className="w-4 h-4 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                                {record.notes}
                              </span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-sm">
                            <p className="text-sm">{record.notes}</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        {record.document_url && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => window.open(record.document_url!, '_blank')}
                              >
                                <FileText className="w-4 h-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>View document</TooltipContent>
                          </Tooltip>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleEdit(record)}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit record</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDeleteClick(record)}
                              className="hover:border-red-500/40 hover:text-red-500"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Delete record</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Delete Confirmation */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-display text-2xl">Delete Maintenance Record?</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <p>
                  Are you sure you want to delete this maintenance record?
                </p>
                <p className="text-destructive">
                  This will permanently remove the record and any associated documents. This action cannot be undone.
                </p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={confirmDelete} 
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete Record
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
};

export default FleetMaintenance;
