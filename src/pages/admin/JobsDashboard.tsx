import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Calendar, MapPin, User, Car, Phone, Mail } from "lucide-react";

interface Booking {
  id: string;
  pickup_location: string;
  dropoff_location: string;
  pickup_date: string;
  pickup_time: string;
  status: string;
  total_price: number;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  passengers: number;
  route_notes: string;
  internal_notes: string;
  driver_id: string | null;
  vehicle_id: string | null;
  vehicles: { name: string } | null;
  drivers: { name: string } | null;
}

const JobsDashboard = () => {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);

    const [bookingsRes, driversRes] = await Promise.all([
      supabase
        .from("bookings")
        .select(`
          *,
          vehicles (name),
          drivers (name)
        `)
        .order("pickup_date", { ascending: true }),
      supabase.from("drivers").select("*").eq("is_available", true),
    ]);

    if (bookingsRes.error) {
      toast.error("Failed to load bookings");
    } else {
      setBookings(bookingsRes.data || []);
    }

    if (driversRes.error) {
      toast.error("Failed to load drivers");
    } else {
      setDrivers((driversRes.data || []) as any[]);
    }

    setLoading(false);
  };

  const updateBookingStatus = async (bookingId: string, status: string) => {
    const { error } = await supabase
      .from("bookings")
      .update({ status })
      .eq("id", bookingId);

    if (error) {
      toast.error("Failed to update status");
      return;
    }

    toast.success("Status updated");
    loadData();
  };

  const assignDriver = async (bookingId: string, driverId: string) => {
    const { error } = await supabase
      .from("bookings")
      .update({ driver_id: driverId })
      .eq("id", bookingId);

    if (error) {
      toast.error("Failed to assign driver");
      return;
    }

    toast.success("Driver assigned");
    loadData();
  };

  const updateNotes = async (bookingId: string, field: string, value: string) => {
    const { error } = await supabase
      .from("bookings")
      .update({ [field]: value })
      .eq("id", bookingId);

    if (error) {
      toast.error("Failed to update notes");
      return;
    }

    toast.success("Notes updated");
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "new":
        return "bg-blue-500";
      case "confirmed":
        return "bg-green-500";
      case "in_progress":
        return "bg-yellow-500";
      case "completed":
        return "bg-gray-500";
      case "canceled":
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
  };

  const filteredBookings = filterStatus === "all" 
    ? bookings 
    : bookings.filter(b => b.status === filterStatus);

  if (loading) {
    return <div className="p-8">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-display font-bold text-gradient-metal">Jobs Dashboard</h1>
        
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Jobs</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="canceled">Canceled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-6">
        {filteredBookings.map((booking) => (
          <Card key={booking.id} className="p-6 shadow-metal">
            <div className="space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <Badge className={getStatusColor(booking.status)}>
                    {booking.status.replace("_", " ").toUpperCase()}
                  </Badge>
                  <p className="text-2xl font-display font-bold mt-2">${booking.total_price}</p>
                </div>
                
                <Select
                  value={booking.status}
                  onValueChange={(value) => updateBookingStatus(booking.id, value)}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">New</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="canceled">Canceled</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">From:</span> {booking.pickup_location}
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">To:</span> {booking.dropoff_location}
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    <span>{booking.pickup_date} at {booking.pickup_time}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span>{booking.passengers} passenger(s)</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">{booking.customer_name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                    <span>{booking.customer_email}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    <span>{booking.customer_phone}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Car className="w-4 h-4 text-muted-foreground" />
                    <span>{booking.vehicles?.name || "No vehicle assigned"}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Assign Driver</label>
                  <Select
                    value={booking.driver_id || ""}
                    onValueChange={(value) => assignDriver(booking.id, value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select driver" />
                    </SelectTrigger>
                    <SelectContent>
                      {drivers.map((driver) => (
                        <SelectItem key={driver.id} value={driver.id}>
                          {driver.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium">Route Notes</label>
                  <Textarea
                    value={booking.route_notes || ""}
                    onChange={(e) => updateNotes(booking.id, "route_notes", e.target.value)}
                    placeholder="Add route notes..."
                    rows={2}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">Internal Notes</label>
                  <Textarea
                    value={booking.internal_notes || ""}
                    onChange={(e) => updateNotes(booking.id, "internal_notes", e.target.value)}
                    placeholder="Add internal notes..."
                    rows={2}
                  />
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default JobsDashboard;
