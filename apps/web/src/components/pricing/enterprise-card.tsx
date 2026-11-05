import { Button } from "@/components/ui/button";
import "./plan-cards.css";
import type { EnterpriseCard as EnterpriseCardData } from "@/lib/enterprise-card-server";

/**
 * The last card on the pricing grid: drawn like a PlanCard, but its button is a
 * link to a contact page, never a checkout. Edited on the admin Signup Plans page.
 */
export function EnterpriseCard({ card }: { card: EnterpriseCardData }) {
  return (
    <div className="pc-card is-night">
      <div>
        <p className="pc-name">{card.name}</p>
        {card.fleetBand && <p className="pc-band">{card.fleetBand}</p>}
      </div>
      <div className="pc-price">
        <span className="pc-amount">{card.priceLabel}</span>
      </div>
      <p className="pc-tagline">{card.tagline}</p>
      <Button asChild size="lg" className="pc-btn">
        <a href={card.ctaHref}>{card.ctaLabel}</a>
      </Button>
      {card.bullets.length > 0 ? (
        <ul className="pc-list">
          {card.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      ) : (
        <span />
      )}
    </div>
  );
}
