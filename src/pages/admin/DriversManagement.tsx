import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Edit, Trash2, Phone, Mail, Shield, Car, Users, ChevronRight, Search, X, RefreshCcw } from "lucide-react";

interface Driver {
  id: string;
  name: string;
  email: string;
  phone: string;
  license_number: string;
  specializations: string[];
  is_available: boolean;
}

const DriversManagement = () => {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [filteredDrivers, setFilteredDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [driverToDelete, setDriverToDelete] = useState<Driver | null>(null);
  const [editingDriver, setEditingDriver] = useState<Driver | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    license_number: "",
    specializations: "",
    is_available: true,
  });

  // Helper function to get initials from name
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map(word => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  useEffect(() => {
    loadDrivers();
  }, []);

  useEffect(() => {
    filterDrivers();
  }, [drivers, searchQuery, statusFilter, roleFilter]);

  const filterDrivers = () => {
    let filtered = [...drivers];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(driver =>
        driver.name.toLowerCase().includes(query) ||
        driver.email?.toLowerCase().includes(query) ||
        driver.license_number?.toLowerCase().includes(query) ||
        driver.specializations?.some(s => s.toLowerCase().includes(query))
      );
    }

    // Status filter
    if (statusFilter !== "all") {
      if (statusFilter === "available") {
        filtered = filtered.filter(d => d.is_available);
      } else if (statusFilter === "unavailable") {
        filtered = filtered.filter(d => !d.is_available);
      }
    }

    // Role filter
    if (roleFilter !== "all") {
      filtered = filtered.filter(driver =>
        driver.specializations?.some(s => s.toLowerCase().includes(roleFilter.toLowerCase()))
      );
    }

    setFilteredDrivers(filtered);
  };

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setRoleFilter("all");
  };

  const loadDrivers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("drivers")
      .select("*", { count: 'exact', head: false })
      .order("name");

    if (error) {
      toast.error("Failed to load drivers");
    } else {
      setDrivers(data || []);
      setLastUpdated(new Date());
    }
    setLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const specializationsArray = formData.specializations
      .split(",")
      .map(s => s.trim())
      .filter(s => s);

    const driverData: any = {
      ...formData,
      specializations: specializationsArray,
    };

    if (editingDriver) {
      const { data, error } = await supabase
        .from("drivers")
        .update(driverData)
        .eq("id", editingDriver.id)
        .select()
        .single();

      if (error) {
        toast.error("Failed to update driver");
        return;
      }
      
      // Optimistic UI update
      setDrivers(drivers.map(d => d.id === editingDriver.id ? data : d));
      toast.success("Driver updated");
    } else {
      const { data, error } = await supabase.from("drivers").insert([driverData]).select().single();

      if (error) {
        toast.error("Failed to create driver");
        return;
      }
      
      // Optimistic UI update
      setDrivers([...drivers, data]);
      toast.success("Driver created");
    }

    setDialogOpen(false);
    resetForm();
  };

  const handleDeleteClick = (driver: Driver) => {
    setDriverToDelete(driver);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!driverToDelete) return;

    const { error } = await supabase.from("drivers").delete().eq("id", driverToDelete.id);

    if (error) {
      toast.error("Failed to delete driver");
      return;
    }

    toast.success("Driver deleted successfully");
    setDeleteDialogOpen(false);
    setDriverToDelete(null);
    loadDrivers();
  };

  const handleEdit = (driver: Driver) => {
    setEditingDriver(driver);
    setFormData({
      name: driver.name,
      email: driver.email || "",
      phone: driver.phone || "",
      license_number: driver.license_number || "",
      specializations: driver.specializations?.join(", ") || "",
      is_available: driver.is_available,
    });
    setDialogOpen(true);
  };

  const resetForm = () => {
    setEditingDriver(null);
    setFormData({
      name: "",
      email: "",
      phone: "",
      license_number: "",
      specializations: "",
      is_available: true,
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
                <div className="flex gap-2 justify-center">
                  <Skeleton className="h-6 w-20 rounded-full" />
                  <Skeleton className="h-6 w-24 rounded-full" />
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
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-display font-bold text-gradient-metal mb-2">Drivers Management</h1>
              <p className="text-muted-foreground">
                Manage chauffeur and protection personnel with full control over availability and roles.
              </p>
            </div>
            
            <div className="flex gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button onClick={loadDrivers} variant="outline" className="gap-2">
                    <RefreshCcw className="w-4 h-4" />
                    Refresh
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Reload drivers data</p>
                </TooltipContent>
              </Tooltip>
              
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DialogTrigger asChild>
                      <Button 
                        className="gradient-accent shadow-glow hover:shadow-[0_0_40px_rgba(244,197,66,0.3)] transition-all duration-300" 
                        onClick={resetForm}
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Add Driver
                      </Button>
                    </DialogTrigger>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Add new driver profile</p>
                  </TooltipContent>
                </Tooltip>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-display text-2xl">
                {editingDriver ? "Edit Driver Profile" : "Add New Driver"}
              </DialogTitle>
              <DialogDescription>
                Complete all required fields to {editingDriver ? "update" : "create"} driver profile
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-semibold">
                  Full Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="focus-visible:ring-accent focus-visible:ring-2 transition-all"
                  placeholder="e.g., John Smith"
                  required
                  autoFocus
                />
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
                    className="focus-visible:ring-accent focus-visible:ring-2 transition-all"
                    placeholder="driver@supremedrive.co.uk"
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
                    className="focus-visible:ring-accent focus-visible:ring-2 transition-all"
                    placeholder="+44 7700 900000"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="license" className="text-sm font-semibold">
                  License Number <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="license"
                  value={formData.license_number}
                  onChange={(e) => setFormData({ ...formData, license_number: e.target.value })}
                  className="focus-visible:ring-accent focus-visible:ring-2 transition-all"
                  placeholder="UK-DRV-001"
                  required
                />
                <p className="text-xs text-muted-foreground">Use format: UK-DRV-XXX</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="specializations" className="text-sm font-semibold">
                  Specializations <span className="text-muted-foreground text-xs">(comma-separated)</span>
                </Label>
                <Input
                  id="specializations"
                  value={formData.specializations}
                  onChange={(e) => setFormData({ ...formData, specializations: e.target.value })}
                  className="focus-visible:ring-accent focus-visible:ring-2 transition-all"
                  placeholder="Chauffeur, Close Protection, Executive Transport"
                />
                <p className="text-xs text-muted-foreground">
                  Common: Chauffeur, Close Protection, Executive, Long Distance
                </p>
              </div>

              <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border/50">
                <Label htmlFor="available" className="text-sm font-semibold cursor-pointer">
                  Available for Jobs
                </Label>
                <Switch
                  id="available"
                  checked={formData.is_available}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_available: checked })}
                />
              </div>

              <div className="flex gap-3 pt-4">
                <Button 
                  type="submit" 
                  className="gradient-accent shadow-glow hover:shadow-[0_0_40px_rgba(244,197,66,0.3)] transition-all duration-300 flex-1"
                >
                  {editingDriver ? "Save Changes" : "Create Driver"}
                </Button>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setDialogOpen(false)}
                  className="hover:bg-muted"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
              </div>
            </div>

      {/* Filter & Search Bar */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, license, or specialization..."
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
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="available">Available</SelectItem>
              <SelectItem value="unavailable">Unavailable</SelectItem>
            </SelectContent>
          </Select>

          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-full sm:w-[180px] focus:ring-accent">
              <SelectValue placeholder="All Roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="chauffeur">Chauffeur</SelectItem>
              <SelectItem value="close protection">Close Protection</SelectItem>
              <SelectItem value="executive">Executive Transport</SelectItem>
            </SelectContent>
          </Select>

          {(searchQuery || statusFilter !== "all" || roleFilter !== "all") && (
            <Button
              variant="outline"
              onClick={clearFilters}
              className="text-accent hover:text-accent/80 hover:bg-accent/10"
            >
              Clear Filters
            </Button>
          )}
        </div>

        {/* Driver Cards Grid */}
        {filteredDrivers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 space-y-4">
            <Users className="w-16 h-16 text-muted-foreground/50" />
            <h3 className="text-xl font-display font-semibold">No drivers found</h3>
            <p className="text-muted-foreground text-center max-w-md">
              {drivers.length === 0 
                ? "Add your first driver to start assigning jobs." 
                : "Try adjusting filters or search criteria."}
            </p>
            {drivers.length === 0 && (
              <Button 
                className="gradient-accent shadow-glow mt-4" 
                onClick={() => {
                  resetForm();
                  setDialogOpen(true);
                }}
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Driver
              </Button>
            )}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredDrivers.map((driver, index) => (
              <Card 
                key={driver.id} 
                className="relative p-8 shadow-metal hover:shadow-[0_0_30px_rgba(244,197,66,0.15)] hover:border-accent/40 transition-all duration-300 hover:scale-[1.02] border-border/50 animate-fade-in"
                style={{ animationDelay: `${index * 100}ms` }}
              >
                {/* Status Badge - Top Right */}
                <div className="absolute top-4 right-4">
                  {driver.is_available ? (
                    <Badge className="rounded-full hover:bg-transparent hover:cursor-pointer px-3 py-1 bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30 text-xs shadow-[0_0_10px_rgba(34,197,94,0.3)]">
                      🟢 Available
                    </Badge>
                  ) : (
                    <Badge className="rounded-full hover:bg-transparent hover:cursor-pointer px-3 py-1 bg-red-500/20 text-red-700 dark:text-red-400 border-red-500/30 text-xs">
                      🔴 Unavailable
                    </Badge>
                  )}
                </div>

                <div className="space-y-4">
                  {/* Avatar with Initials - Enhanced */}
                  <div className="flex flex-col items-center space-y-3">
                    <Avatar className="h-20 w-20 bg-gradient-to-br from-accent/80 to-accent/40 shadow-[0_0_20px_rgba(244,197,66,0.2)] ring-2 ring-accent/30 transition-all hover:ring-accent/50 hover:shadow-[0_0_30px_rgba(244,197,66,0.3)]">
                      <AvatarFallback className="bg-transparent text-primary-foreground font-bold text-xl">
                        {getInitials(driver.name)}
                      </AvatarFallback>
                    </Avatar>
                    
                    {/* Driver Name */}
                    <h3 className="text-2xl font-display font-bold text-center">{driver.name}</h3>
                  </div>

                  {/* Contact Information */}
                  <div className="space-y-2">
                    {driver.email && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Mail className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate">{driver.email}</span>
                      </div>
                    )}

                    {driver.phone && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Phone className="w-4 h-4 flex-shrink-0" />
                        <span>{driver.phone}</span>
                      </div>
                    )}
                  </div>

                  {/* License Number */}
                  {driver.license_number && (
                    <p className="text-sm text-muted-foreground/70 text-center">
                      License: {driver.license_number}
                    </p>
                  )}

                  {/* Specializations - Premium Pills */}
                  {driver.specializations && driver.specializations.length > 0 && (
                    <div className="flex flex-wrap gap-2 justify-center">
                      {driver.specializations.map((spec, idx) => {
                        const isCloseProtection = spec.toLowerCase().includes('protection');
                        const isChauffeur = spec.toLowerCase().includes('chauffeur');
                        
                        return (
                          <Badge 
                            key={idx} 
                            className={`rounded-full px-3 py-1 hover:bg-transparent hover:cursor-pointer text-xs font-medium shadow-sm transition-all hover:scale-105 ${
                              isCloseProtection
                                ? 'bg-accent/20 text-accent border-accent/40 shadow-[0_0_10px_rgba(244,197,66,0.2)]' 
                                : isChauffeur
                                ? 'bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-500/30'
                                : 'bg-secondary text-secondary-foreground border-border'
                            }`}
                          >
                            {isCloseProtection && <Shield className="w-3 h-3 mr-1 inline" />}
                            {isChauffeur && <Car className="w-3 h-3 mr-1 inline" />}
                            {spec}
                          </Badge>
                        );
                      })}
                    </div>
                  )}

                  {/* Action Buttons - Bottom Right */}
                  <div className="flex justify-end gap-2 pt-4">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          size="icon" 
                          variant="outline" 
                          onClick={() => handleEdit(driver)}
                          className="hover:bg-accent/10 hover:border-accent hover:scale-110 transition-all"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Edit Driver Profile</p>
                      </TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          size="icon" 
                          variant="destructive" 
                          onClick={() => handleDeleteClick(driver)}
                          className="hover:bg-destructive/90 hover:scale-110 transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Remove Driver</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-display text-2xl">Remove Driver?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to remove <span className="font-semibold text-foreground">{driverToDelete?.name}</span>? 
                This action cannot be undone and will affect all associated job assignments.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="hover:bg-muted">Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={confirmDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Remove Driver
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
};

export default DriversManagement;
