import { SEEDED_SUPPLIER_QUALITY_MAPPINGS } from '../pricing/hpl-quality-matrix';

describe('HPL supplier quality matrix', () => {
  const key = (
    supplierCode: string,
    panelTypeCode: string,
    qualityClassCode: string,
  ) => `${supplierCode}|${panelTypeCode}|${qualityClassCode}`;

  const seeded = new Set(
    SEEDED_SUPPLIER_QUALITY_MAPPINGS.map((mapping) =>
      key(mapping.supplierCode, mapping.panelTypeCode, mapping.qualityClassCode),
    ),
  );

  it('confirms Tianran interior economy and exterior medium/premium', () => {
    expect(seeded.has(key('tianran', 'interior', 'economy'))).toBe(true);
    expect(seeded.has(key('tianran', 'exterior', 'medium'))).toBe(true);
    expect(seeded.has(key('tianran', 'exterior', 'premium'))).toBe(true);
  });

  it('rejects Tianran exterior economy', () => {
    expect(seeded.has(key('tianran', 'exterior', 'economy'))).toBe(false);
  });

  it('confirms Wuya quality is Economy only', () => {
    const wuya = SEEDED_SUPPLIER_QUALITY_MAPPINGS.filter(
      (mapping) => mapping.supplierCode === 'wuya',
    );
    expect(wuya.every((mapping) => mapping.qualityClassCode === 'economy')).toBe(
      true,
    );
    expect(seeded.has(key('wuya', 'exterior', 'medium'))).toBe(false);
    expect(seeded.has(key('wuya', 'exterior', 'premium'))).toBe(false);
  });

  it('confirms Polybet quality is Premium only', () => {
    const polybet = SEEDED_SUPPLIER_QUALITY_MAPPINGS.filter(
      (mapping) => mapping.supplierCode === 'polybet',
    );
    expect(
      polybet.every((mapping) => mapping.qualityClassCode === 'premium'),
    ).toBe(true);
    expect(seeded.has(key('polybet', 'exterior', 'economy'))).toBe(false);
    expect(seeded.has(key('polybet', 'interior', 'economy'))).toBe(false);
  });

  it('treats Wuya/Polybet interior+exterior applicability as a working assumption', () => {
    expect(seeded.has(key('wuya', 'exterior', 'economy'))).toBe(true);
    expect(seeded.has(key('wuya', 'interior', 'economy'))).toBe(true);
    expect(seeded.has(key('polybet', 'exterior', 'premium'))).toBe(true);
    expect(seeded.has(key('polybet', 'interior', 'premium'))).toBe(true);
  });

  it('does not seed Local or India matrices', () => {
    for (const mapping of SEEDED_SUPPLIER_QUALITY_MAPPINGS) {
      expect(['tianran', 'wuya', 'polybet']).toContain(mapping.supplierCode);
    }
  });
});
