import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from '@xmldom/xmldom';
import JSZip from 'jszip';
import {
  CUSTOMER_QUOTE_SUBTITLE,
  CUSTOMER_QUOTE_TITLE,
  QUOTE_OFFER_HEADING_PREFIX,
  QUOTE_TABLE_HEADERS,
  customerDocumentMetaViolations,
  type QuoteDocumentModel,
} from './quote-document.model';

export const UZHPL_QUOTE_TEMPLATE_PATH = resolveUzhplQuoteTemplatePath();

function resolveUzhplQuoteTemplatePath(): string {
  const candidates = [
    join(__dirname, 'templates', 'uzhpl-quote.docx'),
    join(process.cwd(), 'src', 'quotes', 'templates', 'uzhpl-quote.docx'),
    join(
      process.cwd(),
      'dist',
      'src',
      'quotes',
      'templates',
      'uzhpl-quote.docx',
    ),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `UZHPL quote template not found. Tried: ${candidates.join(', ')}`,
    );
  }
  return found;
}

const DOCUMENT_XML = 'word/document.xml';
const XML_DECLARATION =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const OFFER_HEADERS = QUOTE_TABLE_HEADERS;

export function loadUzhplQuoteTemplate(): Buffer {
  return readFileSync(UZHPL_QUOTE_TEMPLATE_PATH);
}

export async function fillUzhplQuoteTemplate(
  template: Buffer,
  model: QuoteDocumentModel,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(template);
  const documentFile = zip.file(DOCUMENT_XML);
  if (!documentFile) {
    throw new Error('UZHPL quote template is missing word/document.xml');
  }

  const xml = await documentFile.async('string');
  zip.file(DOCUMENT_XML, fillDocumentXml(xml, model));

  return Buffer.from(
    await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  );
}

export function fillDocumentXml(
  xml: string,
  model: QuoteDocumentModel,
): string {
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  const parseError = dom.getElementsByTagName('parsererror')[0];
  if (parseError) {
    throw new Error('Failed to parse UZHPL quote template XML');
  }

  fillOfferTable(dom, model);
  fillExtraQuoteSections(dom, model);
  // Table section heading only ("Предложение на поставку …"). The client
  // header subtitle is owned by the golden template and must stay static.
  fillOfferHeading(dom, model.offerHeadingPhrase);
  fillNoteSection(dom, model.commercialNote, model.validUntilBullet);
  fillDocumentDate(dom, model.documentDateLine);
  centerAccentRule(dom);
  removeTaglineSpacerBreaks(dom);
  fillCustomerSubtitle(dom, model.customerSubtitle);
  stripLastRenderedPageBreaks(dom);
  keepRequisitesBlockTogether(dom);

  const serialized = serializeDocumentXml(dom, xml);
  const visibleText = xmlDocumentText(serialized);
  const violations = customerDocumentMetaViolations(visibleText);
  if (violations.length > 0) {
    throw new Error(
      `Customer Quote document contains internal CRM metadata: ${violations.join(', ')}`,
    );
  }
  if (!visibleText.includes(CUSTOMER_QUOTE_TITLE)) {
    throw new Error(
      'Customer Quote document is missing КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ',
    );
  }
  if (!visibleText.includes(model.customerSubtitle)) {
    throw new Error(
      'Customer Quote document is missing the composition subtitle',
    );
  }
  if (!visibleText.includes(CUSTOMER_QUOTE_SUBTITLE)) {
    throw new Error(
      'Customer Quote document is missing the HPL customer-facing phrase',
    );
  }

  return serialized;
}

/**
 * Keep the source DOCX unchanged for Word users, but make the copy passed to
 * a PDF renderer obey the actual page content width. The golden template's
 * offer table is intentionally fixed-width; its original 9678 DXA width is
 * wider than this template's 9412 DXA page area.
 */
