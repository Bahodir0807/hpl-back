import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateLeadManagerCommercialNoteDto } from './update-lead-manager-commercial-note.dto';

describe('UpdateLeadManagerCommercialNoteDto', () => {
  it('accepts a customer-facing Manager note', async () => {
    const dto = plainToInstance(UpdateLeadManagerCommercialNoteDto, {
      commercialNote: '  Пожелания: CIP Tashkent  ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.commercialNote).toBe('Пожелания: CIP Tashkent');
  });

  it('rejects internal pricing fields on a crafted note payload', async () => {
    const dto = plainToInstance(UpdateLeadManagerCommercialNoteDto, {
      commercialNote: 'CIP',
      purchasePricePerM2Cny: '80',
      cnyUsdRate: '0.15',
      sellingCoefficient: '2',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some((error) =>
        Object.values(error.constraints ?? {}).some((message) =>
          message.includes('purchase-price'),
        ),
      ),
    ).toBe(true);
  });
});
