-- Stage-1 qualification items can omit size, thickness and quality class.
-- HEAD fills those later. Persist the incomplete snapshot without fake values.

ALTER TABLE "CalculationLineItem"
  ALTER COLUMN "panelTypeId" DROP NOT NULL,
  ALTER COLUMN "panelSizeId" DROP NOT NULL,
  ALTER COLUMN "thicknessMm" DROP NOT NULL,
  ALTER COLUMN "qualityClassId" DROP NOT NULL,
  ALTER COLUMN "requiredAreaM2" DROP NOT NULL,
  ALTER COLUMN "sheetsCount" SET DEFAULT 0;

ALTER TABLE "CalculationLineItem"
  DROP CONSTRAINT IF EXISTS "CalculationLineItem_panelTypeId_fkey",
  DROP CONSTRAINT IF EXISTS "CalculationLineItem_panelSizeId_fkey",
  DROP CONSTRAINT IF EXISTS "CalculationLineItem_qualityClassId_fkey";

ALTER TABLE "CalculationLineItem"
  ADD CONSTRAINT "CalculationLineItem_panelTypeId_fkey"
  FOREIGN KEY ("panelTypeId") REFERENCES "PanelType"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CalculationLineItem"
  ADD CONSTRAINT "CalculationLineItem_panelSizeId_fkey"
  FOREIGN KEY ("panelSizeId") REFERENCES "PanelSize"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CalculationLineItem"
  ADD CONSTRAINT "CalculationLineItem_qualityClassId_fkey"
  FOREIGN KEY ("qualityClassId") REFERENCES "QualityClass"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
