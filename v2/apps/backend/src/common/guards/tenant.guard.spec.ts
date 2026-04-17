import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TenantGuard } from './tenant.guard';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';

function mockContext(
  user?: Partial<AuthenticatedUser>,
  extras?: {
    params?: Record<string, string>;
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
  },
) {
  return {
    getHandler: () => vi.fn(),
    getClass: () => vi.fn(),
    switchToHttp: () => ({
      getRequest: () => ({
        user: user
          ? {
              id: 'user-1',
              email: 'test@test.com',
              role: 'head_admin',
              tenantId: 'tenant-1',
              isSuperAdmin: false,
              isPrimarySuperAdmin: false,
              ...user,
            }
          : undefined,
        params: extras?.params ?? {},
        query: extras?.query ?? {},
        body: extras?.body ?? {},
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('TenantGuard', () => {
  let guard: TenantGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new TenantGuard(reflector);
  });

  it('should pass through when @Public() is set', () => {
    vi.spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(true)   // IS_PUBLIC_KEY
      .mockReturnValueOnce(null);  // REQUIRE_TENANT_KEY
    expect(guard.canActivate(mockContext())).toBe(true);
  });

  it('should pass through when no @RequireTenant() decorator', () => {
    vi.spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(false)  // IS_PUBLIC_KEY
      .mockReturnValueOnce(null);  // REQUIRE_TENANT_KEY
    expect(guard.canActivate(mockContext({ tenantId: 'tenant-1' }))).toBe(true);
  });

  it('should allow when user has tenantId (from: user)', () => {
    vi.spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(false)                // IS_PUBLIC_KEY
      .mockReturnValueOnce({ from: 'user' });    // REQUIRE_TENANT_KEY
    expect(guard.canActivate(mockContext({ tenantId: 'tenant-1' }))).toBe(true);
  });

  it('should throw when user has no tenantId (from: user)', () => {
    vi.spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce({ from: 'user' });
    expect(() =>
      guard.canActivate(mockContext({ tenantId: null })),
    ).toThrow(ForbiddenException);
  });

  it('should allow super admin even without tenantId', () => {
    vi.spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce({ from: 'user' });
    expect(
      guard.canActivate(mockContext({ tenantId: null, isSuperAdmin: true })),
    ).toBe(true);
  });

  it('should allow when param tenantId matches user tenantId', () => {
    vi.spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce({ from: 'param:tenantId' });
    expect(
      guard.canActivate(
        mockContext({ tenantId: 'tenant-1' }, { params: { tenantId: 'tenant-1' } }),
      ),
    ).toBe(true);
  });

  it('should throw when param tenantId does not match user tenantId', () => {
    vi.spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce({ from: 'param:tenantId' });
    expect(() =>
      guard.canActivate(
        mockContext({ tenantId: 'tenant-1' }, { params: { tenantId: 'tenant-2' } }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('should allow super admin to access any tenant via param', () => {
    vi.spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce({ from: 'param:tenantId' });
    expect(
      guard.canActivate(
        mockContext(
          { tenantId: null, isSuperAdmin: true },
          { params: { tenantId: 'any-tenant' } },
        ),
      ),
    ).toBe(true);
  });

  it('should throw when no user is present', () => {
    vi.spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce({ from: 'user' });
    expect(() => guard.canActivate(mockContext())).toThrow(
      UnauthorizedException,
    );
  });

  it('should resolve tenantId from query string', () => {
    vi.spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce({ from: 'query:tenantId' });
    expect(
      guard.canActivate(
        mockContext({ tenantId: 'tenant-1' }, { query: { tenantId: 'tenant-1' } }),
      ),
    ).toBe(true);
  });

  it('should resolve tenantId from body', () => {
    vi.spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce({ from: 'body:tenantId' });
    expect(
      guard.canActivate(
        mockContext({ tenantId: 'tenant-1' }, { body: { tenantId: 'tenant-1' } }),
      ),
    ).toBe(true);
  });

  it('should throw when param source has no tenant ID', () => {
    vi.spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce({ from: 'param:tenantId' });
    expect(() =>
      guard.canActivate(mockContext({ tenantId: 'tenant-1' }, { params: {} })),
    ).toThrow(ForbiddenException);
  });
});
