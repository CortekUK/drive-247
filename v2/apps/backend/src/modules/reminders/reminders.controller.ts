import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { UserRole } from '@drive247/shared-types';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireTenant } from '../../common/decorators/require-tenant.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RemindersService } from './reminders.service';
import {
  listRemindersSchema,
  type ListRemindersDto,
} from './dto/list-reminders.dto';

@Controller('reminders')
@RequireTenant()
export class RemindersController {
  constructor(private remindersService: RemindersService) {}

  @Get()
  @Roles(
    UserRole.HEAD_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.OPS,
    UserRole.VIEWER,
  )
  async list(
    @Query(new ZodValidationPipe(listRemindersSchema)) query: ListRemindersDto,
  ) {
    return {
      success: true,
      data: await this.remindersService.list(query),
    };
  }

  @Patch(':id/resolve')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.OPS)
  async resolve(@Param('id', ParseUUIDPipe) id: string) {
    return {
      success: true,
      data: await this.remindersService.resolve(id),
      message: 'Reminder resolved',
    };
  }
}
