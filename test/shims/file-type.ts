type FileTypeResult = {
  ext: string;
  mime: string;
};

function asBytes(input: Uint8Array | ArrayBuffer): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) {
    return false;
  }

  return signature.every((value, index) => bytes[index] === value);
}

/**
 * E2E-only stand-in for ESM `file-type@22`. Production still uses the real package.
 * Magic bytes cover the mime types accepted by FilesService.
 */
export async function fileTypeFromBuffer(
  input: Uint8Array | ArrayBuffer,
): Promise<FileTypeResult | undefined> {
  const bytes = asBytes(input);

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ext: 'png', mime: 'image/png' };
  }

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }

  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { ext: 'webp', mime: 'image/webp' };
  }

  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
    return { ext: 'pdf', mime: 'application/pdf' };
  }

  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    return { ext: 'zip', mime: 'application/zip' };
  }

  return undefined;
}
