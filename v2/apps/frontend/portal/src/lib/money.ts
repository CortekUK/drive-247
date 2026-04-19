// Invoices store amounts as INTEGER cents. This helper formats cents → display string.
export function formatCents(
  cents: number | null | undefined,
  currency = 'GBP',
): string {
  const value = (cents ?? 0) / 100;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
  }).format(value);
}

// Parse a user-entered pounds string (e.g. "250.00") to cents integer.
export function parseToCents(input: string): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

// Cents → pounds as string for input fields.
export function centsToInputValue(cents: number | null | undefined): string {
  if (cents == null) return '';
  return ((cents ?? 0) / 100).toFixed(2);
}
