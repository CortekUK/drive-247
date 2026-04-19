import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UsePipes,
} from '@nestjs/common';
import { UserRole } from '@drive247/shared-types';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireTenant } from '../../common/decorators/require-tenant.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { IdVerificationService } from './id-verification.service';
import { IdVerificationSessionService } from './id-verification-session.service';
import { IdVerificationReviewService } from './id-verification-review.service';
import { IdVerificationEventsService } from './id-verification-events.service';
import {
  createSessionSchema,
  type CreateSessionDto,
} from './dto/create-session.dto';
import {
  listVerificationsSchema,
  type ListVerificationsDto,
} from './dto/list-verifications.dto';
import {
  manualReviewSchema,
  type ManualReviewDto,
} from './dto/manual-review.dto';
import {
  retryVerificationSchema,
  type RetryVerificationDto,
} from './dto/retry-verification.dto';

@Controller('id-verification')
@RequireTenant()
export class IdVerificationController {
  constructor(
    private readonly service: IdVerificationService,
    private readonly sessionService: IdVerificationSessionService,
    private readonly reviewService: IdVerificationReviewService,
    private readonly events: IdVerificationEventsService,
    private readonly ctx: TenantContextService,
  ) {}

  // ------------------------------------------------------------------
  // List + detail + events
  // ------------------------------------------------------------------

  @Get()
  @Roles(
    UserRole.HEAD_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.OPS,
    UserRole.VIEWER,
  )
  async list(
    @Query(new ZodValidationPipe(listVerificationsSchema))
    query: ListVerificationsDto,
  ) {
    return { success: true, data: await this.service.list(query) };
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
    return { success: true, data: await this.service.getById(id) };
  }

  @Get(':id/events')
  @Roles(
    UserRole.HEAD_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.OPS,
    UserRole.VIEWER,
  )
  async listEvents(@Param('id', ParseUUIDPipe) id: string) {
    const tenantId = this.ctx.requireTenantId();
    // Ensure the verification exists + belongs to the tenant before
    // exposing its event log
    await this.service.getById(id);
    return {
      success: true,
      data: { items: await this.events.listForVerification(tenantId, id) },
    };
  }

  // ------------------------------------------------------------------
  // Mutations
  // ------------------------------------------------------------------

  @Post('sessions')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.OPS)
  @UsePipes(new ZodValidationPipe(createSessionSchema))
  async createSession(@Body() body: CreateSessionDto) {
    return {
      success: true,
      data: await this.sessionService.create(body),
      message: 'ID verification session created',
    };
  }

  @Post(':id/cancel')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.OPS)
  @HttpCode(HttpStatus.OK)
  async cancel(@Param('id', ParseUUIDPipe) id: string) {
    await this.sessionService.cancelById(id);
    return { success: true, message: 'Session cancelled' };
  }

  @Post(':id/retry')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.OPS)
  @HttpCode(HttpStatus.OK)
  async retry(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(retryVerificationSchema))
    body: RetryVerificationDto,
  ) {
    return {
      success: true,
      data: await this.reviewService.retry(id, body.reason),
      message: 'Verification retry initiated',
    };
  }

  @Post(':id/review')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  async review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(manualReviewSchema)) body: ManualReviewDto,
  ) {
    await this.reviewService.review(id, body);
    return {
      success: true,
      message:
        body.decision === 'approve'
          ? 'Verification approved'
          : 'Verification rejected',
    };
  }
}
