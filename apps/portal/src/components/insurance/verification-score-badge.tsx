import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, XCircle, Loader2, Clock } from "lucide-react";

type Status =
  | "pending"
  | "processing"
  | "verified"
  | "flagged"
  | "rejected"
  | "failed";

export function VerificationStatusChip({
  status,
  score,
}: {
  status: Status;
  score?: number | null;
}) {
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        Queued
      </span>
    );
  }
  if (status === "processing") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-indigo-600">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Analyzing
      </span>
    );
  }
  if (status === "verified") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Verified {typeof score === "number" ? `(${score})` : ""}
      </span>
    );
  }
  if (status === "flagged") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5" />
        Flagged {typeof score === "number" ? `(${score})` : ""}
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400">
        <XCircle className="h-3.5 w-3.5" />
        Rejected {typeof score === "number" ? `(${score})` : ""}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <XCircle className="h-3.5 w-3.5" />
      Error
    </span>
  );
}

export function ScorePill({ score }: { score: number | null | undefined }) {
  if (typeof score !== "number") return null;
  const tone =
    score >= 70
      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
      : score >= 40
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
        : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
  return (
    <Badge variant="outline" className={`font-mono ${tone} border-transparent`}>
      {score}/100
    </Badge>
  );
}
