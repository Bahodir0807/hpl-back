import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FilterUserDto } from './dto/filter-user.dto';
import { RegisterUserDto } from './dto/register-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @RequirePermissions('users:create')
  @ApiOperation({ summary: 'Create employee user' })
  create(@Body() dto: RegisterUserDto, @CurrentUser() user: CurrentUserType) {
    this.usersService.assertUserModuleAccess(user);
    return this.usersService.create(dto, user);
  }

  @Get()
  @RequirePermissions('users:read')
  @ApiOperation({ summary: 'List employee users' })
  findAll(
    @Query() filterDto: FilterUserDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    this.usersService.assertUserModuleAccess(user);
    return this.usersService.findAll(filterDto);
  }

  @Get(':id')
  @RequirePermissions('users:read')
  @ApiOperation({ summary: 'Get employee user card' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    this.usersService.assertUserModuleAccess(currentUser);
    const user = await this.usersService.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  @Patch(':id/status')
  @RequirePermissions('users:manage')
  @ApiOperation({ summary: 'Activate or block employee user' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    this.usersService.assertUserModuleAccess(user);
    return this.usersService.updateStatus(id, dto.isActive);
  }

  @Patch(':id/reset-password')
  @RequirePermissions('users:write')
  @ApiOperation({ summary: 'Reset employee user password' })
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    this.usersService.assertUserModuleAccess(user);
    return this.usersService.resetPassword(id, dto.newPassword, user.id);
  }
}
