import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export function fileStoragePath(): string {
  const configured = process.env.FILE_STORAGE_PATH?.trim();
  if (!configured) return resolve(process.cwd(), 'uploads');
  return isAbsolute(configured)
    ? configured
    : resolve(process.cwd(), configured);
}

export async function ensureFileStorage(): Promise<string> {
  const directory = fileStoragePath();
  await mkdir(directory, { recursive: true });
  await access(directory, constants.R_OK | constants.W_OK);
  return directory;
}
