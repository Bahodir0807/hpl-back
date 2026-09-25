import {
  ActivityType,
  ExecutionComponentStatus,
  ExecutionHandoffStatus,
  Prisma,
  PrismaClient,
  QuoteComponentKind,
} from '@prisma/client';

type Tx = Prisma.TransactionClient;

export type HandoffQuoteSnapshot = {
  id: string;
  versionNumber?: number | null;
  totalAmount: Prisma.Decimal;
  displayCurrency: string;
  cnyUsdRate?: Prisma.Decimal | null;
  sellingCoefficient?: Prisma.Decimal | null;
  items?: Array<{
    panelTypeName?: string | null;
    panelSizeName?: string | null;
    areaM2?: Prisma.Decimal | null;
    thicknessMm?: Prisma.Decimal | null;
    sheetsCount?: number | null;
    pricePerM2?: Prisma.Decimal | null;
    totalPrice?: Prisma.Decimal | null;
    currencyCode?: string | null;
    requiredAreaM2?: Prisma.Decimal | null;
    colorName?: string | null;
    qualityClassName?: string | null;
  }>;
  componentSnapshots?: Array<{
    kind: QuoteComponentKind;
    label: string;
    sourceRevision?: number | null;
    technicalRevision?: number | null;
    customerAmount?: Prisma.Decimal | null;
    currency?: string | null;
    customerSnapshot?: Prisma.JsonValue;
  }>;
};

export type HandoffWriteResult = {
  created: boolean;
  handoffId: string;
  revision: number;
  supersededQuoteId: string | null;
  supersededVersion: number | null;
};

function decimalString(
  value: Prisma.Decimal | null | undefined,
): string | null {
  return value == null ? null : value.toString();
}

function hplBasis(quote: HandoffQuoteSnapshot): Prisma.InputJsonValue {
  return {
    quoteVersion: quote.versionNumber ?? 1,
    cnyUsdRate: decimalString(quote.cnyUsdRate),
    sellingCoefficient: decimalString(quote.sellingCoefficient),
    currency: quote.displayCurrency,
    customerAmount: decimalString(quote.totalAmount),
    items: (quote.items ?? []).map((item) => ({
      panelTypeName: item.panelTypeName ?? null,
      panelSizeName: item.panelSizeName ?? null,
      areaM2: decimalString(item.areaM2),
      thicknessMm: decimalString(item.thicknessMm),
      sheetsCount: item.sheetsCount ?? null,
      requiredAreaM2: decimalString(item.requiredAreaM2),
      pricePerM2: decimalString(item.pricePerM2),
      totalPrice: decimalString(item.totalPrice),
      currencyCode: item.currencyCode ?? quote.displayCurrency,
      colorName: item.colorName ?? null,
      qualityClassName: item.qualityClassName ?? null,
    })),
  };
}

function componentRows(
  quote: HandoffQuoteSnapshot,
): Prisma.DealExecutionComponentCreateManyInput[] {
  const snapshots = quote.componentSnapshots ?? [];
  if (snapshots.length === 0) {
    return [
      {
        handoffId: '',
        kind: QuoteComponentKind.HPL,
        required: true,
        status: ExecutionComponentStatus.PENDING,
        sourceRevision: null,
        technicalRevision: null,
        customerAmount: quote.totalAmount,
        currency: quote.displayCurrency,
        label: 'HPL',
        basis: hplBasis(quote),
      },
    ];
  }

  return snapshots.map((snapshot) => ({
    handoffId: '',
    kind: snapshot.kind,
    required: true,
    status: ExecutionComponentStatus.PENDING,
    sourceRevision: snapshot.sourceRevision ?? null,
    technicalRevision: snapshot.technicalRevision ?? null,
    customerAmount: snapshot.customerAmount ?? null,
    currency: snapshot.currency ?? null,
    label: snapshot.label,
    basis:
      snapshot.kind === QuoteComponentKind.HPL
        ? hplBasis(quote)
        : ((snapshot.customerSnapshot ?? {}) as Prisma.InputJsonValue),
  }));
}

