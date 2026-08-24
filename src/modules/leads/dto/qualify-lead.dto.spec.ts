import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QualifyLeadDto } from './qualify-lead.dto';

describe('QualifyLeadDto', () => {
  const completePayload = {
    clientId: '11111111-1111-4111-8111-111111111111',
    contactId: '33333333-3333-4333-8333-333333333333',
    projectObjectId: '22222222-2222-4222-8222-222222222222',
    needDescription: 'HPL panels for lobby',
    decisionMakerContact: 'Chief architect',
  };

  it('accepts Stage-1 customer fields without commercial amount or timeline', async () => {
    const dto = plainToInstance(QualifyLeadDto, completePayload);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts Stage-1 without contactId, estimatedAmount or targetDate', async () => {
    const dto = plainToInstance(QualifyLeadDto, {
      clientId: completePayload.clientId,
      projectObjectId: completePayload.projectObjectId,
      needDescription: completePayload.needDescription,
      decisionMakerContact: completePayload.decisionMakerContact,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects supplier, quality, amount, timeline, FX, coefficient and discount injection', async () => {
    const dto = plainToInstance(QualifyLeadDto, {
      ...completePayload,
      estimatedAmount: 125000,
      targetDate: '2026-09-01T00:00:00.000Z',
      supplierId: 'supplier-1',
      qualityClassId: 'quality-1',
      CurrencyRate: 12500,
      price: 999,
      coefficient: 1.15,
      discount: 5,
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(errors)).toContain(
      'Stage-1 qualification cannot include supplier',
    );
  });
});
