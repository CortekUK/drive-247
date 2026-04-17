import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq, and, isNull } from 'drizzle-orm';
import { hashPassword, verifyPassword } from '../../common/utils/password.util';
import {
  ACCESS_TOKEN_EXPIRY_SECS,
  REFRESH_TOKEN_EXPIRY_SECS,
  REFRESH_MAX_AGE_MS,
} from '@drive247/shared-types';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';
import { appUsers, refreshTokens, auditLogs, tenants } from '@drive247/database';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private db: Database,
    private jwtService: JwtService,
  ) {}

  async login(
    email: string,
    password: string,
    tenantId: string | null,
    userAgent?: string,
    ipAddress?: string,
  ) {
    const conditions = tenantId
      ? and(eq(appUsers.email, email), eq(appUsers.tenantId, tenantId))
      : and(eq(appUsers.email, email), eq(appUsers.isSuperAdmin, true));

    const [user] = await this.db
      .select()
      .from(appUsers)
      .where(conditions)
      .limit(1);

    if (!user) {
      await this.logAudit(tenantId, null, 'login_failed', 'app_users', undefined, {
        email,
        reason: 'invalid_credentials',
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      await this.logAudit(tenantId, user.id, 'login_failed', 'app_users', user.id, {
        reason: 'account_deactivated',
      });
      throw new ForbiddenException('Account deactivated');
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      await this.logAudit(tenantId, user.id, 'login_failed', 'app_users', user.id, {
        reason: 'invalid_credentials',
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.db
      .update(appUsers)
      .set({ lastLoginAt: new Date() })
      .where(eq(appUsers.id, user.id));

    const tokens = await this.generateTokens(user, userAgent, ipAddress);

    await this.logAudit(
      user.tenantId,
      user.id,
      'login_success',
      'app_users',
      user.id,
      { userAgent },
    );

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.isSuperAdmin ? 'head_admin' : user.role,
        isSuperAdmin: user.isSuperAdmin,
        isPrimarySuperAdmin: user.isPrimarySuperAdmin,
        mustChangePassword: user.mustChangePassword,
        avatarUrl: user.avatarUrl,
      },
    };
  }

  async refresh(
    refreshToken: string,
    userAgent?: string,
    ipAddress?: string,
  ) {
    // 1. JWT verify — instant reject if expired or tampered
    let payload: { sub: string };
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // 2. Hash the token and find it in DB
    const tokenHash = await hashPassword(refreshToken);
    const userTokens = await this.db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.appUserId, payload.sub),
          isNull(refreshTokens.revokedAt),
        ),
      );

    // 3. Find matching token by bcrypt compare (only this user's tokens)
    let matchedToken: (typeof userTokens)[number] | null = null;
    for (const stored of userTokens) {
      const match = await verifyPassword(refreshToken, stored.tokenHash);
      if (match) {
        matchedToken = stored;
        break;
      }
    }

    if (!matchedToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // 4. Verify user is still active
    const [user] = await this.db
      .select()
      .from(appUsers)
      .where(eq(appUsers.id, payload.sub))
      .limit(1);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account not found or deactivated');
    }

    // 5. Revoke old token, issue new pair
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, matchedToken.id));

    return this.generateTokens(user, userAgent, ipAddress);
  }

  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      // Verify JWT first to get the user ID (fast reject)
      try {
        this.jwtService.verify(refreshToken, {
          secret: process.env.JWT_REFRESH_SECRET,
        });
      } catch {
        // Token already expired/invalid — still clean up DB
      }

      // Find and revoke the specific token
      const userTokens = await this.db
        .select()
        .from(refreshTokens)
        .where(
          and(
            eq(refreshTokens.appUserId, userId),
            isNull(refreshTokens.revokedAt),
          ),
        );

      for (const stored of userTokens) {
        const match = await verifyPassword(refreshToken, stored.tokenHash);
        if (match) {
          await this.db
            .update(refreshTokens)
            .set({ revokedAt: new Date() })
            .where(eq(refreshTokens.id, stored.id));
          break;
        }
      }
    }
    await this.logAudit(null, userId, 'logout', 'app_users', userId);
  }

  async revokeAllSessions(userId: string) {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.appUserId, userId),
          isNull(refreshTokens.revokedAt),
        ),
      );
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const [user] = await this.db
      .select()
      .from(appUsers)
      .where(eq(appUsers.id, userId))
      .limit(1);
    if (!user) throw new UnauthorizedException();

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid)
      throw new UnauthorizedException('Current password is incorrect');

    const passwordHash = await hashPassword(newPassword);
    await this.db
      .update(appUsers)
      .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
      .where(eq(appUsers.id, userId));

    await this.logAudit(
      user.tenantId,
      userId,
      'password_changed',
      'app_users',
      userId,
    );
  }

  async getProfile(userId: string) {
    const [user] = await this.db
      .select({
        id: appUsers.id,
        email: appUsers.email,
        name: appUsers.name,
        role: appUsers.role,
        isSuperAdmin: appUsers.isSuperAdmin,
        isPrimarySuperAdmin: appUsers.isPrimarySuperAdmin,
        mustChangePassword: appUsers.mustChangePassword,
        avatarUrl: appUsers.avatarUrl,
        tenantId: appUsers.tenantId,
      })
      .from(appUsers)
      .where(eq(appUsers.id, userId))
      .limit(1);

    if (!user) throw new UnauthorizedException();
    return {
      ...user,
      role: user.isSuperAdmin ? 'head_admin' : user.role,
    };
  }

  async resolveTenantId(slug: string): Promise<string | null> {
    const [tenant] = await this.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);
    return tenant?.id ?? null;
  }

  // --- Private helpers ---

  private async generateTokens(
    user: typeof appUsers.$inferSelect,
    userAgent?: string,
    ipAddress?: string,
  ) {
    // Access token — full user payload, short-lived
    const accessPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      isSuperAdmin: user.isSuperAdmin,
      isPrimarySuperAdmin: user.isPrimarySuperAdmin,
    };

    const accessToken = await this.jwtService.signAsync(
      accessPayload as Record<string, unknown>,
      {
        secret: process.env.JWT_SECRET,
        expiresIn: ACCESS_TOKEN_EXPIRY_SECS,
      },
    );

    // Refresh token — minimal payload (just user ID), long-lived, separate secret
    const refreshToken = await this.jwtService.signAsync(
      { sub: user.id },
      {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: REFRESH_TOKEN_EXPIRY_SECS,
      },
    );

    // Store bcrypt hash of refresh token in DB for revocation support
    const tokenHash = await hashPassword(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_MAX_AGE_MS);

    await this.db.insert(refreshTokens).values({
      appUserId: user.id,
      tokenHash,
      userAgent: userAgent ?? null,
      ipAddress: ipAddress ?? null,
      expiresAt,
    });

    return { accessToken, refreshToken };
  }

  private async logAudit(
    tenantId: string | null,
    actorId: string | null,
    action: string,
    entityType?: string,
    entityId?: string,
    details?: Record<string, unknown>,
  ) {
    await this.db.insert(auditLogs).values({
      tenantId,
      actorId,
      action,
      entityType,
      entityId,
      details: details ? JSON.stringify(details) : null,
      isSuperAdminAction: false,
    });
  }
}
