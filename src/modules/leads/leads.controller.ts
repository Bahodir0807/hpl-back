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
import { LoseOpportunityDto } from '../../common/dto/lose-opportunity.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AssignLeadDto } from './dto/assign-lead.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { CreateLeadNoteDto } from './dto/create-lead-note.dto';
import { DisqualifyLeadDto } from './dto/disqualify-lead.dto';
import { FilterLeadDto } from './dto/filter-lead.dto';
import { QualifyLeadDto } from './dto/qualify-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { UpdateLeadManagerCommercialNoteDto } from './dto/update-lead-manager-commercial-note.dto';
import { UpsertLeadCommercialQualificationDto } from './dto/upsert-lead-commercial-qualification.dto';
import { UpsertLeadQualificationDto } from './dto/upsert-lead-qualification.dto';
import {
  LEADS_COMMERCIAL_QUALIFY_PERMISSION,
  MANAGER_COMMERCIAL_NOTE_PERMISSION,
} from './lead.constants';
import { LeadCommercialQualificationService } from './lead-commercial-qualification.service';
import { LeadManagerCommercialNoteService } from './lead-manager-commercial-note.service';
import { LeadQualificationService } from './lead-qualification.service';
import { LeadsService } from './leads.service';

@ApiTags('Leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly leadQualificationService: LeadQualificationService,
    private readonly leadCommercialQualificationService: LeadCommercialQualificationService,
    private readonly leadManagerCommercialNoteService: LeadManagerCommercialNoteService,
  ) {}

  @Post()
  @RequirePermissions('leads:create')
  @ApiOperation({ summary: 'Create lead and first-contact task' })
  @ApiResponse({ status: 201, description: 'Lead created' })
  create(@Body() dto: CreateLeadDto, @CurrentUser() user: CurrentUserType) {
    return this.leadsService.create(dto, user.id, user.permissions);
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
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadsService.findOne(id, user.id, user.permissions);
  }

  @Get(':id/qualification')
  @RequirePermissions('leads:read')
  @ApiOperation({ summary: 'Get Stage-1 HPL qualification for a lead' })
  @ApiResponse({ status: 200, description: 'Qualification returned' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  getQualification(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadQualificationService.get(id, user.id, user.permissions);
  }

  @Patch(':id/qualification')
  @RequirePermissions('leads:update')
  @ApiOperation({
    summary: 'Save Stage-1 HPL customer-need qualification (partial allowed)',
  })
  @ApiResponse({ status: 200, description: 'Qualification saved' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  upsertQualification(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertLeadQualificationDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadQualificationService.upsert(
      id,
      dto,
      user.id,
      user.permissions,
    );
  }

  @Get(':id/commercial-qualification')
  @RequirePermissions('leads:read')
  @ApiOperation({
    summary: 'Get Stage-2 HEAD commercial qualification for a lead',
  })
  @ApiResponse({
    status: 200,
    description: 'Commercial qualification returned',
  })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  getCommercialQualification(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadCommercialQualificationService.get(
      id,
      user.id,
      user.permissions,
    );
  }

  @Post(':id/commercial-qualification')
  @RequirePermissions(LEADS_COMMERCIAL_QUALIFY_PERMISSION)
  @ApiOperation({
    summary:
      'Confirm Stage-2 commercial qualification (HEAD). Does not create a Deal.',
  })
  @ApiResponse({
    status: 201,
    description: 'Commercial qualification confirmed; Lead stays QUALIFIED',
  })
  @ApiResponse({ status: 400, description: 'Invalid supplier/quality mapping' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient commercial authority',
  })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  @ApiResponse({
    status: 409,
    description: 'Lead is not Stage-1 QUALIFIED or is terminal',
  })
  confirmCommercialQualification(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertLeadCommercialQualificationDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadCommercialQualificationService.confirm(
      id,
      dto,
      user.id,
      user.permissions,
    );
  }

  @Patch(':id/manager-commercial-note')
  @RequirePermissions(MANAGER_COMMERCIAL_NOTE_PERMISSION)
  @ApiOperation({
    summary:
      'Save MANAGER-owned customer note (Примечание / пожелания клиента). Does not hand off to HEAD.',
  })
  @ApiResponse({ status: 200, description: 'Manager note saved' })
  @ApiResponse({
    status: 403,
    description: 'HEAD/DIRECTOR/ADMIN cannot mutate',
  })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  updateManagerCommercialNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadManagerCommercialNoteDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadManagerCommercialNoteService.updateNote(id, dto, user);
  }

  @Post(':id/handoff-to-head')
  @RequirePermissions(MANAGER_COMMERCIAL_NOTE_PERMISSION)
  @ApiOperation({
    summary:
      'MANAGER finished customer-side input and hands the case to HEAD for КП preparation',
  })
  @ApiResponse({
    status: 201,
    description: 'Handoff recorded; active HEAD users notified',
  })
  @ApiResponse({ status: 403, description: 'Only MANAGER can hand off' })
  @ApiResponse({
    status: 409,
    description: 'Lead is not Stage-1 QUALIFIED or is terminal',
  })
  handoffToHead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadManagerCommercialNoteService.handoffToHead(id, user);
  }

  @Patch(':id')
  @RequirePermissions('leads:update')
  @ApiOperation({ summary: 'Update lead fields' })
  @ApiResponse({ status: 200, description: 'Lead updated' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadsService.update(id, dto, user.id, user.permissions);
  }

  @Post(':id/qualify')
  @RequirePermissions('leads:qualify')
  @ApiOperation({
    summary:
      'Complete Stage-1 qualification: Lead becomes QUALIFIED, no Deal is created',
  })
  @ApiResponse({
    status: 201,
    description: 'Lead status is QUALIFIED; dealId remains null',
  })
  @ApiResponse({ status: 400, description: 'Qualification fields missing' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  @ApiResponse({
    status: 409,
    description: 'Lead is unqualified or already converted',
  })
  qualify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QualifyLeadDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadsService.qualify(id, dto, user.id, user.permissions);
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
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadsService.disqualify(id, dto, user.id, user.permissions);
  }

  @Post(':id/lose')
  @RequirePermissions('leads:update')
  @ApiOperation({
    summary: 'Close a pre-Deal opportunity with a structured loss reason',
  })
  lose(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LoseOpportunityDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadsService.lose(id, dto, user.id, user.permissions);
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
    return this.leadsService.assign(id, dto, user.id, user.permissions);
  }

  @Post(':id/calls')
  @RequirePermissions('leads:update')
  @ApiOperation({ summary: 'Log outbound call and return tel: URI' })
  @ApiResponse({ status: 201, description: 'Call activity created' })
  createCall(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadsService.createCall(id, user.id, user.permissions);
  }

  @Post(':id/notes')
  @RequirePermissions('leads:update')
  @ApiOperation({ summary: 'Add a note to the lead timeline' })
  @ApiResponse({ status: 201, description: 'Note created' })
  createNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateLeadNoteDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadsService.createNote(id, dto, user.id, user.permissions);
  }

  @Delete(':id')
  @RequirePermissions('leads:delete')
  @ApiOperation({ summary: 'Soft delete lead' })
  @ApiResponse({ status: 200, description: 'Lead soft deleted' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  softDelete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadsService.softDelete(id, user.id, user.permissions);
  }
}
