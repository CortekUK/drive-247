"use client";

/**
 * Referrals, before anyone has signed up with the operator's code (lean
 * tenants only — `components/referrals/referrals-view.tsx` decides when this
 * renders, and only once a code exists: without one there is nothing to share
 * and the normal page explains why).
 *
 * The code itself is not drawn on the page here, so the Copy tile's hover card
 * carries the link. No amounts in the copy: both sides' rewards are configured
 * per operator and come from the server.
 */

import { Gift, Link2, Mail } from "lucide-react";
import { TeachingEmptyState } from "@/components/empty-states/teaching-empty-state";
import { ReferralsEmptyArt } from "@/components/illustrations-v2/scenes/referrals";

export function ReferralsTeachingEmptyState({
  link,
  onCopyLink,
  onShareByEmail,
}: {
  link: string;
  onCopyLink: () => void;
  onShareByEmail: () => void;
}) {
  return (
    <TeachingEmptyState
      icon={Gift}
      illustration={<ReferralsEmptyArt />}
      headline="Your referral link is ready"
      body="Another rental operator who signs up with it saves on Drive247, and so do you."
      primaryAction={{
        label: "Copy your referral link",
        onClick: onCopyLink,
        icon: Link2,
        hint: link,
      }}
      secondaryAction={{
        label: "Share by email",
        onClick: onShareByEmail,
        icon: Mail,
        hint: "Opens an email with your link, ready to send.",
      }}
    />
  );
}
