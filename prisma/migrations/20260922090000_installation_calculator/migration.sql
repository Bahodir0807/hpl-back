-- Stage 4: installation work types, contractors, rates, technical and commercial
-- calculations. Does not change HPL Calculation / PanelQuote / Deal / CNY×FX×2.
-- Does not alter DealInstallation scheduling workflow.

CREATE TYPE "InstallationWorkUnit" AS ENUM ('M2', 'LM', 'PCS', 'SET', 'HOUR', 'DAY', 'OTHER');
CREATE TYPE "InstallationWorkCategory" AS ENUM ('CLADDING', 'BRACKETS', 'SLOPES', 'TRAVEL', 'HEIGHT', 'OTHER');
CREATE TYPE "InstallationContractorType" AS ENUM ('INTERNAL_CREW', 'EXTERNAL_CONTRACTOR');
CREATE TYPE "InstallationQuantitySource" AS ENUM ('MANUAL', 'CONFIRMED_AREA', 'APPROVED_NORM');
CREATE TYPE "InstallationCalculationStatus" AS ENUM ('DRAFT', 'READY');
CREATE TYPE "InstallationCommercialStatus" AS ENUM ('DRAFT', 'READY_FOR_APPROVAL', 'APPROVED');

CREATE TABLE "InstallationWorkType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "nameUz" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "description" TEXT,
    "unit" "InstallationWorkUnit" NOT NULL,
    "category" "InstallationWorkCategory" NOT NULL DEFAULT 'OTHER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallationWorkType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InstallationWorkType_code_key" ON "InstallationWorkType"("code");
CREATE INDEX "InstallationWorkType_isActive_category_idx" ON "InstallationWorkType"("isActive", "category");
CREATE INDEX "InstallationWorkType_unit_idx" ON "InstallationWorkType"("unit");

CREATE TABLE "InstallationContractor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "InstallationContractorType" NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "note" TEXT,
    "supplierId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallationContractor_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InstallationContractor_isActive_type_idx" ON "InstallationContractor"("isActive", "type");
CREATE INDEX "InstallationContractor_supplierId_idx" ON "InstallationContractor"("supplierId");
CREATE INDEX "InstallationContractor_name_idx" ON "InstallationContractor"("name");

