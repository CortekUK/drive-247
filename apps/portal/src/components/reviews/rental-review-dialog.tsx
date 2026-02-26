"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, SkipForward } from "lucide-react";
import { useRentalReview, useSubmitRentalReview, useSkipRentalReview } from "@/hooks/use-rental-review";
import { POSITIVE_TAGS, NEGATIVE_TAGS, getRatingColor, getSliderColor } from "./review-tags";

interface RentalReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rentalId: string;
  customerId: string;
  customerName?: string;
  rentalNumber?: string;
}

export function RentalReviewDialog({
  open,
  onOpenChange,
  rentalId,
  customerId,
  customerName,
  rentalNumber,
}: RentalReviewDialogProps) {
  const { data: existingReview, isLoading: loadingReview } = useRentalReview(open ? rentalId : undefined);
  const submitReview = useSubmitRentalReview();
  const skipReview = useSkipRentalReview();

  const [rating, setRating] = useState<number>(5);
  const [comment, setComment] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const isEditing = !!existingReview && !existingReview.is_skipped;

  useEffect(() => {
    if (existingReview && !existingReview.is_skipped) {
      setRating(existingReview.rating || 5);
      setComment(existingReview.comment || "");
      setSelectedTags(existingReview.tags || []);
    } else {
      setRating(5);
      setComment("");
      setSelectedTags([]);
    }
  }, [existingReview, open]);

  const handleToggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = () => {
    submitReview.mutate(
      {
        rentalId,
        customerId,
        rating,
        comment: comment.trim() || undefined,
        tags: selectedTags,
        existingReviewId: existingReview?.id,
      },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  const handleSkip = () => {
    skipReview.mutate(
      { rentalId, customerId, existingReviewId: existingReview?.id },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  const isSubmitting = submitReview.isPending || skipReview.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Review" : "Leave a Review"}</DialogTitle>
          <DialogDescription>
            {customerName && rentalNumber
              ? `Review for ${customerName} — ${rentalNumber}`
              : "Rate this customer's rental experience (internal only)"}
          </DialogDescription>
        </DialogHeader>

        {loadingReview ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6 py-2">
            {/* Rating Slider */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Rating</Label>
                <span className={`text-2xl font-bold ${getRatingColor(rating)}`}>
                  {rating}/10
                </span>
              </div>
              <div className="relative">
                <Slider
                  value={[rating]}
                  onValueChange={([v]) => setRating(v)}
                  min={1}
                  max={10}
                  step={1}
                  className="[&_[role=slider]]:border-2"
                />
                <style>{`
                  [data-radix-collection-item] + [data-radix-collection-item] {
                    background: ${rating >= 8 ? '#22c55e' : rating >= 5 ? '#f59e0b' : '#ef4444'};
                  }
                `}</style>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Poor</span>
                <span>Average</span>
                <span>Excellent</span>
              </div>
            </div>

            {/* Tags */}
            <div className="space-y-3">
              <Label>Tags</Label>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium">Positive</p>
                <div className="flex flex-wrap gap-2">
                  {POSITIVE_TAGS.map((tag) => (
                    <label
                      key={tag}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors border ${
                        selectedTags.includes(tag)
                          ? "bg-green-500/15 text-green-700 border-green-500/30 dark:text-green-400"
                          : "bg-muted/50 text-muted-foreground border-transparent hover:bg-muted"
                      }`}
                    >
                      <Checkbox
                        checked={selectedTags.includes(tag)}
                        onCheckedChange={() => handleToggleTag(tag)}
                        className="h-3 w-3 border-current"
                      />
                      {tag}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground font-medium mt-2">Negative</p>
                <div className="flex flex-wrap gap-2">
                  {NEGATIVE_TAGS.map((tag) => (
                    <label
                      key={tag}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors border ${
                        selectedTags.includes(tag)
                          ? "bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-400"
                          : "bg-muted/50 text-muted-foreground border-transparent hover:bg-muted"
                      }`}
                    >
                      <Checkbox
                        checked={selectedTags.includes(tag)}
                        onCheckedChange={() => handleToggleTag(tag)}
                        className="h-3 w-3 border-current"
                      />
                      {tag}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Comment */}
            <div className="space-y-2">
              <Label htmlFor="review-comment">Comment (optional)</Label>
              <Textarea
                id="review-comment"
                placeholder="Any additional notes about this customer..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
              />
            </div>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {!isEditing && !loadingReview && (
            <Button
              variant="ghost"
              onClick={handleSkip}
              disabled={isSubmitting}
              className="sm:mr-auto text-muted-foreground"
            >
              <SkipForward className="h-4 w-4 mr-2" />
              Skip
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || loadingReview}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : isEditing ? (
              "Update Review"
            ) : (
              "Submit Review"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
