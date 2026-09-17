import { ForbiddenException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { INSTALLATION_ASSESS_PERMISSION } from './deal-fulfillment.constants';
import { InstallationsController } from './installations.controller';

describe('InstallationsController', () => {
  const head = {
    id: 'head-id',
    email: 'head@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.HEAD],
    permissions: [INSTALLATION_ASSESS_PERMISSION],
  };

  it('lists jobs through the installation service, not Deal list', async () => {
    const dealInstallationService = {
      list: jest
        .fn()
        .mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
      getById: jest.fn(),
    };
    const controller = new InstallationsController(
      dealInstallationService as never,
    );

    await controller.list({ requiringAction: true }, head);

    expect(dealInstallationService.list).toHaveBeenCalledWith(
      { requiringAction: true },
      head,
    );
  });

  it('resolves notification relatedId via getById', async () => {
    const dealInstallationService = {
      list: jest.fn(),
      getById: jest.fn().mockResolvedValue({ id: 'job-id', dealId: 'deal-id' }),
    };
    const controller = new InstallationsController(
      dealInstallationService as never,
    );

    await expect(controller.getById('job-id', head as never)).resolves.toEqual({
      id: 'job-id',
      dealId: 'deal-id',
    });
    expect(dealInstallationService.getById).toHaveBeenCalledWith(
      'job-id',
      head,
    );
  });

  it('propagates authorization failures from the installation service', async () => {
    const dealInstallationService = {
      list: jest.fn().mockRejectedValue(new ForbiddenException()),
      getById: jest.fn(),
    };
    const controller = new InstallationsController(
      dealInstallationService as never,
    );

    await expect(
      controller.list({}, { ...head, roles: [RoleName.MANAGER] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
