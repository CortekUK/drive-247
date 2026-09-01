"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Star, Eye, Sparkles } from "lucide-react";
import { useCustomerReviewSummary } from "@/hooks/use-customer-review-summary";
import { getRatingColor } from "./review-tags";
import { CustomerReviewsDialog } from "./customer-reviews-dialog";

interface ApprovalReviewSummaryProps {
  customerId: string;
  customerName?: string;
}

export function ApprovalReviewSummary({ customerId, customerName }: ApprovalReviewSummaryProps) {
  const { data: summary } = useCustomerReviewSummary(customerId);
  const [showReviews, setShowReviews] = useState(false);

  if (!summary) return null;

  return (
    <>
      <div className="mt-3 p-3 bg-muted/50 rounded-lg border space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Customer Review History</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={(e) => {
              e.preventDefault();
              setShowReviews(true);
            }}
          >
            <Eye className="h-3 w-3 mr-1" />
            View Reviews
          </Button>
        </div>
        <div className="flex items-center gap-3">
          {summary.average_rating && (
            <span className={`text-lg font-bold ${getRatingColor(summary.average_rating)}`}>
              {summary.average_rating}/10
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {summary.total_reviews} review{summary.total_reviews === 1 ? "" : "s"}
          </span>
        </div>
        {summary.summary && (
          <div className="flex gap-1.5">
            <Sparkles className="h-3 w-3 text-primary mt-0.5 flex-shrink-0" />
            <p className="text-xs text-muted-foreground line-clamp-2">{summary.summary}</p>
          </div>
        )}
      </div>

      <CustomerReviewsDialog
        open={showReviews}
        onOpenChange={setShowReviews}
        customerId={customerId}
        customerName={customerName}
      />
    </>
  );
}
