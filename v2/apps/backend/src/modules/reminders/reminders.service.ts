import {
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, desc, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import { reminders, reminderConfigs } from '@drive247/database';
import { ReminderSeverity } from '@drive247/shared-types';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';
import { TenantContextService } from '../../common/context/tenant-context.service';
import type { ListRemindersDto } from './dto/list-reminders.dto';

type ReminderRow = typeof reminders.$inferSelect;
type ReminderConfigRow = typeof reminderConfigs.$inferSelect;

/**
 * Reminders are tenant-scoped alerts emitted by backend rules (e.g. Bonzah
 * low-balance). Users don't create them directly — they review and resolve.
 *
 * Service exposes two internal APIs:
 *
 *   Public (controller):
 *     - list({tenantId}, filters) — for UI display
 *     - resolve(id) — user acknowledges
 *     - getConfig / upsertConfig — per-tenant thresholds
 *
 *   Internal (called by other rule-emitting services like BonzahService):
 *     - upsertByRule(tenantId, ruleCode, payload) — create-or-update the
 *       single active reminder for this (tenant, ruleCode). If an unresolved
 *       reminder already exists, its content is refreshed. Otherwise a new
 *       one is inserted.
 */
@Injectable()
export class RemindersService {
  constructor(
    @Inject(DATABASE) private db: Database,
    private ctx: TenantContextService,
  ) {}

  // --- Public ---

  async list(query: ListRemindersDto) {
    const tenantId = this.ctx.requireTenantId();
    const { ruleCode, severity, resolved, page, limit } = query;

    const conditions = [eq(reminders.tenantId, tenantId)];
    if (ruleCode) conditions.push(eq(reminders.ruleCode, ruleCode));
    if (severity) conditions.push(eq(reminders.severity, severity));
    if (resolved === true) conditions.push(isNotNull(reminders.resolvedAt));
    if (resolved === false) conditions.push(isNull(reminders.resolvedAt));

    const where = and(...conditions);

    const [items, [totalRow]] = await Promise.all([
      this.db
        .select()
        .from(reminders)
        .where(where)
        .orderBy(desc(reminders.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
      this.db.select({ count: count() }).from(reminders).where(where),
    ]);

    return {
      items: items.map(shape),
      meta: { page, limit, total: totalRow?.count ?? 0 },
    };
  }

  async resolve(id: string) {
    const tenantId = this.ctx.requireTenantId();
    const [existing] = await this.db
      .select()
      .from(reminders)
      .where(and(eq(reminders.id, id), eq(reminders.tenantId, tenantId)))
      .limit(1);
    if (!existing) throw new NotFoundException('Reminder not found');

    const [updated] = await this.db
      .update(reminders)
      .set({ resolvedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(reminders.id, id), eq(reminders.tenantId, tenantId)))
      .returning();

    return shape(updated);
  }

  async getConfig(configKey: string) {
    const tenantId = this.ctx.requireTenantId();
    const [row] = await this.db
      .select()
      .from(reminderConfigs)
      .where(
        and(
          eq(reminderConfigs.tenantId, tenantId),
          eq(reminderConfigs.configKey, configKey),
        ),
      )
      .limit(1);
    return row ? shapeConfig(row) : null;
  }

  async upsertConfig(configKey: string, configValue: Record<string, unknown>) {
    const tenantId = this.ctx.requireTenantId();

    const existing = await this.db
      .select({ id: reminderConfigs.id })
      .from(reminderConfigs)
      .where(
        and(
          eq(reminderConfigs.tenantId, tenantId),
          eq(reminderConfigs.configKey, configKey),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const [row] = await this.db
        .update(reminderConfigs)
        .set({ configValue, updatedAt: new Date() })
        .where(eq(reminderConfigs.id, existing[0].id))
        .returning();
      return shapeConfig(row);
    }

    const [row] = await this.db
      .insert(reminderConfigs)
      .values({ tenantId, configKey, configValue })
      .returning();
    return shapeConfig(row);
  }

  // --- Internal (called by rule emitters; tenantId is explicit to allow
  //     emission from outside a request context, e.g. cron jobs) ---

  async upsertByRule(
    tenantId: string,
    ruleCode: string,
    payload: {
      objectType: string;
      objectId?: string | null;
      title: string;
      message: string;
      severity: ReminderSeverity;
      context?: Record<string, unknown> | null;
    },
  ) {
    const [existing] = await this.db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.tenantId, tenantId),
          eq(reminders.ruleCode, ruleCode),
          isNull(reminders.resolvedAt),
        ),
      )
      .orderBy(desc(reminders.createdAt))
      .limit(1);

    if (existing) {
      const [updated] = await this.db
        .update(reminders)
        .set({
          objectType: payload.objectType,
          objectId: payload.objectId ?? null,
          title: payload.title,
          message: payload.message,
          severity: payload.severity,
          context: payload.context ?? null,
          updatedAt: new Date(),
        })
        .where(eq(reminders.id, existing.id))
        .returning();
      return shape(updated);
    }

    const [created] = await this.db
      .insert(reminders)
      .values({
        tenantId,
        ruleCode,
        objectType: payload.objectType,
        objectId: payload.objectId ?? null,
        title: payload.title,
        message: payload.message,
        severity: payload.severity,
        context: payload.context ?? null,
      })
      .returning();
    return shape(created);
  }

  /**
   * Resolve any unresolved reminder for a rule. Called by rule emitters when
   * the alerting condition clears (e.g. Bonzah balance goes back above
   * threshold).
   */
  async resolveByRule(tenantId: string, ruleCode: string) {
    await this.db
      .update(reminders)
      .set({ resolvedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(reminders.tenantId, tenantId),
          eq(reminders.ruleCode, ruleCode),
          isNull(reminders.resolvedAt),
        ),
      );
  }
}

function shape(row: ReminderRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    ruleCode: row.ruleCode,
    objectType: row.objectType,
    objectId: row.objectId,
    title: row.title,
    message: row.message,
    severity: row.severity,
    context: row.context as Record<string, unknown> | null,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function shapeConfig(row: ReminderConfigRow) {
  return {
    configKey: row.configKey,
    configValue: row.configValue as Record<string, unknown>,
  };
}

// Keep sql import usage to satisfy bundler even if future edits drop it
void sql;
