import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma, RoleName } from '@prisma/client';
import {
  hasRole,
  hasUnscopedOrderVisibility,
  OrderPermissions,
  PolicyUser,
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
    const isFinal = ORDER_FINAL_STATUSES.includes(order.status);
    const isOwner = order.deal.ownerId === user.id;
    const canMutateAsHead = hasRole(user, RoleName.HEAD) && !isFinal;
    const canMutateOwn =
      (hasRole(user, RoleName.MANAGER) || hasRole(user, RoleName.STOREKEEPER)) &&
      isOwner &&
      !isFinal;
    const canMutate = canMutateAsHead || canMutateOwn;

    return {
      canEdit: canMutate,
      canDelete: canMutate,
      canAddPayment: canMutate,
      canConfirmPayment: hasRole(user, RoleName.ACCOUNTANT),
      canCreateDelivery: canMutate,
    };
  }

  getScopeFilter(user: PolicyUser): Prisma.OrderWhereInput {
    if (hasUnscopedOrderVisibility(user)) {
      return {};
    }

    return { deal: { ownerId: user.id } };
  }
}
