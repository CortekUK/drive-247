import { Body, Controller, Get, Patch, UsePipes } from '@nestjs/common';
import { UserRole } from '@drive247/shared-types';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireTenant } from '../../common/decorators/require-tenant.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { IdVerificationSettingsService } from './id-verification-settings.service';
import {
  updateSettingsSchema,
  type UpdateSettingsDto,
} from './dto/update-settings.dto';

@Controller('id-verification/settings')
@RequireTenant()
export class IdVerificationSettingsController {
  constructor(private readonly service: IdVerificationSettingsService) {}

  @Get()
  @Roles(
    UserRole.HEAD_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.OPS,
    UserRole.VIEWER,
  )
  async get() {
    return { success: true, data: await this.service.get() };
  }

  @Patch()
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN)
  @UsePipes(new ZodValidationPipe(updateSettingsSchema))
  async update(@Body() body: UpdateSettingsDto) {
    return {
      success: true,
      data: await this.service.update(body),
      message: 'ID verification settings updated',
    };
  }
}
