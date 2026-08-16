import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { CreateCurrencyRateDto } from '../dto/create-currency-rate.dto';
import {
  HPL_SELLING_CURRENCY,
  HPL_SOURCE_CURRENCY,
  CURRENCY_RATES_MANAGE_PERMISSION,
} from '../pricing/hpl-pricing.constants';
import { CurrencyRateService } from '../services/currency-rate.service';

@ApiTags('currency-rates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('currency-rates')
export class CurrencyRateController {
  constructor(private readonly currencyRateService: CurrencyRateService) {}

  @Get('current')
  @RequirePermissions(CURRENCY_RATES_MANAGE_PERMISSION)
  @ApiOperation({ summary: 'Get the active CNY → USD rate' })
  getCurrent() {
    return this.currencyRateService.getActiveCnyUsdRate().then((rate) => ({
      fromCurrency: HPL_SOURCE_CURRENCY,
      toCurrency: HPL_SELLING_CURRENCY,
      rate: rate.toString(),
    }));
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions(CURRENCY_RATES_MANAGE_PERMISSION)
  @ApiOperation({ summary: 'Set a new CNY → USD rate (privileged)' })
  create(
    @Body() dto: CreateCurrencyRateDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.currencyRateService.createCnyUsdRate({
      rate: dto.rate,
      createdById: user.id,
      effectiveFrom: dto.effectiveFrom,
    });
  }
}
