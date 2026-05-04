"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { Loader2, MessageSquare, Mail, Phone, Car, CalendarDays, User, Trash2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  useDeleteEnquiry,
  useEnquiry,
  useMarkEnquiryRead,
  useResolveEnquiryCustomer,
  useUpdateEnquiryStatus,
  type EnquiryStatus,
} from "@/hooks/use-enquiries";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";

interface EnquiryDetailDrawerProps {
  enquiryId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_OPTIONS: { value: EnquiryStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "resolved", label: "Resolved" },
];

function safeDate(s: string) {
  try {
    return format(parseISO(s), "PP");
  } catch {
    return s;
  }
}

function safeDateTime(s: string) {
  try {
    return format(parseISO(s), "PPp");
  } catch {
    return s;
  }
}

export function EnquiryDetailDrawer({ enquiryId, open, onOpenChange }: EnquiryDetailDrawerProps) {
  const router = useRouter();
  const { data: enquiry, isLoading } = useEnquiry(enquiryId);
  const markRead = useMarkEnquiryRead();
  const updateStatus = useUpdateEnquiryStatus();
  const resolveCustomer = useResolveEnquiryCustomer();
  const deleteEnquiry = useDeleteEnquiry();
  const { canEdit } = useManagerPermissions();
  const editable = canEdit("enquiries");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const handleDelete = () => {
    if (!enquiry) return;
    deleteEnquiry.mutate(enquiry.id, {
      onSuccess: () => {
        setConfirmDeleteOpen(false);
        onOpenChange(false);
      },
    });
  };

  // Mark as read when opened.
  useEffect(() => {
    if (open && enquiry && !enquiry.is_read) {
      markRead.mutate(enquiry.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, enquiry?.id]);

  const handleContact = async () => {
    if (!enquiry) return;
    try {
      const { customerId } = await resolveCustomer.mutateAsync(enquiry.id);
      if (enquiry.status === "new") {
        updateStatus.mutate({ id: enquiry.id, status: "contacted" });
      }
      onOpenChange(false);
      router.push(`/messages?customerId=${customerId}`);
    } catch {
      /* toast already shown by hook */
    }
  };

  const vehicleLabel = enquiry?.vehicle
    ? [enquiry.vehicle.make, enquiry.vehicle.model].filter(Boolean).join(" ") || enquiry.vehicle.reg
    : enquiry?.vehicle_id
      ? "Vehicle removed"
      : "Any vehicle";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl p-0 flex flex-col gap-0">
        {isLoading || !enquiry ? (
          <div className="flex items-center justify-center flex-1">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/60 space-y-1">
              <SheetTitle className="text-lg">Enquiry from {enquiry.customer_name}</SheetTitle>
              <SheetDescription className="text-xs">
                Submitted {safeDateTime(enquiry.created_at)} · {enquiry.source.replace("_", " ")}
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              <section className="space-y-3">
                <h3 className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
                  Contact
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span>{enquiry.customer_name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                    <a
                      className="text-primary hover:underline truncate"
                      href={`mailto:${enquiry.customer_email}`}
                    >
                      {enquiry.customer_email}
                    </a>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                    <a
                      className="text-primary hover:underline"
                      href={`tel:${enquiry.customer_phone}`}
                    >
                      {enquiry.customer_phone}
                    </a>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
                  Request
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Car className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span>
                      {vehicleLabel}
                      {enquiry.vehicle?.reg && (
                        <span className="text-muted-foreground"> · {enquiry.vehicle.reg}</span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span>
                      {safeDate(enquiry.start_date)} → {safeDate(enquiry.end_date)}
                    </span>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
                  Message
                </h3>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">
                  {enquiry.description}
                </p>
              </section>

              {enquiry.customer_id && (
                <p className="text-xs text-muted-foreground italic">
                  Linked to existing customer record.
                </p>
              )}

              <section className="space-y-2">
                <h3 className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
                  Status
                </h3>
                <Select
                  value={enquiry.status}
                  onValueChange={(v) =>
                    updateStatus.mutate({ id: enquiry.id, status: v as EnquiryStatus })
                  }
                  disabled={!editable || updateStatus.isPending}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </section>
            </div>

            <div className="px-6 py-4 border-t border-border/60 bg-muted/30 flex items-center justify-between gap-2">
              <Button
                variant="ghost"
                onClick={() => setConfirmDeleteOpen(true)}
                disabled={!editable || deleteEnquiry.isPending}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                {deleteEnquiry.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4 mr-2" />
                )}
                Delete
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
                <Button
                  onClick={handleContact}
                  disabled={!editable || resolveCustomer.isPending}
                >
                  {resolveCustomer.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <MessageSquare className="w-4 h-4 mr-2" />
                  )}
                  Contact via Messages
                </Button>
              </div>
            </div>

            <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this enquiry?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes the enquiry from {enquiry.customer_name}.
                    This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deleteEnquiry.isPending}>
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault();
                      handleDelete();
                    }}
                    disabled={deleteEnquiry.isPending}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {deleteEnquiry.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : null}
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
