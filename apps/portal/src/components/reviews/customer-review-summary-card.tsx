"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Star, Eye, Sparkles } from "lucide-react";
import { useCustomerReviewSummary } from "@/hooks/use-customer-review-summary";
import { useCustomerReviews } from "@/hooks/use-customer-reviews";
import { getRatingColor } from "./review-tags";
import { CustomerReviewsDialog } from "./customer-reviews-dialog";

interface CustomerReviewSummaryCardProps {
  customerId: string;
  customerName?: string;
}

export function CustomerReviewSummaryCard({ customerId, customerName }: CustomerReviewSummaryCardProps) {
  const { data: summary, isLoading: loadingSummary } = useCustomerReviewSummary(customerId);
  const { data: reviews, isLoading: loadingReviews } = useCustomerReviews(customerId);
  const [showReviews, setShowReviews] = useState(false);

  if (loadingSummary && loadingReviews) return null;

  const hasReviews = reviews && reviews.length > 0;
  const hasSummary = !!summary;

  // Compute stats from reviews directly as fallback
  const reviewCount = reviews?.length || summary?.total_reviews || 0;
  const avgRating = summary?.average_rating
    || (hasReviews
      ? Math.round((reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length) * 10) / 10
      : null);

  // No summary AND no reviews = truly no reviews
  if (!hasSummary && !hasReviews) {
    return (
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Star className="h-4 w-4" />
            <span className="text-sm">No reviews yet for this customer</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Star className="h-5 w-5" />
              Review Summary
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowReviews(true)}>
              <Eye className="h-4 w-4 mr-1" />
              View All Reviews
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-4">
            {avgRating && (
              <div className="flex items-center gap-1.5">
                <span className={`text-2xl font-bold ${getRatingColor(avgRating)}`}>
                  {avgRating}
                </span>
                <span className="text-sm text-muted-foreground">/10 avg</span>
              </div>
            )}
            <span className="text-sm text-muted-foreground">
              {reviewCount} review{reviewCount === 1 ? "" : "s"}
            </span>
          </div>

          {summary?.summary && (
            <div className="flex gap-2">
              <Sparkles className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
              <p className="text-sm text-muted-foreground">{summary.summary}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <CustomerReviewsDialog
        open={showReviews}
        onOpenChange={setShowReviews}
        customerId={customerId}
        customerName={customerName}
      />
    </>
  );
}
