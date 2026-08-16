import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../modules/prisma/prisma.service';

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
  }) {
    const [pricing, supplier] = await Promise.all([
      this.prisma.panelThicknessPricing.findFirst({
        where: {
          supplierId: input.supplierId,
          qualityClassId: input.qualityClassId,
          thicknessMm: input.thicknessMm,
          isActive: true,
        },
      }),
      this.prisma.supplier.findUnique({
        where: { id: input.supplierId },
        select: { marginPercent: true },
      }),
    ]);

    if (!pricing) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'PRICING_NOT_FOUND',
        `Цена для толщины ${input.thicknessMm} мм не найдена`,
      );
    }

    const supplierPricePerM2 = new Prisma.Decimal(
      pricing.basePricePerM2.toString(),
    );
    const marginPercent = new Prisma.Decimal(
      supplier?.marginPercent?.toString() ?? '0',
    );
    const clientPricePerM2 = supplierPricePerM2.mul(
      new Prisma.Decimal(1).plus(marginPercent.div(100)),
    );
    const areaM2 = new Prisma.Decimal(input.widthMm * input.heightMm).div(
      1_000_000,
    );
    const pricePerSheet = clientPricePerM2.mul(areaM2);
    const total = pricePerSheet.mul(input.sheets);

    return {
      supplierPricePerM2: supplierPricePerM2.toDecimalPlaces(2),
      clientPricePerM2: clientPricePerM2.toDecimalPlaces(2),
      pricePerSheet: pricePerSheet.toDecimalPlaces(2),
      total: total.toDecimalPlaces(2),
      areaM2: areaM2.toDecimalPlaces(4),
    };
  }
}
