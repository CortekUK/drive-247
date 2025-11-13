import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { 
  ArrowLeft, 
  MapPin, 
  Clock, 
  User, 
  Car, 
  Phone, 
  Mail, 
  FileText, 
  Calendar,
  Shield,
  Upload,
  Eye,
  Edit,
  CheckCircle,
  XCircle,
  AlertCircle,
  FileCheck,
  Sparkles,
  Receipt,
  Fuel
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface RentalDetail {
  id: string;
  pickup_location: string;
  dropoff_location: string;
  pickup_date: string;
  pickup_time: string;
  dropoff_date: string | null;
  dropoff_time: string | null;
  rental_days: number | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  license_number: string | null;
  status: string;
  vehicle_id: string | null;
  total_price: number;
  special_requests: string | null;
  internal_notes: string | null;
  service_type: string;
  daily_rate: number | null;
  weekly_rate: number | null;
  monthly_rate: number | null;
  vehicle?: {
    name: string;
    category: string;
    image_url: string | null;
  };
}

interface VerificationStatus {
  license_verified: boolean;
  insurance_verified: boolean;
  payment_verified: boolean;
}

export default function RentalDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [rental, setRental] = useState<RentalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [internalNotes, setInternalNotes] = useState("");
  const [verification, setVerification] = useState<VerificationStatus>({
    license_verified: false,
    insurance_verified: false,
    payment_verified: false,
  });

  // Form states for editing
  const [editForm, setEditForm] = useState({
    pickup_date: "",
    pickup_time: "",
    dropoff_date: "",
    dropoff_time: "",
    status: "",
    vehicle_id: "",
  });

  useEffect(() => {
    if (id) loadRentalDetails();
  }, [id]);

  const loadRentalDetails = async () => {
    try {
      const { data, error } = await supabase
        .from("bookings")
        .select(`
          *,
          vehicles:vehicle_id (
            name,
            category,
            image_url
          )
        `)
        .eq("id", id)
        .single();

      if (error) throw error;
      
      const rentalData = {
        ...data,
        vehicle: data.vehicles,
      } as RentalDetail;
      
      setRental(rentalData);
      setInternalNotes(data.internal_notes || "");
      setEditForm({
        pickup_date: data.pickup_date,
        pickup_time: data.pickup_time,
        dropoff_date: data.dropoff_date || "",
        dropoff_time: data.dropoff_time || "",
        status: data.status || "pending",
        vehicle_id: data.vehicle_id || "",
      });
    } catch (error: any) {
      toast.error("Failed to load rental details: " + error.message);
      navigate("/admin/rentals");
    } finally {
      setLoading(false);
    }
  };

  const saveNotes = async () => {
    try {
      const { error } = await supabase
        .from("bookings")
        .update({ internal_notes: internalNotes })
        .eq("id", id);

      if (error) throw error;
      toast.success("Notes saved successfully");
    } catch (error: any) {
      toast.error("Failed to save notes: " + error.message);
    }
  };

  const saveEdit = async () => {
    try {
      const { error } = await supabase
        .from("bookings")
        .update({
          pickup_date: editForm.pickup_date,
          pickup_time: editForm.pickup_time,
          dropoff_date: editForm.dropoff_date,
          dropoff_time: editForm.dropoff_time,
          status: editForm.status,
          vehicle_id: editForm.vehicle_id || null,
        })
        .eq("id", id);

      if (error) throw error;
      toast.success("Rental updated successfully");
      setEditing(false);
      await loadRentalDetails();
    } catch (error: any) {
      toast.error("Failed to update rental: " + error.message);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending": 
        return "bg-gray-500/20 text-gray-300 border-gray-500/30";
      case "confirmed": 
        return "bg-accent/20 text-accent border-accent/30";
      case "in_progress": 
        return "bg-blue-500/20 text-blue-300 border-blue-500/30";
      case "completed": 
        return "bg-green-500/20 text-green-300 border-green-500/30";
      case "cancelled": 
        return "bg-red-500/20 text-red-300 border-red-500/30";
      default: 
        return "bg-gray-500/20 text-gray-300 border-gray-500/30";
    }
  };

  const getStatusLabel = (status: string) => {
    return status.charAt(0).toUpperCase() + status.slice(1).replace("_", " ");
  };

  const getVerificationIcon = (verified: boolean) => {
    if (verified) return <CheckCircle className="w-4 h-4 text-green-400" />;
    return <AlertCircle className="w-4 h-4 text-amber-400" />;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading rental details...</p>
        </div>
      </div>
    );
  }

  if (!rental) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <XCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h2 className="text-2xl font-display font-bold mb-2">Rental Not Found</h2>
          <p className="text-muted-foreground mb-6">The rental you're looking for doesn't exist.</p>
          <Button onClick={() => navigate("/admin/rentals")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Rentals
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => navigate("/admin/rentals")}
              className="hover:bg-accent/10"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-display font-bold">Rental Details</h1>
              <p className="text-muted-foreground text-sm mt-1">
                Booking ID: {rental.id.slice(0, 8)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge className={cn("gap-2 px-4 py-2", getStatusColor(rental.status))}>
              {getStatusLabel(rental.status)}
            </Badge>
            {!editing ? (
              <Button onClick={() => setEditing(true)} className="gap-2">
                <Edit className="w-4 h-4" />
                Edit Rental
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button onClick={saveEdit} className="gap-2">
                  <CheckCircle className="w-4 h-4" />
                  Save Changes
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setEditing(false);
                    setEditForm({
                      pickup_date: rental.pickup_date,
                      pickup_time: rental.pickup_time,
                      dropoff_date: rental.dropoff_date || "",
                      dropoff_time: rental.dropoff_time || "",
                      status: rental.status || "pending",
                      vehicle_id: rental.vehicle_id || "",
                    });
                  }}
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Two-Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - 2/3 width */}
          <div className="lg:col-span-2 space-y-6">
            {/* Customer Information */}
            <Card className="p-6 border-accent/20 shadow-[0_0_15px_rgba(255,215,0,0.1)]">
              <h3 className="text-xl font-display font-semibold mb-4 flex items-center gap-2">
                <User className="w-5 h-5 text-accent" />
                Customer Information
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Name</p>
                  <p className="font-medium">{rental.customer_name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Email</p>
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                    <a 
                      href={`mailto:${rental.customer_email}`} 
                      className="text-accent hover:underline text-sm"
                    >
                      {rental.customer_email}
                    </a>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Phone</p>
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    <a 
                      href={`tel:${rental.customer_phone}`} 
                      className="text-accent hover:underline text-sm"
                    >
                      {rental.customer_phone}
                    </a>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Driver's License No.</p>
                  <div className="flex items-center gap-2">
                    <FileCheck className="w-4 h-4 text-muted-foreground" />
                    <p className="font-medium text-sm">
                      {rental.license_number || "Not provided"}
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Verification Status */}
              <div className="mt-6 pt-6 border-t border-accent/20">
                <p className="text-sm text-muted-foreground mb-3">Verification Status</p>
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex items-center gap-2">
                    {getVerificationIcon(verification.license_verified)}
                    <span className="text-sm">License</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {getVerificationIcon(verification.insurance_verified)}
                    <span className="text-sm">Insurance</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {getVerificationIcon(verification.payment_verified)}
                    <span className="text-sm">Payment</span>
                  </div>
                </div>
              </div>
            </Card>

            {/* Rental Summary */}
            <Card className="p-6 border-accent/20 shadow-[0_0_15px_rgba(255,215,0,0.1)]">
              <h3 className="text-xl font-display font-semibold mb-4 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-accent" />
                Rental Summary
              </h3>
              
              <div className="space-y-4">
                {/* Dates & Times */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground">Pickup Date & Time</Label>
                    {editing ? (
                      <div className="grid grid-cols-2 gap-2 mt-1">
                        <Input
                          type="date"
                          value={editForm.pickup_date}
                          onChange={(e) => setEditForm({ ...editForm, pickup_date: e.target.value })}
                        />
                        <Input
                          type="time"
                          value={editForm.pickup_time}
                          onChange={(e) => setEditForm({ ...editForm, pickup_time: e.target.value })}
                        />
                      </div>
                    ) : (
                      <p className="font-medium mt-1">
                        {format(new Date(rental.pickup_date), "MMM dd, yyyy")} at {rental.pickup_time}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Return Date & Time</Label>
                    {editing ? (
                      <div className="grid grid-cols-2 gap-2 mt-1">
                        <Input
                          type="date"
                          value={editForm.dropoff_date}
                          onChange={(e) => setEditForm({ ...editForm, dropoff_date: e.target.value })}
                        />
                        <Input
                          type="time"
                          value={editForm.dropoff_time}
                          onChange={(e) => setEditForm({ ...editForm, dropoff_time: e.target.value })}
                        />
                      </div>
                    ) : (
                      <p className="font-medium mt-1">
                        {rental.dropoff_date 
                          ? `${format(new Date(rental.dropoff_date), "MMM dd, yyyy")} at ${rental.dropoff_time}`
                          : "Not specified"}
                      </p>
                    )}
                  </div>
                </div>

                {/* Locations */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground flex items-center gap-2">
                      <MapPin className="w-4 h-4" />
                      Pickup Location
                    </Label>
                    <p className="font-medium mt-1">{rental.pickup_location}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground flex items-center gap-2">
                      <MapPin className="w-4 h-4" />
                      Return Location
                    </Label>
                    <p className="font-medium mt-1">{rental.dropoff_location}</p>
                  </div>
                </div>

                {/* Duration */}
                <div>
                  <Label className="text-muted-foreground flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Duration
                  </Label>
                  <p className="font-medium mt-1">
                    {rental.rental_days || 1} day{(rental.rental_days || 1) > 1 ? "s" : ""}
                  </p>
                </div>

                {/* Vehicle */}
                <div className="pt-4 border-t border-accent/20">
                  <Label className="text-muted-foreground flex items-center gap-2 mb-2">
                    <Car className="w-4 h-4" />
                    Assigned Vehicle
                  </Label>
                  {rental.vehicle ? (
                    <div className="flex items-center gap-4 p-3 bg-accent/5 rounded-lg border border-accent/20">
                      {rental.vehicle.image_url && (
                        <img
                          src={rental.vehicle.image_url}
                          alt={rental.vehicle.name}
                          className="w-20 h-14 object-cover rounded"
                        />
                      )}
                      <div>
                        <p className="font-semibold">{rental.vehicle.name}</p>
                        <p className="text-sm text-muted-foreground">{rental.vehicle.category}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-muted-foreground italic">No vehicle assigned</p>
                  )}
                </div>

                {/* Status Dropdown */}
                <div className="pt-4">
                  <Label className="text-muted-foreground mb-2">Status</Label>
                  <Select
                    value={editForm.status}
                    onValueChange={async (value) => {
                      setEditForm({ ...editForm, status: value });
                      try {
                        const { error } = await supabase
                          .from("bookings")
                          .update({ status: value })
                          .eq("id", id);

                        if (error) throw error;
                        toast.success("Status updated successfully");
                        await loadRentalDetails();
                      } catch (error: any) {
                        toast.error("Failed to update status: " + error.message);
                      }
                    }}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="confirmed">Confirmed</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </Card>

            {/* Add-Ons & Extras */}
            {rental.special_requests && (
              <Card className="p-6 border-accent/20 shadow-[0_0_15px_rgba(255,215,0,0.1)]">
                <h3 className="text-xl font-display font-semibold mb-4 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-accent" />
                  Add-Ons & Special Requests
                </h3>
                <div className="bg-accent/5 rounded-lg p-4 border border-accent/20">
                  <p className="text-sm whitespace-pre-wrap">{rental.special_requests}</p>
                </div>
              </Card>
            )}

            {/* Return Inspection (Only for Completed Rentals) */}
            {rental.status === "completed" && (
              <Card className="p-6 border-green-500/20 shadow-[0_0_15px_rgba(34,197,94,0.1)]">
                <h3 className="text-xl font-display font-semibold mb-4 flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-400" />
                  Return Inspection
                </h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <Label className="text-muted-foreground">Vehicle Condition</Label>
                      <Badge className="mt-1 bg-green-500/20 text-green-300 border-green-500/30">
                        Excellent
                      </Badge>
                    </div>
                    <div>
                      <Label className="text-muted-foreground flex items-center gap-2">
                        <Fuel className="w-4 h-4" />
                        Fuel Level
                      </Label>
                      <p className="font-medium mt-1">Full</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Odometer</Label>
                      <p className="font-medium mt-1">12,450 miles</p>
                    </div>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Inspection Photos</Label>
                    <div className="mt-2 grid grid-cols-4 gap-2">
                      {[1, 2, 3, 4].map((i) => (
                        <div 
                          key={i}
                          className="aspect-square bg-accent/5 rounded border border-accent/20 flex items-center justify-center cursor-pointer hover:border-accent/40 transition-colors"
                        >
                          <Eye className="w-6 h-6 text-muted-foreground" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            )}
          </div>

          {/* Right Column - 1/3 width */}
          <div className="space-y-6">
            {/* Price Breakdown */}
            <Card className="p-6 border-accent/20 shadow-[0_0_15px_rgba(255,215,0,0.1)]">
              <h3 className="text-xl font-display font-semibold mb-4 flex items-center gap-2">
                <Receipt className="w-5 h-5 text-accent" />
                Price Breakdown
              </h3>
              <div className="space-y-3">
                {/* Rental Rates Section */}
                <div className="pb-3 border-b border-accent/10 space-y-2">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Rental Rates</p>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Daily Rate</span>
                    <span className="font-medium">${rental.daily_rate?.toFixed(2) || "0.00"}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Weekly Rate</span>
                    <span className="font-medium">${rental.weekly_rate?.toFixed(2) || "0.00"}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Monthly Rate</span>
                    <span className="font-medium">${rental.monthly_rate?.toFixed(2) || "0.00"}</span>
                  </div>
                </div>

                {/* Calculation Section */}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Base Rental Cost</span>
                    <span className="font-medium">${rental.daily_rate?.toFixed(2) || "0.00"}</span>
                  </div>
                  {rental.rental_days && rental.rental_days > 1 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">× {rental.rental_days} days</span>
                      <span className="font-medium">
                        ${((rental.daily_rate || 0) * rental.rental_days).toFixed(2)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Add-ons</span>
                    <span className="font-medium">$0.00</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Taxes & Fees</span>
                    <span className="font-medium">$0.00</span>
                  </div>
                  <div className="flex justify-between text-sm text-green-400">
                    <span>Discounts / Promo</span>
                    <span>-$0.00</span>
                  </div>
                </div>

                <div className="pt-3 border-t border-accent/20">
                  <div className="flex justify-between items-center">
                    <span className="font-display font-semibold">Total Price</span>
                    <span className="text-2xl font-bold text-accent">
                      ${rental.total_price.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </Card>

            {/* Verification Documents */}
            <Card className="p-6 border-accent/20 shadow-[0_0_15px_rgba(255,215,0,0.1)]">
              <h3 className="text-xl font-display font-semibold mb-4 flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-accent" />
                Documents
              </h3>
              <div className="space-y-3">
                <div className="p-3 bg-accent/5 rounded-lg border border-accent/20 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Shield className="w-5 h-5 text-accent" />
                    <div>
                      <p className="text-sm font-medium">Driver's License</p>
                      <p className="text-xs text-muted-foreground">
                        {rental.license_number ? "Uploaded" : "Pending"}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="gap-1">
                      <Eye className="w-3 h-3" />
                      View
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1">
                      <Upload className="w-3 h-3" />
                    </Button>
                  </div>
                </div>

                <div className="p-3 bg-accent/5 rounded-lg border border-accent/20 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-accent" />
                    <div>
                      <p className="text-sm font-medium">Proof of Insurance</p>
                      <p className="text-xs text-muted-foreground">Optional</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="gap-1">
                      <Upload className="w-3 h-3" />
                    </Button>
                  </div>
                </div>

                <div className="p-3 bg-accent/5 rounded-lg border border-accent/20 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Receipt className="w-5 h-5 text-accent" />
                    <div>
                      <p className="text-sm font-medium">Payment Receipt</p>
                      <p className="text-xs text-muted-foreground">Nov 1, 2025</p>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="gap-1">
                    <Eye className="w-3 h-3" />
                    View
                  </Button>
                </div>
              </div>
            </Card>

            {/* Internal Notes */}
            <Card className="p-6 border-accent/20 shadow-[0_0_15px_rgba(255,215,0,0.1)]">
              <h3 className="text-xl font-display font-semibold mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-accent" />
                Internal Notes
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                Admin-only comments (hidden from customer)
              </p>
              <Textarea
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder="Add internal notes about this rental..."
                className="min-h-[120px] resize-none"
              />
              <Button 
                onClick={saveNotes} 
                className="w-full mt-3"
                size="sm"
              >
                Save Notes
              </Button>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
