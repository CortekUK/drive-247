import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  SQL,
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  sql,
} from 'drizzle-orm';
import {
  customers,
  invoiceItems,
  invoices,
  payments,
  rentals,
  tenants,
  vehicles,
} from '@drive247/database';
import { InvoiceStatus, DiscountType } from '@drive247/shared-types';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';
import { TenantContextService } from '../../common/context/tenant-context.service';
import type { CreateInvoiceDto } from './dto/create-invoice.dto';
import type { UpdateInvoiceDto } from './dto/update-invoice.dto';
import type { ListInvoicesDto } from './dto/list-invoices.dto';

type InvoiceRow = typeof invoices.$inferSelect;
type InvoiceItemRow = typeof invoiceItems.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;

const TERMINAL_STATUSES = new Set<string>([
  InvoiceStatus.VOID,
  InvoiceStatus.REFUNDED,
]);

@Injectable()
export class InvoicesService {
  constructor(
    @Inject(DATABASE) private db: Database,
    private ctx: TenantContextService,
  ) {}

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  async list(query: ListInvoicesDto) {
    const tenantId = this.ctx.requireTenantId();
    const { search, status, customerId, rentalId, dateFrom, dateTo, page, limit } = query;

    const conditions: SQL[] = [eq(invoices.tenantId, tenantId)];
    if (status) conditions.push(eq(invoices.status, status));
    if (customerId) conditions.push(eq(invoices.customerId, customerId));
    if (rentalId) conditions.push(eq(invoices.rentalId, rentalId));
    if (search) conditions.push(ilike(invoices.invoiceNumber, `%${search}%`));
    if (dateFrom) conditions.push(gte(invoices.createdAt, dateFrom));
    if (dateTo) conditions.push(lte(invoices.createdAt, dateTo));

    const where = and(...conditions);

    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select({
          invoice: invoices,
          customer: {
            id: customers.id,
            name: customers.name,
            email: customers.email,
          },
          rental: {
            id: rentals.id,
            startDate: rentals.startDate,
            endDate: rentals.endDate,
          },
        })
        .from(invoices)
        .innerJoin(customers, eq(customers.id, invoices.customerId))
        .leftJoin(rentals, eq(rentals.id, invoices.rentalId))
        .where(where)
        .orderBy(desc(invoices.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
      this.db
        .select({ count: count() })
        .from(invoices)
        .where(where),
    ]);

    return {
      items: rows.map((r) => this.shapeListRow(r.invoice, r.customer, r.rental)),
      meta: { page, limit, total: totalRow?.count ?? 0 },
    };
  }

