import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FileRelatedType, UploadFileDto } from './dto/upload-file.dto';
import {
  ALLOWED_MIME_TYPES,
  FilesService,
  MAX_FILE_SIZE_BYTES,
} from './files.service';

@ApiTags('Files')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @RequirePermissions('files:upload')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload file (КП, фото HPL, документы отгрузки)' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME_TYPES[file.mimetype]) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(`Invalid file type: ${file.mimetype}`),
            false,
          );
        }
      },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadFileDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.filesService.upload(file, dto, user);
  }

  @Get()
  @RequirePermissions('files:read')
  @ApiOperation({ summary: 'List files attached to an entity' })
  list(
    @Query('relatedType') relatedType: FileRelatedType,
    @Query('relatedId', ParseUUIDPipe) relatedId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.filesService.listForEntity(relatedType, relatedId, user);
  }

  // Отдача только авторизованным с проверкой доступа к связанной сущности —
  // публичный static /uploads открыл бы финансовые документы по прямой ссылке
  @Get(':id/download')
  @RequirePermissions('files:read')
  @ApiOperation({ summary: 'Download file (auth + ownership check)' })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
    @Res() res: Response,
  ): Promise<void> {
    const { record, absolutePath } = await this.filesService.getDownloadTarget(
      id,
      user,
    );

    res.setHeader('Content-Type', record.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(record.originalName)}`,
    );
    res.sendFile(absolutePath);
  }
}
