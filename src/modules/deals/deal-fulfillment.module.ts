import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DealPolicyModule } from './deal-policy.module';
import { DealCompletionService } from './deal-completion.service';
import { DealInstallationService } from './deal-installation.service';
import { InstallationsController } from './installations.controller';

@Module({
  imports: [PrismaModule, DealPolicyModule],
  controllers: [InstallationsController],
  providers: [DealCompletionService, DealInstallationService],
  exports: [DealCompletionService, DealInstallationService],
})
export class DealFulfillmentModule {}
