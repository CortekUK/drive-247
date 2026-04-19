import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { invoices, payments } from '@drive247/database';
import { InvoiceStatus, PaymentStatus } from '@drive247/shared-types';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { InvoicesService } from '../invoices/invoices.service';
import type { RecordPaymentDto } from './dto/record-payment.dto';
import type { RefundPaymentDto } from './dto/refund-payment.dto';

type PaymentRow = typeof payments.$inferSelect;

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(DATABASE) private db: Database,
    private ctx: TenantContextService,
    private invoicesService: InvoicesService,
  ) {}

  async record(invoiceId: string, input: RecordPaymentDto) {
    const tenantId = this.ctx.requireTenantId();
    const invoice = await this.loadInvoice(invoiceId, tenantId);

    if (
      invoice.status === InvoiceStatus.VOID ||
      invoice.status === InvoiceStatus.REFUNDED
    ) {
      throw new ConflictException(
        `Cannot record a payment on a ${invoice.status} invoice`,
      );
    }

    if (input.amount > invoice.amountDue) {
      throw new BadRequestException(
        `Amount exceeds amount due (${invoice.amountDue} cents)`,
      );
    }

    const paidAt = input.paidAt ?? new Date();

    const [created] = await this.db
      .insert(payments)
      .values({
        tenantId,
        invoiceId,
        type: 'payment',
        amount: input.amount,
        paymentMethod: input.paymentMethod,
        paymentGateway: 'manual',
        status: 'succeeded',
        notes: input.notes ?? null,
        paidAt,
      })
      .returning();

    await this.invoicesService.recalc(invoiceId);
    return this.shape(created);
  }

  async refund(
    invoiceId: string,
    paymentId: string,
    input: RefundPaymentDto,
  ) {
    const tenantId = this.ctx.requireTenantId();
    await this.loadInvoice(invoiceId, tenantId);

    const [original] = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.id, paymentId),
          eq(payments.invoiceId, invoiceId),
          eq(payments.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!original) throw new NotFoundException('Payment not found');
    if (original.type !== 'payment') {
      throw new ConflictException(
        'Only original payments can be refunded (not refunds)',
      );
    }
    if (original.status === PaymentStatus.REFUNDED) {
      throw new ConflictException('Payment is already fully refunded');
    }

    // Sum existing refunds against this payment
    const existingRefunds = await this.db
      .select({ amount: payments.amount })
      .from(payments)
      .where(
        and(
          eq(payments.tenantId, tenantId),
          eq(payments.linkedPaymentId, paymentId),
          eq(payments.status, 'succeeded'),
        ),
      );
    const alreadyRefunded = existingRefunds.reduce(
      (acc, r) => acc + Math.abs(r.amount),
      0,
    );
    const refundable = original.amount - alreadyRefunded;

    if (input.amount > refundable) {
      throw new BadRequestException(
        `Refund exceeds refundable balance (${refundable} cents)`,
      );
    }

    const [refund] = await this.db
      .insert(payments)
      .values({
        tenantId,
        invoiceId,
        type: 'refund',
        amount: -input.amount,
        paymentMethod: original.paymentMethod,
        paymentGateway: 'manual',
        linkedPaymentId: paymentId,
        status: 'succeeded',
        notes: input.notes ?? null,
        paidAt: new Date(),
      })
      .returning();

    // Mark original as refunded if fully refunded
    if (alreadyRefunded + input.amount >= original.amount) {
      await this.db
        .update(payments)
        .set({ status: 'refunded', updatedAt: new Date() })
        .where(
          and(
            eq(payments.id, paymentId),
            eq(payments.tenantId, tenantId),
          ),
        );
    }

    await this.invoicesService.recalc(invoiceId);
    return this.shape(refund);
  }

  private async loadInvoice(invoiceId: string, tenantId: string) {
    const [row] = await this.db
      .select()
      .from(invoices)
      .where(
        and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Invoice not found');
    return row;
  }

  private shape(row: PaymentRow) {
    return {
      id: row.id,
      invoiceId: row.invoiceId,
      type: row.type,
      amount: row.amount,
      paymentMethod: row.paymentMethod,
      paymentGateway: row.paymentGateway,
      gatewayTransactionId: row.gatewayTransactionId,
      linkedPaymentId: row.linkedPaymentId,
      status: row.status,
      notes: row.notes,
      paidAt: row.paidAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
