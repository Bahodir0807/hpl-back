import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException } from '../common/exceptions/business.exception';
import type { CurrentUser } from '../common/interfaces/current-user.interface';
import {
  HPL_SELLING_COEFFICIENT,
  HPL_SELLING_CURRENCY,
} from '../panels/pricing/hpl-pricing.constants';
import { PrismaService } from '../modules/prisma/prisma.service';
import {
  CALCULATION_PERMISSIONS,
  CALCULATION_REQUEST_STATUS,
  CALCULATION_STATUS,
} from './calculation.constants';
import {
  CalculationService,
  toPersistedLineItem,
  type CalculatedLineItem,
  type CalculationWithItems,
} from './calculations.service';
import {
  CreateCalculationRequestDto,
  type CalculationRequestGroupDto,
} from './dto/create-calculation-request.dto';
import { FilterCalculationRequestsDto } from './dto/filter-calculation-requests.dto';
import { UpdateCalculationRequestDto } from './dto/update-calculation-request.dto';
import { QUOTE_PERMISSIONS } from '../quotes/quote.constants';

const requestInclude = Prisma.validator<Prisma.CalculationRequestInclude>()({
  calculations: {
    where: { deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    include: {
      items: {
        orderBy: { sortOrder: 'asc' },
        include: {
          panelType: { select: { code: true, displayNameRu: true } },
          panelSize: { select: { displayName: true, areaM2: true } },
          supplier: { select: { code: true, name: true } },
          qualityClass: { select: { code: true, nameRu: true } },
          color: { select: { colorCode: true, colorName: true } },
        },
      },
    },
  },
  quotes: {
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      totalAmount: true,
      displayCurrency: true,
      finalizedAt: true,
      createdAt: true,
    },
  },
});

type PreparedCalculationGroup = {
  group: CalculationRequestGroupDto;
  result: Awaited<ReturnType<CalculationService['prepareManagerCatalogGroup']>>;
};

function persistableLineItems(items: CalculatedLineItem[]) {
  return items.map(toPersistedLineItem);
}

function groupTotal(items: CalculatedLineItem[]) {
  return items.reduce(
    (sum, item) => sum.plus(item.totalPrice),
    new Prisma.Decimal(0),
  );
}

export type CalculationRequestWithGroups = Prisma.CalculationRequestGetPayload<{
  include: typeof requestInclude;
}>;

@Injectable()
export class CalculationRequestService {
  private readonly logger = new Logger(CalculationRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calculationService: CalculationService,
  ) {}

