import {
  HPL_PANEL_TYPE_CODES,
  HPL_QUALITY_CLASS_CODES,
  panelTypeCodeForApplication,
  supplierQualityMatrixApplies,
  type HplPanelTypeCode,
} from '../hpl-catalog';

/**
 * Seeded HPL supplier × application × quality rows.
 *
 * Confirmed quality classes (do not invent a fourth):
 * - economy / Эконом
 * - medium / Медиум
 * - premium / Премиум
 *
 * CRM commercial-line availability: every in-use manufacturer
 * (Wuya, Tianran, Polybet) exposes all three classes for every standard
 * HPL type. Supplier-specific CNY prices still live in PanelThicknessPricing;
 * a visible line does not imply a configured purchase price.
 *
 * Local / India matrices are deferred.
 */
export { panelTypeCodeForApplication, supplierQualityMatrixApplies };

export const CRM_SUPPLIER_CODES = ['wuya', 'tianran', 'polybet'] as const;

export type CrmSupplierCode = (typeof CRM_SUPPLIER_CODES)[number];

export const DEFAULT_QUALITY_CLASS_BY_SUPPLIER: Record<
  CrmSupplierCode,
  (typeof HPL_QUALITY_CLASS_CODES)[number]
> = {
  wuya: 'economy',
  tianran: 'medium',
  polybet: 'premium',
};

export type SeededSupplierQualityMapping = {
  supplierCode: CrmSupplierCode;
  panelTypeCode: HplPanelTypeCode;
  qualityClassCode: (typeof HPL_QUALITY_CLASS_CODES)[number];
  isDefault: boolean;
};

export function buildCrmSupplierQualityMappings(): SeededSupplierQualityMapping[] {
  return CRM_SUPPLIER_CODES.flatMap((supplierCode) =>
    (Object.values(HPL_PANEL_TYPE_CODES) as HplPanelTypeCode[]).flatMap(
      (panelTypeCode) =>
        HPL_QUALITY_CLASS_CODES.map((qualityClassCode) => ({
          supplierCode,
          panelTypeCode,
          qualityClassCode,
          isDefault:
            qualityClassCode ===
            DEFAULT_QUALITY_CLASS_BY_SUPPLIER[supplierCode],
        })),
    ),
  );
}

export const SEEDED_SUPPLIER_QUALITY_MAPPINGS =
  buildCrmSupplierQualityMappings();
