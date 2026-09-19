-- Stage 1: ENGINEER role + specialized engineering assignment (does not change Lead.ownerId).

ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'ENGINEER';

CREATE TYPE "EngineeringAssignmentStatus" AS ENUM (
  'ACTIVE',
  'RETURNED',
  'COMPLETED',
  'SUPERSEDED'
);

CREATE TABLE "LeadEngineeringAssignment" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "engineerId" TEXT NOT NULL,
  "assignedById" TEXT NOT NULL,
  "status" "EngineeringAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "activeLeadId" TEXT,
  "returnReason" TEXT,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "returnedAt" TIMESTAMP(3),
  "returnedById" TEXT,
  "completedAt" TIMESTAMP(3),
  "completedById" TEXT,
  "supersededAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LeadEngineeringAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadEngineeringAssignment_activeLeadId_key"
  ON "LeadEngineeringAssignment"("activeLeadId");

CREATE INDEX "LeadEngineeringAssignment_leadId_status_idx"
  ON "LeadEngineeringAssignment"("leadId", "status");

CREATE INDEX "LeadEngineeringAssignment_engineerId_status_idx"
  ON "LeadEngineeringAssignment"("engineerId", "status");

CREATE INDEX "LeadEngineeringAssignment_assignedById_idx"
  ON "LeadEngineeringAssignment"("assignedById");

CREATE INDEX "LeadEngineeringAssignment_assignedAt_idx"
  ON "LeadEngineeringAssignment"("assignedAt");

CREATE INDEX "LeadEngineeringAssignment_returnedById_idx"
  ON "LeadEngineeringAssignment"("returnedById");

CREATE INDEX "LeadEngineeringAssignment_completedById_idx"
  ON "LeadEngineeringAssignment"("completedById");

ALTER TABLE "LeadEngineeringAssignment"
  ADD CONSTRAINT "LeadEngineeringAssignment_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeadEngineeringAssignment"
  ADD CONSTRAINT "LeadEngineeringAssignment_engineerId_fkey"
  FOREIGN KEY ("engineerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LeadEngineeringAssignment"
  ADD CONSTRAINT "LeadEngineeringAssignment_assignedById_fkey"
  FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LeadEngineeringAssignment"
  ADD CONSTRAINT "LeadEngineeringAssignment_returnedById_fkey"
  FOREIGN KEY ("returnedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LeadEngineeringAssignment"
  ADD CONSTRAINT "LeadEngineeringAssignment_completedById_fkey"
  FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
