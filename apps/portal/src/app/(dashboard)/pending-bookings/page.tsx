"use client";

import { useState } from "react";
import { format, differenceInDays, parseISO } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  DollarSign,
  Shield,
  RefreshCw,
} from "lucide-react";
import { usePendingBookings, PendingBooking } from "@/hooks/use-pending-bookings";
import { useApproveBooking, useRejectBooking } from "@/hooks/use-booking-approval";
import { CancelRentalDialog } from "@/components/shared/dialogs/cancel-rental-dialog";

const PendingBookings = () => {
  const { data: bookings, isLoading, error, refetch } = usePendingBookings();
  const approveBooking = useApproveBooking();
  const rejectBooking = useRejectBooking();

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

  const getExpiryBadge = (expiresAt: string | null) => {
    const days = getDaysUntilExpiry(expiresAt);
    if (days === null) return null;

    if (days <= 1) {
      return (
        <Badge variant="destructive" className="flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          Expires in {days} day{days !== 1 ? "s" : ""}
        </Badge>
      );
    } else if (days <= 3) {
      return (
        <Badge
          variant="outline"
          className="border-amber-500 text-amber-600 flex items-center gap-1"
        >
          <Clock className="h-3 w-3" />
          Expires in {days} days
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="flex items-center gap-1">
        <Clock className="h-3 w-3" />
        {days} days left
      </Badge>
    );
  };

  const getVehicleName = (booking: PendingBooking) => {
    if (booking.vehicle?.make && booking.vehicle?.model) {
      return `${booking.vehicle.make} ${booking.vehicle.model}`;
    }
    return booking.vehicle?.reg || "Unknown Vehicle";
  };

  const getVerificationBadge = (status: string | null) => {
    switch (status) {
      case "verified":
        return (
          <Badge className="bg-green-100 text-green-800 flex items-center gap-1">
            <Shield className="h-3 w-3" />
            Verified
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="outline" className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Pending
          </Badge>
        );
      case "rejected":
        return (
          <Badge variant="destructive" className="flex items-center gap-1">
            <XCircle className="h-3 w-3" />
            Rejected
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="flex items-center gap-1">
            Not Verified
          </Badge>
        );
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center text-destructive">
            <AlertTriangle className="h-12 w-12 mx-auto mb-4" />
            <p>Failed to load pending bookings</p>
            <Button onClick={() => refetch()} variant="outline" className="mt-4">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Pending Bookings</h1>
          <p className="text-muted-foreground">
            Review and approve customer booking requests
          </p>
        </div>
        <Button onClick={() => refetch()} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {bookings && bookings.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
              <h3 className="text-lg font-semibold mb-2">All caught up!</h3>
              <p>No pending bookings require your attention.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Awaiting Approval ({bookings?.length || 0})
            </CardTitle>
            <CardDescription>
              These bookings have pre-authorized payment holds. Approve to
              capture payment or reject to release the hold.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
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
                  <TableRow key={booking.id}>
                    <TableCell>
                      <div className="flex items-start gap-2">
                        <User className="h-4 w-4 mt-1 text-muted-foreground" />
                        <div>
                          <p className="font-medium">{booking.customer?.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {booking.customer?.email}
                          </p>
                          {booking.customer?.phone && (
                            <p className="text-sm text-muted-foreground">
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
                          <p className="font-medium">{getVehicleName(booking)}</p>
                          <p className="text-sm text-muted-foreground">
                            {booking.vehicle?.reg}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-start gap-2">
                        <Calendar className="h-4 w-4 mt-1 text-muted-foreground" />
                        <div>
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
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                        <span className="font-semibold">
                          ${booking.amount?.toLocaleString()}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {getVerificationBadge(
                        booking.customer?.identity_verification_status
                      )}
                    </TableCell>
                    <TableCell>
                      {getExpiryBadge(booking.preauth_expires_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
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
                          className="bg-green-600 hover:bg-green-700"
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
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
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
              className="bg-green-600 hover:bg-green-700"
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
            <div className="bg-muted p-4 rounded-lg text-sm">
              <p>
                <strong>Customer:</strong> {selectedBooking?.customer?.name}
              </p>
              <p>
                <strong>Amount to release:</strong> $
                {selectedBooking?.amount?.toLocaleString()}
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
