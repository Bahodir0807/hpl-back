import { AppController } from './app.controller';

describe('AppController', () => {
  it('delegates health check to HealthCheckService with prisma ping', async () => {
    const expected = {
      status: 'ok',
      details: { prisma: { status: 'up' } },
    };
    const health = { check: jest.fn().mockResolvedValue(expected) };
    const prismaHealth = { pingCheck: jest.fn() };
    const prisma = {};
    const controller = new AppController(
      health as never,
      prismaHealth as never,
      prisma as never,
    );

    await expect(controller.check()).resolves.toEqual(expected);
    expect(health.check).toHaveBeenCalledTimes(1);
  });
});
