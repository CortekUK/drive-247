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
import { CustomersService } from './customers.service';
import {
  createCustomerSchema,
  type CreateCustomerDto,
} from './dto/create-customer.dto';
import {
  updateCustomerSchema,
  type UpdateCustomerDto,
} from './dto/update-customer.dto';
import {
  listCustomersSchema,
  type ListCustomersDto,
} from './dto/list-customers.dto';

@Controller('customers')
@RequireTenant()
export class CustomersController {
  constructor(private customersService: CustomersService) {}

  @Get()
  @Roles(
    UserRole.HEAD_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.OPS,
    UserRole.VIEWER,
  )
  async list(
    @Query(new ZodValidationPipe(listCustomersSchema)) query: ListCustomersDto,
  ) {
    return {
      success: true,
      data: await this.customersService.list(query),
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
      data: await this.customersService.getById(id),
    };
  }

  @Get(':id/financials')
  @Roles(
    UserRole.HEAD_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.OPS,
    UserRole.VIEWER,
  )
  async getFinancials(@Param('id', ParseUUIDPipe) id: string) {
    return {
      success: true,
      data: await this.customersService.getFinancials(id),
    };
  }

  @Post()
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.OPS)
  @UsePipes(new ZodValidationPipe(createCustomerSchema))
  async create(@Body() body: CreateCustomerDto) {
    return {
      success: true,
      data: await this.customersService.create(body),
      message: 'Customer created',
    };
  }

  @Patch(':id')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.OPS)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCustomerSchema)) body: UpdateCustomerDto,
  ) {
    return {
      success: true,
      data: await this.customersService.update(id, body),
      message: 'Customer updated',
    };
  }

  @Delete(':id')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.customersService.remove(id);
    return { success: true, message: 'Customer deleted' };
  }
}
