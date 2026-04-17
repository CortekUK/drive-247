import {
  Injectable,
  Inject,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { eq, and, sql, count, ilike, or } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { hashPassword } from '../../common/utils/password.util';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';
import { tenants, appUsers, auditLogs } from '@drive247/database';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuthService } from '../auth/auth.service';
import type { CreateTenantDto } from './dto/create-tenant.dto';
import type { UpdateTenantDto } from './dto/update-tenant.dto';

@Injectable()
export class TenantsService {
  constructor(
    @Inject(DATABASE) private db: Database,
    private ctx: TenantContextService,
    private authService: AuthService,
  ) {}

  async list(search?: string, type?: string, status?: string) {
    let query = this.db
      .select({
        id: tenants.id,
        slug: tenants.slug,
        companyName: tenants.companyName,
        contactEmail: tenants.contactEmail,
        adminName: tenants.adminName,
        tenantType: tenants.tenantType,
        status: tenants.status,
        createdAt: tenants.createdAt,
        staffCount: sql<number>`(
          SELECT COUNT(*)::int FROM app_users
          WHERE app_users.tenant_id = tenants.id
        )`,
      })
      .from(tenants)
      .$dynamic();

    const conditions: any[] = [];

    if (search) {
      conditions.push(
        or(
          ilike(tenants.companyName, `%${search}%`),
          ilike(tenants.slug, `%${search}%`),
          ilike(tenants.contactEmail, `%${search}%`),
        ),
      );
    }

    if (type && type !== 'all') {
      conditions.push(eq(tenants.tenantType, type as 'production' | 'test'));
    }

    if (status && status !== 'all') {
      conditions.push(eq(tenants.status, status as 'active' | 'inactive' | 'suspended'));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    return query.orderBy(tenants.createdAt);
  }

  async getById(id: string) {
    const [tenant] = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);

    if (!tenant) throw new NotFoundException('Tenant not found');

    const users = await this.db
      .select({
        id: appUsers.id,
        email: appUsers.email,
        name: appUsers.name,
        role: appUsers.role,
        isActive: appUsers.isActive,
        mustChangePassword: appUsers.mustChangePassword,
        avatarUrl: appUsers.avatarUrl,
        lastLoginAt: appUsers.lastLoginAt,
        createdAt: appUsers.createdAt,
      })
      .from(appUsers)
      .where(eq(appUsers.tenantId, id));

    return { ...tenant, users };
  }

  async create(input: CreateTenantDto) {
    const actorId = this.ctx.requireUserId();

    // Check slug uniqueness
    const [existing] = await this.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, input.slug))
      .limit(1);

    if (existing) {
      throw new ConflictException('Tenant with this slug already exists');
    }

    // Generate password if not provided
    const adminPassword = input.adminPassword || randomBytes(8).toString('hex');

    // Create tenant
    const [tenant] = await this.db
      .insert(tenants)
      .values({
        companyName: input.companyName,
        slug: input.slug,
        contactEmail: input.contactEmail,
        adminName: input.adminName ?? null,
        tenantType: input.tenantType ?? 'production',
      })
      .returning();

    // Create head_admin for the tenant
    const passwordHash = await hashPassword(adminPassword);
    await this.db.insert(appUsers).values({
      tenantId: tenant.id,
      email: input.adminEmail,
      name: input.adminName ?? null,
      passwordHash,
      role: 'head_admin',
      mustChangePassword: true,
    });

    await this.logAudit(actorId, 'create_tenant', 'tenants', tenant.id, {
      slug: input.slug,
      adminEmail: input.adminEmail,
    });

    return {
      tenant: { ...tenant, staffCount: 1 },
      admin: {
        email: input.adminEmail,
        password: adminPassword,
      },
      portalUrl: `https://${input.slug}.portal.drive-247.com`,
    };
  }

  async update(id: string, input: UpdateTenantDto) {
    const actorId = this.ctx.requireUserId();

    const [existing] = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);

    if (!existing) throw new NotFoundException('Tenant not found');

    // Check slug uniqueness if changing
    if (input.slug && input.slug !== existing.slug) {
      const [slugTaken] = await this.db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.slug, input.slug))
        .limit(1);

      if (slugTaken) {
        throw new ConflictException('Slug is already taken');
      }
    }

    const [updated] = await this.db
      .update(tenants)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(tenants.id, id))
      .returning();

    await this.logAudit(actorId, 'update_tenant', 'tenants', id, {
      fields: Object.keys(input),
    });

    return updated;
  }

  async remove(id: string) {
    const actorId = this.ctx.requireUserId();

    const [existing] = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);

    if (!existing) throw new NotFoundException('Tenant not found');

    // Revoke all sessions for all tenant users
    const tenantUsers = await this.db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(eq(appUsers.tenantId, id));

    for (const user of tenantUsers) {
      await this.authService.revokeAllSessions(user.id);
    }

    // Delete tenant — cascade handles app_users → permissions, tokens
    await this.db.delete(tenants).where(eq(tenants.id, id));

    await this.logAudit(actorId, 'delete_tenant', 'tenants', id, {
      slug: existing.slug,
      companyName: existing.companyName,
    });

    return { success: true };
  }

  async stats() {
    const allTenants = await this.db
      .select({
        tenantType: tenants.tenantType,
        status: tenants.status,
      })
      .from(tenants);

    const [userCount] = await this.db
      .select({ count: count() })
      .from(appUsers)
      .where(eq(appUsers.isSuperAdmin, false));

    return {
      total: allTenants.length,
      active: allTenants.filter((t) => t.status === 'active').length,
      inactive: allTenants.filter((t) => t.status === 'inactive').length,
      suspended: allTenants.filter((t) => t.status === 'suspended').length,
      production: allTenants.filter((t) => t.tenantType === 'production').length,
      test: allTenants.filter((t) => t.tenantType === 'test').length,
      totalUsers: userCount?.count ?? 0,
    };
  }

  private async logAudit(
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    details?: Record<string, unknown>,
  ) {
    await this.db.insert(auditLogs).values({
      tenantId: null,
      actorId,
      action,
      entityType,
      entityId,
      details: details ? JSON.stringify(details) : null,
      isSuperAdminAction: true,
    });
  }
}
