import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Car, Users, Briefcase, PoundSterling, Moon, ChevronRight, Upload, X, Loader2, RefreshCcw, Copy, Search, Filter, Gauge, Fuel, Settings2, Banknote, Minus } from "lucide-react";

interface Vehicle {
  id: string;
  name: string;
  category: string;
  description: string;
  capacity: number;
  luggage_capacity: number;
  daily_rate: number;
  weekly_rate: number;
  monthly_rate: number;
  registration_number: string | null;
  current_mileage: number | null;
  insurance_expiry_date: string | null;
  service_due_date: string | null;
  transmission_type: string;
  fuel_type: string;
  deposit_required: number;
  service_status: string;
  is_active: boolean;
  image_url: string | null;
}

const VehiclesManagement = () => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [filteredVehicles, setFilteredVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [vehicleToDelete, setVehicleToDelete] = useState<Vehicle | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [formData, setFormData] = useState({
    name: "",
    category: "",
    description: "",
    capacity: 4,
    luggage_capacity: 3,
    daily_rate: 100,
    weekly_rate: 600,
    monthly_rate: 2000,
    registration_number: "",
    current_mileage: 0,
    insurance_expiry_date: "",
    service_due_date: "",
    transmission_type: "Automatic",
    fuel_type: "Petrol",
    deposit_required: 500,
    service_status: "operational",
    is_active: true,
    image_url: null as string | null,
  });

  useEffect(() => {
    loadVehicles();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [vehicles, searchTerm, categoryFilter, statusFilter]);

  const loadVehicles = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("vehicles")
      .select("*", { count: 'exact', head: false })
      .order("name");

    if (error) {
      toast.error("Failed to load vehicles");
    } else {
      setVehicles(data || []);
      setLastUpdated(new Date());
    }
    setLoading(false);
  };

  const applyFilters = () => {
    let filtered = [...vehicles];

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(v => 
        v.name.toLowerCase().includes(term) ||
        v.category.toLowerCase().includes(term) ||
        v.registration_number?.toLowerCase().includes(term)
      );
    }

    // Category filter
    if (categoryFilter !== "all") {
      filtered = filtered.filter(v => v.category === categoryFilter);
    }

    // Status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter(v => v.service_status === statusFilter);
    }

    setFilteredVehicles(filtered);
  };

  const getUniqueCategories = () => {
    return Array.from(new Set(vehicles.map(v => v.category))).sort();
  };

  const handleDuplicate = (vehicle: Vehicle) => {
    setEditingVehicle(null);
    setFormData({
      name: `${vehicle.name} (Copy)`,
      category: vehicle.category,
      description: vehicle.description,
      capacity: vehicle.capacity,
      luggage_capacity: vehicle.luggage_capacity,
      daily_rate: vehicle.daily_rate,
      weekly_rate: vehicle.weekly_rate,
      monthly_rate: vehicle.monthly_rate,
      registration_number: vehicle.registration_number || "",
      current_mileage: vehicle.current_mileage || 0,
      insurance_expiry_date: vehicle.insurance_expiry_date || "",
      service_due_date: vehicle.service_due_date || "",
      transmission_type: vehicle.transmission_type,
      fuel_type: vehicle.fuel_type,
      deposit_required: vehicle.deposit_required,
      service_status: vehicle.service_status,
      is_active: vehicle.is_active,
      image_url: vehicle.image_url,
    });
    setImagePreview(vehicle.image_url);
    setDialogOpen(true);
  };

  const uploadImage = async (file: File): Promise<string | null> => {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = fileName;

      const { error: uploadError, data } = await supabase.storage
        .from('vehicle-images')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        throw uploadError;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('vehicle-images')
        .getPublicUrl(filePath);

      return publicUrl;
    } catch (error) {
      console.error('Error uploading image:', error);
      toast.error('Failed to upload image');
      return null;
    }
  };

  const deleteImage = async (imageUrl: string) => {
    try {
      const path = imageUrl.split('/vehicle-images/')[1];
      if (path) {
        await supabase.storage.from('vehicle-images').remove([path]);
      }
    } catch (error) {
      console.error('Error deleting image:', error);
    }
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 3 * 1024 * 1024) {
        toast.error('Image must be under 3MB');
        return;
      }
      
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        toast.error('Please upload JPG, PNG, or WEBP');
        return;
      }

      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setFormData({ ...formData, image_url: null });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploading(true);

    try {
      let imageUrl = formData.image_url;

      // Upload new image if selected
      if (imageFile) {
        // Delete old image if updating
        if (editingVehicle?.image_url) {
          await deleteImage(editingVehicle.image_url);
        }
        
        imageUrl = await uploadImage(imageFile);
        if (!imageUrl) {
          setUploading(false);
          return;
        }
      }

      const vehicleData = {
        ...formData,
        image_url: imageUrl,
      };

      if (editingVehicle) {
        const { error } = await supabase
          .from("vehicles")
          .update(vehicleData)
          .eq("id", editingVehicle.id);

        if (error) {
          toast.error("Failed to update vehicle");
          setUploading(false);
          return;
        }
        
        // Optimistic UI update
        setVehicles(prev => prev.map(v => 
          v.id === editingVehicle.id ? { ...v, ...vehicleData } : v
        ));
        
        toast.success("Vehicle updated successfully");
      } else {
        const { data, error } = await supabase
          .from("vehicles")
          .insert(vehicleData)
          .select()
          .single();

        if (error) {
          toast.error("Failed to create vehicle");
          setUploading(false);
          return;
        }
        
        // Optimistic UI update
        setVehicles(prev => [...prev, data]);
        toast.success("Vehicle created successfully");
      }

      setDialogOpen(false);
      resetForm();
    } catch (error) {
      toast.error("An error occurred");
      console.error(error);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteClick = (vehicle: Vehicle) => {
    setVehicleToDelete(vehicle);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!vehicleToDelete) return;

    try {
      // Delete image from storage if exists
      if (vehicleToDelete.image_url) {
        await deleteImage(vehicleToDelete.image_url);
      }

      const { error } = await supabase
        .from("vehicles")
        .delete()
        .eq("id", vehicleToDelete.id);

      if (error) {
        toast.error("Failed to delete vehicle");
        return;
      }

      toast.success("Vehicle removed successfully");
      loadVehicles();
    } catch (error) {
      toast.error("An error occurred");
      console.error(error);
    } finally {
      setDeleteDialogOpen(false);
      setVehicleToDelete(null);
    }
  };

  const handleEdit = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle);
    setFormData({
      name: vehicle.name,
      category: vehicle.category,
      description: vehicle.description,
      capacity: vehicle.capacity,
      luggage_capacity: vehicle.luggage_capacity,
      daily_rate: vehicle.daily_rate,
      weekly_rate: vehicle.weekly_rate,
      monthly_rate: vehicle.monthly_rate,
      registration_number: vehicle.registration_number || "",
      current_mileage: vehicle.current_mileage || 0,
      insurance_expiry_date: vehicle.insurance_expiry_date || "",
      service_due_date: vehicle.service_due_date || "",
      transmission_type: vehicle.transmission_type || "Automatic",
      fuel_type: vehicle.fuel_type || "Petrol",
      deposit_required: vehicle.deposit_required || 500,
      service_status: vehicle.service_status || "operational",
      is_active: vehicle.is_active,
      image_url: vehicle.image_url,
    });
    setImagePreview(vehicle.image_url);
    setDialogOpen(true);
  };

  const resetForm = () => {
    setEditingVehicle(null);
    setImageFile(null);
    setImagePreview(null);
    setFormData({
      name: "",
      category: "",
      description: "",
      capacity: 4,
      luggage_capacity: 3,
      daily_rate: 100,
      weekly_rate: 600,
      monthly_rate: 2000,
      registration_number: "",
      current_mileage: 0,
      insurance_expiry_date: "",
      service_due_date: "",
      transmission_type: "Automatic",
      fuel_type: "Petrol",
      deposit_required: 500,
      service_status: "operational",
      is_active: true,
      image_url: null,
    });
  };

  if (loading) {
    return (
      <TooltipProvider>
        <div className="space-y-6 animate-fade-in">
          {/* Header */}
          <div className="space-y-2">
            <Skeleton className="h-10 w-96" />
            <Skeleton className="h-4 w-full max-w-2xl" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="overflow-hidden">
                <Skeleton className="h-48 w-full" />
                <CardContent className="p-8 space-y-4">
                  <Skeleton className="h-8 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-16 w-full" />
                  <div className="grid grid-cols-2 gap-3">
                    <Skeleton className="h-20" />
                    <Skeleton className="h-20" />
                    <Skeleton className="h-20" />
                    <Skeleton className="h-20" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-display font-bold text-gradient-metal mb-2">Vehicles Management</h1>
            <p className="text-muted-foreground">
              Maintain and manage your active vehicle fleet, pricing, and operational details.
            </p>
          </div>
          
          <div className="flex gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={loadVehicles} variant="outline" className="gap-2">
                  <RefreshCcw className="w-4 h-4" />
                  Refresh
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Reload vehicles data</p>
              </TooltipContent>
            </Tooltip>
            
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DialogTrigger asChild>
                    <Button className="gradient-accent shadow-glow" onClick={resetForm}>
                      <Plus className="w-4 h-4 mr-2" />
                      Add Vehicle
                    </Button>
                  </DialogTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Add new vehicle to fleet</p>
                </TooltipContent>
              </Tooltip>
              <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-background">
              <DialogHeader className="border-b border-border/50 pb-4">
                <DialogTitle className="text-2xl font-display font-bold text-white">
                  {editingVehicle ? "Edit Vehicle" : "Add Vehicle"}
                </DialogTitle>
                <DialogDescription className="text-[#CCCCCC]">
                  Complete all required fields to {editingVehicle ? "update" : "add"} vehicle to fleet
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-8 py-4">
                {/* Section 1: Vehicle Info */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-white">Vehicle Info</h3>
                  <div className="space-y-4 pl-4 border-l-2 border-border/30">
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="name" className="text-sm text-[#CCCCCC]">
                          Vehicle Name <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id="name"
                          placeholder="e.g., Toyota Camry"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          className="bg-[#2A2A2A] border-border focus-visible:ring-[#F5B942] focus-visible:border-[#F5B942]"
                          autoFocus
                          required
                        />
                        <p className="text-xs text-muted-foreground">Enter the vehicle make and model</p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="category" className="text-sm text-[#CCCCCC]">
                          Category <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id="category"
                          placeholder="e.g., Sedan, SUV, Compact"
                          value={formData.category}
                          onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                          className="bg-[#2A2A2A] border-border focus-visible:ring-[#F5B942] focus-visible:border-[#F5B942]"
                          required
                        />
                        <p className="text-xs text-muted-foreground">Vehicle type classification</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="description" className="text-sm text-[#CCCCCC]">Description</Label>
                      <Textarea
                        id="description"
                        placeholder="Brief description of vehicle and features"
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        className="bg-[#2A2A2A] border-border focus-visible:ring-[#F5B942] focus-visible:border-[#F5B942]"
                        rows={3}
                      />
                    </div>

                    {/* Image Upload Section */}
                    <div className="space-y-2">
                      <Label className="text-sm text-[#CCCCCC]">Upload Vehicle Image</Label>
                      <p className="text-xs text-muted-foreground">JPG, PNG, or WEBP (max 3MB)</p>
                      
                      {imagePreview ? (
                        <div className="relative">
                          <img
                            src={imagePreview}
                            alt="Vehicle preview"
                            className="w-full h-40 object-cover rounded-lg border-2 border-border"
                          />
                          <div className="absolute top-2 right-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              onClick={removeImage}
                              className="gap-2"
                            >
                              <X className="w-4 h-4" />
                              Remove
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="border-2 border-dashed border-border/60 rounded-lg p-6 text-center hover:border-[#F5B942]/50 transition-colors bg-[#2A2A2A]/30">
                          <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                          <div className="space-y-1">
                            <Label htmlFor="image-upload" className="cursor-pointer">
                              <span className="text-[#F5B942] hover:underline">Choose file</span>
                              <span className="text-muted-foreground"> or drag and drop</span>
                            </Label>
                            <Input
                              id="image-upload"
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              onChange={handleImageChange}
                              className="hidden"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Section 2: Specifications */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-white">Specifications</h3>
                  <div className="space-y-4 pl-4 border-l-2 border-border/30">
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="capacity" className="text-sm text-[#CCCCCC]">
                          Passenger Capacity <span className="text-destructive">*</span>
                        </Label>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-10 w-10 bg-[#2A2A2A] hover:bg-[#333333]"
                            onClick={() => setFormData({ ...formData, capacity: Math.max(1, formData.capacity - 1) })}
                          >
                            <Minus className="w-4 h-4" />
                          </Button>
                          <Input
                            id="capacity"
                            type="number"
                            value={formData.capacity}
                            onChange={(e) => setFormData({ ...formData, capacity: parseInt(e.target.value) || 1 })}
                            className="bg-[#2A2A2A] border-border focus-visible:ring-[#F5B942] focus-visible:border-[#F5B942] text-center"
                            min="1"
                            required
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-10 w-10 bg-[#2A2A2A] hover:bg-[#333333]"
                            onClick={() => setFormData({ ...formData, capacity: formData.capacity + 1 })}
                          >
                            <Plus className="w-4 h-4" />
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">Number of passengers</p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="luggage" className="text-sm text-[#CCCCCC]">
                          Luggage Capacity <span className="text-destructive">*</span>
                        </Label>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-10 w-10 bg-[#2A2A2A] hover:bg-[#333333]"
                            onClick={() => setFormData({ ...formData, luggage_capacity: Math.max(0, formData.luggage_capacity - 1) })}
                          >
                            <Minus className="w-4 h-4" />
                          </Button>
                          <Input
                            id="luggage"
                            type="number"
                            value={formData.luggage_capacity}
                            onChange={(e) => setFormData({ ...formData, luggage_capacity: parseInt(e.target.value) || 0 })}
                            className="bg-[#2A2A2A] border-border focus-visible:ring-[#F5B942] focus-visible:border-[#F5B942] text-center"
                            min="0"
                            required
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-10 w-10 bg-[#2A2A2A] hover:bg-[#333333]"
                            onClick={() => setFormData({ ...formData, luggage_capacity: formData.luggage_capacity + 1 })}
                          >
                            <Plus className="w-4 h-4" />
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">Number of bags/suitcases</p>
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="transmission" className="text-sm text-[#CCCCCC]">
                          Transmission Type <span className="text-destructive">*</span>
                        </Label>
                        <Select
                          value={formData.transmission_type}
                          onValueChange={(value) => setFormData({ ...formData, transmission_type: value })}
                        >
                          <SelectTrigger id="transmission" className="bg-[#2A2A2A] border-border focus:ring-[#F5B942]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Automatic">Automatic</SelectItem>
                            <SelectItem value="Manual">Manual</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="fuel" className="text-sm text-[#CCCCCC]">
                          Fuel Type <span className="text-destructive">*</span>
                        </Label>
                        <Select
                          value={formData.fuel_type}
                          onValueChange={(value) => setFormData({ ...formData, fuel_type: value })}
                        >
                          <SelectTrigger id="fuel" className="bg-[#2A2A2A] border-border focus:ring-[#F5B942]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Petrol">Petrol</SelectItem>
                            <SelectItem value="Diesel">Diesel</SelectItem>
                            <SelectItem value="Hybrid">Hybrid</SelectItem>
                            <SelectItem value="Electric">Electric</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section 3: Maintenance Details */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-white">Maintenance Details</h3>
                  <div className="space-y-4 pl-4 border-l-2 border-border/30">
                    <div className="space-y-2">
                      <Label htmlFor="registration" className="text-sm text-[#CCCCCC]">
                        Registration Number
                      </Label>
                      <Input
                        id="registration"
                        value={formData.registration_number}
                        onChange={(e) => setFormData({ ...formData, registration_number: e.target.value })}
                        placeholder="e.g., AB12CDE"
                        className="bg-[#2A2A2A] border-border focus-visible:ring-[#F5B942] focus-visible:border-[#F5B942]"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="mileage" className="text-sm text-[#CCCCCC]">
                        Current Mileage
                      </Label>
                      <Input
                        id="mileage"
                        type="number"
                        value={formData.current_mileage}
                        onChange={(e) => setFormData({ ...formData, current_mileage: parseInt(e.target.value) || 0 })}
                        placeholder="0"
                        className="bg-[#2A2A2A] border-border focus-visible:ring-[#F5B942] focus-visible:border-[#F5B942]"
                      />
                      <p className="text-xs text-muted-foreground">Current odometer reading</p>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="insurance" className="text-sm text-[#CCCCCC]">
                          Insurance Expiry Date
                        </Label>
                        <Input
                          id="insurance"
                          type="date"
                          value={formData.insurance_expiry_date}
                          onChange={(e) => setFormData({ ...formData, insurance_expiry_date: e.target.value })}
                          className="bg-[#2A2A2A] border-border focus-visible:ring-[#F5B942] focus-visible:border-[#F5B942]"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="service" className="text-sm text-[#CCCCCC]">
                          Service Due Date
                        </Label>
                        <Input
                          id="service"
                          type="date"
                          value={formData.service_due_date}
                          onChange={(e) => setFormData({ ...formData, service_due_date: e.target.value })}
                          className="bg-[#2A2A2A] border-border focus-visible:ring-[#F5B942] focus-visible:border-[#F5B942]"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section 4: Pricing & Availability */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-white">Pricing & Availability</h3>
                  <div className="space-y-4 pl-4 border-l-2 border-border/30">
                    <div className="grid md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="daily" className="text-sm text-[#CCCCCC]">
                          Daily Rate ($) <span className="text-destructive">*</span>
                        </Label>
                        <div className="relative">
                          <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                          <Input
                            id="daily"
                            type="number"
                            step="0.01"
                            value={formData.daily_rate}
                            onChange={(e) => setFormData({ ...formData, daily_rate: parseFloat(e.target.value) || 0 })}
                            className="bg-[#2A2A2A] border-border focus-visible:ring-[#F5B942] focus-visible:border-[#F5B942] pl-8"
                            min="0"
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="weekly" className="text-sm text-[#CCCCCC]">
                          Weekly Rate ($) <span className="text-destructive">*</span>
                        </Label>
                        <div className="relative">
                          <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                          <Input
                            id="weekly"
                            type="number"
                            step="0.01"
                            value={formData.weekly_rate}
                            onChange={(e) => setFormData({ ...formData, weekly_rate: parseFloat(e.target.value) || 0 })}
                            className="bg-[#2A2A2A] border-border focus-visible:ring-[#F5B942] focus-visible:border-[#F5B942] pl-8"
                            min="0"
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="monthly" className="text-sm text-[#CCCCCC]">
                          Monthly Rate ($) <span className="text-destructive">*</span>
                        </Label>
                        <div className="relative">
                          <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                          <Input
                            id="monthly"
                            type="number"
                            step="0.01"
                            value={formData.monthly_rate}
                            onChange={(e) => setFormData({ ...formData, monthly_rate: parseFloat(e.target.value) || 0 })}
                            className="bg-[#2A2A2A] border-border focus-visible:ring-[#F5B942] focus-visible:border-[#F5B942] pl-8"
                            min="0"
                            required
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="deposit" className="text-sm text-[#CCCCCC]">
                          Deposit Required ($) <span className="text-destructive">*</span>
                        </Label>
                        <div className="relative">
                          <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                          <Input
                            id="deposit"
                            type="number"
                            step="0.01"
                            value={formData.deposit_required}
                            onChange={(e) => setFormData({ ...formData, deposit_required: parseFloat(e.target.value) || 0 })}
                            className="bg-[#2A2A2A] border-border focus-visible:ring-[#F5B942] focus-visible:border-[#F5B942] pl-8"
                            min="0"
                            required
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">Security deposit amount</p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="status" className="text-sm text-[#CCCCCC]">
                          Service Status <span className="text-destructive">*</span>
                        </Label>
                        <Select
                          value={formData.service_status}
                          onValueChange={(value) => setFormData({ ...formData, service_status: value })}
                        >
                          <SelectTrigger id="status" className="bg-[#2A2A2A] border-border focus:ring-[#F5B942]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="operational">Active</SelectItem>
                            <SelectItem value="maintenance">Maintenance</SelectItem>
                            <SelectItem value="retired">Retired</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 pt-2">
                      <Switch
                        id="active"
                        checked={formData.is_active}
                        onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                      />
                      <Label htmlFor="active" className="text-sm text-[#CCCCCC] cursor-pointer">
                        Active Status (visible on website)
                      </Label>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-4 border-t border-border/50">
                  <Button 
                    type="submit" 
                    className="bg-[#F5B942] text-black hover:bg-[#F5B942]/90 hover:shadow-[0_0_20px_rgba(245,185,66,0.3)] font-medium"
                    disabled={uploading}
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>{editingVehicle ? "Update Vehicle" : "Create Vehicle"}</>
                    )}
                  </Button>
                  <Button 
                    type="button" 
                    variant="outline" 
                    className="border-border bg-transparent hover:bg-[#2A2A2A]"
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

        {/* Filters Section */}
        {vehicles.length > 0 && (
          <Card className="p-6">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search vehicles by name, category, or registration..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-full md:w-[200px]">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Vehicle Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {getUniqueCategories().map(cat => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full md:w-[200px]">
                  <Settings2 className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="operational">Active</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                  <SelectItem value="retired">Retired</SelectItem>
                </SelectContent>
              </Select>

              {(searchTerm || categoryFilter !== "all" || statusFilter !== "all") && (
                <Button variant="outline" onClick={() => {
                  setSearchTerm("");
                  setCategoryFilter("all");
                  setStatusFilter("all");
                }}>
                  Clear Filters
                </Button>
              )}
            </div>
            
            <div className="mt-3 text-sm text-muted-foreground">
              Showing {filteredVehicles.length} of {vehicles.length} vehicles
            </div>
          </Card>
        )}

        {/* Empty State */}
        {vehicles.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center py-20 px-4">
            <div className="rounded-full bg-muted/50 p-6 mb-6">
              <Car className="w-16 h-16 text-muted-foreground/50" />
            </div>
            <h3 className="text-2xl font-display font-bold mb-2">No vehicles in fleet</h3>
            <p className="text-muted-foreground mb-6 text-center max-w-md">
              Upload your first vehicle to make it available for booking.
            </p>
            <Button className="gradient-accent shadow-glow" onClick={() => setDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Vehicle
            </Button>
          </div>
        ) : filteredVehicles.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center py-20 px-4">
            <div className="rounded-full bg-muted/50 p-6 mb-6">
              <Filter className="w-16 h-16 text-muted-foreground/50" />
            </div>
            <h3 className="text-2xl font-display font-bold mb-2">No vehicles match your filters</h3>
            <p className="text-muted-foreground mb-6 text-center max-w-md">
              Try adjusting your search or filter criteria.
            </p>
            <Button variant="outline" onClick={() => {
              setSearchTerm("");
              setCategoryFilter("all");
              setStatusFilter("all");
            }}>
              Clear All Filters
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredVehicles.map((vehicle, index) => (
              <Card 
                key={vehicle.id} 
                className="relative overflow-hidden flex flex-col transition-all duration-300 hover:shadow-[0_0_30px_rgba(244,197,66,0.15)] hover:scale-[1.02] hover:border-accent/40 border-2 animate-fade-in"
                style={{ animationDelay: `${index * 100}ms` }}
              >
                {/* Status Badge */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge 
                      variant={vehicle.is_active ? "default" : "secondary"}
                      className={`absolute top-4 right-4 z-10 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg ${
                        vehicle.is_active 
                          ? "bg-white text-green-400 border border-green-500/30 shadow-[0_0_10px_rgba(34,197,94,0.3)]" 
                          : "bg-muted text-muted-foreground border"
                      }`}
                    >
                      {vehicle.is_active ? "🟢 Active" : "🔴 Inactive"}
                    </Badge>
                  </TooltipTrigger>
                </Tooltip>

                {/* Vehicle Image */}
                <div className="h-48 w-full bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center overflow-hidden">
                {vehicle.image_url ? (
                    <img
                      src={`${vehicle.image_url}?t=${lastUpdated.getTime()}`}
                      alt={vehicle.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <Upload className="h-16 w-16 text-muted-foreground/30" />
                      <p className="text-xs text-muted-foreground/50">Upload Vehicle Image</p>
                    </div>
                  )}
                </div>

                {/* Card Content */}
                <CardContent className="p-8 flex-1 flex flex-col space-y-4">
                  {/* Vehicle Name & Category */}
                  <div className="space-y-2">
                    <h3 className="text-2xl font-bold font-display leading-tight">{vehicle.name}</h3>
                    <p className="text-sm text-accent font-medium">{vehicle.category}</p>
                    <div className="h-px w-16 bg-gradient-to-r from-accent to-transparent"></div>
                  </div>

                  {/* Description */}
                  {vehicle.description && (
                    <p className="text-sm text-muted-foreground/80 line-clamp-2 leading-relaxed">
                      {vehicle.description}
                    </p>
                  )}

                  {/* Details Grid */}
                  <div className="grid grid-cols-2 gap-3 flex-1">
                    {vehicle.registration_number && (
                      <div className="col-span-2 p-3 rounded-lg bg-muted/50 space-y-1.5">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Car className="h-3.5 w-3.5" />
                          <span>Registration</span>
                        </div>
                        <p className="font-semibold text-foreground uppercase">{vehicle.registration_number}</p>
                      </div>
                    )}

                    <div className="p-3 rounded-lg bg-muted/50 space-y-1.5 transition-colors hover:bg-muted/70">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Gauge className="h-3.5 w-3.5" />
                        <span>Transmission</span>
                      </div>
                      <p className="font-semibold text-foreground">{vehicle.transmission_type}</p>
                    </div>

                    <div className="p-3 rounded-lg bg-muted/50 space-y-1.5 transition-colors hover:bg-muted/70">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Fuel className="h-3.5 w-3.5" />
                        <span>Fuel Type</span>
                      </div>
                      <p className="font-semibold text-foreground">{vehicle.fuel_type}</p>
                    </div>

                    {vehicle.current_mileage !== null && vehicle.current_mileage > 0 && (
                      <div className="col-span-2 p-3 rounded-lg bg-muted/50 space-y-1.5">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Gauge className="h-3.5 w-3.5" />
                          <span>Mileage</span>
                        </div>
                        <p className="font-semibold text-foreground">{vehicle.current_mileage.toLocaleString()} mi</p>
                      </div>
                    )}

                    <div className="p-3 rounded-lg bg-muted/50 space-y-1.5 transition-colors hover:bg-muted/70">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Users className="h-3.5 w-3.5" />
                        <span>Capacity</span>
                      </div>
                      <p className="font-semibold text-foreground">{vehicle.capacity} pass.</p>
                    </div>

                    <div className="p-3 rounded-lg bg-muted/50 space-y-1.5 transition-colors hover:bg-muted/70">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Briefcase className="h-3.5 w-3.5" />
                        <span>Luggage</span>
                      </div>
                      <p className="font-semibold text-foreground">{vehicle.luggage_capacity} items</p>
                    </div>

                    <div className="p-3 rounded-lg bg-muted/50 space-y-1.5 transition-colors hover:bg-muted/70">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <PoundSterling className="h-3.5 w-3.5" />
                        <span>Daily</span>
                      </div>
                      <p className="font-semibold text-foreground">${vehicle.daily_rate?.toFixed(2) || "0.00"}</p>
                    </div>

                    <div className="p-3 rounded-lg bg-muted/50 space-y-1.5 transition-colors hover:bg-muted/70">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <PoundSterling className="h-3.5 w-3.5" />
                        <span>Weekly</span>
                      </div>
                      <p className="font-semibold text-foreground">${vehicle.weekly_rate?.toFixed(2) || "0.00"}</p>
                    </div>

                    <div className="p-3 rounded-lg bg-muted/50 space-y-1.5 transition-colors hover:bg-muted/70">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <PoundSterling className="h-3.5 w-3.5" />
                        <span>Monthly</span>
                      </div>
                      <p className="font-semibold text-foreground">${vehicle.monthly_rate?.toFixed(2) || "0.00"}</p>
                    </div>

                    <div className="p-3 rounded-lg bg-muted/50 space-y-1.5 transition-colors hover:bg-muted/70">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Banknote className="h-3.5 w-3.5" />
                        <span>Deposit</span>
                      </div>
                      <p className="font-semibold text-foreground">${vehicle.deposit_required?.toFixed(2) || "0.00"}</p>
                    </div>
                  </div>

                  {/* Action Bar Footer */}
                  <div className="flex justify-end items-center gap-2 pt-4 border-t mt-auto">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleDuplicate(vehicle)}
                          className="hover:border-accent/50 hover:text-accent transition-all hover:scale-110"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Duplicate Vehicle</p>
                      </TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleEdit(vehicle)}
                          className="hover:border-accent/50 hover:text-accent hover:text-white transition-all hover:scale-110"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Edit Vehicle</p>
                      </TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleDeleteClick(vehicle)}
                          className="hover:border-destructive hover:text-destructive transition-all hover:scale-110"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Remove Vehicle</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-2xl font-display">Remove Vehicle?</AlertDialogTitle>
              <AlertDialogDescription className="space-y-4">
                <p>
                  Are you sure you want to remove <span className="font-semibold text-foreground">{vehicleToDelete?.name}</span>? 
                  This will also remove it from the website booking options and cannot be undone.
                </p>
                {vehicleToDelete?.image_url && (
                  <div className="rounded-lg overflow-hidden border">
                    <img
                      src={vehicleToDelete.image_url}
                      alt={vehicleToDelete.name}
                      className="w-full h-32 object-cover"
                    />
                  </div>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Remove Vehicle
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
};

export default VehiclesManagement;
