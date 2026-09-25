-- CreateEnum
CREATE TYPE "ExecutionHandoffStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ExecutionComponentStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED');

-- CreateTable
CREATE TABLE "DealExecutionHandoff" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "quoteVersion" INTEGER NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "acceptedById" TEXT NOT NULL,
    "acceptanceNote" TEXT,
    "status" "ExecutionHandoffStatus" NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealExecutionHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealExecutionComponent" (
    "id" TEXT NOT NULL,
    "handoffId" TEXT NOT NULL,
    "kind" "QuoteComponentKind" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" "ExecutionComponentStatus" NOT NULL DEFAULT 'PENDING',
    "sourceRevision" INTEGER,
    "technicalRevision" INTEGER,
    "customerAmount" DECIMAL(18,8),
    "currency" TEXT,
    "label" TEXT NOT NULL,
    "basis" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealExecutionComponent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DealExecutionHandoff_quoteId_key" ON "DealExecutionHandoff"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "DealExecutionHandoff_dealId_revision_key" ON "DealExecutionHandoff"("dealId", "revision");

-- One ACTIVE execution basis per Deal. History rows stay SUPERSEDED.
CREATE UNIQUE INDEX "DealExecutionHandoff_one_active_per_deal_idx"
ON "DealExecutionHandoff"("dealId")
WHERE "status" = 'ACTIVE';

-- CreateIndex
CREATE INDEX "DealExecutionHandoff_dealId_status_idx" ON "DealExecutionHandoff"("dealId", "status");

-- CreateIndex
CREATE INDEX "DealExecutionHandoff_leadId_status_idx" ON "DealExecutionHandoff"("leadId", "status");

-- CreateIndex
CREATE INDEX "DealExecutionHandoff_acceptedById_idx" ON "DealExecutionHandoff"("acceptedById");

-- CreateIndex
CREATE INDEX "DealExecutionHandoff_status_createdAt_idx" ON "DealExecutionHandoff"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DealExecutionComponent_handoffId_kind_key" ON "DealExecutionComponent"("handoffId", "kind");

-- CreateIndex
CREATE INDEX "DealExecutionComponent_handoffId_idx" ON "DealExecutionComponent"("handoffId");

-- CreateIndex
CREATE INDEX "DealExecutionComponent_kind_idx" ON "DealExecutionComponent"("kind");

-- AddForeignKey
ALTER TABLE "DealExecutionHandoff" ADD CONSTRAINT "DealExecutionHandoff_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealExecutionHandoff" ADD CONSTRAINT "DealExecutionHandoff_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealExecutionHandoff" ADD CONSTRAINT "DealExecutionHandoff_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "PanelQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealExecutionHandoff" ADD CONSTRAINT "DealExecutionHandoff_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealExecutionComponent" ADD CONSTRAINT "DealExecutionComponent_handoffId_fkey" FOREIGN KEY ("handoffId") REFERENCES "DealExecutionHandoff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
