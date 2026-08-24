import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DealFulfillmentModule } from '../deals/deal-fulfillment.module';
import { OrdersController } from './orders.controller';
import { OrderPolicyService } from './services/order-policy.service';
import { PricingPolicyService } from './services/pricing-policy.service';
import { OrdersService } from './orders.service';

@Module({
  imports: [PrismaModule, InventoryModule, DealFulfillmentModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderPolicyService, PricingPolicyService],
  exports: [OrdersService],
})
export class OrdersModule {}
