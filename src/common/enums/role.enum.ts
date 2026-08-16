import { RoleName } from '@prisma/client';
import type { CurrentUser } from '../interfaces/current-user.interface';

export enum UserRole {
  ADMIN = 'ADMIN',
  SALES_HEAD = 'SALES_HEAD',
  MANAGER = 'MANAGER',
  FINANCIER = 'FINANCIER',
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

  if (user.roles.includes(RoleName.HEAD)) {
    return UserRole.SALES_HEAD;
  }

  if ((user.roles as string[]).includes(UserRole.FINANCIER)) {
    return UserRole.FINANCIER;
  }

  return UserRole.MANAGER;
}
