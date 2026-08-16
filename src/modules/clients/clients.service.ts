import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Client,
  DealStage,
  LeadStatus,
  Prisma,
  TaskStatus,
} from '@prisma/client';
import { normalizePhone } from '../../common/utils/phone-normalizer';
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { CheckDuplicatesDto } from './dto/check-duplicates.dto';
import { CreateClientDto } from './dto/create-client.dto';
import { CreateContactDto } from './dto/create-contact.dto';
import { CreateProjectObjectDto } from './dto/create-project-object.dto';
import { FilterClientDto } from './dto/filter-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';

const READ_ALL_CLIENTS_PERMISSION = 'clients:read_all';

type DuplicateMatchReason =
  'MATCH_INN' | 'MATCH_PHONE' | 'MATCH_EMAIL' | 'MATCH_NAME';

type DuplicateClient = Pick<
  Client,
  'id' | 'type' | 'name' | 'inn' | 'phone' | 'email' | 'ownerId' | 'status'
>;

export type ClientDuplicateMatch = {
  client: DuplicateClient;
  reasons: DuplicateMatchReason[];
};

const clientOwnerInclude = Prisma.validator<Prisma.ClientInclude>()({
  owner: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
});

type ClientListItem = Prisma.ClientGetPayload<{
  include: typeof clientOwnerInclude;
}>;

