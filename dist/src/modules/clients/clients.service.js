"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientsService = void 0;
const common_1 = require("@nestjs/common");
const phone_normalizer_1 = require("../../common/utils/phone-normalizer");
const prisma_service_1 = require("../prisma/prisma.service");
const READ_ALL_CLIENTS_PERMISSION = 'clients:read_all';
let ClientsService = class ClientsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async checkDuplicates(dto) {
        const normalizedPhone = dto.phone ? (0, phone_normalizer_1.normalizePhone)(dto.phone) : undefined;
        const normalizedEmail = dto.email?.toLowerCase().trim();
        const normalizedInn = dto.inn?.trim();
        const normalizedName = dto.name?.trim();
        const conditions = [];
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
    async create(dto, ownerId) {
        const normalizedDto = this.normalizeCreateClientDto(dto);
        const duplicates = await this.checkDuplicates({
            inn: normalizedDto.inn,
            phone: normalizedDto.phone,
            email: normalizedDto.email,
            name: normalizedDto.name,
        });
        const exactDuplicates = duplicates.filter((duplicate) => duplicate.reasons.some((reason) => reason === 'MATCH_INN' || reason === 'MATCH_PHONE'));
        if (exactDuplicates.length > 0) {
            throw new common_1.ConflictException({
                message: 'Client duplicate detected',
                duplicates: exactDuplicates,
            });
        }
        return this.prisma.$transaction(async (tx) => tx.client.create({
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
                    create: normalizedDto.contacts?.map((contact) => this.mapContactCreateInput(contact)),
                },
            },
            include: {
                contacts: true,
                projectObjects: true,
            },
        }));
    }
    async findAll(filterDto, currentUserId, userPermissions) {
        const page = filterDto.page ?? 1;
        const limit = filterDto.limit ?? 20;
        const where = this.buildClientWhere(filterDto, currentUserId, userPermissions);
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
    async findOne(id) {
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
            throw new common_1.NotFoundException('Client not found');
        }
        return client;
    }
    async update(id, dto) {
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
    async addContact(clientId, dto) {
        await this.ensureClientExists(clientId);
        return this.prisma.contact.create({
            data: {
                clientId,
                ...this.mapContactCreateInput(this.normalizeContactDto(dto)),
            },
        });
    }
    async addObject(clientId, dto) {
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
    async softDelete(id) {
        await this.ensureClientExists(id);
        return this.prisma.client.update({
            where: { id },
            data: { deletedAt: new Date() },
        });
    }
    buildClientWhere(filterDto, currentUserId, userPermissions) {
        const canReadAllClients = userPermissions.includes(READ_ALL_CLIENTS_PERMISSION);
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
                    { phone: { contains: (0, phone_normalizer_1.normalizePhone)(filterDto.search) } },
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
                                    { phone: { contains: (0, phone_normalizer_1.normalizePhone)(filterDto.search) } },
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
    getDuplicateReasons(client, search) {
        const reasons = [];
        if (search.inn && client.inn === search.inn) {
            reasons.push('MATCH_INN');
        }
        if (search.phone &&
            (client.phone === search.phone ||
                client.contacts.some((contact) => contact.phone === search.phone))) {
            reasons.push('MATCH_PHONE');
        }
        if (search.email &&
            (client.email === search.email ||
                client.contacts.some((contact) => contact.email === search.email))) {
            reasons.push('MATCH_EMAIL');
        }
        if (search.name &&
            client.name.toLowerCase().includes(search.name.toLowerCase())) {
            reasons.push('MATCH_NAME');
        }
        return reasons;
    }
    normalizeCreateClientDto(dto) {
        return {
            ...dto,
            inn: dto.inn?.trim(),
            phone: dto.phone ? (0, phone_normalizer_1.normalizePhone)(dto.phone) : undefined,
            email: dto.email?.toLowerCase().trim(),
            name: dto.name.trim(),
            contacts: dto.contacts?.map((contact) => this.normalizeContactDto(contact)),
        };
    }
    normalizeContactDto(dto) {
        return {
            ...dto,
            firstName: dto.firstName.trim(),
            lastName: dto.lastName?.trim(),
            phone: dto.phone ? (0, phone_normalizer_1.normalizePhone)(dto.phone) : undefined,
            email: dto.email?.toLowerCase().trim(),
        };
    }
    normalizeUpdateClientDto(dto) {
        return {
            ...dto,
            inn: dto.inn?.trim(),
            phone: dto.phone ? (0, phone_normalizer_1.normalizePhone)(dto.phone) : undefined,
            email: dto.email?.toLowerCase().trim(),
            name: dto.name?.trim(),
            contacts: dto.contacts?.map((contact) => this.normalizeContactDto(contact)),
        };
    }
    mapContactCreateInput(dto) {
        return {
            firstName: dto.firstName,
            lastName: dto.lastName,
            position: dto.position,
            phone: dto.phone,
            email: dto.email,
            isPrimary: dto.isPrimary ?? false,
        };
    }
    async ensureClientExists(clientId) {
        const client = await this.prisma.client.findFirst({
            where: { id: clientId, deletedAt: null },
            select: { id: true },
        });
        if (!client) {
            throw new common_1.NotFoundException('Client not found');
        }
    }
};
exports.ClientsService = ClientsService;
exports.ClientsService = ClientsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ClientsService);
//# sourceMappingURL=clients.service.js.map