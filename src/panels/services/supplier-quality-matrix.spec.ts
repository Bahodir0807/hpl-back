import { HPL_QUALITY_CLASS_CODES } from '../hpl-catalog';
import {
  CRM_SUPPLIER_CODES,
  SEEDED_SUPPLIER_QUALITY_MAPPINGS,
  panelTypeCodeForApplication,
} from '../pricing/hpl-quality-matrix';

describe('HPL supplier quality matrix', () => {
  const key = (
    supplierCode: string,
    panelTypeCode: string,
    qualityClassCode: string,
  ) => `${supplierCode}|${panelTypeCode}|${qualityClassCode}`;

  const seeded = new Set(
    SEEDED_SUPPLIER_QUALITY_MAPPINGS.map((mapping) =>
      key(
        mapping.supplierCode,
        mapping.panelTypeCode,
        mapping.qualityClassCode,
      ),
    ),
  );

  const standardTypes = [
    'interior',
    'exterior_with_uv',
    'laboratory',
    'furniture',
  ];

  it('gives every CRM manufacturer economy, medium and premium for every standard type', () => {
    for (const supplierCode of CRM_SUPPLIER_CODES) {
      for (const panelTypeCode of standardTypes) {
        for (const qualityClassCode of HPL_QUALITY_CLASS_CODES) {
          expect(
            seeded.has(key(supplierCode, panelTypeCode, qualityClassCode)),
          ).toBe(true);
        }
      }
    }
  });

  it('does not invent a fourth quality class', () => {
    expect([...HPL_QUALITY_CLASS_CODES]).toEqual([
      'economy',
      'medium',
      'premium',
    ]);
    expect(
      SEEDED_SUPPLIER_QUALITY_MAPPINGS.every((mapping) =>
        HPL_QUALITY_CLASS_CODES.includes(mapping.qualityClassCode),
      ),
    ).toBe(true);
  });

  it('does not seed Local or India matrices', () => {
    for (const mapping of SEEDED_SUPPLIER_QUALITY_MAPPINGS) {
      expect([...CRM_SUPPLIER_CODES]).toContain(mapping.supplierCode);
    }
  });

  it('maps INTERIOR/EXTERIOR_WITH_UV to catalog panel type codes', () => {
    expect(panelTypeCodeForApplication('INTERIOR')).toBe('interior');
    expect(panelTypeCodeForApplication('EXTERIOR_WITH_UV')).toBe(
      'exterior_with_uv',
    );
    expect(panelTypeCodeForApplication('EXTERIOR')).toBe('exterior_with_uv');
  });
});