export async function createExecutionHandoff(
  tx: Tx,
  input: {
    dealId: string;
    leadId: string;
    quote: HandoffQuoteSnapshot;
    acceptedAt: Date;
    acceptedById: string;
    acceptanceNote: string | null;
  },
): Promise<HandoffWriteResult> {
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "Deal" WHERE "id" = ${input.dealId} FOR UPDATE`,
  );

  const existing = await tx.dealExecutionHandoff.findUnique({
    where: { quoteId: input.quote.id },
    select: { id: true, revision: true },
  });
  if (existing) {
    return {
      created: false,
      handoffId: existing.id,
      revision: existing.revision,
      supersededQuoteId: null,
      supersededVersion: null,
    };
  }

  const active = await tx.dealExecutionHandoff.findFirst({
    where: { dealId: input.dealId, status: ExecutionHandoffStatus.ACTIVE },
    select: { id: true, quoteId: true, quoteVersion: true },
  });

  let supersededQuoteId: string | null = null;
  let supersededVersion: number | null = null;
  if (active && active.quoteId !== input.quote.id) {
    await tx.dealExecutionHandoff.update({
      where: { id: active.id },
      data: { status: ExecutionHandoffStatus.SUPERSEDED },
    });
    supersededQuoteId = active.quoteId;
    supersededVersion = active.quoteVersion;
    await tx.activity.create({
      data: {
        type: ActivityType.NOTE,
        relatedType: 'Lead',
        relatedId: input.leadId,
        authorId: input.acceptedById,
        metadata: {
          action: 'execution_basis_superseded',
          dealId: input.dealId,
          previousQuoteId: active.quoteId,
          previousQuoteVersion: active.quoteVersion,
          quoteId: input.quote.id,
          quoteVersion: input.quote.versionNumber ?? 1,
        },
      },
    });
  }

  const maxRevision = await tx.dealExecutionHandoff.aggregate({
    where: { dealId: input.dealId },
    _max: { revision: true },
  });
  const revision = (maxRevision._max.revision ?? 0) + 1;
  const handoff = await tx.dealExecutionHandoff.create({
    data: {
      dealId: input.dealId,
      leadId: input.leadId,
      quoteId: input.quote.id,
      quoteVersion: input.quote.versionNumber ?? 1,
      acceptedAt: input.acceptedAt,
      acceptedById: input.acceptedById,
      acceptanceNote: input.acceptanceNote,
      status: ExecutionHandoffStatus.ACTIVE,
      revision,
    },
    select: { id: true },
  });

  await tx.dealExecutionComponent.createMany({
    data: componentRows(input.quote).map((row) => ({
      ...row,
      handoffId: handoff.id,
    })),
  });

  await tx.activity.create({
    data: {
      type: ActivityType.NOTE,
      relatedType: 'Lead',
      relatedId: input.leadId,
      authorId: input.acceptedById,
      metadata: {
        action: 'execution_handoff_created',
        dealId: input.dealId,
        handoffId: handoff.id,
        quoteId: input.quote.id,
        quoteVersion: input.quote.versionNumber ?? 1,
        revision,
        components: componentRows(input.quote).map((row) => row.kind),
      },
    },
  });

  return {
    created: true,
    handoffId: handoff.id,
    revision,
    supersededQuoteId,
    supersededVersion,
  };
}

type ReadClient = Prisma.TransactionClient | PrismaClient;

export async function readExecutionHandoff(
  prisma: ReadClient,
  leadId: string,
) {
  const handoffs = await prisma.dealExecutionHandoff.findMany({
    where: { leadId },
    orderBy: { revision: 'desc' },
    include: {
      components: { orderBy: { kind: 'asc' } },
      acceptedBy: {
        select: { id: true, firstName: true, lastName: true },
      },
      quote: {
        select: {
          id: true,
          versionNumber: true,
          finalizedAt: true,
          status: true,
          cnyUsdRate: true,
          displayCurrency: true,
          totalAmount: true,
        },
      },
    },
  });

  const active = handoffs.find(
    (handoff) => handoff.status === ExecutionHandoffStatus.ACTIVE,
  );
  const [facade, installation] = await Promise.all([
    prisma.facadeSubsystemCalculation.findFirst({
      where: { leadId },
      orderBy: { updatedAt: 'desc' },
      select: { revision: true },
    }),
    prisma.installationCalculation.findFirst({
      where: { leadId },
      select: { revision: true },
    }),
  ]);

  const currentTechnical: Partial<Record<QuoteComponentKind, number | null>> =
    {
      [QuoteComponentKind.FACADE]: facade?.revision ?? null,
      [QuoteComponentKind.INSTALLATION]: installation?.revision ?? null,
    };

  const present = (handoff: (typeof handoffs)[number]) => ({
    id: handoff.id,
    dealId: handoff.dealId,
    leadId: handoff.leadId,
    quoteId: handoff.quoteId,
    quoteVersion: handoff.quoteVersion,
    acceptedAt: handoff.acceptedAt.toISOString(),
    acceptedBy: {
      id: handoff.acceptedBy.id,
      name: `${handoff.acceptedBy.firstName} ${handoff.acceptedBy.lastName}`.trim(),
    },
    acceptanceNote: handoff.acceptanceNote,
    status: handoff.status,
    revision: handoff.revision,
    active: handoff.status === ExecutionHandoffStatus.ACTIVE,
    components: handoff.components.map((component) => {
      const current = currentTechnical[component.kind] ?? null;
      const changedAfterAcceptance =
        component.technicalRevision != null &&
        current != null &&
        current !== component.technicalRevision;
      return {
        kind: component.kind,
        label: component.label,
        required: component.required,
        status: component.status,
        sourceRevision: component.sourceRevision,
        technicalRevision: component.technicalRevision,
        currentTechnicalRevision: current,
        customerAmount: decimalString(component.customerAmount),
        currency: component.currency,
        changedAfterAcceptance,
      };
    }),
  });

  return {
    active: active ? present(active) : null,
    history: handoffs.map(present),
  };
}

export async function notifyExecutionEvents(
  prisma: ReadClient,
  input: {
    managerId: string;
    leadId: string;
    quoteVersion: number;
    handoff: HandoffWriteResult;
  },
): Promise<void> {
  if (!input.handoff.created) return;

  const events = [
    {
      type: 'quote_customer_accepted',
      title: 'Клиент принял КП',
      message: `Клиент принял КП v${input.quoteVersion}`,
    },
    {
      type: 'execution_handoff_activated',
      title: 'Заказ передан в исполнение',
      message: `Исполнение открыто по КП v${input.quoteVersion}`,
    },
  ];
  if (input.handoff.supersededVersion != null) {
    events.push({
      type: 'execution_basis_superseded',
      title: 'Основание исполнения обновлено',
      message: `КП v${input.handoff.supersededVersion} заменено на v${input.quoteVersion}`,
    });
  }

  for (const event of events) {
    const duplicate = await prisma.notification.findFirst({
      where: {
        type: event.type,
        relatedType: 'DealExecutionHandoff',
        relatedId: input.handoff.handoffId,
      },
      select: { id: true },
    });
    if (duplicate) continue;
    await prisma.notification.create({
      data: {
        userId: input.managerId,
        title: event.title,
        message: event.message,
        type: event.type,
        relatedType: 'DealExecutionHandoff',
        relatedId: input.handoff.handoffId,
      },
    });
  }
}

export async function notifyStaleExecutionBasis(
  prisma: ReadClient,
  view: Awaited<ReturnType<typeof readExecutionHandoff>>,
  managerId: string,
): Promise<void> {
  const active = view.active;
  if (!active) return;
  for (const component of active.components) {
    if (!component.changedAfterAcceptance) continue;
    const relatedId = `${active.id}:${component.kind}`;
    const duplicate = await prisma.notification.findFirst({
      where: {
        type: 'execution_basis_stale',
        relatedType: 'DealExecutionHandoff',
        relatedId,
      },
      select: { id: true },
    });
    if (duplicate) continue;
    await prisma.notification.create({
      data: {
        userId: managerId,
        title: 'Технические данные изменились после принятия КП',
        message: `${component.label}: текущая техническая ревизия отличается от принятой`,
        type: 'execution_basis_stale',
        relatedType: 'DealExecutionHandoff',
        relatedId,
      },
    });
    await prisma.activity.create({
      data: {
        type: ActivityType.NOTE,
        relatedType: 'Lead',
        relatedId: active.leadId,
        authorId: managerId,
        metadata: {
          action: 'execution_technical_changed',
          handoffId: active.id,
          kind: component.kind,
          acceptedTechnicalRevision: component.technicalRevision,
          currentTechnicalRevision: component.currentTechnicalRevision,
        },
      },
    });
  }
}
