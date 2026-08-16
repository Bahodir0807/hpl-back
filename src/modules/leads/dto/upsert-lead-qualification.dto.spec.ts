import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { HplApplication } from '@prisma/client';
import { UpsertLeadQualificationDto } from './upsert-lead-qualification.dto';
import { mapQualificationWriteData } from '../lead-qualification.mapper';

describe('UpsertLeadQualificationDto commercial isolation', () => {
  it('rejects supplier and pricing injection', async () => {
    const dto = plainToInstance(UpsertLeadQualificationDto, {
      application: HplApplication.INTERIOR,
      supplierId: 'supplier-1',
      supplierPrice: 10,
      cnyUsdRate: 0.14,
      sellingCoefficient: 1.8,
      discount: 5,
      finalPrice: 999,
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(errors)).toContain(
      'Stage-1 qualification cannot include supplier',
    );
  });

  it('does not map commercial fields into the write payload', () => {
    const dto = Object.assign(new UpsertLeadQualificationDto(), {
      application: HplApplication.EXTERIOR,
      thicknessMm: 10,
      supplierId: 'should-not-persist',
      discount: 15,
    });

    expect(mapQualificationWriteData(dto)).toEqual({
      application: HplApplication.EXTERIOR,
      thicknessMm: 10,
    });
  });

  it('keeps installationRequired unknown when omitted', async () => {
    const dto = plainToInstance(UpsertLeadQualificationDto, {
      application: HplApplication.INTERIOR,
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.installationRequired).toBeUndefined();
  });

  it('accepts explicit installationRequired=false', async () => {
    const dto = plainToInstance(UpsertLeadQualificationDto, {
      installationRequired: false,
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.installationRequired).toBe(false);
  });
});
