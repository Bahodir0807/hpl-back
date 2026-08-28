import { Prisma } from '@prisma/client';
import {
  parseThicknessMm,
  serializeThicknessMm,
} from '../../panels/hpl-thickness';
import { UpsertLeadQualificationDto } from './dto/upsert-lead-qualification.dto';
import { UpsertLeadQualificationItemDto } from './dto/upsert-lead-qualification-item.dto';

const QUALIFICATION_KEYS = [
  'application',
  'panelTypeId',
  'thicknessMm',
  'panelSizeId',
  'customWidthMm',
  'customHeightMm',
  'colorCode',
  'colorName',
  'requiredAreaM2',
  'installationRequired',
  'stockOnly',
  'urgent',
  'willingToWait',
  'ventFacadeExists',
  'ventFacadeKitRequired',
  'customerRequirements',
] as const;

const QUALIFICATION_ITEM_KEYS = [
  'application',
  'panelTypeId',
  'thicknessMm',
  'panelSizeId',
  'customWidthMm',
  'customHeightMm',
  'colorCode',
  'colorName',
  'requiredAreaM2',
] as const;

export type LeadQualificationWriteData = {
  application?: UpsertLeadQualificationDto['application'];
  panelTypeId?: string | null;
  thicknessMm?: Prisma.Decimal | null;
  panelSizeId?: string | null;
  customWidthMm?: number | null;
  customHeightMm?: number | null;
  colorCode?: string | null;
  colorName?: string | null;
  requiredAreaM2?: number | null;
  installationRequired?: boolean | null;
  stockOnly?: boolean | null;
  urgent?: boolean | null;
  willingToWait?: boolean | null;
  ventFacadeExists?: boolean | null;
  ventFacadeKitRequired?: boolean | null;
  customerRequirements?: string | null;
};

export type LeadQualificationItemWriteData = {
  application?: UpsertLeadQualificationItemDto['application'];
  panelTypeId?: string | null;
  thicknessMm?: Prisma.Decimal | null;
  panelSizeId?: string | null;
  customWidthMm?: number | null;
  customHeightMm?: number | null;
  colorCode?: string | null;
  colorName?: string | null;
  requiredAreaM2?: number | null;
};

export function mapQualificationWriteData(
  dto: UpsertLeadQualificationDto,
): LeadQualificationWriteData {
  const data: LeadQualificationWriteData = {};

  for (const key of QUALIFICATION_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(dto, key)) {
      continue;
    }

    const value = dto[key];
    if (value === undefined) {
      continue;
    }

    if (key === 'thicknessMm') {
      data.thicknessMm =
        value === null
          ? null
          : parseThicknessMm(value as string | number | null);
      continue;
    }

    (data as Record<string, unknown>)[key] = value;
  }

  return data;
}

export function mapQualificationItemWriteData(
  dto: UpsertLeadQualificationItemDto,
): LeadQualificationItemWriteData {
  const data: LeadQualificationItemWriteData = {};

  for (const key of QUALIFICATION_ITEM_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(dto, key)) {
      continue;
    }

    const value = dto[key];
    if (value === undefined) {
      continue;
    }

    if (key === 'thicknessMm') {
      data.thicknessMm = value === null ? null : parseThicknessMm(value);
      continue;
    }

    (data as Record<string, unknown>)[key] = value;
  }

  return data;
}

export function toCalculationRequirementPrefill(qualification: {
  application: string | null;
  panelTypeId: string | null;
  panelSizeId: string | null;
  thicknessMm: Prisma.Decimal | number | string | null;
  customWidthMm: number | null;
  customHeightMm: number | null;
  colorCode: string | null;
  colorName: string | null;
  requiredAreaM2: Prisma.Decimal | null;
  installationRequired?: boolean | null;
}): {
  application: string | null;
  panelTypeId: string | null;
  panelSizeId: string | null;
  thicknessMm: string | null;
  customWidthMm: number | null;
  customHeightMm: number | null;
  colorCode: string | null;
  colorName: string | null;
  requiredAreaM2: string | null;
  installationRequired: boolean | null;
} {
  return {
    application: qualification.application,
    panelTypeId: qualification.panelTypeId,
    panelSizeId: qualification.panelSizeId,
    thicknessMm: serializeThicknessMm(qualification.thicknessMm),
    customWidthMm: qualification.customWidthMm,
    customHeightMm: qualification.customHeightMm,
    colorCode: qualification.colorCode,
    colorName: qualification.colorName,
    requiredAreaM2: qualification.requiredAreaM2?.toString() ?? null,
    installationRequired: qualification.installationRequired ?? null,
  };
}

