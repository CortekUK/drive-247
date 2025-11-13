import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { format } from "date-fns";
import { 
  Calendar as CalendarIcon, 
  Download, 
  Search, 
  Shield, 
  Car, 
  MapPin, 
  Clock, 
  User, 
  ChevronRight,
  Plus,
  X,
  CheckCircle2,
  XCircle,
  AlertCircle,
  MoreVertical,
  Navigation,
  RefreshCcw
} from "lucide-react";
import { cn, getNavigationUrl } from "@/lib/utils";

interface Booking {
  id: string;
  pickup_location: string;
  dropoff_location: string;
  pickup_date: string;
  pickup_time: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  status: string | null;
  driver_id: string | null;
  vehicle_id: string | null;
  total_price: number | null;
  created_at: string | null;
  service_type: string | null;
  priority: string | null;
  protection_details: any;
}

interface Driver {
  id: string;
  name: string;
  is_available: boolean;
}

interface Vehicle {
  id: string;
  name: string;
  category: string;
}

export default function EnhancedJobsDashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filteredBookings, setFilteredBookings] = useState<Booking[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [serviceTypeFilter, setServiceTypeFilter] = useState("all");
  const [driverFilter, setDriverFilter] = useState("all");
  const [vehicleFilter, setVehicleFilter] = useState("all");
  const [dateRange, setDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({
    from: undefined,
    to: undefined,
  });

  // Sorting
  const [sortField, setSortField] = useState<keyof Booking>("pickup_date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Get paginated bookings
  const paginatedBookings = filteredBookings.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );
  const totalPages = Math.ceil(filteredBookings.length / pageSize);

  // Count active filters
  const activeFilterCount = [
    searchTerm !== "",
    statusFilter !== "all",
    serviceTypeFilter !== "all",
    driverFilter !== "all",
    vehicleFilter !== "all",
    dateRange.from !== undefined
  ].filter(Boolean).length;

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    // Apply URL filters on mount
    const urlServiceType = searchParams.get("serviceType");
    const urlStatus = searchParams.get("status");
    
    if (urlServiceType) setServiceTypeFilter(urlServiceType);
    if (urlStatus) setStatusFilter(urlStatus);
  }, [searchParams]);

  useEffect(() => {
    applyFilters();
    setCurrentPage(1); // Reset to first page when filters change
  }, [bookings, searchTerm, statusFilter, serviceTypeFilter, driverFilter, vehicleFilter, dateRange, sortField, sortDirection]);

  const loadData = async () => {
    try {
      const [bookingsRes, driversRes, vehiclesRes] = await Promise.all([
        supabase.from("bookings").select("*", { count: 'exact', head: false }).order("created_at", { ascending: false }),
        supabase.from("drivers").select("id, name, is_available", { count: 'exact', head: false }).eq("is_available", true),
        supabase.from("vehicles").select("id, name, category", { count: 'exact', head: false }).eq("is_active", true),
      ]);

      if (bookingsRes.error) throw bookingsRes.error;
      if (driversRes.error) throw driversRes.error;
      if (vehiclesRes.error) throw vehiclesRes.error;

      setBookings(bookingsRes.data as any || []);
      setDrivers((driversRes.data || []) as Array<{ id: string; name: string; is_available: boolean }>);
      setVehicles(vehiclesRes.data || []);
    } catch (error: any) {
      toast.error("Failed to load data: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...bookings];

    // Search filter
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

    // Status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter((b) => b.status === statusFilter);
    }

    // Service type filter
    if (serviceTypeFilter !== "all") {
      filtered = filtered.filter((b) => b.service_type === serviceTypeFilter);
    }

    // Driver filter
    if (driverFilter !== "all") {
      filtered = filtered.filter((b) => b.driver_id === driverFilter);
    }

    // Vehicle filter
    if (vehicleFilter !== "all") {
      filtered = filtered.filter((b) => b.vehicle_id === vehicleFilter);
    }

    // Date range filter
    if (dateRange.from) {
      filtered = filtered.filter((b) => {
        const bookingDate = new Date(b.pickup_date);
        if (dateRange.to) {
          return bookingDate >= dateRange.from! && bookingDate <= dateRange.to;
        }
        return bookingDate >= dateRange.from!;
      });
    }

    // Sorting
    filtered.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      
      const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDirection === "asc" ? comparison : -comparison;
    });

    setFilteredBookings(filtered);
  };

  const handleSort = (field: keyof Booking) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const updateBookingStatus = async (id: string, newStatus: string) => {
    try {
      // Optimistic UI update
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
      // Revert optimistic update on error
      loadData();
    }
  };

  const assignDriver = async (bookingId: string, driverId: string) => {
    try {
      const assignedAt = new Date().toISOString();
      
      // Optimistic UI update
      setBookings(prev => prev.map(b => 
        b.id === bookingId ? { ...b, driver_id: driverId, assigned_at: assignedAt } : b
      ));

      const { error } = await supabase
        .from("bookings")
        .update({ status: 'assigned' } as any)
        .eq("id", bookingId);

      if (error) throw error;
      toast.success("Driver assigned successfully");
    } catch (error: any) {
      toast.error("Failed to assign driver: " + error.message);
      // Revert optimistic update on error
      loadData();
    }
  };

  const handleNavigationClick = async (bookingId: string, currentStatus: string | null, location: string, app: 'google' | 'waze' | 'apple') => {
    try {
      // Only update status if it's currently "new"
      if (currentStatus === 'new') {
        // Optimistic UI update
        setBookings(prev => prev.map(b => 
          b.id === bookingId ? { ...b, status: 'in_progress' } : b
        ));

        const { error } = await supabase
          .from("bookings")
          .update({ status: 'in_progress' })
          .eq("id", bookingId);

        if (error) throw error;
        toast.success("Job status updated to In Progress");
      }
      
      // Open navigation in new tab
      window.open(getNavigationUrl(location, app), '_blank');
    } catch (error: any) {
      toast.error("Failed to update job status: " + error.message);
      // Revert optimistic update on error
      loadData();
    }
  };

  const exportToCSV = () => {
    const headers = ["Date", "Customer", "Pickup", "Dropoff", "Status", "Driver", "Vehicle", "Price"];
    const rows = filteredBookings.map((b) => [
      b.pickup_date,
      b.customer_name || "",
      b.pickup_location,
      b.dropoff_location,
      b.status || "",
      drivers.find((d) => d.id === b.driver_id)?.name || "",
      vehicles.find((v) => v.id === b.vehicle_id)?.name || "",
      b.total_price || "",
    ]);

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jobs-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
  };

  const getStatusColor = (status: string | null) => {
    switch (status) {
      case "new": return "bg-primary/20 text-primary border-primary/30";
      case "in_review": return "bg-amber-500/20 text-amber-400 border-amber-500/30";
      case "confirmed": return "bg-green-500/20 text-green-400 border-green-500/30";
      case "in_progress": return "bg-amber-500/20 text-amber-400 border-amber-500/30";
      case "completed": return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      case "cancelled": return "bg-red-500/20 text-red-400 border-red-500/30";
      default: return "bg-muted/20 text-muted-foreground border-muted/30";
    }
  };

  const getStatusIcon = (status: string | null) => {
    switch (status) {
      case "new": return <AlertCircle className="w-3 h-3" />;
      case "confirmed": return <CheckCircle2 className="w-3 h-3" />;
      case "completed": return <CheckCircle2 className="w-3 h-3" />;
      case "cancelled": return <XCircle className="w-3 h-3" />;
      default: return <Clock className="w-3 h-3" />;
    }
  };

  const clearAllFilters = () => {
    setSearchTerm("");
    setStatusFilter("all");
    setServiceTypeFilter("all");
    setDriverFilter("all");
    setVehicleFilter("all");
    setDateRange({ from: undefined, to: undefined });
    toast.success("Filters cleared");
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
              Jobs Management
            </h1>
            <p className="text-muted-foreground">Manage bookings, drivers, and route assignments in real time.</p>
          </div>
          <div className="flex gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={loadData} variant="outline" className="gap-2 hover:border-accent/40 transition-all">
                  <RefreshCcw className="w-4 h-4" />
                  Refresh
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reload jobs data</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={exportToCSV} variant="outline" className="gap-2 hover:border-accent/40 transition-all">
                  <Download className="w-4 h-4" />
                  Export CSV
                </Button>
              </TooltipTrigger>
              <TooltipContent>Download job list for reporting</TooltipContent>
            </Tooltip>
            <Button 
              onClick={() => navigate("/admin/jobs/new")} 
              className="gap-2 bg-gradient-to-r from-accent/90 to-accent hover:from-accent hover:to-accent/90 shadow-[0_0_20px_rgba(244,197,66,0.3)] hover:shadow-[0_0_30px_rgba(244,197,66,0.4)] transition-all"
            >
              <Plus className="w-4 h-4" />
              Add New Job
            </Button>
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

        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by client, location, or vehicle..."
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
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="in_review">In Review</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>

          <Select value={serviceTypeFilter} onValueChange={setServiceTypeFilter}>
            <SelectTrigger className={cn("transition-all", serviceTypeFilter !== "all" && "border-accent/40")}>
              <SelectValue placeholder="Service Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Services</SelectItem>
              <SelectItem value="chauffeur">Chauffeur</SelectItem>
              <SelectItem value="close_protection">Close Protection</SelectItem>
            </SelectContent>
          </Select>

          <Select value={driverFilter} onValueChange={setDriverFilter}>
            <SelectTrigger className={cn("transition-all", driverFilter !== "all" && "border-accent/40")}>
              <SelectValue placeholder="Driver" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Drivers</SelectItem>
              {drivers.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
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

          <Popover>
            <PopoverTrigger asChild>
              <Button 
                variant="outline" 
                className={cn(
                  "justify-start text-left font-normal transition-all",
                  !dateRange.from && "text-muted-foreground",
                  dateRange.from && "border-accent/40"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateRange.from ? (
                  dateRange.to ? (
                    <>
                      {format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")}
                    </>
                  ) : (
                    format(dateRange.from, "LLL dd, y")
                  )
                ) : (
                  <span>Pick a date</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={dateRange.from}
                selected={{ from: dateRange.from, to: dateRange.to }}
                onSelect={(range) => setDateRange({ from: range?.from, to: range?.to })}
                numberOfMonths={2}
                className="pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Results summary */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, filteredBookings.length)} of {filteredBookings.length} jobs
        </div>
        <Select value={pageSize.toString()} onValueChange={(val) => setPageSize(Number(val))}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="5">Show 5</SelectItem>
            <SelectItem value="10">Show 10</SelectItem>
            <SelectItem value="20">Show 20</SelectItem>
            <SelectItem value="50">Show 50</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Jobs Table */}
      <div className="border border-border/50 rounded-lg shadow-metal bg-card/50 backdrop-blur-sm">
        {filteredBookings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-4">
            <Search className="w-16 h-16 text-muted-foreground/50 mb-4" />
            <h3 className="text-xl font-semibold mb-2">No jobs found</h3>
            <p className="text-muted-foreground text-center mb-6">
              No jobs match the selected criteria. Try adjusting your filters or creating a new booking.
            </p>
            <Button
              onClick={() => navigate("/admin/jobs/new")}
              className="gap-2 bg-gradient-to-r from-accent/90 to-accent hover:from-accent hover:to-accent/90"
            >
              <Plus className="w-4 h-4" />
              New Job
            </Button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-t-lg">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b border-border/50">
                  <TableHead className="cursor-pointer uppercase text-xs font-semibold tracking-wide hover:text-accent transition-colors w-[220px]" onClick={() => handleSort("pickup_date")}>
                    Date {sortField === "pickup_date" && (sortDirection === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead className="uppercase text-xs font-semibold tracking-wide">Customer</TableHead>
                  <TableHead className="uppercase text-xs font-semibold tracking-wide">Route</TableHead>
                  <TableHead className="uppercase text-xs font-semibold tracking-wide w-[220px]">Service Type</TableHead>
                  <TableHead className="cursor-pointer uppercase text-xs font-semibold tracking-wide hover:text-accent transition-colors w-[180px]" onClick={() => handleSort("status")}>
                    Status {sortField === "status" && (sortDirection === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead className="uppercase text-xs font-semibold tracking-wide">Driver</TableHead>
                  <TableHead className="uppercase text-xs font-semibold tracking-wide">Vehicle</TableHead>
                  <TableHead className="uppercase text-xs font-semibold tracking-wide text-right">Price</TableHead>
                  <TableHead className="uppercase text-xs font-semibold tracking-wide">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedBookings.map((booking, index) => (
                <TableRow 
                  key={booking.id} 
                  className="cursor-pointer hover:bg-muted/30 transition-all hover:shadow-[0_0_20px_rgba(244,197,66,0.1)] group animate-fade-in"
                  style={{ animationDelay: `${index * 50}ms` }}
                  onClick={() => navigate(`/admin/jobs/${booking.id}`)}
                >
                  <TableCell>
                    <div className="flex items-start gap-2 w-[140px]">
                      <Clock className="w-4 h-4 text-muted-foreground mt-0.5 opacity-60" />
                      <div>
                        <div className="font-semibold text-foreground">{format(new Date(booking.pickup_date), "MMM dd, yyyy")}</div>
                        <div className="text-xs text-muted-foreground">{booking.pickup_time}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-start gap-2">
                      <User className="w-4 h-4 text-muted-foreground mt-0.5 opacity-60" />
                      <div>
                        <div className="font-semibold text-foreground">{booking.customer_name || "N/A"}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[200px]">{booking.customer_email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-start gap-2 max-w-[250px]">
                      <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 opacity-60 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-foreground truncate">{booking.pickup_location}</div>
                        <div className="flex items-center gap-1 text-xs text-accent/80">
                          <ChevronRight className="w-3 h-3" />
                          <span className="truncate">{booking.dropoff_location}</span>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent/10 hover:text-accent"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Navigation className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              handleNavigationClick(booking.id, booking.status, booking.pickup_location, 'google');
                            }}
                          >
                            Google Maps
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              handleNavigationClick(booking.id, booking.status, booking.pickup_location, 'waze');
                            }}
                          >
                            Waze
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              handleNavigationClick(booking.id, booking.status, booking.pickup_location, 'apple');
                            }}
                          >
                            Apple Maps
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1 w-[140px]">
                      {booking.service_type === "close_protection" ? (
                        <Badge className="bg-accent/20 text-accent border-accent/30 gap-1 hover:bg-transparent w-fit shadow-[0_0_10px_rgba(244,197,66,0.2)]">
                          <Shield className="w-3 h-3" />
                          Close Protection
                        </Badge>
                      ) : (
                        <Badge className="bg-blue-500/20 hover:bg-transparent text-blue-400 border-blue-500/30 gap-1 w-fit">
                          <Car className="w-3 h-3" />
                          Chauffeur
                        </Badge>
                      )}
                      {booking.priority === "high" && (
                        <Badge className="bg-red-500/20 hover:bg-transparent text-red-400 border-red-500/30 text-xs w-fit">
                          High Priority
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="w-[140px]">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge className={cn(getStatusColor(booking.status), "gap-1 cursor-pointer hover:bg-transparent transition-all hover:scale-105")}>
                          {getStatusIcon(booking.status)}
                          {booking.status ? booking.status.replace('_', ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : "New"}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        {booking.status === "new" && "Awaiting confirmation"}
                        {booking.status === "confirmed" && "Job confirmed and scheduled"}
                        {booking.status === "in_progress" && "Currently in progress"}
                        {booking.status === "completed" && "Job completed successfully"}
                        {booking.status === "cancelled" && "Job cancelled"}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={booking.driver_id || "none"}
                      onValueChange={(value) => value !== "none" && assignDriver(booking.id, value)}
                    >
                      <SelectTrigger 
                        className="w-[150px] hover:border-accent/40 transition-all" 
                        onClick={(e) => e.stopPropagation()}
                      >
                        <SelectValue placeholder="No driver assigned" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none" className="text-muted-foreground italic">No driver</SelectItem>
                        {drivers.map((d) => (
                          <SelectItem key={d.id} value={d.id} className="flex items-center justify-between">
                            <span>{d.name}</span>
                            {d.is_available && <span className="text-green-400 ml-2">● Available</span>}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Car className="w-4 h-4 text-muted-foreground opacity-60" />
                      <div>
                        <div className="font-medium text-foreground">
                          {vehicles.find((v) => v.id === booking.vehicle_id)?.name || "Not assigned"}
                        </div>
                        {booking.vehicle_id && (
                          <div className="text-xs text-muted-foreground">
                            {vehicles.find((v) => v.id === booking.vehicle_id)?.category}
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className={cn(
                      "font-semibold",
                      booking.total_price && booking.total_price > 500 ? "text-accent" : "text-foreground"
                    )}>
                      ${booking.total_price?.toFixed(2) || "0.00"}
                    </div>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Select
                      value={booking.status || "new"}
                      onValueChange={(value) => updateBookingStatus(booking.id, value)}
                    >
                      <SelectTrigger className="w-[140px] hover:border-accent/40 transition-all">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">New</SelectItem>
                        <SelectItem value="confirmed">Confirmed</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
            </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="border-t border-border/50 p-4">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious 
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      className={cn(
                        "cursor-pointer hover:bg-accent/10 hover:text-accent transition-all",
                        currentPage === 1 && "pointer-events-none opacity-50"
                      )}
                    />
                  </PaginationItem>
                  
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                    if (
                      page === 1 ||
                      page === totalPages ||
                      (page >= currentPage - 1 && page <= currentPage + 1)
                    ) {
                      return (
                        <PaginationItem key={page}>
                          <PaginationLink
                            onClick={() => setCurrentPage(page)}
                            isActive={currentPage === page}
                            className={cn(
                              "cursor-pointer transition-all",
                              currentPage === page
                                ? "bg-accent/20 text-accent border-accent/40 shadow-[0_0_10px_rgba(244,197,66,0.2)]"
                                : "hover:bg-accent/10 hover:text-accent"
                            )}
                          >
                            {page}
                          </PaginationLink>
                        </PaginationItem>
                      );
                    } else if (page === currentPage - 2 || page === currentPage + 2) {
                      return (
                        <PaginationItem key={page}>
                          <span className="px-2 text-muted-foreground">...</span>
                        </PaginationItem>
                      );
                    }
                    return null;
                  })}

                  <PaginationItem>
                    <PaginationNext 
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      className={cn(
                        "cursor-pointer hover:bg-accent/10 hover:text-accent transition-all",
                        currentPage === totalPages && "pointer-events-none opacity-50"
                      )}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </>
        )}
      </div>
    </div>
    </TooltipProvider>
  );
}