  async getById(id: string) {
    const tenantId = this.ctx.requireTenantId();

    const [row] = await this.db
      .select({
        invoice: invoices,
        customer: {
          id: customers.id,
          name: customers.name,
          email: customers.email,
        },
        rental: {
          id: rentals.id,
          startDate: rentals.startDate,
          endDate: rentals.endDate,
        },
      })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .leftJoin(rentals, eq(rentals.id, invoices.rentalId))
      .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)))
      .limit(1);

    if (!row) throw new NotFoundException('Invoice not found');

    const [itemRows, paymentRows] = await Promise.all([
      this.db
        .select()
        .from(invoiceItems)
        .where(
          and(
            eq(invoiceItems.invoiceId, id),
            eq(invoiceItems.tenantId, tenantId),
          ),
        )
        .orderBy(invoiceItems.createdAt),
      this.db
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.invoiceId, id),
            eq(payments.tenantId, tenantId),
          ),
        )
        .orderBy(desc(payments.paidAt)),
    ]);

    return {
      ...this.shapeDetailRow(row.invoice, row.customer, row.rental),
      items: itemRows.map(shapeItem),
      payments: paymentRows.map(shapePayment),
    };
  }

  // -----------------------------------------------------------------------
  // Mutations
  // -----------------------------------------------------------------------

  async create(input: CreateInvoiceDto) {
    const tenantId = this.ctx.requireTenantId();

    await this.assertCustomerBelongsToTenant(tenantId, input.customerId);
    if (input.rentalId) {
      await this.assertRentalBelongsToTenant(tenantId, input.rentalId);
    }

    const tenant = await this.loadTenant(tenantId);
    const invoiceNumber = await this.nextInvoiceNumber(tenantId);

    const [created] = await this.db
      .insert(invoices)
      .values({
        tenantId,
        customerId: input.customerId,
        rentalId: input.rentalId ?? null,
        invoiceNumber,
        status: 'draft',
        taxRate: tenant.taxRate,
        taxLabel: tenant.taxLabel,
        taxInclusive: tenant.taxInclusive,
        discountType: input.discountType ?? null,
        discountValue: input.discountValue ?? null,
        dueDate: toDateString(input.dueDate),
        notes: input.notes ?? null,
      })
      .returning();

    for (const item of input.items) {
      const { discountAmount, lineTotal } = calcLineTotals(item);
      await this.db.insert(invoiceItems).values({
        tenantId,
        invoiceId: created.id,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountType: item.discountType ?? null,
        discountValue: item.discountValue ?? null,
        discountAmount,
        lineTotal,
      });
    }

    await this.recalc(created.id);
    return this.getById(created.id);
  }

  async update(id: string, input: UpdateInvoiceDto) {
    const tenantId = this.ctx.requireTenantId();
    const existing = await this.loadExisting(id, tenantId);
    this.assertEditable(existing);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.dueDate !== undefined) patch.dueDate = toDateString(input.dueDate);
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.discountType !== undefined)
      patch.discountType = input.discountType;
    if (input.discountValue !== undefined)
      patch.discountValue = input.discountValue;

    await this.db
      .update(invoices)
      .set(patch)
      .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)));

    await this.recalc(id);
    return this.getById(id);
  }

  async remove(id: string) {
    const tenantId = this.ctx.requireTenantId();
    const existing = await this.loadExisting(id, tenantId);
    if (existing.status !== InvoiceStatus.DRAFT) {
      throw new ConflictException(
        'Only DRAFT invoices can be deleted. Void instead.',
      );
    }

    const [paymentRow] = await this.db
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.invoiceId, id), eq(payments.tenantId, tenantId)))
      .limit(1);
    if (paymentRow) {
      throw new ConflictException(
        'Cannot delete an invoice that has payments. Refund first.',
      );
    }

    await this.db
      .delete(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)));

    return { success: true };
  }

  async void(id: string) {
    const tenantId = this.ctx.requireTenantId();
    const existing = await this.loadExisting(id, tenantId);

    if (existing.status === InvoiceStatus.VOID) {
      throw new ConflictException('Invoice is already void');
    }
    if (existing.amountPaid > 0) {
      throw new ConflictException(
        'Cannot void an invoice with payments. Refund all payments first.',
      );
    }

    await this.db
      .update(invoices)
      .set({ status: 'void', updatedAt: new Date() })
      .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)));

    return this.getById(id);
  }

  // -----------------------------------------------------------------------
  // Auto-create for rental (called from RentalsService)
  // -----------------------------------------------------------------------

  async autoCreateForRental(rental: {
    id: string;
    tenantId: string;
    customerId: string;
    vehicleId: string;
    startDate: string;
    endDate: string;
    totalAmount: string;
  }) {
    const tenant = await this.loadTenant(rental.tenantId);
    const invoiceNumber = await this.nextInvoiceNumber(rental.tenantId);

    const [veh] = await this.db
      .select({ reg: vehicles.reg })
      .from(vehicles)
      .where(eq(vehicles.id, rental.vehicleId))
      .limit(1);

    const unitPriceCents = Math.round(Number(rental.totalAmount) * 100);
    const description = `Rental — ${veh?.reg ?? 'Vehicle'} (${rental.startDate} to ${rental.endDate})`;

    const [created] = await this.db
      .insert(invoices)
      .values({
        tenantId: rental.tenantId,
        customerId: rental.customerId,
        rentalId: rental.id,
        invoiceNumber,
        status: 'draft',
        taxRate: tenant.taxRate,
        taxLabel: tenant.taxLabel,
        taxInclusive: tenant.taxInclusive,
        dueDate: rental.startDate,
      })
      .returning();

    const { discountAmount, lineTotal } = calcLineTotals({
      quantity: 1,
      unitPrice: unitPriceCents,
      discountType: null,
      discountValue: null,
    });

    await this.db.insert(invoiceItems).values({
      tenantId: rental.tenantId,
      invoiceId: created.id,
      description,
      quantity: 1,
      unitPrice: unitPriceCents,
      discountAmount,
      lineTotal,
    });

    await this.recalc(created.id);
    return created.id;
  }

  // -----------------------------------------------------------------------
  // Line items
  // -----------------------------------------------------------------------

  async addItem(
    invoiceId: string,
    input: {
      description: string;
      quantity: number;
      unitPrice: number;
      discountType?: DiscountType | null;
      discountValue?: number | null;
    },
  ) {
    const tenantId = this.ctx.requireTenantId();
    const invoice = await this.loadExisting(invoiceId, tenantId);
    this.assertEditable(invoice);

    const { discountAmount, lineTotal } = calcLineTotals(input);

    const [created] = await this.db
      .insert(invoiceItems)
      .values({
        tenantId,
        invoiceId,
        description: input.description,
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        discountType: input.discountType ?? null,
        discountValue: input.discountValue ?? null,
        discountAmount,
        lineTotal,
      })
      .returning();

    await this.recalc(invoiceId);
    return shapeItem(created);
  }

  async updateItem(
    invoiceId: string,
    itemId: string,
    input: Partial<{
      description: string;
      quantity: number;
      unitPrice: number;
      discountType: DiscountType | null;
      discountValue: number | null;
    }>,
  ) {
    const tenantId = this.ctx.requireTenantId();
    const invoice = await this.loadExisting(invoiceId, tenantId);
    this.assertEditable(invoice);

    const [existing] = await this.db
      .select()
      .from(invoiceItems)
      .where(
        and(
          eq(invoiceItems.id, itemId),
          eq(invoiceItems.invoiceId, invoiceId),
          eq(invoiceItems.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!existing) throw new NotFoundException('Line item not found');

    const merged = {
      description: input.description ?? existing.description,
      quantity: input.quantity ?? existing.quantity,
      unitPrice: input.unitPrice ?? existing.unitPrice,
      discountType:
        input.discountType !== undefined
          ? input.discountType
          : (existing.discountType as DiscountType | null),
      discountValue:
        input.discountValue !== undefined
          ? input.discountValue
          : existing.discountValue,
    };

    const { discountAmount, lineTotal } = calcLineTotals(merged);

    const [updated] = await this.db
      .update(invoiceItems)
      .set({
        description: merged.description,
        quantity: merged.quantity,
        unitPrice: merged.unitPrice,
        discountType: merged.discountType ?? null,
        discountValue: merged.discountValue ?? null,
        discountAmount,
        lineTotal,
      })
      .where(
        and(
          eq(invoiceItems.id, itemId),
          eq(invoiceItems.tenantId, tenantId),
        ),
      )
      .returning();

    await this.recalc(invoiceId);
    return shapeItem(updated);
  }

  async removeItem(invoiceId: string, itemId: string) {
    const tenantId = this.ctx.requireTenantId();
    const invoice = await this.loadExisting(invoiceId, tenantId);
    this.assertEditable(invoice);

    const deleted = await this.db
      .delete(invoiceItems)
      .where(
        and(
          eq(invoiceItems.id, itemId),
          eq(invoiceItems.invoiceId, invoiceId),
          eq(invoiceItems.tenantId, tenantId),
        ),
      )
      .returning({ id: invoiceItems.id });

    if (deleted.length === 0) {
      throw new NotFoundException('Line item not found');
    }

    // An invoice must always have at least one line item
    const remaining = await this.db
      .select({ id: invoiceItems.id })
      .from(invoiceItems)
      .where(
        and(
          eq(invoiceItems.invoiceId, invoiceId),
          eq(invoiceItems.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (remaining.length === 0) {
      throw new BadRequestException(
        'An invoice must have at least one line item',
      );
    }

    await this.recalc(invoiceId);
    return { success: true };
  }

  // -----------------------------------------------------------------------
  // Recalculation — idempotent
  // -----------------------------------------------------------------------

  async recalc(invoiceId: string) {
    const tenantId = this.ctx.requireTenantId();
    const [invoice] = await this.db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)))
      .limit(1);
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (TERMINAL_STATUSES.has(invoice.status)) return;

    const items = await this.db
      .select()
      .from(invoiceItems)
      .where(
        and(
          eq(invoiceItems.invoiceId, invoiceId),
          eq(invoiceItems.tenantId, tenantId),
        ),
      );
    const subtotal = items.reduce((acc, it) => acc + it.lineTotal, 0);

    const invoiceDiscountAmount = calcInvoiceDiscount(
      subtotal,
      invoice.discountType as DiscountType | null,
      invoice.discountValue,
    );
    const preTax = Math.max(0, subtotal - invoiceDiscountAmount);

    const taxRate = Number(invoice.taxRate);
    let taxAmount = 0;
    let totalAmount = preTax;
    if (taxRate > 0) {
      if (invoice.taxInclusive) {
        const preTaxNet = Math.round((preTax * 100) / (100 + taxRate));
        taxAmount = preTax - preTaxNet;
        totalAmount = preTax;
      } else {
        taxAmount = Math.round((preTax * taxRate) / 100);
        totalAmount = preTax + taxAmount;
      }
    }

    // Sum both 'succeeded' payments and 'refunded' originals.
    // A fully-refunded original (status='refunded') keeps its positive amount;
    // its linked negative refund (status='succeeded') cancels it out in the net.
    const paymentRows = await this.db
      .select({ amount: payments.amount })
      .from(payments)
      .where(
        and(
          eq(payments.invoiceId, invoiceId),
          eq(payments.tenantId, tenantId),
          inArray(payments.status, ['succeeded', 'refunded']),
        ),
      );
    const amountPaid = paymentRows.reduce((acc, p) => acc + p.amount, 0);
    const amountDue = totalAmount - amountPaid;

    let nextStatus = invoice.status as InvoiceStatus;
    const hasAnyPayment = paymentRows.length > 0;

    if (invoice.status === InvoiceStatus.DRAFT && !hasAnyPayment) {
      nextStatus = InvoiceStatus.DRAFT;
    } else if (hasAnyPayment && amountPaid === 0 && totalAmount > 0) {
      nextStatus = InvoiceStatus.REFUNDED;
    } else if (amountPaid >= totalAmount && totalAmount > 0) {
      nextStatus = InvoiceStatus.PAID;
    } else if (amountPaid > 0 && amountPaid < totalAmount) {
      nextStatus = InvoiceStatus.PARTIALLY_PAID;
    }

    await this.db
      .update(invoices)
      .set({
        subtotal,
        discountAmount: invoiceDiscountAmount,
        taxAmount,
        totalAmount,
        amountPaid,
        amountDue,
        status: nextStatus,
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)));
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private async loadExisting(id: string, tenantId: string) {
    const [row] = await this.db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)))
      .limit(1);
    if (!row) throw new NotFoundException('Invoice not found');
    return row;
  }

  private assertEditable(invoice: InvoiceRow) {
    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new ConflictException(
        'Invoice can only be edited while in DRAFT status',
      );
    }
  }

  private async loadTenant(tenantId: string) {
    const [row] = await this.db
      .select({
        slug: tenants.slug,
        taxRate: tenants.taxRate,
        taxLabel: tenants.taxLabel,
        taxInclusive: tenants.taxInclusive,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!row) throw new NotFoundException('Tenant not found');
    return row;
  }

  private async assertCustomerBelongsToTenant(
    tenantId: string,
    customerId: string,
  ) {
    const [row] = await this.db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
      .limit(1);
    if (!row) throw new NotFoundException('Customer not found');
  }

  private async assertRentalBelongsToTenant(
    tenantId: string,
    rentalId: string,
  ) {
    const [row] = await this.db
      .select({ id: rentals.id })
      .from(rentals)
      .where(and(eq(rentals.id, rentalId), eq(rentals.tenantId, tenantId)))
      .limit(1);
    if (!row) throw new NotFoundException('Rental not found');
  }

  /**
   * Atomic per-tenant invoice number generation via UPDATE ... RETURNING,
   * which acquires a row-level lock. The sequence never repeats.
   */
  private async nextInvoiceNumber(tenantId: string): Promise<string> {
    const result = await this.db.execute<{
      slug: string;
      invoice_sequence: number;
    }>(sql`
      UPDATE tenants
         SET invoice_sequence = invoice_sequence + 1,
             updated_at = now()
       WHERE id = ${tenantId}
       RETURNING slug, invoice_sequence
    `);

    const row = (result as unknown as { rows: Array<{ slug: string; invoice_sequence: number }> }).rows?.[0]
      ?? (Array.isArray(result) ? (result as Array<{ slug: string; invoice_sequence: number }>)[0] : undefined);
    if (!row) throw new NotFoundException('Tenant not found');

    const year = new Date().getFullYear();
    const padded = String(row.invoice_sequence).padStart(4, '0');
    return `${row.slug.toUpperCase()}-INV-${year}-${padded}`;
  }

  // -----------------------------------------------------------------------
  // Shaping helpers
  // -----------------------------------------------------------------------

  private shapeListRow(
    invoice: InvoiceRow,
    customer: { id: string; name: string; email: string | null },
    rental: {
      id: string | null;
      startDate: string | null;
      endDate: string | null;
    } | null,
  ) {
    return {
      id: invoice.id,
      tenantId: invoice.tenantId,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      subtotal: invoice.subtotal,
      discountAmount: invoice.discountAmount,
      taxRate: invoice.taxRate,
      taxLabel: invoice.taxLabel,
      taxInclusive: invoice.taxInclusive,
      taxAmount: invoice.taxAmount,
      totalAmount: invoice.totalAmount,
      amountPaid: invoice.amountPaid,
      amountDue: invoice.amountDue,
      dueDate: invoice.dueDate,
      createdAt: invoice.createdAt.toISOString(),
      updatedAt: invoice.updatedAt.toISOString(),
      customer,
      rental:
        rental && rental.id
          ? {
              id: rental.id,
              startDate: rental.startDate!,
              endDate: rental.endDate!,
            }
          : null,
    };
  }

  private shapeDetailRow(
    invoice: InvoiceRow,
    customer: { id: string; name: string; email: string | null },
    rental: {
      id: string | null;
      startDate: string | null;
      endDate: string | null;
    } | null,
  ) {
    return {
      ...this.shapeListRow(invoice, customer, rental),
      discountType: invoice.discountType,
      discountValue: invoice.discountValue,
      notes: invoice.notes,
    };
  }
}

