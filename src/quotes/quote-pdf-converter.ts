import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServiceUnavailableException } from '@nestjs/common';
import JSZip from 'jszip';
import { fitQuoteOfferTableToPageWidth } from './quote-docx-template';

const execFileAsync = promisify(execFile);
const WORD_PDF_FORMAT = 17;

export async function convertDocxToPdf(docx: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'uzhpl-quote-pdf-'));
  const input = join(dir, 'quote.docx');
  const output = join(dir, 'quote.pdf');

  try {
    await writeFile(input, await normalizeDocxForPdf(docx));
    const errors: string[] = [];
    if (process.platform === 'win32') {
      try {
        await convertWithWord(dir, input, output);
      } catch (error) {
        errors.push(errorMessage(error));
      }
    }

    if (!(await fileLooksLikePdf(output))) {
      try {
        await convertWithLibreOffice(input, dir);
      } catch (error) {
        errors.push(errorMessage(error));
      }
    }

    const pdf = await fileLooksLikePdf(output).then(async (ok) =>
      ok ? readFile(output) : null,
    );
    if (!pdf) {
      throw new ServiceUnavailableException(
        `Не удалось преобразовать КП DOCX в PDF. ${errors.join(' ')}`.trim(),
      );
    }

    return pdf;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function normalizeDocxForPdf(docx: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docx);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) {
    throw new Error('Quote DOCX is missing word/document.xml');
  }

  const xml = await documentFile.async('string');
  zip.file('word/document.xml', fitQuoteOfferTableToPageWidth(xml));
  return Buffer.from(
    await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  );
}

async function convertWithWord(
  dir: string,
  input: string,
  output: string,
): Promise<void> {
  const scriptPath = join(dir, 'convert.ps1');
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$word = New-Object -ComObject Word.Application',
    '$word.Visible = $false',
    '$word.DisplayAlerts = 0',
    'try {',
    `  $doc = $word.Documents.Open('${escapePs(input)}', $false, $true)`,
    `  $out = '${escapePs(output)}'`,
    `  $doc.SaveAs([ref]$out, [ref]${WORD_PDF_FORMAT})`,
    '  $doc.Close($false)',
    '} finally {',
    '  $word.Quit()',
    '}',
  ].join('\r\n');
  await writeFile(scriptPath, script, 'utf8');
  await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { timeout: 90_000, windowsHide: true },
  );
}

async function convertWithLibreOffice(
  input: string,
  outDir: string,
): Promise<void> {
  const binary = resolveLibreOffice();
  await execFileAsync(
    binary,
    [
      '--headless',
      '--norestore',
      '--nolockcheck',
      '--convert-to',
      'pdf',
      '--outdir',
      outDir,
      input,
    ],
    { timeout: 90_000, windowsHide: true },
  );
}

function resolveLibreOffice(): string {
  if (process.env.LIBREOFFICE_PATH) {
    return process.env.LIBREOFFICE_PATH;
  }

  if (process.platform === 'win32') {
    return 'C:\\Program Files\\LibreOffice\\program\\soffice.exe';
  }

  return 'soffice';
}

async function fileLooksLikePdf(path: string): Promise<boolean> {
  try {
    const header = await readFile(path);
    return header.subarray(0, 4).equals(Buffer.from('%PDF'));
  } catch {
    return false;
  }
}

function escapePs(value: string): string {
  return value.replace(/'/g, "''");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
