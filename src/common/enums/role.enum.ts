import { RoleName } from '@prisma/client';
import type { CurrentUser } from '../interfaces/current-user.interface';

export enum UserRole {
  ADMIN = 'ADMIN',
  DIRECTOR = 'DIRECTOR',
  SALES_HEAD = 'SALES_HEAD',
  MANAGER = 'MANAGER',
  ACCOUNTANT = 'ACCOUNTANT',
  STOREKEEPER = 'STOREKEEPER',
  INSTALLER = 'INSTALLER',
}

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

export function resolveUserRole(user: PolicyUser): UserRole {
  if (user.roles.includes(RoleName.ADMIN)) {
    return UserRole.ADMIN;
  }

  if (user.roles.includes(RoleName.DIRECTOR)) {
    return UserRole.DIRECTOR;
  }

  if (user.roles.includes(RoleName.HEAD)) {
    return UserRole.SALES_HEAD;
  }

  if (user.roles.includes(RoleName.ACCOUNTANT)) {
    return UserRole.ACCOUNTANT;
  }

  if (user.roles.includes(RoleName.STOREKEEPER)) {
    return UserRole.STOREKEEPER;
  }

  if (user.roles.includes(RoleName.INSTALLER)) {
    return UserRole.INSTALLER;
  }

  return UserRole.MANAGER;
}

export function hasUnscopedDealVisibility(user: PolicyUser): boolean {
  const role = resolveUserRole(user);
  return (
    role === UserRole.SALES_HEAD ||
    role === UserRole.DIRECTOR ||
    role === UserRole.ACCOUNTANT
  );
}

export function hasUnscopedOrderVisibility(user: PolicyUser): boolean {
  const role = resolveUserRole(user);
  return (
    role === UserRole.SALES_HEAD ||
    role === UserRole.DIRECTOR ||
    role === UserRole.ACCOUNTANT ||
    role === UserRole.STOREKEEPER
  );
}
