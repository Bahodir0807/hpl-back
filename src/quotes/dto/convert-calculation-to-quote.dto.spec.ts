import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConvertCalculationToQuoteDto } from './convert-calculation-to-quote.dto';
import { UpdateQuoteCommercialTermsDto } from './update-quote-commercial-terms.dto';

const validationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

describe('ConvertCalculationToQuoteDto commercial terms', () => {
  it('accepts the supplier selected by HEAD for request pricing', async () => {
    const dto = plainToInstance(ConvertCalculationToQuoteDto, {
      supplierId: '11111111-1111-4111-8111-111111111111',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.supplierId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('accepts a valid production and delivery range', async () => {
    const dto = plainToInstance(ConvertCalculationToQuoteDto, {
      productionDaysFrom: 10,
      productionDaysTo: 20,
      deliveryDaysFrom: 14,
      deliveryDaysTo: 25,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.productionDaysFrom).toBe(10);
    expect(dto.productionDaysTo).toBe(20);
    expect(dto.deliveryDaysFrom).toBe(14);
    expect(dto.deliveryDaysTo).toBe(25);
  });

  it('rejects inverted, zero, and incomplete ranges', async () => {
    const inverted = await validate(
      plainToInstance(ConvertCalculationToQuoteDto, {
        productionDaysFrom: 20,
        productionDaysTo: 10,
      }),
    );
    expect(inverted.length).toBeGreaterThan(0);

    const zero = await validate(
      plainToInstance(ConvertCalculationToQuoteDto, {
        deliveryDaysFrom: 0,
        deliveryDaysTo: 14,
      }),
    );
    expect(zero.length).toBeGreaterThan(0);

    const incomplete = await validate(
      plainToInstance(ConvertCalculationToQuoteDto, {
        productionDaysFrom: 10,
      }),
    );
    expect(incomplete.length).toBeGreaterThan(0);
  });

  it('rejects a crafted documentDate on convert', async () => {
    await expect(
      validationPipe.transform(
        { documentDate: '2026-08-14T00:00:00.000Z' },
        { type: 'body', metatype: ConvertCalculationToQuoteDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('UpdateQuoteCommercialTermsDto', () => {
  it('rejects forged documentDate and internal pricing fields', async () => {
    await expect(
      validationPipe.transform(
        { documentDate: '2020-01-01T00:00:00.000Z' },
        { type: 'body', metatype: UpdateQuoteCommercialTermsDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      validationPipe.transform(
        { cnyUsdRate: '0.15', sellingCoefficient: '2' },
        { type: 'body', metatype: UpdateQuoteCommercialTermsDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      validationPipe.transform(
        { purchasePricePerM2Cny: '80' },
        { type: 'body', metatype: UpdateQuoteCommercialTermsDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts client-facing terms and note', async () => {
    const dto = (await validationPipe.transform(
      {
        productionDaysFrom: 10,
        productionDaysTo: 20,
        commercialNote: 'CIP Tashkent',
      },
      { type: 'body', metatype: UpdateQuoteCommercialTermsDto },
    )) as UpdateQuoteCommercialTermsDto;

    expect(dto.productionDaysFrom).toBe(10);
    expect(dto.commercialNote).toBe('CIP Tashkent');
    expect((dto as { documentDate?: Date }).documentDate).toBeUndefined();
  });
});
