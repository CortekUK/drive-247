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
import { RentalsService } from './rentals.service';
import {
  createRentalSchema,
  type CreateRentalDto,
} from './dto/create-rental.dto';
import {
  updateRentalSchema,
  type UpdateRentalDto,
} from './dto/update-rental.dto';
import {
  transitionRentalSchema,
  type TransitionRentalDto,
} from './dto/transition-rental.dto';
import {
  listRentalsSchema,
  type ListRentalsDto,
} from './dto/list-rentals.dto';

@Controller('rentals')
@RequireTenant()
export class RentalsController {
  constructor(private rentalsService: RentalsService) {}

  @Get()
  @Roles(
    UserRole.HEAD_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.OPS,
    UserRole.VIEWER,
  )
  async list(
    @Query(new ZodValidationPipe(listRentalsSchema)) query: ListRentalsDto,
  ) {
    return {
      success: true,
      data: await this.rentalsService.list(query),
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
      data: await this.rentalsService.getById(id),
    };
  }

  @Post()
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.OPS)
  @UsePipes(new ZodValidationPipe(createRentalSchema))
  async create(@Body() body: CreateRentalDto) {
    return {
      success: true,
      data: await this.rentalsService.create(body),
      message: 'Rental created',
    };
  }

  @Patch(':id')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.OPS)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateRentalSchema)) body: UpdateRentalDto,
  ) {
    return {
      success: true,
      data: await this.rentalsService.update(id, body),
      message: 'Rental updated',
    };
  }

  @Patch(':id/status')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.OPS)
  async transition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(transitionRentalSchema))
    body: TransitionRentalDto,
  ) {
    return {
      success: true,
      data: await this.rentalsService.transition(id, body),
      message: 'Rental status updated',
    };
  }

  @Delete(':id')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.rentalsService.remove(id);
    return { success: true, message: 'Rental deleted' };
  }
}
