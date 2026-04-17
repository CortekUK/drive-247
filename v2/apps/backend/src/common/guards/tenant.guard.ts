import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  REQUIRE_TENANT_KEY,
  type RequireTenantOptions,
} from '../decorators/require-tenant.decorator';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';

/**
 * Enforces tenant scoping on routes decorated with @RequireTenant().
 *
 * Behaviour:
 *  - No @RequireTenant decorator  → pass through
 *  - @Public()                    → pass through
 *  - User is super admin          → pass through (bypass)
 *  - User is regular user         → user.tenantId must match the resolved
 *                                   tenant ID from the configured source
 *
 * Resolution sources:
 *  - 'user' (default)       — uses user.tenantId itself; just requires presence
 *  - 'param:<name>'         — reads from route params
 *  - 'query:<name>'         — reads from query string
 *  - 'body:<name>'          — reads from request body
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const options = this.reflector.getAllAndOverride<
      RequireTenantOptions & { from: string }
    >(REQUIRE_TENANT_KEY, [context.getHandler(), context.getClass()]);

    // No @RequireTenant() decorator — no tenant enforcement on this route
    if (!options) return true;

    const req = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
      params: Record<string, string>;
      query: Record<string, unknown>;
      body: Record<string, unknown>;
    }>();

    const user = req.user;
    if (!user) {
      throw new UnauthorizedException();
    }

    // Super admins bypass tenant scoping entirely
    if (user.isSuperAdmin) return true;

    // User must have a tenant context
    if (!user.tenantId) {
      throw new ForbiddenException('User has no tenant context');
    }

    // Resolve the target tenant ID from the configured source
    const resolved = this.resolveTenantId(req, options.from ?? 'user');

    // When from === 'user', just having a tenantId is enough
    if ((options.from ?? 'user') === 'user') {
      return true;
    }

    // For param/query/body sources, the resolved tenant must exist
    if (!resolved) {
      throw new ForbiddenException('Tenant ID is required on this route');
    }

    // And it must match the user's tenant
    if (resolved !== user.tenantId) {
      throw new ForbiddenException(
        'Cannot access resources outside your tenant',
      );
    }

    return true;
  }

  private resolveTenantId(
    req: {
      params: Record<string, string>;
      query: Record<string, unknown>;
      body: Record<string, unknown>;
      user?: AuthenticatedUser;
    },
    from: string,
  ): string | null {
    if (from === 'user') {
      return req.user?.tenantId ?? null;
    }

    const [source, key] = from.split(':') as [
      'param' | 'query' | 'body',
      string,
    ];

    switch (source) {
      case 'param':
        return req.params[key] ?? null;
      case 'query': {
        const qVal = req.query[key];
        return typeof qVal === 'string' ? qVal : null;
      }
      case 'body': {
        const bVal = req.body[key];
        return typeof bVal === 'string' ? bVal : null;
      }
      default:
        return null;
    }
  }
}
