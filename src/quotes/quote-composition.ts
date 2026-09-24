import { Prisma, QuoteComponentKind } from '@prisma/client';

export const QUOTE_STALE_COMPONENT_ACK_REQUIRED =
  'QUOTE_STALE_COMPONENT_ACK_REQUIRED';
export const QUOTE_COMPONENT_NOT_APPROVED = 'QUOTE_COMPONENT_NOT_APPROVED';

export const QUOTE_COMPONENT_LABEL = {
  HPL: 'Поставка HPL-панелей',
  FACADE: 'Фасадная подсистема',
  INSTALLATION: 'Монтажные работы',
} as const;

export const QUOTE_COMPONENT_AMOUNT_LABEL = 'Стоимость';

export const HPL_CUSTOMER_SUBTITLE = 'на поставку HPL-панелей';
export const HPL_FACADE_CUSTOMER_SUBTITLE =
  'на поставку HPL-панелей и фасадной подсистемы';
export const HPL_INSTALLATION_CUSTOMER_SUBTITLE =
  'на поставку HPL-панелей и монтажные работы';
export const HPL_FACADE_INSTALLATION_CUSTOMER_SUBTITLE =
  'на поставку HPL-панелей, фасадной подсистемы и монтажные работы';

export function customerQuoteSubtitle(
  kinds: Iterable<QuoteComponentKind | 'HPL' | 'FACADE' | 'INSTALLATION'>,
): string {
  const set = new Set([...kinds].map((kind) => String(kind)));
  const facade = set.has(QuoteComponentKind.FACADE) || set.has('FACADE');
  const installation =
    set.has(QuoteComponentKind.INSTALLATION) || set.has('INSTALLATION');
  if (facade && installation) {
    return HPL_FACADE_INSTALLATION_CUSTOMER_SUBTITLE;
  }
  if (facade) {
    return HPL_FACADE_CUSTOMER_SUBTITLE;
  }
  if (installation) {
    return HPL_INSTALLATION_CUSTOMER_SUBTITLE;
  }
  return HPL_CUSTOMER_SUBTITLE;
}

export type QuoteComponentReadiness =
  | 'NOT_REQUIRED'
  | 'READY'
  | 'AWAITING_APPROVAL'
  | 'STALE_APPROVED'
  | 'MISSING';

export type QuoteComponentPreview = {
  kind: QuoteComponentKind;
  required: boolean;
  readiness: QuoteComponentReadiness;
  includeInQuote: boolean;
  staleTechnicalBasis: boolean;
  amount: string | null;
  currency: string | null;
  sourceId: string | null;
  sourceRevision: number | null;
  technicalRevision: number | null;
  label: string;
  description: string | null;
  warning: string | null;
};

export type QuoteCompositionTotals = {
  byCurrency: Array<{ currency: string; amount: string }>;
  grandTotal: { currency: string; amount: string } | null;
};

export type CustomerComponentSnapshot = {
  kind: QuoteComponentKind;
  label: string;
  description: string | null;
  amount: string | null;
  currency: string | null;
  workSummaries?: Array<{ name: string; unit: string; quantity: string }>;
};

export type QuoteDocumentExtraSection = {
  heading: string;
  lines: string[];
};

export function decimalToAmountString(
  value: Prisma.Decimal | { toString(): string } | number | string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const amount = Number(value.toString());
  if (!Number.isFinite(amount)) {
    return null;
  }
  return new Prisma.Decimal(value.toString()).toDecimalPlaces(2).toFixed(2);
}

export function positiveCustomerAmount(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return value;
}

export function sumAmountsByCurrency(
  parts: Array<{ amount: string | null; currency: string | null }>,
): QuoteCompositionTotals {
  const buckets = new Map<string, Prisma.Decimal>();
  for (const part of parts) {
    if (!part.amount || !part.currency) {
      continue;
    }
    const currency = part.currency.trim().toUpperCase();
    const amount = new Prisma.Decimal(part.amount);
    if (!currency || amount.lte(0)) {
      continue;
    }
    buckets.set(currency, (buckets.get(currency) ?? new Prisma.Decimal(0)).plus(amount));
  }

  const byCurrency = [...buckets.entries()].map(([currency, amount]) => ({
    currency,
    amount: amount.toDecimalPlaces(2).toFixed(2),
  }));

  return {
    byCurrency,
    grandTotal: byCurrency.length === 1 ? byCurrency[0]! : null,
  };
}

