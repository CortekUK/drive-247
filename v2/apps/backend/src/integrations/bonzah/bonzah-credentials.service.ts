import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { tenants } from '@drive247/database';
import { BonzahMode } from '@drive247/shared-types';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';
import { getEnv } from '../../config/env.config';
import { encrypt, decrypt } from '../../common/utils/crypto.util';
import { BonzahNotConfiguredError } from './errors';
import type { ResolvedBonzahCredentials } from './types';

/**
 * Loads per-tenant Bonzah credentials, handles encryption at rest, and
 * resolves the correct API URL for the tenant's mode.
 *
 * Test mode:
 *   - Returns the platform-shared sandbox credentials from env
 *   - If platform creds aren't configured, throws BonzahNotConfiguredError
 *
 * Live mode:
 *   - Decrypts the tenant's own credentials
 *   - If credentials aren't stored, throws BonzahNotConfiguredError
 *
 * **Never** logs or returns the plaintext password outside this service.
 */
@Injectable()
export class BonzahCredentialsService {
  constructor(@Inject(DATABASE) private db: Database) {}

  async loadForTenant(tenantId: string): Promise<ResolvedBonzahCredentials> {
    const env = getEnv();

    const [tenant] = await this.db
      .select({
        mode: tenants.bonzahMode,
        username: tenants.bonzahUsername,
        passwordEncrypted: tenants.bonzahPasswordEncrypted,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      throw new BonzahNotConfiguredError('Tenant not found');
    }

    const mode = tenant.mode as BonzahMode;
    const apiUrl =
      mode === BonzahMode.LIVE
        ? env.BONZAH_API_URL_LIVE
        : env.BONZAH_API_URL_SANDBOX;

    if (mode === BonzahMode.TEST) {
      if (!env.BONZAH_PLATFORM_USERNAME || !env.BONZAH_PLATFORM_PASSWORD) {
        throw new BonzahNotConfiguredError(
          'Bonzah platform sandbox credentials are not configured on the server',
        );
      }
      return {
        username: env.BONZAH_PLATFORM_USERNAME,
        password: env.BONZAH_PLATFORM_PASSWORD,
        mode,
        apiUrl,
      };
    }

    // Live mode — tenant must have their own credentials
    if (!tenant.username || !tenant.passwordEncrypted) {
      throw new BonzahNotConfiguredError(
        'Tenant has not configured Bonzah live credentials',
      );
    }

    const password = this.decryptPassword(tenant.passwordEncrypted);
    return {
      username: tenant.username,
      password,
      mode,
      apiUrl,
    };
  }

  /**
   * Encrypts a plaintext password for storage in tenants.bonzah_password_encrypted.
   * Only callers inside the Bonzah domain (settings update flow) should use this.
   */
  encryptPassword(plaintext: string): string {
    return encrypt(plaintext, this.getKey());
  }

  /**
   * Decrypts a stored password. Kept private-by-convention — used internally
   * by loadForTenant(). Not exposed anywhere that logs or renders.
   */
  private decryptPassword(ciphertext: string): string {
    try {
      return decrypt(ciphertext, this.getKey());
    } catch {
      throw new InternalServerErrorException(
        'Failed to decrypt Bonzah credentials — encryption key may have been rotated',
      );
    }
  }

  private getKey(): string {
    return getEnv().BONZAH_CREDS_ENCRYPTION_KEY;
  }
}
