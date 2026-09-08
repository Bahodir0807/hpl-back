import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CalculationItemDto,
  PreviewCalculationDto,
} from './calculation-item.dto';
import { CreateCalculationRequestDto } from './create-calculation-request.dto';

const validationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

describe('CalculationItemDto purchasePricePerM2Cny', () => {
  it('accepts a positive CNY purchase price string', async () => {
    const dto = plainToInstance(CalculationItemDto, {
      purchasePricePerM2Cny: '80',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.purchasePricePerM2Cny).toBe('80');
  });

  it('rejects a negative purchase price', async () => {
    const dto = plainToInstance(CalculationItemDto, {
      purchasePricePerM2Cny: '-10',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-numeric purchase price', async () => {
    const dto = plainToInstance(PreviewCalculationDto, {
      leadId: '11111111-1111-4111-8111-111111111111',
      purchasePricePerM2Cny: 'abc',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a negative required area', async () => {
    const dto = plainToInstance(CalculationItemDto, {
      requiredAreaM2: '-1',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('CalculationItemDto manager technical fields', () => {
  const catalogItem = {
    panelTypeId: '11111111-1111-4111-8111-111111111111',
    panelSizeId: '22222222-2222-4222-8222-222222222222',
    thicknessMm: '10',
    qualityClassId: '44444444-4444-4444-8444-444444444444',
    colorId: '55555555-5555-4555-8555-555555555555',
    coating: 'PE',
    texture: 'woodgrain',
    customTypeDescription: 'Special fire-rated HPL',
    requiredAreaM2: '12.5',
    sheetsCount: 4,
    customWidthMm: 1400,
    customHeightMm: 3100,
  };

  it('accepts sheetsCount, custom size, coating, texture, colorId and custom type', async () => {
    const dto = plainToInstance(CalculationItemDto, catalogItem);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.sheetsCount).toBe(4);
    expect(dto.customWidthMm).toBe(1400);
    expect(dto.customHeightMm).toBe(3100);
    expect(dto.colorId).toBe(catalogItem.colorId);
    expect(dto.coating).toBe('PE');
    expect(dto.texture).toBe('woodgrain');
    expect(dto.customTypeDescription).toBe('Special fire-rated HPL');
  });

  it('does not require sheetsCount on a manager catalog item', async () => {
    const { sheetsCount: _ignored, ...withoutSheets } = catalogItem;
    const dto = plainToInstance(CalculationItemDto, withoutSheets);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.sheetsCount).toBeUndefined();
  });

  it('accepts a nested manager CalculationRequest item without supplierId', async () => {
    const dto = plainToInstance(CreateCalculationRequestDto, {
      leadId: '11111111-1111-4111-8111-111111111111',
      calculations: [{ title: 'Group 1', items: [catalogItem] }],
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.calculations[0]?.items[0]?.supplierId).toBeUndefined();
  });

  it('accepts arbitrary Decor text independently of PanelColor', async () => {
    const dto = plainToInstance(CalculationItemDto, {
      ...catalogItem,
      decor: 'Concrete Grey 7016',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.decor).toBe('Concrete Grey 7016');
  });

  it('rejects unknown fields such as fooBar under forbidNonWhitelisted', async () => {
    await expect(
      validationPipe.transform(
        { ...catalogItem, fooBar: 'nope' },
        { type: 'body', metatype: CalculationItemDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown fields on nested CalculationRequest POST payload', async () => {
    await expect(
      validationPipe.transform(
        {
          leadId: '11111111-1111-4111-8111-111111111111',
          calculations: [
            {
              title: 'Group 1',
              items: [{ ...catalogItem, fooBar: 'White Oak' }],
            },
          ],
        },
        { type: 'body', metatype: CreateCalculationRequestDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a negative sheetsCount', async () => {
    const dto = plainToInstance(CalculationItemDto, {
      ...catalogItem,
      sheetsCount: -1,
    });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'sheetsCount')).toBe(true);
  });

  it('rejects half-filled custom dimensions', async () => {
    const errors = await validate(
      plainToInstance(CalculationItemDto, {
        panelTypeId: catalogItem.panelTypeId,
        customWidthMm: 1400,
      }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-positive custom dimensions', async () => {
    const dto = plainToInstance(CalculationItemDto, {
      customWidthMm: 0,
      customHeightMm: 3100,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
