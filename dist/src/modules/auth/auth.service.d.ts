import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
type AuthTokens = {
    accessToken: string;
    refreshToken: string;
};
export declare class AuthService {
    private readonly jwtService;
    private readonly prisma;
    private readonly usersService;
    constructor(jwtService: JwtService, prisma: PrismaService, usersService: UsersService);
    login(dto: LoginDto, ip: string | undefined, userAgent: string | undefined): Promise<AuthTokens>;
    refreshTokens(refreshToken: string): Promise<AuthTokens>;
    logout(userId: string, token: string): Promise<void>;
    private createTokens;
    private verifyRefreshToken;
    private getRefreshTokenExpiresAt;
    private getJwtSecret;
}
export {};
