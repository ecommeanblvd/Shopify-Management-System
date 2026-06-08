import { execFile } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Extract layout-preserving text from a PDF using poppler's `pdftotext -layout`.
 * The carrier parsers depend on the column alignment this mode produces.
 * Writes to a temp file (pdftotext reads a path), runs, then cleans up.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ratecard-'));
  const pdfPath = join(dir, 'in.pdf');
  try {
    await writeFile(pdfPath, bytes);
    const { stdout } = await execFileAsync('pdftotext', ['-layout', pdfPath, '-'], {
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