export function fitQuoteOfferTableToPageWidth(xml: string): string {
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  const parseError = dom.getElementsByTagName('parsererror')[0];
  if (parseError) {
    throw new Error('Failed to parse UZHPL quote template XML');
  }

  const table = findOfferTable(dom);
  if (!table) {
    return xml;
  }

  const section = elementsByLocalName(dom, 'sectPr').at(-1);
  const pageSize = section ? childElements(section, 'pgSz')[0] : undefined;
  const pageMargins = section ? childElements(section, 'pgMar')[0] : undefined;
  const pageWidth = readWordNumber(pageSize, 'w');
  const leftMargin = readWordNumber(pageMargins, 'left');
  const rightMargin = readWordNumber(pageMargins, 'right');
  if (pageWidth == null || leftMargin == null || rightMargin == null) {
    return xml;
  }

  const tableProperties = childElements(table, 'tblPr')[0];
  const tableWidth = tableProperties
    ? childElements(tableProperties, 'tblW')[0]
    : undefined;
  const tableIndent = tableProperties
    ? Math.max(
        0,
        readWordNumber(childElements(tableProperties, 'tblInd')[0], 'w') ?? 0,
      )
    : 0;
  const availableWidth = pageWidth - leftMargin - rightMargin - tableIndent;
  if (!tableProperties || availableWidth <= 0) {
    return xml;
  }

  const tableGrid = childElements(table, 'tblGrid')[0];
  if (!tableGrid) {
    return xml;
  }
  const grid = childElements(tableGrid, 'gridCol');
  const sourceWidths = grid
    .map((column) => readWordNumber(column, 'w'))
    .filter((width): width is number => width != null && width > 0);
  const sourceWidth = sourceWidths.reduce((sum, width) => sum + width, 0);
  if (sourceWidth <= availableWidth || sourceWidths.length === 0) {
    return xml;
  }

  const targetWidths = scaleWidths(sourceWidths, availableWidth);
  if (tableWidth) {
    setWordNumber(tableWidth, 'w', availableWidth);
    tableWidth.setAttribute('w:type', 'dxa');
  }

  const gridColumns = childElements(tableGrid, 'gridCol');
  gridColumns.forEach((column, index) => {
    const width = targetWidths[index];
    if (width != null) {
      setWordNumber(column, 'w', width);
    }
  });

  for (const row of childElements(table, 'tr')) {
    let gridIndex = 0;
    for (const cell of childElements(row, 'tc')) {
      const cellProperties = childElements(cell, 'tcPr')[0];
      const span = Math.max(
        1,
        cellProperties
          ? (readWordNumber(
              childElements(cellProperties, 'gridSpan')[0],
              'val',
            ) ?? 1)
          : 1,
      );
      const width = targetWidths
        .slice(gridIndex, gridIndex + span)
        .reduce((sum, value) => sum + value, 0);
      const cellWidth = cellProperties
        ? childElements(cellProperties, 'tcW')[0]
        : undefined;
      if (cellWidth && width > 0) {
        setWordNumber(cellWidth, 'w', width);
        cellWidth.setAttribute('w:type', 'dxa');
      }
      gridIndex += span;
    }
  }

  return serializeDocumentXml(dom, xml);
}

function serializeDocumentXml(dom: XmlDocument, sourceXml: string): string {
  const serialized = new XMLSerializer().serializeToString(dom);
  if (serialized.startsWith('<?xml')) {
    return serialized;
  }

  const newline = sourceXml.startsWith(`${XML_DECLARATION}\r\n`)
    ? '\r\n'
    : '\n';
  return `${XML_DECLARATION}${newline}${serialized}`;
}

const PRODUCTION_COLUMN_INDEX = 4;
const MIN_PRODUCTION_COLUMN_WIDTH = 1720;
const MIN_DONOR_COLUMN_WIDTH = 900;

