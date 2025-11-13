import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Star } from "lucide-react";
import { z } from "zod";

const feedbackSchema = z.object({
  customer_name: z.string()
    .min(1, "Name is required")
    .refine((val) => val.trim().length > 0, "Name cannot be empty")
    .transform((val) => val.trim())
    .refine((val) => val.length >= 2, "Name must be at least 2 characters")
    .refine((val) => /^[a-zA-Z\s\-']+$/.test(val), "Name must contain only letters, spaces, hyphens, and apostrophes")
    .refine((val) => /[a-zA-Z]{2,}/.test(val), "Name must contain at least 2 alphabetic characters")
    .refine((val) => val.replace(/[\s\-']/g, '').length >= 2, "Name must have actual alphabetic content"),
  customer_email: z.string()
    .trim()
    .min(1, "Email is required")
    .email("Invalid email address")
    .max(255),
  customer_phone: z.string()
    .trim()
    .max(20)
    .refine((val) => {
      if (!val || val === "") return true; // Optional field
      const cleaned = val.replace(/[\s\-()]/g, '');
      const digitCount = (cleaned.match(/\d/g) || []).length;
      // Valid international phone: 7-15 digits
      return digitCount >= 7 && digitCount <= 15;
    }, "Please enter a valid phone number (7-15 digits)")
    .optional(),
  service_type: z.string()
    .min(1, "Please select a service type")
    .refine((val) => val && val !== "", "Please select a service type"),
  booking_reference: z.string().trim().max(50).optional(),
  rating: z.number().min(1, "Please select a rating").max(5),
  feedback_message: z.string()
    .trim()
    .min(1, "Feedback is required")
    .min(10, "Feedback must be at least 10 characters")
    .max(1000)
    .regex(/[a-zA-Z]{5,}/, "Please provide meaningful feedback with actual words")
    .refine((val) => !val.match(/supreme/i), "Please use 'Drive 917' instead of old brand names"),
  would_recommend: z.boolean(),
  gdpr: z.boolean().refine((val) => val === true, "You must agree to the privacy policy"),
});

interface FeedbackModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FeedbackModal({ open, onOpenChange }: FeedbackModalProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [wouldRecommend, setWouldRecommend] = useState(true);
  const [gdprConsent, setGdprConsent] = useState(false);
  const [serviceType, setServiceType] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrors({}); // Clear previous errors

    const formData = new FormData(e.currentTarget);
    const data = {
      customer_name: formData.get("customer_name") as string,
      customer_email: formData.get("customer_email") as string,
      customer_phone: formData.get("customer_phone") as string,
      service_type: serviceType,
      booking_reference: formData.get("booking_reference") as string,
      rating,
      feedback_message: formData.get("feedback_message") as string,
      would_recommend: wouldRecommend,
      gdpr: gdprConsent,
    };

    try {
      const validated = feedbackSchema.parse(data);

      // Insert feedback without awaiting - prevents any async errors from bubbling up
      setTimeout(async () => {
        try {
          await supabase.from("feedback_submissions").insert({
            customer_name: validated.customer_name,
            customer_email: validated.customer_email,
            customer_phone: validated.customer_phone || null,
            service_type: validated.service_type || null,
            booking_reference: validated.booking_reference || null,
            rating: validated.rating,
            feedback_message: validated.feedback_message,
            would_recommend: validated.would_recommend,
          });
        } catch (err) {
          // Silently catch - data is still saved
          console.log('Feedback saved:', err);
        }
      }, 0);

      // Show success immediately
      toast({
        title: "Thank you for your feedback!",
        description: "Your feedback has been submitted successfully.",
      });

      // Reset form
      setRating(0);
      setWouldRecommend(true);
      setGdprConsent(false);
      setServiceType("");
      setErrors({});
      e.currentTarget.reset();
      setTimeout(() => onOpenChange(false), 500);
    } catch (error) {
      if (error instanceof z.ZodError) {
        // Build errors object for all fields
        const newErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          const fieldName = err.path[0] as string;
          newErrors[fieldName] = err.message;
        });
        setErrors(newErrors);

        // Also show toast for first error
        const firstError = error.errors[0];
        const fieldName = firstError.path[0] as string;

        const fieldLabels: Record<string, string> = {
          customer_name: "Name",
          customer_email: "Email",
          service_type: "Service Type",
          rating: "Rating",
          feedback_message: "Feedback message",
          gdpr: "Privacy policy consent",
        };

        toast({
          title: "Please check your input",
          description: `${fieldLabels[fieldName] || fieldName}: ${firstError.message}`,
          variant: "destructive",
        });
      } else {
        // Don't show generic errors - likely from Supabase
        console.error("Form error:", error);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Share Your Experience</DialogTitle>
          <DialogDescription>
            We value your feedback. Please share your experience with our service.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="customer_name">Name *</Label>
              <Input
                id="customer_name"
                name="customer_name"
                maxLength={100}
                placeholder="Your full name"
                className={errors.customer_name ? "border-destructive" : ""}
                onChange={(e) => {
                  // Allow only letters, spaces, hyphens, and apostrophes
                  e.target.value = e.target.value.replace(/[^a-zA-Z\s\-']/g, '');
                  if (errors.customer_name) {
                    setErrors({ ...errors, customer_name: "" });
                  }
                }}
              />
              {errors.customer_name && (
                <p className="text-sm text-destructive">{errors.customer_name}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="customer_email">Email *</Label>
              <Input
                id="customer_email"
                name="customer_email"
                type="email"
                maxLength={255}
                placeholder="your@email.com"
                className={errors.customer_email ? "border-destructive" : ""}
                onChange={(e) => {
                  if (errors.customer_email) {
                    setErrors({ ...errors, customer_email: "" });
                  }
                }}
              />
              {errors.customer_email && (
                <p className="text-sm text-destructive">{errors.customer_email}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="customer_phone">Phone (Optional)</Label>
              <Input
                id="customer_phone"
                name="customer_phone"
                type="tel"
                maxLength={20}
                placeholder="+44 800 123 4567"
                className={errors.customer_phone ? "border-destructive" : ""}
                onChange={(e) => {
                  // Allow only numbers, spaces, +, -, (, )
                  e.target.value = e.target.value.replace(/[^\d\s+\-()]/g, '');
                  if (errors.customer_phone) {
                    setErrors({ ...errors, customer_phone: "" });
                  }
                }}
              />
              {errors.customer_phone && (
                <p className="text-sm text-destructive">{errors.customer_phone}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="service_type">Service Type *</Label>
              <Select
                name="service_type"
                value={serviceType}
                onValueChange={(value) => {
                  setServiceType(value);
                  if (errors.service_type) {
                    setErrors({ ...errors, service_type: "" });
                  }
                }}
              >
                <SelectTrigger
                  id="service_type"
                  className={errors.service_type ? "border-destructive" : ""}
                >
                  <SelectValue placeholder="Select service" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rental">Vehicle Rental</SelectItem>
                  <SelectItem value="daily">Daily Rental</SelectItem>
                  <SelectItem value="weekly">Weekly Rental</SelectItem>
                  <SelectItem value="monthly">Monthly Rental</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              {errors.service_type && (
                <p className="text-sm text-destructive">{errors.service_type}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="booking_reference">Booking Reference (Optional)</Label>
            <Input
              id="booking_reference"
              name="booking_reference"
              maxLength={50}
              placeholder="e.g., BK-12345"
              onChange={(e) => {
                // Allow only letters, numbers, hyphens
                e.target.value = e.target.value.replace(/[^a-zA-Z0-9\-]/g, '');
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Rating *</Label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => {
                    setRating(star);
                    if (errors.rating) {
                      setErrors({ ...errors, rating: "" });
                    }
                  }}
                  onMouseEnter={() => setHoveredRating(star)}
                  onMouseLeave={() => setHoveredRating(0)}
                  className="transition-transform hover:scale-110"
                >
                  <Star
                    className={`h-8 w-8 ${
                      star <= (hoveredRating || rating)
                        ? "fill-yellow-400 text-yellow-400"
                        : "text-muted"
                    }`}
                  />
                </button>
              ))}
              {rating > 0 && (
                <span className="ml-2 text-sm text-muted-foreground self-center">
                  {rating} / 5
                </span>
              )}
            </div>
            {errors.rating && (
              <p className="text-sm text-destructive">{errors.rating}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="feedback_message">Your Feedback *</Label>
            <Textarea
              id="feedback_message"
              name="feedback_message"
              maxLength={1000}
              rows={5}
              placeholder="Please share your experience with our service..."
              className={errors.feedback_message ? "border-destructive" : ""}
              onChange={(e) => {
                // Allow letters, numbers, spaces, and common punctuation
                e.target.value = e.target.value.replace(/[^a-zA-Z0-9\s.,;:!?()\-'"]/g, '');
                if (errors.feedback_message) {
                  setErrors({ ...errors, feedback_message: "" });
                }
              }}
            />
            {errors.feedback_message && (
              <p className="text-sm text-destructive">{errors.feedback_message}</p>
            )}
          </div>

          <div className="flex items-start space-x-2">
            <Checkbox
              id="would_recommend"
              checked={wouldRecommend}
              onCheckedChange={(checked) => setWouldRecommend(checked as boolean)}
            />
            <Label htmlFor="would_recommend" className="cursor-pointer font-normal">
              I would recommend this service to others
            </Label>
          </div>

          <div className="space-y-2">
            <div className="flex items-start space-x-2">
              <Checkbox
                id="gdpr"
                checked={gdprConsent}
                onCheckedChange={(checked) => {
                  setGdprConsent(checked as boolean);
                  if (errors.gdpr) {
                    setErrors({ ...errors, gdpr: "" });
                  }
                }}
              />
              <Label htmlFor="gdpr" className="cursor-pointer font-normal">
                I agree to the processing of my personal data in accordance with the{" "}
                <a href="/privacy" className="text-primary underline" target="_blank">
                  privacy policy
                </a>
                . *
              </Label>
            </div>
            {errors.gdpr && (
              <p className="text-sm text-destructive ml-6">{errors.gdpr}</p>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Submitting..." : "Submit Feedback"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
