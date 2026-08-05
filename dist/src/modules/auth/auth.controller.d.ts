import type { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    login(dto: LoginDto, ip: string, userAgent: string | undefined): Promise<{
        accessToken: string;
        refreshToken: string;
    }>;
    refresh(dto: RefreshTokenDto): Promise<{
        accessToken: string;
        refreshToken: string;
    }>;
    logout(user: CurrentUserType, dto: RefreshTokenDto): Promise<{
        success: true;
    }>;
    me(user: CurrentUserType): CurrentUserType;
}