type ClientListResult = {
  items: ClientListItem[];
  total: number;
  page: number;
  limit: number;
};

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async checkDuplicates(
    dto: CheckDuplicatesDto,
    user: CurrentUser,
  ): Promise<ClientDuplicateMatch[]> {
    const normalizedPhone = dto.phone ? normalizePhone(dto.phone) : undefined;
    const normalizedEmail = dto.email?.toLowerCase().trim();
    const normalizedInn = dto.inn?.trim();
    const normalizedName = dto.name?.trim();

    const conditions: Prisma.ClientWhereInput[] = [];

    if (normalizedInn) {
      conditions.push({ inn: normalizedInn });
    }

    if (normalizedPhone) {
      conditions.push({
        OR: [
          { phone: normalizedPhone },
          { contacts: { some: { phone: normalizedPhone } } },
        ],
      });
    }

    if (normalizedEmail) {
      conditions.push({
        OR: [
          { email: normalizedEmail },
          { contacts: { some: { email: normalizedEmail } } },
        ],
      });
    }

    if (normalizedName) {
      conditions.push({
        name: { contains: normalizedName },
      });
    }

    if (conditions.length === 0) {
      return [];
    }

    const clients = await this.prisma.client.findMany({
      where: {
        deletedAt: null,
        OR: conditions,
      },
      select: {
        id: true,
        type: true,
        name: true,
        inn: true,
        phone: true,
        email: true,
        ownerId: true,
        status: true,
        contacts: {
          select: {
            phone: true,
            email: true,
          },
        },
      },
      take: 20,
      orderBy: { createdAt: 'desc' },
    });

    return clients.map((client) => {
      const reasons = this.getDuplicateReasons(client, {
        inn: normalizedInn,
        phone: normalizedPhone,
        email: normalizedEmail,
        name: normalizedName,
      });

      return {
        client: this.toDuplicateClientView(client, user),
        reasons,
      };
    });
  }

  async create(dto: CreateClientDto, user: CurrentUser): Promise<Client> {
    const ownerId = user.id;
    const normalizedDto = this.normalizeCreateClientDto(dto);
    const duplicates = await this.checkDuplicates(
      {
        inn: normalizedDto.inn,
        phone: normalizedDto.phone,
        email: normalizedDto.email,
        name: normalizedDto.name,
      },
      user,
    );
    const exactDuplicates = duplicates.filter((duplicate) =>
      duplicate.reasons.some(
        (reason) => reason === 'MATCH_INN' || reason === 'MATCH_PHONE',
      ),
    );

    if (exactDuplicates.length > 0) {
      throw new ConflictException({
        message: 'Client duplicate detected',
        duplicates: exactDuplicates,
      });
    }

    return this.prisma.$transaction(async (tx) =>
      tx.client.create({
        data: {
          type: normalizedDto.type,
          name: normalizedDto.name,
          inn: normalizedDto.inn,
          phone: normalizedDto.phone,
          email: normalizedDto.email,
          status: normalizedDto.status,
          segment: normalizedDto.segment,
          region: normalizedDto.region,
          address: normalizedDto.address,
          source: normalizedDto.source,
          comment: normalizedDto.comment,
          ownerId,
          contacts: {
            create: normalizedDto.contacts?.map((contact) =>
              this.mapContactCreateInput(contact),
            ),
          },
        },
        include: {
          contacts: true,
          projectObjects: true,
        },
      }),
    );
  }

  async findAll(
    filterDto: FilterClientDto,
    currentUserId: string,
    userPermissions: string[],
  ): Promise<ClientListResult> {
    const page = filterDto.page ?? 1;
    const limit = filterDto.limit ?? 20;
    const where = this.buildClientWhere(
      filterDto,
      currentUserId,
      userPermissions,
    );

    const [items, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: clientOwnerInclude,
      }),
      this.prisma.client.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(id: string, currentUserId: string, permissions: string[]) {
    const client = await this.prisma.client.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        ...clientOwnerInclude,
        contacts: true,
        projectObjects: {
          include: this.projectObjectProductsInclude(),
        },
        deals: true,
        leads: true,
      },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    this.assertClientAccess(client, currentUserId, permissions);

    return client;
  }

  async update(
    id: string,
    dto: UpdateClientDto,
    currentUserId: string,
    permissions: string[],
  ): Promise<Client> {
    await this.assertClientAccessById(id, currentUserId, permissions);
    const normalizedDto = this.normalizeUpdateClientDto(dto);

    return this.prisma.client.update({
      where: { id },
      data: {
        type: normalizedDto.type,
        name: normalizedDto.name,
        inn: normalizedDto.inn,
        phone: normalizedDto.phone,
        email: normalizedDto.email,
        status: normalizedDto.status,
        segment: normalizedDto.segment,
        region: normalizedDto.region,
        address: normalizedDto.address,
        source: normalizedDto.source,
        comment: normalizedDto.comment,
      },
    });
  }

  async addContact(
    clientId: string,
    dto: CreateContactDto,
    currentUserId: string,
    permissions: string[],
  ) {
    await this.assertClientAccessById(clientId, currentUserId, permissions);

    return this.prisma.contact.create({
      data: {
        clientId,
        ...this.mapContactCreateInput(this.normalizeContactDto(dto)),
      },
    });
  }

  async addObject(
    clientId: string,
    dto: CreateProjectObjectDto,
    currentUserId: string,
    permissions: string[],
  ) {
    await this.assertClientAccessById(clientId, currentUserId, permissions);

    return this.prisma.projectObject.create({
      data: {
        clientId,
        name: dto.name,
        address: dto.address,
        type: dto.type,
        stage: dto.stage,
        approximateArea: dto.approximateArea,
        expectedDate: dto.expectedDate,
        decisionMakerContactId: dto.decisionMakerContactId,
      },
    });
  }

  async softDelete(
    id: string,
    currentUserId: string,
    permissions: string[],
  ): Promise<Client> {
    await this.assertClientAccessById(id, currentUserId, permissions);

    const now = new Date();
    const openLeadStatuses: LeadStatus[] = [
      LeadStatus.NEW,
      LeadStatus.IN_PROGRESS,
      LeadStatus.QUALIFIED,
    ];

    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.update({
        where: { id },
        data: { deletedAt: now },
      });

      const relatedLeads = await tx.lead.findMany({
        where: { clientId: id, deletedAt: null },
        select: { id: true },
      });
      const relatedDeals = await tx.deal.findMany({
        where: { clientId: id, deletedAt: null },
        select: { id: true },
      });
      const leadIds = relatedLeads.map((lead) => lead.id);
      const dealIds = relatedDeals.map((deal) => deal.id);

      const taskScope: Prisma.TaskWhereInput[] = [
        { relatedType: 'Client', relatedId: id },
      ];
      if (leadIds.length > 0) {
        taskScope.push({ relatedType: 'Lead', relatedId: { in: leadIds } });
      }
      if (dealIds.length > 0) {
        taskScope.push({ relatedType: 'Deal', relatedId: { in: dealIds } });
      }

      // Tasks have no clientId/cancelledAt: cancel open rows via relatedType.
      await tx.task.updateMany({
        where: {
          completedAt: null,
          status: { notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED] },
          OR: taskScope,
        },
        data: { status: TaskStatus.CANCELLED },
      });

      // Leads use status (not stage) and have no closedAt.
      await tx.lead.updateMany({
        where: {
          clientId: id,
          deletedAt: null,
          status: { in: openLeadStatuses },
        },
        data: {
          status: LeadStatus.UNQUALIFIED,
          unqualificationReason: 'Client deleted',
        },
      });

      // Deals have no closedAt; WON/LOST are the terminal stages.
      await tx.deal.updateMany({
        where: {
          clientId: id,
          deletedAt: null,
          stage: { notIn: [DealStage.WON, DealStage.LOST] },
        },
        data: {
          stage: DealStage.LOST,
          lossReason: 'Client deleted',
        },
      });

      await tx.calculationSession.updateMany({
        where: { clientId: id, deletedAt: null },
        data: { deletedAt: now },
      });

      // TODO: do not release stock reservations automatically — requires inventory review

      return client;
    });
  }

  private buildClientWhere(
    filterDto: FilterClientDto,
    currentUserId: string,
    userPermissions: string[],
  ): Prisma.ClientWhereInput {
    const canReadAllClients = userPermissions.includes(
      READ_ALL_CLIENTS_PERMISSION,
    );

    return {
      deletedAt: null,
      status: filterDto.status,
      segment: filterDto.segment,
      region: filterDto.region,
      ownerId: canReadAllClients ? filterDto.ownerId : currentUserId,
      OR: filterDto.search
        ? [
            { name: { contains: filterDto.search } },
            { inn: { contains: filterDto.search } },
            { phone: { contains: normalizePhone(filterDto.search) } },
            { email: { contains: filterDto.search } },
            {
              contacts: {
                some: {
                  OR: [
                    {
                      firstName: {
                        contains: filterDto.search,
                      },
                    },
                    {
                      lastName: {
                        contains: filterDto.search,
                      },
                    },
                    { phone: { contains: normalizePhone(filterDto.search) } },
                    {
                      email: {
                        contains: filterDto.search,
                      },
                    },
                  ],
                },
              },
            },
            {
              projectObjects: {
                some: {
                  name: { contains: filterDto.search },
                },
              },
            },
          ]
        : undefined,
    };
  }

  private getDuplicateReasons(
    client: DuplicateClient & {
      contacts: { phone: string | null; email: string | null }[];
    },
    search: {
      inn?: string;
      phone?: string;
      email?: string;
      name?: string;
    },
  ): DuplicateMatchReason[] {
    const reasons: DuplicateMatchReason[] = [];

    if (search.inn && client.inn === search.inn) {
      reasons.push('MATCH_INN');
    }

    if (
      search.phone &&
      (client.phone === search.phone ||
        client.contacts.some((contact) => contact.phone === search.phone))
    ) {
      reasons.push('MATCH_PHONE');
    }

    if (
      search.email &&
      (client.email === search.email ||
        client.contacts.some((contact) => contact.email === search.email))
    ) {
      reasons.push('MATCH_EMAIL');
    }

    if (
      search.name &&
      client.name.toLowerCase().includes(search.name.toLowerCase())
    ) {
      reasons.push('MATCH_NAME');
    }

    return reasons;
  }

  private normalizeCreateClientDto(dto: CreateClientDto): CreateClientDto {
    return {
      ...dto,
      inn: dto.inn?.trim(),
      phone: dto.phone ? normalizePhone(dto.phone) : undefined,
      email: dto.email?.toLowerCase().trim(),
      name: dto.name.trim(),
      contacts: dto.contacts?.map((contact) =>
        this.normalizeContactDto(contact),
      ),
    };
  }

  private normalizeContactDto(dto: CreateContactDto): CreateContactDto {
    return {
      ...dto,
      firstName: dto.firstName.trim(),
      lastName: dto.lastName?.trim(),
      phone: dto.phone ? normalizePhone(dto.phone) : undefined,
      email: dto.email?.toLowerCase().trim(),
    };
  }

  private normalizeUpdateClientDto(dto: UpdateClientDto): UpdateClientDto {
    return {
      ...dto,
      inn: dto.inn?.trim(),
      phone: dto.phone ? normalizePhone(dto.phone) : undefined,
      email: dto.email?.toLowerCase().trim(),
      name: dto.name?.trim(),
      contacts: dto.contacts?.map((contact) =>
        this.normalizeContactDto(contact),
      ),
    };
  }

  private mapContactCreateInput(
    dto: CreateContactDto,
  ): Prisma.ContactCreateWithoutClientInput {
    return {
      firstName: dto.firstName,
      lastName: dto.lastName,
      position: dto.position,
      phone: dto.phone,
      email: dto.email,
      isPrimary: dto.isPrimary ?? false,
    };
  }

  private projectObjectProductsInclude(): Prisma.ProjectObjectInclude {
    return {
      products: {
        where: { deletedAt: null },
        select: {
          id: true,
          sku: true,
          name: true,
          decorCode: true,
          colorName: true,
          surface: true,
          thickness: true,
          status: true,
          brand: { select: { id: true, name: true } },
          collection: { select: { id: true, name: true } },
        },
      },
    };
  }

  private toDuplicateClientView(
    client: DuplicateClient,
    user: CurrentUser,
  ): DuplicateClient {
    if (this.canAccessClientRecord(client, user.id, user.permissions)) {
      return {
        id: client.id,
        type: client.type,
        name: client.name,
        inn: client.inn,
        phone: client.phone,
        email: client.email,
        ownerId: client.ownerId,
        status: client.status,
      };
    }

    return {
      id: client.id,
      type: client.type,
      name: client.name,
      inn: null,
      phone: null,
      email: null,
      ownerId: client.ownerId,
      status: client.status,
    };
  }

  private canAccessClientRecord(
    client: Pick<Client, 'ownerId'>,
    currentUserId: string,
    permissions: string[],
  ): boolean {
    return (
      permissions.includes(READ_ALL_CLIENTS_PERMISSION) ||
      client.ownerId === currentUserId
    );
  }

  private assertClientAccess(
    client: Pick<Client, 'ownerId'>,
    currentUserId: string,
    permissions: string[],
  ): void {
    if (this.canAccessClientRecord(client, currentUserId, permissions)) {
      return;
    }

    throw new ForbiddenException('Access to this client is forbidden');
  }

  private async assertClientAccessById(
    clientId: string,
    currentUserId: string,
    permissions: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = await (tx ?? this.prisma).client.findFirst({
      where: { id: clientId, deletedAt: null },
      select: { ownerId: true },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    this.assertClientAccess(client, currentUserId, permissions);
  }

  private async ensureClientExists(clientId: string): Promise<void> {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, deletedAt: null },
      select: { id: true },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }
  }
}
