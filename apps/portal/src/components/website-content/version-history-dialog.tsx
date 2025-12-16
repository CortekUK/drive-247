import { useCMSVersions } from "@/hooks/use-cms-versions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { History, RotateCcw, Loader2, Calendar } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";

interface VersionHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageSlug: string;
}

export function VersionHistoryDialog({
  open,
  onOpenChange,
  pageSlug,
}: VersionHistoryDialogProps) {
  const { versions, isLoading, rollback, isRollingBack } = useCMSVersions(pageSlug);
  const [confirmRollback, setConfirmRollback] = useState<string | null>(null);

  const handleRollback = async () => {
    if (confirmRollback) {
      await rollback(confirmRollback);
      setConfirmRollback(null);
      onOpenChange(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Version History
            </DialogTitle>
            <DialogDescription>
              View and restore previous versions of this page. Restoring a version will set the page to draft status.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[60vh]">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-20" />
                ))}
              </div>
            ) : versions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No versions yet</p>
                <p className="text-sm">Versions are created when you publish changes</p>
              </div>
            ) : (
              <div className="space-y-3">
                {versions.map((version, index) => (
                  <div
                    key={version.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={index === 0 ? "default" : "secondary"}>
                          v{version.version_number}
                        </Badge>
                        {index === 0 && (
                          <Badge variant="outline" className="text-green-600">
                            Latest
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(version.created_at), "MMM d, yyyy 'at' h:mm a")}
                        </span>
                      </div>
                      {version.notes && (
                        <p className="text-sm text-muted-foreground">{version.notes}</p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmRollback(version.id)}
                      disabled={isRollingBack}
                    >
                      <RotateCcw className="h-4 w-4 mr-1" />
                      Restore
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Rollback Confirmation */}
      <AlertDialog open={!!confirmRollback} onOpenChange={() => setConfirmRollback(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this version?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace the current content with the selected version. The page will be
              set to draft status and you will need to publish it again to make changes live.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRollingBack}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRollback} disabled={isRollingBack}>
              {isRollingBack ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Restoring...
                </>
              ) : (
                <>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Restore Version
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
