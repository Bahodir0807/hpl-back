import { Module } from '@nestjs/common';
import { PanelsModule } from '../panels/panels.module';
import { QuotesModule } from '../quotes/quotes.module';
import { CalculationsController } from './calculations.controller';
import { CalculationService } from './calculations.service';

@Module({
  imports: [PanelsModule, QuotesModule],
  controllers: [CalculationsController],
  providers: [CalculationService],
  exports: [CalculationService],
})
export class CalculationsModule {}
