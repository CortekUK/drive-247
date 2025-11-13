import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Edit, Trash2, Search, RefreshCw, Package, MapPin, Car, ArrowUpDown, List } from "lucide-react";

type PricingExtra = {
  id: string;
  extra_name: string;
  description: string;
  price: number;
  price_type: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type ServiceInclusion = {
  id: string;
  title: string;
  icon_name: string;
  category: 'standard' | 'premium';
  display_order: number;
  is_active: boolean;
  created_at: string;
};

type Vehicle = {
  id: string;
  name: string;
  image_url: string | null;
  base_price_per_mile: number;
  overnight_surcharge: number;
  is_active: boolean;
};

const PricingManagement = () => {
  const [extras, setExtras] = useState<PricingExtra[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [serviceInclusions, setServiceInclusions] = useState<ServiceInclusion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [extrasRes, vehiclesRes, inclusionsRes] = await Promise.all([
        supabase.from("pricing_extras").select("*").order("extra_name"),
        supabase.from("vehicles").select("*").eq("is_active", true).order("name"),
        supabase.from("service_inclusions").select("*").order("category, display_order")
      ]);

      if (extrasRes.data) setExtras(extrasRes.data);
      if (vehiclesRes.data) setVehicles(vehiclesRes.data);
      if (inclusionsRes.data) setServiceInclusions(inclusionsRes.data);
    } catch (error) {
      toast.error("Failed to load pricing data");
    } finally {
      setLoading(false);
    }
  };

  const logAudit = async (action: string, tableName: string, recordId: string, oldValues: any, newValues: any) => {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("audit_logs").insert({
      user_id: user?.id,
      action,
      table_name: tableName,
      record_id: recordId,
      old_values: oldValues,
      new_values: newValues
    });
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-6 w-96" />
        <Skeleton className="h-12 w-full" />
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-gradient-metal mb-2">Pricing Management</h1>
          <p className="text-muted-foreground">
            Manage service pricing, extras, and vehicle rates for automated booking calculations.
          </p>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                <RefreshCw className="w-4 h-4 mr-2" />
                Sync to Booking Engine
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Push latest prices to the live booking calculator</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="extras" className="space-y-6">
        <TabsList className="bg-card border border-border">
          <TabsTrigger
            value="extras"
            className="data-[state=active]:bg-accent/10 data-[state=active]:text-accent data-[state=active]:border-b-2 data-[state=active]:border-accent"
          >
            <Package className="w-4 h-4 mr-2" />
            Pricing Extras
          </TabsTrigger>
          <TabsTrigger
            value="vehicle-rates"
            className="data-[state=active]:bg-accent/10 data-[state=active]:text-accent data-[state=active]:border-b-2 data-[state=active]:border-accent"
          >
            <Car className="w-4 h-4 mr-2" />
            Vehicle Rates
          </TabsTrigger>
          <TabsTrigger
            value="service-inclusions"
            className="data-[state=active]:bg-accent/10 data-[state=active]:text-accent data-[state=active]:border-b-2 data-[state=active]:border-accent"
          >
            <List className="w-4 h-4 mr-2" />
            Service Inclusions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="extras" className="space-y-4">
          <PricingExtras extras={extras} loadData={loadData} logAudit={logAudit} />
        </TabsContent>

        <TabsContent value="vehicle-rates" className="space-y-4">
          <VehicleRates vehicles={vehicles} loadData={loadData} logAudit={logAudit} />
        </TabsContent>

        <TabsContent value="service-inclusions" className="space-y-4">
          <ServiceInclusions serviceInclusions={serviceInclusions} loadData={loadData} logAudit={logAudit} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

// ============= PRICING EXTRAS TAB =============
const PricingExtras = ({ extras, loadData, logAudit }: { 
  extras: PricingExtra[]; 
  loadData: () => void; 
  logAudit: (action: string, tableName: string, recordId: string, oldValues: any, newValues: any) => Promise<void>;
}) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PricingExtra | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [formData, setFormData] = useState({
    extra_name: "",
    price: 0,
    price_type: "fixed",
    description: "",
    is_active: true
  });

  const filteredExtras = useMemo(() => {
    return extras.filter(extra =>
      extra.extra_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      extra.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [extras, searchQuery]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.price < 0) {
      toast.error("Price must be 0 or greater");
      return;
    }

    try {
      const oldValues = editing ? { ...editing } : null;

      if (editing) {
        const { error } = await supabase
          .from("pricing_extras")
          .update(formData)
          .eq("id", editing.id);

        if (error) throw error;

        await logAudit("UPDATE", "pricing_extras", editing.id, oldValues, formData);
        toast.success("Extra updated successfully");
      } else {
        const { data, error } = await supabase
          .from("pricing_extras")
          .insert(formData)
          .select()
          .single();

        if (error) throw error;
        if (data) await logAudit("INSERT", "pricing_extras", data.id, null, formData);

        toast.success("Extra saved successfully");
      }

      setDialogOpen(false);
      setEditing(null);
      setFormData({ extra_name: "", price: 0, price_type: "fixed", description: "", is_active: true });
      loadData();
    } catch (error: any) {
      console.error("Save error:", error);
      toast.error(error?.message || "Failed to save extra");
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;

    try {
      const extra = extras.find(e => e.id === deletingId);
      const { error } = await supabase
        .from("pricing_extras")
        .delete()
        .eq("id", deletingId);
      
      if (error) throw error;
      
      await logAudit("DELETE", "pricing_extras", deletingId, extra, null);
      toast.success("Extra removed successfully");
      loadData();
    } catch (error) {
      toast.error("Failed to delete extra");
    } finally {
      setDeleteDialogOpen(false);
      setDeletingId(null);
    }
  };

  const openEditDialog = (extra: PricingExtra) => {
    setEditing(extra);
    setFormData({
      extra_name: extra.extra_name,
      price: extra.price,
      price_type: extra.price_type,
      description: extra.description || "",
      is_active: extra.is_active
    });
    setDialogOpen(true);
  };

  return (
    <>
      {/* Search and Add */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search extras..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button
              className="gradient-accent shadow-glow"
              onClick={() => {
                setEditing(null);
                setFormData({ extra_name: "", price: 0, price_type: "fixed", description: "", is_active: true });
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Extra
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit" : "Add"} Pricing Extra</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="extra_name">
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="extra_name"
                  value={formData.extra_name}
                  onChange={(e) => setFormData({ ...formData, extra_name: e.target.value })}
                  placeholder="e.g., Meet & Greet"
                  required
                  className="focus:ring-2 focus:ring-accent"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="price">
                  Price ($) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                  placeholder="0.00"
                  required
                  className="focus:ring-2 focus:ring-accent"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="price_type">Price Type <span className="text-destructive">*</span></Label>
                <Select
                  value={formData.price_type}
                  onValueChange={(value) => setFormData({ ...formData, price_type: value })}
                  required
                >
                  <SelectTrigger id="price_type" className="focus:ring-2 focus:ring-accent">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Fixed</SelectItem>
                    <SelectItem value="per_hour">Per Hour</SelectItem>
                    <SelectItem value="per_day">Per Day</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description (Optional)</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Additional details about this extra..."
                  rows={3}
                  className="focus:ring-2 focus:ring-accent resize-none"
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="is_active">Active</Label>
                <Switch
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
              </div>
              
              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} className="flex-1">
                  Cancel
                </Button>
                <Button type="submit" className="flex-1 gradient-accent shadow-glow">
                  Save
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Extras Grid */}
      {filteredExtras.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center">
              <Package className="w-8 h-8 text-accent" />
            </div>
            <div>
              <h3 className="font-display font-semibold text-lg">No extras yet</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Add your first pricing extra to get started
              </p>
            </div>
            <Button 
              className="gradient-accent shadow-glow mt-2" 
              onClick={() => setDialogOpen(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Extra
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredExtras.map((extra) => (
            <Card 
              key={extra.id} 
              className="p-5 hover-lift transition-all duration-300 border-border hover:border-accent/50 hover:shadow-glow"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-display font-semibold text-lg">{extra.extra_name}</h3>
                    <Badge variant="outline" className="text-xs mt-1 w-fit">
                      {extra.price_type === 'fixed' ? 'Fixed Price' : extra.price_type === 'per_hour' ? 'Per Hour' : 'Per Day'}
                    </Badge>
                  </div>
                  {extra.is_active ? (
                    <Badge className="bg-accent/10 text-accent border-accent/20">Active</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
                  )}
                </div>

                <p className="text-3xl font-display font-bold text-accent">
                  ${extra.price.toFixed(2)}
                </p>

                {extra.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {extra.description}
                  </p>
                )}
                
                <div className="flex gap-2 pt-2 border-t border-border">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={() => openEditDialog(extra)}
                          className="flex-1"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Edit extra</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          size="sm" 
                          variant="destructive" 
                          onClick={() => {
                            setDeletingId(extra.id);
                            setDeleteDialogOpen(true);
                          }}
                          className="flex-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Delete extra</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this pricing extra?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The extra will be permanently removed from the system.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

// ============= VEHICLE RATES TAB =============
const VehicleRates = ({ vehicles, loadData, logAudit }: {
  vehicles: Vehicle[];
  loadData: () => void;
  logAudit: (action: string, tableName: string, recordId: string, oldValues: any, newValues: any) => Promise<void>;
}) => {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredVehicles = useMemo(() => {
    return vehicles.filter(vehicle =>
      vehicle.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [vehicles, searchQuery]);

  const handleUpdate = async (vehicleId: string, field: string, value: number) => {
    if (value < 0) {
      toast.error("Value must be 0 or greater");
      return;
    }

    try {
      const vehicle = vehicles.find((v) => v.id === vehicleId);
      const oldValues = { ...vehicle };
      const newValues = { ...vehicle, [field]: value };

      const { error } = await supabase
        .from("vehicles")
        .update({ [field]: value })
        .eq("id", vehicleId);
      
      if (error) throw error;
      
      await logAudit("UPDATE", "vehicles", vehicleId, oldValues, newValues);
      toast.success("Rate updated successfully");
      loadData();
    } catch (error) {
      toast.error("Failed to update rate");
    }
  };

  return (
    <>
      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search vehicles..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Vehicle Rates Grid */}
      {filteredVehicles.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center">
              <Car className="w-8 h-8 text-accent" />
            </div>
            <div>
              <h3 className="font-display font-semibold text-lg">No vehicle rates configured</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Add vehicles to configure their rates
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredVehicles.map((vehicle) => (
            <Card 
              key={vehicle.id} 
              className="p-5 hover-lift transition-all duration-300 border-border hover:border-accent/50"
            >
              <div className="space-y-4">
                {/* Vehicle Image */}
                {vehicle.image_url && (
                  <div className="aspect-video rounded-lg overflow-hidden bg-muted">
                    <img
                      src={vehicle.image_url}
                      alt={vehicle.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                
                {/* Vehicle Name */}
                <h3 className="text-xl font-display font-bold">{vehicle.name}</h3>
                
                {/* Rate Inputs */}
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor={`price-${vehicle.id}`} className="text-xs text-muted-foreground">
                      Price per Mile ($)
                    </Label>
                    <Input
                      id={`price-${vehicle.id}`}
                      type="number"
                      step="0.10"
                      min="0"
                      defaultValue={vehicle.base_price_per_mile}
                      onBlur={(e) => handleUpdate(vehicle.id, "base_price_per_mile", parseFloat(e.target.value) || 0)}
                      className="focus:ring-2 focus:ring-accent"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor={`surcharge-${vehicle.id}`} className="text-xs text-muted-foreground">
                      Overnight Surcharge ($)
                    </Label>
                    <Input
                      id={`surcharge-${vehicle.id}`}
                      type="number"
                      step="1"
                      min="0"
                      defaultValue={vehicle.overnight_surcharge}
                      onBlur={(e) => handleUpdate(vehicle.id, "overnight_surcharge", parseFloat(e.target.value) || 0)}
                      className="focus:ring-2 focus:ring-accent"
                    />
                  </div>
                </div>
                
                <Badge className="bg-accent/10 hover:bg-transparent hover:cursor-pointer text-accent border-accent/20 w-full justify-center">
                  Active
                </Badge>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
};

// ============= SERVICE INCLUSIONS TAB =============
const ServiceInclusions = ({ serviceInclusions, loadData, logAudit }: {
  serviceInclusions: ServiceInclusion[];
  loadData: () => void;
  logAudit: (action: string, tableName: string, recordId: string, oldValues: any, newValues: any) => Promise<void>;
}) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceInclusion | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [formData, setFormData] = useState({
    title: "",
    icon_name: "",
    category: "standard" as 'standard' | 'premium',
    display_order: 0,
    is_active: true
  });

  const availableIcons = [
    'User', 'Fuel', 'Droplets', 'Wifi', 'Plane', 'Shield',
    'Clock', 'Phone', 'GlassWater', 'Sparkles', 'Car',
    'Crown', 'Package', 'MapPin'
  ];

  const filteredInclusions = useMemo(() => {
    return serviceInclusions.filter(inclusion =>
      inclusion.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inclusion.category.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [serviceInclusions, searchQuery]);

  const standardInclusions = useMemo(() =>
    filteredInclusions.filter(inc => inc.category === 'standard'),
    [filteredInclusions]
  );

  const premiumInclusions = useMemo(() =>
    filteredInclusions.filter(inc => inc.category === 'premium'),
    [filteredInclusions]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const oldValues = editing ? { ...editing } : null;

      if (editing) {
        const { error } = await supabase
          .from("service_inclusions")
          .update(formData)
          .eq("id", editing.id);

        if (error) throw error;

        await logAudit("UPDATE", "service_inclusions", editing.id, oldValues, formData);
        toast.success("Service inclusion updated successfully");
      } else {
        const { data, error } = await supabase
          .from("service_inclusions")
          .insert(formData)
          .select()
          .single();

        if (error) throw error;
        if (data) await logAudit("INSERT", "service_inclusions", data.id, null, formData);

        toast.success("Service inclusion added successfully");
      }

      setDialogOpen(false);
      setEditing(null);
      setFormData({ title: "", icon_name: "", category: "standard", display_order: 0, is_active: true });
      loadData();
    } catch (error) {
      toast.error("Failed to save service inclusion");
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;

    try {
      const inclusion = serviceInclusions.find(i => i.id === deletingId);
      const { error } = await supabase
        .from("service_inclusions")
        .delete()
        .eq("id", deletingId);

      if (error) throw error;

      await logAudit("DELETE", "service_inclusions", deletingId, inclusion, null);
      toast.success("Service inclusion removed successfully");
      loadData();
    } catch (error) {
      toast.error("Failed to delete service inclusion");
    } finally {
      setDeleteDialogOpen(false);
      setDeletingId(null);
    }
  };

  const openEditDialog = (inclusion: ServiceInclusion) => {
    setEditing(inclusion);
    setFormData({
      title: inclusion.title,
      icon_name: inclusion.icon_name,
      category: inclusion.category,
      display_order: inclusion.display_order,
      is_active: inclusion.is_active
    });
    setDialogOpen(true);
  };

  return (
    <>
      {/* Search and Add */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search service inclusions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button
              className="gradient-accent shadow-glow"
              onClick={() => {
                setEditing(null);
                setFormData({ title: "", icon_name: "", category: "standard", display_order: 0, is_active: true });
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Service
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit" : "Add"} Service Inclusion</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">
                  Title <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="e.g., Professional chauffeur"
                  required
                  className="focus:ring-2 focus:ring-accent"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="icon_name">
                  Icon <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={formData.icon_name}
                  onValueChange={(value) => setFormData({ ...formData, icon_name: value })}
                  required
                >
                  <SelectTrigger id="icon_name" className="focus:ring-2 focus:ring-accent">
                    <SelectValue placeholder="Select an icon" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableIcons.map((icon) => (
                      <SelectItem key={icon} value={icon}>
                        {icon}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="category">
                  Category <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={formData.category}
                  onValueChange={(value: 'standard' | 'premium') => setFormData({ ...formData, category: value })}
                  required
                >
                  <SelectTrigger id="category" className="focus:ring-2 focus:ring-accent">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard Service</SelectItem>
                    <SelectItem value="premium">Premium Add-ons</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="display_order">
                  Display Order <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="display_order"
                  type="number"
                  min="0"
                  value={formData.display_order}
                  onChange={(e) => setFormData({ ...formData, display_order: e.target.value === '' ? 0 : parseInt(e.target.value) })}
                  placeholder="0"
                  required
                  className="focus:ring-2 focus:ring-accent"
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="is_active">Active</Label>
                <Switch
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} className="flex-1">
                  Cancel
                </Button>
                <Button type="submit" className="flex-1 gradient-accent shadow-glow">
                  Save
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Service Inclusions by Category */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Standard Service */}
        <div className="space-y-4">
          <h3 className="text-xl font-display font-semibold text-gradient-silver">Standard Service</h3>
          {standardInclusions.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-sm text-muted-foreground">No standard services added yet</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {standardInclusions.map((inclusion) => (
                <Card
                  key={inclusion.id}
                  className="p-4 hover-lift transition-all duration-300 border-border hover:border-accent/50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1">
                      <Badge variant="outline" className="text-xs">
                        {inclusion.icon_name}
                      </Badge>
                      <span className="text-sm">{inclusion.title}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        #{inclusion.display_order}
                      </Badge>
                      {inclusion.is_active ? (
                        <Badge className="bg-accent/10 hover:bg-transparent hover:cursor-pointer text-accent border-accent/20 text-xs">Active</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground hover:bg-transparent hover:cursor-pointer text-xs">Inactive</Badge>
                      )}
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openEditDialog(inclusion)}
                            >
                              <Edit className="w-3 h-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setDeletingId(inclusion.id);
                                setDeleteDialogOpen(true);
                              }}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Delete</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Premium Add-ons */}
        <div className="space-y-4">
          <h3 className="text-xl font-display font-semibold text-gradient-silver">Premium Add-ons</h3>
          {premiumInclusions.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-sm text-muted-foreground">No premium add-ons added yet</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {premiumInclusions.map((inclusion) => (
                <Card
                  key={inclusion.id}
                  className="p-4 hover-lift transition-all duration-300 border-border hover:border-accent/50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1">
                      <Badge variant="outline" className="text-xs hover:bg-transparent hover:cursor-pointer">
                        {inclusion.icon_name}
                      </Badge>
                      <span className="text-sm">{inclusion.title}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        #{inclusion.display_order}
                      </Badge>
                      {inclusion.is_active ? (
                        <Badge className="bg-accent/10 hover:bg-transparent hover:cursor-pointer text-accent border-accent/20 text-xs">Active</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground hover:bg-transparent hover:cursor-pointer text-xs">Inactive</Badge>
                      )}
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openEditDialog(inclusion)}
                            >
                              <Edit className="w-3 h-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setDeletingId(inclusion.id);
                                setDeleteDialogOpen(true);
                              }}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Delete</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this service inclusion?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The service inclusion will be permanently removed from the pricing page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default PricingManagement;
