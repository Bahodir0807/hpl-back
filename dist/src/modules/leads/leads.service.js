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
exports.LeadsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const FIRST_CONTACT_SLA_MS = 2 * 60 * 60 * 1000;
const READ_ALL_LEADS_PERMISSION = 'leads:read_all';
let LeadsService = class LeadsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto, currentUserId) {
        const ownerId = dto.ownerId ?? currentUserId;
        const now = new Date();
        const dueDate = new Date(now.getTime() + FIRST_CONTACT_SLA_MS);
        return this.prisma.$transaction(async (tx) => {
            const lead = await tx.lead.create({
                data: {
                    title: dto.title,
                    source: dto.source,
                    ownerId,
                    clientId: dto.clientId,
                    contactId: dto.contactId,
                    needDescription: dto.needDescription,
                    estimatedAmount: dto.estimatedAmount,
                    targetDate: dto.targetDate,
                    projectObjectId: dto.projectObjectId,
                    decisionMakerContact: dto.decisionMakerContact,
                },
            });
            await tx.task.create({
                data: {
                    title: `First contact: ${lead.title}`,
                    type: client_1.TaskType.FIRST_CONTACT,
                    priority: client_1.TaskPriority.HIGH,
                    dueDate,
                    originalDueDate: dueDate,
                    assigneeId: lead.ownerId,
                    createdById: currentUserId,
                    relatedType: 'Lead',
                    relatedId: lead.id,
                },
            });
            return lead;
        });
    }
    async findAll(filterDto, currentUserId, permissions) {
        const page = filterDto.page ?? 1;
        const limit = filterDto.limit ?? 20;
        const where = this.buildLeadWhere(filterDto, currentUserId, permissions);
        const [items, total] = await this.prisma.$transaction([
            this.prisma.lead.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.prisma.lead.count({ where }),
        ]);
        return { items, total, page, limit };
    }
    async findOne(id) {
        const lead = await this.prisma.lead.findFirst({
            where: { id, deletedAt: null },
            include: {
                owner: true,
                client: true,
                projectObject: true,
                contact: true,
                deal: true,
                assignmentHistory: {
                    include: {
                        previousOwner: true,
                        newOwner: true,
                        assignedBy: true,
                    },
                    orderBy: { createdAt: 'desc' },
                },
            },
        });
        if (!lead) {
            throw new common_1.NotFoundException('Lead not found');
        }
        return lead;
    }
    async update(id, dto) {
        await this.ensureLeadExists(id);
        return this.prisma.lead.update({
            where: { id },
            data: {
                title: dto.title,
                source: dto.source,
                ownerId: dto.ownerId,
                clientId: dto.clientId,
                contactId: dto.contactId,
                needDescription: dto.needDescription,
                estimatedAmount: dto.estimatedAmount,
                targetDate: dto.targetDate,
                projectObjectId: dto.projectObjectId,
                decisionMakerContact: dto.decisionMakerContact,
            },
        });
    }
    async qualify(id, dto, currentUserId) {
        const lead = await this.ensureLeadExists(id);
        const qualificationData = {
            clientId: dto.clientId,
            projectObjectId: dto.projectObjectId,
            needDescription: dto.needDescription,
            estimatedAmount: dto.estimatedAmount,
            targetDate: dto.targetDate,
            decisionMakerContact: dto.decisionMakerContact,
        };
        this.assertQualificationComplete(qualificationData);
        const dueDate = new Date(Date.now() + FIRST_CONTACT_SLA_MS);
        return this.prisma.$transaction(async (tx) => {
            const deal = await tx.deal.create({
                data: {
                    title: lead.title,
                    clientId: dto.clientId,
                    projectObjectId: dto.projectObjectId,
                    ownerId: lead.ownerId,
                    stage: client_1.DealStage.QUALIFICATION,
                    totalAmount: dto.estimatedAmount,
                    expectedCloseDate: dto.targetDate,
                    nextActionAt: dueDate,
                },
            });
            await tx.task.create({
                data: {
                    title: `First deal action: ${deal.title}`,
                    type: client_1.TaskType.FIRST_CONTACT,
                    priority: client_1.TaskPriority.HIGH,
                    dueDate,
                    originalDueDate: dueDate,
                    assigneeId: lead.ownerId,
                    createdById: currentUserId,
                    relatedType: 'Deal',
                    relatedId: deal.id,
                },
            });
            return tx.lead.update({
                where: { id },
                data: {
                    clientId: dto.clientId,
                    projectObjectId: dto.projectObjectId,
                    needDescription: dto.needDescription,
                    estimatedAmount: dto.estimatedAmount,
                    targetDate: dto.targetDate,
                    decisionMakerContact: dto.decisionMakerContact,
                    status: client_1.LeadStatus.CONVERTED,
                    dealId: deal.id,
                },
            });
        });
    }
    async disqualify(id, dto) {
        const reason = dto.reason.trim();
        if (!reason) {
            throw new common_1.BadRequestException('unqualificationReason is required');
        }
        await this.ensureLeadExists(id);
        return this.prisma.lead.update({
            where: { id },
            data: {
                status: client_1.LeadStatus.UNQUALIFIED,
                unqualificationReason: reason,
            },
        });
    }
    async assign(id, dto, currentUserId) {
        const lead = await this.ensureLeadExists(id);
        if (lead.ownerId === dto.newOwnerId) {
            return lead;
        }
        return this.prisma.$transaction(async (tx) => {
            const updatedLead = await tx.lead.update({
                where: { id },
                data: { ownerId: dto.newOwnerId },
            });
            await tx.leadAssignmentHistory.create({
                data: {
                    leadId: id,
                    previousOwnerId: lead.ownerId,
                    newOwnerId: dto.newOwnerId,
                    assignedById: currentUserId,
                },
            });
            return updatedLead;
        });
    }
    async softDelete(id) {
        await this.ensureLeadExists(id);
        return this.prisma.lead.update({
            where: { id },
            data: { deletedAt: new Date() },
        });
    }
    buildLeadWhere(filterDto, currentUserId, permissions) {
        const canReadAllLeads = permissions.includes(READ_ALL_LEADS_PERMISSION);
        return {
            deletedAt: null,
            status: filterDto.status,
            source: filterDto.source,
            ownerId: canReadAllLeads
                ? filterDto.ownerId
                : (filterDto.ownerId ?? currentUserId),
            OR: filterDto.search
                ? [
                    { title: { contains: filterDto.search, mode: 'insensitive' } },
                    { source: { contains: filterDto.search, mode: 'insensitive' } },
                    {
                        needDescription: {
                            contains: filterDto.search,
                            mode: 'insensitive',
                        },
                    },
                    {
                        client: {
                            name: { contains: filterDto.search, mode: 'insensitive' },
                        },
                    },
                ]
                : undefined,
        };
    }
    assertQualificationComplete(data) {
        const missingFields = [];
        if (!data.clientId) {
            missingFields.push('clientId');
        }
        if (!data.projectObjectId) {
            missingFields.push('projectObjectId');
        }
        if (!data.needDescription?.trim()) {
            missingFields.push('needDescription');
        }
        if (!data.estimatedAmount) {
            missingFields.push('estimatedAmount');
        }
        if (!data.targetDate) {
            missingFields.push('targetDate');
        }
        if (!data.decisionMakerContact?.trim()) {
            missingFields.push('decisionMakerContact');
        }
        if (missingFields.length > 0) {
            throw new common_1.BadRequestException({
                message: 'Lead qualification fields are incomplete',
                missingFields,
            });
        }
    }
    async ensureLeadExists(id) {
        const lead = await this.prisma.lead.findFirst({
            where: { id, deletedAt: null },
        });
        if (!lead) {
            throw new common_1.NotFoundException('Lead not found');
        }
        return lead;
    }
};
exports.LeadsService = LeadsService;
exports.LeadsService = LeadsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], LeadsService);
//# sourceMappingURL=leads.service.js.map