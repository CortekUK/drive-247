import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUSINESS_CATALOG, type Dataset } from '../../../../../supabase/functions/trax-support/support/business-catalog';

/*
 * The catalog against the real schema.
 *
 * docs/trax/generated/schema-snapshot.json holds the column types of the tables
 * the catalog reads, generated from the deployed database by
 * scripts/trax-schema-snapshot.mjs. Every column the catalog names must exist
 * there, with a type that matches how the catalog treats it.
 *
 * Without this, a dataset can name a column that does not exist and the mistake
 * only surfaces as a failed query in front of a tenant. With it, the catalog and
 * the database disagree in CI instead.
 */
const snapshot = JSON.parse(readFileSync(
  resolve(__dirname, '../../../../../docs/trax/generated/schema-snapshot.json'), 'utf8',
)) as { readAt: string; tables: Record<string, Record<string, string>> };

const datasets = BUSINESS_CATALOG.datasets;
const columnsOf = (dataset: Dataset) => snapshot.tables[dataset.table];

/** How the catalog's field kinds may map onto stored types. */
const ACCEPTS: Record<string, RegExp> = {
  text: /^(text|character varying|character|uuid|USER-DEFINED)$/,
  uuid: /^uuid$/,
  number: /^(integer|bigint|smallint|numeric|double precision|real)$/,
  money: /^(numeric|integer|bigint)$/,
  date: /^date$/,
  timestamp: /^timestamp with time zone|timestamp without time zone$/,
  boolean: /^boolean$/,
  enum: /^(text|character varying|USER-DEFINED)$/,
};

