"use client";

/**
 * Promotions, before the first offer (lean tenants only —
 * `app/(dashboard)/promotions/page.tsx` decides when this renders).
 *
 * These are the advertised offers on the booking site's Promotions page (the
 * `promotions` table), NOT checkout promo codes — those live in Settings →
 * Promo codes. The copy says "shows on your booking site" and nothing about
 * checkout, because a promotion's code is display text there.
 */

import { Megaphone, Plus } from "lucide-react";
import { TeachingEmptyState } from "@/components/empty-states/teaching-empty-state";
import { PromotionsEmptyArt } from "@/components/illustrations-v2/scenes/promotions";

export function PromotionsTeachingEmptyState({ onCreatePromotion }: { onCreatePromotion: () => void }) {
  return (
    <TeachingEmptyState
      icon={Megaphone}
      illustration={<PromotionsEmptyArt />}
      headline="Offers your customers can see"
      body="Create an offer with a picture and dates. It shows on your booking site's Promotions page."
      primaryAction={{
        label: "Create a promotion",
        onClick: onCreatePromotion,
        icon: Plus,
        hint: "Set the discount, the dates and an optional code to show with it.",
      }}
    />
  );
}