ALTER TABLE "InstallationContractor"
  ADD CONSTRAINT "InstallationContractor_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "InstallationContractorRate" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "workTypeId" TEXT NOT NULL,
    "unit" "InstallationWorkUnit" NOT NULL,
    "pricePerUnit" DECIMAL(18,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallationContractorRate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InstallationContractorRate_contractorId_isActive_idx" ON "InstallationContractorRate"("contractorId", "isActive");
CREATE INDEX "InstallationContractorRate_workTypeId_isActive_idx" ON "InstallationContractorRate"("workTypeId", "isActive");
CREATE INDEX "InstallationContractorRate_validFrom_idx" ON "InstallationContractorRate"("validFrom");

ALTER TABLE "InstallationContractorRate"
  ADD CONSTRAINT "InstallationContractorRate_contractorId_fkey"
  FOREIGN KEY ("contractorId") REFERENCES "InstallationContractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InstallationContractorRate"
  ADD CONSTRAINT "InstallationContractorRate_workTypeId_fkey"
  FOREIGN KEY ("workTypeId") REFERENCES "InstallationWorkType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "InstallationCalculation" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "engineerId" TEXT NOT NULL,
    "status" "InstallationCalculationStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallationCalculation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InstallationCalculation_leadId_key" ON "InstallationCalculation"("leadId");
CREATE INDEX "InstallationCalculation_engineerId_idx" ON "InstallationCalculation"("engineerId");
CREATE INDEX "InstallationCalculation_assignmentId_idx" ON "InstallationCalculation"("assignmentId");
CREATE INDEX "InstallationCalculation_status_idx" ON "InstallationCalculation"("status");

ALTER TABLE "InstallationCalculation"
  ADD CONSTRAINT "InstallationCalculation_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InstallationCalculation"
  ADD CONSTRAINT "InstallationCalculation_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "LeadEngineeringAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InstallationCalculation"
  ADD CONSTRAINT "InstallationCalculation_engineerId_fkey"
  FOREIGN KEY ("engineerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "InstallationCalculationItem" (
    "id" TEXT NOT NULL,
    "calculationId" TEXT NOT NULL,
    "workTypeId" TEXT,
    "workTypeCode" TEXT NOT NULL,
    "workTypeName" TEXT NOT NULL,
    "workTypeSnapshot" JSONB NOT NULL,
    "unit" "InstallationWorkUnit" NOT NULL,
    "quantity" DECIMAL(18,8) NOT NULL,
    "quantitySource" "InstallationQuantitySource" NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallationCalculationItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InstallationCalculationItem_calculationId_sortOrder_idx" ON "InstallationCalculationItem"("calculationId", "sortOrder");
CREATE INDEX "InstallationCalculationItem_workTypeId_idx" ON "InstallationCalculationItem"("workTypeId");

ALTER TABLE "InstallationCalculationItem"
  ADD CONSTRAINT "InstallationCalculationItem_calculationId_fkey"
  FOREIGN KEY ("calculationId") REFERENCES "InstallationCalculation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InstallationCalculationItem"
  ADD CONSTRAINT "InstallationCalculationItem_workTypeId_fkey"
  FOREIGN KEY ("workTypeId") REFERENCES "InstallationWorkType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "InstallationCalculationRevision" (
    "id" TEXT NOT NULL,
    "calculationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstallationCalculationRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InstallationCalculationRevision_calculationId_createdAt_idx" ON "InstallationCalculationRevision"("calculationId", "createdAt");
CREATE INDEX "InstallationCalculationRevision_actorId_idx" ON "InstallationCalculationRevision"("actorId");

ALTER TABLE "InstallationCalculationRevision"
  ADD CONSTRAINT "InstallationCalculationRevision_calculationId_fkey"
  FOREIGN KEY ("calculationId") REFERENCES "InstallationCalculation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InstallationCalculationRevision"
  ADD CONSTRAINT "InstallationCalculationRevision_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "InstallationCommercialCalculation" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "installationCalculationId" TEXT NOT NULL,
    "installationCalculationRevision" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "status" "InstallationCommercialStatus" NOT NULL DEFAULT 'DRAFT',
    "technicalSnapshot" JSONB NOT NULL,
    "costIncomplete" BOOLEAN NOT NULL DEFAULT true,
    "costByCurrency" JSONB NOT NULL,
    "fxSnapshots" JSONB NOT NULL,
    "proposedCustomerAmount" DECIMAL(18,8),
    "proposedCurrency" TEXT,
    "approvedCustomerAmount" DECIMAL(18,8),
    "approvedCurrency" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approverRoleSnapshot" TEXT,
    "commercialNote" TEXT,
    "quoteCreated" BOOLEAN NOT NULL DEFAULT false,
    "dealCreated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallationCommercialCalculation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InstallationCommercialCalculation_leadId_revision_key" ON "InstallationCommercialCalculation"("leadId", "revision");
CREATE INDEX "InstallationCommercialCalculation_leadId_isCurrent_idx" ON "InstallationCommercialCalculation"("leadId", "isCurrent");
CREATE INDEX "InstallationCommercialCalculation_installationCalculationId_idx" ON "InstallationCommercialCalculation"("installationCalculationId");
CREATE INDEX "InstallationCommercialCalculation_status_idx" ON "InstallationCommercialCalculation"("status");

ALTER TABLE "InstallationCommercialCalculation"
  ADD CONSTRAINT "InstallationCommercialCalculation_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InstallationCommercialCalculation"
  ADD CONSTRAINT "InstallationCommercialCalculation_installationCalculationId_fkey"
  FOREIGN KEY ("installationCalculationId") REFERENCES "InstallationCalculation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InstallationCommercialCalculation"
  ADD CONSTRAINT "InstallationCommercialCalculation_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "InstallationCommercialCalculationItem" (
    "id" TEXT NOT NULL,
    "commercialCalculationId" TEXT NOT NULL,
    "technicalItemId" TEXT,
    "workTypeId" TEXT,
    "workTypeCode" TEXT NOT NULL,
    "workTypeName" TEXT NOT NULL,
    "workTypeSnapshot" JSONB NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(18,8) NOT NULL,
    "quantitySource" TEXT NOT NULL,
    "selectedRateId" TEXT,
    "rateSnapshot" JSONB,
    "contractorId" TEXT,
    "contractorName" TEXT,
    "pricePerUnit" DECIMAL(18,8),
    "currency" TEXT,
    "lineCostTotal" DECIMAL(18,8),
    "priceStatus" TEXT NOT NULL,
    "fxFromCurrency" TEXT,
    "fxToCurrency" TEXT,
    "fxRate" DECIMAL(18,8),
    "fxRateId" TEXT,
    "fxEffectiveFrom" TIMESTAMP(3),
    "convertedAmount" DECIMAL(18,8),
    "convertedCurrency" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallationCommercialCalculationItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InstallationCommercialCalculationItem_commercialCalculationId_sortOrder_idx"
  ON "InstallationCommercialCalculationItem"("commercialCalculationId", "sortOrder");

ALTER TABLE "InstallationCommercialCalculationItem"
  ADD CONSTRAINT "InstallationCommercialCalculationItem_commercialCalculationId_fkey"
  FOREIGN KEY ("commercialCalculationId") REFERENCES "InstallationCommercialCalculation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "InstallationCommercialCalculationRevision" (
    "id" TEXT NOT NULL,
    "commercialCalculationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstallationCommercialCalculationRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InstallationCommercialCalculationRevision_commercialCalculationId_createdAt_idx"
  ON "InstallationCommercialCalculationRevision"("commercialCalculationId", "createdAt");

ALTER TABLE "InstallationCommercialCalculationRevision"
  ADD CONSTRAINT "InstallationCommercialCalculationRevision_commercialCalculationId_fkey"
  FOREIGN KEY ("commercialCalculationId") REFERENCES "InstallationCommercialCalculation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InstallationCommercialCalculationRevision"
  ADD CONSTRAINT "InstallationCommercialCalculationRevision_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
