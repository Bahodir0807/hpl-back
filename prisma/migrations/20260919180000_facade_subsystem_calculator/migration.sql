-- Stage 2: facade subsystem catalog, versioned norms, technical calculation.
-- Does not change HPL Calculation / Quote / Deal.

ALTER TABLE "LeadEngineeringAssignment"
  ADD COLUMN "primaryQualificationCompletedAt" TIMESTAMP(3),
  ADD COLUMN "primaryQualificationCompletedById" TEXT;

CREATE TYPE "FacadeMaterialCategory" AS ENUM (
  'HPL',
  'SUBSYSTEM',
  'INSULATION',
  'MEMBRANE',
  'FASTENER',
  'SEALING_TAPE',
  'ADDITIONAL'
);

CREATE TYPE "FacadeMaterialUnit" AS ENUM ('M2', 'PCS', 'LM');

CREATE TYPE "FacadeCalculationStatus" AS ENUM ('DRAFT', 'CALCULATED', 'UNSUPPORTED');

CREATE TYPE "FacadeAreaSource" AS ENUM ('ENGINEER_ENTERED', 'HPL_QUALIFICATION');

CREATE TABLE "FacadeMaterial" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "nameRu" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameUz" TEXT NOT NULL,
  "category" "FacadeMaterialCategory" NOT NULL,
  "unit" "FacadeMaterialUnit" NOT NULL,
  "spec" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FacadeMaterial_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FacadeMaterial_code_key" ON "FacadeMaterial"("code");
CREATE INDEX "FacadeMaterial_category_isActive_idx" ON "FacadeMaterial"("category", "isActive");
CREATE INDEX "FacadeMaterial_sortOrder_idx" ON "FacadeMaterial"("sortOrder");

CREATE TABLE "FacadeSystemConfig" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "nameRu" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameUz" TEXT NOT NULL,
  "panelWidthMm" INTEGER,
  "panelHeightMm" INTEGER,
  "panelAreaM2" DECIMAL(10,4),
  "isCalculable" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FacadeSystemConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FacadeSystemConfig_code_key" ON "FacadeSystemConfig"("code");

