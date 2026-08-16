import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuditService } from './audit.service';

@ApiTags('Audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('timeline/:relatedType/:relatedId')
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Get activity timeline for CRM entity' })
  @ApiResponse({ status: 200, description: 'Activity timeline returned' })
  getTimeline(
    @Param('relatedType') relatedType: string,
    @Param('relatedId', ParseUUIDPipe) relatedId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.auditService.getTimeline(relatedType, relatedId, user);
  }
}
