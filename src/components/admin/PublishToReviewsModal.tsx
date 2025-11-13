import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface Feedback {
  id: string;
  customer_name: string;
  customer_email: string;
  rating: number | null;
  feedback_message: string;
  vehicle_id?: string;
  rental_id?: string;
}

interface Vehicle {
  id: string;
  name: string;
  category: string;
}

interface PublishToReviewsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feedback: Feedback | null;
  onPublished: () => void;
}

const MIN_RATING_DEFAULT = 4;

export const PublishToReviewsModal = ({ open, onOpenChange, feedback, onPublished }: PublishToReviewsModalProps) => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [formData, setFormData] = useState({
    customer_name: "",
    anonymised: false,
    rating: 5,
    review_text: "",
    vehicle_id: "",
    rental_period_start: "",
    rental_period_end: "",
    is_active: false,
    is_featured: false,
  });
  const [warnings, setWarnings] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    if (open && feedback) {
      // Pre-fill form with feedback data
      setFormData({
        customer_name: feedback.customer_name,
        anonymised: false,
        rating: feedback.rating || 5,
        review_text: feedback.feedback_message,
        vehicle_id: feedback.vehicle_id || "",
        rental_period_start: "",
        rental_period_end: "",
        is_active: false, // Default to inactive for manual approval
        is_featured: false,
      });

      // Load vehicles
      loadVehicles();

      // Perform content safety checks
      performSafetyChecks(feedback);
    }
  }, [open, feedback]);

  const loadVehicles = async () => {
    const { data } = await supabase
      .from("vehicles")
      .select("id, name, category")
      .eq("is_active", true)
      .order("name");
    
    if (data) setVehicles(data);
  };

  const performSafetyChecks = (fb: Feedback) => {
    const newWarnings: string[]= [];

    // Brand mention check
    if (fb.feedback_message.toLowerCase().includes('supreme')) {
      newWarnings.push("⚠️ Old brand name detected ('Supreme'). Please replace with 'Drive 917' before publishing.");
    }

    // Rating threshold check
    if (fb.rating && fb.rating < MIN_RATING_DEFAULT) {
      newWarnings.push(`Rating is below recommended threshold (${MIN_RATING_DEFAULT}★). Consider if this should be published.`);
    }

    // Basic profanity check (simple keywords)
    const profanityKeywords = ["damn", "hell", "crap", "terrible", "awful", "worst", "horrible"];
    const lowerText = fb.feedback_message.toLowerCase();
    if (profanityKeywords.some(word => lowerText.includes(word))) {
      newWarnings.push("Potentially negative language detected. Please review before publishing.");
    }

    // PII check (basic email/phone pattern)
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
    const phonePattern = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/;
    if (emailPattern.test(fb.feedback_message) || phonePattern.test(fb.feedback_message)) {
      newWarnings.push("Possible personal information (email/phone) detected in review text.");
    }

    // Length check
    if (fb.feedback_message.trim().length < 30) {
      newWarnings.push("Review text is very short. Consider if it provides enough value.");
    }

    setWarnings(newWarnings);
  };

  const getAnonymizedName = (name: string): string => {
    const parts = name.trim().split(" ");
    if (parts.length > 1) {
      return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
    }
    return parts[0];
  };

  const checkForDuplicates = async (): Promise<boolean> => {
    // Check for similar reviews in the last 60 days
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const { data: existingReviews } = await supabase
      .from("testimonials")
      .select("customer_name, review_text")
      .eq("is_active", true)
      .gte("created_at", sixtyDaysAgo.toISOString());

    if (existingReviews) {
      const similarReview = existingReviews.find(review => 
        review.customer_name.toLowerCase() === formData.customer_name.toLowerCase() &&
        review.review_text.toLowerCase() === formData.review_text.toLowerCase()
      );

      if (similarReview) {
        return confirm("A similar active review from this customer already exists in the last 60 days. Publish anyway?");
      }
    }

    return true;
  };

  const handlePublish = async () => {
    if (!feedback) return;

    // Check for old brand mentions and offer auto-fix
    if (formData.review_text.toLowerCase().includes('supreme')) {
      const shouldAutoFix = confirm(
        "⚠️ Brand Mention Detected\n\n" +
        "Detected old brand name 'Supreme' in the review text.\n\n" +
        "Would you like to automatically replace it with 'Drive 917' before publishing?"
      );
      
      if (!shouldAutoFix) {
        toast.error("Please update the review text to use 'Drive 917' instead of old brand names");
        return;
      }
      
      // Auto-fix: replace Supreme mentions
      const cleanedText = formData.review_text
        .replace(/Supreme Drive Suite/gi, 'Drive 917')
        .replace(/Supreme Drive/gi, 'Drive 917')
        .replace(/Supreme/gi, 'Drive 917');
      
      setFormData({ ...formData, review_text: cleanedText });
      toast.success("Brand names automatically updated to 'Drive 917'");
      
      // Give user a moment to review the change
      setTimeout(() => {}, 1000);
      return; // Return so they can review and then click Publish again
    }

    // Check for duplicates
    const shouldContinue = await checkForDuplicates();
    if (!shouldContinue) return;

    setPublishing(true);

    try {
      const displayName = formData.anonymised 
        ? getAnonymizedName(formData.customer_name)
        : formData.customer_name;

      // Create testimonial
      const { data: testimonial, error: createError } = await supabase
        .from("testimonials")
        .insert({
          feedback_id: feedback.id,
          customer_name: displayName,
          anonymised: formData.anonymised,
          content: formData.review_text,
          review_text: formData.review_text,
          rating: formData.rating,
          vehicle_id: formData.vehicle_id || null,
          rental_period_start: formData.rental_period_start || null,
          rental_period_end: formData.rental_period_end || null,
          is_active: formData.is_active,
          is_featured: formData.is_featured,
        })
        .select()
        .single();

      if (createError) throw createError;

      // Update feedback status
      const { error: updateError } = await supabase
        .from("feedback_submissions")
        .update({
          status: "published",
          published_at: new Date().toISOString(),
        })
        .eq("id", feedback.id);

      if (updateError) throw updateError;

      toast.success(
        `Published to Customer Reviews ${formData.is_active ? "(Active)" : "(Inactive - requires approval)"}`,
        {
          description: "View it in Customer Reviews Management",
          action: {
            label: "View",
            onClick: () => window.location.href = "/admin/testimonials"
          }
        }
      );

      onPublished();
      onOpenChange(false);
    } catch (error) {
      console.error("Publish error:", error);
      toast.error("Failed to publish review");
    } finally {
      setPublishing(false);
    }
  };

  if (!feedback) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-display">Publish to Customer Reviews</DialogTitle>
          <DialogDescription>
            Review and customize before publishing this feedback as a public testimonial
          </DialogDescription>
        </DialogHeader>

        {warnings.length > 0 && (
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400 font-semibold">
              <AlertCircle className="w-5 h-5" />
              Content Safety Warnings
            </div>
            {warnings.map((warning, index) => (
              <p key={index} className="text-sm text-yellow-700 dark:text-yellow-300">
                • {warning}
              </p>
            ))}
          </div>
        )}

        <div className="space-y-6">
          {/* Customer Name */}
          <div className="space-y-2">
            <Label htmlFor="customer_name">
              Customer Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="customer_name"
              value={formData.customer_name}
              onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
              required
            />
            <div className="flex items-center gap-2">
              <Switch
                id="anonymised"
                checked={formData.anonymised}
                onCheckedChange={(checked) => setFormData({ ...formData, anonymised: checked })}
              />
              <Label htmlFor="anonymised" className="cursor-pointer text-sm">
                Anonymize (first name + initial)
              </Label>
              {formData.anonymised && (
                <Badge variant="outline" className="ml-2 text-xs">
                  Will show as: {getAnonymizedName(formData.customer_name)}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Toggle anonymization to show only first name and last initial publicly (e.g., "Sarah M.")
            </p>
          </div>

          {/* Rating */}
          <div className="space-y-2">
            <Label htmlFor="rating">Rating <span className="text-destructive">*</span></Label>
            <Select
              value={formData.rating.toString()}
              onValueChange={(value) => setFormData({ ...formData, rating: parseInt(value) })}
            >
              <SelectTrigger id="rating">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[5, 4, 3, 2, 1].map((num) => (
                  <SelectItem key={num} value={num.toString()}>
                    {num} {num === 1 ? "Star" : "Stars"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Review Text */}
          <div className="space-y-2">
            <Label htmlFor="review_text">
              Review Text <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="review_text"
              value={formData.review_text}
              onChange={(e) => setFormData({ ...formData, review_text: e.target.value })}
              rows={6}
              required
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              {formData.review_text.length} characters • Edit as needed before publishing
            </p>
          </div>

          {/* Vehicle (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="vehicle_id">Vehicle Rented (Optional)</Label>
            <Select
              value={formData.vehicle_id}
              onValueChange={(value) => setFormData({ ...formData, vehicle_id: value })}
            >
              <SelectTrigger id="vehicle_id">
                <SelectValue placeholder="Select vehicle..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {vehicles.map((vehicle) => (
                  <SelectItem key={vehicle.id} value={vehicle.id}>
                    {vehicle.name} ({vehicle.category})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Rental Period (Optional) */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="rental_period_start">Rental Start (Optional)</Label>
              <Input
                id="rental_period_start"
                type="date"
                value={formData.rental_period_start}
                onChange={(e) => setFormData({ ...formData, rental_period_start: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rental_period_end">Rental End (Optional)</Label>
              <Input
                id="rental_period_end"
                type="date"
                value={formData.rental_period_end}
                onChange={(e) => setFormData({ ...formData, rental_period_end: e.target.value })}
              />
            </div>
          </div>

          {/* Status Toggles */}
          <div className="space-y-4 p-4 bg-muted/30 rounded-lg border border-border">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Label htmlFor="is_active" className="cursor-pointer font-semibold">
                    Active Status
                  </Label>
                  {!formData.is_active && (
                    <Badge variant="secondary">Inactive</Badge>
                  )}
                  {formData.is_active && (
                    <Badge className="bg-green-500/20 text-green-600 border-green-500/30">Active</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Inactive reviews require manual approval before appearing on the website
                </p>
              </div>
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label htmlFor="is_featured" className="cursor-pointer font-semibold">
                  Featured
                </Label>
                <p className="text-xs text-muted-foreground">
                  Pin this review to top sections on the website
                </p>
              </div>
              <Switch
                id="is_featured"
                checked={formData.is_featured}
                onCheckedChange={(checked) => setFormData({ ...formData, is_featured: checked })}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
              disabled={publishing}
            >
              Cancel
            </Button>
            <Button
              onClick={handlePublish}
              className="flex-1 gradient-accent shadow-glow"
              disabled={publishing || !formData.customer_name.trim() || !formData.review_text.trim()}
            >
              {publishing ? (
                <>Publishing...</>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Publish to Reviews
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};