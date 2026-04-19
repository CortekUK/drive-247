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
  eq,
  gte,
  ilike,
  inArray,
  lte,
  ne,
  or,
} from 'drizzle-orm';
import { customers, rentals, vehicles } from '@drive247/database';
import { RentalStatus } from '@drive247/shared-types';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { InvoicesService } from '../invoices/invoices.service';
import type { CreateRentalDto } from './dto/create-rental.dto';
import type { UpdateRentalDto } from './dto/update-rental.dto';
import type { TransitionRentalDto } from './dto/transition-rental.dto';
import type { ListRentalsDto } from './dto/list-rentals.dto';

// Statuses that block the vehicle from being double-booked
const BLOCKING_STATUSES: RentalStatus[] = [
  RentalStatus.PENDING,
  RentalStatus.ACTIVE,
];

const TERMINAL_STATUSES: RentalStatus[] = [
  RentalStatus.COMPLETED,
  RentalStatus.CANCELLED,
];

// Legal outgoing transitions from each status
const ALLOWED_TRANSITIONS: Record<RentalStatus, RentalStatus[]> = {
  [RentalStatus.PENDING]: [RentalStatus.ACTIVE, RentalStatus.CANCELLED],
  [RentalStatus.ACTIVE]: [RentalStatus.COMPLETED, RentalStatus.CANCELLED],
  [RentalStatus.COMPLETED]: [],
  [RentalStatus.CANCELLED]: [],
};

type RentalRow = typeof rentals.$inferSelect;

@Injectable()
export class RentalsService {
  constructor(
    @Inject(DATABASE) private db: Database,
    private ctx: TenantContextService,
    private invoicesService: InvoicesService,
  ) {}

