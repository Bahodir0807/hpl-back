import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { AssignLeadDto } from './dto/assign-lead.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { DisqualifyLeadDto } from './dto/disqualify-lead.dto';
import { FilterLeadDto } from './dto/filter-lead.dto';
import { QualifyLeadDto } from './dto/qualify-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { LeadsService } from './leads.service';

@ApiTags('Leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  @RequirePermissions('leads:create')
  @ApiOperation({ summary: 'Create lead and first-contact task' })
  @ApiResponse({ status: 201, description: 'Lead created' })
  create(@Body() dto: CreateLeadDto, @CurrentUser() user: CurrentUserType) {
    return this.leadsService.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('leads:read')
  @ApiOperation({ summary: 'List leads with filters and pagination' })
  @ApiResponse({ status: 200, description: 'Lead list returned' })
  findAll(
    @Query() filterDto: FilterLeadDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadsService.findAll(filterDto, user.id, user.permissions);
  }

  @Get(':id')
  @RequirePermissions('leads:read')
  @ApiOperation({ summary: 'Get lead card with assignment history' })
  @ApiResponse({ status: 200, description: 'Lead card returned' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.leadsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('leads:update')
  @ApiOperation({ summary: 'Update lead fields' })
  @ApiResponse({ status: 200, description: 'Lead updated' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLeadDto) {
    return this.leadsService.update(id, dto);
  }

  @Post(':id/qualify')
  @RequirePermissions('leads:qualify')
  @ApiOperation({ summary: 'Qualify and convert lead to deal' })
  @ApiResponse({ status: 201, description: 'Lead converted to deal' })
  @ApiResponse({ status: 400, description: 'Qualification fields missing' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  qualify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QualifyLeadDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadsService.qualify(id, dto, user.id);
  }

  @Post(':id/disqualify')
  @RequirePermissions('leads:update')
  @ApiOperation({ summary: 'Disqualify lead with reason' })
  @ApiResponse({ status: 201, description: 'Lead disqualified' })
  @ApiResponse({ status: 400, description: 'Reason is required' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  disqualify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DisqualifyLeadDto,
  ) {
    return this.leadsService.disqualify(id, dto);
  }

  @Post(':id/assign')
  @RequirePermissions('leads:assign')
  @ApiOperation({ summary: 'Assign lead owner' })
  @ApiResponse({ status: 201, description: 'Lead owner changed' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignLeadDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadsService.assign(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('leads:delete')
  @ApiOperation({ summary: 'Soft delete lead' })
  @ApiResponse({ status: 200, description: 'Lead soft deleted' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  softDelete(@Param('id', ParseUUIDPipe) id: string) {
    return this.leadsService.softDelete(id);
  }
}
