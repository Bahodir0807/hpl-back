import { HplApplication } from '@prisma/client';
import {
  HPL_CANONICAL_PANEL_SIZES,
  HPL_CUSTOM_PANEL_TYPE_CODE,
  HPL_CUSTOM_PANEL_TYPE_DISPLAY_RU,
  HPL_DISCRETE_THICKNESS_MM,
  HPL_PANEL_TYPE_CODES,
  HPL_QUALITY_CLASS_CODES,
  HPL_STANDARD_APPLICATIONS,
  canonicalizeHplApplication,
  isCanonicalPanelSize,
  panelTypeCodeForApplication,
  resolvePanelTypeQuery,
  supplierQualityMatrixApplies,
} from './hpl-catalog';

describe('HPL catalog', () => {
  it('exposes a custom OTHER panel type without inventing a fourth quality class', () => {
    expect(HPL_CUSTOM_PANEL_TYPE_CODE).toBe('other');
    expect(HPL_CUSTOM_PANEL_TYPE_DISPLAY_RU).toBe('Другой');
    expect([...HPL_QUALITY_CLASS_CODES]).toEqual([
      'economy',
      'medium',
      'premium',
    ]);
  });

  it('exposes exactly the four confirmed standard types', () => {
    expect([...HPL_STANDARD_APPLICATIONS]).toEqual([
      'INTERIOR',
      'EXTERIOR_WITH_UV',
      'LABORATORY',
      'FURNITURE',
    ]);
    expect(HPL_PANEL_TYPE_CODES).toEqual({
      INTERIOR: 'interior',
      EXTERIOR_WITH_UV: 'exterior_with_uv',
      LABORATORY: 'laboratory',
      FURNITURE: 'furniture',
    });
  });

  it('accepts the four canonical applications and rejects obsolete values', () => {
    expect(canonicalizeHplApplication(HplApplication.INTERIOR)).toBe(
      'INTERIOR',
    );
    expect(canonicalizeHplApplication('EXTERIOR_WITH_UV')).toBe(
      'EXTERIOR_WITH_UV',
    );
    expect(canonicalizeHplApplication('LABORATORY')).toBe('LABORATORY');
    expect(canonicalizeHplApplication('FURNITURE')).toBe('FURNITURE');
    expect(canonicalizeHplApplication('EXTERIOR')).toBe('EXTERIOR_WITH_UV');
    expect(canonicalizeHplApplication('OTHER')).toBeNull();
    expect(canonicalizeHplApplication('interior')).toBeNull();
  });

  it('maps applications to canonical panel type codes', () => {
    expect(panelTypeCodeForApplication('INTERIOR')).toBe('interior');
    expect(panelTypeCodeForApplication('EXTERIOR_WITH_UV')).toBe(
      'exterior_with_uv',
    );
    expect(panelTypeCodeForApplication('EXTERIOR')).toBe('exterior_with_uv');
    expect(panelTypeCodeForApplication('LABORATORY')).toBe('laboratory');
    expect(panelTypeCodeForApplication('FURNITURE')).toBe('furniture');
  });

  it('applies the supplier quality matrix to all four standard types', () => {
    expect(supplierQualityMatrixApplies('INTERIOR')).toBe(true);
    expect(supplierQualityMatrixApplies('EXTERIOR_WITH_UV')).toBe(true);
    expect(supplierQualityMatrixApplies('LABORATORY')).toBe(true);
    expect(supplierQualityMatrixApplies('FURNITURE')).toBe(true);
    expect(supplierQualityMatrixApplies('EXTERIOR')).toBe(true);
    expect(supplierQualityMatrixApplies(null)).toBe(false);
    expect(supplierQualityMatrixApplies('OTHER' as never)).toBe(false);
  });

  it('resolves panel-type queries from catalog codes and application enums', () => {
    expect(resolvePanelTypeQuery('furniture')).toBe('furniture');
    expect(resolvePanelTypeQuery('FURNITURE')).toBe('furniture');
    expect(resolvePanelTypeQuery('laboratory')).toBe('laboratory');
    expect(resolvePanelTypeQuery('LABORATORY')).toBe('laboratory');
    expect(resolvePanelTypeQuery('exterior')).toBe('exterior_with_uv');
    expect(resolvePanelTypeQuery('EXTERIOR_WITH_UV')).toBe('exterior_with_uv');
    expect(resolvePanelTypeQuery('not-a-type')).toBeNull();
  });

  it('exposes exactly the 24 confirmed standard sizes', () => {
    expect(HPL_CANONICAL_PANEL_SIZES).toHaveLength(24);
    const keys = HPL_CANONICAL_PANEL_SIZES.map(
      (size) => `${size.widthMm}x${size.heightMm}`,
    );
    expect(new Set(keys).size).toBe(24);
    expect(keys).toEqual([
      '1220x1830',
      '1220x2440',
      '1220x2800',
      '1220x3050',
      '1220x3660',
      '1220x4270',
      '1300x1830',
      '1300x2440',
      '1300x2800',
      '1300x3050',
      '1300x3660',
      '1300x4270',
      '1525x1830',
      '1525x2440',
      '1525x2800',
      '1525x3050',
      '1525x3660',
      '1525x4270',
      '1830x1830',
      '1830x2440',
      '1830x2800',
      '1830x3050',
      '1830x3660',
      '1830x4270',
    ]);
    expect(isCanonicalPanelSize(1500, 3000)).toBe(false);
    expect(isCanonicalPanelSize(2130, 3050)).toBe(false);
    expect(isCanonicalPanelSize(2440, 3050)).toBe(false);
    expect(isCanonicalPanelSize(2500, 3660)).toBe(false);
    expect(isCanonicalPanelSize(1220, 2440)).toBe(true);
  });

  it('lists the confirmed discrete thicknesses without 16 mm', () => {
    expect([...HPL_DISCRETE_THICKNESS_MM]).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '8',
      '10',
      '12',
      '15',
      '18',
      '20',
      '25',
    ]);
    expect(HPL_DISCRETE_THICKNESS_MM).not.toContain('16');
  });
});
