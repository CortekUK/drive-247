import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Loader2, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useDataCleanup } from '@/hooks/use-data-cleanup';
import { toast } from '@/hooks/use-toast';

interface DataCleanupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DataCleanupDialog({ open, onOpenChange }: DataCleanupDialogProps) {
  const [confirmationChecked, setConfirmationChecked] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const { cleanupTestData, isLoading, result } = useDataCleanup();

  const handleInitialConfirm = () => {
    if (!confirmationChecked) return;
    setShowConfirmation(true);
  };

  const handleFinalConfirm = async () => {
    try {
      const cleanupResult = await cleanupTestData();
      
      if (cleanupResult.success) {
        const totalDeleted = Object.values(cleanupResult.rowsDeleted).reduce((sum, count) => sum + count, 0);
        toast({
          title: "Data Cleanup Successful",
          description: `Cleared ${cleanupResult.tablesCleared.length} tables and deleted ${totalDeleted} records.`,
          variant: "default",
        });
      } else {
        toast({
          title: "Cleanup Failed",
          description: cleanupResult.error || "An unknown error occurred during cleanup.",
          variant: "destructive",
        });
      }
      
      setShowConfirmation(false);
      setConfirmationChecked(false);
      onOpenChange(false);
    } catch (error) {
      console.error('Cleanup error:', error);
      toast({
        title: "Cleanup Failed", 
        description: "An unexpected error occurred during data cleanup.",
        variant: "destructive",
      });
    }
  };

  const handleCancel = () => {
    setShowConfirmation(false);
    setConfirmationChecked(false);
    onOpenChange(false);
  };

  if (showConfirmation) {
    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Final Confirmation - Data Cleanup
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <p className="text-base">
                  You are about to permanently delete all test data from the following areas:
                </p>
                
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="space-y-1">
                    <strong>Customer Data:</strong>
                    <ul className="list-disc list-inside ml-4 space-y-0.5">
                      <li>Customers</li>
                      <li>Customer documents</li>
                      <li>Insurance policies</li>
                    </ul>
                  </div>
                  
                  <div className="space-y-1">
                    <strong>Vehicle Data:</strong>
                    <ul className="list-disc list-inside ml-4 space-y-0.5">
                      <li>Vehicles</li>
                      <li>Vehicle files & photos</li>
                      <li>Service records</li>
                      <li>Vehicle expenses</li>
                      <li>Number plates</li>
                    </ul>
                  </div>
                  
                  <div className="space-y-1">
                    <strong>Financial Data:</strong>
                    <ul className="list-disc list-inside ml-4 space-y-0.5">
                      <li>Rentals</li>
                      <li>Payments</li>
                      <li>Ledger entries</li>
                      <li>P&L entries</li>
                      <li>Fines</li>
                    </ul>
                  </div>
                  
                  <div className="space-y-1">
                    <strong>System Data:</strong>
                    <ul className="list-disc list-inside ml-4 space-y-0.5">
                      <li>Reminders</li>
                      <li>Activity logs</li>
                      <li>Login attempts</li>
                      <li>Maintenance runs</li>
                    </ul>
                  </div>
                </div>

                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Preserved:</strong> User accounts, system settings, and configuration will be kept intact.
                  </AlertDescription>
                </Alert>
                
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Warning:</strong> This action cannot be undone. All business data will be permanently deleted.
                  </AlertDescription>
                </Alert>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancel} disabled={isLoading}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleFinalConfirm}
              disabled={isLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cleaning Data...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete All Data
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            Clean Test Data
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4">
              <p>
                This will permanently remove all test data including customers, vehicles, 
                rentals, payments, and related records. User accounts and system settings will be preserved.
              </p>
              
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <strong>This action cannot be undone.</strong> Make sure you have backups if needed.
                </AlertDescription>
              </Alert>
              
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="confirm"
                  checked={confirmationChecked}
                  onCheckedChange={(checked) => setConfirmationChecked(checked === true)}
                />
                <Label htmlFor="confirm" className="text-sm">
                  I understand this will permanently delete all test data
                </Label>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleInitialConfirm}
            disabled={!confirmationChecked}
          >
            Continue
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}