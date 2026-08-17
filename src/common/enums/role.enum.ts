import { RoleName } from '@prisma/client';
import type { CurrentUser } from '../interfaces/current-user.interface';

export type OrderPermissions = {
  canEdit: boolean;
  canDelete: boolean;
  canAddPayment: boolean;
  canConfirmPayment: boolean;
  canCreateDelivery: boolean;
};

export type DealPermissions = {
  canEdit: boolean;
  canDelete: boolean;
  canChangeStage: boolean;
  canMutateCommercial: boolean;
  canBypassStageValidation: boolean;
};

export type PolicyUser = Pick<CurrentUser, 'id' | 'roles' | 'permissions'>;

export const POLICY_FORBIDDEN_MESSAGE =
  'Изменение заблокировано текущей ролью или статусом сущности';

const UNSCOPED_DEAL_ROLES: readonly RoleName[] = [
  RoleName.HEAD,
  RoleName.DIRECTOR,
  RoleName.ACCOUNTANT,
];

const UNSCOPED_ORDER_ROLES: readonly RoleName[] = [
  RoleName.HEAD,
  RoleName.DIRECTOR,
  RoleName.ACCOUNTANT,
  RoleName.STOREKEEPER,
];

const USER_MODULE_ROLES: readonly RoleName[] = [
  RoleName.ADMIN,
  RoleName.DIRECTOR,
  RoleName.HEAD,
];

export function hasRole(
  user: Pick<PolicyUser, 'roles'>,
  role: RoleName,
): boolean {
  return user.roles.includes(role);
}

export function hasAnyRole(
  user: Pick<PolicyUser, 'roles'>,
  roles: readonly RoleName[],
): boolean {
  return roles.some((role) => user.roles.includes(role));
}

export function hasUnscopedDealVisibility(user: PolicyUser): boolean {
  return hasAnyRole(user, UNSCOPED_DEAL_ROLES);
}

export function hasUnscopedOrderVisibility(user: PolicyUser): boolean {
  return hasAnyRole(user, UNSCOPED_ORDER_ROLES);
}

export function hasUserModuleAccess(user: Pick<PolicyUser, 'roles'>): boolean {
  return hasAnyRole(user, USER_MODULE_ROLES);
}
