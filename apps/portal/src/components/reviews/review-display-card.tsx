"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Star, Edit, SkipForward, MessageSquarePlus } from "lucide-react";
import { useRentalReview } from "@/hooks/use-rental-review";
import { getRatingColor, POSITIVE_TAGS } from "./review-tags";

interface ReviewDisplayCardProps {
  rentalId: string;
  onEdit: () => void;
  onLeaveReview: () => void;
}

export function ReviewDisplayCard({ rentalId, onEdit, onLeaveReview }: ReviewDisplayCardProps) {
  const { data: review, isLoading } = useRentalReview(rentalId);

  if (isLoading) return null;

  // No review yet
  if (!review) {
    return (
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Star className="h-4 w-4" />
              <span className="text-sm">No review yet for this rental</span>
            </div>
            <Button variant="outline" size="sm" onClick={onLeaveReview}>
              <MessageSquarePlus className="h-4 w-4 mr-2" />
              Leave a Review
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Skipped review
  if (review.is_skipped) {
    return (
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <SkipForward className="h-4 w-4" />
              <span className="text-sm">Review was skipped</span>
            </div>
            <Button variant="outline" size="sm" onClick={onLeaveReview}>
              <MessageSquarePlus className="h-4 w-4 mr-2" />
              Add Review
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Has review
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Star className="h-5 w-5" />
            Customer Review
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Edit className="h-4 w-4 mr-1" />
            Edit
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Rating */}
        <div className="flex items-center gap-3">
          <span className={`text-3xl font-bold ${getRatingColor(review.rating!)}`}>
            {review.rating}/10
          </span>
          <span className="text-sm text-muted-foreground">
            {new Date(review.created_at).toLocaleDateString()}
          </span>
        </div>

        {/* Tags */}
        {review.tags && review.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {review.tags.map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className={
                  POSITIVE_TAGS.includes(tag as any)
                    ? "bg-green-500/10 text-green-700 border-green-500/20 dark:text-green-400"
                    : "bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-400"
                }
              >
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* Comment */}
        {review.comment && (
          <p className="text-sm text-muted-foreground italic">"{review.comment}"</p>
        )}
      </CardContent>
    </Card>
  );
}
