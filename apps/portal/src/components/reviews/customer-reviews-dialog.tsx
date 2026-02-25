"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, Star, FileText } from "lucide-react";
import { useCustomerReviews } from "@/hooks/use-customer-reviews";
import { getRatingColor, POSITIVE_TAGS } from "./review-tags";
import { useRouter } from "next/navigation";

interface CustomerReviewsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  customerName?: string;
}

export function CustomerReviewsDialog({
  open,
  onOpenChange,
  customerId,
  customerName,
}: CustomerReviewsDialogProps) {
  const { data: reviews, isLoading } = useCustomerReviews(open ? customerId : undefined);
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>All Reviews{customerName ? ` — ${customerName}` : ""}</DialogTitle>
          <DialogDescription>
            {reviews?.length
              ? `${reviews.length} review${reviews.length === 1 ? "" : "s"}`
              : "No reviews yet"}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !reviews?.length ? (
          <div className="text-center py-8 text-muted-foreground">
            <Star className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No reviews yet for this customer.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {reviews.map((review) => (
              <div key={review.id} className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`text-xl font-bold ${getRatingColor(review.rating!)}`}>
                      {review.rating}/10
                    </span>
                    {review.rental && (
                      <button
                        className="text-sm text-primary hover:underline flex items-center gap-1"
                        onClick={() => {
                          onOpenChange(false);
                          router.push(`/rentals/${review.rental_id}`);
                        }}
                      >
                        <FileText className="h-3 w-3" />
                        {review.rental.rental_number}
                      </button>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(review.created_at).toLocaleDateString()}
                  </span>
                </div>

                {/* Vehicle info */}
                {review.rental?.vehicle && (
                  <p className="text-xs text-muted-foreground">
                    {review.rental.vehicle.make} {review.rental.vehicle.model} ({review.rental.vehicle.reg})
                    {" — "}
                    {new Date(review.rental.start_date).toLocaleDateString()}
                    {review.rental.end_date && ` to ${new Date(review.rental.end_date).toLocaleDateString()}`}
                  </p>
                )}

                {/* Tags */}
                {review.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {review.tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="outline"
                        className={`text-xs ${
                          POSITIVE_TAGS.includes(tag as any)
                            ? "bg-green-500/10 text-green-700 border-green-500/20 dark:text-green-400"
                            : "bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-400"
                        }`}
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

                {/* Reviewer */}
                {review.reviewer && (
                  <p className="text-xs text-muted-foreground">
                    Reviewed by {review.reviewer.name}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
