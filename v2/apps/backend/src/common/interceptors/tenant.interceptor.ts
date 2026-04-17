import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import {
  TenantContextService,
  type TenantContextStore,
} from '../context/tenant-context.service';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';

/**
 * Global interceptor that wraps every authenticated request in an
 * AsyncLocalStorage context holding the user's tenant info. Runs AFTER
 * JwtAuthGuard (which sets req.user), so by the time we read req.user it's
 * already populated. Public routes (no req.user) pass straight through.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private readonly tenantContext: TenantContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<{
        user?: AuthenticatedUser;
        headers: Record<string, string>;
      }>();
    const user = req.user;

    if (!user) return next.handle();

    const tenantSlug =
      (req.headers['x-tenant-slug'] as string | undefined) ?? null;

    const store: TenantContextStore = {
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      tenantSlug,
      isSuperAdmin: user.isSuperAdmin,
      isPrimarySuperAdmin: user.isPrimarySuperAdmin,
    };

    return new Observable((subscriber) => {
      this.tenantContext.run(store, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
