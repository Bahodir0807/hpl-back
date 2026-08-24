-- BUSINESS PASS 8: structured opportunity loss and explicit Deal fulfillment.
-- Existing free-text Deal.lossReason remains untouched as historical legacy data.
-- Historical records are not assigned a reason, actor, timestamp, or fulfillment source.

ALTER TYPE "LeadStatus" ADD VALUE 'LOST';

CREATE TYPE "LossReason" AS ENUM (
  'PRICE',
  'NO_STOCK',
  'LEAD_TIME',
  'COMPETITOR',
  'QUALITY',
  'SIZE',
  'CLIENT_CANCELLED',
  'OTHER'
);

CREATE TYPE "FulfillmentSource" AS ENUM ('WAREHOUSE_STOCK', 'SUPPLIER_ORDER');

ALTER TABLE "Lead"
  ADD COLUMN "lostReasonCode" "LossReason",
  ADD COLUMN "lostComment" TEXT,
  ADD COLUMN "lostAt" TIMESTAMP(3),
  ADD COLUMN "lostById" TEXT;

ALTER TABLE "Deal"
  ADD COLUMN "lostReasonCode" "LossReason",
  ADD COLUMN "lostComment" TEXT,
  ADD COLUMN "lostAt" TIMESTAMP(3),
  ADD COLUMN "lostById" TEXT,
  ADD COLUMN "fulfillmentSource" "FulfillmentSource";

CREATE INDEX "Lead_lostReasonCode_idx" ON "Lead"("lostReasonCode");
CREATE INDEX "Lead_lostAt_idx" ON "Lead"("lostAt");
CREATE INDEX "Lead_lostById_idx" ON "Lead"("lostById");
CREATE INDEX "Deal_lostReasonCode_idx" ON "Deal"("lostReasonCode");
CREATE INDEX "Deal_lostAt_idx" ON "Deal"("lostAt");
CREATE INDEX "Deal_lostById_idx" ON "Deal"("lostById");
CREATE INDEX "Deal_fulfillmentSource_idx" ON "Deal"("fulfillmentSource");

ALTER TABLE "Lead"
  ADD CONSTRAINT "Lead_lostById_fkey" FOREIGN KEY ("lostById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Deal"
  ADD CONSTRAINT "Deal_lostById_fkey" FOREIGN KEY ("lostById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
