import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { CreatePanelColorDto } from '../dto/create-panel-color.dto';
import { FilterPanelColorsDto } from '../dto/filter-panel-colors.dto';
import { UpdatePanelColorDto } from '../dto/update-panel-color.dto';
import { PanelColorsService } from '../services/panel-colors.service';

@ApiTags('panel-colors')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('panel-colors')
export class PanelColorsController {
  constructor(private readonly panelColorsService: PanelColorsService) {}

  @Post()
  @HttpCode(201)
  @RequirePermissions('panel_catalog:manage')
  @ApiOperation({ summary: 'Create panel color entry' })
  create(
    @Body() dto: CreatePanelColorDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.panelColorsService.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('panel_catalog:manage')
  @ApiOperation({ summary: 'Update panel color name or code' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePanelColorDto,
  ) {
    return this.panelColorsService.update(id, dto);
  }

  @Get()
  @RequirePermissions('panel_catalog:read')
  @ApiOperation({ summary: 'Search panel colors' })
  @ApiQuery({ name: 'supplierId', required: false })
  @ApiQuery({ name: 'search', required: false })
  findAll(@Query() filter: FilterPanelColorsDto) {
    return this.panelColorsService.findAll(filter);
  }
}
