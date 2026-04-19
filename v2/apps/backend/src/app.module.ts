import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { TenantContextModule } from './common/context/tenant-context.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { CustomersModule } from './modules/customers/customers.module';
import { RentalsModule } from './modules/rentals/rentals.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { BonzahIntegrationModule } from './integrations/bonzah/bonzah.module';
import { OpenAIIntegrationModule } from './integrations/openai/openai.module';
import { AwsIntegrationModule } from './integrations/aws/aws.module';
import { StorageModule } from './common/storage/storage.module';
import { RemindersModule } from './modules/reminders/reminders.module';
import { BonzahModule } from './modules/bonzah/bonzah.module';
import { IdVerificationModule } from './modules/id-verification/id-verification.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { TenantInterceptor } from './common/interceptors/tenant.interceptor';

@Module({
  imports: [
    DatabaseModule,
    TenantContextModule,
    BonzahIntegrationModule,
    OpenAIIntegrationModule,
    AwsIntegrationModule,
    StorageModule,
    RemindersModule,
    AuthModule,
    UsersModule,
    TenantsModule,
    VehiclesModule,
    CustomersModule,
    RentalsModule,
    InvoicesModule,
    PaymentsModule,
    BonzahModule,
    IdVerificationModule,
  ],
  providers: [
    // Global guards run in this order:
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    // Global interceptors:
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  ],
})
export class AppModule {}
