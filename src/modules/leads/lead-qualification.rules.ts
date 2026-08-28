import { BadRequestException } from '@nestjs/common';
import { HplApplication, LeadQualification, Prisma } from '@prisma/client';

export type Stage1QualificationInput = {
  application?: HplApplication | null;
  panelTypeId?: string | null;
  thicknessMm?: Prisma.Decimal | number | string | null;
  panelSizeId?: string | null;
  customWidthMm?: number | null;
  customHeightMm?: number | null;
  colorCode?: string | null;
  colorName?: string | null;
  requiredAreaM2?: Prisma.Decimal | number | string | null;
  installationRequired?: boolean | null;
  stockOnly?: boolean | null;
  urgent?: boolean | null;
  willingToWait?: boolean | null;
  customerRequirements?: string | null;
};

export type Stage1CompleteQualification = Pick<
  LeadQualification,
  | 'application'
  | 'thicknessMm'
  | 'panelSizeId'
  | 'customWidthMm'
  | 'customHeightMm'
  | 'colorCode'
  | 'colorName'
  | 'requiredAreaM2'
  | 'installationRequired'
  | 'customerRequirements'
> & {
  items?: Array<
    Pick<
      Stage1QualificationInput,
      | 'application'
      | 'panelTypeId'
      | 'thicknessMm'
      | 'panelSizeId'
      | 'customWidthMm'
      | 'customHeightMm'
      | 'colorCode'
      | 'colorName'
      | 'requiredAreaM2'
    >
  >;
};

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function toPositiveNumber(
  value: Prisma.Decimal | number | string | null | undefined,
): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function hasRequestedDimensions(
  data: Pick<
    Stage1QualificationInput,
    'panelSizeId' | 'customWidthMm' | 'customHeightMm'
  >,
): boolean {
  if (data.panelSizeId) {
    return true;
  }

  return (data.customWidthMm ?? 0) > 0 && (data.customHeightMm ?? 0) > 0;
}

export function hasRequestedColor(
  data: Pick<Stage1QualificationInput, 'colorCode' | 'colorName'>,
): boolean {
  return hasText(data.colorCode) || hasText(data.colorName);
}

export function assertStage1QualificationComplete(
  data: Stage1CompleteQualification | null | undefined,
): void {
  if (!data) {
    assertStage1ItemComplete(data);
    return;
  } else if (data.items !== undefined) {
    // An explicit empty list is a valid manager save: no HPL positions yet.
    for (const item of data.items) {
      assertStage1ItemComplete(item);
    }
  } else {
    assertStage1ItemComplete(data);
  }

  if (
    data?.installationRequired === null ||
    data?.installationRequired === undefined
  ) {
    throw new BadRequestException({
      message: 'Lead Stage-1 HPL qualification is incomplete',
      missingFields: ['installationRequired'],
    });
  }
}

function assertStage1ItemComplete(
  data:
    | Pick<
        Stage1QualificationInput,
        | 'application'
        | 'panelTypeId'
        | 'thicknessMm'
        | 'panelSizeId'
        | 'customWidthMm'
        | 'customHeightMm'
        | 'colorCode'
        | 'colorName'
        | 'requiredAreaM2'
      >
    | null
    | undefined,
): void {
  const missingFields: string[] = [];

  if (!data) {
    throw new BadRequestException({
      message: 'Lead Stage-1 HPL qualification is incomplete',
      missingFields: ['application', 'requiredAreaM2'],
    });
  }

  if (!data.application) {
    missingFields.push('application');
  }

  const requiredArea = toPositiveNumber(data.requiredAreaM2);
  if (requiredArea === null || requiredArea <= 0) {
    missingFields.push('requiredAreaM2');
  }

  if (missingFields.length > 0) {
    throw new BadRequestException({
      message: 'Lead Stage-1 HPL qualification is incomplete',
      missingFields,
    });
  }
}

export function assertCustomDimensionsPair(
  data: Pick<Stage1QualificationInput, 'customWidthMm' | 'customHeightMm'>,
): void {
  const width = data.customWidthMm;
  const height = data.customHeightMm;
  const widthPresent = width !== undefined && width !== null;
  const heightPresent = height !== undefined && height !== null;

  if (widthPresent !== heightPresent) {
    throw new BadRequestException(
      'customWidthMm and customHeightMm must be provided together',
    );
  }
}
