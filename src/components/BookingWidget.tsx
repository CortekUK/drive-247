import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { TimePicker } from "@/components/ui/time-picker";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Car } from "lucide-react";
import BookingConfirmation from "./BookingConfirmation";

interface Vehicle {
  id: string;
  name: string;
  category: string;
  description: string;
  capacity: number;
  luggage_capacity: number;
  base_price_per_mile: number;
  overnight_surcharge: number;
  image_url: string | null;
}

const BookingWidget = () => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [estimatedMiles, setEstimatedMiles] = useState(50);
  const [isLongDrive, setIsLongDrive] = useState(false);
  const [hasOvernightStop, setHasOvernightStop] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState<any>(null);

  const [formData, setFormData] = useState({
    pickupLocation: "",
    dropoffLocation: "",
    pickupDate: "",
    pickupTime: "",
    passengers: "1",
    luggage: "1",
    additionalRequirements: "",
    customerName: "",
    customerEmail: "",
    customerPhone: "",
  });

  useEffect(() => {
    loadVehicles();
  }, []);

  const loadVehicles = async () => {
    const { data, error } = await supabase
      .from("vehicles")
      .select("*")
      .eq("status", "Available")
      .order("reg");

    if (error) {
      toast.error("Failed to load vehicles");
      return;
    }

    setVehicles(data || []);
  };

  const calculatePrice = () => {
    if (!selectedVehicle) return "0.00";
    
    let total = selectedVehicle.base_price_per_mile * estimatedMiles;
    
    if (hasOvernightStop) {
      total += selectedVehicle.overnight_surcharge;
    }
    
    return total.toFixed(2);
  };

  const calculatePriceNumber = () => {
    if (!selectedVehicle) return 0;
    
    let total = selectedVehicle.base_price_per_mile * estimatedMiles;
    
    if (hasOvernightStop) {
      total += selectedVehicle.overnight_surcharge;
    }
    
    return total;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedVehicle) {
      toast.error("Please select a vehicle");
      return;
    }

    setLoading(true);

    const { error } = await supabase.from("bookings").insert({
      vehicle_id: selectedVehicle.id,
      pickup_location: formData.pickupLocation,
      dropoff_location: formData.dropoffLocation,
      pickup_date: formData.pickupDate,
      pickup_time: formData.pickupTime,
      passengers: parseInt(formData.passengers),
      luggage: parseInt(formData.luggage),
      additional_requirements: formData.additionalRequirements,
      is_long_drive: isLongDrive,
      has_overnight_stop: hasOvernightStop,
      estimated_miles: estimatedMiles,
      total_price: calculatePriceNumber(),
      customer_name: formData.customerName,
      customer_email: formData.customerEmail,
      customer_phone: formData.customerPhone,
      status: "new",
    });

    setLoading(false);

    if (error) {
      toast.error("Failed to submit booking");
      return;
    }

    // Show confirmation
    setConfirmedBooking({
      pickupLocation: formData.pickupLocation,
      dropoffLocation: formData.dropoffLocation,
      pickupDate: formData.pickupDate,
      pickupTime: formData.pickupTime,
      vehicleName: selectedVehicle.name,
      totalPrice: calculatePrice(),
      customerName: formData.customerName,
      customerEmail: formData.customerEmail,
    });
    setShowConfirmation(true);
  };

  const handleCloseConfirmation = () => {
    setShowConfirmation(false);
    setConfirmedBooking(null);
    // Reset form
    setFormData({
      pickupLocation: "",
      dropoffLocation: "",
      pickupDate: "",
      pickupTime: "",
      passengers: "1",
      luggage: "1",
      additionalRequirements: "",
      customerName: "",
      customerEmail: "",
      customerPhone: "",
    });
    setSelectedVehicle(null);
    setIsLongDrive(false);
    setHasOvernightStop(false);
  };

  if (showConfirmation && confirmedBooking) {
    return <BookingConfirmation bookingDetails={confirmedBooking} onClose={handleCloseConfirmation} />;
  }

  return (
    <Card className="p-6 md:p-8 shadow-metal bg-card/50 backdrop-blur">
      <h3 className="text-2xl font-display font-bold mb-6 text-gradient-metal">Book Your Journey</h3>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="pickupLocation">Pickup Location</Label>
            <Input
              id="pickupLocation"
              value={formData.pickupLocation}
              onChange={(e) => setFormData({ ...formData, pickupLocation: e.target.value })}
              placeholder="Enter pickup address"
              required
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="dropoffLocation">Drop-off Location</Label>
            <Input
              id="dropoffLocation"
              value={formData.dropoffLocation}
              onChange={(e) => setFormData({ ...formData, dropoffLocation: e.target.value })}
              placeholder="Enter destination"
              required
            />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="pickupDate">Pickup Date</Label>
            <Input
              id="pickupDate"
              type="date"
              value={formData.pickupDate}
              onChange={(e) => setFormData({ ...formData, pickupDate: e.target.value })}
              min={new Date().toISOString().split('T')[0]}
              required
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="pickupTime">Pickup Time</Label>
            <TimePicker
              id="pickupTime"
              value={formData.pickupTime}
              onChange={(value) => setFormData({ ...formData, pickupTime: value })}
            />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="passengers">Passengers</Label>
            <Select value={formData.passengers} onValueChange={(value) => setFormData({ ...formData, passengers: value })}>
              <SelectTrigger id="passengers">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6, 7].map((num) => (
                  <SelectItem key={num} value={num.toString()}>
                    {num} {num === 1 ? "Passenger" : "Passengers"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="luggage">Luggage Items</Label>
            <Select value={formData.luggage} onValueChange={(value) => setFormData({ ...formData, luggage: value })}>
              <SelectTrigger id="luggage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6].map((num) => (
                  <SelectItem key={num} value={num.toString()}>
                    {num} {num === 1 ? "Item" : "Items"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="longDrive"
              checked={isLongDrive}
              onCheckedChange={(checked) => setIsLongDrive(checked as boolean)}
            />
            <Label htmlFor="longDrive" className="text-sm cursor-pointer">
              Long drive (over 100 miles)
            </Label>
          </div>
          
          <div className="flex items-center space-x-2">
            <Checkbox
              id="overnightStop"
              checked={hasOvernightStop}
              onCheckedChange={(checked) => setHasOvernightStop(checked as boolean)}
            />
            <Label htmlFor="overnightStop" className="text-sm cursor-pointer">
              Overnight stop required
            </Label>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="estimatedMiles">Estimated Miles</Label>
          <Input
            id="estimatedMiles"
            type="number"
            value={estimatedMiles}
            onChange={(e) => {
              const value = parseInt(e.target.value);
              setEstimatedMiles(isNaN(value) ? 50 : value);
            }}
            min="1"
          />
        </div>

        <div className="space-y-4">
          <Label className="text-lg font-semibold">Select Vehicle</Label>
          <div className="grid md:grid-cols-2 gap-4">
            {vehicles.map((vehicle) => (
              <Card
                key={vehicle.id}
                className={`p-4 cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-[1.02] ${
                  selectedVehicle?.id === vehicle.id 
                    ? 'border-accent bg-accent/10 shadow-md' 
                    : 'border-border hover:border-accent/50'
                }`}
                onClick={() => setSelectedVehicle(vehicle)}
              >
                <div className="space-y-3">
                  {/* Vehicle Image */}
                  <div className="relative h-32 rounded-lg overflow-hidden bg-muted/50">
                    {vehicle.image_url ? (
                      <img 
                        src={vehicle.image_url} 
                        alt={vehicle.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          e.currentTarget.nextElementSibling?.classList.remove('hidden');
                        }}
                      />
                    ) : null}
                    <div className={`${vehicle.image_url ? 'hidden' : 'flex'} absolute inset-0 flex-col items-center justify-center bg-muted/30 backdrop-blur-sm`}>
                      <Car className="w-12 h-12 text-accent/40 mb-1" />
                      <span className="text-xs text-muted-foreground/60">Image coming soon</span>
                    </div>
                  </div>

                  {/* Vehicle Details */}
                  <div>
                    <h4 className="font-semibold text-base">{vehicle.name}</h4>
                    <p className="text-xs text-muted-foreground">{vehicle.category}</p>
                  </div>

                  {/* Pricing */}
                  <div className="flex items-center justify-between text-sm pt-2 border-t border-border/50">
                    <span className="text-muted-foreground">
                      {vehicle.capacity} passengers
                    </span>
                    <span className="font-semibold text-accent">
                      ${vehicle.base_price_per_mile.toFixed(2)}/mile
                    </span>
                  </div>

                  {/* Selected Indicator */}
                  {selectedVehicle?.id === vehicle.id && (
                    <div className="flex items-center gap-2 text-accent font-medium text-xs">
                      ✓ Selected
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>

        {selectedVehicle && (
          <Card className="p-4 bg-secondary/30">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                {selectedVehicle.image_url && (
                  <img 
                    src={selectedVehicle.image_url} 
                    alt={selectedVehicle.name}
                    className="w-16 h-16 object-cover rounded-lg"
                  />
                )}
                <div className="flex-1">
                  <h4 className="font-semibold">{selectedVehicle.name}</h4>
                  <p className="text-sm text-muted-foreground">{selectedVehicle.description}</p>
                </div>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-border">
                <span className="text-sm">Estimated Price:</span>
                <span className="text-2xl font-display font-bold text-accent">
                  ${calculatePrice()}
                </span>
              </div>
            </div>
          </Card>
        )}

        <div className="space-y-2">
          <Label htmlFor="additionalRequirements">Additional Requirements</Label>
          <Textarea
            id="additionalRequirements"
            value={formData.additionalRequirements}
            onChange={(e) => setFormData({ ...formData, additionalRequirements: e.target.value })}
            placeholder="Any special requests or requirements?"
            rows={3}
          />
        </div>

        <div className="space-y-4 border-t border-border pt-4">
          <h4 className="font-semibold">Your Details</h4>
          
          <div className="space-y-2">
            <Label htmlFor="customerName">Full Name</Label>
            <Input
              id="customerName"
              value={formData.customerName}
              onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
              required
            />
          </div>
          
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="customerEmail">Email</Label>
              <Input
                id="customerEmail"
                type="email"
                value={formData.customerEmail}
                onChange={(e) => setFormData({ ...formData, customerEmail: e.target.value })}
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="customerPhone">Phone Number</Label>
              <Input
                id="customerPhone"
                type="tel"
                value={formData.customerPhone}
                onChange={(e) => setFormData({ ...formData, customerPhone: e.target.value })}
                required
              />
            </div>
          </div>
        </div>

        <Button
          type="submit"
          size="lg"
          className="w-full gradient-accent shadow-glow"
          disabled={loading}
        >
          {loading ? "Submitting..." : "Submit Booking Request"}
        </Button>
      </form>
    </Card>
  );
};

export default BookingWidget;
