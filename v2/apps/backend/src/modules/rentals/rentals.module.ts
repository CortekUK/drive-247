import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module';
import { RentalsController } from './rentals.controller';
import { RentalsService } from './rentals.service';

@Module({
  imports: [InvoicesModule],
  controllers: [RentalsController],
  providers: [RentalsService],
})
export class RentalsModule {}
