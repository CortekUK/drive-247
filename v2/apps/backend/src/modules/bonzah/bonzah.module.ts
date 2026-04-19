import { Module } from '@nestjs/common';
import { RemindersModule } from '../reminders/reminders.module';
import { BonzahController } from './bonzah.controller';
import { BonzahPoliciesController } from './bonzah-policies.controller';
import { BonzahService } from './bonzah.service';
import { BonzahPremiumService } from './bonzah-premium.service';
import { BonzahEligibilityService } from './bonzah-eligibility.service';
import { BonzahQuoteService } from './bonzah-quote.service';
import { BonzahPaymentService } from './bonzah-payment.service';
import { BonzahPolicyService } from './bonzah-policy.service';

/**
 * Bonzah feature module.
 *
 * Depends on:
 *   - BonzahIntegrationModule (global) — low-level API client + credentials
 *   - OpenAIIntegrationModule  (global) — vehicle eligibility fuzzy-match
 *   - RemindersModule — low-balance + insufficient-balance reminder emission
 */
@Module({
  imports: [RemindersModule],
  controllers: [BonzahController, BonzahPoliciesController],
  providers: [
    BonzahService,
    BonzahPremiumService,
    BonzahEligibilityService,
    BonzahPolicyService,
    BonzahQuoteService,
    BonzahPaymentService,
  ],
  exports: [BonzahPolicyService],
})
export class BonzahModule {}
