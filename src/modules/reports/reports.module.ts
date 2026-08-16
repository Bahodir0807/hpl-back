import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [PrismaModule, UsersModule, CacheModule.register({ ttl: 60_000 })],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