// -------------------------------------------------------------------------
// Pure helpers
// -------------------------------------------------------------------------

export function calcLineTotals(input: {
  quantity: number;
  unitPrice: number;
  discountType?: DiscountType | null;
  discountValue?: number | null;
}): { discountAmount: number; lineTotal: number } {
  const gross = input.quantity * input.unitPrice;
  let discountAmount = 0;
  if (input.discountType && input.discountValue != null) {
    if (input.discountType === DiscountType.PERCENTAGE) {
      discountAmount = Math.round((gross * input.discountValue) / 100);
    } else {
      discountAmount = input.discountValue;
    }
    if (discountAmount > gross) discountAmount = gross;
  }
  return { discountAmount, lineTotal: gross - discountAmount };
}

export function calcInvoiceDiscount(
  subtotal: number,
  type: DiscountType | null,
  value: number | null,
): number {
  if (!type || value == null) return 0;
  let amount =
    type === DiscountType.PERCENTAGE
      ? Math.round((subtotal * value) / 100)
      : value;
  if (amount > subtotal) amount = subtotal;
  return amount;
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shapeItem(row: InvoiceItemRow) {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    description: row.description,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    discountType: row.discountType,
    discountValue: row.discountValue,
    discountAmount: row.discountAmount,
    lineTotal: row.lineTotal,
    createdAt: row.createdAt.toISOString(),
  };
}

function shapePayment(row: PaymentRow) {
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
