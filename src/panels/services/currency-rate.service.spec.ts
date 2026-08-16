import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import { CurrencyRateService } from './currency-rate.service';

describe('CurrencyRateService', () => {
  const prisma = {
    currencyRate: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  const service = new CurrencyRateService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
  });

  it('returns the active CNY→USD rate', async () => {
    prisma.currencyRate.findFirst.mockResolvedValue({
      rate: new Prisma.Decimal('0.1'),
    });

    const rate = await service.getActiveCnyUsdRate();
    expect(rate.toString()).toBe('0.1');
  });

  it('rejects a stored rate <= 0', async () => {
    prisma.currencyRate.findFirst.mockResolvedValue({
      rate: new Prisma.Decimal('0'),
    });

    await expect(service.getActiveCnyUsdRate()).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'INVALID_CURRENCY_RATE',
        statusCode: HttpStatus.BAD_REQUEST,
      }),
    });
  });

  it('rejects creating a non-positive rate', async () => {
    await expect(
      service.createCnyUsdRate({
        rate: '0',
        createdById: 'admin-id',
      }),
    ).rejects.toBeInstanceOf(BusinessException);
    expect(prisma.currencyRate.create).not.toHaveBeenCalled();
  });

  it('closes the previous open rate when creating a new one', async () => {
    prisma.currencyRate.updateMany.mockResolvedValue({ count: 1 });
    prisma.currencyRate.create.mockResolvedValue({
      id: 'rate-id',
      effectiveFrom: new Date('2026-08-17T00:00:00.000Z'),
    });
    prisma.auditLog.create.mockResolvedValue({});

    await service.createCnyUsdRate({
      rate: '0.12',
      createdById: 'admin-id',
      effectiveFrom: new Date('2026-08-17T00:00:00.000Z'),
    });

    expect(prisma.currencyRate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          fromCurrency: 'CNY',
          toCurrency: 'USD',
          effectiveTo: null,
        }),
      }),
    );
    expect(prisma.currencyRate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromCurrency: 'CNY',
          toCurrency: 'USD',
        }),
      }),
    );
  });
});
