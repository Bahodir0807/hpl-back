import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { LoseOpportunityDto } from '../../common/dto/lose-opportunity.dto';
import type { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { DealLossService } from './deal-loss.service';

@ApiTags('Deals')
@ApiBearerAuth()
@Controller('deals')
export class DealLossController {
  constructor(private readonly dealLossService: DealLossService) {}

  @Post(':id/lose')
  @HttpCode(200)
  @RequirePermissions('deals:update')
  @ApiOperation({
    summary: 'Close a converted opportunity with a structured loss reason',
  })
  lose(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LoseOpportunityDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.dealLossService.lose(id, dto, user);
  }
}
