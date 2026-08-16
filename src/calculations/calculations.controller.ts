import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { PurchasePriceInterceptor } from '../common/interceptors/purchase-price.interceptor';
import type { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { CALCULATION_PERMISSIONS } from './calculation.constants';
import { CalculationService } from './calculations.service';
import { ConvertCalculationToQuoteDto } from '../quotes/dto/convert-calculation-to-quote.dto';
import { QUOTE_PERMISSIONS } from '../quotes/quote.constants';
import { QuotesService } from '../quotes/quotes.service';
import { CreateCalculationDto } from './dto/create-calculation.dto';
import { PreviewCalculationDto } from './dto/calculation-item.dto';
import { FilterCalculationsDto } from './dto/filter-calculations.dto';
import { UpdateCalculationDto } from './dto/update-calculation.dto';

@ApiTags('calculations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(PurchasePriceInterceptor)
@Controller('calculations')
export class CalculationsController {
  constructor(
    private readonly calculationService: CalculationService,
    private readonly quotesService: QuotesService,
  ) {}

  @Post()
  @HttpCode(201)
  @RequirePermissions(CALCULATION_PERMISSIONS.CREATE)
  @ApiOperation({ summary: 'Create calculation session with line items' })
  @ApiResponse({ status: 201, description: 'Calculation created' })
  create(
    @Body() dto: CreateCalculationDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.calculationService.create(dto, user);
  }

  @Post('preview')
  @RequirePermissions(CALCULATION_PERMISSIONS.CREATE)
  @ApiOperation({ summary: 'Preview calculation for one line item without saving' })
  preview(@Body() dto: PreviewCalculationDto) {
    return this.calculationService.preview(dto);
  }

  @Get()
  @RequirePermissions(CALCULATION_PERMISSIONS.READ)
  @ApiOperation({ summary: 'List calculation sessions' })
  findAll(
    @Query() filter: FilterCalculationsDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.calculationService.findAll(filter, user);
  }

  @Get(':id')
  @RequirePermissions(CALCULATION_PERMISSIONS.READ)
  @ApiOperation({ summary: 'Get calculation session' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.calculationService.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermissions(CALCULATION_PERMISSIONS.UPDATE)
  @ApiOperation({ summary: 'Update draft calculation' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCalculationDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.calculationService.update(id, dto, user);
  }

  @Post(':id/finalize')
  @RequirePermissions(CALCULATION_PERMISSIONS.UPDATE)
  @ApiOperation({ summary: 'Finalize calculation (draft → finalized)' })
  finalize(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.calculationService.finalize(id, user);
  }

  @Post(':id/convert-to-quote')
  @HttpCode(201)
  @RequirePermissions(QUOTE_PERMISSIONS.CREATE)
  @ApiOperation({ summary: 'Create panel quote from finalized calculation' })
  convertToQuote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvertCalculationToQuoteDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.quotesService.createFromCalculation(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions(CALCULATION_PERMISSIONS.DELETE)
  @ApiOperation({ summary: 'Soft delete calculation' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.calculationService.softDelete(id, user);
  }
}
