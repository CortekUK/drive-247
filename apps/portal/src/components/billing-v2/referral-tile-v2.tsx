"use client";

import { useState } from "react";
import { AutoSkeleton } from "@/components/skeleton-v2/auto-skeleton";
import { useSkeletonLoading } from "@/hooks/use-skeleton-loading";
import { useReferrals } from "@/hooks/use-referrals";
import { ReferralsDialogV2 } from "@/components/billing-v2/referrals-dialog-v2";
import { ReferralCoupon3D } from "@/components/referrals/referral-coupon-3d";

/**
 * Billing's Referrals tile: the coupon, sitting at the foot of the first screen.
 * Beside the card on file, because the reward is money off this bill. The full
 * programme (tiers, who you referred, claims) stays on `/referrals`.
 */
export function ReferralTileV2({ readOnly }: { readOnly: boolean }) {
  const { data, isLoading: referralsLoading, error } = useReferrals();
  const isLoading = useSkeletonLoading(referralsLoading);
  const [open, setOpen] = useState(false);

  let body;
  if (isLoading) {
    // The real coupon, sized as it will be; it draws itself as one bone.
    body = (
      <AutoSkeleton loading>
        <ReferralCoupon3D code="XXXXXXXX" discountText="xx% off" durationText="xxx xxxx xxxxx xxxxxx" fit onOpen={() => undefined} actionLabel="View details" />
      </AutoSkeleton>
    );
  } else if (error || !data) {
    body = <p className="text-sm text-muted-foreground">We couldn&apos;t load your referrals right now.</p>;
  } else if (!data.enabled) {
    body = (
      <p className="text-sm text-muted-foreground">The referral programme isn&apos;t available on your account right now.</p>
    );
  } else {
    body = (
      <ReferralCoupon3D
        code={data.code?.code ?? null}
        discountText={data.refereeOffer?.discountText ?? null}
        durationText={data.refereeOffer?.durationText ?? null}
        fit
        onOpen={() => setOpen(true)}
        actionLabel="View details"
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col md:[container-type:size]">

      {/* Coupon and its button in ONE column exactly as wide as the coupon. */}
      <div className="flex h-full justify-center">
        <div className="flex w-full max-w-[440px] flex-col gap-4 md:w-fit md:max-w-none">
          {body}
        </div>
      </div>
      <ReferralsDialogV2 open={open} onOpenChange={setOpen} readOnly={readOnly} />
    </div>
  );
}
