// feat-003 driver verification: the one place the money math lives (spec 09.12).
// Pure: no Deno, network or database imports, so Vitest tests this exact file.
// All money is whole cents (spec 09.1).

export type ServiceKind = "free" | "premium";

export interface PriceListRow {
  key: string;
  kind: ServiceKind;
  provider_cost_cents: number;
  margin_cents: number;
  has_state_fee: boolean;
}

export interface ChargeParts {
  provider_cost_cents: number;
  state_fee_cents: number;
  margin_cents: number;
  total_cents: number;
}

function assertCents(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${what} must be a whole number of cents, 0 or more (got ${value})`);
  }
}

/**
 * What the company pays for one finished check (spec 09.2, 09.3).
 * Free checks are always 0. A premium check is the plain sum of its three parts, no rounding.
 */
export function chargeFor(
  row: Pick<PriceListRow, "kind" | "provider_cost_cents" | "margin_cents">,
  stateFeeCents: number,
): ChargeParts {
  if (row.kind === "free") {
    return { provider_cost_cents: 0, state_fee_cents: 0, margin_cents: 0, total_cents: 0 };
  }
  assertCents(row.provider_cost_cents, "provider_cost_cents");
  assertCents(row.margin_cents, "margin_cents");
  assertCents(stateFeeCents, "state_fee_cents");
  return {
    provider_cost_cents: row.provider_cost_cents,
    state_fee_cents: stateFeeCents,
    margin_cents: row.margin_cents,
    total_cents: row.provider_cost_cents + stateFeeCents + row.margin_cents,
  };
}

/** "$3.49" from 349. Always two places; "Free" is decided by the caller. */
export function formatCents(cents: number): string {
  assertCents(cents, "cents");
  const dollars = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  return `$${dollars.toLocaleString("en-US")}.${rest}`;
}

export interface DisplayTotal {
  /** The sum of everything that is known, in cents. */
  cents: number;
  /** True when a ticked check's state fee is not known yet, so the total is a lower bound. */
  from: boolean;
  /** What screen 1 shows after "For <name>: ". */
  label: string;
}

/**
 * The total shown above the Next button (spec 04.10 to 04.12).
 * `stateFees` maps a service key to the fee for the customer's known state, or is missing
 * the key when the state or its fee is not known. Never shows an exact total that may be wrong.
 */
export function displayTotal(
  rows: PriceListRow[],
  ticked: string[],
  stateFees: Record<string, number | undefined>,
): DisplayTotal {
  let cents = 0;
  let from = false;
  for (const key of ticked) {
    const row = rows.find((r) => r.key === key);
    if (!row || row.kind === "free") continue;
    let fee = 0;
    if (row.has_state_fee) {
      const known = stateFees[key];
      if (known === undefined) from = true;
      else fee = known;
    }
    cents += chargeFor(row, fee).total_cents;
  }
  const label = cents === 0 && !from ? "Free" : `${from ? "from " : ""}${formatCents(cents)}`;
  return { cents, from, label };
}
