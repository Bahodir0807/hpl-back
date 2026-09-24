import {
  applicationForPanelTypeCode,
  canonicalizeHplApplication,
  panelSizeDisplayName,
  type HplStandardApplication,
} from '../panels/hpl-catalog';
import {
  customerQuoteSubtitle,
  HPL_CUSTOMER_SUBTITLE,
  quoteDocumentExtraSections,
  quoteDocumentTotalsLines,
  type QuoteDocumentExtraSection,
} from './quote-composition';

/**
 * Customer price column wording. The stored Quote price is already the final
 * commercial price (logistics and VAT 12% included). Not a tax calculation.
 */
export const QUOTE_PRICE_HEADER = 'Цена за м² с НДС 12%';

export const QUOTE_TABLE_HEADERS = [
  'Размер (мм)',
  'Толщина',
  'Обьем M2',
  QUOTE_PRICE_HEADER,
  'Производство',
  'Доставка',
] as const;

export const CUSTOMER_QUOTE_TITLE = 'КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ';
export const CUSTOMER_QUOTE_SUBTITLE = HPL_CUSTOMER_SUBTITLE;

export const QUOTE_OFFER_HEADING_PREFIX = 'Предложение на поставку';
export const QUOTE_OFFER_HEADING_GENERIC =
  'Предложение на поставку HPL-панелей';
export const QUOTE_OFFER_HEADING_PHRASE = {
  INTERIOR: 'интерьерных панелей',
  EXTERIOR_WITH_UV: 'фасадных панелей',
  FURNITURE: 'мебельных панелей',
  LABORATORY: 'лабораторных панелей',
} as const;

export const QUOTE_COMMERCIAL_TERMS_INCOMPLETE =
  'QUOTE_COMMERCIAL_TERMS_INCOMPLETE';
export const PRODUCTION_REQUIRED_MESSAGE = 'Заполните срок производства';
export const DELIVERY_REQUIRED_MESSAGE = 'Заполните срок доставки';

const TASHKENT_TIME_ZONE = 'Asia/Tashkent';
const RU_MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;

export type QuoteDocumentItemSnapshot = {
  panelTypeCode?: string | null;
  panelTypeName?: string | null;
  application?: string | null;
  panelSizeName: string;
  customWidthMm?: number | null;
  customHeightMm?: number | null;
  thicknessMm: { toString(): string } | number;
  sheetsCount: number;
  areaM2?: { toString(): string } | number | null;
  requiredAreaM2: { toString(): string } | number;
  pricePerM2: { toString(): string } | number | null;
  currencyCode?: string | null;
  calculationGroupTitle?: string | null;
  calculationGroupSortOrder?: number | null;
};

export type QuoteDocumentSnapshot = {
  id: string;
  versionNumber?: number;
  createdAt: Date;
  documentDate?: Date | null;
  validUntil: Date;
  totalAmount: { toString(): string } | number;
  displayCurrency: string;
  deliveryCost?: { toString(): string } | number | null;
  clientComment?: string | null;
  commercialNote?: string | null;
  productionTerms?: string | null;
  deliveryTerms?: string | null;
  productionDaysFrom?: number | null;
  productionDaysTo?: number | null;
  deliveryDaysFrom?: number | null;
  deliveryDaysTo?: number | null;
  lead: {
    title: string;
    client?: { name: string | null } | null;
  };
  items: QuoteDocumentItemSnapshot[];
  componentSnapshots?: Array<{
    kind: 'HPL' | 'FACADE' | 'INSTALLATION';
    label: string;
    description: string | null;
    customerAmount: { toString(): string } | number | null;
    currency: string | null;
    customerSnapshot: unknown;
  }>;
};

export type QuoteDocumentTableRow = {
  kind: 'group' | 'item';
  values: string[];
};

export type QuoteDocumentModel = {
  offerHeading: string;
  offerHeadingPhrase: string;
  priceHeader: string;
  itemRows: string[][];
  tableRows: QuoteDocumentTableRow[];
  extraSections: QuoteDocumentExtraSection[];
  totalsLines: string[];
  grandTotalLine: string | null;
  customerSubtitle: string;
  commercialNote: string | null;
  validUntilBullet: string;
  documentDateLine: string;
};

export function isCompleteQuoteDayRange(
  from?: number | null,
  to?: number | null,
): boolean {
  return from != null && to != null && from > 0 && to > 0 && from <= to;
}

