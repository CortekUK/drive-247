import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TimePicker } from "@/components/ui/time-picker";
import { useToast } from "@/hooks/use-toast";
import { Lock, Loader2, CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const enquirySchema = z.object({
  fullName: z.string()
    .min(1, "Full name is required")
    .refine((val) => val.trim().length > 0, "Full name cannot be empty")
    .transform((val) => val.trim())
    .refine((val) => val.length >= 2, "Full name must be at least 2 characters")
    .refine((val) => /^[a-zA-Z\s\-']+$/.test(val), "Name must contain only letters, spaces, hyphens, and apostrophes")
    .refine((val) => /[a-zA-Z]{2,}/.test(val), "Name must contain at least 2 alphabetic characters")
    .refine((val) => val.replace(/[\s\-']/g, '').length >= 2, "Name must have actual alphabetic content"),
  email: z.string()
    .trim()
    .min(1, "Email is required")
    .email("Invalid email address")
    .max(255),
  phone: z.string()
    .trim()
    .min(1, "Phone number is required")
    .refine((val) => {
      const cleaned = val.replace(/[\s\-()]/g, '');
      const digitCount = (cleaned.match(/\d/g) || []).length;
      // Valid international phone: 7-15 digits
      return digitCount >= 7 && digitCount <= 15;
    }, "Please enter a valid phone number (7-15 digits)"),
  serviceType: z.enum(["Event", "Travel", "Residential", "Ongoing"], {
    required_error: "Please select a service type",
  }),
  date: z.string().min(1, "Date is required"),
  startTime: z.string().min(1, "Start time is required"),
  durationHours: z.number({
    required_error: "Duration is required",
    invalid_type_error: "Please enter a valid number for duration",
  }).min(1, "Duration must be at least 1 hour").max(24, "Duration cannot exceed 24 hours"),
  primaryLocation: z.string().trim().min(5, "Primary location is required").max(500),
  secondaryLocation: z.string().trim().max(500).optional(),
  agentsRequired: z.number({
    invalid_type_error: "Please enter a valid number",
  }).min(1).max(10).optional(),
  riskLevel: z.enum(["Low", "Medium", "High"], {
    required_error: "Please select a risk level",
  }),
  notes: z.string().trim().max(1000).optional(),
});

type EnquiryFormData = z.infer<typeof enquirySchema>;

const CloseProtectionEnquiryForm = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [referenceNumber, setReferenceNumber] = useState("");
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
    reset,
  } = useForm<EnquiryFormData>({
    resolver: zodResolver(enquirySchema),
    mode: 'onChange', // Validate on change
    reValidateMode: 'onChange', // Re-validate on change
  });

  // Reset submitted state when form has validation errors
  const onError = () => {
    setSubmitted(false);
  };

  const onSubmit = async (data: EnquiryFormData) => {
    setIsSubmitting(true);
    setSubmitted(false); // Reset submitted state before attempting new submission
    try {
      const priority = data.riskLevel === "High" ? "high" : "normal";
      
      const { data: booking, error } = await supabase
        .from("bookings")
        .insert({
          customer_name: data.fullName,
          customer_email: data.email,
          customer_phone: data.phone,
          pickup_location: data.primaryLocation,
          dropoff_location: data.secondaryLocation || "N/A",
          pickup_date: data.date,
          pickup_time: data.startTime,
          passengers: data.agentsRequired || 1,
          luggage: 0,
          service_type: "close_protection",
          protection_details: {
            service_type: data.serviceType,
            date: data.date,
            start_time: data.startTime,
            duration_hours: data.durationHours,
            primary_location: data.primaryLocation,
            secondary_location: data.secondaryLocation,
            agents_required: data.agentsRequired,
            risk_level: data.riskLevel,
            additional_notes: data.notes,
          },
          source: "close_protection_form",
          status: "new",
          internal_notes: `CLOSE PROTECTION ENQUIRY - Risk Level: ${data.riskLevel}`,
        })
        .select()
        .single();

      if (error) throw error;

      // Send confirmation email to admin using dedicated CP enquiry function
      try {
        await supabase.functions.invoke('send-cp-enquiry', {
          body: {
            adminEmail: 'ilyasghulam32@gmail.com',
            customerName: data.fullName,
            customerEmail: data.email,
            customerPhone: data.phone,
            enquiryDetails: {
              serviceType: data.serviceType,
              date: data.date,
              startTime: data.startTime,
              durationHours: data.durationHours,
              primaryLocation: data.primaryLocation,
              secondaryLocation: data.secondaryLocation || '',
              agentsRequired: data.agentsRequired,
              riskLevel: data.riskLevel,
              notes: data.notes || ''
            },
            supportEmail: 'ilyasghulam32@gmail.com'
          }
        });
      } catch (emailError) {
        console.error('Error sending email:', emailError);
        // Don't fail the submission if email fails
      }

      // Generate a random reference number for tracking
      const refNumber = `CP${Date.now().toString().slice(-8)}`;
      setReferenceNumber(refNumber);
      setSubmitted(true);
      reset();

      toast({
        title: "Enquiry Submitted",
        description: `Your confidential enquiry has been received. Reference: ${refNumber}`,
      });
    } catch (error) {
      console.error("Error submitting enquiry:", error);
      toast({
        title: "Submission Failed",
        description: "Please try again or contact us directly.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="text-center space-y-4 p-8 bg-card/50 backdrop-blur rounded-lg border border-primary/20">
        <div className="w-16 h-16 mx-auto rounded-full gradient-metal flex items-center justify-center">
          <Lock className="w-8 h-8 text-background" />
        </div>
        <h3 className="text-2xl font-display font-bold text-gradient-metal">
          Enquiry Received
        </h3>
        <p className="text-muted-foreground">
          Thank you for your confidential enquiry. Our team will contact you within 24 hours.
        </p>
        <p className="text-sm text-primary">
          Reference Number: <span className="font-mono font-bold">{referenceNumber}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit(onSubmit, onError)} className="space-y-6">
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full Name *</Label>
            <Input
              id="fullName"
              {...register("fullName")}
              placeholder="John Smith"
              className="bg-background/50"
              onChange={(e) => {
                // Allow only letters, spaces, hyphens, and apostrophes
                e.target.value = e.target.value.replace(/[^a-zA-Z\s\-']/g, '');
                register("fullName").onChange(e);
              }}
            />
            {errors.fullName && (
              <p className="text-sm text-destructive">{errors.fullName.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="email"
              {...register("email")}
              placeholder="john@example.com"
              className="bg-background/50"
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="phone">Phone Number *</Label>
            <Input
              id="phone"
              type="tel"
              {...register("phone")}
              placeholder="Enter phone number"
              className="bg-background/50"
              onChange={(e) => {
                // Allow only numbers, spaces, +, -, (, )
                e.target.value = e.target.value.replace(/[^\d\s+\-()]/g, '');
                register("phone").onChange(e);
              }}
            />
            {errors.phone && (
              <p className="text-sm text-destructive">{errors.phone.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="serviceType">Service Required *</Label>
            <Controller
              name="serviceType"
              control={control}
              render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger className="bg-background/50">
                    <SelectValue placeholder="Select service type" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-primary/20">
                    <SelectItem value="Event">Event Protection</SelectItem>
                    <SelectItem value="Travel">Travel Security</SelectItem>
                    <SelectItem value="Residential">Residential Protection</SelectItem>
                    <SelectItem value="Ongoing">Ongoing Security Detail</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            {errors.serviceType && (
              <p className="text-sm text-destructive">{errors.serviceType.message}</p>
            )}
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <Label htmlFor="date">Date *</Label>
            <Controller
              name="date"
              control={control}
              render={({ field }) => (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal bg-background/50",
                        !field.value && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {field.value ? (
                        format(new Date(field.value), "PPP")
                      ) : (
                        <span>Pick a date</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={field.value ? new Date(field.value) : undefined}
                      onSelect={(date) => {
                        if (date) {
                          field.onChange(format(date, "yyyy-MM-dd"));
                        }
                      }}
                      disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                      initialFocus
                      classNames={{
                        day_selected: "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
                      }}
                    />
                  </PopoverContent>
                </Popover>
              )}
            />
            {errors.date && (
              <p className="text-sm text-destructive">{errors.date.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="startTime">Start Time *</Label>
            <Controller
              name="startTime"
              control={control}
              render={({ field }) => (
                <TimePicker
                  id="startTime"
                  value={field.value}
                  onChange={field.onChange}
                  className="bg-background/50"
                />
              )}
            />
            {errors.startTime && (
              <p className="text-sm text-destructive">{errors.startTime.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="durationHours">Duration (Hours) *</Label>
            <Input
              id="durationHours"
              type="number"
              min="1"
              max="24"
              {...register("durationHours", { valueAsNumber: true })}
              placeholder="8"
              className="bg-background/50"
            />
            {errors.durationHours && (
              <p className="text-sm text-destructive">{errors.durationHours.message}</p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="primaryLocation">Pickup / Primary Location *</Label>
          <Textarea
            id="primaryLocation"
            {...register("primaryLocation")}
            placeholder="Enter primary location or pickup address..."
            className="bg-background/50 min-h-[80px]"
          />
          {errors.primaryLocation && (
            <p className="text-sm text-destructive">{errors.primaryLocation.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="secondaryLocation">Destination / Area (Optional)</Label>
          <Textarea
            id="secondaryLocation"
            {...register("secondaryLocation")}
            placeholder="Enter destination or coverage area if applicable..."
            className="bg-background/50 min-h-[80px]"
          />
          {errors.secondaryLocation && (
            <p className="text-sm text-destructive">{errors.secondaryLocation.message}</p>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="agentsRequired">Number of Agents Required (Optional)</Label>
            <Input
              id="agentsRequired"
              type="number"
              min="1"
              max="10"
              {...register("agentsRequired", { valueAsNumber: true })}
              placeholder="1"
              className="bg-background/50"
            />
            {errors.agentsRequired && (
              <p className="text-sm text-destructive">{errors.agentsRequired.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="riskLevel">Risk / Priority Level *</Label>
            <Controller
              name="riskLevel"
              control={control}
              render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger className="bg-background/50">
                    <SelectValue placeholder="Select risk level" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-primary/20">
                    <SelectItem value="Low">Low</SelectItem>
                    <SelectItem value="Medium">Medium</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            {errors.riskLevel && (
              <p className="text-sm text-destructive">{errors.riskLevel.message}</p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">Additional Notes</Label>
          <Textarea
            id="notes"
            {...register("notes")}
            placeholder="Please provide any specific requirements, concerns, or additional details..."
            className="bg-background/50 min-h-[120px]"
          />
          {errors.notes && (
            <p className="text-sm text-destructive">{errors.notes.message}</p>
          )}
        </div>

        <div className="flex items-start gap-3 p-4 bg-primary/5 border border-primary/20 rounded-lg">
          <Lock className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
          <p className="text-sm text-muted-foreground">
            All enquiries are handled with strict discretion. NDAs available upon request.
            Your information is encrypted and only accessible to our security team.
          </p>
        </div>

        <Button
          type="submit"
          disabled={isSubmitting}
          className="w-full gradient-accent shadow-glow text-lg py-6"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Submitting Securely...
            </>
          ) : (
            "Request Confidential Consultation"
          )}
        </Button>
      </form>
    </div>
  );
};

export default CloseProtectionEnquiryForm;
