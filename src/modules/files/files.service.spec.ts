import { NotFoundException } from '@nestjs/common';
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import { FilesService } from './files.service';

jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn(),
}));

describe('FilesService object access', () => {
  const manager: CurrentUser = {
    id: 'manager-a',
    email: 'manager-a@example.com',
    teamId: null,
    managerId: null,
    roles: ['MANAGER'],
    permissions: ['files:read', 'quotes:read'],
  };

  it('returns the same 404 class for an existing foreign file', async () => {
    const prisma = {
      file: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'file-id',
          relatedType: 'QUOTE',
          relatedId: 'foreign-quote-id',
          storageKey: 'foreign.pdf',
        }),
      },
      panelQuote: {
        findUnique: jest.fn().mockResolvedValue({ managerId: 'manager-b' }),
      },
    };
    const service = new FilesService(prisma as never);

    await expect(
      service.getDownloadTarget('file-id', manager),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
