import { Global, Module } from '@nestjs/common';
import { db } from './db';

export const DATABASE = Symbol('DATABASE');

@Global()
@Module({
  providers: [{ provide: DATABASE, useValue: db }],
  exports: [DATABASE],
})
export class DatabaseModule {}
