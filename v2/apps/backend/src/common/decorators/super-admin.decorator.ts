import { SetMetadata } from '@nestjs/common';

export const SUPER_ADMIN_KEY = 'superAdminOnly';
export const SuperAdminOnly = () => SetMetadata(SUPER_ADMIN_KEY, true);
