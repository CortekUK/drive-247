import { describe, expect, it } from 'vitest';
import { TraxRequestScope, traxPageContext } from '@/lib/trax-session';

describe('TRAX request isolation', () => {
  it('aborts old tenant requests and rejects results even if fetch ignored cancellation', () => {
    const gate = new TraxRequestScope(); gate.setScope('tenant-a:user:permissions-a');
    const old = gate.begin(); gate.setScope('tenant-b:user:permissions-a');
    expect(old.signal.aborted).toBe(true); expect(old.current()).toBe(false);
    const next = gate.begin(); expect(next.current()).toBe(true);
  });
  it('invalidates in-flight answers on permission changes, logout and reset', () => {
    const gate = new TraxRequestScope(); gate.setScope('active');
    const first = gate.begin(); gate.invalidate(); expect(first.current()).toBe(false);
    const second = gate.begin(); gate.setScope('logged-out'); expect(second.signal.aborted).toBe(true);
  });
  it('keeps concurrent requests valid when the scope did not change', () => {
    const gate = new TraxRequestScope(); gate.setScope('same'); const first = gate.begin();
    gate.setScope('same'); const second = gate.begin(); first.finish();
    expect(second.current()).toBe(true); expect(first.current()).toBe(true);
  });
  it('only derives record hints from exact supported UUID routes', () => {
    const id='00000000-0000-4000-8000-000000000001';
    expect(traxPageContext(`/rentals/${id}`)).toEqual({kind:'rental',id});
    expect(traxPageContext(`/vehicles/${id}`)).toEqual({kind:'vehicle',id});
    for (const route of ['/rentals/new','/vehicles/analytics','/customers/../payments','//evil.invalid','/payments/'+id]) expect(traxPageContext(route)).toBeUndefined();
  });
});
