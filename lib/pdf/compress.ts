import { execFile } from 'node:child_process';
import { writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Nén PDF bằng Ghostscript (/ebook ≈150dpi — giảm ảnh nhúng, giữ chữ rõ) để
 * tiết kiệm storage R2. AN TOÀN: lỗi gs / không cài / không nhỏ hơn → trả
 * NGUYÊN BẢN (không bao giờ làm hỏng/phình file).
 */
export async function compressPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'pdfz-'));
  const inPath = join(dir, 'in.pdf');
  const outPath = join(dir, 'out.pdf');
  try {
    await writeFile(inPath, bytes);
    await execFileAsync('gs', [
      '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.4', '-dPDFSETTINGS=/ebook',
      '-dNOPAUSE', '-dQUIET', '-dBATCH', '-dDetectDuplicateImages=true',
      `-sOutputFile=${outPath}`, inPath,
    ], { timeout: 60_000 });
    const out = await readFile(outPath);
    return out.length > 0 && out.length < bytes.length ? new Uint8Array(out) : bytes;
  } catch {
    return bytes; // gs lỗi/chưa cài → giữ nguyên bản
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
