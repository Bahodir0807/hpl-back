-- Manager-owned customer note stored on Lead before Quote exists.
-- Handoff marker tells HEAD that Manager input is ready for КП work.
-- Existing Quotes keep their commercialNote snapshot unchanged.

ALTER TABLE "Lead"
ADD COLUMN "managerCommercialNote" TEXT,
ADD COLUMN "managerCommercialNoteUpdatedAt" TIMESTAMP(3),
ADD COLUMN "managerCommercialInputReadyAt" TIMESTAMP(3),
ADD COLUMN "managerCommercialInputReadyById" TEXT;

CREATE INDEX "Lead_managerCommercialInputReadyAt_idx" ON "Lead"("managerCommercialInputReadyAt");
CREATE INDEX "Lead_managerCommercialInputReadyById_idx" ON "Lead"("managerCommercialInputReadyById");

ALTER TABLE "Lead"
ADD CONSTRAINT "Lead_managerCommercialInputReadyById_fkey"
FOREIGN KEY ("managerCommercialInputReadyById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