export function customerFacingSnapshot(
  kind: QuoteComponentKind,
  input: {
    amount: string | null;
    currency: string | null;
    description?: string | null;
    workSummaries?: Array<{ name: string; unit: string; quantity: string }>;
  },
): CustomerComponentSnapshot {
  return {
    kind,
    label: QUOTE_COMPONENT_LABEL[kind],
    description: input.description?.trim() || null,
    amount: input.amount,
    currency: input.currency,
    ...(input.workSummaries?.length ? { workSummaries: input.workSummaries } : {}),
  };
}

export function quoteDocumentExtraSections(
  snapshots: Array<{
    kind: QuoteComponentKind;
    label: string;
    description: string | null;
    customerAmount: Prisma.Decimal | { toString(): string } | null;
    currency: string | null;
    customerSnapshot: unknown;
  }>,
): QuoteDocumentExtraSection[] {
  return snapshots
    .filter((snapshot) => snapshot.kind !== QuoteComponentKind.HPL)
    .map((snapshot) => {
      const payload = asCustomerSnapshot(snapshot.customerSnapshot);
      const amount = formatSectionAmount(
        decimalToAmountString(snapshot.customerAmount) ?? payload?.amount,
        snapshot.currency ?? payload?.currency,
      );
      const lines = [
        payload?.description ?? snapshot.description,
        ...(payload?.workSummaries ?? []).map(
          (item) => `${item.name}: ${item.quantity} ${item.unit}`,
        ),
        amount,
      ].filter((line): line is string => Boolean(line && line.trim()));
      return {
        heading: snapshot.label || QUOTE_COMPONENT_LABEL[snapshot.kind],
        lines,
      };
    });
}

export function quoteDocumentTotalsLines(
  snapshots: Array<{
    kind: QuoteComponentKind;
    label: string;
    customerAmount: Prisma.Decimal | { toString(): string } | null;
    currency: string | null;
  }>,
): { lines: string[]; grandTotal: string | null } {
  const extras = snapshots.filter((snapshot) => snapshot.kind !== QuoteComponentKind.HPL);
  if (extras.length === 0) {
    return { lines: [], grandTotal: null };
  }

  const parts = snapshots.map((snapshot) => ({
    amount: decimalToAmountString(snapshot.customerAmount),
    currency: snapshot.currency,
    label: snapshot.label || QUOTE_COMPONENT_LABEL[snapshot.kind],
  }));
  const totals = sumAmountsByCurrency(parts);
  if (totals.grandTotal) {
    return {
      lines: [],
      grandTotal: `Итого: ${totals.grandTotal.amount} ${totals.grandTotal.currency}`,
    };
  }

  return {
    lines: parts
      .filter((part) => part.amount && part.currency)
      .map(
        (part) =>
          `${part.label}: ${part.amount} ${part.currency?.trim().toUpperCase()}`,
      ),
    grandTotal: null,
  };
}

export function snapshotContainsInternalLeak(value: unknown): string[] {
  const serialized = JSON.stringify(value ?? {});
  const leaks: string[] = [];
  const forbidden = [
    'purchasePrice',
    'supplierPricePerM2',
    'linePurchaseTotal',
    'lineCostTotal',
    'pricePerUnit',
    'contractorName',
    'selectedRateId',
    'rateSnapshot',
    'offerSnapshot',
    'margin',
    'fxRate',
    'cnyUsdRate',
  ];
  for (const field of forbidden) {
    if (serialized.includes(`"${field}"`)) {
      leaks.push(field);
    }
  }
  return leaks;
}

function formatSectionAmount(
  amount: string | null | undefined,
  currency: string | null | undefined,
): string | null {
  if (!amount || !currency) {
    return null;
  }
  return `${QUOTE_COMPONENT_AMOUNT_LABEL}: ${amount} ${currency.trim().toUpperCase()}`;
}

function asCustomerSnapshot(value: unknown): CustomerComponentSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Partial<CustomerComponentSnapshot>;
  if (!record.kind) {
    return null;
  }
  return {
    kind: record.kind,
    label: record.label ?? QUOTE_COMPONENT_LABEL[record.kind],
    description: record.description ?? null,
    amount: record.amount ?? null,
    currency: record.currency ?? null,
    workSummaries: record.workSummaries,
  };
}
