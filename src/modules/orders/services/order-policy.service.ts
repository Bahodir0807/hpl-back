import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import {
  hasUnscopedOrderVisibility,
  OrderPermissions,
  PolicyUser,
  resolveUserRole,
  UserRole,
} from '../../../common/enums/role.enum';

const ORDER_FINAL_STATUSES: OrderStatus[] = [
  OrderStatus.SHIPPED,
  OrderStatus.CANCELLED,
  OrderStatus.COMPLETED,
];

type OrderPolicyTarget = {
  status: OrderStatus;
  deal: { ownerId: string };
};

const NO_MUTATIONS: OrderPermissions = {
  canEdit: false,
  canDelete: false,
  canAddPayment: false,
  canConfirmPayment: false,
  canCreateDelivery: false,
};

@Injectable()
export class OrderPolicyService {
  getPermissions(user: PolicyUser, order: OrderPolicyTarget): OrderPermissions {
    const role = resolveUserRole(user);
    const isFinal = ORDER_FINAL_STATUSES.includes(order.status);
    const isOwner = order.deal.ownerId === user.id;

    if (role === UserRole.ACCOUNTANT) {
      return {
        ...NO_MUTATIONS,
        canConfirmPayment: true,
      };
    }

    if (role === UserRole.SALES_HEAD) {
      const canMutate = !isFinal;

      return {
        canEdit: canMutate,
        canDelete: canMutate,
        canAddPayment: canMutate,
        canConfirmPayment: false,
        canCreateDelivery: canMutate,
      };
    }

    if (
      role === UserRole.ADMIN ||
      role === UserRole.DIRECTOR ||
      role === UserRole.INSTALLER
    ) {
      return NO_MUTATIONS;
    }

    const canMutateOwn = isOwner && !isFinal;

    return {
      canEdit: canMutateOwn,
      canDelete: canMutateOwn,
      canAddPayment: canMutateOwn,
      canConfirmPayment: false,
      canCreateDelivery: canMutateOwn,
    };
  }

  getScopeFilter(user: PolicyUser): Prisma.OrderWhereInput {
    if (hasUnscopedOrderVisibility(user)) {
      return {};
    }

    return { deal: { ownerId: user.id } };
  }
}
