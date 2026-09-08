import {
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BusinessException } from '../common/exceptions/business.exception';
import { PrismaService } from '../modules/prisma/prisma.service';
import {
  buildQuoteDocumentModel,
  quoteCustomerDocumentIssues,
  PRODUCTION_REQUIRED_MESSAGE,
  DELIVERY_REQUIRED_MESSAGE,
  QUOTE_COMMERCIAL_TERMS_INCOMPLETE,
} from './quote-document.model';
import {
  fillUzhplQuoteTemplate,
  loadUzhplQuoteTemplate,
} from './quote-docx-template';
import { convertDocxToPdf } from './quote-pdf-converter';
import { QUOTE_PRICE_NOT_APPROVED } from './quote.constants';
import {
  ensureFileStorage,
  fileStoragePath,
} from '../modules/files/file-storage';

@Injectable()
export class QuoteDocumentService implements OnModuleInit {
  private readonly logger = new Logger(QuoteDocumentService.name);
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await ensureFileStorage();
    } catch (error) {
      this.logger.error(`Quote storage is unavailable: ${fileStoragePath()}`);
      throw error;
    }
  }

  async generate(
    quoteId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const stored = await this.readStoredPdf(quoteId);
    if (stored) {
      // Finalized Quotes keep the PDF created at finalize. Historical files are
      // not rewritten. New Quotes / new versions persist a new File row.
      return stored;
    }

    const quote = await this.prisma.panelQuote.findUnique({
      where: { id: quoteId },
      select: { status: true, finalizedAt: true, pdfFileId: true },
    });
    if (quote?.status === 'converted' && !quote.pdfFileId) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'QUOTE_LEGACY_DOCUMENT_MISSING',
        'Документ отсутствует (legacy)',
      );
    }

    const document = await this.generateDocx(quoteId);
    return {
      buffer: await convertDocxToPdf(document.buffer),
      filename: document.filename.replace(/\.docx$/i, '.pdf'),
    };
  }

  async persistFinalPdf(
    quoteId: string,
    uploadedById: string,
  ): Promise<{ fileId: string; filename: string; created: boolean }> {
    const existing = await this.prisma.panelQuote.findUnique({
      where: { id: quoteId },
      select: { pdfFileId: true },
    });
    if (existing?.pdfFileId) {
      return {
        fileId: existing.pdfFileId,
        filename: `quote-${quoteId}.pdf`,
        created: false,
      };
    }

    const document = await this.generateDocx(quoteId);
    const buffer = await convertDocxToPdf(document.buffer);
    const storageKey = `${randomUUID()}.pdf`;
    const storageDirectory = await ensureFileStorage();
    await writeFile(join(storageDirectory, storageKey), buffer);
    let file: { id: string; originalName: string };
    try {
      file = await this.prisma.file.create({
        data: {
          originalName: document.filename.replace(/\.docx$/i, '.pdf'),
          mimeType: 'application/pdf',
          size: buffer.length,
          storageKey,
          uploadedById,
          relatedType: 'QUOTE',
          relatedId: quoteId,
        },
      });
    } catch (error) {
      await unlink(join(storageDirectory, storageKey)).catch(() => undefined);
      throw error;
    }

    return { fileId: file.id, filename: file.originalName, created: true };
  }

  async cleanupUncommittedFinalPdf(fileId: string): Promise<void> {
    const referenced = await this.prisma.panelQuote.findFirst({
      where: { pdfFileId: fileId },
      select: { id: true },
    });
    if (referenced) return;
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      select: { storageKey: true },
    });
    if (!file) return;
    await this.prisma.file.delete({ where: { id: fileId } });
    await unlink(join(fileStoragePath(), file.storageKey)).catch((error) => {
      this.logger.error(
        `Failed to remove orphan Quote PDF ${file.storageKey}`,
        error,
      );
    });
  }

  async generateDocx(
    quoteId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const quote = await this.loadQuoteSnapshot(quoteId);
    if (quote.status === 'converted' && !quote.pdfFileId) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'QUOTE_LEGACY_DOCUMENT_MISSING',
        'Документ отсутствует (legacy)',
      );
    }
    this.assertReadyForCustomerDocument(quote);
    const buffer = await fillUzhplQuoteTemplate(
      loadUzhplQuoteTemplate(),
      buildQuoteDocumentModel(quote),
    );

    return {
      buffer,
      filename: `quote-${quote.id}.docx`,
    };
  }

  private async readStoredPdf(
    quoteId: string,
  ): Promise<{ buffer: Buffer; filename: string } | null> {
    const quote = await this.prisma.panelQuote.findUnique({
      where: { id: quoteId },
      select: { id: true, pdfFileId: true },
    });
    if (!quote?.pdfFileId) {
      return null;
    }

    const file = await this.prisma.file.findUnique({
      where: { id: quote.pdfFileId },
      select: { storageKey: true },
    });
    if (!file) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'QUOTE_PDF_FILE_MISSING',
        'Сохранённый PDF коммерческого предложения не найден',
      );
    }

    let buffer: Buffer;
    try {
      buffer = await readFile(join(fileStoragePath(), file.storageKey));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new BusinessException(
          HttpStatus.NOT_FOUND,
          'QUOTE_PDF_FILE_MISSING',
          'Файл PDF коммерческого предложения отсутствует в хранилище',
        );
      }
      throw error;
    }
    return { buffer, filename: `quote-${quote.id}.pdf` };
  }

  private assertReadyForCustomerDocument(quote: {
    productionDaysFrom?: number | null;
    productionDaysTo?: number | null;
    deliveryDaysFrom?: number | null;
    deliveryDaysTo?: number | null;
    productionTerms?: string | null;
    deliveryTerms?: string | null;
    items?: Array<{ priceApprovedAt?: Date | null }>;
  }): void {
    const issues = quoteCustomerDocumentIssues(quote);
    if (issues.length > 0) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        QUOTE_COMMERCIAL_TERMS_INCOMPLETE,
        issues.join('. '),
        {
          productionComplete: !issues.includes(PRODUCTION_REQUIRED_MESSAGE),
          deliveryComplete: !issues.includes(DELIVERY_REQUIRED_MESSAGE),
        },
      );
    }

    if (
      !quote.items?.length ||
      quote.items.some((item) => !item.priceApprovedAt)
    ) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        QUOTE_PRICE_NOT_APPROVED,
        'Клиентский документ формируется только после утверждения цены и валюты руководителем',
      );
    }
  }

  private async loadQuoteSnapshot(quoteId: string) {
    const quote = await this.prisma.panelQuote.findUnique({
      where: { id: quoteId },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        lead: {
          select: {
            title: true,
            client: { select: { name: true } },
          },
        },
      },
    });
    if (!quote) throw new NotFoundException('Quote not found');
    return quote;
  }
}
