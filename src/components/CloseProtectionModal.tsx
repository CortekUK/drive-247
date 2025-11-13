import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CloseProtectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  bookingDetails?: string;
  fullBookingData?: {
    pickupLocation?: string;
    dropoffLocation?: string;
    pickupDate?: string;
    pickupTime?: string;
    vehicleName?: string;
    passengers?: string;
  };
  onSubmit?: (cpDetails: any) => void;
}

const CloseProtectionModal = ({
  open,
  onOpenChange,
  customerName = "",
  customerEmail = "",
  customerPhone = "",
  bookingDetails = "",
  fullBookingData,
  onSubmit
}: CloseProtectionModalProps) => {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{[key: string]: string}>({});
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    requirements: "",
    threatLevel: ""
  });

  // Initialize form when modal opens (only on first open)
  useEffect(() => {
    if (open) {
      setFormData({
        name: customerName,
        email: customerEmail,
        phone: customerPhone,
        requirements: "",
        threatLevel: ""
      });
      setErrors({});
    }
  }, [open]); // Remove customerName, customerEmail, customerPhone from dependencies

  // Validate individual field
  const validateField = (fieldName: string, value: string) => {
    let error = "";

    if (fieldName === "name") {
      const nameValue = value.trim();
      if (!nameValue) {
        error = "Please enter your full name";
      } else if (nameValue.length < 2) {
        error = "Name must be at least 2 characters";
      } else if (!/^[a-zA-Z\s\-']+$/.test(nameValue)) {
        error = "Name must contain only letters, spaces, hyphens, and apostrophes";
      } else if (!/[a-zA-Z]{2,}/.test(nameValue)) {
        error = "Name must contain at least 2 alphabetic characters";
      } else if (nameValue.replace(/[\s\-']/g, '').length < 2) {
        error = "Name must have actual alphabetic content";
      }
    } else if (fieldName === "email") {
      if (!value.trim()) {
        error = "Please enter your email address";
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        error = "Please enter a valid email address";
      }
    } else if (fieldName === "phone") {
      const phoneValue = value.trim();
      if (!phoneValue) {
        error = "Please enter your phone number";
      } else {
        const cleaned = phoneValue.replace(/[\s\-()]/g, '');
        const digitCount = (cleaned.match(/\d/g) || []).length;
        // Valid international phone: 7-15 digits, optional + at start
        if (digitCount < 7 || digitCount > 15) {
          error = "Please enter a valid phone number (7-15 digits)";
        } else if (cleaned.startsWith('+') && !/^\+\d+$/.test(cleaned)) {
          error = "Invalid phone number format";
        } else if (!cleaned.startsWith('+') && !/^\d+$/.test(cleaned.replace(/[\s\-()]/g, ''))) {
          error = "Phone number should contain only digits";
        }
      }
    } else if (fieldName === "threatLevel") {
      if (!value || value.trim() === "") {
        error = "Please select a threat assessment level";
      }
    }

    setErrors(prev => {
      if (error) {
        return { ...prev, [fieldName]: error };
      } else {
        const newErrors = { ...prev };
        delete newErrors[fieldName];
        return newErrors;
      }
    });
  };

  const handleSubmit = async () => {
    const newErrors: {[key: string]: string} = {};

    // Validate name
    const nameValue = formData.name.trim();
    if (!nameValue) {
      newErrors.name = "Please enter your full name";
    } else if (nameValue.length < 2) {
      newErrors.name = "Name must be at least 2 characters";
    } else if (!/^[a-zA-Z\s\-']+$/.test(nameValue)) {
      newErrors.name = "Name must contain only letters, spaces, hyphens, and apostrophes";
    } else if (!/[a-zA-Z]{2,}/.test(nameValue)) {
      newErrors.name = "Name must contain at least 2 alphabetic characters";
    } else if (nameValue.replace(/[\s\-']/g, '').length < 2) {
      newErrors.name = "Name must have actual alphabetic content";
    }

    // Validate email
    if (!formData.email.trim()) {
      newErrors.email = "Please enter your email address";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = "Please enter a valid email address";
    }

    // Validate phone (international format)
    const phoneValue = formData.phone.trim();
    if (!phoneValue) {
      newErrors.phone = "Please enter your phone number";
    } else {
      // Remove all spaces, hyphens, parentheses for validation
      const cleaned = phoneValue.replace(/[\s\-()]/g, '');
      // Count actual digits
      const digitCount = (cleaned.match(/\d/g) || []).length;
      // Valid international phone: 7-15 digits, optional + at start
      if (digitCount < 7 || digitCount > 15) {
        newErrors.phone = "Please enter a valid phone number (7-15 digits)";
      } else if (cleaned.startsWith('+') && !/^\+\d+$/.test(cleaned)) {
        newErrors.phone = "Invalid phone number format";
      } else if (!cleaned.startsWith('+') && !/^\d+$/.test(cleaned.replace(/[\s\-()]/g, ''))) {
        newErrors.phone = "Phone number should contain only digits";
      }
    }

    // Validate threat level (optional but show error if you want it required)
    if (!formData.threatLevel || formData.threatLevel.trim() === "") {
      newErrors.threatLevel = "Please select a threat assessment level";
    }

    // If there are errors, set them and return
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Clear errors if validation passes
    setErrors({});

    setLoading(true);
    try {
      const cpDetails = {
        interested: true,
        customer_name: formData.name,
        customer_email: formData.email,
        customer_phone: formData.phone,
        threat_level: formData.threatLevel || "Not Sure",
        requirements: formData.requirements,
        submitted_at: new Date().toISOString()
      };

      // Send email to admin about close protection request with booking
      const adminEmail = 'ilyasghulam32@gmail.com';

      const emailData = {
        adminEmail: adminEmail,
        customerName: formData.name,
        customerEmail: formData.email,
        customerPhone: formData.phone,
        enquiryDetails: {
          serviceType: 'Combined with Chauffeur Service',
          date: fullBookingData?.pickupDate || new Date().toLocaleDateString(),
          startTime: fullBookingData?.pickupTime || 'TBD',
          durationHours: 'TBD',
          primaryLocation: fullBookingData?.pickupLocation || 'N/A',
          secondaryLocation: fullBookingData?.dropoffLocation || '',
          agentsRequired: 'TBD',
          riskLevel: formData.threatLevel || 'Not Sure',
          notes: `
COMBINED WITH CHAUFFEUR BOOKING:
Vehicle: ${fullBookingData?.vehicleName || 'N/A'}
Passengers: ${fullBookingData?.passengers || 'N/A'}

SPECIFIC REQUIREMENTS:
${formData.requirements || 'None specified'}
          `.trim()
        },
        supportEmail: adminEmail
      };

      // Send email notification to admin using dedicated CP enquiry function
      await supabase.functions.invoke('send-cp-enquiry', {
        body: emailData
      });

      // Pass details to parent component to include in booking
      if (onSubmit) {
        onSubmit(cpDetails);
      }

      toast.success("Close protection interest recorded! Our team will contact you shortly.");
      onOpenChange(false);

      // Reset form
      setFormData({
        name: customerName,
        email: customerEmail,
        phone: customerPhone,
        requirements: "",
        threatLevel: ""
      });
    } catch (error) {
      toast.error("Failed to submit enquiry. Please try again.");
      console.error("CP Enquiry error:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-[#C5A572]" />
            <DialogTitle className="text-2xl">Close Protection Services</DialogTitle>
          </div>
          <DialogDescription className="text-base pt-2">
            Add discreet security for your journey. Our trained professionals provide executive protection tailored to your needs.
          </DialogDescription>
        </DialogHeader>

        <form name="closeProtectionForm" onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="cp-name">Name *</Label>
            <Input
              id="cp-name"
              name="cp-modal-name"
              autoComplete="off"
              value={formData.name}
              onChange={(e) => {
                // Allow only letters, spaces, hyphens, and apostrophes
                const sanitized = e.target.value.replace(/[^a-zA-Z\s\-']/g, '');
                setFormData({ ...formData, name: sanitized });
                validateField('name', sanitized);
              }}
              onBlur={() => validateField('name', formData.name)}
              placeholder="Your name"
              className={errors.name ? "border-destructive" : ""}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="cp-email">Email *</Label>
            <Input
              id="cp-email"
              name="cp-modal-email"
              type="email"
              autoComplete="off"
              value={formData.email}
              onChange={(e) => {
                const value = e.target.value;
                setFormData({ ...formData, email: value });
                validateField('email', value);
              }}
              onBlur={() => validateField('email', formData.email)}
              placeholder="your@email.com"
              className={errors.email ? "border-destructive" : ""}
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="cp-phone">Phone *</Label>
            <Input
              id="cp-phone"
              name="cp-modal-phone"
              type="tel"
              autoComplete="off"
              value={formData.phone}
              onChange={(e) => {
                // Allow only numbers, spaces, +, -, (, )
                const sanitized = e.target.value.replace(/[^\d\s+\-()]/g, '');
                setFormData({ ...formData, phone: sanitized });
                validateField('phone', sanitized);
              }}
              onBlur={() => validateField('phone', formData.phone)}
              placeholder="Enter phone number"
              className={errors.phone ? "border-destructive" : ""}
            />
            {errors.phone && (
              <p className="text-sm text-destructive">{errors.phone}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="cp-threat">Threat Assessment *</Label>
            <Select
              value={formData.threatLevel}
              onValueChange={(value) => {
                setFormData({ ...formData, threatLevel: value });
                validateField('threatLevel', value);
              }}
            >
              <SelectTrigger
                id="cp-threat"
                className={errors.threatLevel ? "border-destructive" : ""}
              >
                <SelectValue placeholder="Select threat level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Low">Low - General safety preference</SelectItem>
                <SelectItem value="Medium">Medium - Some specific concerns</SelectItem>
                <SelectItem value="High">High - Known security risks</SelectItem>
                <SelectItem value="Not Sure">Not Sure - Need assessment</SelectItem>
              </SelectContent>
            </Select>
            {errors.threatLevel && (
              <p className="text-sm text-destructive">{errors.threatLevel}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="cp-requirements">Specific Requirements</Label>
            <Textarea
              id="cp-requirements"
              value={formData.requirements}
              onChange={(e) => {
                setFormData({ ...formData, requirements: e.target.value });
                if (errors.requirements) {
                  setErrors({ ...errors, requirements: "" });
                }
              }}
              placeholder="Any specific security concerns or requirements..."
              rows={3}
              className={errors.requirements ? "border-destructive" : ""}
            />
            {errors.requirements && (
              <p className="text-sm text-destructive">{errors.requirements}</p>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1"
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="flex-1 gradient-accent"
            disabled={loading}
          >
            {loading ? "Submitting..." : "Submit Enquiry"}
          </Button>
        </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CloseProtectionModal;
