import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Sparkles,
  Tag,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";

interface Promotion {
  id: string;
  title: string;
  description: string;
  discount_type: "percentage" | "fixed";
  discount_value: number;
  promo_code: string | null;
  start_date: string;
  end_date: string;
  is_active: boolean;
  image_url: string | null;
  created_at: string;
}

interface Vehicle {
  id: string;
  name: string;
  category: string;
}

export default function PromotionsManagement() {
  const navigate = useNavigate();
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [vehicleFilter, setVehicleFilter] = useState("all");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingPromotion, setEditingPromotion] = useState<Promotion | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    discount_type: "percentage" as "percentage" | "fixed",
    discount_value: 0,
    promo_code: "",
    start_date: "",
    end_date: "",
    selectedVehicles: [] as string[],
  });

  useEffect(() => {
    loadPromotions();
    loadVehicles();
  }, [statusFilter, vehicleFilter]);

  const loadPromotions = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from("promotions")
        .select("*")
        .order("created_at", { ascending: false });

      const { data, error } = await query;
      if (error) throw error;

      // Filter by status
      let filtered = data || [];
      const today = new Date();
      
      if (statusFilter === "active") {
        filtered = filtered.filter(p => 
          new Date(p.start_date) <= today && 
          new Date(p.end_date) >= today &&
          p.is_active
        );
      } else if (statusFilter === "scheduled") {
        filtered = filtered.filter(p => new Date(p.start_date) > today && p.is_active);
      } else if (statusFilter === "expired") {
        filtered = filtered.filter(p => new Date(p.end_date) < today || !p.is_active);
      }

      setPromotions(filtered);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadVehicles = async () => {
    try {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, name, category")
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      setVehicles(data || []);
    } catch (error: any) {
      toast({
        title: "Error loading vehicles",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const getStatus = (promotion: Promotion) => {
    const today = new Date();
    const start = new Date(promotion.start_date);
    const end = new Date(promotion.end_date);

    if (!promotion.is_active || end < today) return "expired";
    if (start > today) return "scheduled";
    return "active";
  };

  const filteredPromotions = promotions.filter((promo) =>
    promo.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    promo.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedItems(new Set(filteredPromotions.map((item) => item.id)));
    } else {
      setSelectedItems(new Set());
    }
  };

  const handleSelectItem = (itemId: string, checked: boolean) => {
    const newSelected = new Set(selectedItems);
    if (checked) {
      newSelected.add(itemId);
    } else {
      newSelected.delete(itemId);
    }
    setSelectedItems(newSelected);
  };

  const handleDelete = async () => {
    if (!itemToDelete) return;

    try {
      const { error } = await supabase
        .from("promotions")
        .delete()
        .eq("id", itemToDelete);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Promotion deleted",
      });
      loadPromotions();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setDeleteDialogOpen(false);
      setItemToDelete(null);
    }
  };

  const openEditModal = (promotion?: Promotion) => {
    if (promotion) {
      setEditingPromotion(promotion);
      setFormData({
        title: promotion.title,
        description: promotion.description,
        discount_type: promotion.discount_type,
        discount_value: promotion.discount_value,
        promo_code: promotion.promo_code || "",
        start_date: promotion.start_date,
        end_date: promotion.end_date,
        selectedVehicles: [],
      });
      // Load associated vehicles
      loadPromotionVehicles(promotion.id);
    } else {
      setEditingPromotion(null);
      setFormData({
        title: "",
        description: "",
        discount_type: "percentage",
        discount_value: 0,
        promo_code: "",
        start_date: "",
        end_date: "",
        selectedVehicles: [],
      });
    }
    setEditModalOpen(true);
  };

  const loadPromotionVehicles = async (promotionId: string) => {
    try {
      const { data, error } = await supabase
        .from("promotions_vehicles")
        .select("vehicle_id")
        .eq("promotion_id", promotionId);

      if (error) throw error;
      setFormData(prev => ({
        ...prev,
        selectedVehicles: data.map(v => v.vehicle_id)
      }));
    } catch (error: any) {
      console.error("Error loading promotion vehicles:", error);
    }
  };

  const handleSavePromotion = async () => {
    if (!formData.title || !formData.start_date || !formData.end_date) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const promotionData = {
        title: formData.title,
        description: formData.description,
        discount_type: formData.discount_type,
        discount_value: formData.discount_value,
        promo_code: formData.promo_code || null,
        start_date: formData.start_date,
        end_date: formData.end_date,
        is_active: true,
        created_by: user?.id,
      };

      let promotionId: string;

      if (editingPromotion) {
        const { error } = await supabase
          .from("promotions")
          .update(promotionData)
          .eq("id", editingPromotion.id);

        if (error) throw error;
        promotionId = editingPromotion.id;
      } else {
        const { data, error } = await supabase
          .from("promotions")
          .insert(promotionData)
          .select()
          .single();

        if (error) throw error;
        promotionId = data.id;
      }

      // Update vehicle associations
      await supabase
        .from("promotions_vehicles")
        .delete()
        .eq("promotion_id", promotionId);

      if (formData.selectedVehicles.length > 0) {
        const vehicleAssociations = formData.selectedVehicles.map(vehicleId => ({
          promotion_id: promotionId,
          vehicle_id: vehicleId,
        }));

        const { error: vehiclesError } = await supabase
          .from("promotions_vehicles")
          .insert(vehicleAssociations);

        if (vehiclesError) throw vehiclesError;
      }

      toast({
        title: "Success",
        description: editingPromotion ? "Promotion updated" : "Promotion created",
      });

      setEditModalOpen(false);
      loadPromotions();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-display font-bold text-gradient-metal mb-2">
            Promotions & Offers
          </h1>
          <p className="text-muted-foreground">
            Manage rental promotions, seasonal offers, and discount campaigns
          </p>
        </div>
        <Button 
          onClick={() => openEditModal()}
          className="shadow-glow hover:shadow-[0_0_40px_rgba(255,215,0,0.4)] transition-all"
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Promotion
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search promotions..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>

        <Select value={vehicleFilter} onValueChange={setVehicleFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Vehicle" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Vehicles</SelectItem>
            {vehicles.map((vehicle) => (
              <SelectItem key={vehicle.id} value={vehicle.id}>
                {vehicle.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <Checkbox
                  checked={
                    filteredPromotions.length > 0 &&
                    selectedItems.size === filteredPromotions.length
                  }
                  onCheckedChange={handleSelectAll}
                />
              </TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Discount</TableHead>
              <TableHead>Start Date</TableHead>
              <TableHead>End Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <>
                {[...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-5" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-24 ml-auto" /></TableCell>
                  </TableRow>
                ))}
              </>
            ) : filteredPromotions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-16">
                  <div className="flex flex-col items-center justify-center space-y-4 text-center">
                    <div className="relative">
                      <div className="absolute inset-0 bg-gradient-to-br from-accent to-accent/60 opacity-20 blur-3xl rounded-full" />
                      <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center">
                        <Tag className="w-10 h-10 text-accent" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xl font-display font-semibold text-foreground">
                        No active promotions or offers yet
                      </p>
                      <p className="text-sm text-muted-foreground max-w-sm">
                        Add your first Drive 917 promotion to boost bookings
                      </p>
                    </div>
                    <Button 
                      onClick={() => openEditModal()}
                      className="mt-4 shadow-glow"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add Promotion
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredPromotions.map((promo, index) => {
                const status = getStatus(promo);
                return (
                  <TableRow 
                    key={promo.id}
                    className="hover:bg-accent/5 transition-all duration-300 animate-fade-in group"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selectedItems.has(promo.id)}
                        onCheckedChange={(checked) =>
                          handleSelectItem(promo.id, checked as boolean)
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <span className="font-medium">{promo.title}</span>
                        {promo.promo_code && (
                          <Badge variant="outline" className="ml-2 text-xs">
                            {promo.promo_code}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {promo.discount_type === "percentage" 
                          ? `${promo.discount_value}%` 
                          : `$${promo.discount_value}`}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {format(new Date(promo.start_date), "dd MMM yyyy")}
                    </TableCell>
                    <TableCell>
                      {format(new Date(promo.end_date), "dd MMM yyyy")}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          status === "active" 
                            ? "default" 
                            : status === "scheduled" 
                            ? "secondary" 
                            : "outline"
                        }
                        className={status === "active"
                          ? "shadow-[0_0_20px_rgba(255,215,0,0.2)] group-hover:shadow-[0_0_25px_rgba(255,215,0,0.3)] transition-all"
                          : ""
                        }
                      >
                        {status === "active" && <span className="mr-1">✓</span>}
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditModal(promo)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setItemToDelete(promo.id);
                            setDeleteDialogOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Edit/Add Modal */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingPromotion ? "Edit Promotion" : "Add New Promotion"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g., Winter Weekend Special"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief description of the promotion"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="discount_type">Discount Type *</Label>
                <Select
                  value={formData.discount_type}
                  onValueChange={(value: "percentage" | "fixed") =>
                    setFormData({ ...formData, discount_type: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage (%)</SelectItem>
                    <SelectItem value="fixed">Fixed Amount ($)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="discount_value">Discount Value *</Label>
                <Input
                  id="discount_value"
                  type="number"
                  value={formData.discount_value}
                  onChange={(e) => setFormData({ ...formData, discount_value: parseFloat(e.target.value) })}
                  placeholder={formData.discount_type === "percentage" ? "20" : "100"}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="promo_code">Promo Code (Optional)</Label>
              <Input
                id="promo_code"
                value={formData.promo_code}
                onChange={(e) => setFormData({ ...formData, promo_code: e.target.value.toUpperCase() })}
                placeholder="WINTER25"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start_date">Start Date *</Label>
                <Input
                  id="start_date"
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="end_date">End Date *</Label>
                <Input
                  id="end_date"
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Applicable Vehicles</Label>
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2 border rounded-md">
                {vehicles.map((vehicle) => (
                  <div key={vehicle.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={vehicle.id}
                      checked={formData.selectedVehicles.includes(vehicle.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setFormData({
                            ...formData,
                            selectedVehicles: [...formData.selectedVehicles, vehicle.id]
                          });
                        } else {
                          setFormData({
                            ...formData,
                            selectedVehicles: formData.selectedVehicles.filter(id => id !== vehicle.id)
                          });
                        }
                      }}
                    />
                    <label
                      htmlFor={vehicle.id}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      {vehicle.name}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSavePromotion}>
              {editingPromotion ? "Update" : "Create"} Promotion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the promotion.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
