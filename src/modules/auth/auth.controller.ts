import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'User login' })
  login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ) {
    return this.authService.login(dto, ip, userAgent);
  }

  @Public()
  @Post('refresh')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Refresh access and refresh tokens' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @Post('logout')
  @RequirePermissions('auth:me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout current user session' })
  async logout(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: RefreshTokenDto,
  ): Promise<{ success: true }> {
    await this.authService.logout(user.id, dto.refreshToken);
    return { success: true };
  }

  @Get('me')
  @SkipThrottle()
  @RequirePermissions('auth:me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile and permissions' })
  me(@CurrentUser() user: CurrentUserType): CurrentUserType {
    return user;
  }
}
