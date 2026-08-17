import { ForbiddenException, HttpStatus } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';

export const PROTECTED_BUSINESS_ACCOUNT_ERROR = 'PROTECTED_BUSINESS_ACCOUNT';

/** Business authority roles. Not assignable through the user-administration API. */
export const PROTECTED_BUSINESS_ROLES: ReadonlySet<RoleName> = new Set([
  RoleName.DIRECTOR,
  RoleName.HEAD,
  RoleName.ACCOUNTANT,
]);

/** Roles ADMIN may attach when creating a technical/operational account. */
export const ADMIN_PROVISIONABLE_ROLES: ReadonlySet<RoleName> = new Set([
  RoleName.ADMIN,
  RoleName.MANAGER,
  RoleName.STOREKEEPER,
  RoleName.INSTALLER,
]);

/**
 * DIRECTOR / HEAD / ACCOUNTANT assignment is out of band (seed / manual DB).
 * The user-create API must not mint those roles for any actor, including ADMIN
 * and DIRECTOR, so ADMIN cannot self-escalate into business authority.
 */
export function assertCreatableRoleNames(
  actorRoles: readonly RoleName[],
  requestedRoleNames: readonly RoleName[],
): void {
  const protectedRequested = uniqueRoles(
    requestedRoleNames.filter((role) => PROTECTED_BUSINESS_ROLES.has(role)),
  );

  if (protectedRequested.length > 0) {
    throw new ForbiddenException(
      `Cannot assign protected business roles: ${protectedRequested.join(', ')}`,
    );
  }

  if (!actorRoles.includes(RoleName.ADMIN)) {
    throw new ForbiddenException(
      'Role assignment through user administration is not permitted for this account',
    );
  }

  const disallowed = uniqueRoles(
    requestedRoleNames.filter((role) => !ADMIN_PROVISIONABLE_ROLES.has(role)),
  );

  if (disallowed.length > 0) {
    throw new ForbiddenException(
      `ADMIN cannot assign roles: ${disallowed.join(', ')}`,
    );
  }
}

/**
 * Administrative password reset of DIRECTOR / HEAD / ACCOUNTANT is out of band.
 * ADMIN must not take over those credentials through the user API.
 */
export function assertAdministrativePasswordResetAllowed(
  targetRoles: readonly RoleName[],
): void {
  if (targetRoles.some((role) => PROTECTED_BUSINESS_ROLES.has(role))) {
    throw new BusinessException(
      HttpStatus.FORBIDDEN,
      PROTECTED_BUSINESS_ACCOUNT_ERROR,
      'Administrative password reset is not allowed for protected business accounts',
    );
  }
}

function uniqueRoles(roles: readonly RoleName[]): RoleName[] {
  return [...new Set(roles)];
}
