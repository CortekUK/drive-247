"use client";

import { useState } from "react";
import { CheckCircle2, Clock, FileSignature, Loader2, Mail, RefreshCw, ShieldCheck, UserCheck, UserX, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useRentalAdditionalDrivers, type RentalAdditionalDriver } from "@/hooks/use-rental-additional-drivers";

interface AdditionalDriversCardProps {
  rentalId: string;
}

const verificationBadge = (status: RentalAdditionalDriver["verification_status"]) => {
  switch (status) {
    case "verified":
      return (
        <Badge className="bg-green-100 text-green-700 border-green-200 gap-1">
          <ShieldCheck className="h-3 w-3" />
          Verified
        </Badge>
      );
    case "pending":
      return (
        <Badge className="bg-amber-100 text-amber-700 border-amber-200 gap-1">
          <Clock className="h-3 w-3" />
          Awaiting Verification
        </Badge>
      );
    case "rejected":
      return (
        <Badge className="bg-red-100 text-red-700 border-red-200 gap-1">
          <UserX className="h-3 w-3" />
          Rejected
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="gap-1">
          <UserCheck className="h-3 w-3" />
          Not Started
        </Badge>
      );
  }
};

const signingBadge = (status: RentalAdditionalDriver["signing_status"]) => {
  switch (status) {
    case "signed":
      return (
        <Badge className="bg-green-100 text-green-700 border-green-200 gap-1">
          <CheckCircle2 className="h-3 w-3" />
          Signed
        </Badge>
      );
    case "sent":
      return (
        <Badge className="bg-blue-100 text-blue-700 border-blue-200 gap-1">
          <Mail className="h-3 w-3" />
          Awaiting Signature
        </Badge>
      );
    case "declined":
      return (
        <Badge className="bg-red-100 text-red-700 border-red-200 gap-1">
          <XCircle className="h-3 w-3" />
          Declined
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="gap-1">
          <FileSignature className="h-3 w-3" />
          Not Sent
        </Badge>
      );
  }
};

/**
 * Renders the additional drivers attached to a rental + per-driver actions.
 * Verification status updates live via the Veriff webhook → realtime channel.
 * Signing status updates live via the BoldSign webhook → realtime channel.
 */
export function AdditionalDriversCard({ rentalId }: AdditionalDriversCardProps) {
  const { toast } = useToast();
  const { data: drivers, isLoading } = useRentalAdditionalDrivers(rentalId);
  const [resending, setResending] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Additional Drivers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!drivers || drivers.length === 0) return null;

  const resendVerification = async (driver: RentalAdditionalDriver) => {
    if (!driver.email) {
      toast({
        title: "Cannot resend",
        description: "This driver has no email address on file.",
        variant: "destructive",
      });
      return;
    }
    setResending(driver.id);
    try {
      const { data, error } = await supabase.functions.invoke("send-additional-driver-invite", {
        body: { driver_id: driver.id },
      });
      if (error) throw error;
      if (data && (data as any).success === false) {
        throw new Error((data as any).error || "Failed to send invite");
      }
      toast({
        title: "Verification link sent",
        description: `Resent to ${driver.email}.`,
      });
    } catch (err) {
      toast({
        title: "Couldn't send verification link",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setResending(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">
          Additional Drivers
          <span className="ml-2 text-sm text-muted-foreground font-normal">
            {drivers.length} on this rental
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {drivers.map((driver) => (
          <div
            key={driver.id}
            className="rounded-lg border border-[#f1f5f9] bg-[#f8fafc] p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[#080812]">{driver.name}</p>
                <p className="text-xs text-[#737373] mt-0.5">
                  {[driver.email, driver.phone].filter(Boolean).join(" · ") || "No contact"}
                </p>
                {driver.license_number && (
                  <p className="text-xs text-[#737373] mt-0.5">
                    Licence: <span className="font-mono">{driver.license_number}</span>
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5 items-end">
                {verificationBadge(driver.verification_status)}
                {signingBadge(driver.signing_status)}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => resendVerification(driver)}
                disabled={!driver.email || resending === driver.id || driver.verification_status === "verified"}
              >
                {resending === driver.id ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Sending…
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    {driver.verification_status === "unverified" || driver.verification_status === "rejected"
                      ? "Send Verification Link"
                      : "Resend Verification Link"}
                  </>
                )}
              </Button>
              {driver.verification_url && (
                <Button asChild type="button" variant="ghost" size="sm">
                  <a href={driver.verification_url} target="_blank" rel="noopener noreferrer">
                    Open Verification URL
                  </a>
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
