"use client";

import { useState, type ReactNode } from "react";
import { format, differenceInDays, parseISO } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
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
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useV2 } from "@/lib/v2-context";
import { PendingBookingsTableV2 } from "@/components/fleet-v2/pending-bookings-table-v2";
import { HEADER_ACTIONS_V2, HeaderIconButton } from "@/components/shared/header-icon-button-v2";
import { useTenant } from "@/contexts/TenantContext";
import { useIsLean } from "@/lib/lean-context";
import { useForcedEmptyState } from "@/hooks/use-forced-empty-state";
import { bookingOriginFor } from "@/lib/booking-origin";
import { PendingBookingsTeachingEmptyState } from "@/components/empty-states/pending-bookings-empty-state";
import { AutoSkeleton } from "@/components/skeleton-v2/auto-skeleton";
import { skeletonRows } from "@/lib/skeleton-data";
import { useSkeletonLoading } from "@/hooks/use-skeleton-loading";

/** Placeholder bookings for the v2 skeleton: only their shapes are ever seen. */
const SKELETON_BOOKINGS: PendingBooking[] = skeletonRows(6, (f) => ({
  id: f.id,
  rental_id: f.id,
  customer_id: f.id,
  vehicle_id: f.id,
  amount: f.money(100, 3000),
  payment_date: f.date(),
  stripe_payment_intent_id: null,
  stripe_checkout_session_id: null,
  capture_status: "requires_capture",
  preauth_expires_at: f.date(-f.int(1, 6)),
  created_at: f.date(),
  customer: {
    id: f.id,
    name: f.text(2, 3),
    email: `${f.word(6, 10)}@${f.word(5, 8)}.com`,
    phone: null,
    identity_verification_status: f.pick(["verified", "pending", null]),
  },
  rental: {
    id: f.id,
    start_date: f.date(-f.int(1, 20)).slice(0, 10),
    end_date: f.date(-f.int(21, 40)).slice(0, 10),
    rental_period_type: "Daily",
    status: "Pending",
  },
  vehicle: { id: f.id, reg: f.word(6, 8), make: f.word(4, 8), model: f.word(3, 7), colour: null },
}));

/** v1's stand-in for <AutoSkeleton>: renders the region as it always was. */
function PlainRegion({ children }: { loading: boolean; className?: string; children: ReactNode }) {
  return <>{children}</>;
}

const PendingBookings = () => {
  const { data: loadedBookings, isLoading: bookingsLoading, error, refetch } = usePendingBookings();
  const approveBooking = useApproveBooking();
  const rejectBooking = useRejectBooking();
  const { canEdit } = useManagerPermissions();
  // v2 chrome (canary tenants only; fails closed to v1). Above the early returns
  // below, as every hook must be.
  const v2Chrome = useV2("chrome");
  // v2: while the list loads, the page renders placeholder bookings through its
  // real table and <AutoSkeleton> turns that into the skeleton. v1 keeps its
  // spinner below, on the real loading flag.
  const skeletonLoading = useSkeletonLoading(bookingsLoading);
  const isLoading = v2Chrome ? skeletonLoading : bookingsLoading;
  const bookings = v2Chrome && isLoading ? SKELETON_BOOKINGS : loadedBookings;
  // Teaching empty state (illustration-guide §4a): lean tenants only, and only
  // when there are no pending bookings at all (this page has no filters, so the
  // loaded list IS the unfiltered count) — or the /dev force switch, which sits
  // inside the lean gate. Everyone else keeps "All caught up!".
  const { tenantSlug } = useTenant();
  const leanTenant = useIsLean();
  const devForceEmpty = useForcedEmptyState("pending-bookings");
  const teachEmptyPending = !isLoading && leanTenant && ((bookings !== undefined && bookings.length === 0) || devForceEmpty);

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
      case "manually_verified":
        return (
          <Badge className="bg-green-100 text-green-800 flex items-center gap-1">
            <Shield className="h-3 w-3" />
            {status === "manually_verified" ? "Manually Verified" : "Verified"}
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

  if (isLoading && !v2Chrome) {
    // v2 (switch row alignment): the loaded page's 24px top padding at md, so this
    // state starts where the title does (y=74) instead of at y=50 under the 64px
    // top bar. v1 renders the same classes as before.
    return (
      <div className={`flex items-center justify-center h-64${v2Chrome ? " md:mt-6" : ""}`}>
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // v2 wraps the list in the auto skeleton; v1's markup stays exactly as it was.
  const SkeletonRegion = v2Chrome ? AutoSkeleton : PlainRegion;

  if (error) {
    // v2 (switch row alignment): the loaded page's 24px top padding at md, so this
    // state starts where the title does (y=74) instead of at y=50 under the 64px
    // top bar. v1 renders the same classes as before.
    return (
      <Card className={v2Chrome ? "md:mt-6" : undefined}>
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
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Pending Bookings</h1>
          <p className="text-muted-foreground">
            Review and approve customer booking requests
          </p>
        </div>
        {teachEmptyPending ? null : v2Chrome ? (
          // v2: Refresh is not a main action, so it is a 32px round icon, centred
          // on the subtitle line (team lead Sep 15-16 2026). The subtitle inherits
          // the body size, which v2 sets to 16px/24px below 769px and 14px/20px
          // above, so the box follows it: h-6 from sm, h-5 from md.
          <div className={`flex items-center gap-2 ${HEADER_ACTIONS_V2} md:h-5`}>
            <HeaderIconButton label="Refresh" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </HeaderIconButton>
          </div>
        ) : (
        <Button onClick={() => refetch()} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
        )}
      </div>

      <SkeletonRegion loading={isLoading}>
      {teachEmptyPending ? (
        <PendingBookingsTeachingEmptyState
          onOpenBookingSite={
            tenantSlug
              ? () => window.open(bookingOriginFor(tenantSlug), "_blank", "noopener,noreferrer")
              : undefined
          }
        />
      ) : bookings && bookings.length === 0 ? (
        <div className="text-center py-12">
          <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
          <h3 className="text-lg font-semibold mb-2">All caught up!</h3>
          <p className="text-muted-foreground">No pending bookings require your attention.</p>
        </div>
      ) : (
        v2Chrome ? (
          // v2: the rentals list's table (components/fleet-v2), no pager. Its
          // Reject and Approve buttons run v1's exact bodies below: select the
          // booking and open the confirmation. Capture and release happen only
          // in those dialogs, through handleApprove and handleReject.
          <PendingBookingsTableV2
            bookings={bookings}
            canEdit={canEdit('pending_bookings')}
            actionsDisabled={approveBooking.isPending || rejectBooking.isPending}
            vehicleName={getVehicleName}
            daysUntilExpiry={getDaysUntilExpiry}
            onReject={(booking) => {
              setSelectedBooking(booking);
              setShowRejectDialog(true);
            }}
            onApprove={(booking) => {
              setSelectedBooking(booking);
              setShowApproveDialog(true);
            }}
          />
        ) : (
        <Card>
          <CardContent className="p-0">
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
                        {canEdit('pending_bookings') && (
                          <>
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
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        )
      )}
      </SkeletonRegion>

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
