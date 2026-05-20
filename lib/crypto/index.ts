import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface KeyConfig {
  keys: Record<string, string>; // version -> 64-char hex key
  current: string;
}

const ALGO = 'aes-256-gcm';

function keyBuffer(config: KeyConfig, version: string): Buffer {
  const hex = config.keys[version];
  if (!hex) throw new Error(`Unknown encryption key version: ${version}`);
  return Buffer.from(hex, 'hex');
}

export function encrypt(plaintext: string, config: KeyConfig): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, keyBuffer(config, config.current), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${config.current}:${iv.toString('hex')}:${tag.toString('hex')}:${data.toString('hex')}`;
}

export function decrypt(ciphertext: string, config: KeyConfig): string {
  const [version, ivHex, tagHex, dataHex] = ciphertext.split(':');
  if (!version || !ivHex || !tagHex || !dataHex) {
    throw new Error('Malformed ciphertext');
  }
  const decipher = createDecipheriv(ALGO, keyBuffer(config, version), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

export function needsReEncryption(ciphertext: string, currentVersion: string): boolean {
  return ciphertext.split(':')[0] !== currentVersion;
}
