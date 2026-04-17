import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UsePipes,
  ParseUUIDPipe,
} from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { SuperAdminOnly } from '../../common/decorators/super-admin.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  createTenantSchema,
  type CreateTenantDto,
} from './dto/create-tenant.dto';
import {
  updateTenantSchema,
  type UpdateTenantDto,
} from './dto/update-tenant.dto';

@Controller('tenants')
@SuperAdminOnly()
export class TenantsController {
  constructor(private tenantsService: TenantsService) {}

  @Get('stats')
  async stats() {
    return {
      success: true,
      data: await this.tenantsService.stats(),
    };
  }

  @Get()
  async list(
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
  ) {
    return {
      success: true,
      data: await this.tenantsService.list(search, type, status),
    };
  }

  @Get(':id')
  async getById(@Param('id', ParseUUIDPipe) id: string) {
    return {
      success: true,
      data: await this.tenantsService.getById(id),
    };
  }

  @Post()
  @UsePipes(new ZodValidationPipe(createTenantSchema))
  async create(@Body() body: CreateTenantDto) {
    const result = await this.tenantsService.create(body);
    return {
      success: true,
      data: result,
      message: 'Tenant created',
    };
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTenantSchema)) body: UpdateTenantDto,
  ) {
    const result = await this.tenantsService.update(id, body);
    return {
      success: true,
      data: result,
      message: 'Tenant updated',
    };
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.tenantsService.remove(id);
    return { success: true, message: 'Tenant deleted' };
  }
}