export function quoteCustomerDocumentIssues(
  quote: Pick<
    QuoteDocumentSnapshot,
    | 'productionDaysFrom'
    | 'productionDaysTo'
    | 'deliveryDaysFrom'
    | 'deliveryDaysTo'
    | 'productionTerms'
    | 'deliveryTerms'
  >,
): string[] {
  const issues: string[] = [];
  if (
    !quote.productionTerms?.trim() &&
    !isCompleteQuoteDayRange(quote.productionDaysFrom, quote.productionDaysTo)
  ) {
    issues.push(PRODUCTION_REQUIRED_MESSAGE);
  }
  if (
    !quote.deliveryTerms?.trim() &&
    !isCompleteQuoteDayRange(quote.deliveryDaysFrom, quote.deliveryDaysTo)
  ) {
    issues.push(DELIVERY_REQUIRED_MESSAGE);
  }
  return issues;
}

export function resolveQuoteOfferApplication(
  items: QuoteDocumentItemSnapshot[],
): HplStandardApplication | null {
  for (const item of items) {
    const fromCode = applicationForPanelTypeCode(item.panelTypeCode);
    if (fromCode) {
      return fromCode;
    }
    const fromApplication = canonicalizeHplApplication(item.application);
    if (fromApplication) {
      return fromApplication;
    }
  }

  return null;
}

export function quoteOfferHeadingPhrase(
  application: HplStandardApplication | null,
): string {
  if (!application) {
    return 'HPL-панелей';
  }

  return QUOTE_OFFER_HEADING_PHRASE[application];
}

export function quoteOfferHeading(
  application: HplStandardApplication | null,
): string {
  if (!application) {
    return QUOTE_OFFER_HEADING_GENERIC;
  }

  return `${QUOTE_OFFER_HEADING_PREFIX} ${QUOTE_OFFER_HEADING_PHRASE[application]}`;
}

export function formatQuoteDayRange(
  from?: number | null,
  to?: number | null,
): string {
  if (from == null || to == null) {
    return '—';
  }

  return `${from}-${to} дней`;
}

export function quoteCalendarParts(value: Date): {
  day: string;
  monthIndex: number;
  monthName: string;
  year: string;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TASHKENT_TIME_ZONE,
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).formatToParts(value);
  const day = parts.find((part) => part.type === 'day')?.value;
  const monthIndex = Number(parts.find((part) => part.type === 'month')?.value);
  const year = parts.find((part) => part.type === 'year')?.value;
  const monthName = RU_MONTHS[monthIndex - 1];
  if (!day || !monthName || !year) {
    return {
      day: value.toISOString().slice(8, 10),
      monthIndex: 1,
      monthName: RU_MONTHS[0],
      year: value.toISOString().slice(0, 4),
    };
  }

  return { day, monthIndex, monthName, year };
}

export function formatQuoteRuDate(value: Date): string {
  const { day, monthName, year } = quoteCalendarParts(value);
  return `${day} ${monthName} ${year}`;
}

export function formatQuoteValidUntilDate(value: Date): string {
  const { day, monthName } = quoteCalendarParts(value);
  return `${day} ${monthName}`;
}

export function formatQuoteDocumentDate(value: Date): string {
  const { day, monthName, year } = quoteCalendarParts(value);
  const capitalized = monthName.charAt(0).toUpperCase() + monthName.slice(1);
  return `${day} ${capitalized}  ${year} г.`;
}

