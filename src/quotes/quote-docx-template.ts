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
  QUOTE_OFFER_HEADING_PREFIX,
  QUOTE_TABLE_HEADERS,
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
  fillQuoteReference(dom, model.quoteReferenceLine);
  fillOfferHeading(dom, model.offerHeadingPhrase);
  fillNoteSection(dom, model.commercialNote, model.validUntilBullet);
  fillDocumentDate(dom, model.documentDateLine);
  centerAccentRule(dom);
  removeTaglineSpacerBreaks(dom);

  const serialized = new XMLSerializer().serializeToString(dom);
  if (serialized.startsWith('<?xml')) {
    return serialized;
  }

  const newline = xml.startsWith(`${XML_DECLARATION}\r\n`) ? '\r\n' : '\n';
  return `${XML_DECLARATION}${newline}${serialized}`;
}

function fillQuoteReference(
  dom: XmlDocument,
  quoteReferenceLine: string,
): void {
  const subtitle = findParagraph(
    dom,
    (text) => normalizeSpace(text) === 'на поставку HPL-панелей',
  );
  if (!subtitle) {
    throw new Error('UZHPL quote template is missing the quote subtitle');
  }
  replaceParagraphText(
    dom,
    subtitle,
    `${quoteReferenceLine} · на поставку HPL-панелей`,
  );
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
  const emptyPrototype =
    body.find((row) => rowText(row).trim().length === 0) ?? prototype;
  const minBodyRows = body.length;
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

  const padding = Math.max(0, minBodyRows - tableRows.length);
  for (let index = 0; index < padding; index += 1) {
    const blank = emptyPrototype.cloneNode(true) as XmlElement;
    clearTableRow(dom, blank);
    table.appendChild(blank);
  }
}

function markHeaderRowRepeat(dom: XmlDocument, header: XmlElement): void {
  let trPr = childElements(header, 'trPr')[0];
  if (!trPr) {
    trPr = dom.createElement('w:trPr');
    header.insertBefore(trPr, header.firstChild);
  }
  if (!childElements(trPr, 'tblHeader')[0]) {
    trPr.appendChild(dom.createElement('w:tblHeader'));
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

function clearTableRow(dom: XmlDocument, row: XmlElement): void {
  for (const cell of childElements(row, 'tc')) {
    setCellText(dom, cell, '');
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
