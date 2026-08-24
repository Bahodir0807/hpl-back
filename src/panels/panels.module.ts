import { Module } from '@nestjs/common';
import { PrismaModule } from '../modules/prisma/prisma.module';
import { PanelColorsController } from './controllers/panel-colors.controller';
import { PanelPricingController } from './controllers/panel-pricing.controller';
import { PanelSizesController } from './controllers/panel-sizes.controller';
import { PanelTypesController } from './controllers/panel-types.controller';
import { SupplierQualityController } from './controllers/supplier-quality.controller';
import { CurrencyRateController } from './controllers/currency-rate.controller';
import { PanelPriceCalculator } from './services/panel-price-calculator.service';
import { PanelQuantityCalculator } from './services/panel-quantity-calculator.service';
import { PanelColorsService } from './services/panel-colors.service';
import { CurrencyRateService } from './services/currency-rate.service';
import { PanelThicknessPricingService } from './services/panel-thickness-pricing.service';
import { SupplierQualityService } from './services/supplier-quality.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    PanelTypesController,
    PanelSizesController,
    PanelPricingController,
    SupplierQualityController,
    PanelColorsController,
    CurrencyRateController,
  ],
  providers: [
    PanelQuantityCalculator,
    PanelPriceCalculator,
    PanelColorsService,
    CurrencyRateService,
    PanelThicknessPricingService,
    SupplierQualityService,
  ],
  exports: [
    PanelQuantityCalculator,
    PanelPriceCalculator,
    PanelColorsService,
    CurrencyRateService,
    PanelThicknessPricingService,
  ],
})
export class PanelsModule {}