export function formatQuoteGroupedNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const isInteger = Math.abs(rounded - Math.round(rounded)) < 1e-9;
  if (isInteger) {
    return String(Math.round(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  const [intPart, fraction] = rounded.toFixed(2).split('.');
  return `${intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${fraction}`;
}

export function customerCurrencyLabel(currency: string): string {
  const code = currency.trim().toUpperCase();
  if (code === 'UZS') {
    return 'сум';
  }

  return code;
}

export function formatQuoteCustomerPrice(
  value: { toString(): string } | number | null,
  currency: string,
): string {
  const amount = toNumber(value);
  if (amount == null) {
    return '—';
  }

  return `${formatQuoteGroupedNumber(amount)} ${customerCurrencyLabel(currency)}`;
}

export function quoteVolumeM2(item: QuoteDocumentItemSnapshot): string {
  const sheetArea = toNumber(item.areaM2);
  if (sheetArea != null && item.sheetsCount > 0) {
    return ` ${formatQuoteGroupedNumber(sheetArea * item.sheetsCount)}`;
  }

  const required = toNumber(item.requiredAreaM2);
  return required == null ? '—' : ` ${formatQuoteGroupedNumber(required)}`;
}

export function quoteSizeLabel(item: QuoteDocumentItemSnapshot): string {
  if ((item.customWidthMm ?? 0) > 0 && (item.customHeightMm ?? 0) > 0) {
    return panelSizeDisplayName(item.customWidthMm!, item.customHeightMm!);
  }

  return item.panelSizeName;
}

export function formatQuoteThickness(
  thicknessMm: { toString(): string } | number,
): string {
  const amount = toNumber(thicknessMm);
  if (amount == null) {
    return `${thicknessMm.toString()} мм`;
  }

  return `${formatQuoteGroupedNumber(amount)} мм`;
}

export function money(value: { toString(): string } | number): string {
  return Number(value.toString()).toFixed(2);
}

const QUOTE_VERSION_LABEL = /КП v\d+/i;
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Customer-facing DOCX/PDF body must not include CRM version labels or Quote ids.
 * Internal Quote.versionNumber remains in the database and API.
 */
export function customerDocumentMetaViolations(
  text: string,
  quote?: Pick<QuoteDocumentSnapshot, 'id' | 'versionNumber'>,
): string[] {
  const violations: string[] = [];
  if (QUOTE_VERSION_LABEL.test(text)) {
    violations.push('quote-version-label');
  }
  if (UUID_PATTERN.test(text)) {
    violations.push('quote-uuid');
  }
  if (quote?.id && text.includes(quote.id)) {
    violations.push('quote-id');
  }
  const shortId = quote?.id?.slice(0, 8);
  if (shortId && text.includes(shortId)) {
    violations.push('quote-short-id');
  }
  if (
    quote?.versionNumber != null &&
    text.includes(`КП v${quote.versionNumber}`)
  ) {
    violations.push('quote-version-number');
  }
  return [...new Set(violations)];
}

export function buildQuoteDocumentModel(
  quote: QuoteDocumentSnapshot,
): QuoteDocumentModel {
  const production =
    quote.productionTerms?.trim() ||
    formatQuoteDayRange(quote.productionDaysFrom, quote.productionDaysTo);
  const delivery =
    quote.deliveryTerms?.trim() ||
    formatQuoteDayRange(quote.deliveryDaysFrom, quote.deliveryDaysTo);
  const itemRows = quote.items.map((item) => [
    quoteSizeLabel(item),
    formatQuoteThickness(item.thicknessMm),
    quoteVolumeM2(item),
    formatQuoteCustomerPrice(
      item.pricePerM2,
      item.currencyCode ?? quote.displayCurrency,
    ),
    production,
    delivery,
  ]);
  const commercialNote = quote.commercialNote?.trim() || null;
  const application = resolveQuoteOfferApplication(quote.items);
  const tableRows = buildGroupedTableRows(quote.items, itemRows);
  const extraSections = quoteDocumentExtraSections(
    quote.componentSnapshots ?? [],
  );
  const totals = quoteDocumentTotalsLines(quote.componentSnapshots ?? []);
  const customerSubtitle = customerQuoteSubtitle(
    (quote.componentSnapshots ?? []).map((snapshot) => snapshot.kind),
  );

  return {
    offerHeading: quoteOfferHeading(application),
    offerHeadingPhrase: quoteOfferHeadingPhrase(application),
    priceHeader: QUOTE_PRICE_HEADER,
    itemRows,
    tableRows,
    extraSections,
    totalsLines: totals.lines,
    grandTotalLine: totals.grandTotal,
    customerSubtitle,
    commercialNote,
    validUntilBullet: `• Все цены действительны до  ${formatQuoteValidUntilDate(quote.validUntil)}.`,
    documentDateLine: `Дата: ${formatQuoteDocumentDate(quote.createdAt)}`,
  };
}

function buildGroupedTableRows(
  items: QuoteDocumentItemSnapshot[],
  itemRows: string[][],
): QuoteDocumentTableRow[] {
  const groupTitles = items.map(
    (item) => item.calculationGroupTitle?.trim() || '',
  );
  const distinctGroups = new Set(groupTitles.filter(Boolean));
  if (distinctGroups.size <= 1) {
    return itemRows.map((values) => ({ kind: 'item' as const, values }));
  }

  const rows: QuoteDocumentTableRow[] = [];
  let currentGroup: string | null = null;
  for (const [index, values] of itemRows.entries()) {
    const title = groupTitles[index] || `Расчёт ${index + 1}`;
    if (title !== currentGroup) {
      currentGroup = title;
      rows.push({
        kind: 'group',
        values: [title, '', '', '', '', ''],
      });
    }
    rows.push({ kind: 'item', values });
  }
  return rows;
}

function toNumber(
  value: { toString(): string } | number | null | undefined,
): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  const amount = Number(value.toString());
  return Number.isFinite(amount) ? amount : null;
}
