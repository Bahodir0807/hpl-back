import { Injectable } from '@nestjs/common';
import { Deal, DealStage, Prisma } from '@prisma/client';
import {
  DealPermissions,
  PolicyUser,
  resolveUserRole,
  UserRole,
} from '../../../common/enums/role.enum';

const CLOSED_DEAL_STAGES: DealStage[] = [DealStage.WON, DealStage.LOST];

export const COMMERCIAL_FIELDS_LOCKED_MESSAGE =
  'Коммерческие поля сделки заблокированы после закрытия (WON/LOST)';

@Injectable()
export class DealPolicyService {
  getPermissions(user: PolicyUser, deal: Pick<Deal, 'ownerId' | 'stage'>): DealPermissions {
    const role = resolveUserRole(user);
    const isOwner = deal.ownerId === user.id;
    const isClosed = CLOSED_DEAL_STAGES.includes(deal.stage);

    const canBypassStageValidation =
      role === UserRole.ADMIN || role === UserRole.SALES_HEAD;

    let canEdit = false;

    if (role === UserRole.ADMIN || role === UserRole.SALES_HEAD) {
      canEdit = true;
    } else if (role === UserRole.MANAGER) {
      canEdit = isOwner;
    }

    const canDelete =
      role === UserRole.ADMIN ||
      role === UserRole.SALES_HEAD ||
      (role === UserRole.MANAGER && isOwner);

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
    if (resolveUserRole(user) === UserRole.MANAGER) {
      return { ownerId: user.id };
    }

    return {};
  }

  canReadDeal(user: PolicyUser, deal: Pick<Deal, 'ownerId'>): boolean {
    const scopeFilter = this.getScopeFilter(user);

    if (Object.keys(scopeFilter).length === 0) {
      return true;
    }

    return deal.ownerId === user.id;
  }
}
