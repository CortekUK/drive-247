export const POSITIVE_TAGS = [
  "Great Customer",
  "Clean Return",
  "On Time",
  "Well Maintained",
] as const;

export const NEGATIVE_TAGS = [
  "Late Return",
  "Vehicle Damage",
  "Poor Communication",
  "Excessive Mileage",
  "Fuel Not Refilled",
  "Dirty Return",
  "No Show",
] as const;

export const ALL_TAGS = [...POSITIVE_TAGS, ...NEGATIVE_TAGS] as const;

export function getRatingColor(rating: number): string {
  if (rating >= 8) return "text-green-600";
  if (rating >= 5) return "text-amber-600";
  return "text-red-600";
}

export function getRatingBgColor(rating: number): string {
  if (rating >= 8) return "bg-green-600";
  if (rating >= 5) return "bg-amber-500";
  return "bg-red-500";
}

export function getSliderColor(rating: number): string {
  if (rating >= 8) return "bg-green-500";
  if (rating >= 5) return "bg-amber-500";
  return "bg-red-500";
}
