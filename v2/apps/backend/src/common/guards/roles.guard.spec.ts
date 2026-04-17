import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RolesGuard } from './roles.guard';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';

function mockContext(user?: Partial<AuthenticatedUser>) {
  return {
    getHandler: () => vi.fn(),
    getClass: () => vi.fn(),
    switchToHttp: () => ({
      getRequest: () => ({
        user: user
          ? {
              id: 'user-1',
              email: 'test@test.com',
              role: 'ops',
              tenantId: 'tenant-1',
              isSuperAdmin: false,
              isPrimarySuperAdmin: false,
              ...user,
            }
          : undefined,
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  // --- @Roles() tests ---

  it('should allow access when no roles or super admin required', () => {
    vi.spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(undefined)   // SUPER_ADMIN_KEY
      .mockReturnValueOnce(undefined);  // ROLES_KEY
    expect(guard.canActivate(mockContext({ role: 'viewer' }))).toBe(true);
  });

  it('should allow access when user has required role', () => {
    vi.spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(undefined)                    // SUPER_ADMIN_KEY
      .mockReturnValueOnce(['head_admin', 'admin']);      // ROLES_KEY
    expect(guard.canActivate(mockContext({ role: 'head_admin' }))).toBe(true);
  });

  it('should throw when user does not have required role', () => {
    vi.spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(['head_admin', 'admin']);
    expect(() => guard.canActivate(mockContext({ role: 'viewer' }))).toThrow(
      ForbiddenException,
    );
  });

  it('should allow super admin regardless of @Roles()', () => {
    vi.spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(['head_admin']);
    expect(
      guard.canActivate(mockContext({ role: 'viewer', isSuperAdmin: true })),
    ).toBe(true);
  });

  it('should throw when no user is present and roles required', () => {
    vi.spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(['head_admin']);
    expect(() => guard.canActivate(mockContext())).toThrow(ForbiddenException);
  });

  // --- @SuperAdminOnly() tests ---

  it('should allow super admin when @SuperAdminOnly() is set', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(true); // SUPER_ADMIN_KEY
    expect(
      guard.canActivate(mockContext({ isSuperAdmin: true })),
    ).toBe(true);
  });

  it('should throw for non-super-admin when @SuperAdminOnly() is set', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(true);
    expect(() =>
      guard.canActivate(mockContext({ role: 'head_admin', isSuperAdmin: false })),
    ).toThrow(ForbiddenException);
  });

  it('should throw when no user and @SuperAdminOnly() is set', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(true);
    expect(() => guard.canActivate(mockContext())).toThrow(ForbiddenException);
  });
});
