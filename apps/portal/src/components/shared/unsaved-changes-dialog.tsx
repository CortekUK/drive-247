'use client';

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface UnsavedChangesDialogProps {
  open: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSave?: () => void;
  isSaving?: boolean;
}

export function UnsavedChangesDialog({
  open,
  onCancel,
  onDiscard,
  onSave,
  isSaving = false,
}: UnsavedChangesDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Escape / backdrop should behave like Cancel
        if (!next && !isSaving) onCancel();
      }}
    >
      <AlertDialogContent className="max-w-[calc(100vw-24px)] sm:max-w-lg p-4 sm:p-6 gap-3 sm:gap-4">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base sm:text-lg">Unsaved Changes</AlertDialogTitle>
          <AlertDialogDescription className="text-xs sm:text-sm">
            You have unsaved changes that will be lost if you leave this page.
            What would you like to do?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isSaving}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            className="w-full sm:w-auto text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={onDiscard}
            disabled={isSaving}
          >
            Don't Save
          </Button>
          {onSave && (
            <Button
              onClick={onSave}
              disabled={isSaving}
              className="w-full sm:w-auto"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save & Leave'
              )}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
