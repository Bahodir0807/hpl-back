CREATE TABLE "LeadQualificationItem" (
    "id" TEXT NOT NULL,
    "qualificationId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "application" "HplApplication",
    "panelTypeId" TEXT,
    "thicknessMm" DECIMAL(6,2),
    "panelSizeId" TEXT,
    "customWidthMm" INTEGER,
    "customHeightMm" INTEGER,
    "colorCode" TEXT,
    "colorName" TEXT,
    "requiredAreaM2" DECIMAL(10,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadQualificationItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "LeadQualificationItem"
  ADD CONSTRAINT "LeadQualificationItem_qualificationId_fkey"
  FOREIGN KEY ("qualificationId") REFERENCES "LeadQualification"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeadQualificationItem"
  ADD CONSTRAINT "LeadQualificationItem_panelTypeId_fkey"
  FOREIGN KEY ("panelTypeId") REFERENCES "PanelType"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LeadQualificationItem"
  ADD CONSTRAINT "LeadQualificationItem_panelSizeId_fkey"
  FOREIGN KEY ("panelSizeId") REFERENCES "PanelSize"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "LeadQualificationItem_qualificationId_sortOrder_idx"
  ON "LeadQualificationItem"("qualificationId", "sortOrder");
CREATE INDEX "LeadQualificationItem_panelTypeId_idx"
  ON "LeadQualificationItem"("panelTypeId");
CREATE INDEX "LeadQualificationItem_panelSizeId_idx"
  ON "LeadQualificationItem"("panelSizeId");

INSERT INTO "LeadQualificationItem" (
  "id",
  "qualificationId",
  "sortOrder",
  "application",
  "panelTypeId",
  "thicknessMm",
  "panelSizeId",
  "customWidthMm",
  "customHeightMm",
  "colorCode",
  "colorName",
  "requiredAreaM2",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  "id",
  0,
  "application",
  "panelTypeId",
  "thicknessMm",
  "panelSizeId",
  "customWidthMm",
  "customHeightMm",
  "colorCode",
  "colorName",
  "requiredAreaM2",
  "createdAt",
  "updatedAt"
FROM "LeadQualification";

ALTER TABLE "CalculationLineItem"
  ADD COLUMN "colorCode" TEXT,
  ADD COLUMN "colorName" TEXT;
