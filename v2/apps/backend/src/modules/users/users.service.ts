import {
  Injectable,
  Inject,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { hashPassword } from '../../common/utils/password.util';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';
import { appUsers, managerPermissions, auditLogs } from '@drive247/database';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuthService } from '../auth/auth.service';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import type { UpdateRoleDto } from './dto/update-role.dto';

@Injectable()
export class UsersService {
  constructor(
    @Inject(DATABASE) private db: Database,
    private authService: AuthService,
    private ctx: TenantContextService,
  ) {}

  async list(tenantId: string) {
    return this.db
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
      .where(eq(appUsers.tenantId, tenantId));
  }

  async getById(id: string, tenantId: string) {
    const [user] = await this.db
      .select()
      .from(appUsers)
      .where(and(eq(appUsers.id, id), eq(appUsers.tenantId, tenantId)))
      .limit(1);

    if (!user) throw new NotFoundException('User not found');

    const permissions = await this.db
      .select()
      .from(managerPermissions)
      .where(eq(managerPermissions.appUserId, id));

    return { ...user, permissions };
  }

  async create(input: CreateUserDto, tenantId: string) {
    const actorId = this.ctx.requireUserId();
    const actorRole = this.ctx.getRole();
    const actorIsSuperAdmin = this.ctx.isSuperAdmin();

    this.checkCreatePermission(actorRole, actorIsSuperAdmin, input.role);

    const [existing] = await this.db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(
        and(eq(appUsers.email, input.email), eq(appUsers.tenantId, tenantId)),
      )
      .limit(1);

    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    const passwordHash = await hashPassword(input.password);

    const [newUser] = await this.db
      .insert(appUsers)
      .values({
        tenantId,
        email: input.email,
        name: input.name,
        passwordHash,
        role: input.role,
        mustChangePassword: true,
      })
      .returning({
        id: appUsers.id,
        email: appUsers.email,
        role: appUsers.role,
      });

    if (input.role === 'manager' && input.permissions) {
      await this.db.insert(managerPermissions).values(
        input.permissions.map((p) => ({
          appUserId: newUser.id,
          tabKey: p.tabKey,
          accessLevel: p.accessLevel as 'viewer' | 'editor',
        })),
      );
    }

    await this.logAudit(tenantId, actorId, 'create_user', 'app_users', newUser.id, {
      email: input.email,
      role: input.role,
    });

    return newUser;
  }

  async updateRole(userId: string, input: UpdateRoleDto, tenantId: string) {
    const actorId = this.ctx.requireUserId();
    const actorRole = this.ctx.getRole();
    const actorIsSuperAdmin = this.ctx.isSuperAdmin();

    if (userId === actorId) {
      throw new ForbiddenException('Cannot change your own role');
    }

    const [target] = await this.db
      .select()
      .from(appUsers)
      .where(and(eq(appUsers.id, userId), eq(appUsers.tenantId, tenantId)))
      .limit(1);

    if (!target) throw new NotFoundException('User not found');

    this.checkCreatePermission(actorRole, actorIsSuperAdmin, input.role);

    await this.db
      .update(appUsers)
      .set({ role: input.role, updatedAt: new Date() })
      .where(eq(appUsers.id, userId));

    await this.db
      .delete(managerPermissions)
      .where(eq(managerPermissions.appUserId, userId));

    if (input.role === 'manager' && input.permissions) {
      await this.db.insert(managerPermissions).values(
        input.permissions.map((p) => ({
          appUserId: userId,
          tabKey: p.tabKey,
          accessLevel: p.accessLevel as 'viewer' | 'editor',
        })),
      );
    }

    await this.logAudit(tenantId, actorId, 'update_role', 'app_users', userId, {
      oldRole: target.role,
      newRole: input.role,
    });

    return { success: true };
  }

  async deactivate(userId: string, tenantId: string) {
    const actorId = this.ctx.requireUserId();

    if (userId === actorId) {
      throw new ForbiddenException('Cannot deactivate yourself');
    }

    const [target] = await this.db
      .select()
      .from(appUsers)
      .where(and(eq(appUsers.id, userId), eq(appUsers.tenantId, tenantId)))
      .limit(1);

    if (!target) throw new NotFoundException('User not found');

    await this.db
      .update(appUsers)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(appUsers.id, userId));

    await this.authService.revokeAllSessions(userId);

    await this.logAudit(tenantId, actorId, 'deactivate_user', 'app_users', userId);

    return { success: true };
  }

  async activate(userId: string, tenantId: string) {
    const actorId = this.ctx.requireUserId();

    const [target] = await this.db
      .select()
      .from(appUsers)
      .where(and(eq(appUsers.id, userId), eq(appUsers.tenantId, tenantId)))
      .limit(1);

    if (!target) throw new NotFoundException('User not found');

    await this.db
      .update(appUsers)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(appUsers.id, userId));

    await this.logAudit(tenantId, actorId, 'activate_user', 'app_users', userId);

    return { success: true };
  }

  async update(userId: string, input: UpdateUserDto, tenantId: string) {
    const actorId = this.ctx.requireUserId();

    const [target] = await this.db
      .select()
      .from(appUsers)
      .where(and(eq(appUsers.id, userId), eq(appUsers.tenantId, tenantId)))
      .limit(1);

    if (!target) throw new NotFoundException('User not found');

    const [updated] = await this.db
      .update(appUsers)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(appUsers.id, userId))
      .returning({
        id: appUsers.id,
        email: appUsers.email,
        name: appUsers.name,
        avatarUrl: appUsers.avatarUrl,
      });

    await this.logAudit(tenantId, actorId, 'update_user', 'app_users', userId, {
      fields: Object.keys(input),
    });

    return updated;
  }

  async remove(userId: string, tenantId: string) {
    const actorId = this.ctx.requireUserId();

    if (userId === actorId) {
      throw new ForbiddenException('Cannot delete yourself');
    }

    const [target] = await this.db
      .select()
      .from(appUsers)
      .where(and(eq(appUsers.id, userId), eq(appUsers.tenantId, tenantId)))
      .limit(1);

    if (!target) throw new NotFoundException('User not found');

    // Revoke all sessions before deleting
    await this.authService.revokeAllSessions(userId);

    // Cascade delete handles manager_permissions + refresh_tokens
    await this.db
      .delete(appUsers)
      .where(eq(appUsers.id, userId));

    await this.logAudit(tenantId, actorId, 'delete_user', 'app_users', userId, {
      email: target.email,
      role: target.role,
    });

    return { success: true };
  }

  // --- Private helpers ---

  private checkCreatePermission(
    actorRole: string | null,
    actorIsSuperAdmin: boolean,
    targetRole: string,
  ) {
    if (actorIsSuperAdmin) return;
    if (actorRole === 'head_admin') return;

    if (actorRole === 'admin') {
      if (['head_admin', 'admin', 'manager'].includes(targetRole)) {
        throw new ForbiddenException(
          'Admin can only manage ops and viewer roles',
        );
      }
      return;
    }

    throw new ForbiddenException('Insufficient permissions');
  }

  private async logAudit(
    tenantId: string | null,
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    details?: Record<string, unknown>,
  ) {
    await this.db.insert(auditLogs).values({
      tenantId,
      actorId,
      action,
      entityType,
      entityId,
      details: details ? JSON.stringify(details) : null,
      isSuperAdminAction: this.ctx.isSuperAdmin(),
    });
  }
}
