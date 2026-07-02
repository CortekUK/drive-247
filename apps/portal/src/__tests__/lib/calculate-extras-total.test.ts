import { describe, it, expect } from 'vitest';
import { extraLineTotal, calcExtrasTotal } from '@/lib/calculate-extras-total';

describe('extraLineTotal', () => {
  it('per_trip bills flat (no day multiplication)', () => {
    expect(extraLineTotal(10, 2, 'per_trip', 5)).toBe(20);
  });

  it('per_day bills price x qty x days', () => {
    expect(extraLineTotal(10, 2, 'per_day', 5)).toBe(100);
  });

  it('per_day with missing days falls back to 1', () => {
    expect(extraLineTotal(10, 2, 'per_day', undefined)).toBe(20);
  });

  it('per_day with 0 days clamps to min 1', () => {
    expect(extraLineTotal(10, 2, 'per_day', 0)).toBe(20);
  });

  it('per_day floors fractional days', () => {
    expect(extraLineTotal(10, 2, 'per_day', 2.9)).toBe(40); // floor(2.9)=2 -> 10*2*2
  });

  it('undefined billing_type defaults to per_trip', () => {
    expect(extraLineTotal(10, 2, undefined, 5)).toBe(20);
  });

  it('null billing_type defaults to per_trip', () => {
    expect(extraLineTotal(10, 2, null, 5)).toBe(20);
  });

  it('coerces string price/qty', () => {
    expect(extraLineTotal('10' as any, '2' as any, 'per_day', 5)).toBe(100);
  });

  it('null price -> 0', () => {
    expect(extraLineTotal(null, 2, 'per_day', 5)).toBe(0);
  });
});

describe('calcExtrasTotal', () => {
  const extras = [
    { id: 'stroller', price: 10, billing_type: 'per_day' },
    { id: 'gps', price: 5, billing_type: 'per_trip' },
    { id: 'seat', price: 7, billing_type: 'per_day' },
  ];

  it('mixes per_day and per_trip correctly', () => {
    // stroller: 10*2*3=60 ; gps: 5*1=5 ; total 65
    expect(calcExtrasTotal({ stroller: 2, gps: 1 }, extras, 3)).toBe(65);
  });

  it('skips qty <= 0', () => {
    expect(calcExtrasTotal({ stroller: 0, gps: 1 }, extras, 3)).toBe(5);
  });

  it('skips unknown extra ids', () => {
    expect(calcExtrasTotal({ nonexistent: 5 }, extras, 3)).toBe(0);
  });

  it('all per_day scales with days', () => {
    // stroller 10*1*4=40 ; seat 7*2*4=56 ; total 96
    expect(calcExtrasTotal({ stroller: 1, seat: 2 }, extras, 4)).toBe(96);
  });

  it('per_trip total is unaffected by days', () => {
    expect(calcExtrasTotal({ gps: 3 }, extras, 99)).toBe(15);
  });

  it('empty selection -> 0', () => {
    expect(calcExtrasTotal({}, extras, 5)).toBe(0);
  });
});