CREATE TABLE "FacadeNormSet" (
  "id" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "isCurrent" BOOLEAN NOT NULL DEFAULT false,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FacadeNormSet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FacadeNormSet_code_key" ON "FacadeNormSet"("code");
CREATE INDEX "FacadeNormSet_configId_isCurrent_idx" ON "FacadeNormSet"("configId", "isCurrent");

CREATE TABLE "FacadeConsumptionNorm" (
  "id" TEXT NOT NULL,
  "normSetId" TEXT NOT NULL,
  "materialId" TEXT NOT NULL,
  "unit" "FacadeMaterialUnit" NOT NULL,
  "qtyPerM2" DECIMAL(18,8) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FacadeConsumptionNorm_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FacadeConsumptionNorm_normSetId_materialId_key"
  ON "FacadeConsumptionNorm"("normSetId", "materialId");
CREATE INDEX "FacadeConsumptionNorm_normSetId_sortOrder_idx"
  ON "FacadeConsumptionNorm"("normSetId", "sortOrder");

CREATE TABLE "FacadeSubsystemCalculation" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "assignmentId" TEXT,
  "engineerId" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "normSetId" TEXT,
  "claddingAreaM2" DECIMAL(18,8),
  "areaSource" "FacadeAreaSource",
  "notes" TEXT,
  "status" "FacadeCalculationStatus" NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FacadeSubsystemCalculation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FacadeSubsystemCalculation_leadId_key"
  ON "FacadeSubsystemCalculation"("leadId");
CREATE INDEX "FacadeSubsystemCalculation_engineerId_idx"
  ON "FacadeSubsystemCalculation"("engineerId");
CREATE INDEX "FacadeSubsystemCalculation_assignmentId_idx"
  ON "FacadeSubsystemCalculation"("assignmentId");
CREATE INDEX "FacadeSubsystemCalculation_configId_idx"
  ON "FacadeSubsystemCalculation"("configId");
CREATE INDEX "FacadeSubsystemCalculation_normSetId_idx"
  ON "FacadeSubsystemCalculation"("normSetId");
CREATE INDEX "FacadeSubsystemCalculation_status_idx"
  ON "FacadeSubsystemCalculation"("status");

CREATE TABLE "FacadeSubsystemCalculationItem" (
  "id" TEXT NOT NULL,
  "calculationId" TEXT NOT NULL,
  "materialId" TEXT,
  "materialCode" TEXT NOT NULL,
  "materialName" TEXT NOT NULL,
  "category" "FacadeMaterialCategory" NOT NULL,
  "unit" "FacadeMaterialUnit" NOT NULL,
  "specSnapshot" JSONB,
  "qtyPerM2" DECIMAL(18,8),
  "calculatedQty" DECIMAL(18,8),
  "finalQty" DECIMAL(18,8) NOT NULL,
  "isManual" BOOLEAN NOT NULL DEFAULT false,
  "isExtra" BOOLEAN NOT NULL DEFAULT false,
  "note" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FacadeSubsystemCalculationItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FacadeSubsystemCalculationItem_calculationId_sortOrder_idx"
  ON "FacadeSubsystemCalculationItem"("calculationId", "sortOrder");
CREATE INDEX "FacadeSubsystemCalculationItem_materialId_idx"
  ON "FacadeSubsystemCalculationItem"("materialId");

CREATE TABLE "FacadeSubsystemCalculationRevision" (
  "id" TEXT NOT NULL,
  "calculationId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FacadeSubsystemCalculationRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FacadeSubsystemCalculationRevision_calculationId_createdAt_idx"
  ON "FacadeSubsystemCalculationRevision"("calculationId", "createdAt");
CREATE INDEX "FacadeSubsystemCalculationRevision_actorId_idx"
  ON "FacadeSubsystemCalculationRevision"("actorId");

ALTER TABLE "LeadEngineeringAssignment"
  ADD CONSTRAINT "LeadEngineeringAssignment_primaryQualificationCompletedById_fkey"
  FOREIGN KEY ("primaryQualificationCompletedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "LeadEngineeringAssignment_primaryQualificationCompletedById_idx"
  ON "LeadEngineeringAssignment"("primaryQualificationCompletedById");

ALTER TABLE "FacadeNormSet"
  ADD CONSTRAINT "FacadeNormSet_configId_fkey"
  FOREIGN KEY ("configId") REFERENCES "FacadeSystemConfig"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FacadeConsumptionNorm"
  ADD CONSTRAINT "FacadeConsumptionNorm_normSetId_fkey"
  FOREIGN KEY ("normSetId") REFERENCES "FacadeNormSet"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FacadeConsumptionNorm"
  ADD CONSTRAINT "FacadeConsumptionNorm_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "FacadeMaterial"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FacadeSubsystemCalculation"
  ADD CONSTRAINT "FacadeSubsystemCalculation_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FacadeSubsystemCalculation"
  ADD CONSTRAINT "FacadeSubsystemCalculation_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "LeadEngineeringAssignment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FacadeSubsystemCalculation"
  ADD CONSTRAINT "FacadeSubsystemCalculation_engineerId_fkey"
  FOREIGN KEY ("engineerId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FacadeSubsystemCalculation"
  ADD CONSTRAINT "FacadeSubsystemCalculation_configId_fkey"
  FOREIGN KEY ("configId") REFERENCES "FacadeSystemConfig"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FacadeSubsystemCalculation"
  ADD CONSTRAINT "FacadeSubsystemCalculation_normSetId_fkey"
  FOREIGN KEY ("normSetId") REFERENCES "FacadeNormSet"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FacadeSubsystemCalculationItem"
  ADD CONSTRAINT "FacadeSubsystemCalculationItem_calculationId_fkey"
  FOREIGN KEY ("calculationId") REFERENCES "FacadeSubsystemCalculation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FacadeSubsystemCalculationItem"
  ADD CONSTRAINT "FacadeSubsystemCalculationItem_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "FacadeMaterial"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FacadeSubsystemCalculationRevision"
  ADD CONSTRAINT "FacadeSubsystemCalculationRevision_calculationId_fkey"
  FOREIGN KEY ("calculationId") REFERENCES "FacadeSubsystemCalculation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FacadeSubsystemCalculationRevision"
  ADD CONSTRAINT "FacadeSubsystemCalculationRevision_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
