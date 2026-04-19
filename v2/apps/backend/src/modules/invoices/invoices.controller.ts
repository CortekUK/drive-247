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
import { InvoicesService } from './invoices.service';
import {
  createInvoiceSchema,
  type CreateInvoiceDto,
} from './dto/create-invoice.dto';
import {
  updateInvoiceSchema,
  type UpdateInvoiceDto,
} from './dto/update-invoice.dto';
import {
  listInvoicesSchema,
  type ListInvoicesDto,
} from './dto/list-invoices.dto';

@Controller('invoices')
@RequireTenant()
export class InvoicesController {
  constructor(private invoicesService: InvoicesService) {}

  @Get()
  @Roles(
    UserRole.HEAD_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.OPS,
    UserRole.VIEWER,
  )
  async list(
    @Query(new ZodValidationPipe(listInvoicesSchema)) query: ListInvoicesDto,
  ) {
    return {
      success: true,
      data: await this.invoicesService.list(query),
    };
  }

  @Get(':id')
  @Roles(
    UserRole.HEAD_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.OPS,
    UserRole.VIEWER,
  )
  async getById(@Param('id', ParseUUIDPipe) id: string) {
    return {
      success: true,
      data: await this.invoicesService.getById(id),
    };
  }

  @Post()
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.OPS)
  @UsePipes(new ZodValidationPipe(createInvoiceSchema))
  async create(@Body() body: CreateInvoiceDto) {
    return {
      success: true,
      data: await this.invoicesService.create(body),
      message: 'Invoice created',
    };
  }

  @Patch(':id')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.OPS)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateInvoiceSchema)) body: UpdateInvoiceDto,
  ) {
    return {
      success: true,
      data: await this.invoicesService.update(id, body),
      message: 'Invoice updated',
    };
  }

  @Post(':id/void')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN)
  async void(@Param('id', ParseUUIDPipe) id: string) {
    return {
      success: true,
      data: await this.invoicesService.void(id),
      message: 'Invoice voided',
    };
  }

  @Delete(':id')
  @Roles(UserRole.HEAD_ADMIN)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.invoicesService.remove(id);
    return { success: true, message: 'Invoice deleted' };
  }
}
