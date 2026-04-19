import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UsePipes,
} from '@nestjs/common';
import { UserRole } from '@drive247/shared-types';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireTenant } from '../../common/decorators/require-tenant.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BonzahService } from './bonzah.service';
import { BonzahPremiumService } from './bonzah-premium.service';
import { BonzahEligibilityService } from './bonzah-eligibility.service';
import { BonzahPaymentService } from './bonzah-payment.service';
import {
  verifyCredentialsSchema,
  type VerifyCredentialsDto,
} from './dto/verify-credentials.dto';
import {
  updateBonzahSettingsSchema,
  type UpdateBonzahSettingsDto,
} from './dto/update-bonzah-settings.dto';
import {
  updateAlertConfigSchema,
  type UpdateAlertConfigDto,
} from './dto/update-alert-config.dto';
import {
  calculatePremiumSchema,
  type CalculatePremiumDto,
} from './dto/calculate-premium.dto';
import {
  checkEligibilitySchema,
  type CheckEligibilityDto,
} from './dto/check-eligibility.dto';

@Controller('bonzah')
@RequireTenant()
export class BonzahController {
  constructor(
    private readonly bonzahService: BonzahService,
    private readonly premiumService: BonzahPremiumService,
    private readonly eligibilityService: BonzahEligibilityService,
    private readonly paymentService: BonzahPaymentService,
  ) {}

  // --- Connection + settings ---

  @Get('connection')
  @Roles(
    UserRole.HEAD_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.OPS,
    UserRole.VIEWER,
  )
  async getConnection() {
    return { success: true, data: await this.bonzahService.getConnection() };
  }

  @Post('verify-credentials')
  @Roles(UserRole.HEAD_ADMIN)
  @UsePipes(new ZodValidationPipe(verifyCredentialsSchema))
  async verify(@Body() body: VerifyCredentialsDto) {
    return {
      success: true,
      data: await this.bonzahService.verifyCredentials(body),
    };
  }

  @Patch('settings')
  @Roles(UserRole.HEAD_ADMIN)
  async updateSettings(
    @Body(new ZodValidationPipe(updateBonzahSettingsSchema))
    body: UpdateBonzahSettingsDto,
  ) {
    return {
      success: true,
      data: await this.bonzahService.updateSettings(body),
      message: 'Bonzah settings updated',
    };
  }

  // --- Balance + alerts ---

  @Get('balance')
  @Roles(
    UserRole.HEAD_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.OPS,
    UserRole.VIEWER,
  )
  async getBalance() {
    return { success: true, data: await this.bonzahService.getBalance() };
  }

  @Get('alert-config')
  @Roles(
    UserRole.HEAD_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.OPS,
    UserRole.VIEWER,
  )
  async getAlertConfig() {
    return { success: true, data: await this.bonzahService.getAlertConfig() };
  }

  @Patch('alert-config')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN)
  async updateAlertConfig(
    @Body(new ZodValidationPipe(updateAlertConfigSchema))
    body: UpdateAlertConfigDto,
  ) {
    return {
      success: true,
      data: await this.bonzahService.updateAlertConfig(body),
      message: 'Alert config updated',
    };
  }

  // --- Premium + eligibility ---

  @Post('premium-calculate')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.OPS)
  @UsePipes(new ZodValidationPipe(calculatePremiumSchema))
  async calculatePremium(@Body() body: CalculatePremiumDto) {
    return {
      success: true,
      data: await this.premiumService.calculate(body),
    };
  }

  @Post('eligibility')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.OPS)
  @UsePipes(new ZodValidationPipe(checkEligibilitySchema))
  async checkEligibility(@Body() body: CheckEligibilityDto) {
    return {
      success: true,
      data: await this.eligibilityService.checkVehicle(body.vehicleId),
    };
  }

  // --- Retry pending ---

  @Post('retry-pending')
  @Roles(UserRole.HEAD_ADMIN, UserRole.ADMIN)
  async retryPending() {
    return {
      success: true,
      data: await this.paymentService.retryPending(),
      message: 'Retry pending policies completed',
    };
  }
}
