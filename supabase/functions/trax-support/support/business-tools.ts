import { object, onlyKeys, SupportError } from './types.ts';
import type { OperationalResult } from './operational-types.ts';
import { authorizedDatasets, authorizedMetrics, parseSpec, runBusinessQuery, type BusinessContext } from './business-query.ts';
import { canView } from './auth.ts';
import { BALANCE_DEFINITION } from './balance-tools.ts';
import { BUSINESS_CATALOG } from './business-catalog.ts';

/**
 * The two tools that let TRAX answer a data question with the data.
 *
 * `discover_business_data` tells the model what this particular caller may ask
 * about — the datasets their role can read, with each dataset's metrics, the
 * fields it can filter or group by, and which business date a period uses. It
 * returns descriptions only: no records, no counts, no totals.
 *
 * `query_business_data` runs one validated request and returns the computed
 * answer with its definition, period and scope. Everything it can reach is in
 * the catalog; everything it returns was measured in the backend.
 */

function discoverBusinessData(input: unknown, env: BusinessContext): OperationalResult {
  const args = object(input);
  onlyKeys(args, ['dataset']);
  const datasets = authorizedDatasets(env.auth, env.financeScopes).filter((dataset) => args.dataset == null || dataset.name === args.dataset);
  const observedAt = new Date(env.now).toISOString();
  return {
    status: datasets.length ? 'verified' : 'restricted',
    observedAt,
    checks: ['business_catalog'],
    findings: [],
    sources: [{ id: `business_catalog:${BUSINESS_CATALOG.version}`, table: 'business_query', title: 'Authorized business datasets', observedAt }],
    navigation: [],
    limitations: datasets.length ? [] : ['Your role cannot read any business dataset, so no figures can be produced.'],
    data: {
      catalogVersion: BUSINESS_CATALOG.version,
      // Capabilities that are not a single-table sum, so they have their own tool.
      derived: derivedCapabilities(env),
      datasets: datasets.map((dataset) => ({
        dataset: dataset.name, title: dataset.title, meaning: dataset.meaning,
        metrics: authorizedMetrics(dataset, env.financeScopes).map((metric) => ({ metric: metric.name, label: metric.label, definition: metric.definition, perCurrency: metric.currency === 'per_currency' })),
        fields: dataset.fields.map((field) => ({ field: field.name, label: field.label, kind: field.kind, values: field.values, groupable: !!field.groupable, meaning: field.meaning })),
        periods: dataset.dateBases.map((basis) => ({ basis: basis.name, meaning: basis.meaning })),
        alwaysApplied: (dataset.requiredFilters ?? []).map((required) => required.because),
      })),
    },
  };
}

async function queryBusinessData(input: unknown, env: BusinessContext): Promise<OperationalResult> {
  const spec = parseSpec(input);
  return await runBusinessQuery(spec, env);
}

export const BUSINESS_TOOLS = Object.freeze({
  discover_business_data: discoverBusinessData,
  query_business_data: queryBusinessData,
});


/**
 * Composite figures that cannot be expressed as one dataset and one metric, so
 * they have a dedicated tool. Listed here with the same honesty as a dataset: if
 * the caller may not read it, it is not offered.
 */
function derivedCapabilities(env: BusinessContext) {
  const capabilities: { tool: string; answers: string; definition: string; arguments: string[] }[] = [];
  if ((env.financeScopes ?? []).includes('rental_payments') && canView(env.auth, 'customers')) {
    capabilities.push({
      tool: 'query_customer_balances',
      answers: 'Who owes money, how much each customer owes, who owes the most, and one customer’s balance.',
      definition: BALANCE_DEFINITION,
      arguments: ['limit', 'minimumOwed', 'customerId', 'includeCredit'],
    });
  }
  return capabilities;
}

/** Which support issue a dataset question belongs to, for the escalation policy. */
export function businessTopic(dataset: unknown): 'fleet_counts' | 'bookings' | 'payments' | 'other' {
  switch (String(dataset)) {
    case 'vehicles': return 'fleet_counts';
    case 'rentals': return 'bookings';
    case 'payments': case 'invoices': return 'payments';
    default: return 'other';
  }
}

export function assertBusinessAvailable(env: Partial<BusinessContext>) {
  if (!env.business) throw new SupportError('business_unavailable', 'Business data queries are not configured in this environment.', 503);
}
