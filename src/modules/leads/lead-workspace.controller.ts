import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PurchasePriceInterceptor } from '../../common/interceptors/purchase-price.interceptor';
import type { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LeadWorkspaceService } from './lead-workspace.service';

@ApiTags('leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(PurchasePriceInterceptor)
@Controller('leads')
export class LeadWorkspaceController {
  constructor(private readonly leadWorkspaceService: LeadWorkspaceService) {}

  @Get(':id/execution')
  @RequirePermissions('leads:read')
  @ApiOperation({
    summary: 'Accepted quote execution handoff for this lead',
  })
  getExecution(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadWorkspaceService.getExecution(id, user);
  }

  @Get(':id/workspace')
  @RequirePermissions('leads:read')
  @ApiOperation({ summary: 'Lead workspace for manager calculator UI' })
  getWorkspace(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadWorkspaceService.getWorkspace(id, user);
  }
}
