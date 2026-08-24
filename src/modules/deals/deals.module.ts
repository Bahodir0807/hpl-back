import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SupplierOrdersModule } from '../supplier-orders/supplier-orders.module';
import { DealPolicyModule } from './deal-policy.module';
import { DealFulfillmentModule } from './deal-fulfillment.module';
import { DealsController } from './deals.controller';
import { DealFactory } from './services/deal-factory.service';
import { DealsService } from './deals.service';
import { PricingPolicyService } from '../orders/services/pricing-policy.service';

@Module({
  imports: [
    PrismaModule,
    SupplierOrdersModule,
    DealPolicyModule,
    DealFulfillmentModule,
  ],
  controllers: [DealsController],
  providers: [DealsService, DealFactory, PricingPolicyService],
  exports: [DealsService, DealFactory],
})
export class DealsModule {}
