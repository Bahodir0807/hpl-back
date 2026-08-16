import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import { LEADS_READ_ALL_PERMISSION } from '../../calculations/calculation.constants';
import { PrismaService } from '../prisma/prisma.service';
import { LeadVirtualStatusService } from './lead-virtual-status.service';

const leadWorkspaceInclude = Prisma.validator<Prisma.LeadInclude>()({
  owner: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  client: {
    include: {
      contacts: {
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
    },
  },
  contact: true,
  projectObject: true,
  deal: {
    select: {
      id: true,
      title: true,
      stage: true,
      supplierOrder: { select: { id: true, status: true } },
    },
  },
});

const calculationSummaryInclude = {
  items: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      panelType: { select: { code: true, displayNameRu: true } },
      panelSize: { select: { displayName: true, areaM2: true } },
      supplier: { select: { code: true, name: true } },
      qualityClass: { select: { code: true, nameRu: true } },
      color: { select: { colorCode: true, colorName: true } },
    },
  },
};

@Injectable()
export class LeadWorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly virtualStatusService: LeadVirtualStatusService,
  ) {}

  async getWorkspace(leadId: string, user: CurrentUser) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, deletedAt: null },
      include: leadWorkspaceInclude,
    });

    if (!lead) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'LEAD_NOT_FOUND',
        'Лид не найден',
      );
    }

    if (
      !user.permissions.includes(LEADS_READ_ALL_PERMISSION) &&
      lead.ownerId !== user.id
    ) {
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'У вас нет доступа к этому лиду',
      );
    }

    const now = new Date();

    const [
      activities,
      calculations,
      panelTypes,
      panelSizes,
      suppliers,
      thicknessPricing,
      recentColors,
      virtualStatus,
    ] = await Promise.all([
      this.prisma.activity.findMany({
        where: { relatedType: 'Lead', relatedId: leadId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          author: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),
      this.prisma.calculationSession.findMany({
        where: { leadId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: calculationSummaryInclude,
      }),
      this.prisma.panelType.findMany({
        where: { isActive: true },
        orderBy: { displayNameRu: 'asc' },
      }),
      this.prisma.panelSize.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.supplier.findMany({
        where: {
          code: { in: ['wuya', 'tianran', 'polybet'] },
        },
        orderBy: { name: 'asc' },
        include: {
          qualityMappings: {
            include: {
              panelType: { select: { id: true, code: true, displayNameRu: true } },
              qualityClass: { select: { id: true, code: true, nameRu: true } },
            },
            orderBy: { qualityClass: { code: 'asc' } },
          },
        },
      }),
      this.prisma.panelThicknessPricing.findMany({
        where: {
          isActive: true,
          validFrom: { lte: now },
          OR: [{ validTo: null }, { validTo: { gte: now } }],
        },
        orderBy: { thicknessMm: 'asc' },
      }),
      this.prisma.panelColor.findMany({
        where: { createdByManagerId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.virtualStatusService.getStatus(leadId),
    ]);

    return {
      lead: {
        ...lead,
        virtualStatus,
      },
      activities,
      calculations,
      catalog: {
        panelTypes,
        panelSizes,
        suppliers,
        thicknessPricing,
        recentColors,
      },
    };
  }
}
