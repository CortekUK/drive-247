"use client";

import { Badge } from "@/components/ui/badge";
import { getRatingColor } from "./review-tags";

interface ReviewStatusBadgeProps {
  reviewStatus: "pending" | "reviewed" | "skipped" | null;
  reviewRating?: number | null;
  onClick?: (e: React.MouseEvent) => void;
}

export function ReviewStatusBadge({ reviewStatus, reviewRating, onClick }: ReviewStatusBadgeProps) {
  if (!reviewStatus) return null;

  if (reviewStatus === "pending") {
    return (
      <Badge
        variant="outline"
        className="bg-amber-500/10 text-amber-600 border-amber-500/30 cursor-pointer hover:bg-amber-500/20 transition-colors"
        onClick={onClick}
      >
        Pending Review
      </Badge>
    );
  }

  if (reviewStatus === "skipped") {
    return (
      <Badge
        variant="outline"
        className="text-muted-foreground cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={onClick}
      >
        Skipped
      </Badge>
    );
  }

  if (reviewStatus === "reviewed" && reviewRating) {
    return (
      <Badge
        variant="outline"
        className={`cursor-pointer hover:opacity-80 transition-colors ${
          reviewRating >= 8
            ? "bg-green-500/10 text-green-600 border-green-500/30"
            : reviewRating >= 5
            ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
            : "bg-red-500/10 text-red-600 border-red-500/30"
        }`}
        onClick={onClick}
      >
        Reviewed ({reviewRating}/10)
      </Badge>
    );
  }

  return null;
}
