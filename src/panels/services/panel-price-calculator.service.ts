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
    thicknessMm: Prisma.Decimal | number;
    widthMm?: number;
    heightMm?: number;
    areaM2?: Prisma.Decimal | number | string;
    sheets: number;
    cnyUsdRate: Prisma.Decimal;
    purchasePricePerM2Cny?: Prisma.Decimal | string | null;
  }) {
    if (!Number.isInteger(input.sheets) || input.sheets <= 0) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'INVALID_QUANTITY',
        'Количество листов должно быть целым числом больше 0',
      );
    }

    const areaM2 =
      input.areaM2 !== undefined
        ? new Prisma.Decimal(input.areaM2.toString())
        : input.widthMm !== undefined && input.heightMm !== undefined
          ? new Prisma.Decimal(input.widthMm).mul(input.heightMm).div(1_000_000)
          : new Prisma.Decimal(0);

    if (areaM2.lte(0)) {
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

    const supplierPricePerM2 = await this.resolveSupplierPricePerM2Cny(input);
    if (supplierPricePerM2.lte(0)) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'INVALID_SUPPLIER_PRICE',
        'Закупочная цена должна быть больше 0',
      );
    }

    const usdPerM2 = supplierPricePerM2.mul(cnyUsdRate);
    const clientPricePerM2 = usdPerM2.mul(HPL_SELLING_COEFFICIENT);
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

  private async resolveSupplierPricePerM2Cny(input: {
    supplierId: string;
    qualityClassId: string;
    thicknessMm: Prisma.Decimal | number;
    purchasePricePerM2Cny?: Prisma.Decimal | string | null;
  }): Promise<Prisma.Decimal> {
    if (
      input.purchasePricePerM2Cny !== undefined &&
      input.purchasePricePerM2Cny !== null &&
      input.purchasePricePerM2Cny !== ''
    ) {
      return new Prisma.Decimal(input.purchasePricePerM2Cny.toString());
    }

    const pricing = await this.prisma.panelThicknessPricing.findFirst({
      where: {
        supplierId: input.supplierId,
        qualityClassId: input.qualityClassId,
        thicknessMm: new Prisma.Decimal(input.thicknessMm.toString()),
        isActive: true,
      },
    });

    if (!pricing) {
      throw new BusinessException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'PRICING_NOT_CONFIGURED',
        `Цена для толщины ${input.thicknessMm.toString()} мм не настроена`,
      );
    }

    if (pricing.currencyCode !== HPL_SOURCE_CURRENCY) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'PRICING_CURRENCY_INVALID',
        'Закупочная цена поставщика должна быть в CNY',
      );
    }

    return new Prisma.Decimal(pricing.basePricePerM2.toString());
  }
}
