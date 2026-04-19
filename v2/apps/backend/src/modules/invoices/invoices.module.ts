import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoiceItemsController } from './invoice-items.controller';
import { InvoicesService } from './invoices.service';

@Module({
  controllers: [InvoicesController, InvoiceItemsController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
