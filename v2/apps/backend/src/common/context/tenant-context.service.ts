import { ForbiddenException, Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export interface TenantContextStore {
  userId: string;
  email: string;
  role: string;
  tenantId: string | null;
  tenantSlug: string | null;
  isSuperAdmin: boolean;
  isPrimarySuperAdmin: boolean;
}

/**
 * Request-scoped tenant context backed by AsyncLocalStorage. Any code running
 * inside a request (services, helpers, DB queries) can read the current
 * user/tenant without it being passed explicitly through every function call.
 *
 * The context is populated by TenantInterceptor immediately after auth guards.
 */
@Injectable()
export class TenantContextService {
  private readonly als = new AsyncLocalStorage<TenantContextStore>();

  run<T>(store: TenantContextStore, callback: () => T): T {
    return this.als.run(store, callback);
  }

  get(): TenantContextStore | undefined {
    return this.als.getStore();
  }

  getUserId(): string | null {
    return this.get()?.userId ?? null;
  }

  getEmail(): string | null {
    return this.get()?.email ?? null;
  }

  getRole(): string | null {
    return this.get()?.role ?? null;
  }

  getTenantId(): string | null {
    return this.get()?.tenantId ?? null;
  }

  getTenantSlug(): string | null {
    return this.get()?.tenantSlug ?? null;
  }

  isSuperAdmin(): boolean {
    return this.get()?.isSuperAdmin ?? false;
  }

  isPrimarySuperAdmin(): boolean {
    return this.get()?.isPrimarySuperAdmin ?? false;
  }

  /**
   * Returns the current tenant ID or throws.
   * Use this in services when you need to guarantee a tenant context exists.
   */
  requireTenantId(): string {
    const id = this.getTenantId();
    if (!id) {
      throw new ForbiddenException('Tenant context is required');
    }
    return id;
  }

  /**
   * Returns the current user ID or throws.
   */
  requireUserId(): string {
    const id = this.getUserId();
    if (!id) {
      throw new ForbiddenException('User context is required');
    }
    return id;
  }

  /**
   * Verifies the current user is allowed to access a resource belonging to
   * `targetTenantId`. Super admins bypass. Regular users must match.
   */
  assertCanAccessTenant(targetTenantId: string | null): void {
    if (this.isSuperAdmin()) return;

    const currentTenantId = this.getTenantId();
    if (!currentTenantId || currentTenantId !== targetTenantId) {
      throw new ForbiddenException(
        'Cannot access resources outside your tenant',
      );
    }
  }
}
