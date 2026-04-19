import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { tenants } from '@drive247/database';
import {
  BonzahMode,
  REMINDER_RULE_CODES,
  ReminderSeverity,
  type BonzahAlertConfigResponse,
  type BonzahAlertLevel,
  type BonzahBalanceResponse,
  type BonzahConnectionStatus,
  type VerifyCredentialsResponse,
} from '@drive247/shared-types';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { getEnv } from '../../config/env.config';
import { BonzahApiClient } from '../../integrations/bonzah/bonzah-api.client';
import { BonzahCredentialsService } from '../../integrations/bonzah/bonzah-credentials.service';
import { BonzahTokenCache } from '../../integrations/bonzah/bonzah-token-cache.service';
import { BONZAH_PATHS } from '../../integrations/bonzah/constants';
import {
  BonzahAuthError,
  BonzahNotConfiguredError,
} from '../../integrations/bonzah/errors';
import type {
  BonzahBalanceData,
  ResolvedBonzahCredentials,
} from '../../integrations/bonzah/types';
import { RemindersService } from '../reminders/reminders.service';
import type { VerifyCredentialsDto } from './dto/verify-credentials.dto';
import type { UpdateBonzahSettingsDto } from './dto/update-bonzah-settings.dto';

const BONZAH_ALERT_CONFIG_KEY = 'bonzah_low_balance';
const DEFAULT_ALERT_THRESHOLD = 100;

interface AlertConfigPayload {
  enabled?: boolean;
  threshold?: number;
}

/**
 * Top-level Bonzah orchestration.
 *
 * Responsibilities:
 *   - Connection status + settings CRUD (including credential verification
 *     before persist — rule #13)
 *   - CD balance fetch + threshold comparison + reminder emission
 *   - Alert config CRUD (thin wrapper around RemindersService.upsertConfig)
 *
 * Does NOT handle quote / payment / policy / PDF — those are in
 * dedicated services and injected into controllers separately.
 */
@Injectable()
export class BonzahService {
  private readonly logger = new Logger(BonzahService.name);

  constructor(
    @Inject(DATABASE) private db: Database,
    private readonly ctx: TenantContextService,
    private readonly apiClient: BonzahApiClient,
    private readonly credentialsService: BonzahCredentialsService,
    private readonly tokenCache: BonzahTokenCache,
    private readonly remindersService: RemindersService,
  ) {}

  // --- Connection & settings -------------------------------------------

