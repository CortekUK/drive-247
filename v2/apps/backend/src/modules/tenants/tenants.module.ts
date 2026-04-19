import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantSettingsController } from './tenant-settings.controller';
import { TenantsService } from './tenants.service';
import { AuthModule } from '../auth/auth.module';
import { RemindersModule } from '../reminders/reminders.module';

@Module({
  imports: [AuthModule, RemindersModule],
  controllers: [TenantsController, TenantSettingsController],
  providers: [TenantsService],
})
export class TenantsModule {}
