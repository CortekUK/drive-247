import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  UsePipes,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { tenants } from '@drive247/database';
import { UserRole } from '@drive247/shared-types';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireTenant } from '../../common/decorators/require-tenant.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { RemindersService } from '../reminders/reminders.service';
import {
  updateReminderConfigSchema,
  type UpdateReminderConfigDto,
} from '../reminders/dto/update-reminder-config.dto';

const updateTaxSchema = z
  .object({
    taxRate: z.coerce.number().min(0).max(100).optional(),
    taxLabel: z.string().trim().min(1).max(30).optional(),
    taxInclusive: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided',
  });

type UpdateTaxDto = z.infer<typeof updateTaxSchema>;

@Controller('tenant-settings')
@RequireTenant()
export class TenantSettingsController {
  constructor(
    @Inject(DATABASE) private db: Database,
    private ctx: TenantContextService,
    private remindersService: RemindersService,
  ) {}

  @Get('tax')
  @Roles(
    UserRole.HEAD_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.OPS,
    UserRole.VIEWER,
  )
  async getTax() {
    const tenantId = this.ctx.requireTenantId();
    const [row] = await this.db
      .select({
        taxRate: tenants.taxRate,
        taxLabel: tenants.taxLabel,
        taxInclusive: tenants.taxInclusive,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    return { success: true, data: row };
  }

  @Patch('tax')
  @Roles(UserRole.HEAD_ADMIN)
  @UsePipes(new ZodValidationPipe(updateTaxSchema))
  async updateTax(@Body() body: UpdateTaxDto) {
    const tenantId = this.ctx.requireTenantId();

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.taxRate !== undefined) patch.taxRate = body.taxRate.toString();
    if (body.taxLabel !== undefined) patch.taxLabel = body.taxLabel;
    if (body.taxInclusive !== undefined) patch.taxInclusive = body.taxInclusive;

    const [updated] = await this.db
      .update(tenants)
      .set(patch)
      .where(eq(tenants.id, tenantId))
      .returning({
        taxRate: tenants.taxRate,
        taxLabel: tenants.taxLabel,
        taxInclusive: tenants.taxInclusive,
      });

    return {
      success: true,
      data: updated,
      message: 'Tax settings updated',
    };
  }

  @Get('reminders/:configKey')
  @Roles(
    UserRole.HEAD_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.OPS,
    UserRole.VIEWER,
  )
  async getReminderConfig(@Param('configKey') configKey: string) {
    const data = await this.remindersService.getConfig(configKey);
    if (!data) {
      throw new NotFoundException('Reminder config not found');
    }
    return { success: true, data };
  }

  @Patch('reminders/:configKey')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN)
  async updateReminderConfig(
    @Param('configKey') configKey: string,
    @Body(new ZodValidationPipe(updateReminderConfigSchema))
    body: UpdateReminderConfigDto,
  ) {
    const data = await this.remindersService.upsertConfig(
      configKey,
      body.configValue,
    );
    return {
      success: true,
      data,
      message: 'Reminder config updated',
    };
  }
}
