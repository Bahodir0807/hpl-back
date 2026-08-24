import { HttpStatus, Injectable } from '@nestjs/common';
import { ActivityType, LeadStatus, Prisma, RoleName } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import { canWriteQuoteCommercialNote } from '../../quotes/quote.constants';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateLeadManagerCommercialNoteDto } from './dto/update-lead-manager-commercial-note.dto';
import {
  MANAGER_COMMERCIAL_HANDOFF_NOTIFICATION_TYPE,
  MANAGER_COMMERCIAL_HANDOFF_TITLE,
  READ_ALL_LEADS_PERMISSION,
} from './lead.constants';

const leadNoteSelect = {
  id: true,
  title: true,
  status: true,
  ownerId: true,
  dealId: true,
  deletedAt: true,
  managerCommercialNote: true,
  managerCommercialNoteUpdatedAt: true,
  managerCommercialInputReadyAt: true,
  managerCommercialInputReadyById: true,
  client: { select: { id: true, name: true } },
  projectObject: { select: { id: true, name: true } },
} satisfies Prisma.LeadSelect;

type LeadNoteRecord = Prisma.LeadGetPayload<{ select: typeof leadNoteSelect }>;

export type ManagerCommercialNoteView = {
  leadId: string;
  commercialNote: string | null;
  managerCommercialNoteUpdatedAt: Date | null;
  managerCommercialInputReadyAt: Date | null;
  managerCommercialInputReadyById: string | null;
};

@Injectable()
export class LeadManagerCommercialNoteService {
  constructor(private readonly prisma: PrismaService) {}

