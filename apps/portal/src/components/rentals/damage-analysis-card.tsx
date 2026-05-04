import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  ScanSearch,
  Loader2,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Clock,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useDamageReport,
  useDetectDamage,
  useReviewDamageReport,
  type DamageFinding,
  type DamageSeverity,
} from "@/hooks/use-damage-detection";
import { useKeyHandover } from "@/hooks/use-key-handover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DamageAnalysisCardProps {
  rentalId: string;
}

const severityStyles: Record<DamageSeverity, { label: string; className: string }> = {
  minor: {
    label: "Minor",
    className: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900",
  },
  moderate: {
    label: "Moderate",
    className: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-900",
  },
  severe: {
    label: "Severe",
    className: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900",
  },
};

export const DamageAnalysisCard = ({ rentalId }: DamageAnalysisCardProps) => {
  const { data: report, isLoading } = useDamageReport(rentalId);
  const { givingHandover, receivingHandover } = useKeyHandover(rentalId);
  const detect = useDetectDamage(rentalId);
  const reviewMutation = useReviewDamageReport(rentalId);

  const [reviewerNotes, setReviewerNotes] = useState<string>(report?.reviewer_notes ?? "");
  const [zoomedPhoto, setZoomedPhoto] = useState<{ url: string; label: string } | null>(null);

  const givingPhotos = givingHandover?.photos || [];
  const receivingPhotos = receivingHandover?.photos || [];

  // Sort photos the same way the edge function does (uploaded_at ascending) so indices align
  const sortedGiving = useMemo(
    () => givingPhotos.slice().sort((a, b) => new Date(a.uploaded_at).getTime() - new Date(b.uploaded_at).getTime()),
    [givingPhotos],
  );
  const sortedReceiving = useMemo(
    () => receivingPhotos.slice().sort((a, b) => new Date(a.uploaded_at).getTime() - new Date(b.uploaded_at).getTime()),
    [receivingPhotos],
  );

  const canRun = sortedGiving.length > 0 && sortedReceiving.length > 0;
  const isStale =
    !!report &&
    (sortedGiving.length !== report.giving_photo_count || sortedReceiving.length !== report.receiving_photo_count);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          Loading damage analysis...
        </CardContent>
      </Card>
    );
  }

  const renderEmptyState = () => (
    <div className="text-center py-8 border-2 border-dashed rounded-lg space-y-2">
      <ScanSearch className="h-8 w-8 mx-auto text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">
        {!sortedGiving.length && !sortedReceiving.length
          ? "Upload handover and return photos to enable AI damage analysis"
          : !sortedGiving.length
          ? "Upload handover photos to enable comparison"
          : "Upload return photos to compare against handover"}
      </p>
    </div>
  );

  const renderRunButton = (label: string) => (
    <Button
      onClick={() => detect.mutate()}
      disabled={!canRun || detect.isPending}
      className="w-full"
    >
      {detect.isPending ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Analyzing photos...
        </>
      ) : (
        <>
          <Sparkles className="h-4 w-4 mr-2" />
          {label}
        </>
      )}
    </Button>
  );

  const renderFinding = (f: DamageFinding, idx: number) => {
    const beforePhoto =
      f.before_photo_index !== null && sortedGiving[f.before_photo_index]
        ? sortedGiving[f.before_photo_index]
        : null;
    const afterPhoto =
      f.after_photo_index !== null && sortedReceiving[f.after_photo_index]
        ? sortedReceiving[f.after_photo_index]
        : null;
    const sev = severityStyles[f.severity];

    return (
      <div key={idx} className="border rounded-lg p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={cn("text-xs", sev.className)}>
                {sev.label}
              </Badge>
              <span className="text-sm font-semibold text-foreground">{f.location}</span>
              <span className="text-xs text-muted-foreground">
                {Math.round(f.confidence * 100)}% confidence
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{f.description}</p>
          </div>
        </div>

        {(beforePhoto || afterPhoto) && (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Before</p>
              {beforePhoto ? (
                <button
                  type="button"
                  onClick={() => setZoomedPhoto({ url: beforePhoto.file_url, label: "Handover (before)" })}
                  className="block w-full aspect-video rounded-md overflow-hidden border bg-muted hover:opacity-90 transition"
                >
                  <img src={beforePhoto.file_url} alt="Handover" className="w-full h-full object-cover" />
                </button>
              ) : (
                <div className="w-full aspect-video rounded-md border-2 border-dashed bg-muted/30 flex items-center justify-center">
                  <span className="text-xs text-muted-foreground">No matching before photo</span>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">After</p>
              {afterPhoto ? (
                <button
                  type="button"
                  onClick={() => setZoomedPhoto({ url: afterPhoto.file_url, label: "Return (after)" })}
                  className="block w-full aspect-video rounded-md overflow-hidden border bg-muted hover:opacity-90 transition"
                >
                  <img src={afterPhoto.file_url} alt="Return" className="w-full h-full object-cover" />
                </button>
              ) : (
                <div className="w-full aspect-video rounded-md border-2 border-dashed bg-muted/30 flex items-center justify-center">
                  <span className="text-xs text-muted-foreground">No after photo</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <Card id="damage-analysis-section">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <ScanSearch className="h-5 w-5 text-primary" />
              AI Damage Analysis
            </CardTitle>
            {report?.has_new_damage ? (
              <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400">
                <AlertTriangle className="h-3 w-3 mr-1" />
                New damage flagged
              </Badge>
            ) : report ? (
              <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400">
                <ShieldCheck className="h-3 w-3 mr-1" />
                No new damage
              </Badge>
            ) : null}
          </div>
          <CardDescription>
            Compare handover and return photos to detect damage that occurred during the rental
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!report && !canRun && renderEmptyState()}

          {!report && canRun && (
            <>
              <div className="text-sm text-muted-foreground">
                Ready to compare {sortedGiving.length} handover photo{sortedGiving.length === 1 ? "" : "s"} against{" "}
                {sortedReceiving.length} return photo{sortedReceiving.length === 1 ? "" : "s"}.
              </div>
              {renderRunButton("Analyze Damage")}
            </>
          )}

          {report && (
            <>
              {/* Summary banner */}
              <div
                className={cn(
                  "p-4 rounded-lg border flex items-start gap-3",
                  report.has_new_damage
                    ? "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900"
                    : "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-900",
                )}
              >
                {report.has_new_damage ? (
                  <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                )}
                <div className="space-y-1 flex-1">
                  <p
                    className={cn(
                      "text-sm font-medium",
                      report.has_new_damage
                        ? "text-red-700 dark:text-red-400"
                        : "text-green-700 dark:text-green-400",
                    )}
                  >
                    {report.summary || (report.has_new_damage ? "New damage detected" : "No new damage detected")}
                  </p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(report.generated_at).toLocaleString("en-US")}
                    </span>
                    <span>·</span>
                    <span>
                      {report.giving_photo_count} before / {report.receiving_photo_count} after
                    </span>
                    {report.model && (
                      <>
                        <span>·</span>
                        <span>{report.model}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {isStale && (
                <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-md px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                  <span>
                    Photos have changed since this report was generated ({sortedGiving.length} before /{" "}
                    {sortedReceiving.length} after now). Re-run for an up-to-date analysis.
                  </span>
                </div>
              )}

              {/* Findings */}
              {report.findings.length > 0 && (
                <div className="space-y-3">
                  <Label className="text-sm font-semibold">
                    Findings ({report.findings.length})
                  </Label>
                  {report.findings.map(renderFinding)}
                </div>
              )}

              {/* Reviewer section */}
              <div className="border-t pt-4 space-y-3">
                <Label className="text-sm font-medium">Operator notes</Label>
                <Textarea
                  placeholder="Add context, dispute findings, or note actions taken..."
                  value={reviewerNotes}
                  onChange={(e) => setReviewerNotes(e.target.value)}
                  rows={3}
                />
                {report.reviewed_at && (
                  <p className="text-xs text-muted-foreground">
                    Reviewed on {new Date(report.reviewed_at).toLocaleString("en-US")}
                  </p>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    onClick={() => reviewMutation.mutate({ reviewerNotes })}
                    disabled={reviewMutation.isPending}
                    variant="outline"
                  >
                    {reviewMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                    )}
                    {report.reviewed_at ? "Update review" : "Mark as reviewed"}
                  </Button>
                  <Button
                    onClick={() => detect.mutate()}
                    disabled={!canRun || detect.isPending}
                    variant="ghost"
                  >
                    {detect.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    Re-run analysis
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Photo zoom dialog */}
      <Dialog open={!!zoomedPhoto} onOpenChange={() => setZoomedPhoto(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{zoomedPhoto?.label}</DialogTitle>
          </DialogHeader>
          {zoomedPhoto && (
            <img src={zoomedPhoto.url} alt={zoomedPhoto.label} className="w-full h-auto rounded-md" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
