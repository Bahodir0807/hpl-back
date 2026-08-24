import { CommercialQualificationStatus, Prisma } from '@prisma/client';

export type SerializedLeadCommercialQualification = {
  id: string;
  leadId: string;
  supplierId: string;
  qualityClassId: string;
  mappingId: string | null;
  status: CommercialQualificationStatus;
  decisionComment: string | null;
  confirmedById: string;
  confirmedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  supplier: { id: string; code: string; name: string } | null;
  qualityClass: { id: string; code: string; nameRu: string } | null;
};

export function toCommercialPrefill(qualification: {
  supplierId: string;
  qualityClassId: string;
  status: CommercialQualificationStatus;
}): {
  supplierId: string;
  qualityClassId: string;
  status: CommercialQualificationStatus;
} {
  return {
    supplierId: qualification.supplierId,
    qualityClassId: qualification.qualityClassId,
    status: qualification.status,
  };
}

export function serializeLeadCommercialQualification(qualification: {
  id: string;
  leadId: string;
  supplierId: string;
  qualityClassId: string;
  mappingId: string | null;
  status: CommercialQualificationStatus;
  decisionComment: string | null;
  confirmedById: string;
  confirmedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  supplier?: { id: string; code: string; name: string } | null;
  qualityClass?: { id: string; code: string; nameRu: string } | null;
}): SerializedLeadCommercialQualification {
  return {
    id: qualification.id,
    leadId: qualification.leadId,
    supplierId: qualification.supplierId,
    qualityClassId: qualification.qualityClassId,
    mappingId: qualification.mappingId,
    status: qualification.status,
    decisionComment: qualification.decisionComment,
    confirmedById: qualification.confirmedById,
    confirmedAt: qualification.confirmedAt,
    createdAt: qualification.createdAt,
    updatedAt: qualification.updatedAt,
    supplier: qualification.supplier ?? null,
    qualityClass: qualification.qualityClass ?? null,
  };
}

export const commercialQualificationInclude =
  Prisma.validator<Prisma.LeadCommercialQualificationInclude>()({
    supplier: { select: { id: true, code: true, name: true } },
    qualityClass: { select: { id: true, code: true, nameRu: true } },
  });
