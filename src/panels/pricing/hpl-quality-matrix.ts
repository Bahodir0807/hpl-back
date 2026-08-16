/**
 * Seeded HPL supplier × application × quality rows.
 *
 * CONFIRMED:
 * - Tianran: INTERIOR + Economy
 * - Tianran: EXTERIOR + Medium
 * - Tianran: EXTERIOR + Premium
 * - Tianran: EXTERIOR + Economy is INVALID
 * - Wuya quality = Economy
 * - Polybet quality = Premium
 *
 * WORKING ASSUMPTION (existing catalog seed, not a confirmed business rule):
 * - Wuya Economy is offered for both interior and exterior
 * - Polybet Premium is offered for both interior and exterior
 *
 * Local / India matrices are deferred.
 */
export const SEEDED_SUPPLIER_QUALITY_MAPPINGS = [
  { supplierCode: 'wuya', panelTypeCode: 'exterior', qualityClassCode: 'economy', isDefault: true },
  { supplierCode: 'wuya', panelTypeCode: 'interior', qualityClassCode: 'economy', isDefault: true },
  { supplierCode: 'polybet', panelTypeCode: 'exterior', qualityClassCode: 'premium', isDefault: true },
  { supplierCode: 'polybet', panelTypeCode: 'interior', qualityClassCode: 'premium', isDefault: true },
  { supplierCode: 'tianran', panelTypeCode: 'interior', qualityClassCode: 'economy', isDefault: true },
  { supplierCode: 'tianran', panelTypeCode: 'exterior', qualityClassCode: 'medium', isDefault: true },
  { supplierCode: 'tianran', panelTypeCode: 'exterior', qualityClassCode: 'premium', isDefault: false },
] as const;
