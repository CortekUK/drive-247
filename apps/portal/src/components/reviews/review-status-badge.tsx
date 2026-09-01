"use client";

import { Star, Pencil, MinusCircle } from "lucide-react";

interface ReviewStatusBadgeProps {
  reviewStatus: "pending" | "reviewed" | "skipped" | null;
  reviewRating?: number | null;
  rentalStatus?: string;
  onClick?: (e: React.MouseEvent) => void;
}

export function ReviewStatusBadge({ reviewStatus, reviewRating, rentalStatus, onClick }: ReviewStatusBadgeProps) {
  // Non-completed rentals — show dash, no action needed
  if (rentalStatus && rentalStatus !== "Completed") {
    return <span className="text-xs text-muted-foreground/50">—</span>;
  }

  // Completed + reviewed
  if (reviewStatus === "reviewed" && reviewRating) {
    const color = reviewRating >= 8
      ? "text-green-600"
      : reviewRating >= 5
      ? "text-amber-600"
      : "text-red-600";
    return (
      <button
        className={`flex items-center gap-1 text-xs font-medium cursor-pointer hover:opacity-70 transition-opacity ${color}`}
        onClick={onClick}
        title="Click to view review"
      >
        <Star className="h-3 w-3 fill-current" />
        {reviewRating}/10
      </button>
    );
  }

  // Completed + skipped
  if (reviewStatus === "skipped") {
    return (
      <button
        className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
        onClick={onClick}
        title="Review was skipped"
      >
        <MinusCircle className="h-3 w-3" />
        Skipped
      </button>
    );
  }

  // Completed + not reviewed yet (pending or null)
  return (
    <button
      className="flex items-center gap-1 text-xs text-amber-600 cursor-pointer hover:text-amber-500 transition-colors"
      onClick={onClick}
      title="Click to review"
    >
      <Pencil className="h-3 w-3" />
      Review
    </button>
  );
}
