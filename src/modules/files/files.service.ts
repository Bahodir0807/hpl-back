import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { File } from '@prisma/client';
import { fileTypeFromBuffer } from 'file-type';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { FileRelatedType, UploadFileDto } from './dto/upload-file.dto';

const UPLOADS_DIR = resolve(process.cwd(), 'uploads');
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// Расширение берём из whitelist mime → ext, а не из originalname (path traversal)
export const ALLOWED_MIME_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

const READ_ALL_PERMISSIONS: Partial<Record<FileRelatedType, string>> = {
  [FileRelatedType.CLIENT]: 'clients:read_all',
  [FileRelatedType.DEAL]: 'deals:read_all',
  [FileRelatedType.ORDER]: 'deals:read_all',
  [FileRelatedType.TASK]: 'tasks:read_all',
};

export type UploadedFileResult = {
  id: string;
  url: string;
  originalName: string;
  mimeType: string;
  size: number;
};

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async upload(
    file: Express.Multer.File,
    dto: UploadFileDto,
    user: CurrentUser,
  ): Promise<UploadedFileResult> {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    await this.assertRelatedAccess(dto.relatedType, dto.relatedId, user);

    const detectedType = await fileTypeFromBuffer(file.buffer);
    if (
      !detectedType ||
      !this.isAllowedFileContent(detectedType.mime, file.mimetype)
    ) {
      throw new BadRequestException('Invalid file content or corrupt file');
    }

    const extension = ALLOWED_MIME_TYPES[file.mimetype];
    if (!extension) {
      throw new BadRequestException(`Invalid file type: ${file.mimetype}`);
    }

    const storageKey = `${randomUUID()}${extension}`;
    await mkdir(UPLOADS_DIR, { recursive: true });
    await writeFile(join(UPLOADS_DIR, storageKey), file.buffer);

    const record = await this.prisma.file.create({
      data: {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        storageKey,
        uploadedById: user.id,
        relatedType: dto.relatedType,
        relatedId: dto.relatedId,
        comment: dto.comment,
      },
    });

    return {
      id: record.id,
      url: `/files/${record.id}`,
      originalName: record.originalName,
      mimeType: record.mimeType,
      size: record.size,
    };
  }

  async listForEntity(
    relatedType: FileRelatedType,
    relatedId: string,
    user: CurrentUser,
  ): Promise<UploadedFileResult[]> {
    await this.assertRelatedAccess(relatedType, relatedId, user);

    const records = await this.prisma.file.findMany({
      where: { relatedType, relatedId },
      orderBy: { createdAt: 'desc' },
    });

    return records.map((record) => ({
      id: record.id,
      url: `/files/${record.id}`,
      originalName: record.originalName,
      mimeType: record.mimeType,
      size: record.size,
    }));
  }

  async getDownloadTarget(
    fileId: string,
    user: CurrentUser,
  ): Promise<{ record: File; absolutePath: string }> {
    const record = await this.prisma.file.findUnique({ where: { id: fileId } });

    if (!record) {
      throw new NotFoundException('File not found');
    }

    await this.assertRelatedAccess(
      record.relatedType as FileRelatedType,
      record.relatedId,
      user,
    );

    return {
      record,
      absolutePath: join(UPLOADS_DIR, record.storageKey),
    };
  }

  private isAllowedFileContent(
    detectedMime: string,
    declaredMime: string,
  ): boolean {
    if (!ALLOWED_MIME_TYPES[declaredMime]) {
      return false;
    }

    if (detectedMime === declaredMime) {
      return true;
    }

    // OOXML (xlsx) — ZIP-контейнер; file-type определяет как application/zip
    return (
      declaredMime ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' &&
      detectedMime === 'application/zip'
    );
  }

  private async assertRelatedAccess(
    relatedType: FileRelatedType,
    relatedId: string,
    user: CurrentUser,
  ): Promise<void> {
    const readAllPermission = READ_ALL_PERMISSIONS[relatedType];
    if (readAllPermission && user.permissions.includes(readAllPermission)) {
      return;
    }

    const ownerId = await this.resolveOwnerId(relatedType, relatedId, user);

    if (ownerId === null) {
      throw new NotFoundException(`${relatedType} not found`);
    }

    // '' — общедоступная сущность (каталог товаров)
    if (ownerId !== '' && ownerId !== user.id) {
      throw new ForbiddenException('Access denied to related entity');
    }
  }

  // null — сущность не найдена; '' — сущность общедоступна (каталог товаров)
  private async resolveOwnerId(
    relatedType: FileRelatedType,
    relatedId: string,
    user: CurrentUser,
  ): Promise<string | null> {
    switch (relatedType) {
      case FileRelatedType.CLIENT: {
        const client = await this.prisma.client.findFirst({
          where: { id: relatedId, deletedAt: null },
          select: { ownerId: true },
        });
        return client?.ownerId ?? null;
      }
      case FileRelatedType.DEAL: {
        const deal = await this.prisma.deal.findFirst({
          where: { id: relatedId, deletedAt: null },
          select: { ownerId: true },
        });
        return deal?.ownerId ?? null;
      }
      case FileRelatedType.ORDER: {
        const order = await this.prisma.order.findFirst({
          where: { id: relatedId, deletedAt: null },
          select: { deal: { select: { ownerId: true } } },
        });
        return order?.deal.ownerId ?? null;
      }
      case FileRelatedType.TASK: {
        const task = await this.prisma.task.findUnique({
          where: { id: relatedId },
          select: { assigneeId: true, createdById: true },
        });

        if (!task) {
          return null;
        }

        if (task.assigneeId === user.id || task.createdById === user.id) {
          return user.id;
        }

        return task.assigneeId;
      }
      case FileRelatedType.PRODUCT: {
        const product = await this.prisma.product.findFirst({
          where: { id: relatedId, deletedAt: null },
          select: { id: true },
        });
        // Каталог товаров общий для всех менеджеров
        return product ? '' : null;
      }
    }
  }
}
