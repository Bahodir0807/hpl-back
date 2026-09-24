import { HttpStatus, Injectable } from '@nestjs/common';
import {
  FacadeCommercialStatus,
  InstallationCommercialStatus,
  Prisma,
  QuoteComponentKind,
} from '@prisma/client';
import { BusinessException } from '../common/exceptions/business.exception';
import type { CurrentUser } from '../common/interfaces/current-user.interface';
import { PrismaService } from '../modules/prisma/prisma.service';
import { QUOTE_PERMISSIONS } from './quote.constants';
import {
  customerFacingSnapshot,
  decimalToAmountString,
  positiveCustomerAmount,
  QUOTE_COMPONENT_LABEL,
  QUOTE_STALE_COMPONENT_ACK_REQUIRED,
  snapshotContainsInternalLeak,
  sumAmountsByCurrency,
  type QuoteComponentPreview,
  type QuoteComponentReadiness,
  type QuoteCompositionTotals,
} from './quote-composition';

type Tx = Prisma.TransactionClient | PrismaService;

type QuoteForSnapshot = {
  id: string;
  leadId: string;
  calculationId: string | null;
  requestId: string | null;
  totalAmount: Prisma.Decimal;
  displayCurrency: string;
  items: Array<{ totalPrice: Prisma.Decimal | null }>;
};

@Injectable()
export class QuoteCompositionService {
  constructor(private readonly prisma: PrismaService) {}

  async preview(
    leadId: string,
    user: CurrentUser,
  ): Promise<{
    leadId: string;
    components: Array<Omit<QuoteComponentPreview, 'sourceId'>>;
    totals: QuoteCompositionTotals;
    canCreateQuote: boolean;
    staleAcknowledgementRequired: boolean;
  }> {
    await this.assertLeadQuoteReadAccess(leadId, user);
    const resolved = await this.resolveLead(leadId);
    const components = [
      resolved.hpl.preview,
      resolved.facade.preview,
      resolved.installation.preview,
    ];
    const includeable = components.filter((item) => item.includeInQuote);
    return {
      leadId,
      components: components.map(({ sourceId: _sourceId, ...component }) => component),
      totals: sumAmountsByCurrency(includeable),
      canCreateQuote: resolved.hpl.preview.readiness === 'READY',
      staleAcknowledgementRequired: includeable.some(
        (item) => item.staleTechnicalBasis,
      ),
    };
  }