  async list(query: ListRentalsDto) {
    const tenantId = this.ctx.requireTenantId();
    const { search, status, customerId, vehicleId, page, limit } = query;

    const conditions: SQL[] = [eq(rentals.tenantId, tenantId)];

    if (status) conditions.push(eq(rentals.status, status));
    if (customerId) conditions.push(eq(rentals.customerId, customerId));
    if (vehicleId) conditions.push(eq(rentals.vehicleId, vehicleId));

    if (search) {
      const like = `%${search}%`;
      conditions.push(
        or(ilike(customers.name, like), ilike(vehicles.reg, like))!,
      );
    }

    const where = and(...conditions);

    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select({
          rental: rentals,
          customer: {
            id: customers.id,
            name: customers.name,
            email: customers.email,
          },
          vehicle: {
            id: vehicles.id,
            reg: vehicles.reg,
            make: vehicles.make,
            model: vehicles.model,
          },
        })
        .from(rentals)
        .innerJoin(customers, eq(customers.id, rentals.customerId))
        .innerJoin(vehicles, eq(vehicles.id, rentals.vehicleId))
        .where(where)
        .orderBy(rentals.createdAt)
        .limit(limit)
        .offset((page - 1) * limit),
      this.db
        .select({ count: count() })
        .from(rentals)
        .innerJoin(customers, eq(customers.id, rentals.customerId))
        .innerJoin(vehicles, eq(vehicles.id, rentals.vehicleId))
        .where(where),
    ]);

    return {
      items: rows.map((r) => this.shape(r.rental, r.customer, r.vehicle)),
      meta: { page, limit, total: totalRow?.count ?? 0 },
    };
  }

  async getById(id: string) {
    const tenantId = this.ctx.requireTenantId();

    const [row] = await this.db
      .select({
        rental: rentals,
        customer: {
          id: customers.id,
          name: customers.name,
          email: customers.email,
        },
        vehicle: {
          id: vehicles.id,
          reg: vehicles.reg,
          make: vehicles.make,
          model: vehicles.model,
        },
      })
      .from(rentals)
      .innerJoin(customers, eq(customers.id, rentals.customerId))
      .innerJoin(vehicles, eq(vehicles.id, rentals.vehicleId))
      .where(and(eq(rentals.id, id), eq(rentals.tenantId, tenantId)))
      .limit(1);

    if (!row) throw new NotFoundException('Rental not found');
    return this.shape(row.rental, row.customer, row.vehicle);
  }

  async create(input: CreateRentalDto) {
    const tenantId = this.ctx.requireTenantId();

    await this.assertCustomerBelongsToTenant(tenantId, input.customerId);
    const vehicle = await this.loadVehicleForTenant(tenantId, input.vehicleId);
    if (vehicle.status !== 'active') {
      throw new BadRequestException('Vehicle is not active');
    }

    const startIso = toDateString(input.startDate);
    const endIso = toDateString(input.endDate);

    await this.assertNoConflict(
      tenantId,
      input.vehicleId,
      startIso,
      endIso,
      null,
    );

    const [created] = await this.db
      .insert(rentals)
      .values({
        tenantId,
        customerId: input.customerId,
        vehicleId: input.vehicleId,
        startDate: startIso,
        endDate: endIso,
        periodType: input.periodType,
        totalAmount: input.totalAmount.toString(),
        status: input.status,
      })
      .returning();

    // Auto-generate DRAFT invoice with one line item from rental.total_amount
    await this.invoicesService.autoCreateForRental({
      id: created.id,
      tenantId: created.tenantId,
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      startDate: created.startDate,
      endDate: created.endDate,
      totalAmount: created.totalAmount,
    });

    return this.getById(created.id);
  }

  async update(id: string, input: UpdateRentalDto) {
    const tenantId = this.ctx.requireTenantId();

    const [existing] = await this.db
      .select()
      .from(rentals)
      .where(and(eq(rentals.id, id), eq(rentals.tenantId, tenantId)))
      .limit(1);

    if (!existing) throw new NotFoundException('Rental not found');

    if (TERMINAL_STATUSES.includes(existing.status as RentalStatus)) {
      throw new ConflictException(
        'Cannot edit a rental that is completed or cancelled',
      );
    }

    const nextStart = input.startDate
      ? toDateString(input.startDate)
      : existing.startDate;
    const nextEnd = input.endDate
      ? toDateString(input.endDate)
      : existing.endDate;

    if (nextEnd < nextStart) {
      throw new BadRequestException('End date must be on or after start date');
    }

    const datesChanged =
      nextStart !== existing.startDate || nextEnd !== existing.endDate;

    if (datesChanged) {
      await this.assertNoConflict(
        tenantId,
        existing.vehicleId,
        nextStart,
        nextEnd,
        existing.id,
      );
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.startDate !== undefined) patch.startDate = nextStart;
    if (input.endDate !== undefined) patch.endDate = nextEnd;
    if (input.periodType !== undefined) patch.periodType = input.periodType;
    if (input.totalAmount !== undefined)
      patch.totalAmount = input.totalAmount.toString();

    await this.db
      .update(rentals)
      .set(patch)
      .where(and(eq(rentals.id, id), eq(rentals.tenantId, tenantId)));

    return this.getById(id);
  }

  async transition(id: string, input: TransitionRentalDto) {
    const tenantId = this.ctx.requireTenantId();

    const [existing] = await this.db
      .select()
      .from(rentals)
      .where(and(eq(rentals.id, id), eq(rentals.tenantId, tenantId)))
      .limit(1);

    if (!existing) throw new NotFoundException('Rental not found');

    this.assertCanTransition(
      existing.status as RentalStatus,
      input.status,
    );

    // Rule A: cannot activate before start date
    if (input.status === RentalStatus.ACTIVE) {
      const today = toDateString(new Date());
      if (existing.startDate > today) {
        throw new ConflictException(
          `Cannot activate before start date (${existing.startDate}). ` +
            `If the customer is picking up early, edit the rental to change the start date first.`,
        );
      }
    }

    await this.db
      .update(rentals)
      .set({ status: input.status, updatedAt: new Date() })
      .where(and(eq(rentals.id, id), eq(rentals.tenantId, tenantId)));

    return this.getById(id);
  }

  async remove(id: string) {
    const tenantId = this.ctx.requireTenantId();

    const result = await this.db
      .delete(rentals)
      .where(and(eq(rentals.id, id), eq(rentals.tenantId, tenantId)))
      .returning({ id: rentals.id });

    if (result.length === 0) throw new NotFoundException('Rental not found');
    return { success: true };
  }

  // --- private helpers ---

  private shape(
    r: RentalRow,
    customer: { id: string; name: string; email: string | null },
    vehicle: { id: string; reg: string; make: string; model: string },
  ) {
    return {
      id: r.id,
      tenantId: r.tenantId,
      startDate: r.startDate,
      endDate: r.endDate,
      periodType: r.periodType,
      totalAmount: r.totalAmount,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      customer,
      vehicle,
    };
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

  private async loadVehicleForTenant(tenantId: string, vehicleId: string) {
    const [row] = await this.db
      .select({ id: vehicles.id, status: vehicles.status })
      .from(vehicles)
      .where(and(eq(vehicles.id, vehicleId), eq(vehicles.tenantId, tenantId)))
      .limit(1);
    if (!row) throw new NotFoundException('Vehicle not found');
    return row;
  }

  private async assertNoConflict(
    tenantId: string,
    vehicleId: string,
    startDate: string,
    endDate: string,
    excludeRentalId: string | null,
  ) {
    const conditions: SQL[] = [
      eq(rentals.tenantId, tenantId),
      eq(rentals.vehicleId, vehicleId),
      inArray(rentals.status, BLOCKING_STATUSES),
      lte(rentals.startDate, endDate),
      gte(rentals.endDate, startDate),
    ];
    if (excludeRentalId) {
      conditions.push(ne(rentals.id, excludeRentalId));
    }

    const [conflict] = await this.db
      .select({ id: rentals.id })
      .from(rentals)
      .where(and(...conditions))
      .limit(1);

    if (conflict) {
      throw new ConflictException(
        'Vehicle is already booked for part of this date range',
      );
    }
  }

  private assertCanTransition(from: RentalStatus, to: RentalStatus) {
    if (from === to) {
      throw new ConflictException('Rental already in this status');
    }
    const allowed = ALLOWED_TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw new ConflictException(
        `Cannot transition rental from ${from} to ${to}`,
      );
    }
  }
}

function toDateString(d: Date): string {
  // YYYY-MM-DD in UTC — matches pg DATE column semantics and keeps comparisons lexicographic
  return d.toISOString().slice(0, 10);
}
