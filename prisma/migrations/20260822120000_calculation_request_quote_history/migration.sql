-- Group multiple CalculationSessions into one manager handoff (CalculationRequest).
-- Persist Quote ↔ client, approved item currency, and stored PDF file reference.
-- Existing Quote rows keep their historical snapshot; calculationId stays populated.
--
-- This file is idempotent: Prisma applied the statements below on the failed
-- 20260822120000 run (no wrapping transaction), then aborted on the PanelQuote
-- UPDATE. Re-running must not recreate objects or duplicate backfill rows.

CREATE TABLE IF NOT EXISTS "CalculationRequest" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "clientId" TEXT,
    "dealId" TEXT,
    "createdById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "quotedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalculationRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CalculationRequest_leadId_status_idx" ON "CalculationRequest"("leadId", "status");
CREATE INDEX IF NOT EXISTS "CalculationRequest_clientId_idx" ON "CalculationRequest"("clientId");
CREATE INDEX IF NOT EXISTS "CalculationRequest_dealId_idx" ON "CalculationRequest"("dealId");
CREATE INDEX IF NOT EXISTS "CalculationRequest_createdById_idx" ON "CalculationRequest"("createdById");
CREATE INDEX IF NOT EXISTS "CalculationRequest_status_createdAt_idx" ON "CalculationRequest"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "CalculationRequest_submittedById_idx" ON "CalculationRequest"("submittedById");
CREATE INDEX IF NOT EXISTS "CalculationRequest_deletedAt_idx" ON "CalculationRequest"("deletedAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CalculationRequest_leadId_fkey') THEN
        ALTER TABLE "CalculationRequest"
        ADD CONSTRAINT "CalculationRequest_leadId_fkey"
        FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CalculationRequest_clientId_fkey') THEN
        ALTER TABLE "CalculationRequest"
        ADD CONSTRAINT "CalculationRequest_clientId_fkey"
        FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CalculationRequest_dealId_fkey') THEN
        ALTER TABLE "CalculationRequest"
        ADD CONSTRAINT "CalculationRequest_dealId_fkey"
        FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CalculationRequest_createdById_fkey') THEN
        ALTER TABLE "CalculationRequest"
        ADD CONSTRAINT "CalculationRequest_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CalculationRequest_submittedById_fkey') THEN
        ALTER TABLE "CalculationRequest"
        ADD CONSTRAINT "CalculationRequest_submittedById_fkey"
        FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "CalculationSession"
ADD COLUMN IF NOT EXISTS "requestId" TEXT,
ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "title" TEXT;

CREATE INDEX IF NOT EXISTS "CalculationSession_requestId_sortOrder_idx" ON "CalculationSession"("requestId", "sortOrder");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CalculationSession_requestId_fkey') THEN
        ALTER TABLE "CalculationSession"
        ADD CONSTRAINT "CalculationSession_requestId_fkey"
        FOREIGN KEY ("requestId") REFERENCES "CalculationRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "CalculationLineItem"
ADD COLUMN IF NOT EXISTS "coating" TEXT,
ADD COLUMN IF NOT EXISTS "texture" TEXT,
ADD COLUMN IF NOT EXISTS "note" TEXT,
ADD COLUMN IF NOT EXISTS "customTypeDescription" TEXT;

ALTER TABLE "PanelQuote"
ADD COLUMN IF NOT EXISTS "requestId" TEXT,
ADD COLUMN IF NOT EXISTS "clientId" TEXT,
ADD COLUMN IF NOT EXISTS "approverId" TEXT,
ADD COLUMN IF NOT EXISTS "pdfFileId" TEXT,
ADD COLUMN IF NOT EXISTS "finalizedAt" TIMESTAMP(3);

ALTER TABLE "PanelQuote" ALTER COLUMN "calculationId" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "PanelQuote_clientId_createdAt_idx" ON "PanelQuote"("clientId", "createdAt");
CREATE INDEX IF NOT EXISTS "PanelQuote_requestId_status_idx" ON "PanelQuote"("requestId", "status");
CREATE INDEX IF NOT EXISTS "PanelQuote_approverId_idx" ON "PanelQuote"("approverId");
CREATE INDEX IF NOT EXISTS "PanelQuote_pdfFileId_idx" ON "PanelQuote"("pdfFileId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PanelQuote_requestId_fkey') THEN
        ALTER TABLE "PanelQuote"
        ADD CONSTRAINT "PanelQuote_requestId_fkey"
        FOREIGN KEY ("requestId") REFERENCES "CalculationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PanelQuote_clientId_fkey') THEN
        ALTER TABLE "PanelQuote"
        ADD CONSTRAINT "PanelQuote_clientId_fkey"
        FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PanelQuote_approverId_fkey') THEN
        ALTER TABLE "PanelQuote"
        ADD CONSTRAINT "PanelQuote_approverId_fkey"
        FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PanelQuote_pdfFileId_fkey') THEN
        ALTER TABLE "PanelQuote"
        ADD CONSTRAINT "PanelQuote_pdfFileId_fkey"
        FOREIGN KEY ("pdfFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "PanelQuoteItem"
ADD COLUMN IF NOT EXISTS "calculationId" TEXT,
ADD COLUMN IF NOT EXISTS "calculationGroupTitle" TEXT,
ADD COLUMN IF NOT EXISTS "calculationGroupSortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "coating" TEXT,
ADD COLUMN IF NOT EXISTS "texture" TEXT,
ADD COLUMN IF NOT EXISTS "note" TEXT,
ADD COLUMN IF NOT EXISTS "customTypeDescription" TEXT,
ADD COLUMN IF NOT EXISTS "currencyCode" TEXT NOT NULL DEFAULT 'USD';

CREATE INDEX IF NOT EXISTS "PanelQuoteItem_calculationId_idx" ON "PanelQuoteItem"("calculationId");

-- One historical request per existing session. Request id equals session id
-- so the backfill join is deterministic and does not invent a fourth class.
INSERT INTO "CalculationRequest" (
    "id",
    "leadId",
    "clientId",
    "dealId",
    "createdById",
    "status",
    "notes",
    "submittedAt",
    "quotedAt",
    "createdAt",
    "updatedAt"
)
SELECT
    cs."id",
    cs."leadId",
    cs."clientId",
    cs."dealId",
    cs."createdById",
    CASE
        WHEN pq."id" IS NOT NULL THEN 'quoted'
        WHEN cs."status" = 'finalized' THEN 'submitted'
        ELSE 'draft'
    END,
    cs."notes",
    CASE
        WHEN cs."status" = 'finalized' OR pq."id" IS NOT NULL THEN cs."updatedAt"
        ELSE NULL
    END,
    pq."createdAt",
    cs."createdAt",
    cs."updatedAt"
FROM "CalculationSession" cs
LEFT JOIN "PanelQuote" pq ON pq."calculationId" = cs."id"
WHERE NOT EXISTS (
    SELECT 1
    FROM "CalculationRequest" cr
    WHERE cr."id" = cs."id"
);

UPDATE "CalculationSession"
SET "requestId" = "id"
WHERE "requestId" IS NULL;

-- PostgreSQL forbids referencing the UPDATE target alias inside JOIN ... ON in FROM.
-- Keep the original inner-join semantics by correlating pq in WHERE instead.
UPDATE "PanelQuote" AS pq
SET
    "requestId" = cs."requestId",
    "clientId" = COALESCE(pq."clientId", cs."clientId", l."clientId")
FROM "CalculationSession" AS cs, "Lead" AS l
WHERE pq."calculationId" = cs."id"
  AND l."id" = pq."leadId";

-- Target alias is only used in WHERE (valid PostgreSQL).
UPDATE "PanelQuoteItem" AS item
SET
    "currencyCode" = pq."displayCurrency",
    "calculationId" = pq."calculationId"
FROM "PanelQuote" AS pq
WHERE item."quoteId" = pq."id";
