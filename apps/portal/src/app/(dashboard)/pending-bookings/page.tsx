"use client";

import { useMemo, useState } from "react";
import { format, differenceInDays, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import {
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Car,
  User,
  Calendar,
  Shield,
  RefreshCw,
  Inbox,
} from "lucide-react";
import {
  KpiTile,
  TableTile,
  bentoTable,
  StatusPill,
  Money,
  EmptyState,
  ErrorState,
  TableSkeleton,
  KpiTileSkeletonRow,
} from "@/components/bento";
import { usePendingBookings, PendingBooking } from "@/hooks/use-pending-bookings";
import { useApproveBooking, useRejectBooking } from "@/hooks/use-booking-approval";
import { CancelRentalDialog } from "@/components/shared/dialogs/cancel-rental-dialog";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";

const PendingBookings = () => {
  const { data: bookings, isLoading, error, refetch } = usePendingBookings();
  const approveBooking = useApproveBooking();
  const rejectBooking = useRejectBooking();
  const { canEdit } = useManagerPermissions();

  const [selectedBooking, setSelectedBooking] = useState<PendingBooking | null>(
    null
  );
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  const handleApprove = async () => {
    if (!selectedBooking) return;

    await approveBooking.mutateAsync({
      paymentId: selectedBooking.id,
    });

    setShowApproveDialog(false);
    setSelectedBooking(null);
  };

  const handleReject = async () => {
    if (!selectedBooking) return;

    await rejectBooking.mutateAsync({
      paymentId: selectedBooking.id,
      reason: rejectionReason,
    });

    setShowRejectDialog(false);
    setSelectedBooking(null);
    setRejectionReason("");
  };

  const getDaysUntilExpiry = (expiresAt: string | null): number | null => {
    if (!expiresAt) return null;
    return differenceInDays(parseISO(expiresAt), new Date());
  };

  const getExpiryPill = (expiresAt: string | null) => {
    const days = getDaysUntilExpiry(expiresAt);
    if (days === null) return <span className="text-muted-foreground">—</span>;

    if (days <= 1) {
      return (
        <StatusPill tone="danger">
          <AlertTriangle className="h-3 w-3" />
          Expires in {days} day{days !== 1 ? "s" : ""}
        </StatusPill>
      );
    } else if (days <= 3) {
      return (
        <StatusPill tone="warn">
          <Clock className="h-3 w-3" />
          Expires in {days} days
        </StatusPill>
      );
    }
    return (
      <StatusPill tone="neutral">
        <Clock className="h-3 w-3" />
        {days} days left
      </StatusPill>
    );
  };

  const getVehicleName = (booking: PendingBooking) => {
    if (booking.vehicle?.make && booking.vehicle?.model) {
      return `${booking.vehicle.make} ${booking.vehicle.model}`;
    }
    return booking.vehicle?.reg || "Unknown Vehicle";
  };

  const getVerificationPill = (status: string | null) => {
    switch (status) {
      case "verified":
      case "manually_verified":
        return (
          <StatusPill tone="success">
            <Shield className="h-3 w-3" />
            {status === "manually_verified" ? "Manually Verified" : "Verified"}
          </StatusPill>
        );
      case "pending":
        return (
          <StatusPill tone="warn">
            <Clock className="h-3 w-3" />
            Pending
          </StatusPill>
        );
      case "rejected":
        return (
          <StatusPill tone="danger">
            <XCircle className="h-3 w-3" />
            Rejected
          </StatusPill>
        );
      default:
        return <StatusPill tone="neutral">Not Verified</StatusPill>;
    }
  };

  const stats = useMemo(() => {
    const list = bookings ?? [];
    const expiringSoon = list.filter((b) => {
      const d = getDaysUntilExpiry(b.preauth_expires_at);
      return d !== null && d <= 3;
    }).length;
    const verified = list.filter((b) => {
      const s = b.customer?.identity_verification_status;
      return s === "verified" || s === "manually_verified";
    }).length;
    const totalValue = list.reduce((sum, b) => sum + (b.amount ?? 0), 0);
    return { total: list.length, expiringSoon, verified, totalValue };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings]);

  const headerActions = (
    <Button onClick={() => refetch()} variant="outline" size="sm">
      <RefreshCw className="h-4 w-4 mr-2" />
      Refresh
    </Button>
  );

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Pending Bookings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review and approve customer booking requests
          </p>
        </div>
        {headerActions}
      </div>

      {isLoading ? (
        <>
          <KpiTileSkeletonRow count={4} />
          <TableSkeleton rows={5} cols={7} />
        </>
      ) : error ? (
        <ErrorState
          title="Failed to load pending bookings"
          description="We couldn't fetch the booking requests. Please try again."
          onRetry={() => refetch()}
        />
      ) : (
        <>
          {/* Stat tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiTile
              variant="feature"
              label="Pending"
              value={stats.total}
              icon={<Inbox className="h-4 w-4" />}
            />
            <KpiTile
              variant={stats.expiringSoon > 0 ? "warn" : "default"}
              label="Expiring soon"
              value={stats.expiringSoon}
              icon={<Clock className="h-4 w-4" />}
            />
            <KpiTile
              label="Verified"
              value={stats.verified}
              icon={<Shield className="h-4 w-4" />}
            />
            <KpiTile
              label="Total value"
              value={stats.totalValue}
              format={(v) => <Money value={v} currency="USD" />}
            />
          </div>

          {bookings && bookings.length === 0 ? (
            <EmptyState
              icon={<CheckCircle className="h-5 w-5" />}
              title="All caught up!"
              description="No pending bookings require your attention right now."
              action={headerActions}
            />
          ) : (
            <TableTile>
              <Table>
                <TableHeader className={bentoTable.header}>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Verification</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookings?.map((booking) => (
                    <TableRow key={booking.id} className="border-border">
                      <TableCell>
                        <div className="flex items-start gap-2">
                          <User className="h-4 w-4 mt-1 text-muted-foreground" />
                          <div>
                            <p className="font-medium text-foreground">{booking.customer?.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {booking.customer?.email}
                            </p>
                            {booking.customer?.phone && (
                              <p className="text-sm text-muted-foreground font-mono tabular-nums">
                                {booking.customer.phone}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-start gap-2">
                          <Car className="h-4 w-4 mt-1 text-muted-foreground" />
                          <div>
                            <p className="font-medium text-foreground">{getVehicleName(booking)}</p>
                            <p className="text-sm text-muted-foreground font-mono">
                              {booking.vehicle?.reg}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-start gap-2">
                          <Calendar className="h-4 w-4 mt-1 text-muted-foreground" />
                          <div className="font-mono tabular-nums">
                            <p className="text-sm">
                              {booking.rental?.start_date &&
                                format(
                                  parseISO(booking.rental.start_date),
                                  "MMM dd, yyyy"
                                )}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              to{" "}
                              {booking.rental?.end_date &&
                                format(
                                  parseISO(booking.rental.end_date),
                                  "MMM dd, yyyy"
                                )}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Money
                          value={booking.amount ?? 0}
                          currency="USD"
                          className="font-semibold text-foreground"
                        />
                      </TableCell>
                      <TableCell>
                        {getVerificationPill(
                          booking.customer?.identity_verification_status
                        )}
                      </TableCell>
                      <TableCell>
                        {getExpiryPill(booking.preauth_expires_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {canEdit('pending_bookings') && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => {
                                  setSelectedBooking(booking);
                                  setShowRejectDialog(true);
                                }}
                                disabled={
                                  approveBooking.isPending || rejectBooking.isPending
                                }
                              >
                                <XCircle className="h-4 w-4 mr-1" />
                                Reject
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => {
                                  setSelectedBooking(booking);
                                  setShowApproveDialog(true);
                                }}
                                disabled={
                                  approveBooking.isPending || rejectBooking.isPending
                                }
                              >
                                <CheckCircle className="h-4 w-4 mr-1" />
                                Approve
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableTile>
          )}
        </>
      )}

      {/* Approve Confirmation Dialog */}
      <AlertDialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve Booking</AlertDialogTitle>
            <AlertDialogDescription>
              This will capture the payment of{" "}
              <strong>${selectedBooking?.amount?.toLocaleString()}</strong> from
              the customer's card and activate the rental.
              <br />
              <br />
              <strong>Customer:</strong> {selectedBooking?.customer?.name}
              <br />
              <strong>Vehicle:</strong>{" "}
              {selectedBooking && getVehicleName(selectedBooking)}
              <br />
              <strong>Dates:</strong>{" "}
              {selectedBooking?.rental?.start_date &&
                format(
                  parseISO(selectedBooking.rental.start_date),
                  "MMM dd, yyyy"
                )}{" "}
              -{" "}
              {selectedBooking?.rental?.end_date &&
                format(parseISO(selectedBooking.rental.end_date), "MMM dd, yyyy")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={approveBooking.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleApprove}
              disabled={approveBooking.isPending}
            >
              {approveBooking.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Approve & Capture Payment
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject Dialog with Reason */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Booking</DialogTitle>
            <DialogDescription>
              This will release the payment hold and cancel the booking. The
              customer will be notified.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="rounded-tile [background:var(--bento-tile-2)] p-4 text-sm">
              <p>
                <strong>Customer:</strong> {selectedBooking?.customer?.name}
              </p>
              <p>
                <strong>Amount to release:</strong>{" "}
                <Money
                  value={selectedBooking?.amount ?? 0}
                  currency="USD"
                  className="font-semibold"
                />
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reason">Rejection Reason (optional)</Label>
              <Textarea
                id="reason"
                placeholder="Enter a reason for rejection (this will be included in the customer notification)"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowRejectDialog(false);
                setRejectionReason("");
              }}
              disabled={rejectBooking.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={rejectBooking.isPending}
            >
              {rejectBooking.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 mr-2" />
                  Reject & Release Hold
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Rental Dialog with Refund Options */}
      {selectedBooking && selectedBooking.rental && (
        <CancelRentalDialog
          open={showCancelDialog}
          onOpenChange={setShowCancelDialog}
          rental={{
            id: selectedBooking.rental.id,
            customer: selectedBooking.customer,
            vehicle: selectedBooking.vehicle,
            monthly_amount: selectedBooking.amount,
          }}
          payment={{
            id: selectedBooking.id,
            amount: selectedBooking.amount,
            stripe_payment_intent_id: selectedBooking.stripe_payment_intent_id,
            capture_status: selectedBooking.capture_status,
          }}
        />
      )}
    </div>
  );
};

export default PendingBookings;
