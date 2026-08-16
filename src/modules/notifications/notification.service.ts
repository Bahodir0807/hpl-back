import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { FilterNotificationsDto } from './dto/filter-notifications.dto';

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private transporter: Transporter | null = null;
  private readonly smtpFrom: string;
  private warnedAboutMissingSmtp = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const host = this.configService.get<string>('SMTP_HOST');
    this.smtpFrom =
      this.configService.get<string>('SMTP_FROM') ??
      'HPL CRM <no-reply@hpl-crm.local>';

    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: this.configService.get<number>('SMTP_PORT') ?? 587,
        secure: this.configService.get<number>('SMTP_PORT') === 465,
        auth: this.configService.get<string>('SMTP_USER')
          ? {
              user: this.configService.get<string>('SMTP_USER') as string,
              pass: this.configService.get<string>('SMTP_PASS'),
            }
          : undefined,
      });
    }
  }

  async findInbox(userId: string, filter: FilterNotificationsDto) {
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 20;
    const where = { userId };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async markRead(id: string, userId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.isRead) {
      return notification;
    }

    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
  }

  // Fire-and-forget: ошибки SMTP не должны ломать бизнес-операцию
  sendEmail(message: EmailMessage): void {
    void this.sendEmailSafe(message);
  }

  private async sendEmailSafe(message: EmailMessage): Promise<void> {
    if (!this.transporter) {
      if (!this.warnedAboutMissingSmtp) {
        this.warnedAboutMissingSmtp = true;
        this.logger.warn(
          'SMTP is not configured (SMTP_HOST missing) — emails are skipped',
        );
      }
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.smtpFrom,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send email to ${message.to}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
