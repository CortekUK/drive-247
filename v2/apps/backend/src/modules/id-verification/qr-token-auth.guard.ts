import {
  CanActivate,
  ExecutionContext,
  GoneException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { idVerifications } from '@drive247/database';
import { IdVerificationStatus } from '@drive247/shared-types';
import { IdVerificationSessionService } from './id-verification-session.service';

type VerificationRow = typeof idVerifications.$inferSelect;

/** Statuses that still allow read + mutation via the public capture API. */
const ACTIVE = [
  IdVerificationStatus.INITIATED,
  IdVerificationStatus.IN_PROGRESS,
] as const;

/** Statuses where READ is OK (so the mobile page can show final result)
 *  but mutation is forbidden. */
const READ_ONLY_TERMINAL = [
  IdVerificationStatus.PROCESSING,
  IdVerificationStatus.APPROVED,
  IdVerificationStatus.REJECTED,
  IdVerificationStatus.REVIEW_REQUIRED,
] as const;

/**
 * Guard for the public mobile capture controller. Reads `:token` from
 * the path, hashes it, looks up the verification, and attaches the row
 * to `req.verification`. Also attaches a `req.verificationCanMutate` flag
 * so handlers can distinguish "read-only terminal" from "mutable active".
 *
 * Rejects:
 *   - no token              → 401
 *   - token not found       → 401 (avoid leaking existence)
 *   - session expired       → 410 Gone (so mobile can show a clear message)
 *   - session cancelled     → 410 Gone
 *
 * For mutation endpoints, additionally check `req.verificationCanMutate`
 * in the handler and throw ConflictException if false.
 */
@Injectable()
export class QrTokenAuthGuard implements CanActivate {
  constructor(
    private readonly sessionService: IdVerificationSessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      params: Record<string, string>;
      verification?: VerificationRow;
      verificationCanMutate?: boolean;
    }>();

    const rawToken = req.params?.token;
    if (!rawToken) throw new UnauthorizedException('Missing session token');

    const row = await this.sessionService.findByToken(rawToken);
    if (!row) throw new UnauthorizedException('Invalid session token');

    const status = row.status as IdVerificationStatus;

    if (
      status === IdVerificationStatus.EXPIRED ||
      status === IdVerificationStatus.CANCELLED
    ) {
      throw new GoneException(
        `This verification session has ${status}. Ask the staff member to start a new one.`,
      );
    }

    const canMutate = (ACTIVE as readonly string[]).includes(status);
    const canRead =
      canMutate || (READ_ONLY_TERMINAL as readonly string[]).includes(status);
    if (!canRead) {
      throw new GoneException('This verification session is no longer active.');
    }

    req.verification = row;
    req.verificationCanMutate = canMutate;
    return true;
  }
}