export function toCalculationRequirementPrefills(
  items: Array<Parameters<typeof toCalculationRequirementPrefill>[0]>,
) {
  return items.map(toCalculationRequirementPrefill);
}

export function serializeLeadQualification(qualification: {
  id: string;
  leadId: string;
  application: string | null;
  panelTypeId: string | null;
  thicknessMm: Prisma.Decimal | number | string | null;
  panelSizeId: string | null;
  customWidthMm: number | null;
  customHeightMm: number | null;
  colorCode: string | null;
  colorName: string | null;
  requiredAreaM2: Prisma.Decimal | null;
  installationRequired: boolean | null;
  stockOnly: boolean | null;
  urgent: boolean | null;
  willingToWait: boolean | null;
  ventFacadeExists: boolean | null;
  ventFacadeKitRequired: boolean | null;
  customerRequirements: string | null;
  createdAt: Date;
  updatedAt: Date;
  panelType?: { id: string; code: string; displayNameRu: string } | null;
  panelSize?: {
    id: string;
    displayName: string;
    widthMm: number;
    heightMm: number;
    areaM2: Prisma.Decimal;
  } | null;
  items?: Array<{
    id: string;
    sortOrder: number;
    application: string | null;
    panelTypeId: string | null;
    thicknessMm: Prisma.Decimal | number | string | null;
    panelSizeId: string | null;
    customWidthMm: number | null;
    customHeightMm: number | null;
    colorCode: string | null;
    colorName: string | null;
    requiredAreaM2: Prisma.Decimal | null;
    panelType?: { id: string; code: string; displayNameRu: string } | null;
    panelSize?: {
      id: string;
      displayName: string;
      widthMm: number;
      heightMm: number;
      areaM2: Prisma.Decimal;
    } | null;
  }>;
}) {
  const serialized = {
    id: qualification.id,
    leadId: qualification.leadId,
    application: qualification.application,
    panelTypeId: qualification.panelTypeId,
    thicknessMm: serializeThicknessMm(qualification.thicknessMm),
    panelSizeId: qualification.panelSizeId,
    customWidthMm: qualification.customWidthMm,
    customHeightMm: qualification.customHeightMm,
    colorCode: qualification.colorCode,
    colorName: qualification.colorName,
    requiredAreaM2: qualification.requiredAreaM2?.toString() ?? null,
    installationRequired: qualification.installationRequired,
    stockOnly: qualification.stockOnly,
    urgent: qualification.urgent,
    willingToWait: qualification.willingToWait,
    ventFacadeExists: qualification.ventFacadeExists,
    ventFacadeKitRequired: qualification.ventFacadeKitRequired,
    customerRequirements: qualification.customerRequirements,
    createdAt: qualification.createdAt,
    updatedAt: qualification.updatedAt,
    panelType: qualification.panelType ?? null,
    panelSize: qualification.panelSize
      ? {
          ...qualification.panelSize,
          areaM2: qualification.panelSize.areaM2.toString(),
        }
      : null,
  };

  if (qualification.items !== undefined) {
    return {
      ...serialized,
      items: qualification.items.map((item) => ({
        id: item.id,
        sortOrder: item.sortOrder,
        application: item.application,
        panelTypeId: item.panelTypeId,
        thicknessMm: serializeThicknessMm(item.thicknessMm),
        panelSizeId: item.panelSizeId,
        customWidthMm: item.customWidthMm,
        customHeightMm: item.customHeightMm,
        colorCode: item.colorCode,
        colorName: item.colorName,
        requiredAreaM2: item.requiredAreaM2?.toString() ?? null,
        panelType: item.panelType ?? null,
        panelSize: item.panelSize
          ? {
              ...item.panelSize,
              areaM2: item.panelSize.areaM2.toString(),
            }
          : null,
      })),
    };
  }

  return serialized;
}
