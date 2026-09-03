import { describe, it, expect } from 'vitest';
import { injectAgreementClauses } from '@/lib/agreement-injection';

const TPL = [
"<h1>Rental Agreement</h1>",
"<h2>Vehicle Details</h2>","<table>","<tr><td><strong>Reg</strong></td><td>{{vehicle_reg}}</td></tr>","</table>",
"<p><strong>By signing below, the Customer acknowledges the terms.</strong></p>",
"<p><strong>Customer Signature:</strong> ____</p>"].join("\n");

const sections = (html: string) => {
  const heads = [...html.matchAll(/<h2>(.*?)<\/h2>/g)].map(m => m[1]);
  const tables = [...html.matchAll(/<table>([\s\S]*?)<\/table>/g)].map(m => m[1]);
  return { heads, tables };
};

describe('mileage vs handover-times injection ordering', () => {
  it('keeps mileage rows in Vehicle Details, not in the new times table', () => {
    const out = injectAgreementClauses(TPL, {
      hasMileage: true, hasTerms: false, hasBonzahAddendum: false,
      hasDepositClause: false, hasHandoverTimes: true,
    });
    const { heads, tables } = sections(out);
    const mileageTable = tables.findIndex(t => t.includes('mileage_allowance'));
    expect(heads[mileageTable]).toBe('Vehicle Details');
    const timesTable = tables.findIndex(t => t.includes('vehicle_collected_at'));
    expect(heads[timesTable]).toBe('Vehicle Collection &amp; Return');
    expect(tables[timesTable]).not.toContain('mileage_allowance');
  });

  it('is idempotent — re-rendering never duplicates the block', () => {
    const opts = { hasMileage: true, hasTerms: false, hasBonzahAddendum: false,
      hasDepositClause: false, hasHandoverTimes: true };
    const once = injectAgreementClauses(TPL, opts);
    const thrice = injectAgreementClauses(injectAgreementClauses(once, opts), opts);
    expect(thrice).toBe(once);
    expect((thrice.match(/vehicle_collected_at/g) || []).length).toBe(1);
  });

  it('skips injection when the template already places any one of the names', () => {
    const authored = TPL.replace('</table>', '<tr><td>Collected</td><td>{{vehicle_collected_at}}</td></tr></table>');
    const out = injectAgreementClauses(authored, {
      hasMileage: false, hasTerms: false, hasBonzahAddendum: false,
      hasDepositClause: false, hasHandoverTimes: true,
    });
    expect(out).toBe(authored);
  });

  it('stays above the signature line', () => {
    const out = injectAgreementClauses(TPL, {
      hasMileage: false, hasTerms: false, hasBonzahAddendum: false,
      hasDepositClause: false, hasHandoverTimes: true,
    });
    expect(out.indexOf('vehicle_collected_at')).toBeLessThan(out.indexOf('By signing below'));
  });

  it('emits nothing when the flag is off', () => {
    const out = injectAgreementClauses(TPL, {
      hasMileage: false, hasTerms: false, hasBonzahAddendum: false,
      hasDepositClause: false, hasHandoverTimes: false,
    });
    expect(out).toBe(TPL);
  });
});
