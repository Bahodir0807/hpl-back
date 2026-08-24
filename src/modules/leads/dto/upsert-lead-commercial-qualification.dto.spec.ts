import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpsertLeadCommercialQualificationDto } from './upsert-lead-commercial-qualification.dto';

describe('UpsertLeadCommercialQualificationDto', () => {
  const completePayload = {
    supplierId: '11111111-1111-4111-8111-111111111111',
    qualityClassId: '22222222-2222-4222-8222-222222222222',
    targetDate: '2026-10-01T00:00:00.000Z',
    decisionComment: 'Tianran Premium for facade',
  };

  it('accepts supplier, quality, commercial timeline and decision comment', async () => {
    const dto = plainToInstance(
      UpsertLeadCommercialQualificationDto,
      completePayload,
    );
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts Stage-2 without targetDate for current frontend compatibility', async () => {
    const dto = plainToInstance(UpsertLeadCommercialQualificationDto, {
      supplierId: completePayload.supplierId,
      qualityClassId: completePayload.qualityClassId,
      decisionComment: completePayload.decisionComment,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects FX, coefficient, supplier price and discount injection', async () => {
    const dto = plainToInstance(UpsertLeadCommercialQualificationDto, {
      ...completePayload,
      cnyUsdRate: 0.2,
      sellingCoefficient: 1.5,
      supplierPricePerM2: 1,
      discount: 10,
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(errors)).toContain(
      'Stage-2 commercial qualification cannot include FX',
    );
  });
});
