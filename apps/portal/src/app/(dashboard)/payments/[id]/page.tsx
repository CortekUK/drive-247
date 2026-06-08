"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowLeft, Calendar, CreditCard, Hash, User, Car, FileText, ExternalLink } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { formatCurrency } from "@/lib/format-utils";
import {
  Tile,
  KpiTile,
  StatusPill,
  Money,
  Eyebrow,
  ErrorState,
  Shimmer,
} from "@/components/bento";

interface PaymentDetailData {
  id: string;
  amount: number;
  payment_date: string;
  method: string;
  payment_type: string;
  status: string;
  remaining_amount: number;
  customers: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
  };
  vehicles?: {
    id: string;
    reg: string;
    make?: string;
    model?: string;
  };
  rentals?: {
    id: string;
    rental_number?: string;
  };
}

export default function PaymentDetail() {
  const params = useParams();
  const id = params?.id as string;
  const router = useRouter();
  const { tenant } = useTenant();

  const { data: payment, isLoading, error } = useQuery({
    queryKey: ["payment-detail", id, tenant?.id],
    queryFn: async () => {
      if (!id) throw new Error("Payment ID is required");
      if (!tenant?.id) throw new Error("No tenant context");

      const { data, error } = await supabase
        .from("payments")
        .select(`
          id,
          amount,
          payment_date,
          method,
          payment_type,
          status,
          remaining_amount,
          customers(
            id,
            name,
            email,
            phone
          ),
          vehicles(
            id,
            reg,
            make,
            model
          ),
          rentals(
            id,
            rental_number
          )
        `)
        .eq("tenant_id", tenant.id)
        .eq("id", id)
        .single();

      if (error) throw error;
      if (!data.customers) throw new Error("Payment customer not found");
      return data as PaymentDetailData;
    },
    enabled: !!id && !!tenant?.id,
  });

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <Shimmer className="h-9 w-56" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Tile key={i} noMotion className="flex flex-col gap-3">
              <Shimmer className="h-3 w-20" />
              <Shimmer className="h-8 w-24" />
            </Tile>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Shimmer key={i} className="h-40" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !payment) {
    return (
      <div className="container mx-auto p-6">
        <ErrorState
          title="Payment Not Found"
          description="The payment you're looking for doesn't exist or you don't have permission to view it."
          onRetry={() => router.push("/payments")}
        />
      </div>
    );
  }

  const paymentStatus = payment.status || "Applied";
  const isFullyAllocated = (payment.remaining_amount || 0) === 0;
  const currencyCode = tenant?.currency_code || 'USD';

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-4">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={() => router.push("/payments")}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Back to Payments</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <div>
            <Eyebrow>Payment</Eyebrow>
            <h1 className="text-2xl font-extrabold tracking-tight">Payment Details</h1>
            <p className="text-muted-foreground text-sm">
              Reference:{" "}
              <span className="font-mono">{payment.id.slice(0, 8).toUpperCase()}</span>
            </p>
          </div>
        </div>
        <StatusPill tone={isFullyAllocated ? "success" : "warn"} dot>
          {isFullyAllocated ? "Fully Allocated" : "Has Credit"}
        </StatusPill>
      </div>

      {/* Payment Summary — KPI strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          label="Amount"
          value={payment.amount}
          format={(v) => formatCurrency(v, currencyCode)}
          variant="feature"
          icon={<CreditCard className="h-4 w-4" />}
        />
        <Tile className="flex flex-col gap-2">
          <Eyebrow>Payment Date</Eyebrow>
          <div className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono tabular-nums">
              {formatInTimeZone(new Date(payment.payment_date), 'America/New_York', 'MM/dd/yyyy')}
            </span>
          </div>
        </Tile>
        <Tile className="flex flex-col gap-2">
          <Eyebrow>Method</Eyebrow>
          <div className="text-lg font-bold tracking-tight">
            {payment.method ? payment.method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Not specified'}
          </div>
        </Tile>
        <Tile className="flex flex-col gap-2">
          <Eyebrow>Type</Eyebrow>
          <div className="text-lg font-bold tracking-tight">{payment.payment_type}</div>
        </Tile>
      </div>

      {/* Related Entities */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Customer */}
        <Tile className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-base font-bold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-full [background:var(--bento-primary-weak)] text-[color:var(--bento-primary-weak-fg)]">
              <User className="h-4 w-4" />
            </span>
            Customer
          </div>
          <div className="space-y-2">
            <div className="font-semibold">{payment.customers.name}</div>
            {payment.customers.email && (
              <div className="text-sm text-muted-foreground">{payment.customers.email}</div>
            )}
            {payment.customers.phone && (
              <div className="text-sm text-muted-foreground font-mono">{payment.customers.phone}</div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/customers/${payment.customers.id}`)}
              className="w-full mt-2 gap-2"
            >
              <ExternalLink className="h-3 w-3" />
              View Customer
            </Button>
          </div>
        </Tile>

        {/* Vehicle */}
        {payment.vehicles && (
          <Tile className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-base font-bold tracking-tight">
              <span className="flex h-8 w-8 items-center justify-center rounded-full [background:var(--bento-primary-weak)] text-[color:var(--bento-primary-weak-fg)]">
                <Car className="h-4 w-4" />
              </span>
              Vehicle
            </div>
            <div className="space-y-2">
              <div className="font-semibold font-mono">{payment.vehicles.reg}</div>
              {payment.vehicles.make && payment.vehicles.model && (
                <div className="text-sm text-muted-foreground">
                  {payment.vehicles.make} {payment.vehicles.model}
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/vehicles/${payment.vehicles!.id}`)}
                className="w-full mt-2 gap-2"
              >
                <ExternalLink className="h-3 w-3" />
                View Vehicle
              </Button>
            </div>
          </Tile>
        )}

        {/* Rental */}
        {payment.rentals && (
          <Tile className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-base font-bold tracking-tight">
              <span className="flex h-8 w-8 items-center justify-center rounded-full [background:var(--bento-primary-weak)] text-[color:var(--bento-primary-weak-fg)]">
                <FileText className="h-4 w-4" />
              </span>
              Rental Agreement
            </div>
            <div className="space-y-2">
              <div className="font-semibold font-mono">
                {payment.rentals.rental_number || `Rental #${payment.rentals.id.slice(0, 8)}`}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/rentals/${payment.rentals!.id}`)}
                className="w-full mt-2 gap-2"
              >
                <ExternalLink className="h-3 w-3" />
                View Rental
              </Button>
            </div>
          </Tile>
        )}
      </div>

      {/* System Information */}
      <Tile className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-base font-bold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-full [background:var(--bento-tile-2)] text-[color:var(--bento-text-2)]">
            <Hash className="h-4 w-4" />
          </span>
          System Information
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Payment ID:</span>
          <Money className="text-foreground">{payment.id}</Money>
        </div>
      </Tile>
    </div>
  );
}
