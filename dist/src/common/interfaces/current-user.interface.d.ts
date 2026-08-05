import { RoleName } from '@prisma/client';
export interface CurrentUser {
    id: string;
    email: string;
    teamId: string | null;
    managerId: string | null;
    roles: RoleName[];
    permissions: string[];
}
