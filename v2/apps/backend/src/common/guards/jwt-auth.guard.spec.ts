import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JwtAuthGuard } from './jwt-auth.guard';

function mockExecutionContext() {
  return {
    getHandler: () => vi.fn(),
    getClass: () => vi.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ headers: {} }),
      getResponse: () => ({}),
    }),
    getType: () => 'http',
    getArgs: () => [],
    getArgByIndex: () => ({}),
    switchToRpc: () => ({}),
    switchToWs: () => ({}),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
  });

  it('should allow access when @Public() is set', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const context = mockExecutionContext();
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should delegate to Passport when route is not public', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const context = mockExecutionContext();
    // Passport will reject because there's no JWT — that's expected
    const result = guard.canActivate(context);
    // It returns a Promise (from Passport), not a plain boolean
    expect(result).toBeInstanceOf(Promise);
    await expect(result).rejects.toThrow();
  });
});