describe('every catalog dataset describes a real table', () => {
  it('names a table present in the snapshot', () => {
    const missing = datasets.filter((dataset) => !columnsOf(dataset)).map((d) => `${d.name} -> ${d.table}`);
    expect(missing, `regenerate the snapshot, or fix the table name: ${missing.join(', ')}`).toEqual([]);
  });

  it.each(datasets.map((d) => [d.name, d] as const))('%s: every column it names exists', (_name, dataset) => {
    const columns = columnsOf(dataset);
    const unknown: string[] = [];
    const check = (column: string | undefined, where: string) => {
      if (!column) return;
      if (!(column in columns)) unknown.push(`${where}: ${dataset.table}.${column}`);
    };
    check(dataset.tenantColumn, 'tenantColumn');
    check(dataset.currencyColumn, 'currencyColumn');
    for (const field of dataset.fields) check(field.column, `field ${field.name}`);
    for (const basis of dataset.dateBases) check(basis.column, `dateBasis ${basis.name}`);
    for (const metric of dataset.metrics) {
      check(metric.column, `metric ${metric.name}`);
      check(metric.subtractColumn, `metric ${metric.name} subtract`);
      check(metric.exclude?.column, `metric ${metric.name} exclude`);
      check(metric.require?.column, `metric ${metric.name} require`);
    }
    for (const required of dataset.requiredFilters ?? []) check(required.column, `requiredFilter`);
    for (const link of dataset.links) check(link.column, `link ${link.name}`);
    expect(unknown).toEqual([]);
  });

  it.each(datasets.map((d) => [d.name, d] as const))('%s: field kinds match the stored types', (_name, dataset) => {
    const columns = columnsOf(dataset);
    const wrong: string[] = [];
    for (const field of dataset.fields) {
      const stored = columns[field.column];
      if (!stored) continue;
      if (!ACCEPTS[field.kind].test(stored)) wrong.push(`${field.name} is ${field.kind} but ${dataset.table}.${field.column} is ${stored}`);
    }
    expect(wrong).toEqual([]);
  });

  it.each(datasets.map((d) => [d.name, d] as const))('%s: summed columns are numeric', (_name, dataset) => {
    const columns = columnsOf(dataset);
    const wrong: string[] = [];
    for (const metric of dataset.metrics) {
      if (metric.kind !== 'sum' || !metric.column) continue;
      const stored = columns[metric.column];
      if (!stored) continue;
      if (!/^(numeric|integer|bigint|smallint|double precision|real)$/.test(stored)) {
        wrong.push(`${metric.name} sums ${dataset.table}.${metric.column} of type ${stored}`);
      }
      // Units only matter for money. A money column stored as an integer is cents
      // and a decimal one is major units; getting that backwards is a hundredfold
      // error, so it is asserted both ways. A non-money sum (days) is a plain
      // quantity and carries no unit flag.
      const isMoney = metric.currency === 'per_currency';
      if (isMoney && /^(integer|bigint|smallint)$/.test(stored) && !metric.minorUnits) {
        wrong.push(`${metric.name} sums integer money column ${metric.column} without minorUnits`);
      }
      if (isMoney && metric.minorUnits && /^(numeric|double precision|real)$/.test(stored)) {
        wrong.push(`${metric.name} marks decimal column ${metric.column} as minorUnits`);
      }
      if (!isMoney && metric.minorUnits) {
        wrong.push(`${metric.name} is not money but claims minorUnits`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('the catalog is internally consistent', () => {
  it('has unique dataset names, and unique field and metric names within each', () => {
    expect(new Set(datasets.map((d) => d.name)).size).toBe(datasets.length);
    for (const dataset of datasets) {
      expect(new Set(dataset.fields.map((f) => f.name)).size, `${dataset.name} fields`).toBe(dataset.fields.length);
      expect(new Set(dataset.metrics.map((m) => m.name)).size, `${dataset.name} metrics`).toBe(dataset.metrics.length);
      expect(new Set(dataset.dateBases.map((b) => b.name)).size, `${dataset.name} dateBases`).toBe(dataset.dateBases.length);
    }
  });

  it('points every metric dateBasis at a declared basis', () => {
    const wrong: string[] = [];
    for (const dataset of datasets) {
      const names = new Set(dataset.dateBases.map((b) => b.name));
      for (const metric of dataset.metrics) {
        if (metric.dateBasis && !names.has(metric.dateBasis)) wrong.push(`${dataset.name}.${metric.name} -> ${metric.dateBasis}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('points every link at a dataset that exists', () => {
    const names = new Set(datasets.map((d) => d.name));
    const wrong: string[] = [];
    for (const dataset of datasets) {
      for (const link of dataset.links) if (!names.has(link.dataset)) wrong.push(`${dataset.name} -> ${link.dataset}`);
    }
    expect(wrong).toEqual([]);
  });

  it('gives every money metric a currency, and every count none', () => {
    const wrong: string[] = [];
    for (const dataset of datasets) {
      for (const metric of dataset.metrics) {
        if (metric.kind === 'count' && metric.currency !== 'none') wrong.push(`${dataset.name}.${metric.name} counts but claims a currency`);
        if (metric.kind === 'sum' && metric.currency === 'per_currency' && !dataset.currencySource) {
          wrong.push(`${dataset.name}.${metric.name} is per-currency but the dataset says where no currency comes from`);
        }
        if (dataset.currencySource === 'row' && !dataset.currencyColumn) wrong.push(`${dataset.name} says per-row currency with no column`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('explains itself: every dataset and metric carries a definition a reader can check', () => {
    for (const dataset of datasets) {
      expect(dataset.meaning.length, `${dataset.name} meaning`).toBeGreaterThan(40);
      expect(dataset.sources.length, `${dataset.name} sources`).toBeGreaterThan(0);
      for (const metric of dataset.metrics) {
        expect(metric.definition.length, `${dataset.name}.${metric.name} definition`).toBeGreaterThan(40);
      }
    }
  });

  it('gates money behind finance, at the dataset or the metric', () => {
    const wrong: string[] = [];
    for (const dataset of datasets) {
      for (const metric of dataset.metrics) {
        const isMoney = metric.kind === 'sum' && metric.currency === 'per_currency';
        if (isMoney && !dataset.financeScope && !metric.financeScope) {
          wrong.push(`${dataset.name}.${metric.name} reports money with no finance gate`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('never exposes an identifying document column', () => {
    // Verifications hold licence numbers, images and dates of birth. Counting a
    // verification is fine; reading someone's document number is not.
    const forbidden = /document_number|first_name|last_name|date_of_birth|address|face_image|selfie|document_front|document_back|ai_ocr|magic_link|verification_token|session_token/i;
    const exposed: string[] = [];
    for (const dataset of datasets) {
      for (const field of dataset.fields) if (forbidden.test(field.column)) exposed.push(`${dataset.name}.${field.column}`);
      for (const basis of dataset.dateBases) if (forbidden.test(basis.column)) exposed.push(`${dataset.name}.${basis.column}`);
    }
    expect(exposed).toEqual([]);
  });
});
