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
import { VehiclesService } from './vehicles.service';
import {
  createVehicleSchema,
  type CreateVehicleDto,
} from './dto/create-vehicle.dto';
import {
  updateVehicleSchema,
  type UpdateVehicleDto,
} from './dto/update-vehicle.dto';
import {
  listVehiclesSchema,
  type ListVehiclesDto,
} from './dto/list-vehicles.dto';

@Controller('vehicles')
@RequireTenant()
export class VehiclesController {
  constructor(private vehiclesService: VehiclesService) {}

  @Get()
  @Roles(
    UserRole.HEAD_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.OPS,
    UserRole.VIEWER,
  )
  async list(
    @Query(new ZodValidationPipe(listVehiclesSchema)) query: ListVehiclesDto,
  ) {
    return {
      success: true,
      data: await this.vehiclesService.list(query),
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
      data: await this.vehiclesService.getById(id),
    };
  }

  @Post()
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.OPS)
  @UsePipes(new ZodValidationPipe(createVehicleSchema))
  async create(@Body() body: CreateVehicleDto) {
    return {
      success: true,
      data: await this.vehiclesService.create(body),
      message: 'Vehicle created',
    };
  }

  @Patch(':id')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.OPS)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateVehicleSchema)) body: UpdateVehicleDto,
  ) {
    return {
      success: true,
      data: await this.vehiclesService.update(id, body),
      message: 'Vehicle updated',
    };
  }

  @Delete(':id')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.vehiclesService.remove(id);
    return { success: true, message: 'Vehicle deleted' };
  }
}
