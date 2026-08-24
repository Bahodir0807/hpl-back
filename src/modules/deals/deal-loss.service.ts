import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityType, DealStage, Prisma } from '@prisma/client';
import { LoseOpportunityDto } from '../../common/dto/lose-opportunity.dto';
import { POLICY_FORBIDDEN_MESSAGE } from '../../common/enums/role.enum';
import { BusinessException } from '../../common/exceptions/business.exception';
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { createHeadRecoveryTasks } from '../tasks/opportunity-recovery';
import { DealPolicyService } from './services/deal-policy.service';

const lossResultInclude = Prisma.validator<Prisma.DealInclude>()({
  client: true,
  projectObject: true,
  owner: true,
  lostBy: { select: { id: true, firstName: true, lastName: true } },
});

@Injectable()
export class DealLossService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dealPolicy: DealPolicyService,
  ) {}

  async lose(id: string, dto: LoseOpportunityDto, user: CurrentUser) {
    const comment = dto.comment?.trim() || null;
    if (dto.reason === 'OTHER' && !comment) {
      throw new BadRequestException(
        'comment is required for OTHER loss reason',
      );
    }

    const deal = await this.prisma.deal.findFirst({
      where: { id, deletedAt: null },
    });
    if (!deal) throw new NotFoundException('Deal not found');
    if (!this.dealPolicy.canReadDeal(user, deal)) {
      throw new ForbiddenException('Access to this deal is forbidden');
    }
    if (deal.lostAt) {
      return this.prisma.deal.findUniqueOrThrow({
        where: { id },
        include: lossResultInclude,
      });
    }
    if (deal.stage === DealStage.LOST) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'DEAL_ALREADY_LOST',
        'Historical LOST Deal cannot be assigned a fabricated loss event',
      );
    }
    if (!this.dealPolicy.getPermissions(user, deal).canChangeStage) {
      throw new ForbiddenException(POLICY_FORBIDDEN_MESSAGE);
    }

    return this.prisma.$transaction(async (tx) => {
      const lostAt = new Date();
      const claimed = await tx.deal.updateMany({
        where: {
          id,
          deletedAt: null,
          lostAt: null,
          stage: { notIn: [DealStage.WON, DealStage.LOST] },
        },
        data: {
          stage: DealStage.LOST,
          lostReasonCode: dto.reason,
          lostComment: comment,
          lostAt,
          lostById: user.id,
          nextActionAt: null,
        },
      });
      if (claimed.count !== 1) {
        const latest = await tx.deal.findUnique({ where: { id } });
        if (latest?.lostAt) {
          return tx.deal.findUniqueOrThrow({
            where: { id },
            include: lossResultInclude,
          });
        }
        throw new ConflictException('Deal loss state changed concurrently');
      }

      await tx.dealStageHistory.create({
        data: {
          dealId: id,
          oldStage: deal.stage,
          newStage: DealStage.LOST,
          changedById: user.id,
          reason: dto.reason,
        },
      });
      await tx.activity.create({
        data: {
          authorId: user.id,
          relatedType: 'Deal',
          relatedId: id,
          type: ActivityType.STAGE_CHANGED,
          content: `Deal lost: ${dto.reason}`,
          metadata: { oldStage: deal.stage, reason: dto.reason, comment },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'DEAL_LOST',
          entityType: 'Deal',
          entityId: id,
          oldValue: { stage: deal.stage },
          newValue: {
            stage: DealStage.LOST,
            reason: dto.reason,
            comment,
            lostAt: lostAt.toISOString(),
          },
        },
      });
      await createHeadRecoveryTasks(tx, {
        entityType: 'Deal',
        entityId: id,
        title: deal.title,
        reason: dto.reason,
        actorId: user.id,
      });

      return tx.deal.findUniqueOrThrow({
        where: { id },
        include: lossResultInclude,
      });
    });
  }
}
