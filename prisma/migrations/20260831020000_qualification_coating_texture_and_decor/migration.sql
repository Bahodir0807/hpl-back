-- Customer coating/texture intent on Qualification items.
-- HEAD Decor is free text on CalculationLineItem, not a PanelColor catalog row.

ALTER TABLE "LeadQualificationItem"
  ADD COLUMN IF NOT EXISTS "coating" TEXT,
  ADD COLUMN IF NOT EXISTS "texture" TEXT;

ALTER TABLE "CalculationLineItem"
  ADD COLUMN IF NOT EXISTS "decor" TEXT;
