import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActivityType, CommercialQualificationStatus, LeadStatus } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import type { Env } from '../../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';

const TELEGRAM_LEAD_SOURCE = 'telegram';

@Injectable()
export class LeadVirtualStatusService {
  private poolUserIdCache: string | null | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  async getStatus(leadId: string): Promise<string> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, deletedAt: null },
    });

    if (!lead) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'LEAD_NOT_FOUND',
        'Лид не найден',
      );
    }

    if (lead.status === LeadStatus.CONVERTED) {
      return 'converted';
    }

    if (lead.status === LeadStatus.UNQUALIFIED) {
      return 'unqualified';
    }

    if (lead.status === LeadStatus.QUALIFIED) {
      const commercial =
        await this.prisma.leadCommercialQualification.findUnique({
          where: { leadId },
          select: { status: true },
        });

      if (commercial?.status === CommercialQualificationStatus.CONFIRMED) {
        return 'commercially_qualified';
      }

      return 'qualified';
    }

    const activities = await this.prisma.activity.findMany({
      where: { relatedType: 'Lead', relatedId: leadId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    if (
      activities.some(
        (activity) =>
          activity.metadata &&
          typeof activity.metadata === 'object' &&
          !Array.isArray(activity.metadata) &&
          activity.metadata['action'] === 'quote_sent',
      )
    ) {
      return 'quote_sent';
    }

    if (activities.some((activity) => activity.type === ActivityType.CALCULATION)) {
      return 'calculator_used';
    }

    if (activities.some((activity) => activity.type === ActivityType.CALL)) {
      return 'called';
    }

    const poolUserId = await this.getPoolUserId();
    const telegramMeta = await this.prisma.telegramLeadMetadata.findUnique({
      where: { leadId },
    });

    if (
      poolUserId &&
      lead.ownerId &&
      lead.ownerId !== poolUserId &&
      telegramMeta?.isPendingAssignment === false
    ) {
      return 'manager_assigned';
    }

    if (
      lead.source === TELEGRAM_LEAD_SOURCE &&
      poolUserId &&
      lead.ownerId === poolUserId
    ) {
      return telegramMeta?.isPendingAssignment
        ? 'pending_admin'
        : 'new_from_telegram';
    }

    return lead.status.toLowerCase();
  }

  private async getPoolUserId(): Promise<string | null> {
    if (this.poolUserIdCache !== undefined) {
      return this.poolUserIdCache;
    }

    const email = this.configService.get('LEAD_POOL_USER_EMAIL', { infer: true });
    const poolUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    this.poolUserIdCache = poolUser?.id ?? null;
    return this.poolUserIdCache ?? null;
  }
}
