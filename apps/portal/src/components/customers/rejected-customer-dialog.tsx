import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Mail,
  Phone,
  MessageSquare,
  User,
  Calendar,
  FileText,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
import { format } from "date-fns";

interface Customer {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  type?: string;
  customer_type?: string | null;
  status?: string | null;
  license_number?: string | null;
  id_number?: string | null;
  whatsapp_opt_in?: boolean | null;
  rejection_reason?: string | null;
  rejected_at?: string | null;
  rejected_by?: string | null;
  created_at?: string | null;
  nok_full_name?: string | null;
  nok_relationship?: string | null;
  nok_phone?: string | null;
  nok_email?: string | null;
  nok_address?: string | null;
}

interface RejectedCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: Customer | null;
  onApprove: () => void;
  isLoading?: boolean;
}

export function RejectedCustomerDialog({
  open,
  onOpenChange,
  customer,
  onApprove,
  isLoading = false,
}: RejectedCustomerDialogProps) {
  // Fetch the admin who rejected
  const { data: rejectedByAdmin } = useQuery({
    queryKey: ["app-user", customer?.rejected_by],
    queryFn: async () => {
      if (!customer?.rejected_by) return null;
      const { data, error } = await supabase
        .from("app_users")
        .select("name, email")
        .eq("id", customer.rejected_by)
        .single();
      if (error) return null;
      return data;
    },
    enabled: !!customer?.rejected_by,
  });

  if (!customer) return null;

  const customerType = customer.customer_type || "Individual";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-500" />
            Rejected Customer Details
          </DialogTitle>
          <DialogDescription>
            Review customer information and rejection details
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Customer Information Section */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Customer Information
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Name</p>
                <p className="font-medium">{customer.name}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Type</p>
                <Badge
                  variant="secondary"
                  className={
                    customerType === "Company"
                      ? "bg-blue-100 text-blue-800"
                      : "bg-purple-100 text-purple-800"
                  }
                >
                  {customerType}
                </Badge>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Email</p>
                <p className="text-sm">{customer.email || "—"}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Phone</p>
                <p className="text-sm">{customer.phone || "—"}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">License Number</p>
                <p className="text-sm font-mono">
                  {customer.license_number || "—"}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">ID Number</p>
                <p className="text-sm font-mono">
                  {customer.id_number || "—"}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Registered</p>
                <p className="text-sm">
                  {customer.created_at
                    ? format(new Date(customer.created_at), "dd MMM yyyy")
                    : "—"}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">WhatsApp</p>
                <p className="text-sm">
                  {customer.whatsapp_opt_in ? "Opted In" : "Not opted in"}
                </p>
              </div>
            </div>
          </div>

          <Separator />

          {/* Rejection Details Section */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-500" />
              Rejection Details
            </h4>
            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg p-4 space-y-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Reason</p>
                <p className="text-sm">
                  {customer.rejection_reason || "No reason provided"}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Rejected At</p>
                  <p className="text-sm">
                    {customer.rejected_at
                      ? format(
                          new Date(customer.rejected_at),
                          "dd MMM yyyy, HH:mm"
                        )
                      : "—"}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Rejected By</p>
                  <p className="text-sm">
                    {rejectedByAdmin?.name || rejectedByAdmin?.email || "—"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Next of Kin Section (if available) */}
          {(customer.nok_full_name ||
            customer.nok_phone ||
            customer.nok_email) && (
            <>
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Emergency Contact
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Name</p>
                    <p className="text-sm">{customer.nok_full_name || "—"}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Relationship</p>
                    <p className="text-sm">{customer.nok_relationship || "—"}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Phone</p>
                    <p className="text-sm">{customer.nok_phone || "—"}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Email</p>
                    <p className="text-sm">{customer.nok_email || "—"}</p>
                  </div>
                </div>
              </div>
              <Separator />
            </>
          )}

          {/* Contact Customer Section */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Contact Customer
            </h4>
            <div className="flex flex-wrap gap-2">
              {customer.email && (
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                >
                  <a href={`mailto:${customer.email}`}>
                    <Mail className="h-4 w-4 mr-2" />
                    Email
                  </a>
                </Button>
              )}
              {customer.phone && (
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                >
                  <a href={`tel:${customer.phone}`}>
                    <Phone className="h-4 w-4 mr-2" />
                    Call
                  </a>
                </Button>
              )}
              {customer.phone && customer.whatsapp_opt_in && (
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="text-green-600 border-green-200 hover:bg-green-50"
                >
                  <a
                    href={`https://wa.me/${customer.phone.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageSquare className="h-4 w-4 mr-2" />
                    WhatsApp
                  </a>
                </Button>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={onApprove}
            disabled={isLoading}
            className="bg-green-600 hover:bg-green-700"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            {isLoading ? "Approving..." : "Approve Customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