  async getConnection(): Promise<BonzahConnectionStatus> {
    const tenantId = this.ctx.requireTenantId();
    const [row] = await this.db
      .select({
        integrationBonzah: tenants.integrationBonzah,
        mode: tenants.bonzahMode,
        username: tenants.bonzahUsername,
        brochureUrl: tenants.bonzahBrochureUrl,
        passwordEncrypted: tenants.bonzahPasswordEncrypted,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!row) throw new NotFoundException('Tenant not found');

    const env = getEnv();
    const connected =
      row.mode === BonzahMode.LIVE
        ? Boolean(row.username && row.passwordEncrypted)
        : Boolean(env.BONZAH_PLATFORM_USERNAME && env.BONZAH_PLATFORM_PASSWORD);

    return {
      connected,
      mode: row.mode as BonzahMode,
      username:
        row.mode === BonzahMode.LIVE
          ? row.username
          : env.BONZAH_PLATFORM_USERNAME ?? null,
      brochureUrl: row.brochureUrl,
    };
  }

  async verifyCredentials(
    input: VerifyCredentialsDto,
  ): Promise<VerifyCredentialsResponse> {
    this.ctx.requireTenantId();
    const env = getEnv();
    const apiUrl =
      input.mode === BonzahMode.LIVE
        ? env.BONZAH_API_URL_LIVE
        : env.BONZAH_API_URL_SANDBOX;

    const creds: ResolvedBonzahCredentials = {
      username: input.username,
      password: input.password,
      mode: input.mode,
      apiUrl,
    };

    try {
      await this.apiClient.authenticate(creds);
      // Don't leave the token cached under these (possibly non-tenant) creds
      this.tokenCache.invalidate(input.username, apiUrl);
      return { valid: true, email: input.username, mode: input.mode };
    } catch (err) {
      if (err instanceof BonzahAuthError) {
        return { valid: false, error: err.message };
      }
      return { valid: false, error: (err as Error).message };
    }
  }

  async updateSettings(input: UpdateBonzahSettingsDto) {
    const tenantId = this.ctx.requireTenantId();
    const env = getEnv();

    const [existing] = await this.db
      .select({
        mode: tenants.bonzahMode,
        username: tenants.bonzahUsername,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!existing) throw new NotFoundException('Tenant not found');

    const nextMode = (input.mode ?? existing.mode) as BonzahMode;
    const providingCreds = Boolean(input.username || input.password);
    const changingToLive =
      nextMode === BonzahMode.LIVE &&
      (input.mode === BonzahMode.LIVE || providingCreds);

    // Rule #13 — mode change to live requires valid creds in the same update
    if (changingToLive) {
      if (!input.username || !input.password) {
        throw new BadRequestException(
          'Switching to live mode requires both username and password in the same request',
        );
      }
      const verify = await this.verifyCredentials({
        username: input.username,
        password: input.password,
        mode: BonzahMode.LIVE,
      });
      if (!verify.valid) {
        throw new ConflictException(
          `Bonzah live credentials failed verification: ${verify.error ?? 'invalid'}`,
        );
      }
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.mode) patch.bonzahMode = input.mode;
    if (input.username) patch.bonzahUsername = input.username;
    if (input.password) {
      patch.bonzahPasswordEncrypted = this.credentialsService.encryptPassword(
        input.password,
      );
    }
    if (input.brochureUrl !== undefined)
      patch.bonzahBrochureUrl = input.brochureUrl;

    // Toggle the integration flag based on effective connection state
    const effectiveUsername =
      input.username ?? existing.username ?? null;
    const nextConnected =
      nextMode === BonzahMode.LIVE
        ? Boolean(effectiveUsername && (input.password || existing.username))
        : Boolean(env.BONZAH_PLATFORM_USERNAME && env.BONZAH_PLATFORM_PASSWORD);
    patch.integrationBonzah = nextConnected;

    // Invalidate any cached token for the previous credentials pair
    if (existing.username) {
      const prevUrl =
        existing.mode === BonzahMode.LIVE
          ? env.BONZAH_API_URL_LIVE
          : env.BONZAH_API_URL_SANDBOX;
      this.tokenCache.invalidate(existing.username, prevUrl);
    }

    await this.db
      .update(tenants)
      .set(patch)
      .where(eq(tenants.id, tenantId));

    return this.getConnection();
  }

  // --- Balance ---------------------------------------------------------

  async getBalance(): Promise<BonzahBalanceResponse> {
    const tenantId = this.ctx.requireTenantId();
    const creds = await this.credentialsService.loadForTenant(tenantId);

    let data: BonzahBalanceData;
    try {
      data = await this.apiClient.call<BonzahBalanceData>(
        tenantId,
        'GET',
        BONZAH_PATHS.CD_BALANCE,
      );
    } catch (err) {
      if (err instanceof BonzahNotConfiguredError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }

    const brokerBalance = Number(data.amount ?? 0);
    const config = await this.loadAlertConfig();
    const alertLevel = computeAlertLevel(brokerBalance, config);

    // Emit or resolve reminder based on current state
    if (alertLevel === 'none' || !config.enabled) {
      await this.remindersService.resolveByRule(
        tenantId,
        REMINDER_RULE_CODES.BONZAH_LOW_BALANCE,
      );
    } else {
      await this.remindersService.upsertByRule(
        tenantId,
        REMINDER_RULE_CODES.BONZAH_LOW_BALANCE,
        {
          objectType: 'Integration',
          title:
            alertLevel === 'critical'
              ? 'Bonzah balance critically low'
              : 'Bonzah balance running low',
          message:
            `Current balance is ${brokerBalance.toFixed(2)}, below your ` +
            `configured threshold of ${config.threshold.toFixed(2)}.`,
          severity:
            alertLevel === 'critical'
              ? ReminderSeverity.CRITICAL
              : ReminderSeverity.WARNING,
          context: { brokerBalance, threshold: config.threshold },
        },
      );
    }

    return {
      brokerBalance,
      allocatedBalance: null,
      mode: creds.mode,
      currency: 'USD',
      asOf: data.as_on,
      threshold: config.enabled ? config.threshold : null,
      alertLevel: config.enabled ? alertLevel : 'none',
    };
  }

  // --- Alert config ----------------------------------------------------

  async getAlertConfig(): Promise<BonzahAlertConfigResponse> {
    return this.loadAlertConfig();
  }

  async updateAlertConfig(
    input: AlertConfigPayload,
  ): Promise<BonzahAlertConfigResponse> {
    const current = await this.loadAlertConfig();
    const next = {
      enabled: input.enabled ?? current.enabled,
      threshold: input.threshold ?? current.threshold,
    };
    await this.remindersService.upsertConfig(BONZAH_ALERT_CONFIG_KEY, next);
    return next;
  }

  // -----------------------------------------------------------------------

  private async loadAlertConfig(): Promise<BonzahAlertConfigResponse> {
    const stored = await this.remindersService.getConfig(
      BONZAH_ALERT_CONFIG_KEY,
    );
    const value = stored?.configValue as Record<string, unknown> | undefined;
    return {
      enabled: Boolean(value?.enabled ?? false),
      threshold: Number(value?.threshold ?? DEFAULT_ALERT_THRESHOLD),
    };
  }
}

function computeAlertLevel(
  balance: number,
  config: BonzahAlertConfigResponse,
): BonzahAlertLevel {
  if (!config.enabled) return 'none';
  if (balance <= config.threshold * 0.5) return 'critical';
  if (balance <= config.threshold) return 'warning';
  return 'none';
}
