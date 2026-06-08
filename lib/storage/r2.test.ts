import { afterEach, describe, expect, it, vi } from 'vitest';

const send = vi.fn();
vi.mock('@aws-sdk/client-s3', () => ({
  // class/function (not arrow) so `new …()` works; arrows can't construct.
  S3Client: class { send = send; },
  PutObjectCommand: vi.fn(function PutObjectCommand(input: unknown) { return { __type: 'Put', input }; }),
  GetObjectCommand: vi.fn(function GetObjectCommand(input: unknown) { return { __type: 'Get', input }; }),
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://signed.example/obj'),
}));

const ENV = {
  R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'ak',
  R2_SECRET_ACCESS_KEY: 'sk', R2_BUCKET: 'bucket',
};

afterEach(() => { vi.clearAllMocks(); for (const k of Object.keys(ENV)) delete process.env[k]; });

describe('r2 storage', () => {
  it('isStorageConfigured reflects env presence', async () => {
    const mod = await import('./r2');
    expect(mod.isStorageConfigured()).toBe(false);
    Object.assign(process.env, ENV);
    expect(mod.isStorageConfigured()).toBe(true);
  });

  it('putObject sends PutObjectCommand with bucket/key/body/contentType', async () => {
    Object.assign(process.env, ENV);
    const { putObject } = await import('./r2');
    await putObject('rate-cards/a/x.pdf', new Uint8Array([1, 2, 3]), 'application/pdf');
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    expect(PutObjectCommand).toHaveBeenCalledWith(expect.objectContaining({
      Bucket: 'bucket', Key: 'rate-cards/a/x.pdf', ContentType: 'application/pdf',
    }));
    expect(send).toHaveBeenCalledOnce();
  });

  it('getSignedDownloadUrl returns a presigned URL', async () => {
    Object.assign(process.env, ENV);
    const { getSignedDownloadUrl } = await import('./r2');
    await expect(getSignedDownloadUrl('rate-cards/a/x.pdf', 300)).resolves.toBe('https://signed.example/obj');
  });

  it('throws a clear error when unconfigured', async () => {
    const { putObject } = await import('./r2');
    await expect(putObject('k', new Uint8Array(), 'application/pdf')).rejects.toThrow(/R2 not configured/);
  });
});