function scaleWidths(sourceWidths: number[], targetWidth: number): number[] {
  const sourceWidth = sourceWidths.reduce((sum, width) => sum + width, 0);
  const scaled = sourceWidths.map(
    (width) => (width * targetWidth) / sourceWidth,
  );
  const result = scaled.map((width) => Math.floor(width));
  let remainder = targetWidth - result.reduce((sum, width) => sum + width, 0);
  const order = scaled
    .map((width, index) => ({ index, fraction: width - Math.floor(width) }))
    .sort((left, right) => right.fraction - left.fraction);
  for (let index = 0; remainder > 0; index += 1) {
    result[order[index % order.length].index] += 1;
    remainder -= 1;
  }
  return ensureColumnMinimum(
    result,
    PRODUCTION_COLUMN_INDEX,
    MIN_PRODUCTION_COLUMN_WIDTH,
  );
}

function ensureColumnMinimum(
  widths: number[],
  index: number,
  minimum: number,
): number[] {
  const current = widths[index];
  if (current == null || current >= minimum || widths.length <= 1) {
    return widths;
  }

  const next = [...widths];
  let deficit = minimum - current;
  next[index] = minimum;
  const donors = next
    .map((width, donorIndex) => ({ donorIndex, width }))
    .filter((column) => column.donorIndex !== index)
    .sort((left, right) => right.width - left.width);
  for (const donor of donors) {
    if (deficit <= 0) {
      break;
    }
    const spare = Math.max(0, next[donor.donorIndex] - MIN_DONOR_COLUMN_WIDTH);
    const take = Math.min(deficit, spare);
    next[donor.donorIndex] -= take;
    deficit -= take;
  }
  if (deficit > 0) {
    next[index] = minimum - deficit;
  }
  return next;
}

