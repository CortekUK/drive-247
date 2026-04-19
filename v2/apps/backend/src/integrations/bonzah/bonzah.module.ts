import { Global, Module } from '@nestjs/common';
import { BonzahTokenCache } from './bonzah-token-cache.service';
import { BonzahCredentialsService } from './bonzah-credentials.service';
import { BonzahApiClient } from './bonzah-api.client';

/**
 * Bonzah integration layer.
 *
 * Global module because multiple feature modules (bonzah, future: booking,
 * extensions, cancellations) need the client and credentials service.
 *
 * Exports:
 *  - BonzahApiClient          — authenticated HTTP client for Bonzah
 *  - BonzahCredentialsService — tenant credential loader + encryption
 *  - BonzahTokenCache         — exposed for tests + diagnostics
 */
@Global()
@Module({
  providers: [BonzahTokenCache, BonzahCredentialsService, BonzahApiClient],
  exports: [BonzahTokenCache, BonzahCredentialsService, BonzahApiClient],
})
export class BonzahIntegrationModule {}
