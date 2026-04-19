import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UsePipes,
} from '@nestjs/common';
import { UserRole } from '@drive247/shared-types';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireTenant } from '../../common/decorators/require-tenant.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { IdVerificationBlocksService } from './id-verification-blocks.service';
import { createBlockSchema, type CreateBlockDto } from './dto/create-block.dto';
import { updateBlockSchema, type UpdateBlockDto } from './dto/update-block.dto';
import { listBlocksSchema, type ListBlocksDto } from './dto/list-blocks.dto';

@Controller('id-verification/blocks')
@RequireTenant()
export class IdVerificationBlocksController {
  constructor(private readonly service: IdVerificationBlocksService) {}

  @Get()
  @Roles(
    UserRole.HEAD_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.OPS,
    UserRole.VIEWER,
  )
  async list(@Query(new ZodValidationPipe(listBlocksSchema)) query: ListBlocksDto) {
    return { success: true, data: { items: await this.service.list(query) } };
  }

  @Post()
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  @UsePipes(new ZodValidationPipe(createBlockSchema))
  async create(@Body() body: CreateBlockDto) {
    return {
      success: true,
      data: await this.service.create(body),
      message: 'Identity added to block list',
    };
  }

  @Patch(':id')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateBlockSchema)) body: UpdateBlockDto,
  ) {
    return {
      success: true,
      data: await this.service.update(id, body),
      message: 'Block updated',
    };
  }

  @Delete(':id')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return {
      success: true,
      data: await this.service.remove(id),
      message: 'Block removed',
    };
  }
}
