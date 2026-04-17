import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UsePipes,
  ParseUUIDPipe,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { createUserSchema, type CreateUserDto } from './dto/create-user.dto';
import { updateUserSchema, type UpdateUserDto } from './dto/update-user.dto';
import { updateRoleSchema, type UpdateRoleDto } from './dto/update-role.dto';
import { UserRole } from '@drive247/shared-types';
import { TenantContextService } from '../../common/context/tenant-context.service';

@Controller('users')
export class UsersController {
  constructor(
    private usersService: UsersService,
    private tenantContext: TenantContextService,
  ) {}

  @Get()
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN)
  async list() {
    const tenantId = this.tenantContext.requireTenantId();
    return {
      success: true,
      data: await this.usersService.list(tenantId),
    };
  }

  @Get(':id')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN)
  async getById(@Param('id', ParseUUIDPipe) id: string) {
    const tenantId = this.tenantContext.requireTenantId();
    return {
      success: true,
      data: await this.usersService.getById(id, tenantId),
    };
  }

  @Post()
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN)
  @UsePipes(new ZodValidationPipe(createUserSchema))
  async create(@Body() body: CreateUserDto) {
    const tenantId = this.tenantContext.requireTenantId();
    const result = await this.usersService.create(body, tenantId);
    return {
      success: true,
      data: result,
      message: 'User created',
    };
  }

  @Patch(':id')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserDto,
  ) {
    const tenantId = this.tenantContext.requireTenantId();
    const result = await this.usersService.update(id, body, tenantId);
    return {
      success: true,
      data: result,
      message: 'User updated',
    };
  }

  @Patch(':id/role')
  @Roles(UserRole.HEAD_ADMIN)
  async updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) body: UpdateRoleDto,
  ) {
    const tenantId = this.tenantContext.requireTenantId();
    await this.usersService.updateRole(id, body, tenantId);
    return { success: true, message: 'Role updated' };
  }

  @Patch(':id/deactivate')
  @Roles(UserRole.HEAD_ADMIN)
  async deactivate(@Param('id', ParseUUIDPipe) id: string) {
    const tenantId = this.tenantContext.requireTenantId();
    await this.usersService.deactivate(id, tenantId);
    return { success: true, message: 'User deactivated' };
  }

  @Patch(':id/activate')
  @Roles(UserRole.HEAD_ADMIN)
  async activate(@Param('id', ParseUUIDPipe) id: string) {
    const tenantId = this.tenantContext.requireTenantId();
    await this.usersService.activate(id, tenantId);
    return { success: true, message: 'User activated' };
  }

  @Delete(':id')
  @Roles(UserRole.HEAD_ADMIN)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const tenantId = this.tenantContext.requireTenantId();
    await this.usersService.remove(id, tenantId);
    return { success: true, message: 'User deleted' };
  }
}
