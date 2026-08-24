import { Module } from '@nestjs/common';
import { DealPolicyModule } from './deal-policy.module';
import { DealLossController } from './deal-loss.controller';
import { DealLossService } from './deal-loss.service';

@Module({
  imports: [DealPolicyModule],
  controllers: [DealLossController],
  providers: [DealLossService],
})
export class DealLossModule {}
