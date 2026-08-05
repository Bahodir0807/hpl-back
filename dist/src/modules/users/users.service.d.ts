import { Permission, RoleName, User } from '@prisma/client';
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterUserDto } from './dto/register-user.dto';
type UserWithAuthz = User & {
    roles: {
        role: {
            name: RoleName;
            permissions: {
                permission: Permission;
            }[];
        };
    }[];
    permissions: {
        permission: Permission;
    }[];
};
type SafeUser = Omit<User, 'passwordHash'>;
type AuthUserRecord = {
    id: string;
    email: string;
    teamId: string | null;
    managerId: string | null;
    isActive: boolean;
    roles: {
        role: {
            name: RoleName;
        };
    }[];
};
export declare class UsersService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(dto: RegisterUserDto): Promise<SafeUser>;
    findByEmail(email: string): Promise<UserWithAuthz | null>;
    findById(id: string): Promise<SafeUser | null>;
    findAll(): Promise<SafeUser[]>;
    updateStatus(id: string, isActive: boolean): Promise<SafeUser>;
    resetPassword(id: string, newPassword: string, currentUserId: string): Promise<SafeUser>;
    getAuthContext(userId: string): Promise<CurrentUser | null>;
    findAuthUserById(userId: string): Promise<AuthUserRecord | null>;
    toCurrentUser(user: AuthUserRecord): Promise<CurrentUser>;
    getUserPermissions(userId: string): Promise<string[]>;
    private excludePasswordHash;
}
export {};
