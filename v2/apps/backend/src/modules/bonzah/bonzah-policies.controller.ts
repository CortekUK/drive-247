import {
  Body,
  Controller,
  Get,
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
import { BonzahPolicyService } from './bonzah-policy.service';
import { BonzahQuoteService } from './bonzah-quote.service';
import { BonzahPaymentService } from './bonzah-payment.service';
import {
  createQuoteSchema,
  type CreateQuoteDto,
} from './dto/create-quote.dto';
import {
  listPoliciesSchema,
  type ListPoliciesDto,
} from './dto/list-policies.dto';
import {
  downloadPdfSchema,
  type DownloadPdfDto,
} from './dto/download-pdf.dto';

@Controller('bonzah/policies')
@RequireTenant()
export class BonzahPoliciesController {
  constructor(
    private readonly policyService: BonzahPolicyService,
    private readonly quoteService: BonzahQuoteService,
    private readonly paymentService: BonzahPaymentService,
  ) {}

  @Get()
  @Roles(
    UserRole.HEAD_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.OPS,
    UserRole.VIEWER,
  )
  async list(
    @Query(new ZodValidationPipe(listPoliciesSchema)) query: ListPoliciesDto,
  ) {
    return {
      success: true,
      data: { items: await this.policyService.list(query) },
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
    return { success: true, data: await this.policyService.getById(id) };
  }

  @Post()
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.OPS)
  @UsePipes(new ZodValidationPipe(createQuoteSchema))
  async createQuote(@Body() body: CreateQuoteDto) {
    return {
      success: true,
      data: await this.quoteService.createQuote(body),
      message: 'Quote created',
    };
  }

  @Post(':chainId/confirm-payment')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN)
  async confirmPayment(@Param('chainId', ParseUUIDPipe) chainId: string) {
    return {
      success: true,
      data: await this.paymentService.confirmChain(chainId),
      message: 'Payment confirmation completed',
    };
  }

  @Get(':id/pdf')
  @Roles(
    UserRole.HEAD_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.OPS,
    UserRole.VIEWER,
  )
  async downloadPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(downloadPdfSchema)) query: DownloadPdfDto,
  ) {
    return {
      success: true,
      data: await this.policyService.downloadPdf(id, query.dataId),
    };
  }
}
