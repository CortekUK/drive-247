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