  async create(
    dto: CreateCalculationRequestDto,
    user: CurrentUser,
  ): Promise<CalculationRequestWithGroups> {
    this.assertCreateAccess(user);
    this.assertNonEmptyGroups(dto.calculations);
    const lead = await this.calculationService.guardLeadForCalculationRequest(
      dto.leadId,
      user,
    );

    const prepared: PreparedCalculationGroup[] = [];
    for (const group of dto.calculations) {
      prepared.push({
        group,
        result: await this.calculationService.prepareManagerCatalogGroup(
          dto.leadId,
          group.items,
          user,
        ),
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const request = await tx.calculationRequest.create({
        data: {
          leadId: dto.leadId,
          clientId: lead.clientId,
          dealId: lead.dealId,
          createdById: user.id,
          status: CALCULATION_REQUEST_STATUS.DRAFT,
          notes: dto.notes,
        },
      });

      for (const [index, entry] of prepared.entries()) {
        const totalAmount = groupTotal(entry.result.calculatedItems);
        await tx.calculationSession.create({
          data: {
            requestId: request.id,
            leadId: dto.leadId,
            clientId: lead.clientId,
            projectObjectId: lead.projectObjectId,
            dealId: lead.dealId,
            createdById: user.id,
            status: CALCULATION_STATUS.DRAFT,
            sortOrder: index,
            title: entry.group.title,
            notes: entry.group.notes,
            totalAmount: totalAmount.toDecimalPlaces(2),
            displayCurrency: HPL_SELLING_CURRENCY,
            cnyUsdRate: entry.result.cnyUsdRate,
            sellingCoefficient: HPL_SELLING_COEFFICIENT,
            items: {
              create: persistableLineItems(entry.result.calculatedItems),
            },
          },
        });
      }

      return tx.calculationRequest.findUniqueOrThrow({
        where: { id: request.id },
        include: requestInclude,
      });
    });
  }

  async findAll(
    filter: FilterCalculationRequestsDto,
    user: CurrentUser,
  ): Promise<{
    items: CalculationRequestWithGroups[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 20;
    const where: Prisma.CalculationRequestWhereInput = {
      deletedAt: null,
      ...(filter.leadId ? { leadId: filter.leadId } : {}),
      ...(filter.clientId ? { clientId: filter.clientId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    };

    if (!user.permissions.includes(CALCULATION_PERMISSIONS.READ_ALL)) {
      where.createdById = user.id;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.calculationRequest.findMany({
        where,
        include: requestInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.calculationRequest.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(
    id: string,
    user: CurrentUser,
  ): Promise<CalculationRequestWithGroups> {
    const request = await this.getActiveRequest(id);
    this.assertReadAccess(request.createdById, user);
    return this.prisma.calculationRequest.findUniqueOrThrow({
      where: { id },
      include: requestInclude,
    });
  }

  async update(
    id: string,
    dto: UpdateCalculationRequestDto,
    user: CurrentUser,
  ): Promise<CalculationRequestWithGroups> {
    const request = await this.getActiveRequest(id);
    this.assertWriteAccess(request.createdById, user);
    const isQuoteRevision =
      request.status === CALCULATION_REQUEST_STATUS.QUOTED &&
      user.permissions.includes(QUOTE_PERMISSIONS.APPROVE);
    if (!isQuoteRevision) {
      this.assertDraft(request.status);
    } else {
      const latestQuote = await this.prisma.panelQuote.findFirst({
        where: { requestId: id },
        orderBy: { versionNumber: 'desc' },
        select: { finalizedAt: true, pdfFileId: true },
      });
      if (!latestQuote?.finalizedAt || !latestQuote.pdfFileId) {
        throw new BusinessException(
          HttpStatus.CONFLICT,
          'QUOTE_REVISION_REQUIRES_FINALIZED_VERSION',
          'The current Quote version must be finalized before its request can be corrected',
        );
      }
    }

    if (dto.calculations) {
      this.assertNonEmptyGroups(dto.calculations);
    }

    const prepared = dto.calculations
      ? await Promise.all(
          dto.calculations.map(async (group) => ({
            group,
            result: await this.calculationService.prepareManagerCatalogGroup(
              request.leadId,
              group.items,
              user,
            ),
          })),
        )
      : null;

    return this.prisma.$transaction(async (tx) => {
      if (prepared) {
        if (isQuoteRevision) {
          await tx.calculationSession.updateMany({
            where: { requestId: id, deletedAt: null },
            data: { deletedAt: new Date() },
          });
        } else {
          await tx.calculationSession.deleteMany({ where: { requestId: id } });
        }

        for (const [index, entry] of prepared.entries()) {
          const totalAmount = groupTotal(entry.result.calculatedItems);
          await tx.calculationSession.create({
            data: {
              requestId: id,
              leadId: request.leadId,
              clientId: request.clientId,
              dealId: request.dealId,
              createdById: isQuoteRevision ? user.id : request.createdById,
              status: CALCULATION_STATUS.DRAFT,
              sortOrder: index,
              title: entry.group.title,
              notes: entry.group.notes,
              totalAmount: totalAmount.toDecimalPlaces(2),
              displayCurrency: HPL_SELLING_CURRENCY,
              cnyUsdRate: entry.result.cnyUsdRate,
              sellingCoefficient: HPL_SELLING_COEFFICIENT,
              items: {
                create: persistableLineItems(entry.result.calculatedItems),
              },
            },
          });
        }
      }

      return tx.calculationRequest.update({
        where: { id },
        data: {
          notes: dto.notes ?? request.notes,
        },
        include: requestInclude,
      });
    });
  }

  async submit(
    id: string,
    user: CurrentUser,
  ): Promise<CalculationRequestWithGroups> {
    const request = await this.findOne(id, user);
    this.assertWriteAccess(request.createdById, user);
    this.assertDraft(request.status);
    this.assertNonEmptyGroups(
      request.calculations.map((calculation) => ({
        items: calculation.items,
      })),
    );

    const claimed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.calculationRequest.updateMany({
        where: {
          id,
          status: CALCULATION_REQUEST_STATUS.DRAFT,
          deletedAt: null,
        },
        data: {
          status: CALCULATION_REQUEST_STATUS.SUBMITTED,
          submittedAt: new Date(),
          submittedById: user.id,
        },
      });

      if (result.count !== 1) {
        return null;
      }

      await tx.calculationSession.updateMany({
        where: { requestId: id, deletedAt: null },
        data: { status: CALCULATION_STATUS.FINALIZED },
      });

      return tx.calculationRequest.findUniqueOrThrow({
        where: { id },
        include: requestInclude,
      });
    });

    if (!claimed) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'CALCULATION_REQUEST_LOCKED',
        'Запрос уже отправлен или изменён параллельно',
      );
    }

    await this.safePostCommit(
      'calculation request submitted notification',
      async () => {
        const recipients = await this.prisma.user.findMany({
          where: {
            isActive: true,
            OR: [
              {
                roles: {
                  some: {
                    role: {
                      permissions: {
                        some: {
                          permission: { slug: QUOTE_PERMISSIONS.APPROVE },
                        },
                      },
                    },
                  },
                },
              },
              {
                permissions: {
                  some: {
                    permission: { slug: QUOTE_PERMISSIONS.APPROVE },
                  },
                },
              },
            ],
          },
          select: { id: true },
        });
        if (recipients.length > 0) {
          await this.prisma.notification.createMany({
            data: recipients.map((recipient) => ({
              userId: recipient.id,
              title: 'Calculation request submitted',
              message: `Calculation request #${claimed.id.slice(0, 8)} is ready for commercial pricing`,
              type: 'calculation_request_submitted',
              relatedType: 'Lead',
              relatedId: claimed.leadId,
            })),
          });
        }
      },
    );

    return claimed;
  }

  private async safePostCommit(
    label: string,
    action: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.logger.error(
        `${label} failed after commit: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async getActiveRequest(id: string) {
    const request = await this.prisma.calculationRequest.findFirst({
      where: { id, deletedAt: null },
    });
    if (!request) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'CALCULATION_REQUEST_NOT_FOUND',
        'Запрос расчёта не найден',
      );
    }
    return request;
  }

  private assertNonEmptyGroups(groups: Array<{ items: unknown[] }>): void {
    if (groups.length === 0) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'CALCULATION_REQUEST_EMPTY',
        'Запрос должен содержать хотя бы один расчёт',
      );
    }
    for (const group of groups) {
      if (!group.items || group.items.length === 0) {
        throw new BusinessException(
          HttpStatus.BAD_REQUEST,
          'CALCULATION_ITEMS_EMPTY',
          'Каждый расчёт должен содержать хотя бы одну HPL-позицию',
        );
      }
    }
  }

  private assertDraft(status: string): void {
    if (status !== CALCULATION_REQUEST_STATUS.DRAFT) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'CALCULATION_REQUEST_LOCKED',
        'Запрос отправлен руководителю, его нельзя менять',
      );
    }
  }

  private assertCreateAccess(user: CurrentUser): void {
    if (user.permissions.includes(CALCULATION_PERMISSIONS.CREATE)) {
      return;
    }
    throw new BusinessException(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'Недостаточно прав для создания запроса расчёта',
    );
  }

  private assertReadAccess(createdById: string, user: CurrentUser): void {
    if (
      user.permissions.includes(CALCULATION_PERMISSIONS.READ_ALL) ||
      createdById === user.id
    ) {
      return;
    }
    throw new BusinessException(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'У вас нет доступа к этому запросу',
    );
  }

  private assertWriteAccess(createdById: string, user: CurrentUser): void {
    if (
      user.permissions.includes(CALCULATION_PERMISSIONS.READ_ALL) ||
      createdById === user.id
    ) {
      return;
    }
    throw new BusinessException(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'У вас нет доступа к этому запросу',
    );
  }
}

export type { CalculationWithItems };
