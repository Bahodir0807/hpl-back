import { Prisma } from '@prisma/client';
export declare class CreateSupplierDto {
    name: string;
    code: string;
    contacts?: Prisma.InputJsonObject;
}
