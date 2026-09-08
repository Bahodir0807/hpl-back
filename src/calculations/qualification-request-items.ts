import { Prisma } from '@prisma/client';
import {
  canonicalizeHplApplication,
  HPL_PANEL_TYPE_CODES,
  panelSizeAreaM2,
} from '../panels/hpl-catalog';

export type QualificationItemSource = {
  sortOrder?: number;
  application?: string | null;
  panelTypeId?: string | null;
  thicknessMm?: Prisma.Decimal | number | string | null;
  panelSizeId?: string | null;
  customWidthMm?: number | null;
  customHeightMm?: number | null;
  colorCode?: string | null;
  colorName?: string | null;
  coating?: string | null;
  texture?: string | null;
  requiredAreaM2?: Prisma.Decimal | number | string | null;
};

export type QualificationRequestSource = {
  application?: string | null;
  panelTypeId?: string | null;
  thicknessMm?: Prisma.Decimal | number | string | null;
  panelSizeId?: string | null;
  customWidthMm?: number | null;
  customHeightMm?: number | null;
  colorCode?: string | null;
  colorName?: string | null;
  coating?: string | null;
  texture?: string | null;
  requiredAreaM2?: Prisma.Decimal | number | string | null;
  customerRequirements?: string | null;
  items?: QualificationItemSource[] | null;
};

export type PersistableQualificationRequestItem = {
  sortOrder: number;
  panelTypeId: string | null;
  panelSizeId: string | null;
  thicknessMm: Prisma.Decimal | null;
  supplierId: null;
  qualityClassId: null;
  colorId: null;
  colorCode: string | null;
  colorName: string | null;
  coating: string | null;
  texture: string | null;
  decor: null;
  note: null;
  customTypeDescription: string | null;
  customWidthMm: number | null;
  customHeightMm: number | null;
  requiredAreaM2: Prisma.Decimal | null;
  sheetsCount: number;
  supplierPricePerM2: Prisma.Decimal;
  clientPricePerM2: Prisma.Decimal;
  pricePerM2: Prisma.Decimal;
  pricePerSheet: Prisma.Decimal;
  totalPrice: Prisma.Decimal;
  wastePercent: Prisma.Decimal;
};

const UNPRICED = new Prisma.Decimal(0);

function hasLegacyScalarHplData(source: QualificationRequestSource): boolean {
  return Boolean(
    source.application ||
    source.panelTypeId ||
    source.thicknessMm != null ||
    source.panelSizeId ||
    (source.customWidthMm ?? 0) > 0 ||
    (source.customHeightMm ?? 0) > 0 ||
    source.colorCode ||
    source.colorName ||
    source.requiredAreaM2 != null,
  );
}

export function qualificationItemsForRequest(
  qualification: QualificationRequestSource | null | undefined,
): QualificationItemSource[] {
  if (!qualification) {
    return [];
  }

  if (qualification.items !== undefined && qualification.items !== null) {
    return qualification.items;
  }

  return hasLegacyScalarHplData(qualification) ? [qualification] : [];
}

export function panelTypeCodeFromApplication(
  application: string | null | undefined,
): string | null {
  const canonical = canonicalizeHplApplication(application);
  return canonical ? HPL_PANEL_TYPE_CODES[canonical] : null;
}

function toDecimal(
  value: Prisma.Decimal | number | string | null | undefined,
): Prisma.Decimal | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  try {
    const decimal = new Prisma.Decimal(value.toString());
    return decimal.isNaN() ? null : decimal;
  } catch {
    return null;
  }
}

function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function sheetsCountFromSize(
  requiredAreaM2: Prisma.Decimal | null,
  size: { widthMm: number; heightMm: number } | null | undefined,
): number {
  if (!requiredAreaM2 || requiredAreaM2.lte(0) || !size) {
    return 0;
  }

  if (size.widthMm <= 0 || size.heightMm <= 0) {
    return 0;
  }

  const panelArea = panelSizeAreaM2(size.widthMm, size.heightMm);
  if (panelArea.lte(0)) {
    return 0;
  }

  return requiredAreaM2.div(panelArea).ceil().toNumber();
}

export function mapQualificationItemToRequestItem(
  item: QualificationItemSource,
  sortOrder: number,
  resolved: {
    panelTypeId: string | null;
    panelSize?: { widthMm: number; heightMm: number } | null;
  },
): PersistableQualificationRequestItem {
  const requiredAreaM2 = toDecimal(item.requiredAreaM2);
  const thicknessMm = toDecimal(item.thicknessMm);

  return {
    sortOrder,
    panelTypeId: resolved.panelTypeId,
    panelSizeId: item.panelSizeId ?? null,
    thicknessMm,
    supplierId: null,
    qualityClassId: null,
    colorId: null,
    colorCode: optionalText(item.colorCode),
    colorName: optionalText(item.colorName),
    coating: optionalText(item.coating),
    texture: optionalText(item.texture),
    decor: null,
    note: null,
    customTypeDescription: null,
    customWidthMm: item.customWidthMm ?? null,
    customHeightMm: item.customHeightMm ?? null,
    requiredAreaM2: requiredAreaM2?.toDecimalPlaces(4) ?? null,
    sheetsCount: sheetsCountFromSize(requiredAreaM2, resolved.panelSize),
    supplierPricePerM2: UNPRICED,
    clientPricePerM2: UNPRICED,
    pricePerM2: UNPRICED,
    pricePerSheet: UNPRICED,
    totalPrice: UNPRICED,
    wastePercent: UNPRICED,
  };
}
