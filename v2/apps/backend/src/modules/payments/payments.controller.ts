import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { UserRole } from '@drive247/shared-types';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireTenant } from '../../common/decorators/require-tenant.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PaymentsService } from './payments.service';
import {
  recordPaymentSchema,
  type RecordPaymentDto,
} from './dto/record-payment.dto';
import {
  refundPaymentSchema,
  type RefundPaymentDto,
} from './dto/refund-payment.dto';

@Controller('invoices/:invoiceId/payments')
@RequireTenant()
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Post()
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.OPS)
  async record(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body(new ZodValidationPipe(recordPaymentSchema))
    body: RecordPaymentDto,
  ) {
    return {
      success: true,
      data: await this.paymentsService.record(invoiceId, body),
      message: 'Payment recorded',
    };
  }

  @Post(':paymentId/refund')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN)
  async refund(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body(new ZodValidationPipe(refundPaymentSchema))
    body: RefundPaymentDto,
  ) {
    return {
      success: true,
      data: await this.paymentsService.refund(invoiceId, paymentId, body),
      message: 'Refund recorded',
    };
  }
}
