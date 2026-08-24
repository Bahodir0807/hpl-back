import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { hasRole, PolicyUser } from '../../../common/enums/role.enum';

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
    if (hasRole(user, RoleName.HEAD) || !hasRole(user, RoleName.MANAGER)) {
      return;
    }

    if (items.some((item) => (item.discount ?? 0) > 0)) {
      throw new ForbiddenException(MANAGER_DISCOUNT_FORBIDDEN_MESSAGE);
    }
  }

  validateItemPrices(user: PolicyUser, items: PricingValidationItem[]): void {
    const maxDiscountPercent = hasRole(user, RoleName.HEAD) ? 15 : 0;

    for (const item of items) {
      if (item.price < item.purchasePrice) {
        throw new BadRequestException(
          `Цена позиции (${item.price}) не может быть ниже закупочной цены (${item.purchasePrice})`,
        );
      }

      const minAllowedPrice = item.basePrice * (1 - maxDiscountPercent / 100);

      if (item.price < minAllowedPrice) {
        throw new BadRequestException(
          `Скидка превышает допустимый лимит (Макс. ${maxDiscountPercent}%)`,
        );
      }
    }
  }
}
