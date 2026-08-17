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
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { PurchasePriceInterceptor } from '../common/interceptors/purchase-price.interceptor';
import type { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { FilterQuotesDto } from './dto/filter-quotes.dto';
import { UpdateQuoteStatusDto } from './dto/update-quote-status.dto';
import { QUOTE_PERMISSIONS } from './quote.constants';
import { QuotesService } from './quotes.service';

@ApiTags('quotes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(PurchasePriceInterceptor)
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Get()
  @RequirePermissions(QUOTE_PERMISSIONS.READ)
  @ApiOperation({ summary: 'List panel quotes' })
  findAll(
    @Query() filter: FilterQuotesDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.quotesService.findAll(filter, user);
  }

  @Get(':id')
  @RequirePermissions(QUOTE_PERMISSIONS.READ)
  @ApiOperation({ summary: 'Get panel quote by id' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.quotesService.findOne(id, user);
  }

  @Patch(':id/status')
  @RequirePermissions(QUOTE_PERMISSIONS.UPDATE)
  @ApiOperation({
    summary: 'Update quote status (FSM). Approval requires quotes:approve',
  })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuoteStatusDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.quotesService.updateStatus(id, dto, user);
  }

  @Post(':id/client-accept')
  @HttpCode(200)
  @RequirePermissions(QUOTE_PERMISSIONS.CLIENT_ACCEPT)
  @ApiOperation({
    summary:
      'Record that the customer accepted this internally approved Quote',
  })
  recordClientAcceptance(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.quotesService.recordClientAcceptance(id, user);
  }

  @Post(':id/convert-to-deal')
  @HttpCode(201)
  @RequirePermissions(QUOTE_PERMISSIONS.UPDATE)
  @ApiOperation({ summary: 'Convert approved quote to deal' })
  convertToDeal(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.quotesService.convertToDeal(id, user);
  }
}
