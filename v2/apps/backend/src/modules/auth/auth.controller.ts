import {
  Controller,
  Post,
  Body,
  Res,
  Req,
  Get,
  UsePipes,
  HttpCode,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { Public } from '../../common/decorators/public.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { loginSchema, type LoginDto } from './dto/login.dto';
import {
  changePasswordSchema,
  type ChangePasswordDto,
} from './dto/change-password.dto';
import {
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  REFRESH_MAX_AGE_MS,
} from '@drive247/shared-types';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tenantSlug = req.headers['x-tenant-slug'] as string | undefined;
    const tenantId = tenantSlug
      ? await this.authService.resolveTenantId(tenantSlug)
      : null;
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip;

    const result = await this.authService.login(
      body.email,
      body.password,
      tenantId,
      userAgent,
      ipAddress,
    );

    this.setRefreshCookie(res, result.refreshToken);

    return {
      success: true,
      data: {
        accessToken: result.accessToken,
        user: result.user,
      },
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    if (!refreshToken) {
      return {
        success: false,
        error: { code: 'NO_REFRESH_TOKEN', message: 'No refresh token' },
      };
    }

    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip;
    const tokens = await this.authService.refresh(
      refreshToken,
      userAgent,
      ipAddress,
    );

    this.setRefreshCookie(res, tokens.refreshToken);

    return {
      success: true,
      data: { accessToken: tokens.accessToken },
    };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    await this.authService.logout(user.id, refreshToken);
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return { success: true, message: 'Logged out' };
  }

  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordDto,
  ) {
    await this.authService.changePassword(
      user.id,
      body.currentPassword,
      body.newPassword,
    );
    return { success: true, message: 'Password changed' };
  }

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    const profile = await this.authService.getProfile(user.id);
    return { success: true, data: profile };
  }

  private setRefreshCookie(res: Response, token: string) {
    const isProd = process.env.NODE_ENV === 'production';
    // No domain attribute — cookie is host-only.
    // Frontend mirrors page hostname into API URL (dogar.localhost:3001 → dogar.localhost:4000)
    // so cookies are same-host and sent automatically.
    // Each tenant subdomain gets its own isolated cookie jar.
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      maxAge: REFRESH_MAX_AGE_MS,
      path: REFRESH_COOKIE_PATH,
    });
  }
}
