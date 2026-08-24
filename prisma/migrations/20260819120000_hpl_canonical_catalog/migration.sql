-- Canonical HPL types + decimal thickness.
-- Historical EXTERIOR means the confirmed exterior-with-UV product in this CRM.
-- Existing integer thickness values are cast exactly (10 -> 10.00).
-- No transactional rows are deleted.

-- 1. Replace HplApplication enum, mapping EXTERIOR -> EXTERIOR_WITH_UV.
CREATE TYPE "HplApplication_new" AS ENUM ('INTERIOR', 'EXTERIOR_WITH_UV', 'LABORATORY', 'FURNITURE');

ALTER TABLE "LeadQualification"
  ALTER COLUMN "application" TYPE "HplApplication_new"
  USING (
    CASE
      WHEN "application"::text = 'EXTERIOR' THEN 'EXTERIOR_WITH_UV'
      ELSE "application"::text
    END
  )::"HplApplication_new";

DROP TYPE "HplApplication";
ALTER TYPE "HplApplication_new" RENAME TO "HplApplication";

-- 2. Preserve historical integer thickness as numeric without truncation.
ALTER TABLE "LeadQualification"
  ALTER COLUMN "thicknessMm" TYPE DECIMAL(6,2)
  USING "thicknessMm"::DECIMAL(6,2);

ALTER TABLE "CalculationLineItem"
  ALTER COLUMN "thicknessMm" TYPE DECIMAL(6,2)
  USING "thicknessMm"::DECIMAL(6,2);

ALTER TABLE "PanelQuoteItem"
  ALTER COLUMN "thicknessMm" TYPE DECIMAL(6,2)
  USING "thicknessMm"::DECIMAL(6,2);

ALTER TABLE "PanelThicknessPricing"
  ALTER COLUMN "thicknessMm" TYPE DECIMAL(6,2)
  USING "thicknessMm"::DECIMAL(6,2);

-- 3. LABORATORY / FURNITURE have no confirmed supplier matrix, so mapping may be absent.
ALTER TABLE "LeadCommercialQualification"
  ALTER COLUMN "mappingId" DROP NOT NULL;

-- 4. Rename catalog exterior code to the canonical exterior-with-UV value.
-- Keep the same row id so existing FKs (qualification, mappings, calculations) stay valid.
UPDATE "PanelType"
SET
  "code" = 'exterior_with_uv',
  "displayNameRu" = 'Exterior с УФ'
WHERE "code" = 'exterior'
  AND NOT EXISTS (
    SELECT 1 FROM "PanelType" AS existing
    WHERE existing."code" = 'exterior_with_uv'
  );

UPDATE "PanelType"
SET "isActive" = false
WHERE "code" = 'exterior';
