"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, SkipForward, Plus, X } from "lucide-react";
import { useRentalReview, useSubmitRentalReview, useSkipRentalReview } from "@/hooks/use-rental-review";
import { useReviewTags, useCreateReviewTag } from "@/hooks/use-review-tags";
import { getRatingColor } from "./review-tags";
import { useAuditLogOnOpen } from "@/hooks/use-audit-log-on-open";

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
  const { data: tenantTags = [], isLoading: loadingTags } = useReviewTags();
  const createTag = useCreateReviewTag();

  useAuditLogOnOpen({
    open,
    action: "rental_review_dialog_shown",
    entityType: "rental",
    entityId: rentalId,
  });

  const [rating, setRating] = useState<number>(5);
  const [comment, setComment] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState("");

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
    setNewTagInput("");
  }, [existingReview, open]);

  const handleToggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleAddNewTag = async () => {
    const trimmed = newTagInput.trim();
    if (!trimmed) return;

    // Check if tag already exists (case-insensitive)
    const exists = tenantTags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase());
    if (!exists) {
      await createTag.mutateAsync(trimmed);
    }

    // Select the tag
    if (!selectedTags.includes(trimmed)) {
      setSelectedTags((prev) => [...prev, trimmed]);
    }
    setNewTagInput("");
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

              {/* Selected tags */}
              {selectedTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedTags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="bg-primary/10 text-primary border border-primary/20 cursor-pointer hover:bg-primary/20 gap-1"
                      onClick={() => handleToggleTag(tag)}
                    >
                      {tag}
                      <X className="h-3 w-3" />
                    </Badge>
                  ))}
                </div>
              )}

              {/* Available tags (unselected) */}
              {!loadingTags && tenantTags.filter((t) => !selectedTags.includes(t.name)).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tenantTags
                    .filter((t) => !selectedTags.includes(t.name))
                    .map((tag) => (
                      <Badge
                        key={tag.id}
                        variant="outline"
                        className="cursor-pointer hover:bg-muted text-muted-foreground"
                        onClick={() => handleToggleTag(tag.name)}
                      >
                        {tag.name}
                      </Badge>
                    ))}
                </div>
              )}

              {/* Add new tag */}
              <div className="flex gap-2">
                <Input
                  placeholder="Add a new tag..."
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddNewTag();
                    }
                  }}
                  className="h-8 text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddNewTag}
                  disabled={!newTagInput.trim() || createTag.isPending}
                  className="h-8 px-3 shrink-0"
                >
                  {createTag.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                </Button>
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
