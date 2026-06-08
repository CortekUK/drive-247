"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { Loader2, MessageSquare, Mail, Phone, Car, CalendarDays, User, Trash2 } from "lucide-react";
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
import { SideSheet, Eyebrow } from "@/components/bento";
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
  // Cache the enquiry being deleted so the dialog can keep showing the
  // customer name even after we've closed the sheet (which unmounts the
  // sheet content and clears `enquiry`).
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const requestDelete = () => {
    if (!enquiry) return;
    setPendingDelete({ id: enquiry.id, name: enquiry.customer_name });
    // Close the sheet first so the AlertDialog isn't stacked behind it.
    onOpenChange(false);
    // Open the dialog after the sheet's close animation (~200ms) finishes.
    setTimeout(() => setConfirmDeleteOpen(true), 220);
  };

  const handleDelete = () => {
    if (!pendingDelete) return;
    deleteEnquiry.mutate(pendingDelete.id, {
      onSuccess: () => {
        setConfirmDeleteOpen(false);
        setPendingDelete(null);
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
    <>
      <SideSheet
        open={open}
        onOpenChange={onOpenChange}
        width="560px"
        title={enquiry ? `Enquiry from ${enquiry.customer_name}` : "Enquiry"}
        description={
          enquiry
            ? `Submitted ${safeDateTime(enquiry.created_at)} · ${enquiry.source.replace("_", " ")}`
            : undefined
        }
        footer={
          enquiry ? (
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="ghost"
                onClick={requestDelete}
                disabled={!editable || deleteEnquiry.isPending}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="w-4 h-4 mr-2" />
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
          ) : undefined
        }
      >
        {isLoading || !enquiry ? (
          <div className="flex items-center justify-center flex-1 py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
            <section className="space-y-3">
              <Eyebrow>Contact</Eyebrow>
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
                    className="text-primary hover:underline font-mono tabular-nums"
                    href={`tel:${enquiry.customer_phone}`}
                  >
                    {enquiry.customer_phone}
                  </a>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <Eyebrow>Request</Eyebrow>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Car className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span>
                    {vehicleLabel}
                    {enquiry.vehicle?.reg && (
                      <span className="text-muted-foreground font-mono"> · {enquiry.vehicle.reg}</span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="font-mono tabular-nums">
                    {safeDate(enquiry.start_date)} → {safeDate(enquiry.end_date)}
                  </span>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <Eyebrow>Message</Eyebrow>
              <p className="text-sm whitespace-pre-wrap leading-relaxed text-[color:var(--bento-text-2)]">
                {enquiry.description}
              </p>
            </section>

            {enquiry.customer_id && (
              <p className="text-xs text-muted-foreground italic">
                Linked to existing customer record.
              </p>
            )}

            <section className="space-y-2">
              <Eyebrow>Status</Eyebrow>
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
        )}
      </SideSheet>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this enquiry?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the enquiry
              {pendingDelete?.name ? ` from ${pendingDelete.name}` : ""}.
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
  );
}
