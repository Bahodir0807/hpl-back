import { RoleName } from '@prisma/client';
export declare class RegisterUserDto {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
    teamId?: string;
    managerId?: string;
    roleNames: RoleName[];
}
