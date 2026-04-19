import { Module } from '@nestjs/common';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';

/**
 * Generic reminders module. Bonzah low-balance is the first consumer.
 * Future features (overdue invoices, MOT expiry, rental pickup reminders)
 * will reuse the same tables and service via `upsertByRule`.
 */
@Module({
  controllers: [RemindersController],
  providers: [RemindersService],
  exports: [RemindersService],
})
export class RemindersModule {}
