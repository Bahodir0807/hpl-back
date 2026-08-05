import { ClientSegment, ClientStatus, ClientType } from '@prisma/client';
import { CreateContactDto } from './create-contact.dto';
export declare class CreateClientDto {
    type: ClientType;
    name: string;
    inn?: string;
    phone?: string;
    email?: string;
    status?: ClientStatus;
    segment?: ClientSegment;
    region?: string;
    address?: string;
    source?: string;
    comment?: string;
    contacts?: CreateContactDto[];
}
