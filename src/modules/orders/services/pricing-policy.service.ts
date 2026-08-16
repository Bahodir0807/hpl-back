import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  PolicyUser,
  resolveUserRole,
  UserRole,
} from '../../../common/enums/role.enum';

export type PricingValidationItem = {
  productId: string;
  price: number;
  basePrice: number;
  purchasePrice: number;
};

export const MANAGER_DISCOUNT_FORBIDDEN_MESSAGE =
  'Менеджер не может назначать скидку';

@Injectable()
export class PricingPolicyService {
  assertManagerCannotAssignDiscount(
    user: PolicyUser,
    items: Array<{ discount?: number }>,
  ): void {
    if (resolveUserRole(user) !== UserRole.MANAGER) {
      return;
    }

    if (items.some((item) => (item.discount ?? 0) > 0)) {
      throw new ForbiddenException(MANAGER_DISCOUNT_FORBIDDEN_MESSAGE);
    }
  }

  validateItemPrices(
    user: PolicyUser,
    items: PricingValidationItem[],
  ): void {
    const role = resolveUserRole(user);

    if (role === UserRole.ADMIN) {
      return;
    }

    for (const item of items) {
      if (item.price < item.purchasePrice) {
        throw new BadRequestException(
          `Цена позиции (${item.price}) не может быть ниже закупочной цены (${item.purchasePrice})`,
        );
      }

      const maxDiscountPercent = role === UserRole.SALES_HEAD ? 15 : 0;
      const minAllowedPrice = item.basePrice * (1 - maxDiscountPercent / 100);

      if (item.price < minAllowedPrice) {
        throw new BadRequestException(
          `Скидка превышает допустимый лимит для роли ${role} (Макс. ${maxDiscountPercent}%)`,
        );
      }
    }
  }
}
