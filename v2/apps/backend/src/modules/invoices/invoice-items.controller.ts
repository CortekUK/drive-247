import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@drive247/shared-types';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireTenant } from '../../common/decorators/require-tenant.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { InvoicesService } from './invoices.service';
import {
  createInvoiceItemSchema,
  type CreateInvoiceItemDto,
} from './dto/create-invoice-item.dto';
import {
  updateInvoiceItemSchema,
  type UpdateInvoiceItemDto,
} from './dto/update-invoice-item.dto';

@Controller('invoices/:invoiceId/items')
@RequireTenant()
export class InvoiceItemsController {
  constructor(private invoicesService: InvoicesService) {}

  @Post()
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.OPS)
  async add(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body(new ZodValidationPipe(createInvoiceItemSchema))
    body: CreateInvoiceItemDto,
  ) {
    return {
      success: true,
      data: await this.invoicesService.addItem(invoiceId, body),
      message: 'Line item added',
    };
  }

  @Patch(':itemId')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.OPS)
  async update(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(new ZodValidationPipe(updateInvoiceItemSchema))
    body: UpdateInvoiceItemDto,
  ) {
    return {
      success: true,
      data: await this.invoicesService.updateItem(invoiceId, itemId, body),
      message: 'Line item updated',
    };
  }

  @Delete(':itemId')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.OPS)
  async remove(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    await this.invoicesService.removeItem(invoiceId, itemId);
    return { success: true, message: 'Line item removed' };
  }
}
