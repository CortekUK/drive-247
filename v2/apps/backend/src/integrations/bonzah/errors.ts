/**
 * Typed errors for Bonzah API failures.
 * Callers can catch by type and react specifically (e.g. map to ConflictException,
 * retry once on auth expiry, escalate to reminder on balance).
 */

export class BonzahApiError extends Error {
  status?: number;
  bonzahStatus?: number;
  bonzahText?: string;

  constructor(
    message: string,
    opts?: { status?: number; bonzahStatus?: number; bonzahText?: string },
  ) {
    super(message);
    this.name = 'BonzahApiError';
    this.status = opts?.status;
    this.bonzahStatus = opts?.bonzahStatus;
    this.bonzahText = opts?.bonzahText;
  }
}

export class BonzahAuthError extends BonzahApiError {
  constructor(message = 'Bonzah authentication failed') {
    super(message);
    this.name = 'BonzahAuthError';
  }
}

export class BonzahInsufficientBalanceError extends BonzahApiError {
  constructor(message = 'Insufficient Bonzah CD balance to issue policy') {
    super(message);
    this.name = 'BonzahInsufficientBalanceError';
  }
}

export class BonzahNotConfiguredError extends BonzahApiError {
  constructor(message = 'Bonzah credentials are not configured for this tenant') {
    super(message);
    this.name = 'BonzahNotConfiguredError';
  }
}

export class BonzahValidationError extends BonzahApiError {
  errors: string[];
  constructor(message: string, errors: string[] = []) {
    super(message);
    this.name = 'BonzahValidationError';
    this.errors = errors;
  }
}
