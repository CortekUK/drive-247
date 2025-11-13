import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Edit, Trash2, Search, RefreshCw, Package, List, Car } from "lucide-react";

type PricingExtra = {
  id: string;
  extra_name: string;
  description: string;
  price: number;
  price_type?: string;
  is_active: boolean;
  created_at: string;
};

type Vehicle = {
  id: string;
  name: string;
  category: string;
  daily_rate: number;
  weekly_rate: number;
  monthly_rate: number;
  deposit_required: number;
  is_active: boolean;
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

// Rental-specific extras
const RENTAL_EXTRAS = [
  { name: "GPS Navigation", price: 10, description: "Per day" },
  { name: "Additional Driver", price: 20, description: "Per rental" },
  { name: "Full Insurance", price: 30, description: "Per day" },
  { name: "Child Seat", price: 15, description: "Per rental" },
  { name: "Baby Seat", price: 15, description: "Per rental" },
  { name: "Booster Seat", price: 12, description: "Per rental" },
  { name: "Airport Delivery/Collection", price: 50, description: "One-time fee" },
];

const RentalPricingManagement = () => {
  const [extras, setExtras] = useState<PricingExtra[]>([]);
  const [serviceInclusions, setServiceInclusions] = useState<ServiceInclusion[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [extrasRes, inclusionsRes, vehiclesRes] = await Promise.all([
        supabase.from("pricing_extras").select("*").order("extra_name"),
        supabase.from("service_inclusions").select("*").order("category, display_order"),
        supabase.from("vehicles").select("id, name, category, daily_rate, weekly_rate, monthly_rate, deposit_required, is_active").eq("is_active", true).order("category, name")
      ]);

      if (extrasRes.data) setExtras(extrasRes.data);
      if (inclusionsRes.data) setServiceInclusions(inclusionsRes.data);
      if (vehiclesRes.data) setVehicles(vehiclesRes.data);
    } catch (error) {
      toast.error("Failed to load pricing data");
    } finally {
      setLoading(false);
    }
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
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-gradient-metal mb-2">Rental Pricing</h1>
          <p className="text-muted-foreground">
            Manage rental extras, inclusions, and vehicle rates for automated booking calculations.
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
            Rental Extras
          </TabsTrigger>
          <TabsTrigger
            value="service-inclusions"
            className="data-[state=active]:bg-accent/10 data-[state=active]:text-accent data-[state=active]:border-b-2 data-[state=active]:border-accent"
          >
            <List className="w-4 h-4 mr-2" />
            Service Inclusions
          </TabsTrigger>
          <TabsTrigger
            value="vehicle-rates"
            className="data-[state=active]:bg-accent/10 data-[state=active]:text-accent data-[state=active]:border-b-2 data-[state=active]:border-accent"
          >
            <Car className="w-4 h-4 mr-2" />
            Vehicle Rates
          </TabsTrigger>
        </TabsList>

        <TabsContent value="extras" className="space-y-4">
          <PricingExtras extras={extras} loadData={loadData} />
        </TabsContent>

        <TabsContent value="service-inclusions" className="space-y-4">
          <ServiceInclusionsTab serviceInclusions={serviceInclusions} loadData={loadData} />
        </TabsContent>

        <TabsContent value="vehicle-rates" className="space-y-4">
          <VehicleRatesTab vehicles={vehicles} loadData={loadData} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

// ============= PRICING EXTRAS TAB =============
const PricingExtras = ({ extras, loadData }: { 
  extras: PricingExtra[]; 
  loadData: () => void; 
}) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PricingExtra | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [formData, setFormData] = useState({
    extra_name: "",
    price: 0,
    price_type: "per_day",
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
      if (editing) {
        const { error } = await supabase
          .from("pricing_extras")
          .update(formData)
          .eq("id", editing.id);
        
        if (error) throw error;
        toast.success("Extra updated successfully");
      } else {
        const { error } = await supabase
          .from("pricing_extras")
          .insert(formData);
        
        if (error) throw error;
        toast.success("Extra saved successfully");
      }

      setDialogOpen(false);
      setEditing(null);
      setFormData({ extra_name: "", price: 0, price_type: "per_day", description: "", is_active: true });
      loadData();
    } catch (error) {
      toast.error("Failed to save extra");
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;

    try {
      const { error } = await supabase
        .from("pricing_extras")
        .delete()
        .eq("id", deletingId);
      
      if (error) throw error;
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
      price_type: extra.price_type || "per_day",
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
                setFormData({ extra_name: "", price: 0, price_type: "per_day", description: "", is_active: true });
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Extra
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit" : "Add"} Rental Extra</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="extra_name">
                  Extra Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="extra_name"
                  value={formData.extra_name}
                  onChange={(e) => setFormData({ ...formData, extra_name: e.target.value })}
                  placeholder="e.g., GPS Navigation"
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
                <Label htmlFor="price_type">
                  Price Type <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={formData.price_type}
                  onValueChange={(value) => setFormData({ ...formData, price_type: value })}
                >
                  <SelectTrigger className="focus:ring-2 focus:ring-accent">
                    <SelectValue placeholder="Select price type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="per_day">Per Day</SelectItem>
                    <SelectItem value="per_rental">Per Rental</SelectItem>
                    <SelectItem value="one_time">One-time Fee</SelectItem>
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
              <h3 className="font-display font-semibold text-lg">No rental extras yet</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Add your first Drive 917 rental extra to start customizing your booking experience.
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
                  <h3 className="font-display font-semibold text-lg">{extra.extra_name}</h3>
                  {extra.is_active ? (
                    <Badge className="bg-accent/10 text-accent border-accent/20">Active</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
                  )}
                </div>
                
                <div>
                  <p className="text-3xl font-display font-bold text-accent">
                    ${extra.price.toFixed(2)}
                  </p>
                  {extra.price_type && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {extra.price_type === "per_day" ? "Per Day" : 
                       extra.price_type === "per_rental" ? "Per Rental" : "One-time Fee"}
                    </p>
                  )}
                </div>
                
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
            <AlertDialogTitle>Delete this rental extra?</AlertDialogTitle>
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

// ============= SERVICE INCLUSIONS TAB =============
const ServiceInclusionsTab = ({ serviceInclusions, loadData }: { 
  serviceInclusions: ServiceInclusion[]; 
  loadData: () => void; 
}) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceInclusion | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    icon_name: "Check",
    category: "standard" as "standard" | "premium",
    display_order: 0,
    is_active: true
  });

  const standardInclusions = serviceInclusions.filter(s => s.category === 'standard' && s.is_active);
  const premiumInclusions = serviceInclusions.filter(s => s.category === 'premium' && s.is_active);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      if (editing) {
        const { error } = await supabase
          .from("service_inclusions")
          .update(formData)
          .eq("id", editing.id);
        
        if (error) throw error;
        toast.success("Inclusion updated successfully");
      } else {
        const { error } = await supabase
          .from("service_inclusions")
          .insert(formData);
        
        if (error) throw error;
        toast.success("Inclusion added successfully");
      }

      setDialogOpen(false);
      setEditing(null);
      setFormData({ title: "", icon_name: "Check", category: "standard", display_order: 0, is_active: true });
      loadData();
    } catch (error) {
      toast.error("Failed to save inclusion");
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;

    try {
      const { error } = await supabase
        .from("service_inclusions")
        .delete()
        .eq("id", deletingId);
      
      if (error) throw error;
      toast.success("Inclusion removed successfully");
      loadData();
    } catch (error) {
      toast.error("Failed to delete inclusion");
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
      <div className="flex justify-end mb-4">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button 
              className="gradient-accent shadow-glow" 
              onClick={() => {
                setEditing(null);
                setFormData({ title: "", icon_name: "Check", category: "standard", display_order: 0, is_active: true });
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Inclusion
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
                  placeholder="e.g., 24/7 Roadside Assistance"
                  required
                  className="focus:ring-2 focus:ring-accent"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="category">
                  Package Type <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={formData.category}
                  onValueChange={(value: "standard" | "premium") => setFormData({ ...formData, category: value })}
                >
                  <SelectTrigger className="focus:ring-2 focus:ring-accent">
                    <SelectValue placeholder="Select package type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard Package</SelectItem>
                    <SelectItem value="premium">Premium Package</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="display_order">Display Order</Label>
                <Input
                  id="display_order"
                  type="number"
                  value={formData.display_order}
                  onChange={(e) => setFormData({ ...formData, display_order: parseInt(e.target.value) || 0 })}
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

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="p-6">
          <h3 className="font-display font-semibold text-xl mb-4">Standard Package</h3>
          {standardInclusions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No standard inclusions yet</p>
          ) : (
            <ul className="space-y-3">
              {standardInclusions.map((inclusion) => (
                <li key={inclusion.id} className="flex items-center justify-between group">
                  <div className="flex items-center gap-2">
                    <span className="text-accent">✓</span>
                    <span className="text-muted-foreground">{inclusion.title}</span>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEditDialog(inclusion)}
                    >
                      <Edit className="w-3 h-3" />
                    </Button>
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
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-6 border-accent/30">
          <h3 className="font-display font-semibold text-xl mb-4 text-accent">Premium Package</h3>
          {premiumInclusions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No premium inclusions yet</p>
          ) : (
            <ul className="space-y-3">
              {premiumInclusions.map((inclusion) => (
                <li key={inclusion.id} className="flex items-center justify-between group">
                  <div className="flex items-center gap-2">
                    <span className="text-accent">✓</span>
                    <span className="text-muted-foreground">{inclusion.title}</span>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEditDialog(inclusion)}
                    >
                      <Edit className="w-3 h-3" />
                    </Button>
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
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this service inclusion?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The inclusion will be permanently removed from the system.
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
const VehicleRatesTab = ({ vehicles, loadData }: { 
  vehicles: Vehicle[]; 
  loadData: () => void; 
}) => {
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    daily_rate: 0,
    weekly_rate: 0,
    monthly_rate: 0,
    deposit_required: 0
  });

  const openEditDialog = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle);
    setFormData({
      daily_rate: vehicle.daily_rate,
      weekly_rate: vehicle.weekly_rate,
      monthly_rate: vehicle.monthly_rate,
      deposit_required: vehicle.deposit_required
    });
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVehicle) return;

    try {
      const { error } = await supabase
        .from("vehicles")
        .update(formData)
        .eq("id", editingVehicle.id);
      
      if (error) throw error;
      toast.success("Vehicle rates updated successfully");
      setDialogOpen(false);
      setEditingVehicle(null);
      loadData();
    } catch (error) {
      toast.error("Failed to update vehicle rates");
    }
  };

  if (vehicles.length === 0) {
    return (
      <Card className="p-12 text-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center">
            <Car className="w-8 h-8 text-accent" />
          </div>
          <div>
            <h3 className="font-display font-semibold text-lg">No vehicles available</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Add vehicles to your fleet to manage their rental rates
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vehicle</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Daily Rate</TableHead>
              <TableHead className="text-right">Weekly Rate</TableHead>
              <TableHead className="text-right">Monthly Rate</TableHead>
              <TableHead className="text-right">Deposit</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vehicles.map((vehicle) => (
              <TableRow key={vehicle.id}>
                <TableCell className="font-medium">{vehicle.name}</TableCell>
                <TableCell>
                  <Badge variant="outline">{vehicle.category}</Badge>
                </TableCell>
                <TableCell className="text-right font-semibold text-accent">
                  ${vehicle.daily_rate.toFixed(2)}
                </TableCell>
                <TableCell className="text-right font-semibold text-accent">
                  ${vehicle.weekly_rate.toFixed(2)}
                </TableCell>
                <TableCell className="text-right font-semibold text-accent">
                  ${vehicle.monthly_rate.toFixed(2)}
                </TableCell>
                <TableCell className="text-right">
                  ${vehicle.deposit_required.toFixed(2)}
                </TableCell>
                <TableCell className="text-right">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openEditDialog(vehicle)}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Edit rates</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Vehicle Rates - {editingVehicle?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="daily_rate">
                Daily Rate ($) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="daily_rate"
                type="number"
                step="0.01"
                min="0"
                value={formData.daily_rate}
                onChange={(e) => setFormData({ ...formData, daily_rate: parseFloat(e.target.value) || 0 })}
                required
                className="focus:ring-2 focus:ring-accent"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="weekly_rate">
                Weekly Rate ($) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="weekly_rate"
                type="number"
                step="0.01"
                min="0"
                value={formData.weekly_rate}
                onChange={(e) => setFormData({ ...formData, weekly_rate: parseFloat(e.target.value) || 0 })}
                required
                className="focus:ring-2 focus:ring-accent"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="monthly_rate">
                Monthly Rate ($) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="monthly_rate"
                type="number"
                step="0.01"
                min="0"
                value={formData.monthly_rate}
                onChange={(e) => setFormData({ ...formData, monthly_rate: parseFloat(e.target.value) || 0 })}
                required
                className="focus:ring-2 focus:ring-accent"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="deposit_required">
                Deposit Required ($) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="deposit_required"
                type="number"
                step="0.01"
                min="0"
                value={formData.deposit_required}
                onChange={(e) => setFormData({ ...formData, deposit_required: parseFloat(e.target.value) || 0 })}
                required
                className="focus:ring-2 focus:ring-accent"
              />
            </div>
            
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} className="flex-1">
                Cancel
              </Button>
              <Button type="submit" className="flex-1 gradient-accent shadow-glow">
                Update Rates
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default RentalPricingManagement;
