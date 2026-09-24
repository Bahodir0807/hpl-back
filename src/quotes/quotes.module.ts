import { Module } from '@nestjs/common';
import { DealsModule } from '../modules/deals/deals.module';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { PrismaModule } from '../modules/prisma/prisma.module';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { QuoteStockService } from './quote-stock.service';
import { QuoteDocumentService } from './quote-document.service';
import { QuoteCompositionService } from './quote-composition.service';
import { InventoryModule } from '../modules/inventory/inventory.module';
import { PanelsModule } from '../panels/panels.module';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    DealsModule,
    InventoryModule,
    PanelsModule,
  ],
  controllers: [QuotesController],
  providers: [
    QuotesService,
    QuoteStockService,
    QuoteDocumentService,
    QuoteCompositionService,
  ],
  exports: [QuotesService],
})
export class QuotesModule {}
