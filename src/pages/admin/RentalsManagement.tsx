import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TimePicker } from "@/components/ui/time-picker";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import { 
  Download, 
  Search, 
  Car, 
  User, 
  Plus,
  X,
  CheckCircle2,
  XCircle,
  AlertCircle,
  MoreVertical,
  RefreshCcw,
  Calendar as CalendarIcon,
  Clock
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Booking {
  id: string;
  pickup_location: string;
  dropoff_location: string;
  pickup_date: string;
  dropoff_date: string | null;
  pickup_time: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  status: string | null;
  client_id: string | null;
  vehicle_id: string | null;
  total_price: number | null;
  rental_days: number | null;
  created_at: string | null;
}

interface Client {
  id: string;
  name: string;
}

interface Vehicle {
  id: string;
  name: string;
  category: string;
  daily_rate: number;
  weekly_rate: number;
  monthly_rate: number;
}

interface PricingExtra {
  id: string;
  extra_name: string;
  description: string;
  price: number;
}

interface NewRentalForm {
  vehicle_id: string;
  client_id: string;
  pickup_date: Date | undefined;
  pickup_time: string;
  dropoff_date: Date | undefined;
  dropoff_time: string;
  pickup_location: string;
  dropoff_location: string;
  selected_extras: string[];
  notes: string;
}

export default function RentalsManagement() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filteredBookings, setFilteredBookings] = useState<Booking[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [pricingExtras, setPricingExtras] = useState<PricingExtra[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [vehicleFilter, setVehicleFilter] = useState("all");

  // New Rental Form
  const [formData, setFormData] = useState<NewRentalForm>({
    vehicle_id: "",
    client_id: "",
    pickup_date: undefined,
    pickup_time: "09:00",
    dropoff_date: undefined,
    dropoff_time: "09:00",
    pickup_location: "",
    dropoff_location: "",
    selected_extras: [],
    notes: "",
  });

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const urlStatus = searchParams.get("status");
    if (urlStatus) setStatusFilter(urlStatus);
  }, [searchParams]);

  useEffect(() => {
    applyFilters();
  }, [bookings, searchTerm, statusFilter, clientFilter, vehicleFilter]);

  const loadData = async () => {
    try {
      const [bookingsRes, clientsRes, vehiclesRes, extrasRes] = await Promise.all([
        supabase.from("bookings").select("*").order("created_at", { ascending: false }),
        supabase.from("clients").select("id, name, email, phone"),
        supabase.from("vehicles").select("id, name, category, daily_rate, weekly_rate, monthly_rate").eq("is_active", true),
        supabase.from("pricing_extras").select("*").eq("is_active", true),
      ]);

      if (bookingsRes.error) throw bookingsRes.error;
      if (clientsRes.error) throw clientsRes.error;
      if (vehiclesRes.error) throw vehiclesRes.error;
      if (extrasRes.error) throw extrasRes.error;

      setBookings(bookingsRes.data || []);
      setClients(clientsRes.data || []);
      setVehicles(vehiclesRes.data || []);
      setPricingExtras(extrasRes.data || []);
    } catch (error: any) {
      toast.error("Failed to load data: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...bookings];

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (b) =>
          b.pickup_location?.toLowerCase().includes(term) ||
          b.dropoff_location?.toLowerCase().includes(term) ||
          b.customer_name?.toLowerCase().includes(term) ||
          b.customer_email?.toLowerCase().includes(term)
      );
    }

    if (statusFilter !== "all") {
      if (statusFilter === "active") {
        filtered = filtered.filter((b) => b.status === "confirmed" || b.status === "in_progress");
      } else if (statusFilter === "pending_return") {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        filtered = filtered.filter((b) => 
          b.status === "in_progress" && b.dropoff_date &&
          new Date(b.dropoff_date) <= today
        );
      } else {
        filtered = filtered.filter((b) => b.status === statusFilter);
      }
    }

    if (clientFilter !== "all") {
      filtered = filtered.filter((b) => b.client_id === clientFilter);
    }

    if (vehicleFilter !== "all") {
      filtered = filtered.filter((b) => b.vehicle_id === vehicleFilter);
    }

    setFilteredBookings(filtered);
  };

  const updateBookingStatus = async (id: string, newStatus: string) => {
    try {
      setBookings(prev => prev.map(b => 
        b.id === id ? { ...b, status: newStatus } : b
      ));

      const { error } = await supabase
        .from("bookings")
        .update({ status: newStatus })
        .eq("id", id);

      if (error) throw error;
      toast.success("Status updated successfully");
    } catch (error: any) {
      toast.error("Failed to update status: " + error.message);
      loadData();
    }
  };

  const exportToCSV = () => {
    const headers = ["Date", "Customer", "Pickup", "Dropoff", "Days", "Status", "Vehicle", "Price"];
    const rows = filteredBookings.map((b) => [
      b.pickup_date,
      b.customer_name || "",
      b.pickup_location,
      b.dropoff_location,
      b.rental_days || "",
      b.status || "",
      vehicles.find((v) => v.id === b.vehicle_id)?.name || "",
      b.total_price || "",
    ]);

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rentals-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
  };

  const getStatusColor = (status: string | null) => {
    switch (status) {
      case "new": return "bg-cyan-500/20 text-cyan-400 border-cyan-500/30";
      case "pending": return "bg-amber-500/20 text-amber-400 border-amber-500/30";
      case "confirmed": return "bg-green-500/20 text-green-400 border-green-500/30";
      case "in_progress": return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      case "completed": return "bg-gray-500/20 text-gray-400 border-gray-500/30";
      case "cancelled": return "bg-red-500/20 text-red-400 border-red-500/30";
      default: return "bg-muted/20 text-muted-foreground border-muted/30";
    }
  };

  const getStatusLabel = (status: string | null) => {
    switch (status) {
      case "new": return "New";
      case "pending": return "Pending";
      case "confirmed": return "Confirmed";
      case "in_progress": return "In Progress";
      case "completed": return "Completed";
      case "cancelled": return "Cancelled";
      default: return "Unknown";
    }
  };

  const getStatusIcon = (status: string | null) => {
    switch (status) {
      case "new": return <Clock className="w-3 h-3" />;
      case "pending": return <AlertCircle className="w-3 h-3" />;
      case "confirmed": return <CheckCircle2 className="w-3 h-3" />;
      case "completed": return <CheckCircle2 className="w-3 h-3" />;
      case "cancelled": return <XCircle className="w-3 h-3" />;
      default: return <Clock className="w-3 h-3" />;
    }
  };

  const clearAllFilters = () => {
    setSearchTerm("");
    setStatusFilter("all");
    setClientFilter("all");
    setVehicleFilter("all");
    toast.success("Filters cleared");
  };

  const activeFilterCount = [
    searchTerm !== "",
    statusFilter !== "all",
    clientFilter !== "all",
    vehicleFilter !== "all"
  ].filter(Boolean).length;

  // Calculate rental details
  const calculateRentalDays = () => {
    if (!formData.pickup_date || !formData.dropoff_date) return 0;
    return Math.max(1, differenceInDays(formData.dropoff_date, formData.pickup_date) + 1);
  };

  const calculateBasePrice = () => {
    const days = calculateRentalDays();
    const vehicle = vehicles.find(v => v.id === formData.vehicle_id);
    if (!vehicle || days === 0) return 0;

    if (days <= 7) {
      return vehicle.daily_rate * days;
    } else if (days <= 30) {
      const weeks = Math.ceil(days / 7);
      return vehicle.weekly_rate * weeks;
    } else {
      const months = Math.floor(days / 30);
      const remainingDays = days % 30;
      return (vehicle.monthly_rate * months) + (vehicle.daily_rate * remainingDays);
    }
  };

  const calculateExtrasPrice = () => {
    return formData.selected_extras.reduce((total, extraId) => {
      const extra = pricingExtras.find(e => e.id === extraId);
      return total + (extra?.price || 0);
    }, 0);
  };

  const calculateTotalPrice = () => {
    return calculateBasePrice() + calculateExtrasPrice();
  };

  const resetForm = () => {
    setFormData({
      vehicle_id: "",
      client_id: "",
      pickup_date: undefined,
      pickup_time: "09:00",
      dropoff_date: undefined,
      dropoff_time: "09:00",
      pickup_location: "",
      dropoff_location: "",
      selected_extras: [],
      notes: "",
    });
  };

  const handleSubmitRental = async () => {
    // Validation
    if (!formData.vehicle_id) {
      toast.error("Please select a vehicle");
      return;
    }
    if (!formData.client_id) {
      toast.error("Please select a client");
      return;
    }
    if (!formData.pickup_date || !formData.dropoff_date) {
      toast.error("Please select pickup and drop-off dates");
      return;
    }
    if (!formData.pickup_location || !formData.dropoff_location) {
      toast.error("Please enter pickup and drop-off locations");
      return;
    }

    setIsSubmitting(true);
    try {
      const client = clients.find(c => c.id === formData.client_id) as any;
      const vehicle = vehicles.find(v => v.id === formData.vehicle_id);
      const rentalDays = calculateRentalDays();
      const totalPrice = calculateTotalPrice();

      const { error } = await supabase.from("bookings").insert({
        vehicle_id: formData.vehicle_id,
        client_id: formData.client_id,
        pickup_date: format(formData.pickup_date, "yyyy-MM-dd"),
        pickup_time: formData.pickup_time,
        dropoff_date: format(formData.dropoff_date, "yyyy-MM-dd"),
        pickup_location: formData.pickup_location,
        dropoff_location: formData.dropoff_location,
        rental_days: rentalDays,
        daily_rate: vehicle?.daily_rate,
        weekly_rate: vehicle?.weekly_rate,
        monthly_rate: vehicle?.monthly_rate,
        total_price: totalPrice,
        status: "new",
        customer_name: client?.name,
        customer_email: client?.email,
        customer_phone: client?.phone,
        internal_notes: formData.notes,
        passengers: 1,
      });

      if (error) throw error;

      toast.success("Rental created successfully");
      setIsModalOpen(false);
      resetForm();
      loadData();
    } catch (error: any) {
      toast.error("Failed to create rental: " + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleExtra = (extraId: string) => {
    setFormData(prev => ({
      ...prev,
      selected_extras: prev.selected_extras.includes(extraId)
        ? prev.selected_extras.filter(id => id !== extraId)
        : [...prev.selected_extras, extraId]
    }));
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-32 w-full" />
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
              Rentals Management
            </h1>
            <p className="text-muted-foreground">Manage vehicle rentals and client bookings in real time.</p>
          </div>
          <div className="flex gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={loadData} variant="outline" className="gap-2 hover:border-accent/40 transition-all">
                  <RefreshCcw className="w-4 h-4" />
                  Refresh
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reload rentals data</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={exportToCSV} variant="outline" className="gap-2 hover:border-accent/40 transition-all">
                  <Download className="w-4 h-4" />
                  Export CSV
                </Button>
              </TooltipTrigger>
              <TooltipContent>Download rental list</TooltipContent>
            </Tooltip>
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DialogTrigger asChild>
                    <Button className="gap-2 bg-accent hover:bg-accent/90 text-accent-foreground shadow-[0_0_20px_rgba(244,197,66,0.3)] hover:shadow-[0_0_30px_rgba(244,197,66,0.5)] transition-all">
                      <Plus className="w-4 h-4" />
                      New Rental
                    </Button>
                  </DialogTrigger>
                </TooltipTrigger>
                <TooltipContent>Create a new rental booking</TooltipContent>
              </Tooltip>
              <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create New Rental</DialogTitle>
                  <DialogDescription>
                    Fill in the details below to create a new rental booking
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-6 py-4">
                  {/* Vehicle & Client Selection */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="vehicle">Vehicle *</Label>
                      <Select value={formData.vehicle_id} onValueChange={(value) => setFormData(prev => ({ ...prev, vehicle_id: value }))}>
                        <SelectTrigger id="vehicle">
                          <SelectValue placeholder="Select vehicle" />
                        </SelectTrigger>
                        <SelectContent>
                          {vehicles.map((vehicle) => (
                            <SelectItem key={vehicle.id} value={vehicle.id}>
                              <div className="flex items-center justify-between w-full">
                                <span>{vehicle.name}</span>
                                <Badge variant="outline" className="ml-2">{vehicle.category}</Badge>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {formData.vehicle_id && (
                        <p className="text-xs text-muted-foreground">
                          Daily: ${vehicles.find(v => v.id === formData.vehicle_id)?.daily_rate} | 
                          Weekly: ${vehicles.find(v => v.id === formData.vehicle_id)?.weekly_rate} | 
                          Monthly: ${vehicles.find(v => v.id === formData.vehicle_id)?.monthly_rate}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="client">Client *</Label>
                      <Select value={formData.client_id} onValueChange={(value) => setFormData(prev => ({ ...prev, client_id: value }))}>
                        <SelectTrigger id="client">
                          <SelectValue placeholder="Select client" />
                        </SelectTrigger>
                        <SelectContent>
                          {clients.map((client: any) => (
                            <SelectItem key={client.id} value={client.id}>
                              <div>
                                <p>{client.name}</p>
                                <p className="text-xs text-muted-foreground">{client.email}</p>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Pickup Date & Time */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Pickup Date *</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-start text-left font-normal">
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {formData.pickup_date ? format(formData.pickup_date, "PPP") : "Pick a date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={formData.pickup_date}
                            onSelect={(date) => setFormData(prev => ({ ...prev, pickup_date: date }))}
                            disabled={(date) => date < new Date()}
                            initialFocus
                            className="pointer-events-auto"
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pickup-time">Pickup Time *</Label>
                      <TimePicker
                        id="pickup-time"
                        value={formData.pickup_time}
                        onChange={(value) => setFormData(prev => ({ ...prev, pickup_time: value }))}
                      />
                    </div>
                  </div>

                  {/* Drop-off Date & Time */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Drop-off Date *</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-start text-left font-normal">
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {formData.dropoff_date ? format(formData.dropoff_date, "PPP") : "Pick a date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={formData.dropoff_date}
                            onSelect={(date) => setFormData(prev => ({ ...prev, dropoff_date: date }))}
                            disabled={(date) => !formData.pickup_date || date <= formData.pickup_date}
                            initialFocus
                            className="pointer-events-auto"
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dropoff-time">Drop-off Time *</Label>
                      <TimePicker
                        id="dropoff-time"
                        value={formData.dropoff_time}
                        onChange={(value) => setFormData(prev => ({ ...prev, dropoff_time: value }))}
                      />
                    </div>
                  </div>

                  {/* Duration Display */}
                  {formData.pickup_date && formData.dropoff_date && (
                    <div className="p-4 bg-accent/10 border border-accent/20 rounded-lg">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium">Rental Duration:</span>
                        <Badge className="bg-accent/20 text-accent border-accent/30">
                          {calculateRentalDays()} {calculateRentalDays() === 1 ? 'day' : 'days'}
                        </Badge>
                      </div>
                    </div>
                  )}

                  {/* Locations */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="pickup-location">Pickup Location *</Label>
                      <Input
                        id="pickup-location"
                        placeholder="Enter pickup address"
                        value={formData.pickup_location}
                        onChange={(e) => setFormData(prev => ({ ...prev, pickup_location: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dropoff-location">Drop-off Location *</Label>
                      <Input
                        id="dropoff-location"
                        placeholder="Enter drop-off address"
                        value={formData.dropoff_location}
                        onChange={(e) => setFormData(prev => ({ ...prev, dropoff_location: e.target.value }))}
                      />
                    </div>
                  </div>

                  {/* Pricing Extras */}
                  {pricingExtras.length > 0 && (
                    <div className="space-y-3">
                      <Label>Optional Add-ons</Label>
                      <div className="grid grid-cols-2 gap-3">
                        {pricingExtras.map((extra) => (
                          <div key={extra.id} className="flex items-start space-x-3 p-3 border border-border rounded-lg hover:bg-muted/30 transition-colors">
                            <Checkbox
                              id={extra.id}
                              checked={formData.selected_extras.includes(extra.id)}
                              onCheckedChange={() => toggleExtra(extra.id)}
                            />
                            <div className="flex-1">
                              <Label htmlFor={extra.id} className="cursor-pointer font-medium">
                                {extra.extra_name}
                              </Label>
                              {extra.description && (
                                <p className="text-xs text-muted-foreground mt-1">{extra.description}</p>
                              )}
                              <p className="text-sm font-semibold text-accent mt-1">${extra.price.toFixed(2)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Price Summary */}
                  {formData.vehicle_id && formData.pickup_date && formData.dropoff_date && (
                    <div className="p-4 bg-card border border-border rounded-lg space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Base Rental ({calculateRentalDays()} days)</span>
                        <span className="font-medium">${calculateBasePrice().toFixed(2)}</span>
                      </div>
                      {formData.selected_extras.length > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Add-ons</span>
                          <span className="font-medium">${calculateExtrasPrice().toFixed(2)}</span>
                        </div>
                      )}
                      <div className="pt-2 border-t border-border flex justify-between items-center">
                        <span className="font-semibold">Total Price</span>
                        <span className="text-2xl font-bold text-accent">${calculateTotalPrice().toFixed(2)}</span>
                      </div>
                    </div>
                  )}

                  {/* Notes */}
                  <div className="space-y-2">
                    <Label htmlFor="notes">Internal Notes</Label>
                    <Textarea
                      id="notes"
                      placeholder="Add any special requirements or notes..."
                      value={formData.notes}
                      onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                      rows={3}
                    />
                  </div>

                  {/* Action Buttons */}
                  <div className="flex justify-end gap-3 pt-4">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsModalOpen(false);
                        resetForm();
                      }}
                      disabled={isSubmitting}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleSubmitRental}
                      disabled={isSubmitting}
                      className="bg-accent hover:bg-accent/90 text-accent-foreground"
                    >
                      {isSubmitting ? "Creating..." : "Create Rental"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Filters */}
        <div className="p-6 bg-card/50 rounded-lg border border-border/50 shadow-metal backdrop-blur-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Filters</h3>
              {activeFilterCount > 0 && (
                <Badge className="bg-accent/20 text-accent border-accent/30 text-xs">
                  {activeFilterCount} active
                </Badge>
              )}
            </div>
            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAllFilters}
                className="text-accent hover:text-accent/80 hover:bg-accent/10 gap-1 transition-all"
              >
                <X className="w-3 h-3" />
                Clear All
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by client, location..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className={cn(
                  "pl-9 transition-all",
                  searchTerm && "border-accent/40 shadow-[0_0_10px_rgba(244,197,66,0.1)]"
                )}
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className={cn("transition-all", statusFilter !== "all" && "border-accent/40")}>
                <SelectValue placeholder="Rental Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="pending_return">Overdue</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>

            <Select value={vehicleFilter} onValueChange={setVehicleFilter}>
              <SelectTrigger className={cn("transition-all", vehicleFilter !== "all" && "border-accent/40")}>
                <SelectValue placeholder="Vehicle" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Vehicles</SelectItem>
                {vehicles.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={clientFilter} onValueChange={setClientFilter}>
              <SelectTrigger className={cn("transition-all", clientFilter !== "all" && "border-accent/40")}>
                <SelectValue placeholder="Client" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Clients</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Rentals Table */}
        <div className="rounded-lg border border-border/50 overflow-hidden shadow-metal bg-card/50 backdrop-blur-sm">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-border/50">
                <TableHead>Client</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Pickup Date</TableHead>
                <TableHead>Drop-off Date</TableHead>
                <TableHead>Days</TableHead>
                <TableHead>Total Price</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredBookings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-16">
                    <div className="flex flex-col items-center gap-4">
                      <Car className="w-12 h-12 text-muted-foreground/50" />
                      <div>
                        <p className="text-lg font-medium text-foreground mb-1">
                          {bookings.length === 0 ? "No rentals yet" : "No rentals found"}
                        </p>
                        <p className="text-sm text-muted-foreground mb-4">
                          {bookings.length === 0 
                            ? "Add your first rental to get started" 
                            : "No rentals match your current filters. Try adjusting your search criteria."}
                        </p>
                        {bookings.length === 0 && (
                          <Button
                            onClick={() => setIsModalOpen(true)}
                            className="gap-2 bg-accent hover:bg-accent/90 text-accent-foreground"
                          >
                            <Plus className="w-4 h-4" />
                            New Rental
                          </Button>
                        )}
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredBookings.map((booking) => (
                  <TableRow key={booking.id} className="hover:bg-muted/30 transition-colors border-border/50">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <p className="font-medium">{booking.customer_name || "N/A"}</p>
                          <p className="text-xs text-muted-foreground">{booking.customer_email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Car className="w-4 h-4 text-muted-foreground" />
                        <span>{vehicles.find(v => v.id === booking.vehicle_id)?.name || "N/A"}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                        {format(new Date(booking.pickup_date), "dd MMM yyyy")}
                      </div>
                    </TableCell>
                    <TableCell>
                      {booking.dropoff_date ? format(new Date(booking.dropoff_date), "dd MMM yyyy") : "TBD"}
                    </TableCell>
                    <TableCell>{booking.rental_days || "N/A"} days</TableCell>
                    <TableCell className="font-semibold">${booking.total_price?.toFixed(2) || "0.00"}</TableCell>
                    <TableCell>
                      <Badge className={cn("gap-1 border w-28 justify-center", getStatusColor(booking.status))}>
                        {getStatusIcon(booking.status)}
                        {getStatusLabel(booking.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate(`/admin/rentals/${booking.id}`)}>
                            View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => updateBookingStatus(booking.id, "pending")}>
                            Mark Pending
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => updateBookingStatus(booking.id, "confirmed")}>
                            Mark Confirmed
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => updateBookingStatus(booking.id, "in_progress")}>
                            Mark In Progress
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => updateBookingStatus(booking.id, "completed")}>
                            Mark Completed
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => updateBookingStatus(booking.id, "cancelled")}
                            className="text-red-500"
                          >
                            Cancel Rental
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </TooltipProvider>
  );
}
