import { Module } from '@nestjs/common';
import { DealPolicyService } from './services/deal-policy.service';

@Module({
  providers: [DealPolicyService],
  exports: [DealPolicyService],
})
export class DealPolicyModule {}
