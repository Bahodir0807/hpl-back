import { EngineeringAssignmentStatus, Prisma } from '@prisma/client';
import { ENGINEERING_PERMISSIONS } from './engineering.constants';

type PrismaClientLike = {
  leadEngineeringAssignment: {
    findFirst: Prisma.LeadEngineeringAssignmentDelegate['findFirst'];
  };
};

export function hasEngineeringReadPermission(
  permissions: readonly string[],
): boolean {
  return permissions.includes(ENGINEERING_PERMISSIONS.READ);
}

export function hasOwnerOrReadAllLeadAccess(
  lead: { ownerId: string },
  currentUserId: string,
  permissions: readonly string[],
): boolean {
  return (
    permissions.includes('leads:read_all') || lead.ownerId === currentUserId
  );
}

export async function findActiveEngineeringAssignment(
  prisma: PrismaClientLike,
  leadId: string,
  engineerId: string,
) {
  return prisma.leadEngineeringAssignment.findFirst({
    where: {
      leadId,
      engineerId,
      status: EngineeringAssignmentStatus.ACTIVE,
      activeLeadId: leadId,
    },
  });
}

export async function hasActiveEngineeringAssignment(
  prisma: PrismaClientLike,
  leadId: string,
  engineerId: string,
): Promise<boolean> {
  const assignment = await findActiveEngineeringAssignment(
    prisma,
    leadId,
    engineerId,
  );
  return Boolean(assignment);
}

export async function hasActiveEngineeringAssignmentForClient(
  prisma: PrismaClientLike,
  clientId: string,
  engineerId: string,
): Promise<boolean> {
  const assignment = await prisma.leadEngineeringAssignment.findFirst({
    where: {
      engineerId,
      status: EngineeringAssignmentStatus.ACTIVE,
      lead: { clientId, deletedAt: null },
    },
    select: { id: true },
  });
  return Boolean(assignment);
}

export async function hasActiveEngineeringAssignmentForDeal(
  prisma: PrismaClientLike,
  dealId: string,
  engineerId: string,
): Promise<boolean> {
  const assignment = await prisma.leadEngineeringAssignment.findFirst({
    where: {
      engineerId,
      status: EngineeringAssignmentStatus.ACTIVE,
      lead: { dealId, deletedAt: null },
    },
    select: { id: true },
  });
  return Boolean(assignment);
}

export async function canAccessLeadRecord(
  prisma: PrismaClientLike,
  lead: { id: string; ownerId: string },
  currentUserId: string,
  permissions: readonly string[],
): Promise<boolean> {
  if (hasOwnerOrReadAllLeadAccess(lead, currentUserId, permissions)) {
    return true;
  }

  if (!hasEngineeringReadPermission(permissions)) {
    return false;
  }

  return hasActiveEngineeringAssignment(prisma, lead.id, currentUserId);
}

export function isEngineeringOnlyViewer(
  lead: { ownerId: string },
  currentUserId: string,
  permissions: readonly string[],
): boolean {
  return (
    !hasOwnerOrReadAllLeadAccess(lead, currentUserId, permissions) &&
    hasEngineeringReadPermission(permissions)
  );
}

export function leadNeedsEngineer(
  qualification: {
    installationRequired?: boolean | null;
    ventFacadeKitRequired?: boolean | null;
  } | null,
): boolean {
  return (
    qualification?.installationRequired === true ||
    qualification?.ventFacadeKitRequired === true
  );
}
