import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../modules/prisma/prisma.service';
import {
  HPL_SELLING_CURRENCY,
  HPL_SOURCE_CURRENCY,
} from '../pricing/hpl-pricing.constants';

@Injectable()
export class CurrencyRateService {
  constructor(private readonly prisma: PrismaService) {}

  async getActiveCnyUsdRate(
    at: Date = new Date(),
  ): Promise<Prisma.Decimal> {
    const row = await this.prisma.currencyRate.findFirst({
      where: {
        fromCurrency: HPL_SOURCE_CURRENCY,
        toCurrency: HPL_SELLING_CURRENCY,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (!row) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'CURRENCY_RATE_NOT_FOUND',
        'Не задан курс CNY → USD',
      );
    }

    const rate = new Prisma.Decimal(row.rate.toString());
    this.assertPositiveRate(rate);
    return rate;
  }

  async createCnyUsdRate(input: {
    rate: string;
    createdById: string;
    effectiveFrom?: Date;
  }) {
    const rate = new Prisma.Decimal(input.rate);
    this.assertPositiveRate(rate);

    const effectiveFrom = input.effectiveFrom ?? new Date();

    return this.prisma.$transaction(async (tx) => {
      await tx.currencyRate.updateMany({
        where: {
          fromCurrency: HPL_SOURCE_CURRENCY,
          toCurrency: HPL_SELLING_CURRENCY,
          effectiveTo: null,
        },
        data: { effectiveTo: effectiveFrom },
      });

      const created = await tx.currencyRate.create({
        data: {
          fromCurrency: HPL_SOURCE_CURRENCY,
          toCurrency: HPL_SELLING_CURRENCY,
          rate,
          effectiveFrom,
          createdById: input.createdById,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: input.createdById,
          action: 'CURRENCY_RATE_CREATED',
          entityType: 'CurrencyRate',
          entityId: created.id,
          newValue: {
            fromCurrency: HPL_SOURCE_CURRENCY,
            toCurrency: HPL_SELLING_CURRENCY,
            rate: rate.toString(),
            effectiveFrom: created.effectiveFrom.toISOString(),
          },
        },
      });

      return created;
    });
  }

  private assertPositiveRate(rate: Prisma.Decimal): void {
    if (rate.lte(0)) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'INVALID_CURRENCY_RATE',
        'Курс CNY → USD должен быть больше 0',
      );
    }
  }
}
