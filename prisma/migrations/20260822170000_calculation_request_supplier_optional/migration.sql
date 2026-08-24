-- CalculationRequest is a technical client-request snapshot. The supplier is
-- selected later by HEAD while preparing the commercial Quote.

ALTER TABLE "CalculationLineItem"
  DROP CONSTRAINT IF EXISTS "CalculationLineItem_supplierId_fkey";

ALTER TABLE "CalculationLineItem"
  ALTER COLUMN "supplierId" DROP NOT NULL;

ALTER TABLE "CalculationLineItem"
  ADD CONSTRAINT "CalculationLineItem_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
