"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Calendar, CreditCard, Hash, User, Car, FileText, ExternalLink } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";

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
      <div className="container mx-auto p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-muted rounded w-1/4"></div>
          <div className="h-64 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  if (error || !payment) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-destructive">Payment Not Found</h1>
          <p className="text-muted-foreground mt-2">
            The payment you're looking for doesn't exist or you don't have permission to view it.
          </p>
          <Button onClick={() => router.push("/payments")} className="mt-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Payments
          </Button>
        </div>
      </div>
    );
  }

  const paymentStatus = payment.status || "Applied";
  const isFullyAllocated = (payment.remaining_amount || 0) === 0;

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/payments")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Payments
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Payment Details</h1>
            <p className="text-muted-foreground">
              Payment reference: {payment.id.slice(0, 8).toUpperCase()}
            </p>
          </div>
        </div>
        <Badge variant={isFullyAllocated ? "default" : "secondary"}>
          {isFullyAllocated ? "Fully Allocated" : "Has Credit"}
        </Badge>
      </div>

      {/* Payment Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Payment Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <div className="text-sm text-muted-foreground">Amount</div>
              <div className="text-2xl font-bold">
                ${payment.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Payment Date</div>
              <div className="flex items-center gap-1">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                {formatInTimeZone(new Date(payment.payment_date), 'Europe/London', 'dd/MM/yyyy')}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Method</div>
              <div>{payment.method || 'Not specified'}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Type</div>
              <div>{payment.payment_type}</div>
            </div>
          </div>

        </CardContent>
      </Card>

      {/* Related Entities */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Customer */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4" />
              Customer
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="font-medium">{payment.customers.name}</div>
              {payment.customers.email && (
                <div className="text-sm text-muted-foreground">{payment.customers.email}</div>
              )}
              {payment.customers.phone && (
                <div className="text-sm text-muted-foreground">{payment.customers.phone}</div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/customers/${payment.customers.id}`)}
                className="w-full mt-2"
              >
                <ExternalLink className="h-3 w-3 mr-2" />
                View Customer
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Vehicle */}
        {payment.vehicles && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Car className="h-4 w-4" />
                Vehicle
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="font-medium">{payment.vehicles.reg}</div>
                {payment.vehicles.make && payment.vehicles.model && (
                  <div className="text-sm text-muted-foreground">
                    {payment.vehicles.make} {payment.vehicles.model}
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(`/vehicles/${payment.vehicles!.id}`)}
                  className="w-full mt-2"
                >
                  <ExternalLink className="h-3 w-3 mr-2" />
                  View Vehicle
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Rental */}
        {payment.rentals && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Rental Agreement
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="font-medium">
                  {payment.rentals.rental_number || `Rental #${payment.rentals.id.slice(0, 8)}`}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(`/rentals/${payment.rentals!.id}`)}
                  className="w-full mt-2"
                >
                  <ExternalLink className="h-3 w-3 mr-2" />
                  View Rental
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Payment ID */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Hash className="h-4 w-4" />
            System Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 font-mono text-sm">
            <span className="text-muted-foreground">Payment ID:</span>
            <span>{payment.id}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
