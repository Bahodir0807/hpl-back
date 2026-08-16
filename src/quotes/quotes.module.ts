import { Module } from '@nestjs/common';
import { DealsModule } from '../modules/deals/deals.module';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { PrismaModule } from '../modules/prisma/prisma.module';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';

@Module({
  imports: [PrismaModule, NotificationsModule, DealsModule],
  controllers: [QuotesController],
  providers: [QuotesService],
  exports: [QuotesService],
})
export class QuotesModule {}
