import { Prisma } from '@prisma/client';
import {
  parseThicknessMm,
  serializeThicknessMm,
} from '../../panels/hpl-thickness';
import { UpsertLeadQualificationDto } from './dto/upsert-lead-qualification.dto';

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
  'customerRequirements',
] as const;

type QualificationWriteKey = (typeof QUALIFICATION_KEYS)[number];

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
  customerRequirements?: string | null;
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
        value === null ? null : parseThicknessMm(value as string | null);
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
  installationRequired: boolean | null;
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
    installationRequired: qualification.installationRequired,
  };
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
}) {
  return {
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
}
