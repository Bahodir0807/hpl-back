import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Client, Prisma } from '@prisma/client';
import { normalizePhone } from '../../common/utils/phone-normalizer';
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

type ClientListResult = {
  items: Client[];
  total: number;
  page: number;
  limit: number;
};

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async checkDuplicates(
    dto: CheckDuplicatesDto,
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
        name: { contains: normalizedName, mode: 'insensitive' },
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
        client: {
          id: client.id,
          type: client.type,
          name: client.name,
          inn: client.inn,
          phone: client.phone,
          email: client.email,
          ownerId: client.ownerId,
          status: client.status,
        },
        reasons,
      };
    });
  }

  async create(dto: CreateClientDto, ownerId: string): Promise<Client> {
    const normalizedDto = this.normalizeCreateClientDto(dto);
    const duplicates = await this.checkDuplicates({
      inn: normalizedDto.inn,
      phone: normalizedDto.phone,
      email: normalizedDto.email,
      name: normalizedDto.name,
    });
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
      }),
      this.prisma.client.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(id: string) {
    const client = await this.prisma.client.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        contacts: true,
        projectObjects: true,
        deals: true,
        leads: true,
      },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    return client;
  }

  async update(id: string, dto: UpdateClientDto): Promise<Client> {
    await this.ensureClientExists(id);
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

  async addContact(clientId: string, dto: CreateContactDto) {
    await this.ensureClientExists(clientId);

    return this.prisma.contact.create({
      data: {
        clientId,
        ...this.mapContactCreateInput(this.normalizeContactDto(dto)),
      },
    });
  }

  async addObject(clientId: string, dto: CreateProjectObjectDto) {
    await this.ensureClientExists(clientId);

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

  async softDelete(id: string): Promise<Client> {
    await this.ensureClientExists(id);

    return this.prisma.client.update({
      where: { id },
      data: { deletedAt: new Date() },
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
      ownerId: canReadAllClients
        ? filterDto.ownerId
        : (filterDto.ownerId ?? currentUserId),
      OR: filterDto.search
        ? [
            { name: { contains: filterDto.search, mode: 'insensitive' } },
            { inn: { contains: filterDto.search, mode: 'insensitive' } },
            { phone: { contains: normalizePhone(filterDto.search) } },
            { email: { contains: filterDto.search, mode: 'insensitive' } },
            {
              contacts: {
                some: {
                  OR: [
                    {
                      firstName: {
                        contains: filterDto.search,
                        mode: 'insensitive',
                      },
                    },
                    {
                      lastName: {
                        contains: filterDto.search,
                        mode: 'insensitive',
                      },
                    },
                    { phone: { contains: normalizePhone(filterDto.search) } },
                    {
                      email: {
                        contains: filterDto.search,
                        mode: 'insensitive',
                      },
                    },
                  ],
                },
              },
            },
            {
              projectObjects: {
                some: {
                  name: { contains: filterDto.search, mode: 'insensitive' },
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
