import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../modules/prisma/prisma.service';
import {
  HPL_SELLING_COEFFICIENT,
  HPL_SOURCE_CURRENCY,
} from '../pricing/hpl-pricing.constants';

@Injectable()
export class PanelPriceCalculator {
  constructor(private readonly prisma: PrismaService) {}

  async calculate(input: {
    supplierId: string;
    qualityClassId: string;
    thicknessMm: number;
    widthMm: number;
    heightMm: number;
    sheets: number;
    cnyUsdRate: Prisma.Decimal;
  }) {
    if (!Number.isInteger(input.sheets) || input.sheets <= 0) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'INVALID_QUANTITY',
        'Количество листов должно быть целым числом больше 0',
      );
    }

    if (input.widthMm <= 0 || input.heightMm <= 0) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'INVALID_AREA',
        'Размер листа должен быть больше 0',
      );
    }

    const cnyUsdRate = new Prisma.Decimal(input.cnyUsdRate.toString());
    if (cnyUsdRate.lte(0)) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'INVALID_CURRENCY_RATE',
        'Курс CNY → USD должен быть больше 0',
      );
    }

    const pricing = await this.prisma.panelThicknessPricing.findFirst({
      where: {
        supplierId: input.supplierId,
        qualityClassId: input.qualityClassId,
        thicknessMm: input.thicknessMm,
        isActive: true,
      },
    });

    if (!pricing) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'PRICING_NOT_FOUND',
        `Цена для толщины ${input.thicknessMm} мм не найдена`,
      );
    }

    if (pricing.currencyCode !== HPL_SOURCE_CURRENCY) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'PRICING_CURRENCY_INVALID',
        'Закупочная цена поставщика должна быть в CNY',
      );
    }

    const supplierPricePerM2 = new Prisma.Decimal(
      pricing.basePricePerM2.toString(),
    );
    if (supplierPricePerM2.lte(0)) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'INVALID_SUPPLIER_PRICE',
        'Закупочная цена поставщика должна быть больше 0',
      );
    }

    const usdPerM2 = supplierPricePerM2.mul(cnyUsdRate);
    const clientPricePerM2 = usdPerM2.mul(HPL_SELLING_COEFFICIENT);
    const areaM2 = new Prisma.Decimal(input.widthMm)
      .mul(input.heightMm)
      .div(1_000_000);
    const pricePerSheet = clientPricePerM2.mul(areaM2);
    const total = pricePerSheet.mul(input.sheets);

    if (total.lt(0)) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'INVALID_TOTAL',
        'Итоговая цена не может быть отрицательной',
      );
    }

    return {
      supplierPricePerM2: supplierPricePerM2.toDecimalPlaces(2),
      clientPricePerM2: clientPricePerM2.toDecimalPlaces(2),
      pricePerSheet: pricePerSheet.toDecimalPlaces(2),
      total: total.toDecimalPlaces(2),
      areaM2: areaM2.toDecimalPlaces(4),
      cnyUsdRate,
      sellingCoefficient: HPL_SELLING_COEFFICIENT,
    };
  }
}
