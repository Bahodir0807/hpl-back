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
import { CheckDuplicatesDto } from './dto/check-duplicates.dto';
import { CreateClientDto } from './dto/create-client.dto';
import { CreateContactDto } from './dto/create-contact.dto';
import { CreateProjectObjectDto } from './dto/create-project-object.dto';
import { FilterClientDto } from './dto/filter-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ClientsService } from './clients.service';

@ApiTags('Clients')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post('check-duplicates')
  @RequirePermissions('clients:read')
  @ApiOperation({ summary: 'Check client data for duplicates' })
  @ApiResponse({ status: 201, description: 'Potential duplicates returned' })
  checkDuplicates(@Body() dto: CheckDuplicatesDto) {
    return this.clientsService.checkDuplicates(dto);
  }

  @Post()
  @RequirePermissions('clients:create')
  @ApiOperation({ summary: 'Create client and primary contacts' })
  @ApiResponse({ status: 201, description: 'Client created' })
  @ApiResponse({ status: 409, description: 'Exact duplicate detected' })
  create(@Body() dto: CreateClientDto, @CurrentUser() user: CurrentUserType) {
    return this.clientsService.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('clients:read')
  @ApiOperation({ summary: 'List clients with filters and pagination' })
  @ApiResponse({ status: 200, description: 'Client list returned' })
  findAll(
    @Query() filterDto: FilterClientDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.clientsService.findAll(filterDto, user.id, user.permissions);
  }

  @Get(':id')
  @RequirePermissions('clients:read')
  @ApiOperation({ summary: 'Get client card with related records' })
  @ApiResponse({ status: 200, description: 'Client card returned' })
  @ApiResponse({ status: 404, description: 'Client not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.clientsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('clients:update')
  @ApiOperation({ summary: 'Update client' })
  @ApiResponse({ status: 200, description: 'Client updated' })
  @ApiResponse({ status: 404, description: 'Client not found' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClientDto) {
    return this.clientsService.update(id, dto);
  }

  @Post(':id/contacts')
  @RequirePermissions('clients:update')
  @ApiOperation({ summary: 'Add contact to client' })
  @ApiResponse({ status: 201, description: 'Contact added' })
  @ApiResponse({ status: 404, description: 'Client not found' })
  addContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateContactDto,
  ) {
    return this.clientsService.addContact(id, dto);
  }

  @Post(':id/objects')
  @RequirePermissions('clients:update')
  @ApiOperation({ summary: 'Add project object to client' })
  @ApiResponse({ status: 201, description: 'Project object added' })
  @ApiResponse({ status: 404, description: 'Client not found' })
  addObject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateProjectObjectDto,
  ) {
    return this.clientsService.addObject(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('clients:delete')
  @ApiOperation({ summary: 'Soft delete client' })
  @ApiResponse({ status: 200, description: 'Client soft deleted' })
  @ApiResponse({ status: 404, description: 'Client not found' })
  softDelete(@Param('id', ParseUUIDPipe) id: string) {
    return this.clientsService.softDelete(id);
  }
}