  async updateNote(
    leadId: string,
    dto: UpdateLeadManagerCommercialNoteDto,
    user: CurrentUser,
  ): Promise<ManagerCommercialNoteView> {
    this.assertManagerNoteWriteAccess(user);

    const lead = await this.loadLead(leadId);
    this.assertLeadAccess(lead, user);
    this.assertLeadMutableForManagerNote(lead);

    const note = dto.commercialNote.trim() || null;
    const updatedAt = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.lead.update({
        where: { id: lead.id },
        data: {
          managerCommercialNote: note,
          managerCommercialNoteUpdatedAt: updatedAt,
        },
        select: leadNoteSelect,
      });

      await tx.activity.create({
        data: {
          type: ActivityType.NOTE,
          relatedType: 'Lead',
          relatedId: lead.id,
          authorId: user.id,
          content: 'Manager commercial note saved',
          metadata: {
            action: 'lead_manager_commercial_note_saved',
          },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'LEAD_MANAGER_COMMERCIAL_NOTE_SAVED',
          entityType: 'Lead',
          entityId: lead.id,
          oldValue: {
            managerCommercialNote: lead.managerCommercialNote,
            managerCommercialNoteUpdatedAt: lead.managerCommercialNoteUpdatedAt,
          },
          newValue: {
            managerCommercialNote: next.managerCommercialNote,
            managerCommercialNoteUpdatedAt: next.managerCommercialNoteUpdatedAt,
          },
        },
      });

      return next;
    });

    return this.toView(updated);
  }

  async handoffToHead(
    leadId: string,
    user: CurrentUser,
  ): Promise<ManagerCommercialNoteView> {
    this.assertManagerNoteWriteAccess(user);

    const lead = await this.loadLead(leadId);
    this.assertLeadAccess(lead, user);
    this.assertLeadEligibleForHandoff(lead);

    if (lead.managerCommercialInputReadyAt) {
      return this.toView(lead);
    }

    const readyAt = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.lead.update({
        where: { id: lead.id },
        data: {
          managerCommercialInputReadyAt: readyAt,
          managerCommercialInputReadyById: user.id,
        },
        select: leadNoteSelect,
      });

      await tx.activity.create({
        data: {
          type: ActivityType.STATUS_CHANGED,
          relatedType: 'Lead',
          relatedId: lead.id,
          authorId: user.id,
          content: MANAGER_COMMERCIAL_HANDOFF_TITLE,
          metadata: {
            action: 'lead_manager_commercial_handoff',
          },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'LEAD_MANAGER_COMMERCIAL_HANDOFF',
          entityType: 'Lead',
          entityId: lead.id,
          oldValue: {
            managerCommercialInputReadyAt: null,
          },
          newValue: {
            managerCommercialInputReadyAt: readyAt,
            managerCommercialInputReadyById: user.id,
          },
        },
      });

      const heads = await tx.user.findMany({
        where: {
          isActive: true,
          roles: { some: { role: { name: RoleName.HEAD } } },
        },
        select: { id: true },
      });

      if (heads.length > 0) {
        await tx.notification.createMany({
          data: heads.map((head) => ({
            userId: head.id,
            title: MANAGER_COMMERCIAL_HANDOFF_TITLE,
            message: this.handoffMessage(next),
            type: MANAGER_COMMERCIAL_HANDOFF_NOTIFICATION_TYPE,
            relatedType: 'Lead',
            relatedId: lead.id,
          })),
        });
      }

      return next;
    });

    return this.toView(updated);
  }

  private async loadLead(leadId: string): Promise<LeadNoteRecord> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, deletedAt: null },
      select: leadNoteSelect,
    });

    if (!lead) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'LEAD_NOT_FOUND',
        'Лид не найден',
      );
    }

    return lead;
  }

  private assertManagerNoteWriteAccess(user: CurrentUser): void {
    if (canWriteQuoteCommercialNote(user.permissions)) {
      return;
    }

    throw new BusinessException(
      HttpStatus.FORBIDDEN,
      'MANAGER_COMMERCIAL_NOTE_FORBIDDEN',
      'Примечание менеджера может редактировать только менеджер',
    );
  }

  private assertLeadAccess(lead: LeadNoteRecord, user: CurrentUser): void {
    if (user.permissions.includes(READ_ALL_LEADS_PERMISSION)) {
      return;
    }

    if (lead.ownerId === user.id) {
      return;
    }

    throw new BusinessException(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'У вас нет доступа к этому лиду',
    );
  }

  private assertLeadMutableForManagerNote(lead: LeadNoteRecord): void {
    if (lead.status === LeadStatus.CONVERTED) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'LEAD_MANAGER_NOTE_LOCKED',
        'Примечание нельзя менять после конвертации лида',
      );
    }

    if (
      lead.status === LeadStatus.UNQUALIFIED ||
      lead.status === LeadStatus.LOST
    ) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'LEAD_MANAGER_NOTE_LOCKED',
        'Примечание нельзя менять по закрытому лиду',
      );
    }
  }

  private assertLeadEligibleForHandoff(lead: LeadNoteRecord): void {
    this.assertLeadMutableForManagerNote(lead);

    if (lead.status !== LeadStatus.QUALIFIED) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'LEAD_NOT_QUALIFIED',
        'Сначала завершите квалификацию Stage 1, затем передайте данные руководителю',
      );
    }
  }

  private handoffMessage(lead: LeadNoteRecord): string {
    const client = lead.client?.name?.trim();
    const objectName = lead.projectObject?.name?.trim();
    const parts = [`Лид «${lead.title}»`];
    if (client) {
      parts.push(`клиент ${client}`);
    }
    if (objectName) {
      parts.push(`объект ${objectName}`);
    }
    return `${parts.join(' · ')}. Откройте рабочее место лида.`;
  }

  private toView(lead: LeadNoteRecord): ManagerCommercialNoteView {
    return {
      leadId: lead.id,
      commercialNote: lead.managerCommercialNote,
      managerCommercialNoteUpdatedAt: lead.managerCommercialNoteUpdatedAt,
      managerCommercialInputReadyAt: lead.managerCommercialInputReadyAt,
      managerCommercialInputReadyById: lead.managerCommercialInputReadyById,
    };
  }
}
