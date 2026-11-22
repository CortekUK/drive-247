import { rateForPeriod, type FleetVehicle, type RatePeriod } from '@nw/components/fleet/fleet-vehicle';

/**
 * Template 2's price periods, and what renting longer saves, worked out from
 * the operator's own fleet. Shared by Fleet and Pricing (the period tiles) and
 * Promotions (the savings that apply with no offer running), so both pages
 * always quote the same numbers.
 */
export const PERIOD: Record<RatePeriod, { title: string; unit: string; days: number }> = {
  day: { title: 'By the day', unit: 'a day', days: 1 },
  week: { title: 'By the week', unit: 'a week', days: 7 },
  month: { title: 'By the month', unit: 'a month', days: 30 },
};

export interface PeriodTile {
  key: RatePeriod;
  /** The lowest price any car is offered at for this period. */
  lowest: number;
  /** That price, a day. */
  perDay: number;
  /**
   * The best saving a day, in whole percent, over renting the SAME car daily —
   * compared car by car, never cheapest week against cheapest day.
   */
  best: number;
}

/** One tile per period at least one car is offered for, in day/week/month order. */
export function periodTiles(cars: readonly FleetVehicle[]): PeriodTile[] {
  return (['day', 'week', 'month'] as const)
    .map((key) => {
      const prices = cars
        .map((car) => rateForPeriod(car, key))
        .filter((rate) => rate.offered && rate.amount != null && rate.amount > 0)
        .map((rate) => rate.amount as number);
      if (prices.length === 0) return null;
      const lowest = Math.min(...prices);
      const savings = cars
        .map((car) => {
          const rate = rateForPeriod(car, key);
          return rate.offered && rate.amount && car.dailyRent ? 1 - rate.amount / (PERIOD[key].days * car.dailyRent) : 0;
        })
        .filter((saving) => saving > 0);
      return { key, lowest, perDay: lowest / PERIOD[key].days, best: savings.length > 0 ? Math.round(Math.max(...savings) * 100) : 0 };
    })
    .filter((tile): tile is PeriodTile => tile !== null);
}
