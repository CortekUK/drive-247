import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, eq, ilike, or } from 'drizzle-orm';
import { vehicles } from '@drive247/database';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';
import { TenantContextService } from '../../common/context/tenant-context.service';
import type { CreateVehicleDto } from './dto/create-vehicle.dto';
import type { UpdateVehicleDto } from './dto/update-vehicle.dto';
import type { ListVehiclesDto } from './dto/list-vehicles.dto';

@Injectable()
export class VehiclesService {
  constructor(
    @Inject(DATABASE) private db: Database,
    private ctx: TenantContextService,
  ) {}

  async list(query: ListVehiclesDto) {
    const tenantId = this.ctx.requireTenantId();
    const { search, status, page, limit } = query;

    const conditions = [eq(vehicles.tenantId, tenantId)];

    if (search) {
      const like = `%${search}%`;
      conditions.push(
        or(
          ilike(vehicles.reg, like),
          ilike(vehicles.make, like),
          ilike(vehicles.model, like),
        )!,
      );
    }

    if (status) {
      conditions.push(eq(vehicles.status, status));
    }

    const where = and(...conditions);

    const [items, [totalRow]] = await Promise.all([
      this.db
        .select()
        .from(vehicles)
        .where(where)
        .orderBy(vehicles.createdAt)
        .limit(limit)
        .offset((page - 1) * limit),
      this.db.select({ count: count() }).from(vehicles).where(where),
    ]);

    return {
      items,
      meta: {
        page,
        limit,
        total: totalRow?.count ?? 0,
      },
    };
  }

  async getById(id: string) {
    const tenantId = this.ctx.requireTenantId();

    const [vehicle] = await this.db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.tenantId, tenantId)))
      .limit(1);

    if (!vehicle) throw new NotFoundException('Vehicle not found');
    return vehicle;
  }

  async create(input: CreateVehicleDto) {
    const tenantId = this.ctx.requireTenantId();

    await this.assertRegAvailable(tenantId, input.reg);

    const [created] = await this.db
      .insert(vehicles)
      .values({
        tenantId,
        reg: input.reg,
        make: input.make,
        model: input.model,
        year: input.year,
        dailyRent: input.dailyRent.toString(),
        weeklyRent: input.weeklyRent.toString(),
        monthlyRent: input.monthlyRent.toString(),
        status: input.status,
      })
      .returning();

    return created;
  }

  async update(id: string, input: UpdateVehicleDto) {
    const tenantId = this.ctx.requireTenantId();

    const [existing] = await this.db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.tenantId, tenantId)))
      .limit(1);

    if (!existing) throw new NotFoundException('Vehicle not found');

    if (input.reg && input.reg !== existing.reg) {
      await this.assertRegAvailable(tenantId, input.reg);
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.reg !== undefined) patch.reg = input.reg;
    if (input.make !== undefined) patch.make = input.make;
    if (input.model !== undefined) patch.model = input.model;
    if (input.year !== undefined) patch.year = input.year;
    if (input.dailyRent !== undefined) patch.dailyRent = input.dailyRent.toString();
    if (input.weeklyRent !== undefined) patch.weeklyRent = input.weeklyRent.toString();
    if (input.monthlyRent !== undefined) patch.monthlyRent = input.monthlyRent.toString();
    if (input.status !== undefined) patch.status = input.status;

    const [updated] = await this.db
      .update(vehicles)
      .set(patch)
      .where(and(eq(vehicles.id, id), eq(vehicles.tenantId, tenantId)))
      .returning();

    return updated;
  }

  async remove(id: string) {
    const tenantId = this.ctx.requireTenantId();

    const result = await this.db
      .delete(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.tenantId, tenantId)))
      .returning({ id: vehicles.id });

    if (result.length === 0) throw new NotFoundException('Vehicle not found');

    return { success: true };
  }

  private async assertRegAvailable(tenantId: string, reg: string) {
    const [existing] = await this.db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(and(eq(vehicles.tenantId, tenantId), eq(vehicles.reg, reg)))
      .limit(1);

    if (existing) {
      throw new ConflictException(
        'A vehicle with this registration already exists',
      );
    }
  }
}
