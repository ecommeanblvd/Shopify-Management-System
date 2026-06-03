import { describe, it, expect } from 'vitest';
import { verifyMmpSignature, signMmpPayload, SKEW_TOLERANCE_SECONDS } from './hmac';

const SECRET = 'test-secret-key-just-for-unit-tests';
const NOW = 1_780_000_000;

describe('verifyMmpSignature', () => {
  it('accepts a freshly-signed payload', () => {
    const body = '{"products":[{"portalProductId":"abc"}]}';
    const sig = signMmpPayload(SECRET, NOW, body);
    const r = verifyMmpSignature({
      secret: SECRET, rawBody: body,
      signatureHeader: sig, timestampHeader: String(NOW), nowSeconds: NOW,
    });
    expect(r).toEqual({ ok: true });
  });

  it('rejects when signature header missing', () => {
    expect(verifyMmpSignature({
      secret: SECRET, rawBody: '{}',
      signatureHeader: null, timestampHeader: String(NOW), nowSeconds: NOW,
    })).toEqual({ ok: false, reason: 'missing_signature' });
    expect(verifyMmpSignature({
      secret: SECRET, rawBody: '{}',
      signatureHeader: undefined, timestampHeader: String(NOW), nowSeconds: NOW,
    })).toEqual({ ok: false, reason: 'missing_signature' });
  });

  it('rejects when timestamp header missing', () => {
    const sig = signMmpPayload(SECRET, NOW, '{}');
    expect(verifyMmpSignature({
      secret: SECRET, rawBody: '{}',
      signatureHeader: sig, timestampHeader: null, nowSeconds: NOW,
    })).toEqual({ ok: false, reason: 'missing_timestamp' });
  });

  it('rejects malformed signature header', () => {
    expect(verifyMmpSignature({
      secret: SECRET, rawBody: '{}',
      signatureHeader: 'not-a-real-sig', timestampHeader: String(NOW), nowSeconds: NOW,
    }).ok).toBe(false);
    expect(verifyMmpSignature({
      secret: SECRET, rawBody: '{}',
      signatureHeader: 'sha256=zzzz', timestampHeader: String(NOW), nowSeconds: NOW,
    })).toEqual({ ok: false, reason: 'bad_signature_format' });
  });

  it('rejects non-integer timestamps', () => {
    const sig = signMmpPayload(SECRET, NOW, '{}');
    expect(verifyMmpSignature({
      secret: SECRET, rawBody: '{}',
      signatureHeader: sig, timestampHeader: '17.5e9', nowSeconds: NOW,
    })).toEqual({ ok: false, reason: 'timestamp_not_integer' });
  });

  it('rejects when timestamp is older than skew tolerance', () => {
    const oldTs = NOW - SKEW_TOLERANCE_SECONDS - 1;
    const sig = signMmpPayload(SECRET, oldTs, '{}');
    expect(verifyMmpSignature({
      secret: SECRET, rawBody: '{}',
      signatureHeader: sig, timestampHeader: String(oldTs), nowSeconds: NOW,
    })).toEqual({ ok: false, reason: 'timestamp_skew' });
  });

  it('rejects future-dated timestamps beyond tolerance', () => {
    const futureTs = NOW + SKEW_TOLERANCE_SECONDS + 1;
    const sig = signMmpPayload(SECRET, futureTs, '{}');
    expect(verifyMmpSignature({
      secret: SECRET, rawBody: '{}',
      signatureHeader: sig, timestampHeader: String(futureTs), nowSeconds: NOW,
    })).toEqual({ ok: false, reason: 'timestamp_skew' });
  });

  it('accepts within boundary skew (±300s)', () => {
    const okPast = NOW - SKEW_TOLERANCE_SECONDS;
    const sig = signMmpPayload(SECRET, okPast, '{}');
    expect(verifyMmpSignature({
      secret: SECRET, rawBody: '{}',
      signatureHeader: sig, timestampHeader: String(okPast), nowSeconds: NOW,
    })).toEqual({ ok: true });
  });

  it("rejects replay: same body+sig with different timestamp (signed payload changes)", () => {
    const body = '{}';
    const sigOld = signMmpPayload(SECRET, NOW - 60, body);
    const r = verifyMmpSignature({
      secret: SECRET, rawBody: body,
      signatureHeader: sigOld,
      // Attacker tries to bump timestamp into current window
      timestampHeader: String(NOW),
      nowSeconds: NOW,
    });
    expect(r).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it("rejects body tamper: signed body differs by one byte", () => {
    const body = '{"a":1}';
    const sig = signMmpPayload(SECRET, NOW, body);
    const r = verifyMmpSignature({
      secret: SECRET, rawBody: '{"a":2}',
      signatureHeader: sig, timestampHeader: String(NOW), nowSeconds: NOW,
    });
    expect(r).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it("rejects wrong-length signature without throwing", () => {
    // timing-safe compare throws on length mismatch — we must guard it.
    const r = verifyMmpSignature({
      secret: SECRET, rawBody: '{}',
      signatureHeader: 'sha256=ab', // 1 byte
      timestampHeader: String(NOW), nowSeconds: NOW,
    });
    expect(r).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it("rejects when secret mismatches", () => {
    const sig = signMmpPayload('wrong-secret', NOW, '{}');
    const r = verifyMmpSignature({
      secret: SECRET, rawBody: '{}',
      signatureHeader: sig, timestampHeader: String(NOW), nowSeconds: NOW,
    });
    expect(r).toEqual({ ok: false, reason: 'signature_mismatch' });
  });
});
