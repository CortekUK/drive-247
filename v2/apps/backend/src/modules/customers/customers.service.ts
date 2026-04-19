import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, desc, eq, ilike, ne, or, sql } from 'drizzle-orm';
import { customers, invoices, payments } from '@drive247/database';
import { InvoiceStatus } from '@drive247/shared-types';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';
import { TenantContextService } from '../../common/context/tenant-context.service';
import type { CreateCustomerDto } from './dto/create-customer.dto';
import type { UpdateCustomerDto } from './dto/update-customer.dto';
import type { ListCustomersDto } from './dto/list-customers.dto';

@Injectable()
export class CustomersService {
  constructor(
    @Inject(DATABASE) private db: Database,
    private ctx: TenantContextService,
  ) {}

  async list(query: ListCustomersDto) {
    const tenantId = this.ctx.requireTenantId();
    const { search, status, page, limit } = query;

    const conditions = [eq(customers.tenantId, tenantId)];

    if (search) {
      const like = `%${search}%`;
      conditions.push(
        or(
          ilike(customers.name, like),
          ilike(customers.email, like),
          ilike(customers.phone, like),
        )!,
      );
    }

    if (status) {
      conditions.push(eq(customers.status, status));
    }

    const where = and(...conditions);

    // Subquery: outstanding balance per customer (non-void, non-refunded invoices)
    const balanceSq = this.db
      .select({
        customerId: invoices.customerId,
        balance: sql<number>`COALESCE(SUM(${invoices.amountDue}), 0)`.as(
          'balance',
        ),
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          ne(invoices.status, InvoiceStatus.VOID),
          ne(invoices.status, InvoiceStatus.REFUNDED),
        ),
      )
      .groupBy(invoices.customerId)
      .as('balance_sq');

    const [items, [totalRow]] = await Promise.all([
      this.db
        .select({
          customer: customers,
          outstandingBalance: sql<number>`COALESCE(${balanceSq.balance}, 0)`,
        })
        .from(customers)
        .leftJoin(balanceSq, eq(balanceSq.customerId, customers.id))
        .where(where)
        .orderBy(customers.createdAt)
        .limit(limit)
        .offset((page - 1) * limit),
      this.db.select({ count: count() }).from(customers).where(where),
    ]);

    return {
      items: items.map((row) => ({
        ...row.customer,
        outstandingBalance: Number(row.outstandingBalance) || 0,
      })),
      meta: {
        page,
        limit,
        total: totalRow?.count ?? 0,
      },
    };
  }

  async getFinancials(id: string) {
    const tenantId = this.ctx.requireTenantId();

    // Verify customer belongs to tenant
    const [customer] = await this.db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.tenantId, tenantId)))
      .limit(1);
    if (!customer) throw new NotFoundException('Customer not found');

    const [totals] = await this.db
      .select({
        totalInvoiced: sql<number>`COALESCE(SUM(${invoices.totalAmount}), 0)`,
        totalPaid: sql<number>`COALESCE(SUM(${invoices.amountPaid}), 0)`,
        outstanding: sql<number>`COALESCE(SUM(CASE WHEN ${invoices.status} NOT IN ('void', 'refunded') THEN ${invoices.amountDue} ELSE 0 END), 0)`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.customerId, id),
          ne(invoices.status, InvoiceStatus.VOID),
        ),
      );

    // Last successful payment across this customer's invoices
    const [lastPayment] = await this.db
      .select({ paidAt: payments.paidAt })
      .from(payments)
      .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .where(
        and(
          eq(payments.tenantId, tenantId),
          eq(invoices.customerId, id),
          eq(payments.type, 'payment'),
          eq(payments.status, 'succeeded'),
        ),
      )
      .orderBy(desc(payments.paidAt))
      .limit(1);

    return {
      totalInvoiced: Number(totals?.totalInvoiced ?? 0),
      totalPaid: Number(totals?.totalPaid ?? 0),
      outstanding: Number(totals?.outstanding ?? 0),
      lastPaymentAt: lastPayment ? lastPayment.paidAt.toISOString() : null,
    };
  }

  async getById(id: string) {
    const tenantId = this.ctx.requireTenantId();

    const [customer] = await this.db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.tenantId, tenantId)))
      .limit(1);

    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async create(input: CreateCustomerDto) {
    const tenantId = this.ctx.requireTenantId();

    if (input.email) {
      await this.assertEmailAvailable(tenantId, input.email);
    }

    const [created] = await this.db
      .insert(customers)
      .values({
        tenantId,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        status: input.status,
      })
      .returning();

    return created;
  }

  async update(id: string, input: UpdateCustomerDto) {
    const tenantId = this.ctx.requireTenantId();

    const [existing] = await this.db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.tenantId, tenantId)))
      .limit(1);

    if (!existing) throw new NotFoundException('Customer not found');

    if (
      input.email !== undefined &&
      input.email &&
      input.email !== existing.email
    ) {
      await this.assertEmailAvailable(tenantId, input.email);
    }

    const nextEmail =
      input.email !== undefined ? input.email ?? null : existing.email;
    const nextPhone =
      input.phone !== undefined ? input.phone ?? null : existing.phone;

    if (!nextEmail && !nextPhone) {
      throw new ConflictException('Customer must have at least an email or phone');
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.email !== undefined) patch.email = input.email ?? null;
    if (input.phone !== undefined) patch.phone = input.phone ?? null;
    if (input.status !== undefined) patch.status = input.status;

    const [updated] = await this.db
      .update(customers)
      .set(patch)
      .where(and(eq(customers.id, id), eq(customers.tenantId, tenantId)))
      .returning();

    return updated;
  }

  async remove(id: string) {
    const tenantId = this.ctx.requireTenantId();

    const result = await this.db
      .delete(customers)
      .where(and(eq(customers.id, id), eq(customers.tenantId, tenantId)))
      .returning({ id: customers.id });

    if (result.length === 0) throw new NotFoundException('Customer not found');

    return { success: true };
  }

  private async assertEmailAvailable(tenantId: string, email: string) {
    const [existing] = await this.db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.email, email)))
      .limit(1);

    if (existing) {
      throw new ConflictException(
        'A customer with this email already exists',
      );
    }
  }
}
