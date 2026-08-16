import { Module } from '@nestjs/common';
import { DealPolicyModule } from '../deals/deal-policy.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SupplierOrdersController } from './supplier-orders.controller';
import { SupplierOrdersService } from './supplier-orders.service';

@Module({
  imports: [PrismaModule, DealPolicyModule],
  controllers: [SupplierOrdersController],
  providers: [SupplierOrdersService],
  exports: [SupplierOrdersService],
})
export class SupplierOrdersModule {}
