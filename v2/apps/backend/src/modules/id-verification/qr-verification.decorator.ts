import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { idVerifications } from '@drive247/database';

type VerificationRow = typeof idVerifications.$inferSelect;

/**
 * Extracts the verification row attached by `QrTokenAuthGuard`.
 * Use as `@QrVerification() verification: VerificationRow` in public-controller
 * handlers.
 */
export const QrVerification = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): VerificationRow => {
    const req = ctx.switchToHttp().getRequest<{
      verification: VerificationRow;
    }>();
    return req.verification;
  },
);

/**
 * Extracts the `canMutate` flag set by `QrTokenAuthGuard`. False for
 * read-only terminal states (processing / approved / rejected /
 * review_required) — use to block mutations from the mobile page
 * after submit.
 */
export const QrCanMutate = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): boolean => {
    const req = ctx.switchToHttp().getRequest<{
      verificationCanMutate: boolean;
    }>();
    return req.verificationCanMutate ?? false;
  },
);
