import { HttpStatus } from '@nestjs/common';
import { LeadStatus, Prisma } from '@prisma/client';
import type { CurrentUser } from '../common/interfaces/current-user.interface';
import { CALCULATION_REQUEST_STATUS } from './calculation.constants';
import { CalculationRequestService } from './calculation-request.service';

describe('CalculationRequestService', () => {
  const manager: CurrentUser = {
    id: 'manager-id',
    email: 'manager@test.com',
    teamId: null,
    managerId: null,
    roles: ['MANAGER'],
    permissions: [
      'calculations:create',
      'calculations:read',
      'calculations:update',
      'leads:read',
    ],
  };

  const head: CurrentUser = {
    id: 'head-id',
    email: 'head@test.com',
    teamId: null,
    managerId: null,
    roles: ['HEAD'],
    permissions: [
      'calculations:create',
      'calculations:read',
      'calculations:read_all',
      'calculations:update',
      'quotes:approve',
      'leads:read_all',
    ],
  };

  const lead = {
    id: 'lead-id',
    ownerId: 'manager-id',
    clientId: 'client-id',
    projectObjectId: null,
    dealId: null,
    status: LeadStatus.QUALIFIED,
    qualification: { application: 'INTERIOR' },
    commercialQualification: null,
  };

  const calculatedItem = {
    panelTypeId: 'type-id',
    panelSizeId: 'size-id',
    thicknessMm: new Prisma.Decimal('10'),
    supplierId: null,
    qualityClassId: 'economy-id',
    colorId: null,
    coating: 'PE',
    texture: null,
    note: 'Client note',
    customTypeDescription: null,
    customWidthMm: null,
    customHeightMm: null,
    requiredAreaM2: new Prisma.Decimal('12'),
    sheetsCount: 4,
    supplierPricePerM2: new Prisma.Decimal('100'),
    clientPricePerM2: new Prisma.Decimal('20'),
    pricePerM2: new Prisma.Decimal('20'),
    pricePerSheet: new Prisma.Decimal('50'),
    totalPrice: new Prisma.Decimal('200'),
    wastePercent: new Prisma.Decimal('5'),
    sortOrder: 0,
    areaM2: new Prisma.Decimal('2.5'),
  };

  const prisma = {
    calculationRequest: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    calculationSession: {
      create: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
    },
    user: { findMany: jest.fn() },
    notification: { createMany: jest.fn() },
    $transaction: jest.fn(),
  };

  const calculationService = {
    guardLeadForCalculationRequest: jest.fn(),
    prepareManagerCatalogGroup: jest.fn(),
  };

  let service: CalculationRequestService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CalculationRequestService(
      prisma as never,
      calculationService as never,
    );
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) =>
        Promise.resolve(callback(prisma)),
    );
    calculationService.guardLeadForCalculationRequest.mockResolvedValue(lead);
    calculationService.prepareManagerCatalogGroup.mockResolvedValue({
      lead,
      cnyUsdRate: new Prisma.Decimal('0.1'),
      calculatedItems: [calculatedItem, { ...calculatedItem, sortOrder: 1 }],
    });
    prisma.calculationRequest.create.mockResolvedValue({
      id: 'request-id',
      status: CALCULATION_REQUEST_STATUS.DRAFT,
    });
    prisma.user.findMany.mockResolvedValue([]);
    prisma.calculationRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'request-id',
      createdById: manager.id,
      status: CALCULATION_REQUEST_STATUS.DRAFT,
      calculations: [{ items: [calculatedItem, calculatedItem] }],
    });
  });

  it('creates a manager request without supplierId', async () => {
    const created = await service.create(
      {
        leadId: 'lead-id',
        notes: 'Client request',
        calculations: [
          {
            title: 'Group 1',
            items: [
              {
                panelTypeId: 'type-id',
                panelSizeId: 'size-id',
                thicknessMm: '10',
                qualityClassId: 'economy-id',
                requiredAreaM2: '12',
              },
              {
                panelTypeId: 'type-id',
                panelSizeId: 'size-id',
                thicknessMm: '8',
                qualityClassId: 'economy-id',
                requiredAreaM2: '6',
              },
            ],
          },
          {
            title: 'Group 2',
            items: [
              {
                panelTypeId: 'type-id',
                panelSizeId: 'size-id',
                thicknessMm: '12',
                qualityClassId: 'premium-id',
                requiredAreaM2: '20',
              },
            ],
          },
        ],
      },
      manager,
    );

    expect(prisma.calculationRequest.create).toHaveBeenCalled();
    expect(prisma.calculationSession.create).toHaveBeenCalledTimes(2);
    const firstGroup = prisma.calculationSession.create.mock.calls[0][0]
      .data as {
      items: { create: unknown[] };
      sortOrder: number;
    };
    expect(firstGroup.sortOrder).toBe(0);
    expect(firstGroup.items.create).toHaveLength(2);
    expect(firstGroup.items.create[0]).toEqual(
      expect.objectContaining({ supplierId: null }),
    );
    expect(created.id).toBe('request-id');
  });

  it('rejects an empty calculations list or empty HPL items', async () => {
    await expect(
      service.create({ leadId: 'lead-id', calculations: [] as never }, manager),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'CALCULATION_REQUEST_EMPTY',
        statusCode: HttpStatus.BAD_REQUEST,
      }),
    });
  });

  it('submits multiple technical calculations without supplier or pricing', async () => {
    prisma.calculationRequest.findFirst.mockResolvedValue({
      id: 'request-id',
      createdById: manager.id,
      status: CALCULATION_REQUEST_STATUS.DRAFT,
      deletedAt: null,
    });
    prisma.calculationRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'request-id',
      createdById: manager.id,
      status: CALCULATION_REQUEST_STATUS.DRAFT,
      calculations: [
        {
          items: [
            {
              id: 'item-1',
              panelTypeId: 'type-id',
              panelSizeId: 'size-id',
              thicknessMm: new Prisma.Decimal('10'),
              supplierId: null,
              qualityClassId: 'economy-id',
              requiredAreaM2: new Prisma.Decimal('12'),
              sheetsCount: 4,
              supplierPricePerM2: new Prisma.Decimal(0),
              totalPrice: new Prisma.Decimal(0),
            },
          ],
        },
        {
          items: [
            {
              id: 'item-2',
              panelTypeId: 'other-type-id',
              customTypeDescription: 'Custom fire-rated request',
              panelSizeId: 'size-id',
              thicknessMm: new Prisma.Decimal('13.5'),
              supplierId: null,
              qualityClassId: 'premium-id',
              requiredAreaM2: new Prisma.Decimal('20'),
              sheetsCount: 7,
              supplierPricePerM2: new Prisma.Decimal(0),
              totalPrice: new Prisma.Decimal(0),
            },
          ],
        },
      ],
    });
    prisma.calculationRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.calculationRequest.findUniqueOrThrow
      .mockResolvedValueOnce({
        id: 'request-id',
        createdById: manager.id,
        status: CALCULATION_REQUEST_STATUS.DRAFT,
        calculations: [
          { items: [{ supplierId: null }] },
          {
            items: [
              {
                supplierId: null,
                panelTypeId: 'other-type-id',
                customTypeDescription: 'Custom fire-rated request',
              },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'request-id',
        createdById: manager.id,
        status: CALCULATION_REQUEST_STATUS.SUBMITTED,
        calculations: [
          { items: [{ supplierId: null }] },
          {
            items: [
              {
                supplierId: null,
                panelTypeId: 'other-type-id',
                customTypeDescription: 'Custom fire-rated request',
              },
            ],
          },
        ],
      });

    const submitted = await service.submit('request-id', manager);

    expect(prisma.calculationRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: CALCULATION_REQUEST_STATUS.SUBMITTED,
          submittedById: manager.id,
        }),
      }),
    );
    expect(prisma.calculationSession.updateMany).toHaveBeenCalledWith({
      where: { requestId: 'request-id', deletedAt: null },
      data: { status: 'finalized' },
    });
    expect(submitted).toEqual(
      expect.objectContaining({
        status: CALCULATION_REQUEST_STATUS.SUBMITTED,
        calculations: expect.arrayContaining([
          expect.objectContaining({
            items: expect.arrayContaining([
              expect.objectContaining({ supplierId: null }),
            ]),
          }),
        ]),
      }),
    );
    expect(
      calculationService.prepareManagerCatalogGroup,
    ).not.toHaveBeenCalled();
    expect(head.permissions).toContain('quotes:approve');
  });

  it('keeps a committed submit successful when notification persistence fails', async () => {
    prisma.calculationRequest.findFirst.mockResolvedValue({
      id: 'request-id',
      createdById: manager.id,
      status: CALCULATION_REQUEST_STATUS.DRAFT,
      deletedAt: null,
    });
    prisma.calculationRequest.findUniqueOrThrow
      .mockResolvedValueOnce({
        id: 'request-id',
        leadId: 'lead-id',
        createdById: manager.id,
        status: CALCULATION_REQUEST_STATUS.DRAFT,
        calculations: [{ items: [{ supplierId: null }] }],
      })
      .mockResolvedValueOnce({
        id: 'request-id',
        leadId: 'lead-id',
        createdById: manager.id,
        status: CALCULATION_REQUEST_STATUS.SUBMITTED,
        calculations: [{ items: [{ supplierId: null }] }],
      });
    prisma.calculationRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findMany.mockRejectedValueOnce(
      new Error('notification db unavailable'),
    );

    await expect(service.submit('request-id', manager)).resolves.toEqual(
      expect.objectContaining({ status: CALCULATION_REQUEST_STATUS.SUBMITTED }),
    );
  });

  it('returns a controlled conflict for a repeated submit', async () => {
    prisma.calculationRequest.findFirst.mockResolvedValue({
      id: 'request-id',
      createdById: manager.id,
      status: CALCULATION_REQUEST_STATUS.SUBMITTED,
      deletedAt: null,
    });
    prisma.calculationRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'request-id',
      createdById: manager.id,
      status: CALCULATION_REQUEST_STATUS.SUBMITTED,
      calculations: [{ items: [{ supplierId: null }] }],
    });

    await expect(service.submit('request-id', manager)).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'CALCULATION_REQUEST_LOCKED',
        statusCode: HttpStatus.CONFLICT,
      }),
    });
    expect(prisma.calculationRequest.updateMany).not.toHaveBeenCalled();
  });

  it('creates a manager request with other and its custom description', async () => {
    calculationService.prepareManagerCatalogGroup.mockResolvedValue({
      lead,
      cnyUsdRate: null,
      calculatedItems: [
        {
          ...calculatedItem,
          panelTypeId: 'other-type-id',
          supplierId: null,
          customTypeDescription: 'Custom fire-rated request',
          supplierPricePerM2: new Prisma.Decimal(0),
          clientPricePerM2: new Prisma.Decimal(0),
          pricePerM2: new Prisma.Decimal(0),
          pricePerSheet: new Prisma.Decimal(0),
          totalPrice: new Prisma.Decimal(0),
        },
      ],
    });

    await service.create(
      {
        leadId: 'lead-id',
        calculations: [
          {
            title: 'Group 1',
            items: [
              {
                panelTypeId: 'other-type-id',
                panelSizeId: 'size-id',
                thicknessMm: '10',
                qualityClassId: 'economy-id',
                requiredAreaM2: '12',
                customTypeDescription: 'Custom fire-rated request',
              },
            ],
          },
        ],
      },
      manager,
    );

    const persistedItems = prisma.calculationSession.create.mock.calls[0][0]
      .data.items.create as Array<{
      panelTypeId: string;
      customTypeDescription: string;
      totalPrice: Prisma.Decimal;
    }>;
    expect(persistedItems[0]).toEqual(
      expect.objectContaining({
        panelTypeId: 'other-type-id',
        customTypeDescription: 'Custom fire-rated request',
      }),
    );
    expect(persistedItems[0]?.totalPrice.toString()).toBe('0');
  });

  it('updates a draft without supplierId and round-trips technical fields', async () => {
    const technicalItem = {
      panelTypeId: 'type-id',
      panelSizeId: 'size-id',
      thicknessMm: '10',
      qualityClassId: 'economy-id',
      colorId: 'color-id',
      coating: 'PE',
      texture: 'woodgrain',
      customTypeDescription: 'Special fire-rated HPL',
      requiredAreaM2: '12.5',
      customWidthMm: 1400,
      customHeightMm: 3100,
    };
    const persisted = {
      ...calculatedItem,
      colorId: technicalItem.colorId,
      coating: technicalItem.coating,
      texture: technicalItem.texture,
      customTypeDescription: technicalItem.customTypeDescription,
      sheetsCount: 180,
      customWidthMm: technicalItem.customWidthMm,
      customHeightMm: technicalItem.customHeightMm,
      color: { colorCode: 'W100', colorName: 'White Oak' },
    };

    calculationService.prepareManagerCatalogGroup.mockResolvedValue({
      lead,
      cnyUsdRate: new Prisma.Decimal('0.1'),
      calculatedItems: [persisted],
    });
    prisma.calculationRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'request-id',
      createdById: manager.id,
      status: CALCULATION_REQUEST_STATUS.DRAFT,
      calculations: [{ items: [persisted] }],
    });

    const created = await service.create(
      {
        leadId: 'lead-id',
        calculations: [{ title: 'Group 1', items: [technicalItem] }],
      },
      manager,
    );

    const createdItems = (
      prisma.calculationSession.create.mock.calls[0][0].data as {
        items: {
          create: Array<{
            sheetsCount: number;
            customWidthMm: number;
            customHeightMm: number;
            coating: string;
            texture: string;
            customTypeDescription: string;
            colorId: string;
          }>;
        };
      }
    ).items.create;
    expect(createdItems[0]).toEqual(
      expect.objectContaining({
        sheetsCount: 180,
        customWidthMm: 1400,
        customHeightMm: 3100,
        coating: 'PE',
        texture: 'woodgrain',
        customTypeDescription: 'Special fire-rated HPL',
        colorId: 'color-id',
      }),
    );
    expect(created.calculations[0].items[0]).toEqual(
      expect.objectContaining({
        sheetsCount: 180,
        customWidthMm: 1400,
        customHeightMm: 3100,
        color: { colorCode: 'W100', colorName: 'White Oak' },
      }),
    );

    prisma.calculationRequest.findFirst.mockResolvedValue({
      id: 'request-id',
      createdById: manager.id,
      status: CALCULATION_REQUEST_STATUS.DRAFT,
      leadId: 'lead-id',
    });

    const read = await service.findOne('request-id', manager);
    expect(read.calculations[0].items[0]).toEqual(
      expect.objectContaining({
        sheetsCount: 180,
        customWidthMm: 1400,
        customHeightMm: 3100,
        coating: 'PE',
        texture: 'woodgrain',
        customTypeDescription: 'Special fire-rated HPL',
        colorId: 'color-id',
        color: { colorCode: 'W100', colorName: 'White Oak' },
      }),
    );

    const patchedPersisted = {
      ...persisted,
      sheetsCount: 2,
      requiredAreaM2: new Prisma.Decimal('10'),
      customWidthMm: 1500,
      customHeightMm: 3200,
      coating: 'UV',
      texture: 'matte',
      customTypeDescription: 'Updated type',
    };
    calculationService.prepareManagerCatalogGroup.mockResolvedValue({
      lead,
      cnyUsdRate: new Prisma.Decimal('0.1'),
      calculatedItems: [patchedPersisted],
    });
    prisma.calculationRequest.findFirst.mockResolvedValue({
      id: 'request-id',
      createdById: manager.id,
      status: CALCULATION_REQUEST_STATUS.DRAFT,
      leadId: 'lead-id',
      clientId: 'client-id',
      dealId: null,
      notes: null,
    });
    prisma.calculationRequest.update.mockResolvedValue({
      id: 'request-id',
      calculations: [{ items: [patchedPersisted] }],
    });

    const updated = await service.update(
      'request-id',
      {
        calculations: [
          {
            title: 'Group 1',
            items: [
              {
                ...technicalItem,
                requiredAreaM2: '10',
                sheetsCount: 999,
                customWidthMm: 1500,
                customHeightMm: 3200,
                coating: 'UV',
                texture: 'matte',
                customTypeDescription: 'Updated type',
              },
            ],
          },
        ],
      },
      manager,
    );

    const patchedItems = (
      prisma.calculationSession.create.mock.calls.at(-1)?.[0].data as {
        items: {
          create: Array<{
            sheetsCount: number;
            customWidthMm: number;
            coating: string;
          }>;
        };
      }
    ).items.create;
    expect(patchedItems[0]).toEqual(
      expect.objectContaining({
        sheetsCount: 2,
        customWidthMm: 1500,
        customHeightMm: 3200,
        coating: 'UV',
        texture: 'matte',
        customTypeDescription: 'Updated type',
      }),
    );
    expect(updated.calculations[0].items[0]).toEqual(
      expect.objectContaining({
        sheetsCount: 2,
        customWidthMm: 1500,
        coating: 'UV',
      }),
    );
  });

  it('persists a manager client note across draft save, reopen, and submit', async () => {
    const draftRequest = {
      id: 'request-id',
      leadId: 'lead-id',
      clientId: 'client-id',
      dealId: null,
      createdById: manager.id,
      status: CALCULATION_REQUEST_STATUS.DRAFT,
      notes: 'Первоначальное пожелание',
      calculations: [{ items: [{ supplierId: null }] }],
    };
    const savedRequest = {
      ...draftRequest,
      notes: 'Сохранённое пожелание клиента',
    };
    const editedRequest = {
      ...savedRequest,
      notes: 'Изменённое пожелание клиента',
    };
    const submittedRequest = {
      ...editedRequest,
      status: CALCULATION_REQUEST_STATUS.SUBMITTED,
    };

    prisma.calculationRequest.create.mockResolvedValue({
      id: draftRequest.id,
      status: CALCULATION_REQUEST_STATUS.DRAFT,
    });
    prisma.calculationRequest.findFirst
      .mockResolvedValueOnce(draftRequest)
      .mockResolvedValueOnce(savedRequest)
      .mockResolvedValueOnce(savedRequest)
      .mockResolvedValueOnce(editedRequest)
      .mockResolvedValueOnce(editedRequest);
    prisma.calculationRequest.findUniqueOrThrow
      .mockResolvedValueOnce(draftRequest)
      .mockResolvedValueOnce(savedRequest)
      .mockResolvedValueOnce(editedRequest)
      .mockResolvedValueOnce(editedRequest)
      .mockResolvedValueOnce(submittedRequest);
    prisma.calculationRequest.update
      .mockResolvedValueOnce(savedRequest)
      .mockResolvedValueOnce(editedRequest);
    prisma.calculationRequest.updateMany.mockResolvedValue({ count: 1 });

    const created = await service.create(
      {
        leadId: 'lead-id',
        notes: draftRequest.notes,
        calculations: [
          {
            title: 'Основной расчёт',
            items: [
              {
                panelTypeId: 'type-id',
                panelSizeId: 'size-id',
                thicknessMm: '10',
                qualityClassId: 'economy-id',
                requiredAreaM2: '12',
              },
            ],
          },
        ] as never,
      },
      manager,
    );
    expect(created.notes).toBe(draftRequest.notes);

    const saved = await service.update(
      'request-id',
      { notes: savedRequest.notes },
      manager,
    );
    expect(prisma.calculationRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'request-id' },
        data: { notes: savedRequest.notes },
      }),
    );
    expect(saved.notes).toBe(savedRequest.notes);

    const reopened = await service.findOne('request-id', manager);
    expect(reopened.notes).toBe(savedRequest.notes);

    const edited = await service.update(
      'request-id',
      { notes: editedRequest.notes },
      manager,
    );
    expect(edited.notes).toBe(editedRequest.notes);

    const reopenedAfterEdit = await service.findOne('request-id', manager);
    expect(reopenedAfterEdit.notes).toBe(editedRequest.notes);

    const submitted = await service.submit('request-id', manager);
    expect(submitted.notes).toBe(editedRequest.notes);
    expect(submitted.status).toBe(CALCULATION_REQUEST_STATUS.SUBMITTED);
  });

  it('allows HEAD to edit submitted technical rows and assign supplier per item', async () => {
    prisma.calculationRequest.findFirst.mockResolvedValue({
      id: 'request-id',
      leadId: 'lead-id',
      clientId: 'client-id',
      dealId: null,
      createdById: manager.id,
      status: CALCULATION_REQUEST_STATUS.SUBMITTED,
      notes: null,
    });
    prisma.calculationRequest.update.mockResolvedValue({
      id: 'request-id',
      status: CALCULATION_REQUEST_STATUS.SUBMITTED,
      calculations: [{ items: [{ supplierId: 'supplier-a' }] }],
    });

    await service.update(
      'request-id',
      {
        calculations: [
          {
            title: 'Reviewed group',
            items: [
              {
                panelTypeId: 'type-id',
                panelSizeId: 'size-id',
                thicknessMm: '10',
                qualityClassId: 'economy-id',
                supplierId: 'supplier-a',
                requiredAreaM2: '12',
              },
            ],
          },
        ],
      },
      head,
    );

    expect(
      calculationService.prepareManagerCatalogGroup,
    ).toHaveBeenCalledWith(
      'lead-id',
      expect.any(Array),
      head,
      { allowItemSupplier: true },
    );
    expect(prisma.calculationSession.deleteMany).toHaveBeenCalledWith({
      where: { requestId: 'request-id' },
    });
    expect(prisma.calculationSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'finalized' }),
      }),
    );
  });

  it('does not let a Manager edit a submitted request', async () => {
    prisma.calculationRequest.findFirst.mockResolvedValue({
      id: 'request-id',
      createdById: manager.id,
      status: CALCULATION_REQUEST_STATUS.SUBMITTED,
    });

    await expect(
      service.update('request-id', { notes: 'attempt' }, manager),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'CALCULATION_REQUEST_LOCKED',
      }),
    });
    expect(
      calculationService.prepareManagerCatalogGroup,
    ).not.toHaveBeenCalled();
  });
});
