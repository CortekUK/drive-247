import { OfferPage } from "@/components/offer/offer-page";

export const dynamic = "force-dynamic";

export default async function OfferRoutePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <OfferPage shortCode={code} />;
}