function readWordNumber(
  element: XmlElement | undefined,
  attribute: string,
): number | null {
  if (!element) {
    return null;
  }
  const raw = element.getAttribute(`w:${attribute}`);
  const value = Number(raw);
  if (!raw || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function setWordNumber(
  element: XmlElement,
  attribute: string,
  value: number,
): void {
  element.setAttribute(`w:${attribute}`, String(value));
}

function stripLastRenderedPageBreaks(dom: XmlDocument): void {
  for (const node of elementsByLocalName(dom, 'lastRenderedPageBreak')) {
    node.parentNode?.removeChild(node);
  }
}

function keepRequisitesBlockTogether(dom: XmlDocument): void {
  const heading = findParagraph(dom, (text) => text.includes('Реквизиты:'));
  if (!heading) {
    return;
  }

  let current: XmlNode | null = heading;
  while (current && !(isElement(current) && current.localName === 'tbl')) {
    current = current.parentNode;
  }
  if (!current || !isElement(current)) {
    return;
  }

  for (const row of childElements(current, 'tr')) {
    let trPr = childElements(row, 'trPr')[0];
    if (!trPr) {
      trPr = dom.createElement('w:trPr');
      row.insertBefore(trPr, row.firstChild);
    }
    if (!childElements(trPr, 'cantSplit')[0]) {
      trPr.appendChild(dom.createElement('w:cantSplit'));
    }
  }
}

/**
 * The golden template vertically positioned its closing tagline with thirteen
 * manual line breaks. As the offer table grows, those breaks spill the two-line
 * tagline onto an otherwise empty page. Keep the branding, but let it follow
 * the signature naturally so variable-length quotes paginate correctly.
 */
function removeTaglineSpacerBreaks(dom: XmlDocument): void {
  const tagline = findParagraph(dom, (text) =>
    text.includes('UZHPL — надёжные решения из HPL'),
  );
  if (!tagline) {
    return;
  }

  for (const child of Array.from(tagline.childNodes)) {
    if (!isElement(child) || child.localName === 'pPr') {
      continue;
    }
    const hasText = elementsByLocalName(child, 't').length > 0;
    const hasBreak = elementsByLocalName(child, 'br').length > 0;
    if (hasBreak && !hasText) {
      tagline.removeChild(child);
      continue;
    }
    if (hasText) {
      break;
    }
  }
}

function fillExtraQuoteSections(
  dom: XmlDocument,
  model: QuoteDocumentModel,
): void {
  if (model.extraSections.length === 0) {
    return;
  }

  const table = findOfferTable(dom);
  if (!table?.parentNode) {
    return;
  }

  const prototype =
    findParagraph(dom, (text) => text.includes(QUOTE_OFFER_HEADING_PREFIX)) ??
    findParagraph(dom, (text) => text.trim().startsWith('Дата'));
  if (!prototype) {
    return;
  }

  const fragments: XmlElement[] = [];
  for (const section of model.extraSections) {
    fragments.push(cloneParagraphWithText(dom, prototype, section.heading, true));
    for (const line of section.lines) {
      fragments.push(cloneParagraphWithText(dom, prototype, line, false));
    }
  }
  if (model.grandTotalLine) {
    fragments.push(
      cloneParagraphWithText(dom, prototype, model.grandTotalLine, true),
    );
  }
  for (const line of model.totalsLines) {
    fragments.push(cloneParagraphWithText(dom, prototype, line, false));
  }

  let insertBefore = table.nextSibling;
  for (const fragment of fragments) {
    table.parentNode.insertBefore(fragment, insertBefore);
  }
}

function cloneParagraphWithText(
  dom: XmlDocument,
  prototype: XmlElement,
  text: string,
  bold: boolean,
): XmlElement {
  const clone = prototype.cloneNode(true) as XmlElement;
  replaceParagraphText(dom, clone, text);
  if (bold) {
    for (const run of childElements(clone, 'r')) {
      const rPr = childElements(run, 'rPr')[0];
      if (rPr && !childElements(rPr, 'b')[0]) {
        rPr.appendChild(dom.createElement('w:b'));
      }
    }
  }
  return clone;
}

function fillOfferTable(dom: XmlDocument, model: QuoteDocumentModel): void {
  const table = findOfferTable(dom);
  if (!table) {
    throw new Error('UZHPL quote template is missing the offer table');
  }

  const rows = childElements(table, 'tr');
  const header = rows[0];
  const body = rows.slice(1);
  if (!header || body.length === 0) {
    throw new Error('UZHPL quote template offer table has no data rows');
  }

  markHeaderRowRepeat(dom, header);

  const prototype =
    body.find((row) => rowText(row).trim().length > 0) ?? body[0];
  const tableRows =
    model.tableRows.length > 0
      ? model.tableRows
      : model.itemRows.map((values) => ({ kind: 'item' as const, values }));

  for (const row of body) {
    table.removeChild(row);
  }

  for (const entry of tableRows) {
    const row = prototype.cloneNode(true) as XmlElement;
    fillTableRow(dom, row, entry.values);
    if (entry.kind === 'group') {
      emphasizeGroupRow(row);
    }
    table.appendChild(row);
  }
}

function markHeaderRowRepeat(dom: XmlDocument, header: XmlElement): void {
  let trPr = childElements(header, 'trPr')[0];
  if (!trPr) {
    trPr = dom.createElement('w:trPr');
    header.insertBefore(trPr, header.firstChild);
  }
  const repeatHeader = childElements(trPr, 'tblHeader')[0];
  if (repeatHeader) {
    repeatHeader.setAttribute('w:val', 'true');
  } else {
    const newRepeatHeader = dom.createElement('w:tblHeader');
    newRepeatHeader.setAttribute('w:val', 'true');
    trPr.appendChild(newRepeatHeader);
  }
}

function emphasizeGroupRow(row: XmlElement): void {
  for (const cell of childElements(row, 'tc')) {
    const paragraphs = childElements(cell, 'p');
    for (const paragraph of paragraphs) {
      const runs = childElements(paragraph, 'r');
      for (const run of runs) {
        const rPr = childElements(run, 'rPr')[0];
        if (rPr && !childElements(rPr, 'b')[0]) {
          rPr.appendChild(run.ownerDocument!.createElement('w:b'));
        }
      }
    }
  }
}

function centerAccentRule(dom: XmlDocument): void {
  const paragraph = findParagraph(dom, (text) => /^━+$/.test(text.trim()));
  if (!paragraph) {
    return;
  }

  let pPr = childElements(paragraph, 'pPr')[0];
  if (!pPr) {
    pPr = dom.createElement('w:pPr');
    paragraph.insertBefore(pPr, paragraph.firstChild);
  }

  let jc = childElements(pPr, 'jc')[0];
  if (!jc) {
    jc = dom.createElement('w:jc');
    pPr.appendChild(jc);
  }
  jc.setAttribute('w:val', 'center');

  let ind = childElements(pPr, 'ind')[0];
  if (!ind) {
    ind = dom.createElement('w:ind');
    pPr.appendChild(ind);
  }
  ind.setAttribute('w:left', '0');
  ind.setAttribute('w:right', '0');
  ind.setAttribute('w:firstLine', '0');
}

function fillCustomerSubtitle(dom: XmlDocument, subtitleText: string): void {
  const subtitle =
    findParagraph(dom, (text) => {
      const normalized = normalizeSpace(text);
      return (
        normalized === CUSTOMER_QUOTE_SUBTITLE ||
        normalized.startsWith(CUSTOMER_QUOTE_SUBTITLE) ||
        (/^КП v\d+\s*·/i.test(normalized) &&
          normalized.includes(CUSTOMER_QUOTE_SUBTITLE))
      );
    }) ??
    findParagraph(
      dom,
      (text) =>
        normalizeSpace(text).includes(CUSTOMER_QUOTE_SUBTITLE) &&
        !normalizeSpace(text).includes(QUOTE_OFFER_HEADING_PREFIX),
    );
  if (!subtitle) {
    throw new Error('UZHPL quote template is missing the customer subtitle');
  }

  replaceParagraphText(dom, subtitle, subtitleText);
}

function xmlDocumentText(xml: string): string {
  return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
    .map((match) => match[1])
    .join('');
}

function fillOfferHeading(dom: XmlDocument, phrase: string): void {
  const heading = findParagraph(dom, (text) =>
    text.includes(QUOTE_OFFER_HEADING_PREFIX),
  );
  if (!heading) {
    throw new Error('UZHPL quote template is missing the offer heading');
  }

  const nodes = textNodes(heading);
  const suffix = nodes.find((node) =>
    (node.textContent ?? '').includes('интерьерных'),
  );
  const target = suffix ?? nodes[nodes.length - 1];
  if (!target) {
    throw new Error('UZHPL quote template heading has no text run');
  }

  target.textContent = ` ${phrase}`;
  if (target.setAttribute) {
    target.setAttribute('xml:space', 'preserve');
  }
}

function textNodes(root: XmlElement): XmlElement[] {
  return elementsByLocalName(root, 't');
}

function fillTableRow(
  dom: XmlDocument,
  row: XmlElement,
  values: string[],
): void {
  const cells = childElements(row, 'tc');
  for (let index = 0; index < cells.length; index += 1) {
    setCellText(dom, cells[index], values[index] ?? '');
  }
}

function fillNoteSection(
  dom: XmlDocument,
  commercialNote: string | null,
  validUntilBullet: string,
): void {
  const noteParagraph = findParagraph(dom, (text) =>
    text.includes('Цена указана'),
  );
  if (noteParagraph) {
    if (commercialNote) {
      const bullet = commercialNote.startsWith('•')
        ? commercialNote
        : `• ${commercialNote}`;
      replaceParagraphText(dom, noteParagraph, bullet);
    } else {
      noteParagraph.parentNode?.removeChild(noteParagraph);
    }
  }

  const validityParagraph = findParagraph(dom, (text) =>
    text.includes('Все цены действительны'),
  );
  if (validityParagraph) {
    replaceParagraphText(dom, validityParagraph, validUntilBullet);
  }
}

function fillDocumentDate(dom: XmlDocument, documentDateLine: string): void {
  const dateParagraph = findParagraph(dom, (text) =>
    text.trim().startsWith('Дата'),
  );
  if (!dateParagraph) {
    throw new Error('UZHPL quote template is missing the automatic date line');
  }

  replaceParagraphText(dom, dateParagraph, documentDateLine);
}

function findOfferTable(dom: XmlDocument): XmlElement | null {
  for (const table of elementsByLocalName(dom, 'tbl')) {
    const firstRow = childElements(table, 'tr')[0];
    if (!firstRow) {
      continue;
    }

    const headers = childElements(firstRow, 'tc').map((cell) =>
      normalizeSpace(elementText(cell)),
    );
    if (
      headers.length === OFFER_HEADERS.length &&
      OFFER_HEADERS.every((header, index) => headers[index] === header)
    ) {
      return table;
    }
  }

  return null;
}

function findParagraph(
  dom: XmlDocument,
  predicate: (text: string) => boolean,
): XmlElement | null {
  for (const paragraph of elementsByLocalName(dom, 'p')) {
    if (predicate(elementText(paragraph))) {
      return paragraph;
    }
  }

  return null;
}

function setCellText(dom: XmlDocument, cell: XmlElement, text: string): void {
  const paragraphs = childElements(cell, 'p');
  const paragraph = paragraphs[0];
  if (!paragraph) {
    return;
  }

  for (const extra of paragraphs.slice(1)) {
    cell.removeChild(extra);
  }

  replaceParagraphText(dom, paragraph, text);
}

function replaceParagraphText(
  dom: XmlDocument,
  paragraph: XmlElement,
  text: string,
): void {
  const runProperties = firstRunProperties(paragraph);
  const kept: XmlNode[] = [];
  for (const child of Array.from(paragraph.childNodes)) {
    if (isElement(child) && child.localName === 'pPr') {
      kept.push(child);
    }
  }
  while (paragraph.firstChild) {
    paragraph.removeChild(paragraph.firstChild);
  }
  for (const child of kept) {
    paragraph.appendChild(child);
  }

  if (!text) {
    return;
  }

  const run = dom.createElement('w:r');
  if (runProperties) {
    run.appendChild(runProperties.cloneNode(true));
  }
  const textNode = dom.createElement('w:t');
  if (/^\s|\s$/.test(text) || text.includes('  ')) {
    textNode.setAttribute('xml:space', 'preserve');
  }
  textNode.textContent = text;
  run.appendChild(textNode);
  paragraph.appendChild(run);
}

function firstRunProperties(paragraph: XmlElement): XmlElement | null {
  for (const child of Array.from(paragraph.childNodes)) {
    if (!isElement(child) || child.localName !== 'r') {
      continue;
    }
    const properties = childElements(child, 'rPr')[0];
    if (properties) {
      return properties;
    }
  }

  return null;
}

function childElements(el: XmlElement, localName: string): XmlElement[] {
  const matches: XmlElement[] = [];
  for (const child of Array.from(el.childNodes)) {
    if (isElement(child) && child.localName === localName) {
      matches.push(child);
    }
  }
  return matches;
}

function elementsByLocalName(root: XmlNode, localName: string): XmlElement[] {
  const matches: XmlElement[] = [];
  const visit = (node: XmlNode): void => {
    if (isElement(node) && node.localName === localName) {
      matches.push(node);
    }
    for (const child of Array.from(node.childNodes)) {
      visit(child);
    }
  };
  visit(root);
  return matches;
}

function elementText(el: XmlElement): string {
  const parts: string[] = [];
  const visit = (node: XmlNode): void => {
    if (isElement(node) && node.localName === 't') {
      parts.push(node.textContent ?? '');
      return;
    }
    for (const child of Array.from(node.childNodes)) {
      visit(child);
    }
  };
  visit(el);
  return parts.join('');
}

function rowText(row: XmlElement): string {
  return childElements(row, 'tc').map(elementText).join('');
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isElement(node: XmlNode): node is XmlElement {
  return node.nodeType === 1;
}
