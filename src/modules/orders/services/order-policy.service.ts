import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma, RoleName } from '@prisma/client';
import {
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

@Injectable()
export class OrderPolicyService {
  getPermissions(user: PolicyUser, order: OrderPolicyTarget): OrderPermissions {
    const role = resolveUserRole(user);
    const isFinal = ORDER_FINAL_STATUSES.includes(order.status);
    const isOwner = order.deal.ownerId === user.id;

    if (role === UserRole.ADMIN) {
      return {
        canEdit: true,
        canDelete: true,
        canAddPayment: true,
        canConfirmPayment: true,
        canCreateDelivery: true,
      };
    }

    if (role === UserRole.FINANCIER) {
      return {
        canEdit: false,
        canDelete: false,
        canAddPayment: false,
        canConfirmPayment: true,
        canCreateDelivery: false,
      };
    }

    if (role === UserRole.SALES_HEAD) {
      const canMutate = !isFinal;

      return {
        canEdit: canMutate,
        canDelete: canMutate,
        canAddPayment: canMutate,
        canConfirmPayment: user.permissions.includes('payments:confirm'),
        canCreateDelivery: canMutate,
      };
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
    if (
      user.roles.includes(RoleName.STOREKEEPER) ||
      resolveUserRole(user) !== UserRole.MANAGER
    ) {
      return {};
    }

    return { deal: { ownerId: user.id } };
  }
}
