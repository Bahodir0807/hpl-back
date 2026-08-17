import { Injectable } from '@nestjs/common';
import { Deal, DealStage, Prisma, RoleName } from '@prisma/client';
import {
  DealPermissions,
  hasRole,
  hasUnscopedDealVisibility,
  PolicyUser,
} from '../../../common/enums/role.enum';

const CLOSED_DEAL_STAGES: DealStage[] = [DealStage.WON, DealStage.LOST];

export const COMMERCIAL_FIELDS_LOCKED_MESSAGE =
  'Коммерческие поля сделки заблокированы после закрытия (WON/LOST)';

@Injectable()
export class DealPolicyService {
  getPermissions(
    user: PolicyUser,
    deal: Pick<Deal, 'ownerId' | 'stage'>,
  ): DealPermissions {
    const isOwner = deal.ownerId === user.id;
    const isClosed = CLOSED_DEAL_STAGES.includes(deal.stage);
    const isHead = hasRole(user, RoleName.HEAD);
    const isManager = hasRole(user, RoleName.MANAGER);

    const canBypassStageValidation = isHead;
    const canEdit = isHead || (isManager && isOwner);
    const canDelete = canEdit;
    const canChangeStage = canEdit && !isClosed;
    // WON/LOST freeze agreed value. Operational Deal fields stay on canEdit.
    const canMutateCommercial = canEdit && !isClosed;

    return {
      canEdit,
      canDelete,
      canChangeStage,
      canMutateCommercial,
      canBypassStageValidation,
    };
  }

  getScopeFilter(user: PolicyUser): Prisma.DealWhereInput {
    if (hasUnscopedDealVisibility(user)) {
      return {};
    }

    return { ownerId: user.id };
  }

  canReadDeal(user: PolicyUser, deal: Pick<Deal, 'ownerId'>): boolean {
    const scopeFilter = this.getScopeFilter(user);

    if (Object.keys(scopeFilter).length === 0) {
      return true;
    }

    return deal.ownerId === user.id;
  }
}
