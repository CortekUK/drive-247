import type { UserRole } from './enums';

// --- Public user shape (safe to send to frontend) ---

export type PublicUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole | string;
  isSuperAdmin: boolean;
  isPrimarySuperAdmin: boolean;
  mustChangePassword: boolean;
  avatarUrl: string | null;
};

// --- Request payloads ---

export type LoginPayload = {
  email: string;
  password: string;
};

export type ChangePasswordPayload = {
  currentPassword: string;
  newPassword: string;
};

// --- Response shapes ---

export type LoginResponse = {
  accessToken: string;
  user: PublicUser;
};

// Backend-only — includes refreshToken before it's moved to httpOnly cookie
export type LoginResult = LoginResponse & {
  refreshToken: string;
};

export type RefreshResponse = {
  accessToken: string;
};

export type ProfileResponse = PublicUser & {
  tenantId: string | null;
};

// --- API wrapper ---

export type ApiResponse<T = unknown> = {
  success: true;
  data: T;
  message?: string;
  meta?: {
    page: number;
    limit: number;
    total: number;
  };
};

export type ApiError = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string }[];
  };
};