  async attachToQuote(
    tx: Tx,
    quote: QuoteForSnapshot,
    options: { acknowledgeStaleComponents?: boolean },
  ): Promise<void> {
    const resolved = await this.resolveLead(quote.leadId, tx);
    const rows: Prisma.PanelQuoteComponentSnapshotCreateManyInput[] = [
      this.hplRow(quote, resolved.hpl),
    ];

    const extras = [resolved.facade, resolved.installation].filter(
      (component) => component.includeable,
    );
    if (
      extras.some((component) => component.stale) &&
      !options.acknowledgeStaleComponents
    ) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        QUOTE_STALE_COMPONENT_ACK_REQUIRED,
        'Технический расчёт изменён после утверждения коммерческой стоимости. Подтвердите включение утверждённого снимка или создайте новую коммерческую ревизию',
      );
    }

    for (const extra of extras) {
      rows.push(this.extraRow(quote.id, extra));
    }

    for (const row of rows) {
      const leaks = snapshotContainsInternalLeak(row.customerSnapshot);
      if (leaks.length > 0) {
        throw new BusinessException(
          HttpStatus.INTERNAL_SERVER_ERROR,
          'QUOTE_COMPONENT_INTERNAL_LEAK',
          `Customer quote snapshot must not include ${leaks.join(', ')}`,
        );
      }
    }

    await tx.panelQuoteComponentSnapshot.createMany({ data: rows });

    for (const extra of extras) {
      if (extra.kind === QuoteComponentKind.FACADE && extra.sourceId) {
        await tx.facadeCommercialCalculation.updateMany({
          where: { id: extra.sourceId },
          data: { quoteCreated: true },
        });
      }
      if (extra.kind === QuoteComponentKind.INSTALLATION && extra.sourceId) {
        await tx.installationCommercialCalculation.updateMany({
          where: { id: extra.sourceId },
          data: { quoteCreated: true },
        });
      }
    }
  }

  shouldPreserveHplSnapshot(
    sourceKinds: QuoteComponentKind[],
    incomingKinds: QuoteComponentKind[],
  ): boolean {
    const extra = (kind: QuoteComponentKind) =>
      kind === QuoteComponentKind.FACADE ||
      kind === QuoteComponentKind.INSTALLATION;
    return sourceKinds.some(extra) || incomingKinds.some(extra);
  }

  async incomingExtraKinds(leadId: string, tx: Tx = this.prisma): Promise<QuoteComponentKind[]> {
    const resolved = await this.resolveLead(leadId, tx);
    return [resolved.facade, resolved.installation]
      .filter((component) => component.includeable)
      .map((component) => component.kind);
  }

  compositionView(
    snapshots: Array<{
      kind: QuoteComponentKind;
      label: string;
      description: string | null;
      customerAmount: Prisma.Decimal | null;
      currency: string | null;
      sourceId: string | null;
      sourceRevision: number | null;
      technicalRevision: number | null;
      sortOrder: number;
    }>,
  ): {
    components: Array<{
      kind: QuoteComponentKind;
      label: string;
      description: string | null;
      amount: string | null;
      currency: string | null;
      sourceRevision: number | null;
      technicalRevision: number | null;
    }>;
    totals: QuoteCompositionTotals;
  } {
    const components = [...snapshots]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((snapshot) => ({
        kind: snapshot.kind,
        label: snapshot.label,
        description: snapshot.description,
        amount: decimalToAmountString(snapshot.customerAmount),
        currency: snapshot.currency,
        sourceRevision: snapshot.sourceRevision,
        technicalRevision: snapshot.technicalRevision,
      }));
    return {
      components,
      totals: sumAmountsByCurrency(components),
    };
  }

  private hplRow(
    quote: QuoteForSnapshot,
    hpl: ResolvedComponent,
  ): Prisma.PanelQuoteComponentSnapshotCreateManyInput {
    const amount =
      decimalToAmountString(quote.totalAmount) ??
      hpl.preview.amount;
    const currency = quote.displayCurrency || hpl.preview.currency;
    return {
      quoteId: quote.id,
      kind: QuoteComponentKind.HPL,
      sourceId: quote.calculationId ?? quote.requestId,
      sourceRevision: null,
      technicalRevision: null,
      customerAmount: amount ? new Prisma.Decimal(amount) : quote.totalAmount,
      currency,
      label: QUOTE_COMPONENT_LABEL.HPL,
      description: null,
      customerSnapshot: customerFacingSnapshot(QuoteComponentKind.HPL, {
        amount,
        currency,
      }) as unknown as Prisma.InputJsonValue,
      sortOrder: 0,
    };
  }

  private extraRow(
    quoteId: string,
    component: ResolvedComponent,
  ): Prisma.PanelQuoteComponentSnapshotCreateManyInput {
    const payload = customerFacingSnapshot(component.kind, {
      amount: component.preview.amount,
      currency: component.preview.currency,
      description: component.preview.description,
      workSummaries: component.workSummaries,
    });
    return {
      quoteId,
      kind: component.kind,
      sourceId: component.sourceId,
      sourceRevision: component.preview.sourceRevision,
      technicalRevision: component.preview.technicalRevision,
      customerAmount: component.preview.amount
        ? new Prisma.Decimal(component.preview.amount)
        : null,
      currency: component.preview.currency,
      label: component.preview.label,
      description: component.preview.description,
      customerSnapshot: payload as unknown as Prisma.InputJsonValue,
      sortOrder: component.kind === QuoteComponentKind.FACADE ? 1 : 2,
    };
  }

  private async resolveLead(leadId: string, tx: Tx = this.prisma) {
    const lead = await tx.lead.findFirst({
      where: { id: leadId, deletedAt: null },
      include: {
        qualification: {
          select: {
            ventFacadeKitRequired: true,
            installationRequired: true,
          },
        },
        calculationRequests: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true },
        },
        calculationSessions: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, totalAmount: true, displayCurrency: true },
        },
      },
    });
    if (!lead) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'LEAD_NOT_FOUND',
        'Лид не найден',
      );
    }

    const facadeRequired = lead.qualification?.ventFacadeKitRequired === true;
    const installationRequired =
      lead.qualification?.installationRequired === true;

    const [facade, installation] = await Promise.all([
      facadeRequired
        ? tx.facadeCommercialCalculation.findFirst({
            where: { leadId, isCurrent: true },
            include: {
              facadeCalculation: { select: { revision: true } },
            },
          })
        : Promise.resolve(null),
      installationRequired
        ? tx.installationCommercialCalculation.findFirst({
            where: { leadId, isCurrent: true },
            include: {
              items: { orderBy: { sortOrder: 'asc' } },
              installationCalculation: { select: { revision: true } },
            },
          })
        : Promise.resolve(null),
    ]);

    const hplReady =
      lead.calculationSessions.some(
        (item) => item.status === 'finalized' || item.status === 'quoted',
      ) || lead.calculationRequests.some((item) => item.status !== 'draft');

    const hplAmount = positiveCustomerAmount(
      decimalToAmountString(lead.calculationSessions[0]?.totalAmount),
    );
    const hpl: ResolvedComponent = {
      kind: QuoteComponentKind.HPL,
      includeable: hplReady,
      stale: false,
      sourceId:
        lead.calculationSessions[0]?.id ??
        lead.calculationRequests[0]?.id ??
        null,
      workSummaries: [],
      preview: {
        kind: QuoteComponentKind.HPL,
        required: true,
        readiness: hplReady ? 'READY' : 'MISSING',
        includeInQuote: hplReady,
        staleTechnicalBasis: false,
        amount: hplAmount,
        currency: hplAmount
          ? lead.calculationSessions[0]?.displayCurrency ?? 'USD'
          : null,
        sourceId: lead.calculationSessions[0]?.id ?? null,
        sourceRevision: null,
        technicalRevision: null,
        label: QUOTE_COMPONENT_LABEL.HPL,
        description: null,
        warning: !hplReady
          ? 'HPL расчёт ещё не готов'
          : hplAmount
            ? null
            : 'Цена HPL ещё не утверждена',
      },
    };

    return {
      hpl,
      facade: this.facadeComponent(facadeRequired, facade),
      installation: this.installationComponent(installationRequired, installation),
    };
  }

  private facadeComponent(
    required: boolean,
    commercial: {
      id: string;
      status: FacadeCommercialStatus;
      revision: number;
      facadeCalculationRevision: number;
      approvedCustomerAmount: Prisma.Decimal | null;
      approvedCurrency: string | null;
      facadeCalculation: { revision: number };
    } | null,
  ): ResolvedComponent {
    const approved =
      commercial?.status === FacadeCommercialStatus.APPROVED &&
      commercial.approvedCustomerAmount != null &&
      Boolean(commercial.approvedCurrency);
    const stale = Boolean(
      approved &&
        commercial &&
        commercial.facadeCalculationRevision !==
          commercial.facadeCalculation.revision,
    );
    return {
      kind: QuoteComponentKind.FACADE,
      includeable: Boolean(required && approved),
      stale,
      sourceId: commercial?.id ?? null,
      workSummaries: [],
      preview: this.previewFor({
        kind: QuoteComponentKind.FACADE,
        required,
        approved,
        stale,
        missing: required && !commercial,
        awaiting: required && Boolean(commercial) && !approved,
        amount: decimalToAmountString(commercial?.approvedCustomerAmount),
        currency: commercial?.approvedCurrency ?? null,
        sourceId: commercial?.id ?? null,
        sourceRevision: commercial?.revision ?? null,
        technicalRevision: commercial?.facadeCalculationRevision ?? null,
        description: QUOTE_COMPONENT_LABEL.FACADE,
      }),
    };
  }

  private installationComponent(
    required: boolean,
    commercial: {
      id: string;
      status: InstallationCommercialStatus;
      revision: number;
      installationCalculationRevision: number;
      approvedCustomerAmount: Prisma.Decimal | null;
      approvedCurrency: string | null;
      installationCalculation: { revision: number };
      items: Array<{
        workTypeName: string;
        unit: string;
        quantity: Prisma.Decimal;
      }>;
    } | null,
  ): ResolvedComponent {
    const approved =
      commercial?.status === InstallationCommercialStatus.APPROVED &&
      commercial.approvedCustomerAmount != null &&
      Boolean(commercial.approvedCurrency);
    const stale = Boolean(
      approved &&
        commercial &&
        commercial.installationCalculationRevision !==
          commercial.installationCalculation.revision,
    );
    return {
      kind: QuoteComponentKind.INSTALLATION,
      includeable: Boolean(required && approved),
      stale,
      sourceId: commercial?.id ?? null,
      workSummaries:
        approved && commercial
          ? commercial.items.map((item) => ({
              name: item.workTypeName,
              unit: item.unit,
              quantity: item.quantity.toFixed(),
            }))
          : [],
      preview: this.previewFor({
        kind: QuoteComponentKind.INSTALLATION,
        required,
        approved,
        stale,
        missing: required && !commercial,
        awaiting: required && Boolean(commercial) && !approved,
        amount: decimalToAmountString(commercial?.approvedCustomerAmount),
        currency: commercial?.approvedCurrency ?? null,
        sourceId: commercial?.id ?? null,
        sourceRevision: commercial?.revision ?? null,
        technicalRevision: commercial?.installationCalculationRevision ?? null,
        description: QUOTE_COMPONENT_LABEL.INSTALLATION,
      }),
    };
  }

  private previewFor(input: {
    kind: QuoteComponentKind;
    required: boolean;
    approved: boolean;
    stale: boolean;
    missing: boolean;
    awaiting: boolean;
    amount: string | null;
    currency: string | null;
    sourceId: string | null;
    sourceRevision: number | null;
    technicalRevision: number | null;
    description: string;
  }): QuoteComponentPreview {
    let readiness: QuoteComponentReadiness = 'NOT_REQUIRED';
    let warning: string | null = null;
    if (!input.required) {
      readiness = 'NOT_REQUIRED';
    } else if (input.stale) {
      readiness = 'STALE_APPROVED';
      warning =
        'Технический расчёт изменён после утверждения коммерческой стоимости';
    } else if (input.approved) {
      readiness = 'READY';
    } else if (input.awaiting) {
      readiness = 'AWAITING_APPROVAL';
      warning = 'Ожидает коммерческого утверждения';
    } else if (input.missing) {
      readiness = 'MISSING';
      warning = 'Ожидает коммерческого утверждения';
    }

    return {
      kind: input.kind,
      required: input.required,
      readiness,
      includeInQuote: input.required && input.approved,
      staleTechnicalBasis: input.stale,
        amount: input.approved ? positiveCustomerAmount(input.amount) : null,
      currency: input.approved ? input.currency : null,
      sourceId: input.sourceId,
      sourceRevision: input.sourceRevision,
      technicalRevision: input.technicalRevision,
      label: QUOTE_COMPONENT_LABEL[input.kind],
      description: input.required ? input.description : null,
      warning,
    };
  }

  private async assertLeadQuoteReadAccess(
    leadId: string,
    user: CurrentUser,
  ): Promise<void> {
    if (user.permissions.includes(QUOTE_PERMISSIONS.READ_ALL)) {
      return;
    }
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, deletedAt: null },
      select: { ownerId: true },
    });
    if (!lead) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'LEAD_NOT_FOUND',
        'Лид не найден',
      );
    }
    if (lead.ownerId === user.id) {
      return;
    }
    throw new BusinessException(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'У вас нет доступа к этому КП',
    );
  }
}

type ResolvedComponent = {
  kind: QuoteComponentKind;
  includeable: boolean;
  stale: boolean;
  sourceId: string | null;
  workSummaries: Array<{ name: string; unit: string; quantity: string }>;
  preview: QuoteComponentPreview;
};
