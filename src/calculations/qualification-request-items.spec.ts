import { Prisma } from '@prisma/client';
import {
  mapQualificationItemToRequestItem,
  qualificationItemsForRequest,
  sheetsCountFromSize,
} from './qualification-request-items';

describe('qualificationItemsForRequest', () => {
  it('uses explicit items including an empty list', () => {
    expect(qualificationItemsForRequest({ items: [] })).toEqual([]);
    expect(
      qualificationItemsForRequest({
        items: [{ panelTypeId: 'type-1', requiredAreaM2: '4' }],
      }),
    ).toHaveLength(1);
  });

  it('falls back to legacy scalar HPL data as one item', () => {
    const items = qualificationItemsForRequest({
      application: 'FURNITURE',
      panelTypeId: 'type-furniture',
      requiredAreaM2: '12',
    });
    expect(items).toHaveLength(1);
    expect(items[0].panelTypeId).toBe('type-furniture');
  });

  it('does not invent a row when there is no HPL data', () => {
    expect(
      qualificationItemsForRequest({ customerRequirements: 'Need' }),
    ).toEqual([]);
    expect(qualificationItemsForRequest(null)).toEqual([]);
  });
});

describe('mapQualificationItemToRequestItem', () => {
  it('keeps incomplete technical fields as null without fake defaults', () => {
    const mapped = mapQualificationItemToRequestItem(
      {
        panelTypeId: 'type-1',
        colorName: 'тёмно-серый',
        requiredAreaM2: '12.5',
      },
      1,
      { panelTypeId: 'type-1' },
    );

    expect(mapped.sortOrder).toBe(1);
    expect(mapped.panelSizeId).toBeNull();
    expect(mapped.thicknessMm).toBeNull();
    expect(mapped.qualityClassId).toBeNull();
    expect(mapped.colorCode).toBeNull();
    expect(mapped.colorName).toBe('тёмно-серый');
    expect(mapped.coating).toBeNull();
    expect(mapped.texture).toBeNull();
    expect(mapped.decor).toBeNull();
    expect(mapped.requiredAreaM2?.toString()).toBe('12.5');
    expect(mapped.sheetsCount).toBe(0);
    expect(mapped.supplierPricePerM2.toString()).toBe('0');
  });

  it('computes sheets only when size and area are both present', () => {
    const mapped = mapQualificationItemToRequestItem(
      {
        panelSizeId: 'size-1',
        requiredAreaM2: '6',
      },
      0,
      {
        panelTypeId: 'type-1',
        panelSize: { widthMm: 1220, heightMm: 2440 },
      },
    );
    expect(mapped.sheetsCount).toBeGreaterThan(0);
    expect(sheetsCountFromSize(new Prisma.Decimal('6'), null)).toBe(0);
  });

  it('maps optional customer coating and texture without factory codes', () => {
    const mapped = mapQualificationItemToRequestItem(
      {
        colorName: 'Серый',
        coating: 'матовое',
        texture: 'под дерево',
        requiredAreaM2: '8',
      },
      0,
      { panelTypeId: 'type-1' },
    );

    expect(mapped.colorName).toBe('Серый');
    expect(mapped.coating).toBe('матовое');
    expect(mapped.texture).toBe('под дерево');
    expect(mapped.decor).toBeNull();
  });

  it('keeps blank coating and texture as null', () => {
    const mapped = mapQualificationItemToRequestItem(
      {
        colorName: 'Черный',
        coating: '  ',
        texture: '',
        requiredAreaM2: '4',
      },
      0,
      { panelTypeId: 'type-1' },
    );

    expect(mapped.coating).toBeNull();
    expect(mapped.texture).toBeNull();
  });
});
