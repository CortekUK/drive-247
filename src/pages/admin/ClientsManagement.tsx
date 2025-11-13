import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Edit, Trash2, Phone, Mail, Users, Search, X, RefreshCcw, FileText, Calendar, MapPin, CreditCard, History, StickyNote, Loader2, Download } from "lucide-react";
import { format } from "date-fns";

interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  license_number: string | null;
  license_expiry_date: string | null;
  license_upload_url: string | null;
  date_of_birth: string | null;
  address: string | null;
  client_status: string;
  active_rentals_count: number;
  total_rentals_completed: number;
  admin_notes: string | null;
  created_at: string;
}

interface Rental {
  id: string;
  pickup_date: string;
  dropoff_date: string;
  total_price: number;
  status: string;
  vehicle_id: string;
  vehicles: {
    name: string;
  } | null;
}

const ClientsManagement = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [filteredClients, setFilteredClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("profile");
  const [clientRentals, setClientRentals] = useState<Rental[]>([]);
  const [loadingRentals, setLoadingRentals] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [licensePreviewUrl, setLicensePreviewUrl] = useState<string | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [viewingClient, setViewingClient] = useState<Client | null>(null);
  const [detailTab, setDetailTab] = useState("profile");
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    license_number: "",
    license_expiry_date: "",
    license_upload_url: "",
    date_of_birth: "",
    address: "",
    client_status: "active",
    admin_notes: "",
  });

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map(word => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-500/20 text-green-400 border-green-500/30";
      case "suspended":
        return "bg-red-500/20 text-red-400 border-red-500/30";
      case "vip":
        return "bg-amber-500/20 text-amber-400 border-amber-500/30";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getStatusLabel = (status: string) => {
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  useEffect(() => {
    loadClients();
  }, []);

  useEffect(() => {
    filterClients();
  }, [clients, searchQuery, statusFilter]);

  useEffect(() => {
    if (editingClient && activeTab === "rentals") {
      loadClientRentals(editingClient.id);
    }
  }, [activeTab, editingClient]);

  useEffect(() => {
    if (viewingClient && detailTab === "rentals") {
      loadClientRentals(viewingClient.id);
    }
  }, [detailTab, viewingClient]);

  // Clean up preview URL on unmount
  useEffect(() => {
    return () => {
      if (licensePreviewUrl) {
        URL.revokeObjectURL(licensePreviewUrl);
      }
    };
  }, [licensePreviewUrl]);

  const filterClients = () => {
    let filtered = [...clients];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(client =>
        client.name.toLowerCase().includes(query) ||
        client.email?.toLowerCase().includes(query) ||
        client.phone?.toLowerCase().includes(query) ||
        client.license_number?.toLowerCase().includes(query)
      );
    }

    if (statusFilter !== "all") {
      filtered = filtered.filter(c => c.client_status === statusFilter);
    }

    setFilteredClients(filtered);
  };

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
  };

  const loadClients = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .order("name");

    if (error) {
      toast.error("Failed to load clients");
    } else {
      setClients(data as any || []);
    }
    setLoading(false);
  };

  const loadClientRentals = async (clientId: string) => {
    setLoadingRentals(true);
    const { data, error } = await supabase
      .from("bookings")
      .select(`
        id,
        pickup_date,
        dropoff_date,
        total_price,
        status,
        vehicle_id,
        vehicles (name)
      `)
      .eq("client_id", clientId)
      .order("pickup_date", { ascending: false });

    if (error) {
      toast.error("Failed to load rental history");
      setClientRentals([]);
    } else {
      // Transform the data to match our Rental interface
      const rentals = (data || []).map((item: any) => ({
        ...item,
        vehicles: Array.isArray(item.vehicles) ? item.vehicles[0] : item.vehicles
      }));
      setClientRentals(rentals);
    }
    setLoadingRentals(false);
  };

  const uploadLicense = async (file: File): Promise<string | null> => {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = fileName;

      const { error: uploadError } = await supabase.storage
        .from('client-licenses')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        throw uploadError;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('client-licenses')
        .getPublicUrl(filePath);

      return publicUrl;
    } catch (error) {
      console.error('Error uploading license:', error);
      toast.error('Failed to upload license document');
      return null;
    }
  };

  const deleteLicense = async (licenseUrl: string) => {
    try {
      const path = licenseUrl.split('/client-licenses/')[1];
      if (path) {
        await supabase.storage.from('client-licenses').remove([path]);
      }
    } catch (error) {
      console.error('Error deleting license:', error);
    }
  };

  const handleLicenseChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error('File must be under 5MB');
        return;
      }

      const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
      if (!validTypes.includes(file.type)) {
        toast.error('Please upload PDF, JPG, PNG, or WEBP');
        return;
      }

      // Clean up previous preview URL if exists
      if (licensePreviewUrl) {
        URL.revokeObjectURL(licensePreviewUrl);
      }

      // Create preview URL for images
      if (file.type.startsWith('image/')) {
        const previewUrl = URL.createObjectURL(file);
        setLicensePreviewUrl(previewUrl);
      } else {
        setLicensePreviewUrl(null);
      }

      setLicenseFile(file);
      toast.success('License document selected');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploading(true);

    try {
      let licenseUrl = formData.license_upload_url;

      // Upload new license if selected
      if (licenseFile) {
        // Delete old license if updating
        if (editingClient?.license_upload_url) {
          await deleteLicense(editingClient.license_upload_url);
        }
        
        licenseUrl = await uploadLicense(licenseFile);
        if (!licenseUrl) {
          setUploading(false);
          return;
        }
      }

      const clientData = {
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        license_number: formData.license_number || null,
        license_expiry_date: formData.license_expiry_date || null,
        license_upload_url: licenseUrl || null,
        date_of_birth: formData.date_of_birth || null,
        address: formData.address || null,
        client_status: formData.client_status,
        admin_notes: formData.admin_notes || null,
      };

      if (editingClient) {
        const { data, error } = await supabase
          .from("clients")
          .update(clientData)
          .eq("id", editingClient.id)
          .select()
          .single();

        if (error) {
          toast.error("Failed to update client");
          setUploading(false);
          return;
        }
        
        setClients(clients.map(c => c.id === editingClient.id ? data : c));
        toast.success("Client updated successfully");
      } else {
        const { data, error } = await supabase
          .from("clients")
          .insert({
            ...clientData,
            active_rentals_count: 0,
            total_rentals_completed: 0,
          })
          .select()
          .single();

        if (error) {
          toast.error("Failed to create client");
          setUploading(false);
          return;
        }
        
        setClients([...clients, data]);
        toast.success("Client created successfully");
      }

      setDialogOpen(false);
      resetForm();

      // Clean up preview URL after successful submission
      if (licensePreviewUrl) {
        URL.revokeObjectURL(licensePreviewUrl);
        setLicensePreviewUrl(null);
      }
    } catch (error) {
      toast.error("An error occurred");
      console.error(error);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteClick = (client: Client) => {
    setClientToDelete(client);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!clientToDelete) return;

    try {
      // Delete license document if exists
      if (clientToDelete.license_upload_url) {
        await deleteLicense(clientToDelete.license_upload_url);
      }

      const { error } = await supabase
        .from("clients")
        .delete()
        .eq("id", clientToDelete.id);

      if (error) {
        toast.error("Failed to delete client");
        return;
      }

      toast.success("Client deleted successfully");
      setDeleteDialogOpen(false);
      setClientToDelete(null);
      loadClients();
    } catch (error) {
      toast.error("An error occurred");
      console.error(error);
    }
  };

  const handleEdit = (client: Client) => {
    setEditingClient(client);
    setFormData({
      name: client.name,
      email: client.email || "",
      phone: client.phone || "",
      license_number: client.license_number || "",
      license_expiry_date: client.license_expiry_date || "",
      license_upload_url: client.license_upload_url || "",
      date_of_birth: client.date_of_birth || "",
      address: client.address || "",
      client_status: client.client_status || "active",
      admin_notes: client.admin_notes || "",
    });
    setActiveTab("profile");
    setDialogOpen(true);
  };

  const handleViewClient = (client: Client) => {
    setViewingClient(client);
    setDetailTab("profile");
    setDetailModalOpen(true);
  };

  const handleEditFromDetail = () => {
    if (viewingClient) {
      setDetailModalOpen(false);
      handleEdit(viewingClient);
    }
  };

  const resetForm = () => {
    setEditingClient(null);
    setLicenseFile(null);

    // Clean up preview URL
    if (licensePreviewUrl) {
      URL.revokeObjectURL(licensePreviewUrl);
      setLicensePreviewUrl(null);
    }

    setActiveTab("profile");
    setFormData({
      name: "",
      email: "",
      phone: "",
      license_number: "",
      license_expiry_date: "",
      license_upload_url: "",
      date_of_birth: "",
      address: "",
      client_status: "active",
      admin_notes: "",
    });
  };

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="p-8">
              <div className="space-y-4">
                <div className="flex flex-col items-center space-y-3">
                  <Skeleton className="h-20 w-20 rounded-full" />
                  <Skeleton className="h-6 w-32" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-gradient-metal mb-2">Clients Management</h1>
            <p className="text-muted-foreground">
              Manage client profiles, verify licenses, and track rental history with full CRM control.
            </p>
          </div>
          
          <div className="flex gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={loadClients} variant="outline" className="gap-2">
                  <RefreshCcw className="w-4 h-4" />
                  Refresh
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reload clients data</TooltipContent>
            </Tooltip>
            
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DialogTrigger asChild>
                    <Button className="gradient-accent shadow-glow" onClick={resetForm}>
                      <Plus className="w-4 h-4 mr-2" />
                      Add Client
                    </Button>
                  </DialogTrigger>
                </TooltipTrigger>
                <TooltipContent>Add new client profile</TooltipContent>
              </Tooltip>
              <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="font-display text-2xl">
                    {editingClient ? `Edit Client: ${editingClient.name}` : "Add New Client"}
                  </DialogTitle>
                  <DialogDescription>
                    {editingClient 
                      ? "Update client profile and manage rental history" 
                      : "Complete all required fields to create a new client profile"}
                  </DialogDescription>
                </DialogHeader>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="profile">Profile Details</TabsTrigger>
                    <TabsTrigger value="rentals" disabled={!editingClient}>
                      Rental History
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="profile" className="space-y-6 mt-6">
                    <form onSubmit={handleSubmit} className="space-y-6">
                      {/* Basic Information */}
                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <Users className="w-5 h-5" />
                          Basic Information
                        </h3>
                        
                        <div className="grid md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="name" className="text-sm font-semibold">
                              Full Name <span className="text-destructive">*</span>
                            </Label>
                            <Input
                              id="name"
                              value={formData.name}
                              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                              className="focus-visible:ring-accent"
                              placeholder="e.g., John Smith"
                              required
                              autoFocus
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="status" className="text-sm font-semibold">
                              Client Status <span className="text-destructive">*</span>
                            </Label>
                            <Select
                              value={formData.client_status}
                              onValueChange={(value) => setFormData({ ...formData, client_status: value })}
                            >
                              <SelectTrigger id="status" className="focus:ring-accent">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="active">Active</SelectItem>
                                <SelectItem value="suspended">Suspended</SelectItem>
                                <SelectItem value="vip">VIP</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="grid md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="email" className="text-sm font-semibold flex items-center gap-2">
                              <Mail className="w-4 h-4" />
                              Email <span className="text-destructive">*</span>
                            </Label>
                            <Input
                              id="email"
                              type="email"
                              value={formData.email}
                              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                              className="focus-visible:ring-accent"
                              placeholder="client@example.com"
                              required
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="phone" className="text-sm font-semibold flex items-center gap-2">
                              <Phone className="w-4 h-4" />
                              Phone <span className="text-destructive">*</span>
                            </Label>
                            <Input
                              id="phone"
                              type="tel"
                              value={formData.phone}
                              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                              className="focus-visible:ring-accent"
                              placeholder="+44 7700 900000"
                              required
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="dob" className="text-sm font-semibold flex items-center gap-2">
                            <Calendar className="w-4 h-4" />
                            Date of Birth
                          </Label>
                          <Input
                            id="dob"
                            type="date"
                            value={formData.date_of_birth}
                            onChange={(e) => setFormData({ ...formData, date_of_birth: e.target.value })}
                            className="focus-visible:ring-accent"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="address" className="text-sm font-semibold flex items-center gap-2">
                            <MapPin className="w-4 h-4" />
                            Address
                          </Label>
                          <Textarea
                            id="address"
                            value={formData.address}
                            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                            className="focus-visible:ring-accent"
                            placeholder="Billing or residential address"
                            rows={2}
                          />
                        </div>
                      </div>

                      {/* License Information */}
                      <div className="space-y-4 pt-4 border-t">
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <CreditCard className="w-5 h-5" />
                          Driver License Information
                        </h3>

                        <div className="grid md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="license_number" className="text-sm font-semibold">
                              License Number
                            </Label>
                            <Input
                              id="license_number"
                              value={formData.license_number}
                              onChange={(e) => setFormData({ ...formData, license_number: e.target.value })}
                              className="focus-visible:ring-accent"
                              placeholder="e.g., ABC123456789"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="license_expiry" className="text-sm font-semibold">
                              License Expiry Date
                            </Label>
                            <Input
                              id="license_expiry"
                              type="date"
                              value={formData.license_expiry_date}
                              onChange={(e) => setFormData({ ...formData, license_expiry_date: e.target.value })}
                              className="focus-visible:ring-accent"
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="license_upload" className="text-sm font-semibold flex items-center gap-2">
                            <FileText className="w-4 h-4" />
                            License Document Upload
                          </Label>

                          {/* Show preview for newly selected image file */}
                          {licenseFile && licensePreviewUrl && (
                            <div className="mb-3 p-4 border border-border rounded-lg bg-muted/20">
                              <p className="text-sm font-medium mb-2 text-green-500">New License Document Selected:</p>
                              <div className="space-y-2">
                                <img
                                  src={licensePreviewUrl}
                                  alt="License Preview"
                                  className="max-w-full h-auto max-h-64 rounded-lg border border-border object-contain bg-background"
                                />
                                <p className="text-xs text-muted-foreground">Preview - will be uploaded when you save</p>
                              </div>
                            </div>
                          )}

                          {/* Show preview for newly selected PDF file */}
                          {licenseFile && !licensePreviewUrl && (
                            <div className="mb-3 p-4 border border-border rounded-lg bg-muted/20">
                              <p className="text-sm font-medium mb-2 text-green-500">New PDF Document Selected:</p>
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <FileText className="w-8 h-8" />
                                <div>
                                  <p className="font-medium">{licenseFile.name}</p>
                                  <p className="text-xs">PDF - will be uploaded when you save</p>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Show existing uploaded document if no new file selected */}
                          {formData.license_upload_url && !licenseFile && (
                            <div className="mb-3 p-4 border border-border rounded-lg bg-muted/20">
                              <p className="text-sm font-medium mb-2">Current License Document:</p>
                              {formData.license_upload_url.match(/\.(jpg|jpeg|png|webp)$/i) ? (
                                <div className="space-y-2">
                                  <img
                                    src={formData.license_upload_url}
                                    alt="License Document"
                                    className="max-w-full h-auto max-h-64 rounded-lg border border-border object-contain bg-background"
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => window.open(formData.license_upload_url, '_blank')}
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
                                  onClick={() => window.open(formData.license_upload_url, '_blank')}
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
                              id="license_upload"
                              type="file"
                              accept=".pdf,.jpg,.jpeg,.png,.webp"
                              onChange={handleLicenseChange}
                              className="focus-visible:ring-accent"
                            />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            PDF, JPG, PNG, or WEBP (max 5MB)
                            {licenseFile && ` • ${licenseFile.name} selected`}
                            {formData.license_upload_url && !licenseFile && ' • Upload a new file to replace'}
                          </p>
                        </div>
                      </div>

                      {/* Admin Notes */}
                      <div className="space-y-4 pt-4 border-t">
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <StickyNote className="w-5 h-5" />
                          Admin Notes
                        </h3>
                        
                        <div className="space-y-2">
                          <Label htmlFor="admin_notes" className="text-sm font-semibold">
                            Internal Notes (Admin Only)
                          </Label>
                          <Textarea
                            id="admin_notes"
                            value={formData.admin_notes}
                            onChange={(e) => setFormData({ ...formData, admin_notes: e.target.value })}
                            className="focus-visible:ring-accent"
                            placeholder="Add any special conditions, preferences, or important notes about this client..."
                            rows={3}
                          />
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
                              {licenseFile ? 'Uploading...' : 'Saving...'}
                            </>
                          ) : (
                            <>{editingClient ? "Save Changes" : "Create Client"}</>
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
                  </TabsContent>

                  <TabsContent value="rentals" className="space-y-4 mt-6">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <History className="w-5 h-5" />
                        Rental History
                      </h3>
                      {editingClient && (
                        <div className="flex gap-2">
                          <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
                            {editingClient.active_rentals_count} Active
                          </Badge>
                          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                            {editingClient.total_rentals_completed} Completed
                          </Badge>
                        </div>
                      )}
                    </div>

                    {loadingRentals ? (
                      <div className="space-y-2">
                        {[...Array(3)].map((_, i) => (
                          <Skeleton key={i} className="h-16 w-full" />
                        ))}
                      </div>
                    ) : clientRentals.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <History className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p>No rental history for this client yet.</p>
                      </div>
                    ) : (
                      <div className="border rounded-lg overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Vehicle</TableHead>
                              <TableHead>Pickup Date</TableHead>
                              <TableHead>Dropoff Date</TableHead>
                              <TableHead>Price</TableHead>
                              <TableHead>Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {clientRentals.map((rental) => (
                              <TableRow key={rental.id}>
                                <TableCell className="font-medium">
                                  {rental.vehicles?.name || "N/A"}
                                </TableCell>
                                <TableCell>
                                  {format(new Date(rental.pickup_date), "MMM d, yyyy")}
                                </TableCell>
                                <TableCell>
                                  {rental.dropoff_date ? format(new Date(rental.dropoff_date), "MMM d, yyyy") : "—"}
                                </TableCell>
                                <TableCell>${rental.total_price.toFixed(2)}</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="capitalize">
                                    {rental.status}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Filter & Search */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, phone, or license..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-10 focus-visible:ring-accent"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 transform -translate-y-1/2 h-7 w-7"
                onClick={() => setSearchQuery("")}
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
          
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[180px] focus:ring-accent">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clients</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="vip">VIP</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
            </SelectContent>
          </Select>

          {(searchQuery || statusFilter !== "all") && (
            <Button
              variant="outline"
              onClick={clearFilters}
              className="text-accent hover:text-accent/80"
            >
              Clear Filters
            </Button>
          )}
        </div>

        {/* Client Cards */}
        {filteredClients.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 space-y-4">
            <Users className="w-16 h-16 text-muted-foreground/50" />
            <h3 className="text-xl font-display font-semibold">
              {clients.length === 0 ? "No clients yet" : "No clients found"}
            </h3>
            <p className="text-muted-foreground text-center max-w-md">
              {clients.length === 0 
                ? "Add your first Drive 917 client to begin managing rentals." 
                : "Try adjusting filters or search criteria."}
            </p>
            {clients.length === 0 && (
              <Button className="gradient-accent shadow-glow mt-4" onClick={() => setDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Client
              </Button>
            )}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredClients.map((client) => (
              <Card 
                key={client.id} 
                className="p-6 hover:shadow-glow transition-all duration-300 border-border/50 bg-card/50 backdrop-blur-sm group cursor-pointer"
                onClick={() => handleViewClient(client)}
              >
                <div className="flex flex-col items-center space-y-4">
                  <Avatar className="h-20 w-20 border-2 border-accent/20 group-hover:border-accent/40 transition-colors">
                    <AvatarFallback className="bg-gradient-to-br from-accent/20 to-accent/5 text-accent font-bold text-lg">
                      {getInitials(client.name)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="text-center space-y-1 w-full">
                    <h3 className="font-display font-semibold text-lg">{client.name}</h3>
                    <div className="flex items-center justify-center gap-2 flex-wrap">
                      <Badge className={getStatusColor(client.client_status)}>
                        {getStatusLabel(client.client_status)}
                      </Badge>
                      {client.active_rentals_count > 0 && (
                        <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
                          {client.active_rentals_count} Active
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="w-full space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Mail className="w-4 h-4 flex-shrink-0" />
                      <span className="truncate">{client.email || "N/A"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="w-4 h-4 flex-shrink-0" />
                      <span>{client.phone || "N/A"}</span>
                    </div>
                    {client.license_number && (
                      <div className="flex items-center gap-2 text-accent">
                        <CreditCard className="w-4 h-4 flex-shrink-0" />
                        <span className="text-xs font-mono">{client.license_number}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-muted-foreground pt-2 border-t">
                      <History className="w-4 h-4" />
                      <span className="text-xs">{client.total_rentals_completed} completed rentals</span>
                    </div>
                  </div>

                  <div className="flex gap-2 w-full pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit(client);
                      }}
                      className="flex-1 hover:border-accent/40"
                    >
                      <Edit className="w-3 h-3 mr-1" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteClick(client);
                      }}
                      className="hover:border-red-500/40 hover:text-red-500"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Client Detail View Modal */}
        <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            {viewingClient && (
              <>
                <DialogHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <DialogTitle className="font-display text-2xl flex items-center gap-3">
                        <Avatar className="h-12 w-12 border-2 border-accent/20">
                          <AvatarFallback className="bg-gradient-to-br from-accent/20 to-accent/5 text-accent font-bold">
                            {getInitials(viewingClient.name)}
                          </AvatarFallback>
                        </Avatar>
                        {viewingClient.name}
                      </DialogTitle>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge className={getStatusColor(viewingClient.client_status)}>
                          {getStatusLabel(viewingClient.client_status)}
                        </Badge>
                        {viewingClient.active_rentals_count > 0 && (
                          <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
                            {viewingClient.active_rentals_count} Active Rental{viewingClient.active_rentals_count !== 1 ? 's' : ''}
                          </Badge>
                        )}
                        <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                          {viewingClient.total_rentals_completed} Completed
                        </Badge>
                      </div>
                    </div>
                    <Button
                      onClick={handleEditFromDetail}
                      className="gradient-accent shadow-glow"
                      size="sm"
                    >
                      <Edit className="w-4 h-4 mr-2" />
                      Edit Client
                    </Button>
                  </div>
                </DialogHeader>

                <Tabs value={detailTab} onValueChange={setDetailTab} className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="profile">Profile Details</TabsTrigger>
                    <TabsTrigger value="rentals">Rental History</TabsTrigger>
                  </TabsList>

                  <TabsContent value="profile" className="space-y-6 mt-6">
                    {/* Contact Information */}
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold flex items-center gap-2 border-b pb-2">
                        <Users className="w-5 h-5" />
                        Contact Information
                      </h3>
                      <div className="grid md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <Label className="text-sm text-muted-foreground">Email</Label>
                          <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4 text-muted-foreground" />
                            <p className="font-medium">{viewingClient.email || "N/A"}</p>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-sm text-muted-foreground">Phone</Label>
                          <div className="flex items-center gap-2">
                            <Phone className="w-4 h-4 text-muted-foreground" />
                            <p className="font-medium">{viewingClient.phone || "N/A"}</p>
                          </div>
                        </div>
                      </div>
                      {viewingClient.date_of_birth && (
                        <div className="space-y-1">
                          <Label className="text-sm text-muted-foreground">Date of Birth</Label>
                          <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-muted-foreground" />
                            <p className="font-medium">{format(new Date(viewingClient.date_of_birth), "MMMM d, yyyy")}</p>
                          </div>
                        </div>
                      )}
                      {viewingClient.address && (
                        <div className="space-y-1">
                          <Label className="text-sm text-muted-foreground">Address</Label>
                          <div className="flex items-start gap-2">
                            <MapPin className="w-4 h-4 text-muted-foreground mt-1" />
                            <p className="font-medium">{viewingClient.address}</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* License Information */}
                    <div className="space-y-4 pt-4 border-t">
                      <h3 className="text-lg font-semibold flex items-center gap-2 border-b pb-2">
                        <CreditCard className="w-5 h-5" />
                        Driver License Information
                      </h3>
                      {viewingClient.license_number || viewingClient.license_expiry_date || viewingClient.license_upload_url ? (
                        <>
                          {viewingClient.license_number && (
                            <div className="space-y-1">
                              <Label className="text-sm text-muted-foreground">License Number</Label>
                              <p className="font-medium font-mono">{viewingClient.license_number}</p>
                            </div>
                          )}
                          {viewingClient.license_expiry_date && (
                            <div className="space-y-1">
                              <Label className="text-sm text-muted-foreground">Expiry Date</Label>
                              <p className="font-medium">
                                {format(new Date(viewingClient.license_expiry_date), "MMMM d, yyyy")}
                                {new Date(viewingClient.license_expiry_date) < new Date() && (
                                  <Badge className="ml-2 bg-red-500/20 text-red-400 border-red-500/30">
                                    Expired
                                  </Badge>
                                )}
                              </p>
                            </div>
                          )}
                          {viewingClient.license_upload_url && (
                            <div className="space-y-2">
                              <Label className="text-sm text-muted-foreground">License Document</Label>
                              {viewingClient.license_upload_url.match(/\.(jpg|jpeg|png|webp)$/i) ? (
                                <div className="space-y-2">
                                  <div className="p-4 border border-border rounded-lg bg-muted/20">
                                    <img
                                      src={viewingClient.license_upload_url}
                                      alt="License Document"
                                      className="max-w-full h-auto max-h-96 rounded-lg border border-border object-contain bg-background"
                                    />
                                  </div>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => window.open(viewingClient.license_upload_url!, '_blank')}
                                    className="w-full gap-2"
                                  >
                                    <Download className="w-4 h-4" />
                                    View Full Size
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => window.open(viewingClient.license_upload_url!, '_blank')}
                                  className="gap-2"
                                >
                                  <FileText className="w-4 h-4" />
                                  View PDF Document
                                </Button>
                              )}
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">No license information available</p>
                      )}
                    </div>

                    {/* Admin Notes */}
                    {viewingClient.admin_notes && (
                      <div className="space-y-4 pt-4 border-t">
                        <h3 className="text-lg font-semibold flex items-center gap-2 border-b pb-2">
                          <StickyNote className="w-5 h-5" />
                          Admin Notes
                        </h3>
                        <div className="p-4 bg-muted/30 rounded-lg">
                          <p className="text-sm whitespace-pre-wrap">{viewingClient.admin_notes}</p>
                        </div>
                      </div>
                    )}

                    {/* Account Details */}
                    <div className="space-y-4 pt-4 border-t">
                      <h3 className="text-lg font-semibold border-b pb-2">Account Details</h3>
                      <div className="grid md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <Label className="text-sm text-muted-foreground">Member Since</Label>
                          <p className="font-medium">{format(new Date(viewingClient.created_at), "MMMM d, yyyy")}</p>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-sm text-muted-foreground">Total Rentals</Label>
                          <p className="font-medium">{viewingClient.total_rentals_completed} completed</p>
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="rentals" className="space-y-4 mt-6">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <History className="w-5 h-5" />
                        Rental History
                      </h3>
                      <div className="flex gap-2">
                        <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
                          {viewingClient.active_rentals_count} Active
                        </Badge>
                        <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                          {viewingClient.total_rentals_completed} Completed
                        </Badge>
                      </div>
                    </div>

                    {loadingRentals ? (
                      <div className="space-y-2">
                        {[...Array(3)].map((_, i) => (
                          <Skeleton key={i} className="h-16 w-full" />
                        ))}
                      </div>
                    ) : clientRentals.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <History className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p>No rental history for this client yet.</p>
                      </div>
                    ) : (
                      <div className="border rounded-lg overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Vehicle</TableHead>
                              <TableHead>Pickup Date</TableHead>
                              <TableHead>Dropoff Date</TableHead>
                              <TableHead>Price</TableHead>
                              <TableHead>Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {clientRentals.map((rental) => (
                              <TableRow key={rental.id}>
                                <TableCell className="font-medium">
                                  {rental.vehicles?.name || "N/A"}
                                </TableCell>
                                <TableCell>
                                  {format(new Date(rental.pickup_date), "MMM d, yyyy")}
                                </TableCell>
                                <TableCell>
                                  {rental.dropoff_date ? format(new Date(rental.dropoff_date), "MMM d, yyyy") : "—"}
                                </TableCell>
                                <TableCell>${rental.total_price.toFixed(2)}</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="capitalize">
                                    {rental.status}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-display text-2xl">Delete Client?</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <p>
                  Are you sure you want to delete <strong className="text-foreground">{clientToDelete?.name}</strong>? 
                </p>
                <p className="text-destructive">
                  This will permanently remove the client profile and all associated data. This action cannot be undone.
                </p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={confirmDelete} 
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete Client
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
};

export default ClientsManagement;
